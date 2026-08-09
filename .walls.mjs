// usage: node .walls.mjs <src.png> <mode:row|col> <i1,i2,...> [lumMax] [satMax]
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const [src, mode, list, lm, sm] = process.argv.slice(2);
const idxs = list.split(',').map(Number);
const lumMax = lm?+lm:115, satMax = sm?+sm:16;
const b64 = fs.readFileSync(src).toString('base64');
const browser = await chromium.launch({ args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox','--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setContent('<canvas id=c></canvas>');
const out = await page.evaluate(async ({dataUrl,mode,idxs,lumMax,satMax})=>{
  const img=new Image(); img.src=dataUrl; await img.decode();
  const c=document.getElementById('c'); c.width=img.naturalWidth; c.height=img.naturalHeight;
  const g=c.getContext('2d',{willReadFrequently:true}); g.drawImage(img,0,0);
  const W=c.width,H=c.height,d=g.getImageData(0,0,W,H).data;
  const lines=[`size ${W}x${H}`];
  for(const idx of idxs){
    const n = mode==='row'?W:H; const runs=[]; let st=-1;
    for(let k=0;k<n;k++){
      const x=mode==='row'?k:idx, y=mode==='row'?idx:k, i=(y*W+x)*4;
      const r=d[i],gg=d[i+1],b=d[i+2];
      const lum=0.299*r+0.587*gg+0.114*b;
      const sat=Math.max(r,gg,b)-Math.min(r,gg,b);
      const isWall = lum<lumMax && sat<satMax;
      if(isWall&&st<0)st=k;
      if(!isWall&&st>=0){ if(k-st>=3) runs.push(`${st}-${k-1}`); st=-1; }
    }
    if(st>=0)runs.push(`${st}-${n-1}`);
    lines.push(`${mode} ${idx}: ${runs.join(' ')}`);
  }
  return lines.join('\n');
},{dataUrl:'data:image/png;base64,'+b64,mode,idxs,lumMax,satMax});
await browser.close();
console.log(out);
