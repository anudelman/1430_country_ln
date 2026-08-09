#!/usr/bin/env node
/**
 * blind.mjs — prepare an honest blind A/B comparison for a critic sub-agent.
 *
 *   node tools/blind.mjs --piece kitchen --photo listing_photos/kitchen_view_1.png \
 *                        --render renders/kitchen_view_1.png --round 3 \
 *                        [--order A|B] [--criticdir /path/outside/repo]
 *
 * Writes:
 *   renders/blind/<piece>/A.png
 *   renders/blind/<piece>/B.png
 *   renders/blind/<piece>/key.json     <-- which letter is the render. NEVER show this to the critic.
 *
 * --order lets the CALLER (the orchestrating workflow) choose which letter is the render, so the
 * caller holds the answer key in memory and no file the critic can reach ever contains it.
 * --criticdir writes ONLY A.png and B.png to a directory outside the repo — hand the critic that
 * directory and it has nothing to peek at.
 *
 * Fairness measures (each one is a tell that would otherwise decide the test instantly):
 *   1. Both images are drawn to the SAME pixel dimensions.
 *   2. The listing-photo "N of 50" badge in the top-right is blanked out on BOTH images
 *      with an identical patch sampled from nearby pixels.
 *   3. Both are re-encoded through the same canvas pipeline, so PNG chunk layout, bit depth
 *      and metadata are identical — no forensic shortcut from the file itself.
 *   4. Both get identical light JPEG-ish requantisation so neither is "suspiciously clean".
 *   5. Order is decided by a hash of (piece, round, salt) so it varies per round and no
 *      critic can learn "the render is always B".
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) args[a.slice(2)] = process.argv[i + 1]?.startsWith('--') ? true : process.argv[++i];
}
const piece = args.piece || 'piece';
const photoPath = args.photo;
const renderPath = args.render;
const round = String(args.round ?? '1');
const salt = args.salt || 'countryln';
if (!photoPath || !renderPath) {
  console.error('usage: blind.mjs --piece <id> --photo <path> --render <path> [--round N]');
  process.exit(2);
}
for (const p of [photoPath, renderPath]) {
  if (!fs.existsSync(p)) { console.error('missing file: ' + p); process.exit(2); }
}

// FNV-1a over piece+round+salt -> stable but varying order
function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
const renderIsA = args.order
  ? String(args.order).toUpperCase() === 'A'
  : (hash(`${piece}|${round}|${salt}`) & 1) === 0;

const outDir = path.resolve('renders/blind', piece);
fs.mkdirSync(outDir, { recursive: true });

const toDataUrl = (p) => 'data:image/png;base64,' + fs.readFileSync(p).toString('base64');

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.error('[page]', m.text()); });

const result = await page.evaluate(async ({ photo, render }) => {
  const load = (src) => new Promise((res, rej) => {
    const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src;
  });
  const [pi, ri] = await Promise.all([load(photo), load(render)]);

  // Common canvas size: the listing photo's native size, capped so the critic's
  // downsampler does not do the cropping for us.
  const MAXW = 1536;
  const scale = Math.min(1, MAXW / pi.width);
  const W = Math.round(pi.width * scale);
  const H = Math.round(pi.height * scale);

  function draw(img) {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    // cover-fit so differing aspect never shows letterboxing (another tell)
    const s = Math.max(W / img.width, H / img.height);
    const dw = img.width * s, dh = img.height * s;
    g.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);

    // --- blank the "N of 50" badge zone on BOTH images, identically ---
    const bw = Math.round(W * 0.075), bh = Math.round(H * 0.045);
    const bx = W - bw - Math.round(W * 0.008), by = Math.round(H * 0.008);
    // sample a patch from just below the badge and smear it over the badge
    const patch = g.getImageData(bx, by + bh + 2, bw, Math.max(2, Math.round(bh / 3)));
    for (let y = 0; y < bh; y++) {
      const sy = y % patch.height;
      const row = g.createImageData(bw, 1);
      for (let x = 0; x < bw; x++) {
        const si = (sy * patch.width + x) * 4;
        row.data[x * 4 + 0] = patch.data[si + 0];
        row.data[x * 4 + 1] = patch.data[si + 1];
        row.data[x * 4 + 2] = patch.data[si + 2];
        row.data[x * 4 + 3] = 255;
      }
      g.putImageData(row, bx, by + y);
    }
    // light blur over the patched seam so it does not read as an edit
    g.save();
    g.filter = 'blur(6px)';
    g.drawImage(c, bx - 4, by - 4, bw + 8, bh + 8, bx - 4, by - 4, bw + 8, bh + 8);
    g.restore();
    return c;
  }

  // Identical requantisation for both: round-trip through JPEG at the same quality,
  // so sensor-noise-vs-clean-render is not decidable from compression artifacts alone.
  async function requant(c) {
    const url = c.toDataURL('image/jpeg', 0.92);
    const im = await load(url);
    const o = document.createElement('canvas');
    o.width = W; o.height = H;
    o.getContext('2d').drawImage(im, 0, 0);
    return o.toDataURL('image/png');
  }

  const [pOut, rOut] = await Promise.all([requant(draw(pi)), requant(draw(ri))]);
  return { photo: pOut, render: rOut, W, H };
}, { photo: toDataUrl(photoPath), render: toDataUrl(renderPath) });

await browser.close();

const write = (file, dataUrl) =>
  fs.writeFileSync(path.join(outDir, file), Buffer.from(dataUrl.split(',')[1], 'base64'));

write(renderIsA ? 'A.png' : 'B.png', result.render);
write(renderIsA ? 'B.png' : 'A.png', result.photo);

fs.writeFileSync(path.join(outDir, 'key.json'), JSON.stringify({
  piece, round, renderIs: renderIsA ? 'A' : 'B',
  photoSource: photoPath, renderSource: renderPath,
  size: [result.W, result.H],
}, null, 2));

// Optional critic-only drop: just the two images, no key, outside the repo.
let criticDir = null;
if (args.criticdir && args.criticdir !== true) {
  criticDir = path.resolve(String(args.criticdir));
  fs.mkdirSync(criticDir, { recursive: true });
  for (const f of ['A.png', 'B.png']) fs.copyFileSync(path.join(outDir, f), path.join(criticDir, f));
  // scrub any stale key that a previous run may have left there
  const stale = path.join(criticDir, 'key.json');
  if (fs.existsSync(stale)) fs.unlinkSync(stale);
}

console.log(JSON.stringify({
  ok: true,
  a: path.join(criticDir || outDir, 'A.png'),
  b: path.join(criticDir || outDir, 'B.png'),
  size: [result.W, result.H],
}));
