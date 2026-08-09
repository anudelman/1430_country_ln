#!/usr/bin/env node
/**
 * tools/profile.mjs — 1-D luminance profile down a column band (or across a row band).
 *   node tools/profile.mjs <src.png> col x0 x1 y0 y1     # average over x, list per y
 *   node tools/profile.mjs <src.png> row x0 x1 y0 y1     # average over y, list per x
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const src = path.resolve(ROOT, process.argv[2]);
const mode = process.argv[3];
const [x0, x1, y0, y1] = process.argv.slice(4).map(Number);
const b64 = fs.readFileSync(src).toString('base64');

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setContent('<body style="margin:0">');
const out = await page.evaluate(
  async ({ b64, mode, x0, x1, y0, y1 }) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const d = g.getImageData(x0, y0, x1 - x0, y1 - y0).data;
    const W = x1 - x0, H = y1 - y0;
    const res = [];
    if (mode === 'col') {
      for (let j = 0; j < H; j++) {
        let s = 0;
        for (let i = 0; i < W; i++) { const k = (j * W + i) * 4; s += 0.2126 * d[k] + 0.7152 * d[k + 1] + 0.0722 * d[k + 2]; }
        res.push([y0 + j, Math.round((s / W) * 10) / 10]);
      }
    } else {
      for (let i = 0; i < W; i++) {
        let s = 0;
        for (let j = 0; j < H; j++) { const k = (j * W + i) * 4; s += 0.2126 * d[k] + 0.7152 * d[k + 1] + 0.0722 * d[k + 2]; }
        res.push([x0 + i, Math.round((s / H) * 10) / 10]);
      }
    }
    return res;
  },
  { b64, mode, x0, x1, y0, y1 }
);
await browser.close();
console.log(out.map(([p, v]) => p + ':' + v).join(' '));
