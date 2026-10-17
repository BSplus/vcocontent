// Authored synthetic sensor ramp, not a camera photograph or vendor fixture.
// Classic little-endian TIFF/DNG; no personal metadata or external assets.
export function syntheticDng(){
  const short=values=>{const b=Buffer.alloc(values.length*2);values.forEach((v,i)=>b.writeUInt16LE(v,i*2));return b;};
  const long=values=>{const b=Buffer.alloc(values.length*4);values.forEach((v,i)=>b.writeUInt32LE(v,i*4));return b;};
  const rational=values=>{const b=Buffer.alloc(values.length*8);values.forEach(([n,d],i)=>{
    b.writeInt32LE(n,i*8);b.writeInt32LE(d,i*8+4);});return b;};
  const width=32,height=24;
  const entries=[
    [254,4,1,long([0])],[256,4,1,long([width])],[257,4,1,long([height])],
    [258,3,1,short([16])],[259,3,1,short([1])],[262,3,1,short([32803])],
    [271,2,10,Buffer.from("Synthetic\0")],[272,2,8,Buffer.from("Fixture\0")],
    [273,4,1,long([0])],[274,3,1,short([1])],[277,3,1,short([1])],
    [278,4,1,long([height])],[279,4,1,long([width*height*2])],[284,3,1,short([1])],
    [33421,3,2,short([2,2])],[33422,1,4,Buffer.from([0,1,1,2])],
    [50706,1,4,Buffer.from([1,4,0,0])],[50707,1,4,Buffer.from([1,1,0,0])],
    [50708,2,18,Buffer.from("Synthetic Fixture\0")],
    [50710,1,3,Buffer.from([0,1,2])],[50711,3,1,short([1])],
    [50713,3,2,short([1,1])],[50714,5,1,rational([[0,1]])],[50717,4,1,long([65535])],
    [50718,5,2,rational([[1,1],[1,1]])],[50719,4,2,long([0,0])],
    [50720,4,2,long([width,height])],
    [50721,10,9,rational([[1,1],[0,1],[0,1],[0,1],[1,1],[0,1],[0,1],[0,1],[1,1]])],
    [50728,5,3,rational([[1,1],[1,1],[1,1]])],[50778,3,1,short([21])],
  ].sort((a,b)=>a[0]-b[0]);
  let cursor=8+2+entries.length*12+4;
  const data=[];
  const table=Buffer.alloc(2+entries.length*12+4);table.writeUInt16LE(entries.length);
  entries.forEach(([tag,type,count,value],i)=>{
    const offset=2+i*12;table.writeUInt16LE(tag,offset);table.writeUInt16LE(type,offset+2);
    table.writeUInt32LE(count,offset+4);
    if(value.length<=4)value.copy(table,offset+8);
    else{table.writeUInt32LE(cursor,offset+8);data.push(value);cursor+=value.length;}
  });
  const stripIndex=entries.findIndex(entry=>entry[0]===273);
  table.writeUInt32LE(cursor,2+stripIndex*12+8);
  const pixels=Buffer.alloc(width*height*2);
  for(let i=0;i<width*height;i++)pixels.writeUInt16LE((i*83)%65536,i*2);
  return Buffer.concat([Buffer.from([0x49,0x49,42,0,8,0,0,0]),table,...data,pixels]);
}
