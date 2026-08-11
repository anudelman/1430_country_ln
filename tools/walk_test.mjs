/**
 * walk_test.mjs — exercise the interactive walkthrough controls in a real browser.
 *
 * The screenshot tools only ever place the camera by preset, so nothing else in
 * the project actually drives WASD, collision or the stair. This does:
 *
 *   1. boots app/index.html and waits for __READY__
 *   2. checks the walk rig is in tilt mode with collision and a floor sampler
 *   3. walks into a wall and asserts we do not pass through it
 *   4. teleports to the foot of the main stair, holds W, and asserts the eye
 *      rises a full storey and the level swaps to `second`
 *
 *   node tools/walk_test.mjs [--headed] [--port <n>]
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { startServer } from './serve.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const HEADED = argv.includes('--headed');
const PORT = (() => {
  const i = argv.indexOf('--port');
  return i >= 0 ? Number(argv[i + 1]) : 0;
})();

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass, detail });
  console.log(`${pass ? '  ok  ' : ' FAIL '} ${name}${detail ? '  — ' + detail : ''}`);
}

const srv = await startServer({ port: PORT });
const browser = await chromium.launch({
  headless: !HEADED,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});

let failed = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  page.on('pageerror', (e) => console.log('  [pageerror] ' + e.message));

  await page.goto(`${srv.url}/app/index.html?level=first&quality=draft`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForFunction(
    () => window.__READY__ === true || window.__BOOT_ERROR__,
    null,
    { timeout: 180000 }
  );

  const bootErr = await page.evaluate(() => window.__BOOT_ERROR__ || null);
  check('page boots without error', !bootErr, bootErr ? String(bootErr) : '');
  if (bootErr) throw new Error('boot failed');

  /* ---- 1. the rig is wired the way we intend --------------------------- */
  const rig = await page.evaluate(() => {
    const c = window.__APP__ && window.__APP__.controls;
    if (!c || !c.state) return null;
    return {
      pitchMode: c.state.pitchMode,
      hasCollide: typeof c.state.collide === 'function',
      mode: window.__APP__.state.mode,
    };
  });
  check('walk controls exist', !!rig, rig ? '' : 'window.__APP__.controls missing');
  if (rig) {
    check('mouse-look tilts rather than lens-shifts', rig.pitchMode === 'tilt', `pitchMode=${rig.pitchMode}`);
    check('collision is wired', rig.hasCollide === true);
  }

  /* ---- 2. walls actually stop you -------------------------------------- */
  const wall = await page.evaluate(() => {
    const A = window.__APP__;
    const c = A.controls;
    c.enabled = true;
    // Face a known exterior wall (the rear glass wall runs along z = 0) and
    // drive straight at it for two simulated seconds.
    c.teleport([20, 5.4, 6], [20, -40]);
    const z0 = A.camera.position.z;
    c.state.keys.fwd = true;
    for (let i = 0; i < 120; i++) c.update(1 / 60);
    c.state.keys.fwd = false;
    return { z0, z1: A.camera.position.z };
  });
  check(
    'a wall stops forward motion',
    wall.z1 > 0.4,
    `z ${wall.z0.toFixed(2)} -> ${wall.z1.toFixed(2)} (should stop short of z=0)`
  );

  /* ---- 3. the stair is walkable ----------------------------------------
   * Physics first, synchronously: `controls.update` is pure maths and runs in
   * microseconds. The level swap it triggers is an async scene rebuild that
   * takes tens of seconds, so that is polled separately rather than awaited
   * inside the same evaluate — driving both from one loop starves the rebuild. */
  const stair = await page.evaluate(() => {
    const A = window.__APP__;
    const c = A.controls;
    const S = A.dims.STAIRS.firstToSecond;
    const [x0, z0, x1, z1] = S.well;
    const cx = (x0 + x1) / 2;
    const zBottom = Math.max(z0, z1);
    const zTop = Math.min(z0, z1);

    // Stand at the foot of the flight, facing up it (toward -Z).
    c.teleport([cx, 5.4, zBottom - 0.5], [cx, zTop - 10]);
    const y0 = A.camera.position.y;
    const lvl0 = A.state.level;

    c.state.keys.fwd = true;
    // 10 simulated seconds covers the 12.5 ft run at 5 ft/s with room to spare.
    for (let i = 0; i < 600; i++) c.update(1 / 60);
    c.state.keys.fwd = false;
    return { y0, y1: A.camera.position.y, lvl0, floorY: c.state.floorY };
  });
  check(
    'walking up the stair raises the eye a storey',
    stair.y1 - stair.y0 > 8.0,
    `y ${stair.y0.toFixed(2)} -> ${stair.y1.toFixed(2)} (floorY ${stair.floorY.toFixed(2)})`
  );

  let lvl1 = stair.lvl0;
  try {
    await page.waitForFunction(() => window.__APP__.state.level === 'second', null, { timeout: 180000 });
    lvl1 = 'second';
  } catch {
    lvl1 = await page.evaluate(() => window.__APP__.state.level);
  }
  check('crossing the stair swaps to the second floor', lvl1 === 'second', `${stair.lvl0} -> ${lvl1}`);

  failed = results.filter((r) => !r.pass).length;
} catch (err) {
  console.error('\nwalk_test crashed: ' + ((err && err.stack) || err));
  failed = failed || 1;
} finally {
  await browser.close();
  await srv.close();
}

console.log(`\n${results.filter((r) => r.pass).length}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
