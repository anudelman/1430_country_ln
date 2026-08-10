#!/usr/bin/env node
/**
 * tools/stats.mjs — histogram / grade statistics for a PNG, matching the
 * numbers docs/PHOTOGRAPHY.md quotes (deciles, band occupancy, mean chroma,
 * black/white point). Compare a render against its listing photo:
 *
 *   node tools/stats.mjs renders/x.png listing_photos/x.png
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const srcs = process.argv.slice(2).filter((a) => !a.startsWith('--'));

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setContent('<body style="margin:0">');

for (const s of srcs) {
  const file = path.resolve(ROOT, s);
  const b64 = fs.readFileSync(file).toString('base64');
  const o = await page.evaluate(async ({ b64 }) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const n = d.length / 4;
    const hist = new Float64Array(256);
    let chroma = 0, rm = 0, gm = 0, bm = 0;
    const bands = [0, 0, 0, 0, 0];
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], gg = d[i + 1], b = d[i + 2];
      const L = Math.round(0.2126 * r + 0.7152 * gg + 0.0722 * b);
      hist[L]++;
      chroma += Math.max(r, gg, b) - Math.min(r, gg, b);
      rm += r; gm += gg; bm += b;
      if (L < 32) bands[0]++;
      else if (L < 96) bands[1]++;
      else if (L < 160) bands[2]++;
      else if (L < 208) bands[3]++;
      else bands[4]++;
    }
    const pct = (p) => {
      let acc = 0; const t = n * p;
      for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= t) return i; }
      return 255;
    };
    return {
      w: c.width, h: c.height,
      p10: pct(0.10), p30: pct(0.30), p50: pct(0.50), p70: pct(0.70), p90: pct(0.90),
      p999: pct(0.999),
      belowL4: (100 * hist.slice(0, 5).reduce((a, b) => a + b, 0) / n).toFixed(3),
      pureWhitePct: (100 * hist[255] / n).toFixed(3),
      bands: bands.map((v) => (100 * v / n).toFixed(1)),
      chroma: (chroma / n).toFixed(1),
      mean: [rm / n, gm / n, bm / n].map((v) => v.toFixed(1)),
    };
  }, { b64 });
  console.log(path.relative(ROOT, file), `${o.w}x${o.h}`);
  console.log(`  deciles p10 ${o.p10}  p30 ${o.p30}  p50 ${o.p50}  p70 ${o.p70}  p90 ${o.p90}  p99.9 ${o.p999}`);
  console.log(`  bands 0-31 ${o.bands[0]}%  32-95 ${o.bands[1]}%  96-159 ${o.bands[2]}%  160-207 ${o.bands[3]}%  208+ ${o.bands[4]}%`);
  console.log(`  L<=4 ${o.belowL4}%   pure255 ${o.pureWhitePct}%   mean chroma ${o.chroma}   mean RGB ${o.mean.join(', ')}`);
}
await browser.close();
