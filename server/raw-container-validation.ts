import path from "node:path";
import {constants,createReadStream} from "node:fs";
import {open,lstat,realpath,type FileHandle} from "node:fs/promises";
import {createHash} from "node:crypto";
import {exiftoolPath} from "exiftool-vendored";
import {withMediaWorkBudget} from "./media-work-budget";
import {RawValidationError,runRawValidationTool} from "./raw-validation-tool";

const fail=(code:ConstructorParameters<typeof RawValidationError>[0]):never=>{throw new RawValidationError(code);};
const integer=(value:unknown):value is number=>typeof value==="number"&&Number.isSafeInteger(value)&&value>0;
const evaluationCeiling=250*1024*1024; // Isolated evaluation ceiling, NOT an activated product limit.
async function hashSource(file:FileHandle,signal:AbortSignal,limit:number){
  const stream=createReadStream("",{fd:file.fd,autoClose:false,start:0,highWaterMark:65536,signal});
  const hash=createHash("sha256");let bytes=0;
  for await(const chunk of stream){bytes+=(chunk as Buffer).length;if(bytes>limit)fail("integrity");hash.update(chunk);}
  return {bytes,sha256:hash.digest("hex")};
}
function numbers(value:unknown):number[]{
  const values=typeof value==="number"?[value]:typeof value==="string"?
    value.split(" ").map(Number):[];
  if(!values.length||values.length>1024||values.some(value=>!integer(value)))fail("invalid_container");
  return values;
}
function inspect(output:string,size:number){
  let rows;
  try{rows=JSON.parse(output);}catch{fail("invalid_container");}
  if(!Array.isArray(rows)||rows.length!==1||!rows[0]||typeof rows[0]!=="object")fail("invalid_container");
  const row=rows[0];
  if(row.Error||row.Warning||row.Validate!=="0 0 0")fail("invalid_container");
  if(row.FileType!=="DNG"||row.MIMEType!=="image/x-adobe-dng"||
    !/^1 [1-7] 0 0$/.test(row.DNGVersion))fail("unsupported");
  if(!integer(row.ImageWidth)||!integer(row.ImageHeight)||row.ImageWidth*row.ImageHeight>40_000_000)
    fail("unsupported");
  // First evaluation subset only: uncompressed 16-bit, one-sample CFA strips.
  // No lossless-JPEG decoder, tiled RAW, vendor MakerNotes or RAW rendering.
  if(row.Compression!==1||row.PhotometricInterpretation!==32803||
    row.SamplesPerPixel!==1||row.BitsPerSample!==16)fail("unsupported");
  const offsets=numbers(row.StripOffsets),counts=numbers(row.StripByteCounts);
  if(offsets.length!==counts.length)fail("invalid_container");
  const ranges=offsets.map((offset,i)=>({start:offset,end:offset+counts[i]})).sort((a,b)=>a.start-b.start);
  if(ranges.some((range,i)=>range.start<8||range.end>size||!Number.isSafeInteger(range.end)||
    i>0&&range.start<ranges[i-1].end)||
    counts.reduce((sum,count)=>sum+count,0)!==row.ImageWidth*row.ImageHeight*2)fail("invalid_container");
  return {width:row.ImageWidth as number,height:row.ImageHeight as number};
}

/** Prepared internal validator only. Caller must supply its own owned immutable
 * staging file and durable expected size/hash. No route calls this yet.
 * Successful structural validation is NOT publication safety or delivery consent.
 */
export async function validateRawContainer(input:{
  filename:string;stagingDirectory:string;originalFilename:string;mime:string;
  size:number;sha256:string;maxBytes:number;signal?:AbortSignal;
}){
  if(!integer(input.maxBytes)||input.maxBytes>evaluationCeiling||!integer(input.size)||input.size>input.maxBytes||
    !/^[a-f0-9]{64}$/.test(input.sha256))fail("invalid_input");
  if(typeof input.originalFilename!=="string"||input.originalFilename.length>255||
    /[/\\\u0000-\u001f\u007f]/.test(input.originalFilename)||
    !/^[^.].*\.dng$/i.test(input.originalFilename)||!["image/x-adobe-dng","application/octet-stream"].includes(input.mime))
    fail("unsupported");
  return withMediaWorkBudget(async()=>{
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),16000);
    const signal=input.signal?AbortSignal.any([input.signal,controller.signal]):controller.signal;
    let file:FileHandle|undefined;
    try{
      signal.throwIfAborted();
      const root=await realpath(input.stagingDirectory),filename=path.resolve(input.filename);
      if(path.dirname(filename)!==root||await realpath(filename)!==filename)fail("invalid_input");
      file=await open(filename,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
      const before=await file.stat({bigint:true});
      if(!before.isFile()||before.size!==BigInt(input.size))fail("integrity");
      const header=Buffer.alloc(8);await file.read(header,0,8,0);
      const little=header.subarray(0,4).equals(Buffer.from([0x49,0x49,42,0]));
      const big=header.subarray(0,4).equals(Buffer.from([0x4d,0x4d,0,42]));
      if(!little&&!big)fail("unsupported");
      const firstIfd=little?header.readUInt32LE(4):header.readUInt32BE(4);
      if(firstIfd<8||firstIfd>=input.size)fail("invalid_container");
      const initial=await hashSource(file,signal,input.maxBytes);
      if(initial.bytes!==input.size||initial.sha256!==input.sha256)fail("integrity");
      const tool=await exiftoolPath().catch(()=>fail("tool_unavailable"));
      const tags=["Validate","Warning","Error","FileType","MIMEType","DNGVersion","ImageWidth","ImageHeight",
        "Compression","PhotometricInterpretation","StripOffsets","StripByteCounts","SamplesPerPixel","BitsPerSample"];
      const output=await runRawValidationTool("prlimit",["--as=268435456","--cpu=4","--nofile=32","--fsize=0",
        "--","perl",tool,"-config","","-j","-n","-s",...tags.map(tag=>`-${tag}`),"/proc/self/fd/3"],
      {fd:file.fd,signal});
      const dimensions=inspect(output,input.size);
      const final=await hashSource(file,signal,input.maxBytes);
      const after=await file.stat({bigint:true}),current=await lstat(filename,{bigint:true});
      if(final.bytes!==input.size||final.sha256!==input.sha256||
        ["dev","ino","size","mtimeNs","ctimeNs"].some(key=>before[key as keyof typeof before]!==after[key as keyof typeof after])||
        current.isSymbolicLink()||current.dev!==before.dev||current.ino!==before.ino)fail("integrity");
      signal.throwIfAborted();
      return {format:"DNG" as const,subset:"uncompressed-cfa16-strips" as const,
        mime:"image/x-adobe-dng" as const,size:input.size,sha256:final.sha256,...dimensions};
    }catch(error){
      if(error instanceof RawValidationError){
        if(controller.signal.aborted&&error.code==="cancelled")fail("resource_limit");
        throw error;
      }
      if(signal.aborted)fail(controller.signal.aborted?"resource_limit":"cancelled");
      fail("invalid_input");
    }finally{clearTimeout(timer);await file?.close();}
  },input.signal).catch(error=>{
    if(input.signal?.aborted&&!(error instanceof RawValidationError))fail("cancelled");
    throw error;
  });
}
