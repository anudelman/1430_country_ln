#!/usr/bin/env node
/**
 * tools/sample.mjs — mean RGB inside boxes of a PNG.
 *   node tools/sample.mjs <src.png> x,y,w,h [x,y,w,h ...]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const src = path.resolve(ROOT, process.argv[2]);
const boxes = process.argv.slice(3).map((s) => s.split(',').map(Number));
const b64 = fs.readFileSync(src).toString('base64');

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setContent('<body style="margin:0">');
const out = await page.evaluate(
  async ({ b64, boxes }) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    return boxes.map(([x, y, w, h]) => {
      const d = g.getImageData(x, y, w, h).data;
      let r = 0, gg = 0, b = 0, n = d.length / 4;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; }
      return { box: [x, y, w, h], rgb: [r / n, gg / n, b / n].map((v) => Math.round(v * 10) / 10) };
    });
  },
  { b64, boxes }
);
await browser.close();
for (const o of out) console.log(o.box.join(','), '->', o.rgb.join(', '), '  #' + o.rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join(''));
