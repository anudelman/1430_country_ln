#!/usr/bin/env node
/**
 * tools/kit_sheet.mjs — component-kit contact sheet.
 *
 * Builds every factory exported by app/src/core/kit.js on a studio ground
 * plane (floor + back wall + soft env), frames each one to its own bounding
 * box, and composites the cells with labels into renders/_kit.png.
 *
 *   node tools/kit_sheet.mjs [--quality draft|medium|high] [--only a,b,c]
 *                            [--cols 5] [--cell 340x300] [--out _kit.png]
 *
 * The label carries the measured bounding size in feet-inches, so a scale bug
 * (a 9-foot toilet) is visible without looking at the picture.
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
const arg = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const QUALITY = arg('--quality', 'draft');
const ONLY = arg('--only', '');
const COLS = parseInt(arg('--cols', '5'), 10);
const CELL = arg('--cell', '340x300');
const OUT = path.join(ROOT, 'renders', arg('--out', '_kit.png'));

/* ------------------------------------------------------------- server --- */
const MIME = {
  '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html',
  '.json': 'application/json', '.png': 'image/png', '.css': 'text/css',
};
const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>kit sheet</title>
<script type="importmap">
{"imports":{"three":"/node_modules/three/build/three.module.js"}}
</script>
<style>html,body{margin:0;background:#111}</style>
</head><body><canvas id="sheet"></canvas></body></html>`;

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let p = decodeURIComponent(url.pathname);
    if (p === '/' || p === '/__sheet.html') {
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
    res.writeHead(404); res.end(String(e && e.message));
  }
});

/* ------------------------------------------------------- browser job ---- */
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
  page.on('pageerror', (e) => console.error('  [pageerror]', e.message, e.stack || ''));

  await page.goto(`${base}/__sheet.html`, { waitUntil: 'load' });

  const t0 = Date.now();
  const result = await page.evaluate(async ({ quality, only, cols, cell }) => {
    const THREE = await import('three');
    const matMod = await import('/app/src/core/materials.js');
    const kitMod = await import('/app/src/core/kit.js');
    const texMod = await import('/app/src/core/textures.js');

    const mat = matMod.makeMaterials(THREE, { quality });
    const tex = texMod.makeTextures({ quality });
    const kit = kitMod.makeKit(THREE, mat, tex);

    /* ---- the catalogue: name -> builder ------------------------------- */
    const SQ = [[-6, -3], [6, -3], [6, 3], [-6, 3]];
    const ITEMS = [
      // paths run right->left so the profiled face (the path's right-hand
      // normal) points at the camera
      ['baseboard', () => kit.baseboard([[3, 2.5], [3, -1], [-3, -1]], { shoe: true })],
      ['crownMolding', () => {
        const g = kit.crownMolding([[3, 2.5], [3, -1], [-3, -1]]);
        g.position.y = 2.5; return g;
      }],
      ['chairRail', () => {
        const g = kit.chairRail([[3, 0], [-3, 0]]); g.position.y = 0.2; return g;
      }],
      ['doorCasing', () => kit.doorCasing({ w: 2.67, h: 6.667 })],
      ['windowCasing', () => kit.windowCasing({ w: 3, h: 4 })],
      ['shakerDoorPanel', () => kit.shakerDoorPanel(1.4, 2.4)],
      ['slabDoorPanel', () => kit.slabDoorPanel(1.4, 2.4)],
      ['pull(brassBar)', () => kit.pull('brassBar', 5 / 12)],
      ['doorLeaf(sixPanel)', () => kit.doorLeaf(2.67, 6.667, { style: 'sixPanel' })],
      ['interiorDoor', () => kit.interiorDoor({ open: 0.55 })],
      ['bypassClosetDoors', () => kit.bypassClosetDoors({ w: 5 })],
      ['plantationShutters', () => kit.plantationShutters(3, 4.5, { panels: 2, divider: 0.5 })],
      ['frontDoor', () => kit.frontDoor({ sidelights: 'both' })],
      ['window(doubleHung)', () => kit.window({ w: 3, h: 4.5, type: 'doubleHung' }, {})],
      ['window(3panelCasement)', () => kit.window({ w: 6, h: 4, type: 'threePanelCasement' }, {})],
      ['window(fixed+shutters)', () => kit.window({ w: 3.5, h: 5, type: 'fixed' }, { shutters: true })],
      ['window(oval)', () => kit.window({ w: 3.5, h: 2.2, type: 'oval' }, {})],
      ['window(round)', () => kit.window({ w: 2.5, type: 'round' }, {})],
      ['slidingGlassDoor', () => kit.slidingGlassDoor({ w: 6 })],
      ['frenchDoor', () => kit.frenchDoor({ w: 5 })],
      ['garageDoor', () => kit.garageDoor({ w: 9, h: 7 })],
      ['windowWall', () => kit.windowWall({ w: 12, h: 8.5, mullions: 4 })],
      ['skylightWell', () => kit.skylightWell({ w: 3, l: 4, depth: 1.6 })],

      ['baseCabinet(shaker)', () => kit.baseCabinet({ w: 3, doors: 2, drawers: 1 })],
      ['baseCabinet(drawers)', () => kit.baseCabinet({ w: 2, doors: 0, drawers: 3 })],
      ['wallCabinet', () => kit.wallCabinet({ w: 3, h: 3.5, crown: true })],
      ['tallCabinet', () => kit.tallCabinet({ w: 3, h: 7.5 })],
      ['kitchenIsland', () => kit.kitchenIsland({ w: 6, d: 3.5 })],
      ['vanity', () => kit.vanity({ w: 4 })],
      ['openShelf', () => kit.openShelf({ w: 3, brackets: true })],
      ['rangeHoodSurround', () => kit.rangeHoodSurround({ w: 3.5, h: 3 })],
      ['counterTop(mitered)', () => kit.counterTop({ w: 5, edge: 'mitered' })],
      ['fullHeightSlabBacksplash', () => kit.fullHeightSlabBacksplash({ w: 6, h: 1.5 })],

      ['slideInGasRange', () => kit.slideInGasRange({})],
      ['dishwasher', () => kit.dishwasher({})],
      ['builtInFridge', () => kit.builtInFridge({})],
      ['microwave', () => kit.microwave({})],
      ['wallOven', () => kit.wallOven({ doors: 2 })],
      ['washer', () => kit.washer({ pedestal: true })],
      ['dryer', () => kit.dryer({})],
      ['utilitySink', () => kit.utilitySink({})],

      ['undermountSink', () => { const g = kit.undermountSink({ bowls: 2 }); g.position.y = 3; return g; }],
      ['farmhouseSink', () => { const g = kit.farmhouseSink({}); g.position.y = 3; return g; }],
      ['faucet(gooseneck)', () => kit.faucet({ style: 'gooseneck', finish: 'chrome' })],
      ['faucet(commercial)', () => kit.faucet({ style: 'commercial', finish: 'black', accent: 'brass' })],
      ['toilet', () => kit.toilet({})],
      ['pedestalSink', () => kit.pedestalSink({})],
      ['dropInJacuzziTub', () => kit.dropInJacuzziTub({ w: 6, l: 5 })],
      ['alcoveTub', () => kit.alcoveTub({})],
      ['showerPan', () => kit.showerPan({})],
      ['framelessGlassShowerDoor', () => kit.framelessGlassShowerDoor({ open: 0.5 })],
      ['cornerGlassShower', () => kit.cornerGlassShower({})],
      ['showerHead', () => kit.showerHead({})],
      ['showerValve', () => kit.showerValve({})],
      ['showerNiche', () => kit.showerNiche({})],
      ['mosaicBand', () => kit.mosaicBand({ w: 4, h: 0.5 })],

      ['recessedTrim', () => kit.recessedTrim({})],
      ['sputnikGlobeChandelier', () => kit.sputnikGlobeChandelier({})],
      ['goldDandelionBurstChandelier', () => kit.goldDandelionBurstChandelier({})],
      ['pendantBlackShadeBrassChain', () => kit.pendantBlackShadeBrassChain({})],
      ['vanityBar', () => kit.vanityBar({ lights: 3 })],
      ['flushMount', () => kit.flushMount({})],
      ['fluorescentTroffer', () => kit.fluorescentTroffer({})],

      ['straightStair', () => kit.straightStair({ rise: 4.5, width: 3.5 })],
      ['returnStair', () => kit.returnStair({ rise: 9.5 })],
      ['stairRailing(rake)', () => kit.stairRailing({ length: 8, rise: 5.4 })],
      ['stairRailing(level)', () => kit.stairRailing({ length: 8 })],
      ['newelPost', () => kit.newelPost({})],
      ['turnedOakPost', () => kit.turnedOakPost({ h: 7.49 })],
      ['dropBeam', () => kit.dropBeam({ l: 10 })],
      ['supportColumn', () => kit.supportColumn({ h: 8.5 })],
      ['gasFireplace', () => kit.gasFireplace({ w: 6, h: 8, mantel: true })],
      ['deckFrame', () => kit.deckFrame({ w: 12, d: 8 })],
      ['deckRailing', () => kit.deckRailing({ length: 10 })],
      ['stoneFirePitRing', () => kit.stoneFirePitRing({})],
      ['stackedStonePlanterWall', () => kit.stackedStonePlanterWall({ path: [[5, 3], [5, 0], [-5, 0]] })],
      ['postAndBeamWall', () => kit.postAndBeamWall({ w: 14, h: 9, bays: 4 })],

      ['sofa', () => kit.sofa({})],
      ['sectional', () => kit.sectional({})],
      ['armchair', () => kit.armchair({})],
      ['coffeeTable', () => kit.coffeeTable({})],
      ['sideTable', () => kit.sideTable({})],
      ['diningTable', () => kit.diningTable({ seats: 6 })],
      ['diningChair', () => kit.diningChair({})],
      ['bed(queen)', () => kit.bed({ size: 'queen' })],
      ['nightstand', () => kit.nightstand({})],
      ['dresser', () => kit.dresser({})],
      ['tvWallMounted', () => kit.tvWallMounted({})],
      ['areaRug', () => kit.areaRug({})],
      ['bookshelf', () => kit.bookshelf({})],
      ['barStool', () => kit.barStool({})],
      ['plantPotted', () => kit.plantPotted({})],
      ['towelBar', () => kit.towelBar({ towel: true })],
      ['artFramed', () => kit.artFramed({})],
      ['mirrorRounded', () => kit.mirrorRounded({ w: 2.5, h: 2.5 })],
      ['wallMirrorFull', () => kit.wallMirrorFull({})],
      ['gymBench', () => kit.gymBench({})],
      ['dumbbellRack', () => kit.dumbbellRack({})],
      ['treadmill', () => kit.treadmill({})],
      ['foosballTable', () => kit.foosballTable({})],
      ['shuffleboardTable', () => kit.shuffleboardTable({})],
    ];
    void SQ;

    const wanted = only ? only.split(',').map((s) => s.trim()) : null;
    const list = wanted ? ITEMS.filter((it) => wanted.some((w) => it[0].includes(w))) : ITEMS;

    /* ---- renderer ----------------------------------------------------- */
    const [CW, CH] = cell.split('x').map(Number);
    const rc = document.createElement('canvas');
    rc.width = CW; rc.height = CH;
    const renderer = new THREE.WebGLRenderer({ canvas: rc, antialias: true });
    renderer.setPixelRatio(1);
    renderer.setSize(CW, CH, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    THREE.ColorManagement.enabled = true;

    /* ---- studio environment ------------------------------------------- */
    function envTexture() {
      const w = 512, h = 256;
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const g2 = c.getContext('2d');
      const grad = g2.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0.0, '#ffffff');
      grad.addColorStop(0.45, '#d7dee6');
      grad.addColorStop(0.55, '#9aa0a6');
      grad.addColorStop(1.0, '#54514c');
      g2.fillStyle = grad; g2.fillRect(0, 0, w, h);
      const win = g2.createRadialGradient(w * 0.26, h * 0.30, 4, w * 0.26, h * 0.30, h * 0.45);
      win.addColorStop(0, 'rgba(255,255,255,1)');
      win.addColorStop(1, 'rgba(255,255,255,0)');
      g2.fillStyle = win; g2.fillRect(0, 0, w, h);
      const t = new THREE.CanvasTexture(c);
      t.mapping = THREE.EquirectangularReflectionMapping;
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    }
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    const env = pmrem.fromEquirectangular(envTexture()).texture;

    const scene = new THREE.Scene();
    scene.environment = env;
    scene.background = new THREE.Color(0x15161a);

    const key = new THREE.DirectionalLight(0xfff3e2, 2.5);
    key.position.set(-14, 22, 16);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    scene.add(key);
    scene.add(key.target);
    const fill = new THREE.DirectionalLight(0xdfe8ff, 0.55);
    fill.position.set(16, 9, 12);
    scene.add(fill);
    scene.add(new THREE.AmbientLight(0xffffff, 0.35));

    const floorM = new THREE.MeshStandardMaterial({ color: 0xbdbab4, roughness: 0.85 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), floorM);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
    const wallM = new THREE.MeshStandardMaterial({ color: 0xd3d1cb, roughness: 0.92 });
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(200, 120), wallM);
    wall.receiveShadow = true;
    scene.add(wall);

    const camera = new THREE.PerspectiveCamera(26, CW / CH, 0.05, 400);

    /* ---- sheet canvas -------------------------------------------------- */
    const rows = Math.ceil(list.length / cols);
    const PAD = 8, LBL = 30, HDR = 40;
    const sheet = document.getElementById('sheet');
    sheet.width = cols * (CW + PAD) + PAD;
    sheet.height = rows * (CH + LBL + PAD) + PAD + HDR;
    const s2 = sheet.getContext('2d');
    s2.fillStyle = '#101114';
    s2.fillRect(0, 0, sheet.width, sheet.height);
    s2.fillStyle = '#f0f0f0';
    s2.font = 'bold 19px system-ui, sans-serif';
    s2.fillText('1430 Country Ln — component kit (' + list.length + ' components, quality=' + quality + ')',
      PAD, 26);

    const ftin = (v) => {
      const a = Math.abs(v);
      let f = Math.floor(a + 1e-9);
      let i = Math.round((a - f) * 12);
      if (i === 12) { f += 1; i = 0; }
      return f + "'" + i + '"';
    };

    const bad = [];
    const bbox = new THREE.Box3();
    const sz = new THREE.Vector3();
    const ctr = new THREE.Vector3();

    for (let n = 0; n < list.length; n++) {
      const [name, make] = list[n];
      let holder = null;
      let label = '';
      try {
        const g = make();
        holder = new THREE.Group();
        holder.add(g);
        holder.updateMatrixWorld(true);
        bbox.setFromObject(holder);
        if (!isFinite(bbox.min.x) || bbox.isEmpty()) throw new Error('empty bbox');
        bbox.getSize(sz);
        bbox.getCenter(ctr);
        // stand it on the studio floor, centred on X, back against the wall
        holder.position.set(-ctr.x, -bbox.min.y, -bbox.min.z);
        holder.updateMatrixWorld(true);
        bbox.setFromObject(holder);
        bbox.getSize(sz);
        bbox.getCenter(ctr);
        label = ftin(sz.x) + ' w  x  ' + ftin(sz.y) + ' h  x  ' + ftin(sz.z) + ' d';

        wall.position.set(0, 60, -0.03);
        scene.add(holder);

        const maxDim = Math.max(sz.x, sz.y, sz.z);
        const dist = maxDim * 2.55 + 1.2;
        const dir = new THREE.Vector3(0.66, 0.45, 1).normalize();
        camera.position.copy(ctr).addScaledVector(dir, dist);
        camera.lookAt(ctr);
        camera.near = Math.max(0.02, dist * 0.02);
        camera.far = dist * 6 + 60;
        camera.updateProjectionMatrix();

        key.target.position.copy(ctr);
        key.position.copy(ctr).add(new THREE.Vector3(-maxDim * 1.6, maxDim * 2.2, maxDim * 1.9));
        key.shadow.camera.left = -maxDim * 1.6;
        key.shadow.camera.right = maxDim * 1.6;
        key.shadow.camera.top = maxDim * 1.6;
        key.shadow.camera.bottom = -maxDim * 1.6;
        key.shadow.camera.near = 0.1;
        key.shadow.camera.far = maxDim * 8 + 20;
        key.shadow.camera.updateProjectionMatrix();
        key.target.updateMatrixWorld(true);

        renderer.render(scene, camera);
        scene.remove(holder);
      } catch (e) {
        bad.push(name + ': ' + (e && e.message));
        label = 'ERROR: ' + (e && e.message);
        renderer.setClearColor(0x3a1417, 1);
        renderer.clear();
        renderer.setClearColor(0x000000, 0);
      }

      const img = new Image();
      const url = rc.toDataURL('image/png');
      await new Promise((res) => { img.onload = res; img.src = url; });
      const col = n % cols, row = (n / cols) | 0;
      const x = PAD + col * (CW + PAD);
      const y = HDR + PAD + row * (CH + LBL + PAD);
      s2.drawImage(img, x, y);
      s2.fillStyle = '#f6f6f6';
      s2.font = 'bold 13px system-ui, sans-serif';
      s2.fillText(name, x + 2, y + CH + 15);
      s2.fillStyle = label.startsWith('ERROR') ? '#ff8080' : '#98a0a8';
      s2.font = '11px system-ui, sans-serif';
      s2.fillText(label, x + 2, y + CH + 27);
    }

    return { url: sheet.toDataURL('image/png'), bad, count: list.length };
  }, { quality: QUALITY, only: ONLY, cols: COLS, cell: CELL });

  console.log(`  render took ${((Date.now() - t0) / 1000).toFixed(1)}s for ${result.count} components`);
  if (result.bad.length) {
    console.log('  FAILURES:');
    for (const b of result.bad) console.log('   -', b);
  }
  await browser.close();
  server.close();

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, Buffer.from(result.url.split(',')[1], 'base64'));
  console.log('wrote', OUT);
}

run().catch((e) => {
  console.error(e);
  server.close();
  process.exit(1);
});
