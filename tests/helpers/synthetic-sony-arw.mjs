// Authored TIFF directory/tile framing only. Not a decodable camera photo.
export function syntheticSonyArw(){
  const tags=[
    [256,4,1,7168],[257,4,1,5120],[258,3,1,14],[259,3,1,7],[262,3,1,32803],
    [273,4,1,0],[277,3,1,1],[279,4,1,140*64],[322,4,1,512],[323,4,1,512],
    [324,4,140,0],[325,4,140,0],[28672,3,1,4],
  ];
  const sub=26,offsets=sub+2+tags.length*12+4,counts=offsets+560,data=counts+560;
  const bytes=Buffer.alloc(data+140*64);
  bytes.write("II",0);bytes.writeUInt16LE(42,2);bytes.writeUInt32LE(8,4);
  bytes.writeUInt16LE(1,8);bytes.writeUInt16LE(330,10);
  bytes.writeUInt16LE(4,12);bytes.writeUInt32LE(1,14);bytes.writeUInt32LE(sub,18);
  bytes.writeUInt16LE(tags.length,sub);
  const fields={};
  for(const [i,[tag,type,count,value]] of tags.entries()){
    const p=sub+2+i*12;fields[tag]=p;
    bytes.writeUInt16LE(tag,p);bytes.writeUInt16LE(type,p+2);bytes.writeUInt32LE(count,p+4);
    bytes.writeUInt32LE(tag===273?data:tag===324?offsets:tag===325?counts:value,p+8);
  }
  for(let i=0;i<140;i++){
    const p=data+i*64;bytes.writeUInt32LE(p,offsets+i*4);bytes.writeUInt32LE(64,counts+i*4);
    Buffer.from("ffd8ffc300140e0100010004011100021100031100041100","hex").copy(bytes,p);
    bytes[p+47]=0xff;bytes[p+48]=0xd9;bytes.fill(0xff,p+49,p+64);
  }
  return {bytes,sub,offsets,counts,data,fields};
}
