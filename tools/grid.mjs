#!/usr/bin/env node
/**
 * tools/grid.mjs — draw a labelled coordinate grid over a PNG so an agent can
 * read pixel positions off it with the Read tool.
 *
 *   node tools/grid.mjs <src.png> [--step 100] [--out .scratch/grid.png]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
function opt(n, d) { const i = args.indexOf('--' + n); return i === -1 ? d : args[i + 1]; }
const src = path.resolve(ROOT, args[0]);
const step = Number(opt('step', 100));
const out = path.resolve(ROOT, opt('out', '.scratch/grid.png'));

const b64 = fs.readFileSync(src).toString('base64');
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setContent('<body style="margin:0">');
const data = await page.evaluate(async ({ b64, step }) => {
  const img = new Image();
  img.src = 'data:image/png;base64,' + b64;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  g.font = '16px monospace';
  g.lineWidth = 1;
  for (let x = 0; x <= c.width; x += step) {
    g.strokeStyle = x % (step * 5) === 0 ? 'rgba(255,0,0,0.9)' : 'rgba(255,0,0,0.35)';
    g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, c.height); g.stroke();
    g.fillStyle = '#ff0'; g.strokeStyle = '#000';
    g.fillText(String(x), x + 3, 18);
  }
  for (let y = 0; y <= c.height; y += step) {
    g.strokeStyle = y % (step * 5) === 0 ? 'rgba(255,0,0,0.9)' : 'rgba(255,0,0,0.35)';
    g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(c.width, y + 0.5); g.stroke();
    g.fillStyle = '#ff0';
    g.fillText(String(y), 3, y + 16);
  }
  return { url: c.toDataURL('image/png'), w: c.width, h: c.height };
}, { b64, step });
await browser.close();
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.from(data.url.split(',')[1], 'base64'));
console.log(`${data.w}x${data.h} -> ${path.relative(ROOT, out)}`);
