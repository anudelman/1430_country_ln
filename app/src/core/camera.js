/**
 * camera.js — the perspective-correction module.
 *
 * CONVENTIONS §5: real-estate photographs are shot with a shift lens (or
 * corrected in post), so **vertical lines are exactly vertical**. Our cameras
 * therefore *never* pitch. They look perfectly horizontally and use an
 * OFF-AXIS frustum: the image plane slides up or down relative to the optical
 * axis to take in more ceiling (or more floor) without converging verticals.
 *
 *   shift = +1.0  ->  frustum raised by a full half-height: the horizon sits
 *                     on the bottom edge of the frame, all ceiling.
 *   shift =  0.0  ->  symmetric frustum, horizon dead centre.
 *   shift = -1.0  ->  horizon on the top edge, all floor.
 *
 * A preset with a non-zero pitch is a bug. `applyPreset` enforces this.
 *
 *   import { makeShiftCamera, aimHorizontal, applyPreset } from './core/camera.js';
 *   const cam = makeShiftCamera({ fovV: 62, aspect: 1.5, shift: 0.14 });
 *   aimHorizontal(cam, [4, 5.4, 6], [4, -12]);
 */

import * as THREE from 'three';

/* ======================================================================== */
/* Defaults — the optical envelope of the listing photographs               */
/* ======================================================================== */

/**
 * 16-24mm full-frame on a 3:2 body -> 55-75deg vertical FOV, tripod head at
 * 4.6-5.4 ft. `shift` is the fraction of the frustum half-height, positive up.
 */
export const LENS = Object.freeze({
  fovV: 62,
  aspect: 1.5,
  shift: 0.0,
  shiftX: 0.0,
  near: 0.08,
  far: 600,
  eyeHeight: 5.4,
  fovVMin: 40,
  fovVMax: 90,
  shiftMax: 1.25,
});

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

function asVec3(p, fallbackY = 0) {
  if (!p) return new THREE.Vector3(0, fallbackY, 0);
  if (p.isVector3) return p.clone();
  if (Array.isArray(p)) return new THREE.Vector3(p[0], p.length > 2 ? p[1] : fallbackY, p.length > 2 ? p[2] : p[1]);
  return new THREE.Vector3(p.x || 0, p.y === undefined ? fallbackY : p.y, p.z || 0);
}

/** Accepts [x,z] or [x,y,z] or Vector3 and returns {x, z}. */
function asXZ(p) {
  if (!p) return { x: 0, z: 0 };
  if (p.isVector3) return { x: p.x, z: p.z };
  if (Array.isArray(p)) return p.length > 2 ? { x: p[0], z: p[2] } : { x: p[0], z: p[1] };
  return { x: p.x || 0, z: p.z || 0 };
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/* ======================================================================== */
/* The shift camera                                                          */
/* ======================================================================== */

/**
 * Recompute the off-axis projection matrix from `camera.userData.shiftLens`.
 * Installed as `camera.updateProjectionMatrix` so that anything inside three
 * that touches the camera (EffectComposer, setRenderSize, controls) rebuilds
 * the *shifted* frustum rather than a symmetric one.
 */
export function updateShiftProjection(camera) {
  const L = camera.userData.shiftLens;

  // Keep the vanilla PerspectiveCamera fields in sync so helpers, raycasters
  // and `camera.fov` readers see something sane.
  camera.fov = L.fovV;
  camera.aspect = L.aspect;
  camera.near = L.near;
  camera.far = L.far;
  camera.zoom = L.zoom;

  const halfH = (L.near * Math.tan(THREE.MathUtils.degToRad(L.fovV) * 0.5)) / L.zoom;
  const halfW = halfH * L.aspect;

  // The whole trick: the frustum is symmetric about the *optical axis* but the
  // image rectangle is offset by `shift` half-heights. Raising the rectangle
  // (positive shift) admits ceiling; the camera itself stays level so vertical
  // world lines stay parallel to the image-plane vertical.
  const dy = L.shift * halfH;
  const dx = L.shiftX * halfW;

  const top = halfH + dy;
  const bottom = -halfH + dy;
  const left = -halfW + dx;
  const right = halfW + dx;

  camera.projectionMatrix.makePerspective(
    left,
    right,
    top,
    bottom,
    L.near,
    L.far,
    camera.coordinateSystem
  );
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();

  // Mirror the offset into filmOffset-ish bookkeeping for debug overlays.
  camera.userData.shiftLens.halfHeightNear = halfH;
  return camera;
}

/**
 * Create a perspective-corrected (shift-lens) camera.
 *
 * @param {object}  o
 * @param {number}  [o.fovV=62]     vertical field of view, DEGREES
 * @param {number}  [o.aspect=1.5]  width / height (listing photos are 3:2)
 * @param {number}  [o.shift=0]     lens rise/fall as a fraction of the frustum
 *                                  half-height. + = up = more ceiling.
 * @param {number}  [o.shiftX=0]    lateral shift, fraction of half-width
 * @param {number}  [o.near=0.08]   feet
 * @param {number}  [o.far=600]     feet
 * @param {number}  [o.zoom=1]
 * @param {string}  [o.name]
 * @returns {THREE.PerspectiveCamera} with an overridden updateProjectionMatrix
 */
export function makeShiftCamera({
  fovV = LENS.fovV,
  aspect = LENS.aspect,
  shift = 0,
  shiftX = 0,
  near = LENS.near,
  far = LENS.far,
  zoom = 1,
  name = 'shiftCamera',
} = {}) {
  const camera = new THREE.PerspectiveCamera(fovV, aspect, near, far);
  camera.name = name;
  // Yaw-first order keeps roll identically zero when we set rotation.y.
  camera.rotation.order = 'YXZ';
  camera.userData.shiftLens = {
    fovV,
    aspect,
    shift,
    shiftX,
    near,
    far,
    zoom,
    halfHeightNear: 0,
  };
  // Instance-level override: three calls this internally in several places.
  camera.updateProjectionMatrix = function updateProjectionMatrixShifted() {
    return updateShiftProjection(this);
  };
  camera.updateProjectionMatrix();
  return camera;
}

/** True for cameras built by makeShiftCamera. */
export function isShiftCamera(camera) {
  return !!(camera && camera.userData && camera.userData.shiftLens);
}

/** Set the lens rise/fall (and optional lateral shift) and rebuild the frustum. */
export function setShift(camera, shift, shiftX) {
  const L = camera.userData.shiftLens;
  L.shift = clamp(shift, -LENS.shiftMax, LENS.shiftMax);
  if (shiftX !== undefined) L.shiftX = clamp(shiftX, -LENS.shiftMax, LENS.shiftMax);
  camera.updateProjectionMatrix();
  return L.shift;
}

/** Set vertical FOV in degrees. */
export function setFovV(camera, fovV) {
  const L = camera.userData.shiftLens;
  L.fovV = clamp(fovV, LENS.fovVMin, LENS.fovVMax);
  camera.updateProjectionMatrix();
  return L.fovV;
}

/** Set aspect (width / height). */
export function setAspect(camera, aspect) {
  const L = camera.userData.shiftLens;
  L.aspect = aspect;
  camera.updateProjectionMatrix();
  return aspect;
}

/**
 * Point the camera at a plan-space target **without any pitch or roll**.
 * This is the only sanctioned way to aim a screenshot camera.
 *
 * @param {THREE.PerspectiveCamera} camera
 * @param {number[]|THREE.Vector3}  from  eye position [x, y, z]
 * @param {number[]|THREE.Vector3}  toXZ  target; its Y is deliberately ignored
 * @returns {number} the yaw applied, radians
 */
export function aimHorizontal(camera, from, toXZ) {
  if (from) {
    const p = asVec3(from);
    camera.position.set(p.x, p.y, p.z);
  }
  const t = asXZ(toXZ);
  const dx = t.x - camera.position.x;
  const dz = t.z - camera.position.z;

  // A camera looks down its local -Z. With rotation.y = a the forward vector is
  // (-sin a, 0, -cos a); we want that parallel to (dx, dz).
  let yaw = camera.rotation.y;
  if (Math.abs(dx) > 1e-9 || Math.abs(dz) > 1e-9) yaw = Math.atan2(-dx, -dz);

  camera.rotation.order = 'YXZ';
  camera.rotation.set(0, yaw, 0);
  camera.up.set(0, 1, 0);
  camera.updateMatrixWorld(true);
  return yaw;
}

/**
 * The `shift` that would place a world point at the vertical centre of frame.
 * Handy when authoring cameras.json from a photo: pick the thing that sits on
 * the horizon line of the photograph and solve for the lens rise.
 */
export function shiftForTarget(camera, from, target) {
  const eye = from ? asVec3(from) : camera.position;
  const t = asVec3(target);
  const L = Math.hypot(t.x - eye.x, t.z - eye.z);
  if (L < 1e-6) return 0;
  const dy = t.y - eye.y;
  const fovV = isShiftCamera(camera) ? camera.userData.shiftLens.fovV : camera.fov;
  return dy / L / Math.tan(THREE.MathUtils.degToRad(fovV) * 0.5);
}

/** Horizontal FOV implied by the current vertical FOV and aspect, degrees. */
export function fovHorizontal(camera) {
  const L = camera.userData.shiftLens;
  const halfV = THREE.MathUtils.degToRad(L.fovV) * 0.5;
  return THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(halfV) * L.aspect));
}

/** 35mm-equivalent focal length of the current vertical FOV (24mm film height). */
export function focalLength35(camera) {
  const L = camera.userData.shiftLens;
  return 12 / Math.tan(THREE.MathUtils.degToRad(L.fovV) * 0.5);
}

/* ======================================================================== */
/* Presets (app/cameras.json)                                                */
/* ======================================================================== */

/**
 * Normalise + validate one preset object against the CONVENTIONS §5 schema.
 * Throws on anything that would produce converging verticals.
 */
export function normalizePreset(key, p) {
  if (!p || typeof p !== 'object') throw new Error(`camera preset "${key}": not an object`);
  const pos = p.pos || p.position;
  const target = p.target || p.lookAt;
  if (!Array.isArray(pos) || pos.length !== 3) {
    throw new Error(`camera preset "${key}": pos must be [x, y, z]`);
  }
  if (!Array.isArray(target) || target.length !== 3) {
    throw new Error(`camera preset "${key}": target must be [x, y, z]`);
  }
  if (p.pitch !== undefined && Math.abs(p.pitch) > 1e-6) {
    throw new Error(`camera preset "${key}": pitch must be 0 — use "shift" instead`);
  }
  if (p.roll !== undefined && Math.abs(p.roll) > 1e-6) {
    throw new Error(`camera preset "${key}": roll must be 0`);
  }
  const fovV = p.fovV === undefined ? LENS.fovV : p.fovV;
  if (fovV < LENS.fovVMin || fovV > LENS.fovVMax) {
    throw new Error(`camera preset "${key}": fovV ${fovV} outside ${LENS.fovVMin}..${LENS.fovVMax}`);
  }
  const shift = p.shift === undefined ? 0 : p.shift;
  if (Math.abs(shift) > LENS.shiftMax) {
    throw new Error(`camera preset "${key}": shift ${shift} exceeds +/-${LENS.shiftMax}`);
  }
  const aspect = p.aspect === undefined ? LENS.aspect : p.aspect;
  if (!(aspect > 0)) throw new Error(`camera preset "${key}": aspect must be > 0`);

  return {
    key,
    photo: p.photo || `${key}.png`,
    room: p.room || null,
    level: p.level || null,
    pos: [pos[0], pos[1], pos[2]],
    target: [target[0], target[1], target[2]],
    fovV,
    shift,
    shiftX: p.shiftX === undefined ? 0 : p.shiftX,
    aspect,
    exposure: p.exposure === undefined ? null : p.exposure,
    /** Per-preset PhotoFinish grade overrides — see core/post.js. */
    post: p.post && typeof p.post === 'object' ? Object.assign({}, p.post) : null,
    near: p.near === undefined ? LENS.near : p.near,
    far: p.far === undefined ? LENS.far : p.far,
    notes: p.notes || '',
  };
}

/** Normalise a whole `cameras.json` object. */
export function normalizePresets(raw) {
  const out = {};
  for (const [k, v] of Object.entries(raw || {})) {
    if (k.startsWith('$') || k.startsWith('_')) continue; // metadata keys
    out[k] = normalizePreset(k, v);
  }
  return out;
}

/**
 * Load and validate `app/cameras.json`.
 * @param {string} [url='./cameras.json']
 * @returns {Promise<Record<string, object>>}
 */
export async function loadPresets(url = './cameras.json') {
  if (typeof fetch !== 'function') {
    throw new Error('loadPresets: fetch() unavailable — pass the parsed JSON to normalizePresets instead');
  }
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`loadPresets: ${res.status} ${res.statusText} for ${url}`);
  return normalizePresets(await res.json());
}

/** Look a preset up by key or by photo filename. Throws when missing. */
export function getPreset(presets, name) {
  if (presets[name]) return presets[name];
  const bare = String(name).replace(/\.(png|jpe?g)$/i, '');
  if (presets[bare]) return presets[bare];
  for (const p of Object.values(presets)) {
    if (p.photo === name || p.photo === `${bare}.png`) return p;
  }
  throw new Error(`camera preset "${name}" not found`);
}

/**
 * Apply a preset to an existing shift camera: position, horizontal aim, fovV,
 * shift and aspect. Pitch and roll are forced to zero.
 *
 * @param {THREE.PerspectiveCamera} camera  from makeShiftCamera
 * @param {object} preset                   raw or normalised preset
 * @param {object} [o]
 * @param {number} [o.aspect]               override (e.g. the real canvas AR)
 * @returns {THREE.PerspectiveCamera}
 */
export function applyPreset(camera, preset, { aspect } = {}) {
  const p = preset.key ? preset : normalizePreset(preset.photo || 'preset', preset);
  if (!isShiftCamera(camera)) {
    throw new Error('applyPreset: camera was not built by makeShiftCamera');
  }
  const L = camera.userData.shiftLens;
  L.fovV = p.fovV;
  L.aspect = aspect === undefined ? p.aspect : aspect;
  L.shift = p.shift;
  L.shiftX = p.shiftX;
  L.near = p.near;
  L.far = p.far;
  aimHorizontal(camera, p.pos, p.target);
  camera.updateProjectionMatrix();
  camera.userData.preset = p;
  return camera;
}

/** One-shot: build a fresh shift camera straight from a preset. */
export function presetToCamera(preset, { aspect } = {}) {
  const p = preset.key ? preset : normalizePreset(preset.photo || 'preset', preset);
  const cam = makeShiftCamera({
    fovV: p.fovV,
    aspect: aspect === undefined ? p.aspect : aspect,
    shift: p.shift,
    shiftX: p.shiftX,
    near: p.near,
    far: p.far,
    name: p.key,
  });
  aimHorizontal(cam, p.pos, p.target);
  cam.userData.preset = p;
  return cam;
}

/** Serialise a live camera back out in cameras.json form (for authoring). */
export function cameraToPreset(camera, extra = {}) {
  const L = camera.userData.shiftLens;
  const dir = camera.getWorldDirection(_v).setY(0).normalize();
  const t = _v2.copy(camera.position).addScaledVector(dir, 10);
  const r = (n) => Math.round(n * 1000) / 1000;
  return Object.assign(
    {
      pos: [r(camera.position.x), r(camera.position.y), r(camera.position.z)],
      target: [r(t.x), r(camera.position.y), r(t.z)],
      fovV: r(L.fovV),
      shift: r(L.shift),
      aspect: r(L.aspect),
    },
    extra
  );
}

/* ======================================================================== */
/* Walk controls (interactive walkthrough only — never used for screenshots) */
/* ======================================================================== */

/** Finished-floor datums, mirrored from dims.js so controls stay dependency-free. */
export const FLOOR_Y = Object.freeze({ basement: -9.0, first: 0.0, second: 9.5 });

/** Don't eat keystrokes aimed at the preset dropdown or any text field. */
function isTypingTarget(el) {
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toUpperCase();
  return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || el.isContentEditable === true;
}

const KEY_MAP = {
  KeyW: 'fwd', ArrowUp: 'fwd',
  KeyS: 'back', ArrowDown: 'back',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  KeyQ: 'shiftDown',
  KeyE: 'shiftUp',
};

/**
 * WASD + mouse-look walkthrough controls.
 *
 * `pitchMode` decides what mouse-Y does, and the two callers want opposite
 * things. In `'shift'` mode it drives the **lens shift**, keeping verticals
 * dead vertical the way `CONVENTIONS.md` §5 requires of the stills. In
 * `'tilt'` mode it pitches the camera like any other first-person view.
 *
 * Interactive walking must use `'tilt'`: sliding the frustum under a moving
 * observer shears the image instead of turning the head, which reads as
 * broken. `'shift'` stays the default so the screenshot path is unchanged.
 *
 * @param {THREE.PerspectiveCamera} camera  from makeShiftCamera
 * @param {HTMLElement} domElement
 * @param {object} o
 * @param {number}   [o.floorY=0]          finished-floor Y of the current level
 * @param {number}   [o.eyeHeight=5.4]     feet, the listing-photo tripod height
 * @param {function} [o.collide]           (x, z, y) => true when blocked
 * @param {number}   [o.speed=4.2]         ft/s walking
 * @param {number}   [o.runMultiplier=2.2]
 * @param {number}   [o.damping=12]        1/s velocity damping
 * @param {number}   [o.sensitivity=0.0022] radians per pixel of mouse X
 * @param {number}   [o.shiftSensitivity=0.0016] shift per pixel of mouse Y
 * @param {number}   [o.shiftRange=0.85]
 * @param {'shift'|'tilt'} [o.pitchMode='shift']
 * @param {number}   [o.radius=0.75]       collision probe radius, feet
 * @param {function} [o.floorSampler]      (x, z, floorY) => walking-surface Y;
 *                                         supply `nav.makeFloorSampler()` to
 *                                         make stairs walkable
 * @param {number}   [o.floorEase=18]      1/s easing toward the sampled floor
 * @returns {object} controls
 */
export function createWalkControls(camera, domElement, {
  floorY = 0,
  eyeHeight = LENS.eyeHeight,
  collide = null,
  speed = 4.2,
  runMultiplier = 2.2,
  crouchMultiplier = 0.4,
  damping = 12,
  sensitivity = 0.0022,
  shiftSensitivity = 0.0016,
  shiftRange = 0.85,
  pitchMode = 'shift',
  radius = 0.75,
  autoLock = true,
  floorSampler = null,
  floorEase = 18,
} = {}) {
  if (!isShiftCamera(camera)) {
    throw new Error('createWalkControls: camera was not built by makeShiftCamera');
  }

  const state = {
    enabled: true,
    locked: false,
    floorY,
    eyeHeight,
    speed,
    collide,
    pitchMode,
    yaw: camera.rotation.y,
    pitch: 0,
    lensShift: camera.userData.shiftLens.shift,
    keys: Object.create(null),
    velocity: new THREE.Vector3(),
  };

  const el = domElement;

  function place() {
    camera.rotation.order = 'YXZ';
    camera.rotation.set(state.pitchMode === 'tilt' ? state.pitch : 0, state.yaw, 0);
    camera.position.y = state.floorY + state.eyeHeight;
    setShift(camera, state.pitchMode === 'tilt' ? 0 : state.lensShift);
  }

  /* -------- mouse ---------------------------------------------------- */
  function onMouseMove(e) {
    if (!state.enabled || !state.locked) return;
    const mx = e.movementX || 0;
    const my = e.movementY || 0;
    state.yaw -= mx * sensitivity;
    if (state.pitchMode === 'tilt') {
      state.pitch = clamp(state.pitch - my * sensitivity, -1.35, 1.35);
    } else {
      // Mouse up (negative movementY) raises the lens: more ceiling.
      state.lensShift = clamp(state.lensShift - my * shiftSensitivity, -shiftRange, shiftRange);
    }
    place();
  }

  function onPointerLockChange() {
    state.locked = typeof document !== 'undefined' && document.pointerLockElement === el;
  }

  function onClick() {
    if (!autoLock || !state.enabled) return;
    if (!el.requestPointerLock) return;
    // Chrome rejects a lock request made too soon after the user exited one,
    // and returns a promise on newer builds. Swallow it: a failed lock is a
    // "click again" situation, not an error worth breaking the frame over.
    try {
      const p = el.requestPointerLock();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (_) { /* older browsers throw instead */ }
  }

  function onPointerLockError() {
    state.locked = false;
  }

  /* -------- keyboard -------------------------------------------------- */
  function onKeyDown(e) {
    if (!state.enabled || isTypingTarget(e.target)) return;
    const k = KEY_MAP[e.code];
    if (k) {
      state.keys[k] = true;
      e.preventDefault();
    }
    if (e.code === 'KeyR') resetLevel();
    if (e.code === 'Digit1') resetLevel('basement');
    if (e.code === 'Digit2') resetLevel('first');
    if (e.code === 'Digit3') resetLevel('second');
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') state.keys.run = true;
    if (e.code === 'ControlLeft' || e.code === 'ControlRight') state.keys.slow = true;
  }

  function onKeyUp(e) {
    if (isTypingTarget(e.target)) return;
    const k = KEY_MAP[e.code];
    if (k) state.keys[k] = false;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') state.keys.run = false;
    if (e.code === 'ControlLeft' || e.code === 'ControlRight') state.keys.slow = false;
  }

  function onBlur() {
    state.keys = Object.create(null);
    state.velocity.set(0, 0, 0);
  }

  if (el && el.addEventListener) {
    el.addEventListener('click', onClick);
    el.addEventListener('mousemove', onMouseMove);
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('pointerlockchange', onPointerLockChange);
    document.addEventListener('pointerlockerror', onPointerLockError);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
  }
  if (typeof window !== 'undefined') window.addEventListener('blur', onBlur);

  /* -------- movement --------------------------------------------------- */
  const fwd = new THREE.Vector3();
  const side = new THREE.Vector3();
  const wish = new THREE.Vector3();

  function blocked(x, z) {
    if (!state.collide) return false;
    return !!state.collide(x, z, camera.position.y, radius);
  }

  function update(dt) {
    if (!state.enabled) return;
    const step = Math.min(dt || 0, 0.1);

    fwd.set(-Math.sin(state.yaw), 0, -Math.cos(state.yaw));
    side.set(Math.cos(state.yaw), 0, -Math.sin(state.yaw));

    wish.set(0, 0, 0);
    if (state.keys.fwd) wish.add(fwd);
    if (state.keys.back) wish.sub(fwd);
    if (state.keys.right) wish.add(side);
    if (state.keys.left) wish.sub(side);
    // Q/E mean different things in the two modes. Tilting already gives you
    // the ceiling, so there the pair raises and lowers the eye instead —
    // useful for matching a listing photo's tripod height, and it keeps the
    // keys alive rather than dead (tilt mode pins the lens shift to zero).
    if (state.pitchMode === 'tilt') {
      if (state.keys.shiftUp) state.eyeHeight = clamp(state.eyeHeight + step * 1.8, 2.6, 6.8);
      if (state.keys.shiftDown) state.eyeHeight = clamp(state.eyeHeight - step * 1.8, 2.6, 6.8);
    } else {
      if (state.keys.shiftUp) state.lensShift = clamp(state.lensShift + step * 0.9, -shiftRange, shiftRange);
      if (state.keys.shiftDown) state.lensShift = clamp(state.lensShift - step * 0.9, -shiftRange, shiftRange);
    }

    let v = state.speed;
    if (state.keys.run) v *= runMultiplier;
    if (state.keys.slow) v *= crouchMultiplier;

    if (wish.lengthSq() > 0) {
      wish.normalize().multiplyScalar(v);
      state.velocity.lerp(wish, 1 - Math.exp(-damping * step));
    } else {
      state.velocity.multiplyScalar(Math.exp(-damping * step));
      if (state.velocity.lengthSq() < 1e-6) state.velocity.set(0, 0, 0);
    }

    const dx = state.velocity.x * step;
    const dz = state.velocity.z * step;
    // Axis-separated so we slide along walls instead of sticking to them.
    if (dx !== 0 && !blocked(camera.position.x + dx, camera.position.z)) camera.position.x += dx;
    else state.velocity.x = 0;
    if (dz !== 0 && !blocked(camera.position.x, camera.position.z + dz)) camera.position.z += dz;
    else state.velocity.z = 0;

    // Follow the floor under our feet, so stairs are walkable rather than
    // something you have to jump between with the level keys.
    if (floorSampler) {
      const target = floorSampler(camera.position.x, camera.position.z, state.floorY);
      if (target !== state.floorY) {
        state.floorY += (target - state.floorY) * (1 - Math.exp(-floorEase * step));
        if (Math.abs(target - state.floorY) < 0.005) state.floorY = target;
      }
    }

    place();
  }

  /**
   * Snap the eye back to the standard listing-photo height on a level and
   * zero the lens shift. Call with no argument to reset the current level.
   * @param {'basement'|'first'|'second'|number} [level]
   */
  function resetLevel(level) {
    if (typeof level === 'number') state.floorY = level;
    else if (level && FLOOR_Y[level] !== undefined) state.floorY = FLOOR_Y[level];
    state.eyeHeight = eyeHeight;
    state.lensShift = 0;
    state.pitch = 0;
    state.velocity.set(0, 0, 0);
    camera.position.y = state.floorY + state.eyeHeight;
    place();
    return state.floorY;
  }

  function setLevel(level) {
    return resetLevel(level);
  }

  function teleport(pos, lookAtXZ) {
    const p = asVec3(pos);
    camera.position.set(p.x, p.y, p.z);
    state.floorY = p.y - state.eyeHeight;
    if (lookAtXZ) {
      const t = asXZ(lookAtXZ);
      state.yaw = Math.atan2(-(t.x - p.x), -(t.z - p.z));
    }
    state.velocity.set(0, 0, 0);
    place();
  }

  function dispose() {
    state.enabled = false;
    if (el && el.removeEventListener) {
      el.removeEventListener('click', onClick);
      el.removeEventListener('mousemove', onMouseMove);
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('pointerlockchange', onPointerLockChange);
      document.removeEventListener('pointerlockerror', onPointerLockError);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
    }
    if (typeof window !== 'undefined') window.removeEventListener('blur', onBlur);
  }

  place();

  return {
    update,
    resetLevel,
    setLevel,
    teleport,
    dispose,
    lock: onClick,
    unlock: () => typeof document !== 'undefined' && document.exitPointerLock && document.exitPointerLock(),
    state,
    get enabled() { return state.enabled; },
    set enabled(v) { state.enabled = !!v; },
    get locked() { return state.locked; },
    get yaw() { return state.yaw; },
    set yaw(v) { state.yaw = v; place(); },
    get shift() { return state.lensShift; },
    set shift(v) { state.lensShift = clamp(v, -shiftRange, shiftRange); place(); },
    get collide() { return state.collide; },
    set collide(fn) { state.collide = fn; },
    get speed() { return state.speed; },
    set speed(v) { state.speed = v; },
  };
}

export default makeShiftCamera;
