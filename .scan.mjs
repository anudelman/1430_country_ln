// usage: node .scan.mjs <src.png> <mode:row|col> <index> [darkThresh]
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const [src, mode, idxs, th] = process.argv.slice(2);
const idx = +idxs, thresh = th ? +th : 110;
const b64 = fs.readFileSync(src).toString('base64');
const browser = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox','--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setContent('<canvas id=c></canvas>');
const res = await page.evaluate(async ({dataUrl, mode, idx, thresh}) => {
  const img = new Image(); img.src = dataUrl; await img.decode();
  const c = document.getElementById('c'); c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext('2d', {willReadFrequently:true}); g.drawImage(img,0,0);
  const W = c.width, H = c.height;
  const d = g.getImageData(0,0,W,H).data;
  const lum = (x,y)=>{const i=(y*W+x)*4; return 0.299*d[i]+0.587*d[i+1]+0.114*d[i+2];};
  const n = mode==='row' ? W : H;
  const runs = []; let start=-1;
  for (let k=0;k<n;k++){
    const x = mode==='row'? k : idx, y = mode==='row'? idx : k;
    const dark = lum(x,y) < thresh;
    if (dark && start<0) start=k;
    if (!dark && start>=0){ runs.push([start,k-1,k-start]); start=-1; }
  }
  if (start>=0) runs.push([start,n-1,n-start]);
  return { W,H, runs };
}, { dataUrl:'data:image/png;base64,'+b64, mode, idx, thresh });
await browser.close();
console.log(`size ${res.W}x${res.H}`);
console.log(res.runs.map(r=>`${r[0]}-${r[1]}(${r[2]})`).join(' '));
