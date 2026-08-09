import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
const files = process.argv.slice(2);
const W = 780;
const browser = await chromium.launch({ args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox','--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport:{width:W,height:600} });
for (const f of files) {
  const b64 = fs.readFileSync(f).toString('base64');
  await page.setContent('<style>html,body{margin:0;background:#fff}canvas{display:block}</style><canvas id=c></canvas>');
  const dim = await page.evaluate(async ({dataUrl,W})=>{
    const img=new Image(); img.src=dataUrl; await img.decode();
    const h=Math.round(img.naturalHeight*W/img.naturalWidth);
    const c=document.getElementById('c'); c.width=W; c.height=h;
    const g=c.getContext('2d'); g.imageSmoothingQuality='high'; g.drawImage(img,0,0,W,h);
    return {w:img.naturalWidth,h:img.naturalHeight};
  },{dataUrl:'data:image/png;base64,'+b64,W});
  const out = '/tmp/claude-0/-home-user-1430-country-ln/8c0b6d4d-3c85-50a8-b302-efe59197f362/scratchpad/small/'+path.basename(f).replace(/\.png$/,'.jpg');
  fs.mkdirSync(path.dirname(out),{recursive:true});
  await page.locator('#c').screenshot({ path: out, type:'jpeg', quality:82 });
  console.log(path.basename(f), dim.w+'x'+dim.h, 'ar='+(dim.w/dim.h).toFixed(4));
}
await browser.close();
