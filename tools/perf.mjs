#!/usr/bin/env node
/**
 * perf.mjs — where does a walkthrough frame actually go?
 *
 * Boots the app once and reports the numbers that decide real-time frame rate,
 * then ablates each suspect in turn (post chain, shadows, resolution) so the
 * dominant cost is measured rather than guessed.
 *
 *   node tools/perf.mjs [--level first] [--quality high] [--w 1600] [--h 900]
 *
 * IMPORTANT: this container has no GPU — Chromium falls back to SwiftShader
 * (software rasterisation). Treat the numbers accordingly:
 *
 *   TRUSTWORTHY (hardware-independent, CPU/scene-structure facts):
 *     draw calls, triangles, geometries, textures, shader programs,
 *     light and shadow-caster counts, scene build time
 *   INDICATIVE ONLY (software rasteriser, ~100x slower than a real GPU):
 *     absolute frame times. The RATIOS between ablations still say which
 *     stage dominates, but absolute FPS here means nothing about your machine.
 */

import { chromium } from 'playwright-core';
import { startServer } from './serve.mjs';

const argv = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 ? argv[i + 1] : dflt;
};

const LEVEL = opt('level', 'first');
const QUALITY = opt('quality', 'high');
const WIDTH = Number(opt('w', 1600));
const HEIGHT = Number(opt('h', 900));
const FRAMES = Number(opt('frames', 40));
// Timing ablations force glFinish() every frame, which under SwiftShader costs
// seconds per frame and tells you nothing about a real GPU anyway. The scene
// structure numbers are the hardware-independent ones worth having.
const STATS_ONLY = argv.includes('--stats-only');

const srv = await startServer({ port: 0 });
const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});

try {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
  page.on('pageerror', (e) => console.log('  [pageerror] ' + e.message.slice(0, 300)));

  const t0 = Date.now();
  await page.goto(`${srv.url}/app/index.html?level=${LEVEL}&quality=${QUALITY}`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForFunction(() => window.__READY__ === true || window.__BOOT_ERROR__, null, {
    timeout: 300000,
  });
  const bootMs = Date.now() - t0;
  const err = await page.evaluate(() => window.__BOOT_ERROR__ || null);
  if (err) throw new Error('boot failed: ' + err);

  /* ---- scene structure: exact, hardware independent -------------------- */
  const stats = await page.evaluate(() => {
    const A = window.__APP__;
    const r = A.renderer;
    const s = A.scene;

    let meshes = 0;
    let visibleMeshes = 0;
    let castShadow = 0;
    let lights = 0;
    let lightsHidden = 0;
    let shadowLights = 0;
    let skinned = 0;
    const materials = new Set();
    const geometries = new Set();
    const textures = new Set();

    s.traverse((o) => {
      if (o.isLight) {
        // Only lights three will actually upload count against the per-fragment
        // budget: an invisible light (or one under an invisible parent) is
        // skipped when the lights state is built.
        let vis = o.visible;
        for (let p = o.parent; p && vis; p = p.parent) vis = p.visible;
        if (vis) {
          lights++;
          if (o.castShadow) shadowLights++;
        } else {
          lightsHidden++;
        }
      }
      if (!o.isMesh && !o.isInstancedMesh) return;
      meshes++;
      if (o.visible) visibleMeshes++;
      if (o.castShadow) castShadow++;
      if (o.isSkinnedMesh) skinned++;
      if (o.geometry) geometries.add(o.geometry.uuid);
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m) continue;
        materials.add(m.uuid);
        for (const k of Object.keys(m)) {
          const v = m[k];
          if (v && v.isTexture) textures.add(v.uuid);
        }
      }
    });

    // renderer.info.autoReset clears the counters at the START of every
    // render call, and the composer makes several — so reading it naively
    // reports only the last fullscreen quad. Drive it manually to get the
    // true whole-frame totals, shadow passes included.
    const hadAutoReset = r.info.autoReset;
    r.info.autoReset = false;
    r.info.reset();
    r.shadowMap.needsUpdate = true;
    A.render();
    const withShadowPass = { calls: r.info.render.calls, tris: r.info.render.triangles };
    r.info.reset();
    A.render(); // second frame: shadows already resident, steady-state cost
    const steady = { calls: r.info.render.calls, tris: r.info.render.triangles };

    // Draw calls depend entirely on where you stand — the boot station is a
    // wide establishing view. Sample real interior viewpoints on this level to
    // find what a walker actually pays.
    const perView = [];
    const saveP = A.camera.position.clone();
    const saveR = A.camera.rotation.clone();
    for (const id of A.presetIds()) {
      const p = A.preset(id);
      if (!p || (p.level && p.level !== A.state.level)) continue;
      try {
        A.camera.position.set(p.pos[0], p.pos[1], p.pos[2]);
        A.camera.rotation.set(0, p.yaw !== undefined ? p.yaw : A.camera.rotation.y, 0);
        A.camera.updateMatrixWorld(true);
        r.info.reset();
        A.render();
        perView.push({ id, calls: r.info.render.calls, tris: r.info.render.triangles });
      } catch (_) { /* preset shape varies; skip what we cannot place */ }
      if (perView.length >= 12) break;
    }
    A.camera.position.copy(saveP);
    A.camera.rotation.copy(saveR);
    A.camera.updateMatrixWorld(true);
    r.info.autoReset = hadAutoReset;

    const lightTypes = {};
    s.traverse((o) => {
      if (!o.isLight) return;
      let vis = o.visible;
      for (let p = o.parent; p && vis; p = p.parent) vis = p.visible;
      if (!vis) return;
      const t = o.type || 'Light';
      lightTypes[t] = (lightTypes[t] || 0) + 1;
    });

    const info = r.info;

    const ud = A.composer && A.composer.userData;
    return {
      meshes,
      visibleMeshes,
      castShadow,
      lights,
      lightsHidden,
      shadowLights,
      skinned,
      uniqueMaterials: materials.size,
      uniqueGeometries: geometries.size,
      uniqueTextures: textures.size,
      drawCalls: steady.calls,
      triangles: steady.tris,
      drawCallsWithShadowPass: withShadowPass.calls,
      lightTypes,
      perView,
      memGeometries: info.memory.geometries,
      memTextures: info.memory.textures,
      programs: (info.programs && info.programs.length) || 0,
      pixelRatio: r.getPixelRatio(),
      drawingBuffer: [r.domElement.width, r.domElement.height],
      bloom: !!(ud && ud.bloomPass && ud.bloomPass.enabled),
      passes: A.composer ? A.composer.passes.length : 0,
      shadowAutoUpdate: r.shadowMap.autoUpdate,
      shadowEnabled: r.shadowMap.enabled,
    };
  });

  /* ---- timed ablations -------------------------------------------------
   * Each variant draws FRAMES frames back to back and reports the median, so
   * one slow frame (a shader compile, a GC) does not set the number. */
  const timings = STATS_ONLY ? [] : await page.evaluate(async (FRAMES) => {
    const A = window.__APP__;
    const r = A.renderer;

    const median = (a) => {
      const b = a.slice().sort((x, y) => x - y);
      return b[Math.floor(b.length / 2)];
    };

    async function measure(label, setup, teardown) {
      if (setup) setup();
      // Two warm-up frames so any state change has compiled/allocated.
      A.render();
      A.render();
      const samples = [];
      for (let i = 0; i < FRAMES; i++) {
        const t = performance.now();
        A.render();
        // Force the GPU pipeline to actually finish before stopping the clock;
        // otherwise we time command submission, not the work.
        r.getContext().finish();
        samples.push(performance.now() - t);
        await new Promise((res) => requestAnimationFrame(() => res()));
      }
      if (teardown) teardown();
      return { label, median: median(samples), min: Math.min(...samples), max: Math.max(...samples) };
    }

    const out = [];
    const composer = A.composer;
    const ud = composer && composer.userData;

    out.push(await measure('current (composer + shadows)', null, null));

    if (ud && ud.bloomPass) {
      out.push(await measure(
        'without bloom',
        () => { ud.bloomPass.enabled = false; },
        () => { ud.bloomPass.enabled = true; }
      ));
    }
    if (ud && ud.photoPass) {
      out.push(await measure(
        'without bloom + photo-finish',
        () => { if (ud.bloomPass) ud.bloomPass.enabled = false; ud.photoPass.enabled = false; },
        () => { if (ud.bloomPass) ud.bloomPass.enabled = true; ud.photoPass.enabled = true; }
      ));
    }

    out.push(await measure(
      'shadows off',
      () => { r.shadowMap.enabled = false; },
      () => { r.shadowMap.enabled = true; r.shadowMap.needsUpdate = true; }
    ));

    const pr = r.getPixelRatio();
    out.push(await measure(
      'pixelRatio 1.0',
      () => { r.setPixelRatio(1); A.resize(window.innerWidth, window.innerHeight); },
      () => { r.setPixelRatio(pr); A.resize(window.innerWidth, window.innerHeight); }
    ));

    return out;
  }, FRAMES);

  /* ---- how long does swapping a level actually stall the loop? --------- */
  const swap = await page.evaluate(async () => {
    const A = window.__APP__;
    const here = A.state.level;
    const there = here === 'first' ? 'second' : 'first';

    const t1 = performance.now();
    await A.setLevel(there);          // cold: this level has never been built
    const cold = performance.now() - t1;

    const t2 = performance.now();
    await A.setLevel(here);           // warm: came from the scene cache
    const back = performance.now() - t2;

    const t3 = performance.now();
    await A.setLevel(there);          // warm both ways
    const warm = performance.now() - t3;

    return { cold, back, warm };
  });

  /* ---- report ---------------------------------------------------------- */
  const n = (v) => String(v).padStart(9);
  console.log(`\n  boot ${(bootMs / 1000).toFixed(1)}s   ${WIDTH}x${HEIGHT}   quality=${QUALITY}   level=${LEVEL}`);

  console.log('\n  SCENE STRUCTURE  (exact — same on any machine)');
  console.log(`   draw calls / frame ${n(stats.drawCalls)}   (+shadow refresh: ${stats.drawCallsWithShadowPass})`);
  console.log(`   triangles          ${n(stats.triangles.toLocaleString())}`);
  console.log(`   light types        ${JSON.stringify(stats.lightTypes)}`);
  if (stats.perView && stats.perView.length) {
    const calls = stats.perView.map((v) => v.calls).sort((a, b) => a - b);
    const med = calls[Math.floor(calls.length / 2)];
    console.log(`\n  DRAW CALLS FROM REAL VIEWPOINTS (what a walker actually pays)`);
    for (const v of stats.perView) {
      console.log(`   ${v.id.padEnd(34)} ${String(v.calls).padStart(6)} calls  ${v.tris.toLocaleString().padStart(9)} tris`);
    }
    console.log(`   ${'median'.padEnd(34)} ${String(med).padStart(6)} calls`);
  }
  console.log(`   meshes (visible)   ${n(stats.meshes)} (${stats.visibleMeshes})`);
  console.log(`   shadow casters     ${n(stats.castShadow)}`);
  console.log(`   lights ACTIVE      ${n(stats.lights)} (${stats.shadowLights} shadowed, ${stats.lightsHidden} culled)`);
  console.log(`   unique materials   ${n(stats.uniqueMaterials)}`);
  console.log(`   unique geometries  ${n(stats.uniqueGeometries)}`);
  console.log(`   unique textures    ${n(stats.uniqueTextures)}`);
  console.log(`   shader programs    ${n(stats.programs)}`);
  console.log(`   post passes        ${n(stats.passes)}  bloom=${stats.bloom}`);
  console.log(`   pixelRatio         ${n(stats.pixelRatio)}  buffer ${stats.drawingBuffer.join('x')}`);
  console.log(`   shadowAutoUpdate   ${n(String(stats.shadowAutoUpdate))}`);

  if (timings.length) {
    console.log('\n  FRAME COST  (SOFTWARE rasteriser — read the RATIOS, not the ms)');
    const base = timings[0].median;
    for (const t of timings) {
      const rel = ((t.median / base) * 100).toFixed(0);
      console.log(
        `   ${t.label.padEnd(32)} ${t.median.toFixed(1).padStart(8)} ms   ${String(rel).padStart(4)}% of current`
      );
    }
  }

  console.log('\n  LEVEL SWAP STALL  (a hard freeze of the render loop)');
  console.log(`   first build (cold)   ${(swap.cold / 1000).toFixed(2)} s   paid once per level`);
  console.log(`   return (cached)      ${(swap.back / 1000).toFixed(2)} s`);
  console.log(`   again (cached)       ${(swap.warm / 1000).toFixed(2)} s`);
  console.log('');
} finally {
  await browser.close();
  await srv.close();
}
