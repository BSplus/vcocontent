import sharp from "sharp";
import {mediaPolicy} from "../media-policy";

// A pixel-only hard negative for obvious opaque neutral rectangles. It is not
// a general obstruction detector or a positive number certificate. Conservative
// false positives yield unknown numbers, never alternative identities.
export async function hasOpaqueNeutralPatch(bytes:Buffer):Promise<boolean> {
  const {data,info}=await sharp(bytes,{limitInputPixels:mediaPolicy.maxPixels})
    .removeAlpha().toColourspace("srgb").raw().toBuffer({resolveWithObject:true});
  const {width,height,channels}=info;
  const at=(x:number,y:number)=>Math.max(0,Math.min(height-1,y))*width*channels+
    Math.max(0,Math.min(width-1,x))*channels;
  // Lossy JPEG/WebP introduces small colour/brightness deviations even inside
  // an originally uniform patch. Require near-neutral, not byte-identical RGB.
  const neutral=(i:number,g:number)=>Math.max(data[i],data[i+1],data[i+2])-Math.min(data[i],data[i+1],data[i+2])<=8 &&
    Math.abs(data[i]-g)<=8 && Math.abs(data[i+1]-g)<=8 && Math.abs(data[i+2]-g)<=8;
  const differs=(x:number,y:number,g:number)=>{
    const i=at(x,y);return Math.max(Math.abs(data[i]-g),Math.abs(data[i+1]-g),Math.abs(data[i+2]-g))>=12;
  };
  // Bound rectangles relative to input size, excluding vast flat sky/background.
  const maxWidth=Math.min(256,Math.floor(width/4)),maxHeight=Math.min(256,Math.floor(height/2));
  if(maxWidth<12 || maxHeight<16)return false;
  for(let y=5;y<height-20;y++)for(let x=5;x<width-17;) {
    const i=at(x,y),g=data[i];
    // Black/white graphic backgrounds and coloured number plates are not
    // neutral-grey redactions. No particular fixture colour/position is used.
    if(g<45 || g>210 || !neutral(i,g)){x++;continue;}
    const start=x;
    while(x<width-5 && neutral(at(x,y),g))x++;
    const run=x-start;
    if(run<12 || run>maxWidth)continue;
    let bottom=y+1;
    while(bottom<height-5 && bottom-y<=maxHeight) {
      let matching=0;
      for(let col=start+2;col<x-2;col++)if(neutral(at(col,bottom),g))matching++;
      if(matching/(run-4)<.95)break;
      bottom++;
    }
    const tall=bottom-y;
    if(tall<16 || tall>maxHeight)continue;
    // Demand a real rectangular seam on ALL four sides. Nearby compression
    // halos are skipped; gradients and ordinary uniform roads fail this test.
    let left=0,right=0,top=0,base=0;
    for(let row=y+2;row<bottom-2;row++) {
      if(differs(start-5,row,g))left++;
      if(differs(x+5,row,g))right++;
    }
    for(let col=start+2;col<x-2;col++) {
      if(differs(col,y-5,g))top++;
      if(differs(col,bottom+5,g))base++;
    }
    if(left/(tall-4)>=.7 && right/(tall-4)>=.7 && top/(run-4)>=.7 && base/(run-4)>=.7)
      return true;
  }
  return false;
}
