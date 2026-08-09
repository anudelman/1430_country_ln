// usage: node crop.mjs <src.png> <out.png> <x> <y> <w> <h> [scale]
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const [src, out, xs, ys, ws, hs, ss] = process.argv.slice(2);
const x = +xs, y = +ys, w = +ws, h = +hs, s = ss ? +ss : 1;

const b64 = fs.readFileSync(src).toString('base64');
const browser = await chromium.launch({
  executablePath: undefined,
  args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox','--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: Math.ceil(w*s), height: Math.ceil(h*s) } });
await page.setContent(`<style>html,body{margin:0;padding:0;background:#fff}canvas{display:block}</style><canvas id="c"></canvas>`);
const dataUrl = 'data:image/png;base64,' + b64;
const info = await page.evaluate(async ({dataUrl,x,y,w,h,s}) => {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const c = document.getElementById('c');
  c.width = Math.ceil(w*s); c.height = Math.ceil(h*s);
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, x, y, w, h, 0, 0, c.width, c.height);
  return { natW: img.naturalWidth, natH: img.naturalHeight };
}, {dataUrl,x,y,w,h,s});
fs.mkdirSync(path.dirname(out), { recursive: true });
await page.locator('#c').screenshot({ path: out });
await browser.close();
console.log(JSON.stringify(info));
