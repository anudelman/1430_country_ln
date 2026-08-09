#!/usr/bin/env node
/**
 * tools/shoot.mjs — THE screenshot harness.
 *
 * Every judged render in this project comes out of this file. It boots the real
 * walkthrough page in headless Chromium (SwiftShader), puts it into a
 * deterministic state, and reads the CANVAS back with toDataURL() so the output
 * resolution is exactly what was asked for — never a viewport screenshot, never
 * a devicePixelRatio surprise.
 *
 * ---------------------------------------------------------------------------
 * USAGE
 * ---------------------------------------------------------------------------
 *   node tools/shoot.mjs --preset kitchen_view_1
 *   node tools/shoot.mjs --preset kitchen_view_1 --out renders/kitchen_view_1.png
 *   node tools/shoot.mjs --all
 *   node tools/shoot.mjs --room kitchen
 *   node tools/shoot.mjs --preset dining_room --width 1500 --height 1000 --quality high
 *   node tools/shoot.mjs --preset family_room_1 --side-by-side
 *   node tools/shoot.mjs --preset family_room_1 --stack
 *   node tools/shoot.mjs --list
 *
 * OPTIONS
 *   --preset <id>       one camera preset from app/cameras.json
 *   --all               every preset, sequentially, in ONE browser and ONE page
 *   --room <piece>      every preset whose "room" is this piece id
 *   --level <lvl>       every preset on basement|first|second|exterior
 *   --out <path>        output PNG (single-preset runs only)
 *   --outdir <dir>      output directory for batch runs        [renders]
 *   --width  <px>       render width                           [1526]
 *   --height <px>       render height        [width / preset aspect, i.e. 1014]
 *   --native            render at the listing photo's own pixel dimensions
 *   --quality <q>       high|medium|draft|thumb                [high]
 *   --exposure <f>      override toneMappingExposure
 *   --port <n>          reuse a server already listening there, else start one
 *   --timeout <ms>      readiness timeout                      [240000]
 *   --side-by-side      also write <outdir>/sbs_<preset>.png — real photo and
 *                       render at identical size, side by side, NO labels
 *   --stack             also write <outdir>/stack_<preset>.png in RANDOMISED
 *                       A/B order, plus stack_<preset>.json recording which is
 *                       which, so a blind critic can be scored honestly
 *   --stack-dir <d>     vertical|horizontal for --stack        [vertical]
 *   --gap <px>          neutral gutter between the two images  [12]
 *   --seed <n>          fix the A/B randomisation
 *   --param k=v         extra URL parameter for app/index.html; repeatable.
 *                       e.g. --param room=kitchen  builds only that piece;
 *                            --param selftest=fail proves the failure path.
 *   --no-shot           leave the UI on (debugging only; not deterministic)
 *   --keep-open <ms>    hold the browser open after the last shot
 *   --json              print one JSON object instead of human lines
 *   --list              list preset ids and exit
 *
 * ---------------------------------------------------------------------------
 * THE READY-FLAG PROTOCOL (implemented by app/src/main.js)
 * ---------------------------------------------------------------------------
 *   window.__READY__      false -> true once the scene is built, shaders are
 *                         compiled and >= 2 frames have been drawn.
 *   window.__BOOT_ERROR__ string | null. Set on fatal boot failure.
 *   window.__WARNINGS__   string[] of non-fatal problems (missing modules).
 *   window.__APP__.capture()          -> PNG data URL, redraws first
 *   window.__APP__.shoot({preset,...})-> Promise<PNG data URL>, re-aims and,
 *                                        if needed, rebuilds the level.
 *
 * We wait for `__READY__ === true || __BOOT_ERROR__` — never __READY__ alone,
 * or a broken build hangs for the whole timeout instead of reporting.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { startServer } from './serve.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

/* ======================================================================== */
/* args                                                                      */
/* ======================================================================== */

const argv = process.argv.slice(2);

function opt(name, dflt = null) {
  const i = argv.indexOf('--' + name);
  if (i === -1) return dflt;
  const v = argv[i + 1];
  if (v === undefined || v.startsWith('--')) return true;
  return v;
}
function has(name) {
  return argv.indexOf('--' + name) !== -1;
}
function numOpt(name, dflt) {
  const v = opt(name, null);
  if (v === null || v === true) return dflt;
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}

const CFG = {
  preset: opt('preset', null),
  all: has('all'),
  room: opt('room', null),
  level: opt('level', null),
  out: opt('out', null),
  outdir: String(opt('outdir', 'renders')),
  width: numOpt('width', 1526),
  height: numOpt('height', 0),
  native: has('native'),
  quality: String(opt('quality', 'high')),
  exposure: opt('exposure', null) === null ? null : numOpt('exposure', null),
  port: numOpt('port', 0),
  timeout: numOpt('timeout', 240000),
  sbs: has('side-by-side') || has('sbs'),
  stack: has('stack'),
  stackDir: String(opt('stack-dir', 'vertical')),
  gap: numOpt('gap', 12),
  seed: opt('seed', null) === null ? null : numOpt('seed', null),
  shot: !has('no-shot'),
  keepOpen: numOpt('keep-open', 0),
  json: has('json'),
  list: has('list'),
};

/** Repeatable `--param k=v`, appended verbatim to the app URL. */
const EXTRA_PARAMS = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--param' && argv[i + 1]) {
    const eq = argv[i + 1].indexOf('=');
    if (eq > 0) EXTRA_PARAMS.push([argv[i + 1].slice(0, eq), argv[i + 1].slice(eq + 1)]);
  }
}

const LOG = [];
function say(...a) {
  const line = a.join(' ');
  LOG.push(line);
  if (!CFG.json) process.stdout.write(line + '\n');
}
function die(msg, code = 1) {
  process.stderr.write(String(msg) + '\n');
  process.exit(code);
}

/* ======================================================================== */
/* presets                                                                   */
/* ======================================================================== */

const CAMERAS_PATH = path.join(ROOT, 'app', 'cameras.json');
let CAMERAS = {};
try {
  CAMERAS = JSON.parse(fs.readFileSync(CAMERAS_PATH, 'utf8'));
} catch (err) {
  die(`cannot read app/cameras.json: ${(err && err.message) || err}`, 2);
}
for (const k of Object.keys(CAMERAS)) {
  if (k.startsWith('$') || k.startsWith('_')) delete CAMERAS[k];
}
const PRESET_IDS = Object.keys(CAMERAS);

if (CFG.list) {
  const rows = PRESET_IDS.sort().map((id) => {
    const p = CAMERAS[id];
    return `${id}\t${p.room || '-'}\t${p.level || '-'}\t${p.photo || id + '.png'}${p.estimated ? '\test' : ''}`;
  });
  process.stdout.write(rows.join('\n') + `\n${PRESET_IDS.length} presets\n`);
  process.exit(0);
}

function selectPresets() {
  if (CFG.all) return PRESET_IDS.slice().sort();
  if (CFG.room) return PRESET_IDS.filter((id) => CAMERAS[id].room === CFG.room).sort();
  if (CFG.level) return PRESET_IDS.filter((id) => CAMERAS[id].level === CFG.level).sort();
  if (CFG.preset) {
    const id = String(CFG.preset).replace(/\.png$/i, '');
    if (!CAMERAS[id]) die(`unknown preset "${CFG.preset}". Try: node tools/shoot.mjs --list`, 2);
    return [id];
  }
  die('nothing to do — pass --preset <id>, --all, --room <piece>, --level <lvl> or --list', 2);
  return [];
}

const TARGETS = selectPresets();
if (!TARGETS.length) die('no presets matched the selection', 2);
if (CFG.out && TARGETS.length > 1) die('--out takes a single --preset; use --outdir for batches', 2);

/** PNG width/height straight out of the IHDR chunk (bytes 16..24). */
function pngSize(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(24);
    fs.readSync(fd, buf, 0, 24, 0);
    if (buf.readUInt32BE(0) !== 0x89504e47) return null;
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  } finally {
    fs.closeSync(fd);
  }
}

function sizeFor(id) {
  const p = CAMERAS[id];
  const photo = path.join(ROOT, 'listing_photos', p.photo || `${id}.png`);
  if (CFG.native && fs.existsSync(photo)) {
    const s = pngSize(photo);
    if (s) return s;
  }
  const width = Math.max(2, Math.round(CFG.width));
  if (CFG.height) return { width, height: Math.max(2, Math.round(CFG.height)) };
  const aspect = Number(p.aspect) > 0 ? Number(p.aspect) : 1.505;
  return { width, height: Math.max(2, Math.round(width / aspect)) };
}

/* ======================================================================== */
/* server                                                                    */
/* ======================================================================== */

function probePort(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const req = http.request({ host, port, path: '/app/index.html', method: 'HEAD', timeout: 1200 }, (res) => {
      res.resume();
      resolve(res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

async function ensureServer() {
  if (CFG.port) {
    if (await probePort(CFG.port)) {
      return { url: `http://127.0.0.1:${CFG.port}`, port: CFG.port, close: async () => {}, reused: true };
    }
    const srv = await startServer({ port: CFG.port });
    return { url: srv.url, port: srv.port, close: () => srv.close(), reused: false };
  }
  const srv = await startServer({ port: 0 });
  return { url: srv.url, port: srv.port, close: () => srv.close(), reused: false };
}

/* ======================================================================== */
/* browser                                                                   */
/* ======================================================================== */

const CHROME_ARGS = [
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu-sandbox',
  '--hide-scrollbars',
  '--mute-audio',
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
];

function pageUrl(base, id, size) {
  const q = new URLSearchParams();
  if (id) q.set('preset', id);
  if (CFG.shot) q.set('shot', '1');
  q.set('quality', CFG.quality);
  q.set('w', String(size.width));
  q.set('h', String(size.height));
  if (CFG.exposure !== null) q.set('exposure', String(CFG.exposure));
  for (const [k, v] of EXTRA_PARAMS) q.set(k, v);
  return `${base}/app/index.html?${q.toString()}`;
}

/** Attach console/pageerror plumbing that reports into `sink`. */
function wirePage(page, sink) {
  page.on('console', (m) => {
    const t = m.type();
    if (t === 'error' || t === 'warning') sink.push(`[page ${t}] ${m.text()}`);
  });
  page.on('pageerror', (e) => sink.push(`[pageerror] ${(e && (e.stack || e.message)) || e}`));
  page.on('requestfailed', (r) => {
    const f = r.failure();
    sink.push(`[requestfailed] ${r.url()} — ${(f && f.errorText) || 'unknown'}`);
  });
  page.on('crash', () => sink.push('[page] RENDERER CRASHED'));
}

function flush(sink) {
  if (!sink.length) return;
  for (const line of sink) say('   ' + line);
  sink.length = 0;
}

/**
 * Wait for the app to reach a state we can honestly screenshot.
 * Resolves with the boot error string, or null when ready.
 */
async function waitForReady(page, timeout) {
  await page.waitForFunction(
    () => window.__READY__ === true || !!window.__BOOT_ERROR__,
    null,
    { timeout }
  );
  return page.evaluate(() => window.__BOOT_ERROR__ || null);
}

async function reportWarnings(page) {
  const warns = await page.evaluate(() => (window.__WARNINGS__ || []).slice()).catch(() => []);
  for (const w of warns) say('   [app warn] ' + w);
}

/** Repo-relative when it is inside the repo, absolute when it is not. */
function show(file) {
  const rel = path.relative(ROOT, file);
  return rel.startsWith('..') ? file : rel;
}

function writeDataUrlPng(dataUrl, file) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) {
    throw new Error('capture did not return a PNG data URL');
  }
  const buf = Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64');
  if (buf.length < 1000) throw new Error(`capture produced only ${buf.length} bytes — the canvas is empty`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buf);
  return buf.length;
}

/* ======================================================================== */
/* composition (real photo vs render) — done with a canvas in the browser    */
/* ======================================================================== */

const COMPOSE_HTML =
  '<!doctype html><meta charset="utf-8"><title>compose</title>' +
  '<style>html,body{margin:0;background:#222}</style><canvas id="k"></canvas>';

async function makeComposePage(browser) {
  const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
  await page.setContent(COMPOSE_HTML, { waitUntil: 'load' });
  return page;
}

/**
 * Draw two images at IDENTICAL size into one PNG. No text, no borders, no
 * letters — a blind comparison must give the critic nothing but the pixels.
 *
 * Every listing photo carries a grey rounded "N of 50" badge in the top-right
 * corner (PHOTOGRAPHY §1.1). Left alone it decides the test in one glance, so
 * the SAME rectangle is painted out of BOTH cells with a colour sampled from
 * each image's own neighbouring pixels — symmetric, and no new tell.
 */
async function composePair(page, aUrl, bUrl, { direction, gap }) {
  return page.evaluate(
    async ({ a, b, direction, gap }) => {
      const load = (src) =>
        new Promise((res, rej) => {
          const im = new Image();
          im.onload = () => res(im);
          im.onerror = () => rej(new Error('image decode failed'));
          im.src = src;
        });
      const [ia, ib] = await Promise.all([load(a), load(b)]);

      // Common cell: the smaller of the two, so neither image is upscaled.
      const cw = Math.min(ia.naturalWidth, ib.naturalWidth);
      const ch = Math.min(ia.naturalHeight, ib.naturalHeight);

      // Badge box in cell coordinates, with margin: x 1440..1526 / y 0..34
      // on a 1526x1014 frame, expressed as fractions so any crop works.
      const bx = Math.floor(cw * 0.9345);
      const by = 0;
      const bw = cw - bx;
      const bh = Math.max(8, Math.ceil(ch * 0.0385));

      const horiz = direction !== 'vertical';
      const c = document.getElementById('k');
      c.width = horiz ? cw * 2 + gap : cw;
      c.height = horiz ? ch : ch * 2 + gap;

      const g = c.getContext('2d', { willReadFrequently: true });
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'high';
      g.fillStyle = '#808080';
      g.fillRect(0, 0, c.width, c.height);

      const cells = horiz ? [[0, 0], [cw + gap, 0]] : [[0, 0], [0, ch + gap]];
      const imgs = [ia, ib];
      for (let i = 0; i < 2; i++) {
        const [ox, oy] = cells[i];
        g.drawImage(imgs[i], ox, oy, cw, ch);
        // Sample just under the badge, inside this image, and flood the box.
        const sx = Math.max(0, Math.min(c.width - 1, ox + bx - 8));
        const sy = Math.max(0, Math.min(c.height - 1, oy + bh + 10));
        const px = g.getImageData(sx, sy, 1, 1).data;
        g.fillStyle = `rgb(${px[0]},${px[1]},${px[2]})`;
        g.fillRect(ox + bx, oy + by, bw, bh);
      }

      return { url: c.toDataURL('image/png'), cell: [cw, ch], size: [c.width, c.height], badge: [bx, by, bw, bh] };
    },
    { a: aUrl, b: bUrl, direction, gap }
  );
}

function fileToDataUrl(file) {
  return 'data:image/png;base64,' + fs.readFileSync(file).toString('base64');
}

/* ======================================================================== */
/* main                                                                      */
/* ======================================================================== */

const t0 = Date.now();
const srv = await ensureServer();
say(`server ${srv.url}${srv.reused ? ' (reused)' : ''}`);

const browser = await chromium.launch({ args: CHROME_ARGS });
const results = [];
let failures = 0;
let composePage = null;
let page = null;
const sink = [];

const rng = (() => {
  let s = CFG.seed === null ? crypto.randomInt(1, 2 ** 31 - 1) : (CFG.seed >>> 0) || 1;
  const seed = s;
  return {
    seed,
    next() {
      // xorshift32 — reproducible from --seed, printed into every sidecar.
      s ^= s << 13; s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    },
  };
})();

try {
  for (let i = 0; i < TARGETS.length; i++) {
    const id = TARGETS[i];
    const preset = CAMERAS[id];
    const size = sizeFor(id);
    const shotStart = Date.now();
    const outFile = CFG.out
      ? path.resolve(ROOT, String(CFG.out))
      : path.resolve(ROOT, CFG.outdir, `${id}.png`);

    let dataUrl = null;
    let mode = 'navigate';

    // Fast path: the page is already up — just re-aim it. This is what makes
    // --all bearable under software GL.
    if (page && i > 0) {
      try {
        dataUrl = await page.evaluate(
          (a) => window.__APP__.shoot(a),
          { preset: id, width: size.width, height: size.height, exposure: CFG.exposure || undefined }
        );
        mode = 'reaim';
      } catch (err) {
        sink.push(`[reaim failed → reloading] ${(err && err.message) || err}`);
        dataUrl = null;
      }
    }

    if (!dataUrl) {
      if (!page) {
        page = await browser.newPage({
          viewport: { width: Math.min(size.width, 1600), height: Math.min(size.height, 1200) },
          deviceScaleFactor: 1,
        });
        wirePage(page, sink);
      }
      await page.goto(pageUrl(srv.url, id, size), { waitUntil: 'load', timeout: CFG.timeout });
      const bootError = await waitForReady(page, CFG.timeout).catch((err) => {
        throw new Error(`timed out after ${CFG.timeout} ms waiting for window.__READY__ (${(err && err.message) || err})`);
      });
      if (bootError) throw new Error('app boot failed:\n' + bootError);
      await reportWarnings(page);
      dataUrl = await page.evaluate(() => window.__APP__.capture());
      mode = 'navigate';
    }

    let bytes = 0;
    try {
      bytes = writeDataUrlPng(dataUrl, outFile);
    } catch (err) {
      throw new Error(`${id}: ${(err && err.message) || err}`);
    }

    const rec = {
      preset: id,
      room: preset.room || null,
      out: show(outFile),
      width: size.width,
      height: size.height,
      bytes,
      mode,
      ms: Date.now() - shotStart,
    };

    /* ---- blind comparison artefacts --------------------------------- */
    if (CFG.sbs || CFG.stack) {
      const photoFile = path.resolve(ROOT, 'listing_photos', preset.photo || `${id}.png`);
      if (!fs.existsSync(photoFile)) {
        sink.push(`[compare skipped] no listing photo at ${show(photoFile)}`);
      } else {
        if (!composePage) composePage = await makeComposePage(browser);
        const photoUrl = fileToDataUrl(photoFile);
        const renderUrl = fileToDataUrl(outFile);

        if (CFG.sbs) {
          const c = await composePair(composePage, photoUrl, renderUrl, { direction: 'horizontal', gap: CFG.gap });
          const f = path.resolve(ROOT, CFG.outdir, `sbs_${id}.png`);
          writeDataUrlPng(c.url, f);
          rec.sbs = show(f);
        }

        if (CFG.stack) {
          const renderFirst = rng.next() < 0.5;
          const first = renderFirst ? renderUrl : photoUrl;
          const second = renderFirst ? photoUrl : renderUrl;
          const c = await composePair(composePage, first, second, { direction: CFG.stackDir, gap: CFG.gap });
          const f = path.resolve(ROOT, CFG.outdir, `stack_${id}.png`);
          writeDataUrlPng(c.url, f);
          const key = {
            preset: id,
            image: show(f),
            direction: CFG.stackDir,
            A: renderFirst ? 'render' : 'photo',
            B: renderFirst ? 'photo' : 'render',
            APosition: CFG.stackDir === 'vertical' ? 'top' : 'left',
            BPosition: CFG.stackDir === 'vertical' ? 'bottom' : 'right',
            render: show(outFile),
            photo: show(photoFile),
            cell: c.cell,
            seed: rng.seed,
            created: new Date().toISOString(),
            warning: 'ANSWER KEY — never show this file to the critic.',
          };
          const kf = path.resolve(ROOT, CFG.outdir, `stack_${id}.json`);
          await fsp.mkdir(path.dirname(kf), { recursive: true });
          await fsp.writeFile(kf, JSON.stringify(key, null, 2) + '\n');
          rec.stack = show(f);
          rec.stackKey = show(kf);
        }
      }
    }

    results.push(rec);
    say(
      `${String(i + 1).padStart(String(TARGETS.length).length)}/${TARGETS.length} ` +
      `${rec.out}  ${rec.width}x${rec.height}  ${(rec.bytes / 1024).toFixed(0)} KB  ` +
      `${rec.ms} ms  (${rec.mode})` +
      (rec.sbs ? `  +${rec.sbs}` : '') +
      (rec.stack ? `  +${rec.stack}` : '')
    );
    flush(sink);
  }
} catch (err) {
  failures++;
  flush(sink);
  process.stderr.write('SHOOT FAILED: ' + ((err && err.stack) || err) + '\n');
} finally {
  if (CFG.keepOpen > 0) await new Promise((r) => setTimeout(r, CFG.keepOpen));
  await browser.close().catch(() => {});
  await srv.close().catch(() => {});
}

const totalMs = Date.now() - t0;
if (CFG.json) {
  process.stdout.write(JSON.stringify({ ok: failures === 0, results, totalMs, seed: rng.seed, log: LOG }, null, 2) + '\n');
} else {
  say(`${results.length}/${TARGETS.length} rendered in ${totalMs} ms`);
}
process.exit(failures === 0 && results.length === TARGETS.length ? 0 : 1);
