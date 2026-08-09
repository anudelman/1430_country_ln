#!/usr/bin/env node
/**
 * tools/crop.mjs — crop / zoom a PNG so it can be studied with the Read tool.
 *
 *   node tools/crop.mjs <src.png> <x> <y> <w> <h> [--scale 2] [--out out.png]
 *   node tools/crop.mjs <src.png> --info
 *
 * Uses headless Chromium (playwright-core) because the repo carries no image
 * libraries. Output goes to .scratch/crop.png unless --out is given.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const src = path.resolve(ROOT, args[0]);
const info = args.includes('--info');
const nums = args.slice(1).filter((a) => /^-?\d+(\.\d+)?$/.test(a)).map(Number);
function opt(n, d) {
  const i = args.indexOf('--' + n);
  return i === -1 ? d : args[i + 1];
}
const scale = Number(opt('scale', 1));
const out = path.resolve(ROOT, opt('out', '.scratch/crop.png'));

const b64 = fs.readFileSync(src).toString('base64');
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setContent('<body style="margin:0">');
const res = await page.evaluate(
  async ({ b64, nums, scale, info }) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    if (info) return { w: img.naturalWidth, h: img.naturalHeight, data: null };
    let [x, y, w, h] = nums;
    if (nums.length < 4) {
      x = 0; y = 0; w = img.naturalWidth; h = img.naturalHeight;
    }
    const c = document.createElement('canvas');
    c.width = Math.round(w * scale);
    c.height = Math.round(h * scale);
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = scale < 1;
    g.drawImage(img, x, y, w, h, 0, 0, c.width, c.height);
    return { w: img.naturalWidth, h: img.naturalHeight, data: c.toDataURL('image/png') };
  },
  { b64, nums, scale, info }
);
await browser.close();
if (res.data) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(res.data.split(',')[1], 'base64'));
}
console.log(JSON.stringify({ src, size: [res.w, res.h], out: res.data ? out : null }));
