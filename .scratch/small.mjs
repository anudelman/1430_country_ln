import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
const OUT = '/tmp/claude-0/-home-user-1430-country-ln/8c0b6d4d-3c85-50a8-b302-efe59197f362/scratchpad/small';
fs.mkdirSync(OUT, { recursive: true });
const dir = '/home/user/1430_country_ln/listing_photos';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.png') && !f.startsWith('floorplan')).sort();
const W = 660;
const browser = await chromium.launch({ args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox','--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport:{width:W,height:600} });
await page.setContent('<style>html,body{margin:0;background:#fff}canvas{display:block}</style><canvas id="c"></canvas>');
for (const f of files) {
  const b64 = fs.readFileSync(path.join(dir,f)).toString('base64');
  await page.evaluate(async ({dataUrl,W})=>{
    const img=new Image(); img.src=dataUrl; await img.decode();
    const h=Math.round(img.naturalHeight*W/img.naturalWidth);
    const c=document.getElementById('c'); c.width=W; c.height=h;
    const g=c.getContext('2d'); g.imageSmoothingQuality='high'; g.drawImage(img,0,0,W,h);
  },{dataUrl:'data:image/png;base64,'+b64,W});
  await page.locator('#c').screenshot({ path: path.join(OUT, f.replace(/\.png$/,'.jpg')), type:'jpeg', quality:78 });
}
await browser.close();
console.log('wrote', files.length, 'to', OUT);
