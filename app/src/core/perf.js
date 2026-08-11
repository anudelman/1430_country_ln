/**
 * perf.js — walk-mode cost controls.
 *
 * The stills want every light the rooms built; a real-time walkthrough cannot
 * afford them. three.js renders forward, so EVERY light in the scene is
 * evaluated per-fragment for every lit pixel — 43 lights is a fixed per-pixel
 * tax paid on every frame no matter where you stand, and RectAreaLight is the
 * most expensive of the lot (it integrates an LTC per fragment).
 *
 * Measured on the first floor (tools/perf.mjs):
 *   43 lights = 30 SpotLight + 6 RectAreaLight + 2 Point + 2 Directional + ...
 *
 * The budget below keeps the brightest lights *per room* rather than the ones
 * nearest the camera. That distinction matters: a nearest-N rule leaves every
 * room you are not standing in pitch black, whereas per-room keeps the whole
 * floor lit and simply thins each room's fixture count.
 *
 * Nothing here runs while you walk. Changing how many lights are visible makes
 * three recompile every material in the scene, which is a multi-hundred-
 * millisecond stall — so the budget is applied once at scene build (and again
 * only if the user toggles it), never per frame.
 */

import * as THREE from 'three';

const _scale = new THREE.Vector3();

/** Lights that are cheap and global — never worth culling. */
const ALWAYS_KEEP = new Set(['AmbientLight', 'HemisphereLight', 'DirectionalLight']);

function lightScore(l) {
  // Intensity alone ranks a dim wide wash below a bright pinspot; weight by
  // reach so the light that actually fills the room survives.
  const reach = l.distance && l.distance > 0 ? l.distance : 12;
  return (l.intensity || 0) * Math.max(1, reach);
}

/**
 * Thin the artificial lights down to a per-room budget.
 *
 * @param {THREE.Scene} scene
 * @param {object} [o]
 * @param {number}  [o.perRoom=2]        brightest N kept in each `room:*` group
 * @param {number}  [o.loose=6]          budget for lights not inside a room group
 * @param {boolean} [o.dropRectArea=true] RectAreaLight is the priciest per pixel
 * @returns {{before:number, after:number, hidden:THREE.Light[], restore:function}}
 */
export function applyLightBudget(scene, { perRoom = 2, loose = 6, dropRectArea = true } = {}) {
  if (!scene) return { before: 0, after: 0, hidden: [], restore() {} };

  // Bucket every cullable light by the room group it belongs to.
  const buckets = new Map();
  let before = 0;

  scene.traverse((o) => {
    if (!o.isLight) return;
    before++;
    if (ALWAYS_KEEP.has(o.type)) return;

    let key = '';
    for (let p = o.parent; p; p = p.parent) {
      if (p.name && p.name.startsWith('room:')) { key = p.name; break; }
    }
    const list = buckets.get(key) || [];
    list.push(o);
    buckets.set(key, list);
  });

  const hidden = [];
  for (const [key, list] of buckets) {
    const budget = key ? perRoom : loose;
    const keep = list
      .filter((l) => !(dropRectArea && l.isRectAreaLight))
      .sort((a, b) => lightScore(b) - lightScore(a))
      .slice(0, budget);
    const keepSet = new Set(keep);
    for (const l of list) {
      if (keepSet.has(l)) continue;
      if (l.visible === false) continue;
      l.visible = false;
      hidden.push(l);
    }
  }

  let after = 0;
  scene.traverse((o) => { if (o.isLight && o.visible) after++; });

  return {
    before,
    after,
    hidden,
    restore() {
      for (const l of hidden) l.visible = true;
      hidden.length = 0;
    },
  };
}

/**
 * Stop objects casting shadows they cannot meaningfully contribute.
 *
 * 3648 of the first floor's 3880 meshes cast shadows. Every shadow-map refresh
 * therefore redraws the entire house per shadowed light. The maps only refresh
 * on scene changes now, but the refresh itself is a visible hitch, and small
 * props contribute nothing a viewer can identify.
 *
 * @param {THREE.Scene} scene
 * @param {number} [minSize=1.2] feet; bounding-sphere diameter below which an
 *                               object stops casting
 * @returns {{before:number, after:number, trimmed:object[], restore:function}}
 */
export function trimShadowCasters(scene, minSize = 1.2) {
  let before = 0;
  let after = 0;
  const trimmed = [];
  scene.traverse((o) => {
    if (!o.isMesh && !o.isInstancedMesh) return;
    if (!o.castShadow) return;
    before++;
    const g = o.geometry;
    if (!g) return;
    if (!g.boundingSphere) {
      try { g.computeBoundingSphere(); } catch { return; }
    }
    const bs = g.boundingSphere;
    if (!bs) return;
    // Object scale matters: a unit box scaled up to a wall is not a small prop.
    o.getWorldScale(_scale);
    const s = Math.max(Math.abs(_scale.x), Math.abs(_scale.y), Math.abs(_scale.z));
    if (bs.radius * 2 * s < minSize) {
      o.castShadow = false;
      trimmed.push(o);
    } else after++;
  });
  return {
    before,
    after,
    trimmed,
    restore() {
      for (const o of trimmed) o.castShadow = true;
      trimmed.length = 0;
    },
  };
}

export default { applyLightBudget, trimShadowCasters };
