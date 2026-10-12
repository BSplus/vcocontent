import sharp from "sharp";
import {spawn} from "node:child_process";
import {mediaPolicy} from "../media-policy";
import {type Identification} from "@shared/schema";
type Region=NonNullable<Identification["vehicleRegion"]>;
export type NumberPanel={number:string;region:Region;confidence:number};

function ocr(png:Buffer,psm:number,timeout:number):Promise<{text:string;confidence:number}[]> {
  return new Promise((resolve,reject)=>{
    const child=spawn("tesseract",["stdin","stdout","-l","eng","--psm",String(psm),"tsv"],{
      stdio:["pipe","pipe","ignore"],env:{...process.env,OMP_THREAD_LIMIT:"1"},
    });
    let output="",failed=false;
    const fail=()=>{failed=true;child.kill("SIGKILL");};
    const timer=setTimeout(fail,timeout);
    child.stdin.on("error",()=>{});child.stdout.on("data",b=>{output+=b.toString();if(output.length>65536)fail();});
    child.once("error",()=>{clearTimeout(timer);reject(new Error("Number-panel OCR unavailable"));});
    child.once("close",code=>{
      clearTimeout(timer);
      if(failed||code!==0)return reject(new Error("Number-panel OCR failed"));
      resolve(output.split("\n").map(row=>row.split("\t")).filter(c=>c[0]==="5"&&c[11]?.trim())
        .map(c=>({text:c[11].trim(),confidence:Number(c[10])})));
    });
    child.stdin.end(png);
  });
}
// This is a bounded proposal detector for DARK GLYPHS on light panels, not a
// universal race-number detector. Two unwhitelisted OCR reads are necessary;
// semantic car ownership and completeness still require source-pixel AI checks.
export async function detectNumberPanels(bytes:Buffer,diagnostic?:(value:{region:Region;reads:{text:string;confidence:number}[][]})=>void):Promise<NumberPanel[]>{
  const source=await sharp(bytes,{limitInputPixels:mediaPolicy.maxPixels}).metadata();
  if(!source.width||!source.height)throw new Error("Invalid panel image");
  const {data,info}=await sharp(bytes,{limitInputPixels:mediaPolicy.maxPixels}).removeAlpha()
    .toColourspace("srgb").resize({width:1536,height:1536,fit:"inside",withoutEnlargement:true}).raw().toBuffer({resolveWithObject:true});
  const {width:w,height:h,channels}=info,n=w*h;
  const light=new Uint8Array(n),seen=new Uint8Array(n),queue=new Int32Array(n),labels=new Int32Array(n);
  for(let i=0;i<n;i++){
    const r=data[i*channels],g=data[i*channels+1],b=data[i*channels+2];
    light[i]=Math.max(r,g,b)<=70?1:0;
  }
  const boxes:{x:number;y:number;w:number;h:number;area:number;label:number}[]=[];
  for(let start=0;start<n;start++){
    if(!light[start]||seen[start])continue;
    let head=0,tail=1,x0=w,y0=h,x1=0,y1=0;queue[0]=start;seen[start]=1;
    while(head<tail){
      const p=queue[head++],x=p%w,y=Math.floor(p/w);labels[p]=start+1;
      x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);
      for(const next of [x?p-1:-1,x<w-1?p+1:-1,y?p-w:-1,y<h-1?p+w:-1]){
        if(next>=0&&light[next]&&!seen[next]){seen[next]=1;queue[tail++]=next;}
      }
    }
    const bw=x1-x0+1,bh=y1-y0+1;
    if(tail>=10&&bw>=3&&bh>=8&&bw<=w*.08&&bh<=h*.08&&bw/bh>=.08&&bw/bh<=1.3&&tail/(bw*bh)>=.12&&tail/(bw*bh)<.95)
      boxes.push({x:x0,y:y0,w:bw,h:bh,area:tail,label:start+1});
    if(boxes.length>512)throw new Error("Number-panel complexity limit exceeded");
  }
  const groups:{x:number;y:number;w:number;h:number;area:number;labels:Set<number>}[]=[];
  const used=new Set<number>();
  for(const [i,box] of Array.from(boxes.entries())){
    if(used.has(i))continue;
    const group=[box];used.add(i);
    for(let j=0;j<group.length;j++){
      const a=group[j];
      for(const [k,b] of Array.from(boxes.entries())){
        if(used.has(k)||Math.min(a.h,b.h)/Math.max(a.h,b.h)<.85)continue;
        const gap=Math.max(b.x-(a.x+a.w),a.x-(b.x+b.w),0);
        if(gap<=Math.max(a.h,b.h)*.55&&Math.abs(a.y+a.h/2-b.y-b.h/2)<=Math.max(a.h,b.h)*.12){
          used.add(k);group.push(b);
        }
      }
    }
    // Never crop a prefix out of a longer contiguous word.
    if(group.length<2||group.length>4)continue;
    const x=Math.min(...group.map(b=>b.x)),y=Math.min(...group.map(b=>b.y));
    const right=Math.max(...group.map(b=>b.x+b.w)),bottom=Math.max(...group.map(b=>b.y+b.h));
    const margin=(bottom-y)*.4;
    const x0=Math.max(0,Math.floor(x-margin)),y0=Math.max(0,Math.floor(y-margin));
    const x1=Math.min(w,Math.ceil(right+margin)),y1=Math.min(h,Math.ceil(bottom+margin));
    let white=0,total=0;
    for(let yy=y0;yy<y1;yy++)for(let xx=x0;xx<x1;xx++){
      const p=(yy*w+xx)*channels;total++;
      if(Math.min(data[p],data[p+1],data[p+2])>=140)white++;
    }
    if(white/total>=.55)groups.push({x:x0,y:y0,w:x1-x0,h:y1-y0,area:(x1-x0)*(y1-y0),labels:new Set(group.map(g=>g.label))});
  }
  const deadline=Date.now()+5000,panels:NumberPanel[]=[];
  for(const box of groups.sort((a,b)=>b.area-a.area).slice(0,6)){
    const x=Math.max(0,Math.floor(box.x*source.width/w)-2),y=Math.max(0,Math.floor(box.y*source.height/h)-2);
    const right=Math.min(source.width,Math.ceil((box.x+box.w)*source.width/w)+2);
    const bottom=Math.min(source.height,Math.ceil((box.y+box.h)*source.height/h)+2);
    // OCR-only segmentation removes background, not glyphs from the complete
    // connected row. AI receives the UNMODIFIED original crop later.
    const ink=Buffer.alloc(box.w*box.h,255);
    for(let yy=0;yy<box.h;yy++)for(let xx=0;xx<box.w;xx++)
      if(box.labels.has(labels[(box.y+yy)*w+box.x+xx]))ink[yy*box.w+xx]=0;
    const png=await sharp(ink,{raw:{width:box.w,height:box.h,channels:1}})
      .resize({width:896,height:384,fit:"inside"})
      .extend({top:12,bottom:12,left:12,right:12,background:"white"}).png().toBuffer();
    const reads=[];
    for(const psm of [6,7]){
      const remaining=deadline-Date.now();
      if(remaining<100)throw new Error("Number-panel OCR deadline exceeded");
      reads.push(await ocr(png,psm,Math.min(3000,remaining)));
    }
    diagnostic?.({region:[x/source.width*1000,y/source.height*1000,(right-x)/source.width*1000,(bottom-y)/source.height*1000],reads});
    if(reads.every(r=>r.length===1&&/^\d{1,4}$/.test(r[0].text)&&r[0].confidence>=65)&&reads[0][0].text===reads[1][0].text)
      panels.push({number:reads[0][0].text,confidence:Math.min(reads[0][0].confidence,reads[1][0].confidence),
        region:[x/source.width*1000,y/source.height*1000,(right-x)/source.width*1000,(bottom-y)/source.height*1000]});
  }
  return panels;
}
