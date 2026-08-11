/**
 * app/src/main.js — the walkthrough application shell.
 *
 * This module owns the page: renderer, scene lifecycle, camera modes, the HUD,
 * and — most importantly — the **screenshot contract** that tools/shoot.mjs
 * depends on.
 *
 * ---------------------------------------------------------------------------
 * URL PARAMETERS
 * ---------------------------------------------------------------------------
 *   ?preset=<id>      apply the named camera preset from app/cameras.json
 *   ?shot=1           deterministic screenshot state:
 *                       - HUD and overlay removed from the page
 *                       - NO animation loop, NO pointer lock, NO controls
 *                       - pixelRatio forced to 1, canvas sized exactly
 *                       - film-grain seed frozen
 *   ?quality=high|medium|draft|thumb
 *   ?w=1526&h=1014    exact drawing-buffer size (shot mode)
 *   ?room=<piece id>  build only this piece (plus the shell)
 *   ?level=basement|first|second|exterior
 *   ?exposure=1.15    override toneMappingExposure
 *
 * ---------------------------------------------------------------------------
 * READY-FLAG PROTOCOL  (tools/shoot.mjs waits on exactly this)
 * ---------------------------------------------------------------------------
 *   window.__STATUS__      string, coarse boot phase, for humans
 *   window.__WARNINGS__    string[], non-fatal problems (missing modules etc.)
 *   window.__BOOT_ERROR__  string | null — set when boot failed FATALLY
 *   window.__READY__       false until the scene is built, textures generated,
 *                          shaders compiled and at least two frames have been
 *                          drawn from the requested camera. Then true, forever.
 *   window.__APP__         the API object below (present as soon as it exists,
 *                          which may be BEFORE __READY__).
 *
 * A harness must wait for `__READY__ === true || __BOOT_ERROR__` and then fail
 * loudly on __BOOT_ERROR__. It must never wait on __READY__ alone.
 *
 * ---------------------------------------------------------------------------
 * window.__APP__
 * ---------------------------------------------------------------------------
 *   .capture()                      -> PNG data URL of a freshly drawn frame
 *   .shoot(idOrOpts)                -> Promise<PNG data URL>; re-aims the
 *                                      camera (rebuilding the scene if the
 *                                      preset needs another level/room) and
 *                                      redraws. Used by `shoot.mjs --all` so
 *                                      one browser page serves every preset.
 *   .presetIds()                    -> string[]
 *   .preset(id)                     -> normalised preset object
 *   .size()                         -> { width, height }
 *   .resize(w, h)
 *   .setLevel(level) / .goToRoom(id) / .setMode('walk'|'orbit')
 *   .renderer .scene .camera .canvas .state
 */

import * as THREE from 'three';

/* ======================================================================== */
/* 0. Flags, params, tiny helpers                                            */
/* ======================================================================== */

const W = typeof window !== 'undefined' ? window : globalThis;

W.__STATUS__ = 'boot';
W.__WARNINGS__ = W.__WARNINGS__ || [];
W.__BOOT_ERROR__ = W.__BOOT_ERROR__ || null;
W.__READY__ = false;

const params = new URLSearchParams(location.search);
const flag = (name) => {
  const v = params.get(name);
  return v !== null && v !== '0' && v !== 'false';
};
const num = (name, dflt) => {
  const v = Number(params.get(name));
  return Number.isFinite(v) && v > 0 ? v : dflt;
};

const SHOT = flag('shot');
const QUALITY = params.get('quality') || (SHOT ? 'high' : 'medium');
const PRESET_ID = params.get('preset') || '';
const ROOM_PARAM = params.get('room') || '';
const LEVEL_PARAM = params.get('level') || '';
const EXPOSURE_PARAM = params.get('exposure') ? Number(params.get('exposure')) : null;

/** CONVENTIONS §5 / PHOTOGRAPHY §1.1: the reference render size. */
const SHOT_W = num('w', 1526);
const SHOT_H = num('h', 1014);

const dom = {
  canvas: document.getElementById('c'),
  overlay: document.getElementById('overlay'),
  status: document.getElementById('status'),
  hud: document.getElementById('hud'),
  hudHead: document.getElementById('hudHead'),
  hudToggle: document.getElementById('hudToggle'),
  levelRow: document.getElementById('levelRow'),
  roomJump: document.getElementById('roomJump'),
  presetJump: document.getElementById('presetJump'),
  modeBtn: document.getElementById('modeBtn'),
  qualityBtn: document.getElementById('qualityBtn'),
  readout: document.getElementById('readout'),
  warnBox: document.getElementById('warnBox'),
};

function setStatus(s) {
  W.__STATUS__ = s;
  if (dom.status) dom.status.textContent = s;
}

function warn(msg) {
  const text = String(msg);
  if (W.__WARNINGS__.indexOf(text) === -1) W.__WARNINGS__.push(text);
  console.warn('[app]', text);
  if (dom.warnBox) {
    dom.warnBox.hidden = false;
    dom.warnBox.textContent = W.__WARNINGS__.join('\n');
  }
}

function fatal(err) {
  const msg = (err && (err.stack || err.message)) || String(err);
  W.__BOOT_ERROR__ = msg;
  W.__STATUS__ = 'error';
  console.error('[app] FATAL', err);
  if (dom.overlay) {
    dom.overlay.classList.remove('hidden');
    dom.overlay.classList.add('error');
  }
  if (dom.status) dom.status.textContent = msg;
}

/** The finished-floor datums; mirrored so main.js boots even without dims.js. */
const FLOOR_Y = { basement: -9.0, first: 0.0, second: 9.5, exterior: 0.0 };
const CEIL_H = { basement: 7.49, first: 8.5, second: 8.0, exterior: 8.5 };
/** PHOTOGRAPHY §1.3 — screenshot tripod heights, above that level's floor. */
const SHOT_EYE = { basement: 3.9, first: 4.0, second: 4.05, exterior: 5.3 };
/** Interactive walk mode uses a normal eye height (CONVENTIONS §5). */
const WALK_EYE = 5.6;

/**
 * The judged pieces (docs/DETAILS.md §0). Room modules land in
 * app/src/rooms/<id>.js; until they exist this table still drives the HUD.
 */
const PIECES = [
  { id: 'exterior-front', title: 'Front elevation', level: 'exterior', hero: 'straight_on_view_of_house_from_street' },
  { id: 'exterior-entry', title: 'Front door / entry', level: 'exterior', hero: 'exterior_view_of_front_door' },
  { id: 'exterior-rear', title: 'Rear elevation / yard', level: 'exterior', hero: 'backyard_straight_on_view_of_house' },
  { id: 'deck-patio', title: 'Deck & patio', level: 'exterior', hero: 'backyard_patio_1' },
  { id: 'fire-pit', title: 'Fire pit', level: 'exterior', hero: 'backyard_fire_pit_1' },
  { id: 'foyer', title: 'Foyer', level: 'first', hero: 'foyer_view_of_front_door' },
  { id: 'kitchen', title: 'Kitchen', level: 'first', hero: 'kitchen_view_1' },
  { id: 'breakfast-nook', title: 'Breakfast nook', level: 'first', hero: 'kitchen_breakfast_nook' },
  { id: 'dining', title: 'Dining room', level: 'first', hero: 'dining_room' },
  { id: 'living', title: 'Living room (plan: family)', level: 'first', hero: 'view_from_kitchen_of_living_room_looking_out_to_backyard' },
  { id: 'family', title: 'Family room (plan: living)', level: 'first', hero: 'family_room_1' },
  { id: 'mudroom', title: 'Mudroom / laundry', level: 'first', hero: 'mudroom_1' },
  { id: 'bed-first', title: 'First-floor bedroom', level: 'first', hero: 'bedroom_first_floor_1' },
  { id: 'bath-first', title: 'First-floor bath', level: 'first', hero: 'bathroom_first_floor_1' },
  { id: 'upper-hall', title: 'Upper hall / stairs', level: 'second', hero: 'hallway_top_of_stairs_looking_down_at_front_door' },
  { id: 'primary-bed', title: 'Primary bedroom', level: 'second', hero: 'master_bedroom_1' },
  { id: 'primary-bath', title: 'Primary bath', level: 'second', hero: 'master_bedroom_bathroom_view_1' },
  { id: 'sunroom', title: 'Wrap-around sunroom', level: 'second', hero: 'master_bedroom_wrap-around_indoor_patio_from_bedroom_to_bathroom' },
  { id: 'bed-second', title: 'Second-floor bedrooms', level: 'second', hero: 'bedroom_second_floor_1' },
  { id: 'bath-second', title: 'Second-floor bath', level: 'second', hero: 'bathroom_second_floor_1' },
  { id: 'basement-rec', title: 'Basement rec room', level: 'basement', hero: 'basement_view_1' },
  { id: 'basement-gym', title: 'Basement gym', level: 'basement', hero: 'basement_workout_room' },
  { id: 'basement-bath', title: 'Basement bath', level: 'basement', hero: 'basement_bathroom' },
];
const PIECE_BY_ID = Object.fromEntries(PIECES.map((p) => [p.id, p]));

/* ======================================================================== */
/* 1. Optional module loading — the page must survive every missing file     */
/* ======================================================================== */

const mod = Object.create(null);

/**
 * Import a module that MIGHT not exist yet (another agent may still be writing
 * it) or might be mid-edit and broken. Never throws.
 *
 * The specifier must be a literal at each call site: tools/bundle.mjs rewrites
 * literal specifiers into blob URLs and cannot follow a variable.
 */
async function optional(name, importer, { required = false } = {}) {
  try {
    const m = await importer();
    mod[name] = m;
    return m;
  } catch (err) {
    mod[name] = null;
    const msg = `module "${name}" unavailable: ${(err && err.message) || err}`;
    if (required) throw new Error(msg);
    warn(msg);
    return null;
  }
}

async function loadModules() {
  setStatus('loading core modules…');
  await Promise.all([
    optional('renderer', () => import('./core/renderer.js')),
    optional('camera', () => import('./core/camera.js')),
    optional('env', () => import('./core/env.js')),
    optional('lighting', () => import('./core/lighting.js')),
    optional('post', () => import('./core/post.js')),
    optional('dims', () => import('./core/dims.js')),
    optional('units', () => import('./core/units.js')),
    optional('nav', () => import('./core/nav.js')),
  ]);
  // These are written later in the project; their absence is normal today.
  setStatus('loading house modules…');
  await Promise.all([
    optional('registry', () => import('./core/registry.js')),
    optional('shell', () => import('./core/shell.js')),
  ]);
}

/**
 * Materials/textures/kit are expensive; only build them when a room needs them.
 *
 * The library is built ONCE and shared by every level, so `disposeScene` must
 * never dispose one of its materials — the next level would render black.
 *
 * materials.js is LAZY: `mat.redOakFloor` builds that one material (and
 * generates only its procedural maps) on first read. So we must NOT enumerate
 * the library to find out which materials are shared — that would build all 42
 * and cost minutes. Every library material (and every applyUV clone of one)
 * carries `userData.keep = true` instead, and `disposeScene` honours that.
 */
let assetPromise = null;

function loadAssets() {
  if (!assetPromise) {
    assetPromise = (async () => {
      const out = { tex: null, mat: null, kit: null };
      const texMod = await optional('textures', () => import('./core/textures.js'));
      const matMod = await optional('materials', () => import('./core/materials.js'));
      const kitMod = await optional('kit', () => import('./core/kit.js'));
      try {
        if (texMod && typeof texMod.setTextureQuality === 'function') texMod.setTextureQuality(QUALITY);
        if (texMod && typeof texMod.makeTextures === 'function') out.tex = texMod.makeTextures({ quality: QUALITY });
        if (matMod && typeof matMod.makeMaterials === 'function') out.mat = matMod.makeMaterials(THREE, { quality: QUALITY });
        if (kitMod && typeof kitMod.makeKit === 'function') out.kit = kitMod.makeKit(THREE, out.mat, out.tex);
      } catch (err) {
        warn('asset library failed: ' + ((err && err.message) || err));
      }
      return out;
    })();
  }
  return assetPromise;
}

/* ======================================================================== */
/* 2. Camera helpers (with local fallbacks if core/camera.js is unavailable) */
/* ======================================================================== */

function makeCamera({ fovV, aspect, shift = 0 }) {
  if (mod.camera && typeof mod.camera.makeShiftCamera === 'function') {
    return mod.camera.makeShiftCamera({ fovV, aspect, shift, near: 0.08, far: 900 });
  }
  const cam = new THREE.PerspectiveCamera(fovV, aspect, 0.08, 900);
  cam.rotation.order = 'YXZ';
  cam.userData.shiftLens = { fovV, aspect, shift, shiftX: 0, near: 0.08, far: 900, zoom: 1 };
  return cam;
}

/** Aim with pitch and roll pinned to zero. CONVENTIONS §5: verticals stay vertical. */
function aim(cam, from, target) {
  if (mod.camera && typeof mod.camera.aimHorizontal === 'function') {
    return mod.camera.aimHorizontal(cam, from, target);
  }
  if (from) cam.position.set(from[0], from[1], from[2]);
  const dx = target[0] - cam.position.x;
  const dz = target[2] - cam.position.z;
  const yaw = Math.abs(dx) > 1e-9 || Math.abs(dz) > 1e-9 ? Math.atan2(-dx, -dz) : cam.rotation.y;
  cam.rotation.order = 'YXZ';
  cam.rotation.set(0, yaw, 0);
  cam.updateMatrixWorld(true);
  return yaw;
}

function applyLens(cam, { fovV, aspect, shift, shiftX }) {
  const L = cam.userData.shiftLens;
  if (L) {
    if (fovV !== undefined) L.fovV = fovV;
    if (aspect !== undefined) L.aspect = aspect;
    if (shift !== undefined) L.shift = shift;
    if (shiftX !== undefined) L.shiftX = shiftX;
  }
  if (fovV !== undefined) cam.fov = fovV;
  if (aspect !== undefined) cam.aspect = aspect;
  cam.updateProjectionMatrix();
}

/* ======================================================================== */
/* 3. Camera presets (app/cameras.json)                                      */
/* ======================================================================== */

let PRESETS = {};

async function loadPresets() {
  setStatus('loading cameras.json…');
  let raw = null;
  // Inlined by tools/bundle.mjs so dist/walkthrough.html needs no fetch.
  if (W.__CAMERAS__) {
    raw = W.__CAMERAS__;
  } else {
    try {
      const url = new URL('../cameras.json', import.meta.url).href;
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      raw = await res.json();
    } catch (err) {
      warn('cameras.json unavailable: ' + ((err && err.message) || err));
      raw = {};
    }
  }
  try {
    if (mod.camera && typeof mod.camera.normalizePresets === 'function') {
      PRESETS = mod.camera.normalizePresets(raw);
    } else {
      PRESETS = normalizePresetsLocal(raw);
    }
  } catch (err) {
    // One bad preset must not cost us every other preset.
    warn('cameras.json rejected by camera.js (' + ((err && err.message) || err) + ') — using tolerant parse');
    PRESETS = normalizePresetsLocal(raw);
  }
  // Fill in the pieces/levels the JSON did not state.
  for (const [id, p] of Object.entries(PRESETS)) {
    if (!p.room) p.room = (raw[id] && raw[id].room) || null;
    if (!p.level) p.level = (raw[id] && raw[id].level) || (p.room && PIECE_BY_ID[p.room] ? PIECE_BY_ID[p.room].level : null);
    if (!p.level) p.level = 'first';
    if (p.exposure === undefined) p.exposure = raw[id] ? raw[id].exposure ?? null : null;
    // Per-preset PhotoFinish overrides (saturation, rolloff, sharpen, lift…).
    // Interiors and exteriors are two different grades — PHOTOGRAPHY §2.4.
    if (p.post === undefined) p.post = (raw[id] && raw[id].post) || null;
  }
  return PRESETS;
}

function normalizePresetsLocal(raw) {
  const out = {};
  for (const [k, v] of Object.entries(raw || {})) {
    if (!v || typeof v !== 'object' || k.startsWith('$') || k.startsWith('_')) continue;
    if (!Array.isArray(v.pos) || !Array.isArray(v.target)) continue;
    out[k] = {
      key: k,
      photo: v.photo || `${k}.png`,
      room: v.room || null,
      level: v.level || null,
      pos: [v.pos[0], v.pos[1], v.pos[2]],
      target: [v.target[0], v.target[1], v.target[2]],
      fovV: v.fovV === undefined ? 78.5 : v.fovV,
      shift: v.shift === undefined ? 0 : v.shift,
      shiftX: v.shiftX === undefined ? 0 : v.shiftX,
      aspect: v.aspect === undefined ? 1.505 : v.aspect,
      exposure: v.exposure === undefined ? null : v.exposure,
      near: v.near === undefined ? 0.08 : v.near,
      far: v.far === undefined ? 900 : v.far,
      notes: v.note || v.notes || '',
    };
  }
  return out;
}

function findPreset(id) {
  if (!id) return null;
  if (PRESETS[id]) return PRESETS[id];
  const bare = String(id).replace(/\.(png|jpe?g)$/i, '');
  if (PRESETS[bare]) return PRESETS[bare];
  for (const p of Object.values(PRESETS)) if (p.photo === id || p.photo === bare + '.png') return p;
  return null;
}

/* ======================================================================== */
/* 4. Application state                                                      */
/* ======================================================================== */

const state = {
  quality: QUALITY,
  shot: SHOT,
  mode: SHOT ? 'shot' : 'walk',
  level: LEVEL_PARAM || 'first',
  room: ROOM_PARAM || '',
  preset: null,
  width: SHOT ? SHOT_W : Math.max(2, Math.floor(W.innerWidth)),
  height: SHOT ? SHOT_H : Math.max(2, Math.floor(W.innerHeight)),
  sceneKey: '',
  frames: 0,
};

let renderer = null;
let composer = null;
let scene = null;
let camera = null;
let controls = null;
let orbit = null;
let lightRig = null;
let skyEnv = null;
let indoorEnv = null;
let rafId = 0;
let clock = null;

/* ======================================================================== */
/* 5. Renderer + post                                                        */
/* ======================================================================== */

function buildRenderer() {
  setStatus('creating renderer…');
  const canvas = dom.canvas;
  const opts = {
    canvas,
    quality: state.quality,
    width: state.width,
    height: state.height,
    // Stills render at 1:1 and are upsampled by the shot size. Interactive
    // walking clamps to 1.5: a 2x retina buffer is 78% more pixels per frame
    // through bloom and the photo-finish pass for a difference you cannot see
    // while moving, and steady frame timing matters far more here than peak
    // sharpness. A static clamp also avoids the resize hitch and visible pop
    // that come with switching resolution on the fly.
    pixelRatio: SHOT ? 1 : Math.min(W.devicePixelRatio || 1, 1.5),
    exposure: 1.15,
    // Stills redraw shadows every frame; the interactive view refreshes them
    // only when the scene actually changes. SHOT must keep the still path.
    shadowAutoUpdate: !!SHOT,
  };
  if (mod.renderer && typeof mod.renderer.createRenderer === 'function') {
    renderer = mod.renderer.createRenderer(opts);
  } else {
    warn('core/renderer.js unavailable — using the inline fallback renderer');
    THREE.ColorManagement.enabled = true;
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setPixelRatio(opts.pixelRatio);
    renderer.setSize(state.width, state.height, false);
    renderer.userData = { quality: state.quality, updateStyle: false };
  }
  if (SHOT) {
    // Exact drawing buffer; the canvas is read back with toDataURL().
    renderer.setPixelRatio(1);
    renderer.setSize(state.width, state.height, false);
    canvas.style.width = state.width + 'px';
    canvas.style.height = state.height + 'px';
  }
}

function buildComposer() {
  disposeComposer();
  if (!mod.post || typeof mod.post.createComposer !== 'function') return;
  try {
    composer = mod.post.createComposer(renderer, scene, camera, {
      quality: state.quality,
      width: state.width,
      height: state.height,
      // Deterministic: a moving grain seed would make two shots of the same
      // camera differ, which breaks every regression comparison.
      animateGrain: !SHOT,
    });
  } catch (err) {
    composer = null;
    warn('post chain unavailable: ' + ((err && err.message) || err));
  }
}

function disposeComposer() {
  if (composer && mod.post && typeof mod.post.disposeComposer === 'function') {
    try {
      mod.post.disposeComposer(composer);
    } catch { /* already gone */ }
  }
  composer = null;
}

function drawFrame(dt = 1 / 60) {
  if (!renderer || !scene || !camera) return;
  if (mod.renderer && typeof mod.renderer.renderFrame === 'function') {
    mod.renderer.renderFrame(renderer, scene, camera, composer, dt);
  } else if (composer) {
    composer.render(dt);
  } else {
    renderer.render(scene, camera);
  }
  state.frames++;
}

function resize(width, height) {
  const w = Math.max(2, Math.floor(width));
  const h = Math.max(2, Math.floor(height));
  if (w === state.width && h === state.height) return;
  state.width = w;
  state.height = h;
  if (mod.renderer && typeof mod.renderer.setRenderSize === 'function') {
    mod.renderer.setRenderSize(renderer, w, h, { camera, composer });
  } else {
    renderer.setSize(w, h, false);
    applyLens(camera, { aspect: w / h });
    if (composer && composer.setSize) composer.setSize(w, h);
  }
  if (SHOT) {
    dom.canvas.style.width = w + 'px';
    dom.canvas.style.height = h + 'px';
  }
}

/* ======================================================================== */
/* 6. Scene construction                                                     */
/* ======================================================================== */

function disposeScene() {
  if (lightRig && typeof lightRig.dispose === 'function') {
    try { lightRig.dispose(); } catch { /* ignore */ }
  }
  lightRig = null;
  if (skyEnv && typeof skyEnv.dispose === 'function') {
    try { skyEnv.dispose(); } catch { /* ignore */ }
  }
  skyEnv = null;
  if (indoorEnv && typeof indoorEnv.dispose === 'function') {
    try { indoorEnv.dispose(); } catch { /* ignore */ }
  }
  indoorEnv = null;
  if (!scene) return;
  scene.traverse((o) => {
    if (o.geometry && typeof o.geometry.dispose === 'function') o.geometry.dispose();
    const m = o.material;
    if (!m) return;
    for (const mm of Array.isArray(m) ? m : [m]) {
      if (!mm || typeof mm.dispose !== 'function') continue;
      // Never dispose a material owned by the shared library (they and their
      // applyUV clones carry userData.keep), or one a room module marked keep.
      if (mm.userData && mm.userData.keep) continue;
      mm.dispose();
    }
  });
  if (mod.materials && typeof mod.materials.clearUVClones === 'function') {
    try { mod.materials.clearUVClones(); } catch { /* ignore */ }
  }
  scene = null;
}

/** Ask a possibly-absent module for a builder function under any plausible name. */
function pickFn(m, names) {
  if (!m) return null;
  for (const n of names) if (typeof m[n] === 'function') return m[n];
  if (typeof m.default === 'function') return m.default;
  return null;
}

function roomsForLevel(level, only) {
  const reg = mod.registry;
  let list = null;
  if (reg) {
    const get = pickFn(reg, ['roomsOnLevel', 'listRooms', 'getRooms']);
    if (get) {
      try { list = get(level); } catch { list = null; }
    }
    if (!list) {
      const table = reg.REGISTRY || reg.ROOMS || reg.rooms || reg.registry || (reg.default && typeof reg.default === 'object' ? reg.default : null);
      if (table) {
        list = Object.entries(table).map(([id, v]) => Object.assign({ id }, v));
      }
    }
  }
  if (!list) return [];
  const arr = Array.isArray(list) ? list : Object.entries(list).map(([id, v]) => Object.assign({ id }, v));
  return arr.filter((r) => {
    const id = r.id || (r.meta && r.meta.id);
    if (only) return id === only;
    const lv = r.level || (r.meta && r.meta.level) || (PIECE_BY_ID[id] && PIECE_BY_ID[id].level) || 'first';
    return lv === level;
  });
}

async function buildScene(level, only) {
  const key = `${level}|${only || '*'}|${state.quality}`;
  if (key === state.sceneKey && scene) return scene;

  disposeScene();
  setStatus(`building ${level}…`);

  scene = new THREE.Scene();
  scene.name = `level:${level}`;
  state.level = level;
  state.room = only || '';
  state.sceneKey = key;

  const isExterior = level === 'exterior';

  /* ---- sky + environment ----------------------------------------------
   * The level's LIGHT_PRESET owns the environment description (wall / floor
   * bounce colours, turbidity, intensity) as well as the analytic lights.
   * Building the env without it gave every interior a dark, brown ceiling:
   * the ceiling only ever sees the environment's floor hemisphere. */
  const lp = mod.lighting && typeof mod.lighting.lightPreset === 'function'
    ? mod.lighting.lightPreset(isExterior ? 'exterior' : level)
    : null;
  const envCfg = (lp && lp.env) || {};
  if (mod.env && typeof mod.env.makeSkyEnv === 'function') {
    try {
      skyEnv = mod.env.makeSkyEnv(renderer, {
        quality: state.quality,
        turbidity: envCfg.turbidity,
        sunAzimuth: lp && lp.sun ? lp.sun.azimuth : undefined,
        sunElevation: lp && lp.sun ? lp.sun.elevation : undefined,
        intensity: envCfg.kind === 'sky' && envCfg.intensity !== undefined ? envCfg.intensity : 1.0,
      });
      if (skyEnv.skyMesh) scene.add(skyEnv.skyMesh);
      if (isExterior || envCfg.kind === 'sky' || typeof mod.env.makeIndoorEnv !== 'function') {
        mod.env.applyEnvironment(scene, skyEnv.envTexture, { intensity: 1.0, background: false });
      } else {
        indoorEnv = mod.env.makeIndoorEnv(renderer, {
          quality: state.quality,
          wallColor: envCfg.wallColor,
          floorColor: envCfg.floorColor,
          ceilingColor: envCfg.ceilingColor,
          windowColor: envCfg.windowColor,
          windowIntensity: envCfg.windowIntensity,
          wallFactor: envCfg.wallFactor,
          floorFactor: envCfg.floorFactor,
          ceilingBoost: envCfg.ceilingBoost,
          intensity: envCfg.intensity === undefined ? 1.0 : envCfg.intensity,
        });
        mod.env.applyEnvironment(scene, indoorEnv.envTexture, { intensity: 1.0, background: false });
      }
    } catch (err) {
      warn('env.js failed: ' + ((err && err.message) || err));
      skyEnv = null;
    }
  }
  if (!skyEnv) {
    // A flat sky is still a sky: the page must not be black.
    scene.background = new THREE.Color(0x9fc0e2);
    scene.add(new THREE.HemisphereLight(0xbfd6f0, 0x6d6a5c, 1.1));
  }

  /* ---- the house ------------------------------------------------------ */
  const group = new THREE.Group();
  group.name = 'house';
  scene.add(group);

  const assets = (mod.registry || mod.shell) ? await loadAssets() : { tex: null, mat: null, kit: null };
  const ctx = {
    group,
    scene,
    renderer,
    THREE,
    mat: assets.mat,
    tex: assets.tex,
    kit: assets.kit,
    dims: mod.dims || null,
    lights: mod.lighting || null,
    quality: state.quality,
    level,
    room: only || null,
    shell: null,
    onWarn: warn,
  };

  let built = 0;

  const shellBuild = pickFn(mod.shell, ['buildShell', 'build', 'buildLevel']);
  if (shellBuild) {
    try {
      // The shell handle goes into every room's ctx: a room that wants its own
      // floor or a wall gone calls ctx.shell.hideFloor(id) / hideWall(id).
      ctx.shell = shellBuild(Object.assign({}, ctx, { group })) || null;
      built++;
    } catch (err) {
      warn('shell.js build failed: ' + ((err && err.message) || err));
    }
  }

  for (const entry of roomsForLevel(level, only)) {
    const id = entry.id || (entry.meta && entry.meta.id) || 'room';
    let build = typeof entry.build === 'function' ? entry.build : null;
    if (!build && typeof entry.load === 'function') {
      try {
        const m = await entry.load();
        build = pickFn(m, ['build']);
      } catch (err) {
        warn(`room "${id}" failed to load: ${(err && err.message) || err}`);
        continue;
      }
    }
    if (!build) continue;
    const sub = new THREE.Group();
    sub.name = `room:${id}`;
    group.add(sub);
    try {
      build(Object.assign({}, ctx, { group: sub, room: id }));
      built++;
    } catch (err) {
      warn(`room "${id}" build failed: ${(err && err.message) || err}`);
    }
  }

  if (!built) buildPlaceholder(group, level);

  /* ---- lights --------------------------------------------------------- */
  if (mod.lighting && typeof mod.lighting.applyLightPreset === 'function') {
    try {
      lightRig = mod.lighting.applyLightPreset(scene, isExterior ? 'exterior' : level, {
        quality: state.quality,
        renderer,
        // A directional light needs a finite shadow frustum. Interiors get the
        // house bounding box (dims: 0..60.7 x, 0..45.1 z) with a margin, so the
        // 2048 map is spent on the house instead of the whole site.
        bounds: isExterior ? [-140, -12, -160, 200, 60, 120] : [-14, -12, -14, 76, 30, 60],
      });
    } catch (err) {
      warn('lighting.js failed: ' + ((err && err.message) || err));
      lightRig = null;
    }
  }
  if (!lightRig) {
    const sun = new THREE.DirectionalLight(0xfff2e0, 2.4);
    sun.position.set(-42, 58, 34);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    scene.add(sun);
    scene.add(new THREE.AmbientLight(0xdfe6f0, 0.9));
  }
  if (EXPOSURE_PARAM !== null) renderer.toneMappingExposure = EXPOSURE_PARAM;

  buildComposer();
  // New geometry and new lights: the walkthrough renderer only draws shadow
  // maps when told to, so tell it.
  invalidateShadows();
  return scene;
}

/**
 * The stand-in world: ground, a horizon, and enough scale reference that walk
 * mode is legible. Replaced the moment shell.js / registry.js land.
 */
function buildPlaceholder(group, level) {
  const floorY = FLOOR_Y[level] !== undefined ? FLOOR_Y[level] : 0;

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(700, 700),
    new THREE.MeshStandardMaterial({ color: 0x5d7440, roughness: 0.96, metalness: 0 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = floorY - 0.02;
  ground.receiveShadow = true;
  ground.name = 'placeholder:ground';
  group.add(ground);

  // A 10 ft grid over the house footprint (dims.js SITE is ~60 x 45 ft).
  const grid = new THREE.GridHelper(200, 20, 0x8ea36f, 0x6b7f52);
  grid.position.y = floorY + 0.005;
  grid.material.opacity = 0.45;
  grid.material.transparent = true;
  grid.name = 'placeholder:grid';
  group.add(grid);

  // Scale references: a 6'8" door leaf, a 8'6" storey stick, a 3 ft cube.
  const white = new THREE.MeshStandardMaterial({ color: 0xf2efe9, roughness: 0.85 });
  const grey = new THREE.MeshStandardMaterial({ color: 0xb9b4aa, roughness: 0.7 });

  const door = new THREE.Mesh(new THREE.BoxGeometry(2.5, 6.667, 0.146), white);
  door.position.set(28, floorY + 6.667 / 2, 18);
  door.castShadow = door.receiveShadow = true;
  group.add(door);

  const storey = new THREE.Mesh(new THREE.BoxGeometry(0.4, CEIL_H[level] || 8.5, 0.4), grey);
  storey.position.set(32, floorY + (CEIL_H[level] || 8.5) / 2, 18);
  storey.castShadow = storey.receiveShadow = true;
  group.add(storey);

  const cube = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 3), grey);
  cube.position.set(22, floorY + 1.5, 14);
  cube.castShadow = cube.receiveShadow = true;
  group.add(cube);

  // A single wall plane so lens shift and vertical-line behaviour are visible.
  const wall = new THREE.Mesh(new THREE.BoxGeometry(24, CEIL_H[level] || 8.5, 0.55), white);
  wall.position.set(24, floorY + (CEIL_H[level] || 8.5) / 2, 2);
  wall.castShadow = wall.receiveShadow = true;
  group.add(wall);
}

/* ======================================================================== */
/* 7. Cameras, controls, modes                                               */
/* ======================================================================== */

function defaultStation(level) {
  const y = (FLOOR_Y[level] !== undefined ? FLOOR_Y[level] : 0) + (SHOT ? SHOT_EYE[level] || 4 : WALK_EYE);
  if (level === 'exterior') return { pos: [30, y, 92], target: [30, y, 0] };
  return { pos: [33, y, 40], target: [30, y, 6] };
}

function applyPresetToCamera(p) {
  state.preset = p;
  const aspect = state.width / state.height;
  if (mod.camera && typeof mod.camera.applyPreset === 'function') {
    try {
      mod.camera.applyPreset(camera, p, { aspect });
    } catch (err) {
      warn(`preset "${p.key}" rejected: ${(err && err.message) || err}`);
      applyLens(camera, { fovV: p.fovV, aspect, shift: p.shift, shiftX: p.shiftX });
      aim(camera, p.pos, p.target);
    }
  } else {
    applyLens(camera, { fovV: p.fovV, aspect, shift: p.shift, shiftX: p.shiftX });
    aim(camera, p.pos, p.target);
  }
  applyLens(camera, { aspect });
  if (p.exposure) renderer.toneMappingExposure = p.exposure;
  if (composer && mod.post && typeof mod.post.setPhotoFinish === 'function') {
    const grade = Object.assign({}, mod.post.PHOTO_DEFAULTS || {}, p.post || {});
    delete grade.exposure;   // renderer.toneMappingExposure owns that
    mod.post.setPhotoFinish(composer, grade);
  }
  if (lightRig && lightRig.fill && typeof lightRig.fill.follow === 'function') lightRig.fill.follow(camera);
  if (dom.presetJump) dom.presetJump.value = p.key;
  // Interactive: park in "preset" mode so the framing stays EXACTLY the
  // listing-photo camera (4 ft tripod, zero pitch) until the user walks away.
  if (!SHOT) {
    state.mode = 'preset';
    if (controls) controls.enabled = false;
    if (orbit) orbit.enabled = false;
    if (dom.modeBtn) {
      dom.modeBtn.textContent = 'Preset';
      dom.modeBtn.classList.add('on');
    }
  }
}

/** Leave preset framing and stand up to walking eye height, same spot. */
function resumeWalk() {
  if (SHOT || state.mode !== 'preset') return;
  const floorY = FLOOR_Y[state.level] !== undefined ? FLOOR_Y[state.level] : 0;
  camera.position.y = floorY + WALK_EYE;
  const yaw = camera.rotation.y;
  if (controls) {
    controls.enabled = true;
    if (controls.state) {
      controls.state.floorY = floorY;
      controls.state.eyeHeight = WALK_EYE;
      controls.state.yaw = yaw;
      controls.state.lensShift = 0;
      controls.state.pitch = 0;
    }
  }
  applyLens(camera, { shift: 0 });
  state.mode = 'walk';
  if (dom.modeBtn) {
    dom.modeBtn.textContent = 'Walk';
    dom.modeBtn.classList.remove('on');
  }
}

/* Navigation probes, built once from dims.js. Null when nav.js is missing,
   which just means no collision and no stairs — never a hard failure. */
let navCollide = null;
let navFloor = null;

function buildNav() {
  if (!mod.nav) return;
  try {
    navCollide = mod.nav.makeCollider({ margin: 0.05 });
    navFloor = mod.nav.makeFloorSampler();
  } catch (err) {
    warn('nav unavailable: ' + ((err && err.message) || err));
    navCollide = null;
    navFloor = null;
  }
}

function buildControls() {
  if (SHOT) return;
  if (!navCollide && !navFloor) buildNav();
  if (controls && typeof controls.dispose === 'function') controls.dispose();
  controls = null;
  if (mod.camera && typeof mod.camera.createWalkControls === 'function') {
    try {
      controls = mod.camera.createWalkControls(camera, dom.canvas, {
        floorY: FLOOR_Y[state.level] || 0,
        eyeHeight: WALK_EYE,
        speed: 5.0,
        // Tilt, never lens-shift: shifting the frustum while you walk shears
        // the image instead of turning your head. The stills keep 'shift'.
        pitchMode: 'tilt',
        collide: navCollide,
        floorSampler: navFloor,
      });
      return;
    } catch (err) {
      warn('createWalkControls failed: ' + ((err && err.message) || err));
    }
  }
  controls = makeFallbackWalk(camera, dom.canvas);
}

/** A last-resort WASD rig so the page is navigable even without camera.js. */
function makeFallbackWalk(cam, el) {
  const keys = Object.create(null);
  const st = { yaw: cam.rotation.y, floorY: FLOOR_Y[state.level] || 0, eyeHeight: WALK_EYE, enabled: true };
  const onDown = (e) => { keys[e.code] = true; };
  const onUp = (e) => { keys[e.code] = false; };
  const onMove = (e) => {
    if (document.pointerLockElement !== el) return;
    st.yaw -= (e.movementX || 0) * 0.0022;
    cam.rotation.set(0, st.yaw, 0);
  };
  const onClick = () => el.requestPointerLock && el.requestPointerLock();
  document.addEventListener('keydown', onDown);
  document.addEventListener('keyup', onUp);
  el.addEventListener('mousemove', onMove);
  el.addEventListener('click', onClick);
  return {
    state: st,
    update(dt) {
      const v = (keys.ShiftLeft || keys.ShiftRight ? 11 : 5) * Math.min(dt, 0.1);
      const f = new THREE.Vector3(-Math.sin(st.yaw), 0, -Math.cos(st.yaw));
      const s = new THREE.Vector3(Math.cos(st.yaw), 0, -Math.sin(st.yaw));
      if (keys.KeyW || keys.ArrowUp) cam.position.addScaledVector(f, v);
      if (keys.KeyS || keys.ArrowDown) cam.position.addScaledVector(f, -v);
      if (keys.KeyD || keys.ArrowRight) cam.position.addScaledVector(s, v);
      if (keys.KeyA || keys.ArrowLeft) cam.position.addScaledVector(s, -v);
      cam.position.y = st.floorY + st.eyeHeight;
      cam.rotation.order = 'YXZ';
      cam.rotation.set(0, st.yaw, 0);
    },
    resetLevel(level) {
      if (typeof level === 'string' && FLOOR_Y[level] !== undefined) st.floorY = FLOOR_Y[level];
      cam.position.y = st.floorY + st.eyeHeight;
      return st.floorY;
    },
    setLevel(level) { return this.resetLevel(level); },
    teleport(pos, lookAtXZ) {
      cam.position.set(pos[0], pos[1], pos[2]);
      st.floorY = pos[1] - st.eyeHeight;
      if (lookAtXZ) st.yaw = Math.atan2(-(lookAtXZ[0] - pos[0]), -(lookAtXZ[1] - pos[2]));
      cam.rotation.set(0, st.yaw, 0);
    },
    dispose() {
      document.removeEventListener('keydown', onDown);
      document.removeEventListener('keyup', onUp);
      el.removeEventListener('mousemove', onMove);
      el.removeEventListener('click', onClick);
    },
    get enabled() { return st.enabled; },
    set enabled(v) { st.enabled = !!v; },
  };
}

async function setMode(next) {
  if (SHOT) return state.mode;
  if (state.mode === 'preset' && next === 'walk') {
    resumeWalk();
    return state.mode;
  }
  if (next === state.mode) return state.mode;
  if (next === 'orbit') {
    if (!orbit) {
      try {
        const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
        orbit = new OrbitControls(camera, dom.canvas);
        orbit.enableDamping = true;
        orbit.dampingFactor = 0.08;
        orbit.screenSpacePanning = true;
      } catch (err) {
        warn('OrbitControls unavailable: ' + ((err && err.message) || err));
        return state.mode;
      }
    }
    if (controls) controls.enabled = false;
    if (document.exitPointerLock) document.exitPointerLock();
    const dir = camera.getWorldDirection(new THREE.Vector3());
    orbit.target.copy(camera.position).addScaledVector(dir, 12);
    orbit.enabled = true;
    orbit.update();
  } else {
    if (orbit) orbit.enabled = false;
    // Orbit tilts the camera; walking must return to a plumb, zero-pitch view.
    const dir = camera.getWorldDirection(new THREE.Vector3());
    const yaw = Math.atan2(-dir.x, -dir.z);
    camera.rotation.order = 'YXZ';
    camera.rotation.set(0, yaw, 0);
    if (controls) {
      controls.enabled = true;
      if (controls.state) controls.state.yaw = yaw;
      controls.resetLevel(state.level);
    }
  }
  state.mode = next;
  if (dom.modeBtn) {
    dom.modeBtn.textContent = next === 'orbit' ? 'Orbit' : 'Walk';
    dom.modeBtn.classList.toggle('on', next === 'orbit');
  }
  return state.mode;
}

async function setLevel(level) {
  if (FLOOR_Y[level] === undefined) return state.level;
  if (!SHOT && state.mode === 'preset') resumeWalk();
  await buildScene(level, state.room || undefined);
  const st = defaultStation(level);
  aim(camera, st.pos, st.target);
  if (controls) {
    controls.resetLevel(level);
    controls.teleport(st.pos, [st.target[0], st.target[2]]);
  }
  syncLevelButtons();
  return level;
}

function syncLevelButtons() {
  if (!dom.levelRow) return;
  for (const b of dom.levelRow.querySelectorAll('button')) {
    b.classList.toggle('on', b.dataset.level === state.level);
  }
}

async function goToRoom(pieceId) {
  const piece = PIECE_BY_ID[pieceId];
  if (!piece) return;
  const p = findPreset(piece.hero);
  if (p) {
    if ((p.level || piece.level) !== state.level) await buildScene(p.level || piece.level, state.room || undefined);
    applyPresetToCamera(p);
    syncLevelButtons();
    return;
  }
  await setLevel(piece.level);
}

/* ======================================================================== */
/* 8. HUD                                                                    */
/* ======================================================================== */

function buildHud() {
  if (SHOT || !dom.hud) return;
  dom.hud.hidden = false;
  if (dom.readout) dom.readout.hidden = false;

  for (const p of PIECES) {
    const o = document.createElement('option');
    o.value = p.id;
    o.textContent = `${p.title}`;
    dom.roomJump.appendChild(o);
  }
  const ids = Object.keys(PRESETS).sort();
  for (const id of ids) {
    const o = document.createElement('option');
    o.value = id;
    const pr = PRESETS[id];
    o.textContent = pr.room ? `${id}  ·  ${pr.room}` : id;
    dom.presetJump.appendChild(o);
  }
  if (!ids.length) {
    dom.presetJump.appendChild(Object.assign(document.createElement('option'), {
      value: '', textContent: '(cameras.json empty)',
    }));
  }

  dom.roomJump.addEventListener('change', () => {
    const v = dom.roomJump.value;
    if (v) goToRoom(v);
  });
  dom.presetJump.addEventListener('change', async () => {
    const p = findPreset(dom.presetJump.value);
    if (!p) return;
    if ((p.level || 'first') !== state.level) await buildScene(p.level || 'first', state.room || undefined);
    applyPresetToCamera(p);
    syncLevelButtons();
  });
  dom.levelRow.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-level]');
    if (b) setLevel(b.dataset.level);
  });
  dom.modeBtn.addEventListener('click', () => setMode(state.mode === 'walk' ? 'orbit' : 'walk'));
  // Any movement key leaves preset framing and stands the camera up.
  document.addEventListener('keydown', (e) => {
    if (state.mode !== 'preset') return;
    if (/^(KeyW|KeyA|KeyS|KeyD|Arrow(Up|Down|Left|Right))$/.test(e.code)) resumeWalk();
  });
  dom.qualityBtn.textContent = state.quality;
  dom.qualityBtn.addEventListener('click', () => {
    const order = ['draft', 'medium', 'high'];
    const next = order[(order.indexOf(state.quality) + 1) % order.length];
    // Quality touches the renderer, the shadow maps, the texture sizes and the
    // env resolution — a reload is the only honest way to change it.
    const u = new URL(location.href);
    u.searchParams.set('quality', next);
    location.href = u.href;
  });
  dom.hudHead.addEventListener('click', () => {
    dom.hud.classList.toggle('collapsed');
    dom.hudToggle.textContent = dom.hud.classList.contains('collapsed') ? '+' : '–';
  });
  syncLevelButtons();
}

/* ---- walking between levels ------------------------------------------
 * Only one level's geometry is in the scene at a time, so climbing the stair
 * has to swap it — but `setLevel` teleports to that level's default station,
 * which would yank you off the steps. This rebuilds around you instead,
 * preserving position, yaw and velocity so the climb is continuous. */
let crossing = false;

function checkLevelCrossing() {
  if (crossing || !controls || !controls.state || !mod.nav) return;
  const footY = controls.state.floorY;
  const want = mod.nav.levelAt(footY + 0.05);
  if (want === state.level || FLOOR_Y[want] === undefined) return;
  // Only swap once we are genuinely standing on the new level's floor, so a
  // walker pausing mid-flight does not thrash between two scenes.
  if (Math.abs(footY - FLOOR_Y[want]) > 0.35) return;

  crossing = true;
  const pos = camera.position.clone();
  const yaw = controls.state.yaw;
  const pitch = controls.state.pitch;
  buildScene(want, state.room || undefined)
    .then(() => {
      camera.position.copy(pos);
      controls.state.yaw = yaw;
      controls.state.pitch = pitch;
      controls.state.floorY = FLOOR_Y[want];
      syncLevelButtons();
      invalidateShadows();
    })
    .catch((err) => warn('level crossing failed: ' + ((err && err.message) || err)))
    .finally(() => { crossing = false; });
}

/** Refresh shadow maps once; the walkthrough renderer does not auto-update. */
function invalidateShadows() {
  if (mod.renderer && typeof mod.renderer.invalidateShadows === 'function') {
    mod.renderer.invalidateShadows(renderer);
  } else if (renderer && renderer.shadowMap) {
    renderer.shadowMap.needsUpdate = true;
  }
}

let readoutAcc = 0;
function updateReadout(dt) {
  if (!dom.readout || dom.readout.hidden) return;
  readoutAcc += dt;
  if (readoutAcc < 0.25) return;
  readoutAcc = 0;
  const p = camera.position;
  const L = camera.userData.shiftLens || {};
  dom.readout.textContent =
    `x ${p.x.toFixed(2)}  y ${p.y.toFixed(2)}  z ${p.z.toFixed(2)}   ` +
    `yaw ${((camera.rotation.y * 180) / Math.PI).toFixed(1)}°  ` +
    `fovV ${(L.fovV || camera.fov).toFixed(1)}°  shift ${(L.shift || 0).toFixed(3)}  ` +
    `${state.level}  ${state.width}x${state.height}`;
}

/* ======================================================================== */
/* 9. Loop                                                                   */
/* ======================================================================== */

function startLoop() {
  if (SHOT) return; // deterministic: draw only when asked
  clock = new THREE.Clock();
  const tick = () => {
    rafId = requestAnimationFrame(tick);
    const dt = Math.min(clock.getDelta(), 0.1);
    if (state.mode === 'walk' && controls && controls.enabled !== false) {
      controls.update(dt);
      checkLevelCrossing();
    }
    if (state.mode === 'orbit' && orbit) orbit.update();
    if (lightRig && lightRig.fill && typeof lightRig.fill.follow === 'function') lightRig.fill.follow(camera);
    drawFrame(dt);
    updateReadout(dt);
  };
  rafId = requestAnimationFrame(tick);

  W.addEventListener('resize', () => {
    resize(W.innerWidth, W.innerHeight);
  });
}

/** Draw n frames, yielding between them so shader compiles actually finish. */
async function warmUp(n = 3) {
  for (let i = 0; i < n; i++) {
    drawFrame(1 / 60);
    await new Promise((r) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => r()) : setTimeout(r, 16)));
  }
  drawFrame(1 / 60);
}

/* ======================================================================== */
/* 10. Public API                                                            */
/* ======================================================================== */

function captureDataURL() {
  drawFrame(1 / 60);
  return renderer.domElement.toDataURL('image/png');
}

async function shoot(idOrOpts) {
  const o = typeof idOrOpts === 'string' ? { preset: idOrOpts } : Object.assign({}, idOrOpts || {});
  if (o.quality && o.quality !== state.quality) {
    throw new Error(`quality is a page-level parameter (loaded "${state.quality}", asked "${o.quality}") — reload with ?quality=`);
  }
  const p = o.preset ? findPreset(o.preset) : state.preset;
  if (o.preset && !p) throw new Error(`unknown camera preset "${o.preset}"`);

  if (p) {
    const level = p.level || (p.room && PIECE_BY_ID[p.room] ? PIECE_BY_ID[p.room].level : 'first');
    const only = o.room !== undefined ? o.room : state.room || undefined;
    await buildScene(level, only);
  }
  if (o.width && o.height) resize(o.width, o.height);
  else if (p && p.aspect && SHOT) resize(state.width, Math.round(state.width / p.aspect));

  if (p) applyPresetToCamera(p);
  if (o.exposure) renderer.toneMappingExposure = o.exposure;

  await warmUp(o.warm === undefined ? 2 : o.warm);
  return renderer.domElement.toDataURL('image/png');
}

function installApi() {
  W.__APP__ = {
    version: 1,
    get renderer() { return renderer; },
    get scene() { return scene; },
    get camera() { return camera; },
    get composer() { return composer; },
    get canvas() { return dom.canvas; },
    get controls() { return controls; },
    // Handy from the console and needed by tools/walk_test.mjs to place the
    // camera at real plan coordinates rather than hard-coded numbers.
    get dims() { return mod.dims; },
    get nav() { return mod.nav; },
    state,
    pieces: PIECES,
    capture: captureDataURL,
    shoot,
    render: () => drawFrame(1 / 60),
    presetIds: () => Object.keys(PRESETS).sort(),
    preset: (id) => findPreset(id),
    presets: () => PRESETS,
    size: () => ({ width: state.width, height: state.height }),
    resize,
    setLevel,
    setMode,
    goToRoom,
    warnings: () => W.__WARNINGS__.slice(),
  };
}

/* ======================================================================== */
/* 11. Boot                                                                  */
/* ======================================================================== */

async function boot() {
  const t0 = Date.now();
  if (SHOT) document.body.classList.add('shot');

  // Harness self-test: `?selftest=fail` proves that a fatal boot is REPORTED
  // (via __BOOT_ERROR__) rather than silently hanging shoot.mjs for 240 s.
  if (params.get('selftest') === 'fail') {
    throw new Error('selftest=fail — deliberate boot failure, this is not a real error');
  }

  await loadModules();
  await loadPresets();

  buildRenderer();
  installApi();

  const preset = findPreset(PRESET_ID);
  if (PRESET_ID && !preset) warn(`camera preset "${PRESET_ID}" not found in cameras.json`);

  const level = preset
    ? preset.level || (preset.room && PIECE_BY_ID[preset.room] ? PIECE_BY_ID[preset.room].level : 'first')
    : LEVEL_PARAM || 'first';

  camera = makeCamera({
    fovV: preset ? preset.fovV : 78.5,
    aspect: state.width / state.height,
    shift: preset ? preset.shift : 0,
  });
  const st = defaultStation(level);
  aim(camera, st.pos, st.target);

  await buildScene(level, ROOM_PARAM || undefined);

  if (preset) {
    if (SHOT && preset.aspect) {
      resize(state.width, Math.round(state.width / preset.aspect));
    }
    applyPresetToCamera(preset);
  }

  buildControls();
  buildHud();

  setStatus('compiling shaders…');
  try {
    if (typeof renderer.compile === 'function') renderer.compile(scene, camera);
  } catch (err) {
    warn('renderer.compile failed: ' + ((err && err.message) || err));
  }

  setStatus('warming up…');
  await warmUp(SHOT ? 3 : 1);

  startLoop();

  if (dom.overlay) dom.overlay.classList.add('hidden');
  setStatus('ready');
  W.__STATUS__ = 'ready';
  W.__BOOT_TIME_MS__ = Date.now() - t0;
  W.__READY__ = true;
  console.log(`[app] ready in ${W.__BOOT_TIME_MS__} ms — ${state.width}x${state.height} ${state.quality}` +
    (preset ? ` preset=${preset.key}` : ''));
}

try {
  await boot();
} catch (err) {
  fatal(err);
  // Even a fatal boot must leave a usable API stub so the harness can report.
  if (!W.__APP__) {
    W.__APP__ = {
      version: 1,
      error: W.__BOOT_ERROR__,
      capture: () => (dom.canvas ? dom.canvas.toDataURL('image/png') : null),
      shoot: () => { throw new Error(W.__BOOT_ERROR__); },
      presetIds: () => Object.keys(PRESETS).sort(),
      warnings: () => W.__WARNINGS__.slice(),
      state,
    };
  }
}
