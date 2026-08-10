/**
 * tools/render_probe.mjs — end-to-end smoke test for the render core.
 *
 * Builds a trivial but representative scene — floor, ceiling, four walls, one
 * window opening onto the procedural sky, a cube to catch a shadow, two
 * recessed cans — through the FULL stack (renderer.js + camera.js + env.js +
 * lighting.js + post.js) and writes renders/_probe.png.
 *
 *   node tools/render_probe.mjs [--out renders/_probe.png] [--width 1050]
 *                               [--height 700] [--quality high] [--no-post]
 *                               [--exposure 1.0] [--shift 0.12]
 *
 * A static server is started on an ephemeral port so the ES modules load over
 * http (file:// blocks module imports) with an import map for the bare 'three'
 * specifier — exactly the arrangement tools/serve.mjs provides in dev.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

/* ------------------------------------------------------------------ args */

const argv = process.argv.slice(2);
function arg(name, dflt) {
  const i = argv.indexOf('--' + name);
  if (i === -1) return dflt;
  const v = argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}
const OUT = path.resolve(ROOT, String(arg('out', 'renders/_probe.png')));
const WIDTH = Number(arg('width', 1050));
const HEIGHT = Number(arg('height', 700));
const QUALITY = String(arg('quality', 'high'));
const EXPOSURE = Number(arg('exposure', 1.0));
const SHIFT = Number(arg("shift", -0.06));
const USE_POST = argv.indexOf('--no-post') === -1;
const FOV = Number(arg('fov', 70));
/** Comma list of light groups to enable: env,sun,fill,cans,pendant,window */
const LIGHTS = String(arg('lights', 'env,sun,fill,cans,pendant,window'))
  .split(',')
  .map((s2) => s2.trim())
  .filter(Boolean);

/* ---------------------------------------------------------------- server */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
};

const PROBE_HTML = buildProbeHtml();

const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/' || url === '/_probe.html') {
    res.writeHead(200, { 'content-type': MIME['.html'] });
    res.end(PROBE_HTML);
    return;
  }
  const file = path.join(ROOT, url);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found: ' + url);
    return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
const BASE = `http://127.0.0.1:${PORT}`;

/* --------------------------------------------------------------- browser */

const browser = await chromium.launch({
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
    '--disable-dev-shm-usage',
  ],
});

const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack || ''}`));

const t0 = Date.now();
await page.goto(`${BASE}/_probe.html`, { waitUntil: 'load', timeout: 120000 });

await page.evaluate(
  (cfg) => window.__runProbe(cfg),
  { width: WIDTH, height: HEIGHT, quality: QUALITY, exposure: EXPOSURE, shift: SHIFT, post: USE_POST, fov: FOV, lights: LIGHTS }
);

await page.waitForFunction(() => window.__probe && window.__probe.done, null, { timeout: 240000 });
const result = await page.evaluate(() => window.__probe);

if (logs.length) console.log(logs.join('\n'));

if (!result.ok) {
  await browser.close();
  server.close();
  console.error('PROBE FAILED:', result.error);
  process.exit(1);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, Buffer.from(result.png.split(',')[1], 'base64'));

await browser.close();
server.close();

console.log(
  JSON.stringify(
    {
      out: path.relative(ROOT, OUT),
      size: [WIDTH, HEIGHT],
      quality: QUALITY,
      post: USE_POST,
      lights: LIGHTS,
      fov: FOV,
      ms: Date.now() - t0,
      stats: result.stats,
      histogram: result.histogram,
      api: result.api,
    },
    null,
    2
  )
);

/* ------------------------------------------------------------------ page */

function buildProbeHtml() {
  const importMap = JSON.stringify({
    imports: { three: '/node_modules/three/build/three.module.js' },
  });

  const body = String.raw`
<script type="module">
import * as THREE from 'three';
import { createRenderer, renderFrame, setExposure } from '/app/src/core/renderer.js';
import { makeShiftCamera, aimHorizontal, setShift } from '/app/src/core/camera.js';
import { makeSkyEnv, makeIndoorEnv, applyEnvironment } from '/app/src/core/env.js';
import {
  sunRig, windowLight, recessedCan, pendant, sconce, underCabinet, coveLight,
  fixtureBulb, bakeAmbientFill, applyLightPreset, kelvinToColor,
  lumensToIntensity, LIGHT_PRESETS,
} from '/app/src/core/lighting.js';
import {
  createComposer, setPhotoFinish, setBloom, setComposerSize, setComposerCamera,
  disposeComposer,
} from '/app/src/core/post.js';
import {
  normalizePresets, applyPreset, presetToCamera, cameraToPreset, shiftForTarget,
  fovHorizontal, focalLength35, createWalkControls,
} from '/app/src/core/camera.js';
import { setRenderSize } from '/app/src/core/renderer.js';

window.__probe = { done: false, ok: false };

window.__runProbe = async function (cfg) {
  try {
    const canvas = document.getElementById('c');
    canvas.width = cfg.width;
    canvas.height = cfg.height;

    const renderer = createRenderer({
      canvas,
      quality: cfg.quality,
      width: cfg.width,
      height: cfg.height,
      pixelRatio: 1,
      exposure: cfg.exposure,
    });

    const scene = new THREE.Scene();

    /* ---------------- room shell -------------------------------------- */
    const W = 16, D = 13, H = 8.5, T = 0.55;

    const wallMat = new THREE.MeshStandardMaterial({ color: 0xf1efeb, roughness: 0.94, metalness: 0 });
    const ceilMat = new THREE.MeshStandardMaterial({ color: 0xfbfaf8, roughness: 0.97, metalness: 0 });
    const floorMat = new THREE.MeshStandardMaterial({ color: 0xb0793f, roughness: 0.34, metalness: 0 });
    const trimMat = new THREE.MeshStandardMaterial({ color: 0xfdfdfc, roughness: 0.5, metalness: 0 });
    const boxMat = new THREE.MeshStandardMaterial({ color: 0xc9c4bb, roughness: 0.6, metalness: 0 });

    function box(w, h, d, mat, x, y, z) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      scene.add(m);
      return m;
    }

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    // A ceiling that does not cast a shadow lets the sun pour straight through
    // it — the single most common way an interior render blows out.
    const ceilSlab = new THREE.Mesh(new THREE.BoxGeometry(W + 2 * T, 0.9, D + 2 * T), ceilMat);
    ceilSlab.position.y = H + 0.45;
    ceilSlab.castShadow = true;
    scene.add(ceilSlab);

    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, D), ceilMat);
    ceil.rotation.x = Math.PI / 2;
    ceil.position.y = H - 0.001;
    ceil.receiveShadow = true;
    scene.add(ceil);

    // side + back walls (inside faces at +-W/2, -D/2)
    box(T, H, D, wallMat, -W / 2 - T / 2, H / 2, 0);
    box(T, H, D, wallMat, W / 2 + T / 2, H / 2, 0);
    box(W + 2 * T, H, T, wallMat, 0, H / 2, D / 2 + T / 2);   // behind the camera

    // far wall with a 6' x 4'4" window opening, head at 6'10"
    const winW = 6.0, winH = 4.333, winSill = 2.5, winZ = -D / 2 - T / 2;
    const sideW = (W + 2 * T - winW) / 2;
    box(sideW, H, T, wallMat, -(winW / 2 + sideW / 2), H / 2, winZ);
    box(sideW, H, T, wallMat, +(winW / 2 + sideW / 2), H / 2, winZ);
    box(winW, winSill, T, wallMat, 0, winSill / 2, winZ);
    box(winW, H - (winSill + winH), T, wallMat, 0, (winSill + winH + H) / 2, winZ);

    // window casing + stool
    box(winW + 0.6, 0.29, 0.12, trimMat, 0, winSill + winH + 0.145, winZ + T / 2 + 0.06);
    box(winW + 0.6, 0.12, 0.5, trimMat, 0, winSill - 0.06, winZ + T / 2 + 0.12);
    box(0.29, winH, 0.12, trimMat, -(winW / 2 + 0.145), winSill + winH / 2, winZ + T / 2 + 0.06);
    box(0.29, winH, 0.12, trimMat, +(winW / 2 + 0.145), winSill + winH / 2, winZ + T / 2 + 0.06);

    // baseboard: a strong vertical/horizontal reference for the blind test
    for (const [w, d, x, z] of [
      [W, 0.06, 0, -D / 2 + 0.03],
      [W, 0.06, 0, D / 2 - 0.03],
      [0.06, D, -W / 2 + 0.03, 0],
      [0.06, D, W / 2 - 0.03, 0],
    ]) box(w, 0.458, d, trimMat, x, 0.229, z);

    // the shadow catcher
    box(2, 2, 2, boxMat, 3.2, 1.0, -1.6);
    // a tall vertical near the frame edge — verticals must stay vertical
    box(0.5, H, 0.5, trimMat, -W / 2 + 0.25, H / 2, 1.0);

    /* ---------------- outside ----------------------------------------- */
    const lawn = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 400),
      new THREE.MeshStandardMaterial({ color: 0x5f7a3a, roughness: 0.95 })
    );
    lawn.rotation.x = -Math.PI / 2;
    lawn.position.set(0, -0.02, -100);
    lawn.receiveShadow = true;
    scene.add(lawn);

    const tree = new THREE.Mesh(
      new THREE.SphereGeometry(9, 24, 16),
      new THREE.MeshStandardMaterial({ color: 0x3f6030, roughness: 0.95 })
    );
    tree.position.set(-6, 12, -34);
    tree.castShadow = false;
    scene.add(tree);

    /* ---------------- environment ------------------------------------- */
    const preset = LIGHT_PRESETS.first;
    const on = (k) => cfg.lights.indexOf(k) !== -1;
    // The probe's window faces -Z, so the probe sun sits north-west of the
    // house; that is what puts a sun patch on the floor and a shadow under the
    // cube. (The house presets use the real orientation.)
    const SUN_AZ = 336, SUN_EL = 41;
    const sky = makeSkyEnv(renderer, {
      sunAzimuth: SUN_AZ,
      sunElevation: SUN_EL,
      turbidity: 2.5,
      quality: cfg.quality,
    });
    scene.add(sky.skyMesh);

    const indoor = makeIndoorEnv(renderer, {
      wallColor: 0xf1efeb,
      floorColor: 0xb0793f,
      windowDir: [0, 0, -1],
      quality: cfg.quality,
    });
    if (on('env')) applyEnvironment(scene, indoor.envTexture, { intensity: preset.env.intensity });

    /* ---------------- lights ------------------------------------------ */
    const sun = on('sun') ? sunRig(scene, Object.assign({}, preset.sun, {
      azimuth: SUN_AZ,
      elevation: SUN_EL,
      shadowBounds: [-W, -1, -D * 1.6, W, H + 4, D],
      quality: cfg.quality,
    })) : null;

    if (on('window')) windowLight(scene, {
      rect: { center: [0, winSill + winH / 2, winZ + T / 2], width: winW, height: winH },
      normal: [0, 0, 1],
      intensity: preset.window.intensity,
      color: preset.window.color,
      glow: false,
    });

    const fill = on('fill') ? bakeAmbientFill(scene, preset.fill) : null;

    if (on('cans')) for (const [cx, cz] of [[-4.4, -3.2], [4.4, -3.2], [-4.4, 2.6], [4.4, 2.6]]) {
      scene.add(recessedCan([cx, H, cz], {
        intensity: preset.can.intensity,
        temp: preset.can.temp,
        angle: preset.can.angle,
        penumbra: preset.can.penumbra,
        quality: cfg.quality,
      }));
    }
    if (on('pendant')) scene.add(pendant([0, H, 1.2], {
      drop: 2.9,
      intensity: preset.pendant.intensity,
      temp: preset.pendant.temp,
      quality: cfg.quality,
    }));

    /* ---------------- camera ------------------------------------------ */
    const camera = makeShiftCamera({
      fovV: cfg.fov,
      aspect: cfg.width / cfg.height,
      shift: cfg.shift,
    });
    aimHorizontal(camera, [0.9, 5.2, 5.4], [-0.6, -20]);
    setShift(camera, cfg.shift);
    if (fill) fill.follow(camera);

    setExposure(renderer, cfg.exposure);

    const composer = cfg.post ? createComposer(renderer, scene, camera, { quality: cfg.quality }) : null;

    // Warm up: compile, then draw the frame we keep.
    renderFrame(renderer, scene, camera, composer);
    renderer.info.autoReset = false;
    renderer.info.reset();
    renderFrame(renderer, scene, camera, composer);

    /* ---------------- exercise the rest of the public API -------------- */
    const api = {};
    {
      const probeScene = new THREE.Scene();
      probeScene.add(sconce([0, 4, -6], { normal: [0, 0, 1] }));
      probeScene.add(underCabinet({ center: [0, 4.5, -5], width: 4, depth: 1 }));
      probeScene.add(coveLight({ center: [0, 8, -5], width: 6, depth: 0.8 }));
      probeScene.add(fixtureBulb([0, 6, -4], {}));
      const rig = applyLightPreset(probeScene, 'basement', { bounds: [-10, -10, -10, 10, 10, 10] });
      api.basementPresetSun = rig.sun === null;
      rig.dispose();
      api.kelvin2900 = '#' + kelvinToColor(2900).getHexString();
      api.lumens800at50 = +lumensToIntensity(800, 50).toFixed(2);

      // cameras.json round trip
      const presets = normalizePresets({
        probe_shot: {
          photo: 'probe.png', room: 'probe',
          pos: [0.9, 5.2, 5.4], target: [-0.6, 5.2, -20],
          fovV: 70, shift: -0.06, aspect: 1.5,
        },
      });
      const c2 = presetToCamera(presets.probe_shot);
      api.presetPitch = +c2.rotation.x.toFixed(9);
      api.presetRoll = +c2.rotation.z.toFixed(9);
      api.fovH = +fovHorizontal(c2).toFixed(2);
      api.focal35 = +focalLength35(c2).toFixed(2);
      api.roundTrip = cameraToPreset(c2, { room: 'probe' });
      applyPreset(camera, presets.probe_shot, { aspect: cfg.width / cfg.height });
      api.shiftForCeiling = +shiftForTarget(camera, [0, 5.2, 0], [0, 8.5, -11]).toFixed(4);

      // rejects a tilted preset
      try {
        normalizePresets({ bad: { pos: [0, 5, 0], target: [0, 5, -1], pitch: 0.2 } });
        api.rejectsPitch = false;
      } catch (e) { api.rejectsPitch = true; }

      // walk controls
      const wc = createWalkControls(camera, canvas, { floorY: 0, eyeHeight: 5.4 });
      wc.state.keys.fwd = true;
      wc.update(0.25);
      wc.update(0.25);
      api.walked = +camera.position.z.toFixed(3) !== 5.4;
      api.walkFloor = wc.resetLevel('basement');
      api.walkEyeY = +camera.position.y.toFixed(3);
      api.walkPitch = +camera.rotation.x.toFixed(9);
      wc.dispose();

      // put the shot camera back
      applyPreset(camera, presets.probe_shot, { aspect: cfg.width / cfg.height });
      if (fill) fill.follow(camera);

      // composer knobs
      if (composer) {
        setBloom(composer, { strength: 0.25 });
        setPhotoFinish(composer, { grain: 0.016 });
        setComposerCamera(composer, camera, scene);
        setComposerSize(composer, cfg.width, cfg.height);
      }
      setRenderSize(renderer, cfg.width, cfg.height, { camera, composer });
      renderFrame(renderer, scene, camera, composer);
    }

    /* ---------------- read back + measure ----------------------------- */
    const png = renderer.domElement.toDataURL('image/png');

    const probe = document.createElement('canvas');
    probe.width = cfg.width;
    probe.height = cfg.height;
    const g = probe.getContext('2d', { willReadFrequently: true });
    g.drawImage(renderer.domElement, 0, 0);
    const data = g.getImageData(0, 0, cfg.width, cfg.height).data;

    const hist = new Array(16).fill(0);
    let sum = 0, mn = 255, mx = 0, black = 0, white = 0;
    const n = cfg.width * cfg.height;
    for (let i = 0; i < data.length; i += 4) {
      const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      sum += l;
      if (l < mn) mn = l;
      if (l > mx) mx = l;
      if (l < 3) black++;
      if (l > 252) white++;
      hist[Math.min(15, Math.floor(l / 16))]++;
    }

    window.__probe = {
      done: true,
      ok: true,
      png,
      stats: {
        meanL: +(sum / n).toFixed(2),
        minL: mn,
        maxL: mx,
        clippedBlackPct: +((100 * black) / n).toFixed(3),
        clippedWhitePct: +((100 * white) / n).toFixed(3),
        drawCalls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        programs: renderer.info.programs.length,
      },
      histogram: hist.map((v) => +((100 * v) / n).toFixed(2)),
      api,
    };
  } catch (err) {
    window.__probe = { done: true, ok: false, error: (err && err.stack) || String(err) };
  }
};
</script>
`;

  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    '<title>render probe</title>',
    '<script type="importmap">' + importMap + '</script>',
    '<style>html,body{margin:0;padding:0;background:#111;overflow:hidden}canvas{display:block}</style>',
    '</head><body><canvas id="c"></canvas>',
    body,
    '</body></html>',
  ].join('\n');
}
