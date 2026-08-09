// usage: node .px.mjs <src.png> <mode:row|col> <index> [step]
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const [src, mode, idxs, steps] = process.argv.slice(2);
const idx=+idxs, step = steps?+steps:1;
const b64 = fs.readFileSync(src).toString('base64');
const browser = await chromium.launch({ args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox','--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setContent('<canvas id=c></canvas>');
const out = await page.evaluate(async ({dataUrl,mode,idx,step})=>{
  const img=new Image(); img.src=dataUrl; await img.decode();
  const c=document.getElementById('c'); c.width=img.naturalWidth; c.height=img.naturalHeight;
  const g=c.getContext('2d',{willReadFrequently:true}); g.drawImage(img,0,0);
  const W=c.width,H=c.height,d=g.getImageData(0,0,W,H).data;
  const n = mode==='row'?W:H; const res=[];
  for(let k=0;k<n;k+=step){
    const x=mode==='row'?k:idx, y=mode==='row'?idx:k; const i=(y*W+x)*4;
    res.push(`${k}:${d[i]},${d[i+1]},${d[i+2]}`);
  }
  return res.join(' ');
},{dataUrl:'data:image/png;base64,'+b64,mode,idx,step});
await browser.close();
console.log(out);
