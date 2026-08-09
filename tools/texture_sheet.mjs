#!/usr/bin/env node
/**
 * tools/texture_sheet.mjs — procedural texture contact sheet.
 *
 * Renders every entry of app/src/core/textures.js twice:
 *   - on a lit sphere (shows normal / roughness / metalness response)
 *   - on a flat 3 ft x 3 ft swatch viewed square-on (shows real-world scale)
 * and composites the cells with labels into renders/_textures.png.
 *
 *   node tools/texture_sheet.mjs [--quality draft|medium|high] [--only name,name]
 *
 * A tiny static server is started so the page can use an import map for the
 * bare specifier `three` (file:// blocks module fetches).
 */

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

/* --------------------------------------------------------------- args --- */
const argv = process.argv.slice(2);
function arg(flag, dflt) {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
}
const QUALITY = arg('--quality', 'draft');
const ONLY = arg('--only', '');
// --detail renders a few textures BIG (one 4 ft x 4 ft swatch per cell) so the
// grain / weave / tile scale can actually be judged against the listing photos.
const DETAIL = arg('--detail', '');
const OUT = path.join(
  ROOT, 'renders',
  DETAIL ? (arg('--out', '_textures_detail.png')) : '_textures.png'
);

/* ------------------------------------------------------------- server --- */
const MIME = {
  '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html',
  '.json': 'application/json', '.png': 'image/png', '.css': 'text/css',
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let p = decodeURIComponent(url.pathname);
    if (p === '/') p = '/__sheet.html';
    if (p === '/__sheet.html') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(PAGE);
      return;
    }
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    const buf = await fsp.readFile(file);
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  } catch (e) {
    res.writeHead(404);
    res.end(String(e && e.message));
  }
});

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>texture sheet</title>
<script type="importmap">
{"imports":{"three":"/node_modules/three/build/three.module.js"}}
</script>
<style>html,body{margin:0;background:#111}</style>
</head><body><canvas id="sheet"></canvas></body></html>`;

/* --------------------------------------------------------- browser job --- */
async function run() {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  page.on('console', (m) => console.log('  [page]', m.text()));
  page.on('pageerror', (e) => console.error('  [pageerror]', e.message));

  await page.goto(`${base}/__sheet.html`, { waitUntil: 'load' });

  const t0 = Date.now();
  const dataUrl = await page.evaluate(async ({ quality, only, detail }) => {
    const THREE = await import('three');
    const texMod = await import('/app/src/core/textures.js');
    const matMod = await import('/app/src/core/materials.js');

    const names = detail ? detail.split(',') : (only ? only.split(',') : texMod.TEXTURE_NAMES.slice());
    const mats = matMod.makeMaterials(THREE, { quality });

    /* ---- offscreen renderer for one cell ---- */
    const CW = detail ? 460 : 300, CH = detail ? 400 : 190;
    const rc = document.createElement('canvas');
    rc.width = CW; rc.height = CH;
    const renderer = new THREE.WebGLRenderer({ canvas: rc, antialias: true, alpha: false });
    renderer.setPixelRatio(1);
    renderer.setSize(CW, CH, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.82;
    THREE.ColorManagement.enabled = true;

    /* ---- procedural studio environment (gradient sky + soft window) ---- */
    function envTexture() {
      const w = 512, h = 256;
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const g = c.getContext('2d');
      const grad = g.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0.0, '#ffffff');
      grad.addColorStop(0.42, '#cfd8e2');
      grad.addColorStop(0.52, '#8d9299');
      grad.addColorStop(1.0, '#4a4640');
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
      // a bright soft "window" and a dim fill on the far side
      const win = g.createRadialGradient(w * 0.30, h * 0.34, 4, w * 0.30, h * 0.34, h * 0.42);
      win.addColorStop(0, 'rgba(255,255,255,1)');
      win.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = win; g.fillRect(0, 0, w, h);
      const fill = g.createRadialGradient(w * 0.78, h * 0.44, 4, w * 0.78, h * 0.44, h * 0.5);
      fill.addColorStop(0, 'rgba(220,225,235,0.75)');
      fill.addColorStop(1, 'rgba(220,225,235,0)');
      g.fillStyle = fill; g.fillRect(0, 0, w, h);
      const t = new THREE.CanvasTexture(c);
      t.mapping = THREE.EquirectangularReflectionMapping;
      t.colorSpace = THREE.SRGBColorSpace;
      t.needsUpdate = true;
      return t;
    }
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    const envRT = pmrem.fromEquirectangular(envTexture());
    const env = envRT.texture;

    /* ---- scene: 1 sphere + 1 flat swatch, both 3 ft-ish ---- */
    const scene = new THREE.Scene();
    scene.environment = env;
    scene.background = new THREE.Color(0x1a1a1c);

    const key = new THREE.DirectionalLight(0xfff2e0, 2.4);
    key.position.set(-3.5, 5, 4);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xdfe8ff, 0.5);
    fill.position.set(4, 2, 3);
    scene.add(fill);

    const camera = new THREE.PerspectiveCamera(detail ? 20 : 24, CW / CH, 0.1, 100);
    camera.position.set(0, 0, detail ? 13.5 : 15.5);
    camera.lookAt(0, 0, 0);

    const SWATCH_FT = detail ? 4 : 3;
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(1.5, 96, 64), null);
    const swatch = new THREE.Mesh(new THREE.PlaneGeometry(SWATCH_FT, SWATCH_FT), null);
    if (detail) {
      // one big square-on swatch: judge real-world grain / tile size directly
      swatch.position.set(0, 0, 0);
      swatch.rotation.set(0, -0.12, 0);
      scene.add(swatch);
    } else {
      sphere.position.set(-1.75, 0, 0);
      scene.add(sphere);
      swatch.position.set(1.85, 0, 0);
      swatch.rotation.set(0, -0.30, 0);
      scene.add(swatch);
    }

    /* ---- sheet canvas ---- */
    const cols = detail ? 3 : 4;
    const rows = Math.ceil(names.length / cols);
    const PAD = 8, LBL = 26;
    const sheet = document.getElementById('sheet');
    sheet.width = cols * (CW + PAD) + PAD;
    sheet.height = rows * (CH + LBL + PAD) + PAD + 34;
    const s2 = sheet.getContext('2d');
    s2.fillStyle = '#111214';
    s2.fillRect(0, 0, sheet.width, sheet.height);
    s2.fillStyle = '#f0f0f0';
    s2.font = 'bold 18px system-ui, sans-serif';
    s2.fillText(
      '1430 Country Ln — procedural texture library (' + names.length + ' textures, quality=' + quality + ')',
      PAD, 24
    );

    for (let n = 0; n < names.length; n++) {
      const name = names[n];
      const m = mats[name];
      if (!m) { console.log('missing material ' + name); continue; }

      sphere.material = m;
      swatch.material = m;
      // real-world UV scaling for the flat swatch
      matMod.applyUV(swatch, undefined, { size: [SWATCH_FT, SWATCH_FT] });
      // the sphere gets ~9.4 x 4.7 ft of surface wrapped around it
      matMod.applyUV(sphere, undefined, { size: [9.4, 4.7] });

      renderer.render(scene, camera);
      const img = new Image();
      const url = rc.toDataURL('image/png');
      await new Promise((res) => { img.onload = res; img.src = url; });

      const col = n % cols, row = (n / cols) | 0;
      const x = PAD + col * (CW + PAD);
      const y = 34 + PAD + row * (CH + LBL + PAD);
      s2.drawImage(img, x, y);
      s2.fillStyle = '#f4f4f4';
      s2.font = 'bold 13px system-ui, sans-serif';
      s2.fillText(name, x + 2, y + CH + 14);
      s2.fillStyle = '#9aa0a6';
      s2.font = '11px system-ui, sans-serif';
      const info = texMod.TEXTURE_INFO[name];
      const sf = info ? info.scaleFeet.map((v) => v.toFixed(2)).join(' x ') + ' ft/tile' : '';
      s2.fillText(sf + (detail ? '   |  swatch = ' + SWATCH_FT + ' ft square' : ''), x + 2, y + CH + 26);
    }

    return sheet.toDataURL('image/png');
  }, { quality: QUALITY, only: ONLY, detail: DETAIL });

  console.log(`  render took ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  await browser.close();
  server.close();

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log('wrote', OUT);
}

run().catch((e) => {
  console.error(e);
  server.close();
  process.exit(1);
});
