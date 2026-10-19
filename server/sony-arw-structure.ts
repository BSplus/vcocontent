import type {FileHandle} from "node:fs/promises";
import {RawValidationError} from "./raw-validation-tool";

const fail=():never=>{throw new RawValidationError("invalid_container");};
const unsupported=():never=>{throw new RawValidationError("unsupported");};
const sizes:Record<number,number>={1:1,2:1,3:2,4:4,5:8,6:1,7:1,8:2,9:4,10:8,11:4,12:8,13:4};
type Entry={type:number;count:number;start:number;length:number};

/** Narrow, read-only structural evaluation, NOT an entropy decoder or safety
 * approval. Only the observed Sony CFA14/512-tile/lossless-JPEG profile.
 * All reads are bounded, abortable between reads, and share the caller's slot.
 */
export async function inspectSonyArwStructure(file:FileHandle,size:number,signal:AbortSignal){
  let readBytes=0,totalEntries=0;
  const extents:{start:number;end:number}[]=[];
  const range=(start:number,length:number)=>{
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(length)||start<8||length<=0||
      start+length>size||!Number.isSafeInteger(start+length))fail();
  };
  const read=async(start:number,length:number)=>{
    signal.throwIfAborted();
    if(start<0||length<1||start+length>size||length>65536||(readBytes+=length)>262144)fail();
    const bytes=Buffer.alloc(length);let done=0;
    while(done<length){
      signal.throwIfAborted();
      const result=await file.read(bytes,done,length-done,start+done);
      if(!result.bytesRead)fail();done+=result.bytesRead;
    }
    return bytes;
  };
  const header=await read(0,8);
  // Observed camera profile is classic little-endian TIFF, not arbitrary TIFF.
  if(!header.subarray(0,4).equals(Buffer.from([0x49,0x49,42,0])))unsupported();
  const seen=new Set<number>(),directories:Map<number,Entry>[]=[];
  const visit=async(offset:number):Promise<void>=>{
    if(!offset)return;
    if(seen.has(offset)||seen.size>=32)fail();seen.add(offset);
    range(offset,2);const count=(await read(offset,2)).readUInt16LE();
    if(!count||count>1024||(totalEntries+=count)>4096)fail();
    const length=2+count*12+4;range(offset,length);
    extents.push({start:offset,end:offset+length});
    const bytes=await read(offset+2,length-2),entries=new Map<number,Entry>();
    directories.push(entries);
    for(let i=0;i<count;i++){
      const p=i*12,tag=bytes.readUInt16LE(p),type=bytes.readUInt16LE(p+2),
        count=bytes.readUInt32LE(p+4),unit=sizes[type];
      if(entries.has(tag)||!unit||!count)fail();
      const length=count*unit,start=length<=4?offset+2+p+8:bytes.readUInt32LE(p+8);
      range(start,length);
      entries.set(tag,{type,count,start,length});
      if(length>4)extents.push({start,end:start+length});
    }
    const next=bytes.readUInt32LE(count*12);
    for(const pointer of [330,34665,34853,40965]){
      const sub=entries.get(pointer);
      if(!sub)continue;
      if(![4,13].includes(sub.type)||sub.count>16)fail();
      const values=await read(sub.start,sub.length);
      for(let i=0;i<sub.count;i++)await visit(values.readUInt32LE(i*4));
    }
    await visit(next);
  };
  await visit(header.readUInt32LE(4));
  const numeric=async(entry:Entry|undefined)=>{
    if(!entry||![3,4].includes(entry.type)||entry.count>1024)fail();
    const e=entry!,bytes=await read(e.start,e.length);
    return Array.from({length:e.count},(_,i)=>e.type===3?bytes.readUInt16LE(i*2):bytes.readUInt32LE(i*4));
  };
  const scalar=async(entries:Map<number,Entry>,tag:number)=>{
    const values=await numeric(entries.get(tag));if(values.length!==1)fail();return values[0];
  };
  const rawDirectories=directories.filter(entries=>entries.has(28672));
  if(rawDirectories.length!==1)unsupported();
  const raw=rawDirectories[0];
  const width=await scalar(raw,256),height=await scalar(raw,257);
  if(width!==7168||height!==5120||await scalar(raw,28672)!==4||
    await scalar(raw,259)!==7||await scalar(raw,262)!==32803||
    await scalar(raw,258)!==14||await scalar(raw,277)!==1||
    await scalar(raw,322)!==512||await scalar(raw,323)!==512)unsupported();
  const offsets=await numeric(raw.get(324)),counts=await numeric(raw.get(325));
  if(offsets.length!==140||counts.length!==offsets.length)fail();
  const stripStart=await scalar(raw,273),stripBytes=await scalar(raw,279);
  range(stripStart,stripBytes);const stripEnd=stripStart+stripBytes;
  const tiles=offsets.map((start,i)=>({start,end:start+counts[i],length:counts[i]}))
    .sort((a,b)=>a.start-b.start);
  for(let i=0;i<tiles.length;i++){
    const tile=tiles[i];range(tile.start,tile.length);
    if(tile.length<32||tile.start<stripStart||tile.end>stripEnd||
      i>0&&tile.start<tiles[i-1].end||
      extents.some(e=>tile.start<e.end&&tile.end>e.start))fail();
    const head=await read(tile.start,24);
    // SOI + lossless SOF3, 14-bit, 4 x 256-square CFA component planes.
    if(head.readUInt16BE(0)!==0xffd8||head.readUInt16BE(2)!==0xffc3||
      head.readUInt16BE(4)!==20||head[6]!==14||head.readUInt16BE(7)!==256||
      head.readUInt16BE(9)!==256||head[11]!==4)fail();
    for(let plane=0;plane<4;plane++){
      const p=12+plane*3;
      if(head[p]!==plane+1||head[p+1]!==0x11||head[p+2]!==0)fail();
    }
    const tail=await read(tile.end-32,32);
    // The camera aligns tiles with up to 15 trailing 0xff bytes.
    let end=tail.length-1;while(end>=0&&tail[end]===0xff)end--;
    if(end<1||tail.length-1-end>15||tail[end]!==0xd9||tail[end-1]!==0xff)fail();
  }
  return {width,height,tiles:tiles.length,profile:"sony-ilce7m4-lossless-cfa14" as const};
}

/** ExifTool warnings remain fail-closed except this exact reviewed tag-order
 * set, paired with the independent bounds/overlap/tile checks above. */
export function inspectSonyArwToolOutput(output:string){
  const rows=new Map<string,string>(),warnings:string[]=[];
  for(const line of output.trim().split(/\r?\n/)){
    const match=/^\[([A-Za-z0-9]+)\]\s+(\w+)\s+:\s?(.*)$/.exec(line);
    if(!match)fail();
    const [,group,tag,value]=match!;
    if(tag==="Warning"){if(group!=="ExifTool")fail();warnings.push(value);continue;}
    if(tag==="Error")fail();
    const key=`${group}:${tag}`;if(rows.has(key))fail();rows.set(key,value);
  }
  if(rows.get("File:FileType")!=="ARW"||rows.get("File:MIMEType")!=="image/x-sony-arw"||
    rows.get("IFD0:Make")!=="SONY"||rows.get("IFD0:Model")!=="ILCE-7M4")unsupported();
  const reviewed=[
    "Entries in SubIFD are out of order [x6]",
    "Tag ID 0x011a XResolution out of sequence in SubIFD",
    "Tag ID 0x7000 SonyRawFileType out of sequence in SubIFD",
    "Tag ID 0x0111 StripOffsets out of sequence in SubIFD",
    "Tag ID 0x74c7 SonyCropTopLeft out of sequence in SubIFD",
    "Tag ID 0x0102 BitsPerSample out of sequence in SubIFD",
    "Tag ID 0x0142 TileWidth out of sequence in SubIFD",
  ];
  const clean=rows.get("ExifTool:Validate")==="0 0 0"&&warnings.length===0;
  const known=rows.get("ExifTool:Validate")==="0 7 0"&&warnings.length===reviewed.length&&
    new Set(warnings).size===reviewed.length&&warnings.every(w=>reviewed.includes(w));
  if(!clean&&!known)fail();
  return {reviewedTagOrderWarnings:known?7:0};
}
