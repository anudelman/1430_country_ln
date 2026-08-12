#!/usr/bin/env node
/**
 * export_glb.mjs — get a room OUT of the Three.js walkthrough and into a file
 * Unreal (or Blender, or anything else) can open.
 *
 * The migration blocker for this project was never the geometry maths. It is
 * that the house is ~18,300 lines of procedural JavaScript that builds meshes at
 * runtime, plus 47 procedural texture generators that are CPU pixel loops rather
 * than shaders. None of that "opens" anywhere.
 *
 * It does not have to. Three can serialise the BUILT RESULT — meshes, materials,
 * and the canvas textures encoded to PNG — into a .glb. That turns "rewrite
 * 18,000 lines" into "export a file", at least one room at a time.
 *
 *   node tools/export_glb.mjs                      # kitchen, high quality
 *   node tools/export_glb.mjs --room primary-bath
 *   node tools/export_glb.mjs --level first --room ''   # the whole floor
 *   node tools/export_glb.mjs --verify             # round-trip it back through GLTFLoader
 *
 * Units: the project works in FEET, Y-up (CONVENTIONS §1). glTF is metres, Y-up.
 * We scale by 0.3048 on the way out and leave the axis convention alone —
 * Unreal's importer does the Y-up -> Z-up swap itself, and pre-rotating here
 * would mean getting it wrong twice.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { startServer } from './serve.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const argv = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 ? argv[i + 1] : dflt;
};
const has = (name) => argv.includes('--' + name);

const ROOM = opt('room', 'kitchen');
const LEVEL = opt('level', 'first');
const QUALITY = opt('quality', 'high');
const VERIFY = has('verify') || true; // always verify; it is cheap next to the export
const OUT = path.resolve(ROOT, opt('out', `export/${ROOM || LEVEL}.glb`));
/**
 * Cap on exported texture size. The dominant export cost is PNG-encoding every
 * texture, and this project carries ~436 material clones over ~200 real images
 * (materials.js keys its clone cache on each mesh's bounding box), so the same
 * picture gets encoded many times over. Halving the edge quarters the work.
 */
const MAX_TEX = Number(opt('maxtex', 1024));
/**
 * Cull meshes sitting entirely above this height, in FEET. The first-floor
 * ceiling is 8.5 ft (dims.js CEIL), so 10 drops the second storey, which
 * shell.js builds alongside the first. Pass `--maxy none` to keep everything.
 */
const MAX_Y = opt('maxy', '10') === 'none' ? null : Number(opt('maxy', '10'));

const FEET_TO_M = 0.3048;

await fsp.mkdir(path.dirname(OUT), { recursive: true });

const srv = await startServer({ port: 0 });
const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});

try {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  page.on('pageerror', (e) => console.log('  [pageerror] ' + e.message.slice(0, 300)));
  page.on('console', (m) => {
    const t = m.text();
    if (/\[export\]/.test(t)) console.log('  ' + t.slice(0, 200));
  });

  const url = `${srv.url}/app/index.html?level=${LEVEL}&quality=${QUALITY}` +
    (ROOM ? `&room=${encodeURIComponent(ROOM)}` : '');
  console.log(`booting ${url}`);
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__READY__ === true || window.__BOOT_ERROR__, null,
    { timeout: 600000 });
  const bootErr = await page.evaluate(() => window.__BOOT_ERROR__ || null);
  if (bootErr) throw new Error('boot failed: ' + bootErr);
  console.log(`ready in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  /* ---- export inside the page ----------------------------------------- */
  const result = await page.evaluate(async ({ scale, maxTex, maxY }) => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { GLTFExporter } = await import('/app/vendor/three/exporters/GLTFExporter.js');
    const A = window.__APP__;

    // Export the house group, not the whole scene: the scene also carries the
    // sky dome and the env capture helpers, which are lighting infrastructure
    // rather than architecture and would import as a giant black sphere.
    const houseGroup = A.scene.getObjectByName('house');
    const src = houseGroup || A.scene;

    // Clone so the live scene keeps its units — the walkthrough is still
    // running in feet and must not be rescaled underneath itself.
    const root = new THREE.Group();
    root.name = 'kitchenExport';
    for (const child of src.children) root.add(child.clone(true));

    // Lights live on the scene, not inside the house group. Carry the visible
    // ones across; GLTFExporter writes them as KHR_lights_punctual.
    let lightCount = 0;
    A.scene.traverse((o) => {
      if (!o.isLight) return;
      let vis = o.visible;
      for (let p = o.parent; p && vis; p = p.parent) vis = p.visible;
      if (!vis) return;
      // Ambient/hemisphere have no glTF equivalent and import as nothing useful.
      if (o.isAmbientLight || o.isHemisphereLight) return;
      const l = o.clone();
      l.position.setFromMatrixPosition(o.matrixWorld);
      root.add(l);
      lightCount++;
    });

    root.updateMatrixWorld(true);

    /* ---- drop the storey we are not looking at ------------------------
     * shell.js `defaultLevels()` builds BOTH storeys when the level is
     * 'first', because the two-storey foyer void needs them. For a
     * single-room look test the upper floor is dead weight, so cull anything
     * that sits entirely above the first-floor ceiling. */
    if (maxY !== null) {
      const box = new THREE.Box3();
      const doomed = [];
      root.traverse((o) => {
        if (!o.isMesh && !o.isInstancedMesh) return;
        box.setFromObject(o);
        if (box.min.y > maxY) doomed.push(o);
      });
      for (const o of doomed) if (o.parent) o.parent.remove(o);
      console.log(`[export] culled ${doomed.length} meshes above y=${maxY}ft`);
    }

    /* ---- collapse the clone explosion ---------------------------------
     * materials.js keys its clone cache on each mesh's BOUNDING BOX, so this
     * scene carries ~500 materials and ~1800 Texture objects backed by only
     * ~36 real materials and ~200 real images. Exporting that verbatim writes
     * a needlessly enormous file and takes forever to serialise.
     *
     * Textures that share a source AND a UV transform are interchangeable, and
     * materials whose full parameter signature matches are too. Collapsing
     * them changes nothing visually — it just stops us shipping the same
     * picture hundreds of times. */
    const texByKey = new Map();
    function canonTexture(t) {
      if (!t || !t.isTexture) return t;
      const src = t.source ? t.source.uuid : t.uuid;
      const key = [src, t.repeat.x, t.repeat.y, t.offset.x, t.offset.y, t.rotation,
        t.colorSpace, t.flipY, t.wrapS, t.wrapT].join('|');
      const hit = texByKey.get(key);
      if (hit) return hit;
      texByKey.set(key, t);
      return t;
    }

    const MAPS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap',
      'alphaMap', 'emissiveMap', 'anisotropyMap', 'clearcoatMap',
      'clearcoatNormalMap', 'clearcoatRoughnessMap', 'sheenColorMap',
      'sheenRoughnessMap', 'specularColorMap', 'specularIntensityMap',
      'transmissionMap', 'thicknessMap', 'iridescenceMap'];

    const matByKey = new Map();
    function canonMaterial(m) {
      if (!m) return m;
      for (const k of MAPS) if (m[k]) m[k] = canonTexture(m[k]);
      const parts = [m.type, m.color && m.color.getHexString(), m.roughness, m.metalness,
        m.opacity, m.transparent, m.side, m.emissive && m.emissive.getHexString(),
        m.emissiveIntensity, m.clearcoat, m.clearcoatRoughness, m.sheen,
        m.sheenRoughness, m.transmission, m.thickness, m.ior, m.anisotropy,
        m.anisotropyRotation, m.normalScale && m.normalScale.x, m.aoMapIntensity];
      for (const k of MAPS) parts.push(m[k] ? m[k].uuid : '');
      const key = parts.join('|');
      const hit = matByKey.get(key);
      if (hit) return hit;
      matByKey.set(key, m);
      return m;
    }

    let beforeMats = new Set();
    let beforeTex = new Set();
    root.traverse((o) => {
      if (!o.isMesh && !o.isInstancedMesh) return;
      for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
        if (!m) continue;
        beforeMats.add(m.uuid);
        for (const k of MAPS) if (m[k]) beforeTex.add(m[k].uuid);
      }
    });

    root.traverse((o) => {
      if (!o.isMesh && !o.isInstancedMesh) return;
      if (Array.isArray(o.material)) o.material = o.material.map(canonMaterial);
      else o.material = canonMaterial(o.material);
    });

    const uniqueImages = new Set();
    for (const t of texByKey.values()) if (t.source) uniqueImages.add(t.source.uuid);
    console.log(`[export] deduped materials ${beforeMats.size} -> ${matByKey.size}, ` +
      `textures ${beforeTex.size} -> ${texByKey.size} ` +
      `(${uniqueImages.size} distinct images)`);

    root.scale.setScalar(scale);
    root.updateMatrixWorld(true);

    // Count what we are about to ship, so a silent truncation is visible.
    let meshes = 0;
    let tris = 0;
    const mats = new Set();
    const texes = new Set();
    root.traverse((o) => {
      if (!o.isMesh && !o.isInstancedMesh) return;
      meshes++;
      const g = o.geometry;
      if (g) {
        const n = g.index ? g.index.count : (g.attributes.position ? g.attributes.position.count : 0);
        tris += n / 3;
      }
      for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
        if (!m) continue;
        mats.add(m.uuid);
        for (const k of Object.keys(m)) if (m[k] && m[k].isTexture) texes.add(m[k].uuid);
      }
    });
    console.log(`[export] ${meshes} meshes, ${Math.round(tris)} tris, ` +
      `${mats.size} materials, ${texes.size} textures, ${lightCount} lights`);

    console.log('[export] encoding textures and serialising — this is the slow part');
    const exporter = new GLTFExporter();
    const buf = await new Promise((resolve, reject) => {
      exporter.parse(root, resolve, reject, {
        binary: true,
        onlyVisible: true,
        // The procedural CanvasTextures have to be encoded to real image bytes.
        // PNG keeps the normal/roughness maps lossless; JPEG would band them.
        embedImages: true,
        maxTextureSize: maxTex,
        includeCustomExtensions: false,
      });
    });

    // ArrayBuffer -> base64 in chunks; a single spread of a multi-MB buffer
    // blows the argument limit.
    const bytes = new Uint8Array(buf);
    let bin = '';
    const CH = 0x8000;
    for (let i = 0; i < bytes.length; i += CH) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    }
    return {
      b64: btoa(bin),
      meshes, tris: Math.round(tris),
      materials: mats.size, textures: texes.size, lights: lightCount,
    };
  }, { scale: FEET_TO_M, maxTex: MAX_TEX, maxY: MAX_Y });

  const bytes = Buffer.from(result.b64, 'base64');
  await fsp.writeFile(OUT, bytes);

  console.log(`\nwrote ${path.relative(ROOT, OUT)}  ${(bytes.length / 1048576).toFixed(2)} MB`);
  console.log(`  ${result.meshes} meshes · ${result.tris.toLocaleString()} tris · ` +
    `${result.materials} materials · ${result.textures} textures · ${result.lights} lights`);

  /* ---- round-trip verification ----------------------------------------
   * Load the file back through GLTFLoader and confirm the counts survive. A
   * .glb that writes but does not parse is the worst outcome here: you would
   * not find out until after an Unreal install. */
  if (VERIFY) {
    const ok = await page.evaluate(async (b64) => {
      const { GLTFLoader } = await import('/node_modules/three/examples/jsm/loaders/GLTFLoader.js');
      const bin = atob(b64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const loader = new GLTFLoader();
      const gltf = await new Promise((res, rej) => loader.parse(arr.buffer, '', res, rej));
      let meshes = 0, lights = 0;
      const mats = new Set();
      gltf.scene.traverse((o) => {
        if (o.isMesh) { meshes++; for (const m of (Array.isArray(o.material) ? o.material : [o.material])) if (m) mats.add(m.uuid); }
        if (o.isLight) lights++;
      });
      const box = new (await import('/node_modules/three/build/three.module.js')).Box3().setFromObject(gltf.scene);
      return {
        meshes, lights, materials: mats.size,
        sizeM: [box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z]
          .map((v) => +v.toFixed(2)),
      };
    }, result.b64);

    const sizeFt = ok.sizeM.map((v) => +(v / FEET_TO_M).toFixed(1));
    console.log(`\nround trip: ${ok.meshes} meshes, ${ok.materials} materials, ${ok.lights} lights`);
    console.log(`  bounds ${ok.sizeM.join(' x ')} m   (= ${sizeFt.join(' x ')} ft)`);
    if (ok.meshes !== result.meshes) {
      console.log(`  WARNING: mesh count changed on round trip ` +
        `(${result.meshes} -> ${ok.meshes}) — something did not serialise`);
    }
  }

  /* ---- camera list ------------------------------------------------------
   * cameras.json is the one genuinely portable asset in this project besides
   * dims.js. Emit the room's presets in metres so the Unreal comparison uses
   * the SAME viewpoints — otherwise we are comparing a nice Unreal shot with
   * our calibrated one, which proves nothing. */
  const camsPath = path.join(ROOT, 'app/cameras.json');
  const raw = JSON.parse(await fsp.readFile(camsPath, 'utf8'));
  const list = Array.isArray(raw) ? raw : (raw.presets || Object.values(raw));
  const wanted = list.filter((p) => {
    const key = `${p.photo || ''} ${p.room || ''}`.toLowerCase();
    return ROOM ? key.includes(ROOM.toLowerCase().split('-')[0]) : true;
  });
  const cams = wanted.map((p) => ({
    id: (p.photo || '').replace(/\.png$/i, ''),
    room: p.room,
    // feet -> metres, same transform the geometry got
    position_m: (p.pos || []).map((v) => +(v * FEET_TO_M).toFixed(4)),
    target_m: (p.target || []).map((v) => +(v * FEET_TO_M).toFixed(4)),
    fovV_deg: p.fovV,
    aspect: p.aspect,
    exposure: p.exposure,
    note: p.note,
  }));
  const camOut = OUT.replace(/\.glb$/, '.cameras.json');
  await fsp.writeFile(camOut, JSON.stringify(cams, null, 2));
  console.log(`\nwrote ${path.relative(ROOT, camOut)}  (${cams.length} calibrated viewpoints)`);
} finally {
  await browser.close();
  await srv.close();
}
