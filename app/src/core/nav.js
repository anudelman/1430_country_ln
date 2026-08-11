/**
 * nav.js — walkthrough navigation: wall collision and floor following.
 *
 * The still-image pipeline never needed either of these; the interactive
 * walkthrough does. Everything here reads straight out of `dims.js`, so the
 * navmesh can never drift from the geometry that was actually built.
 *
 *   makeCollider()  -> (x, z, y, r) => boolean   true when the move is blocked
 *   makeFloorSampler() -> (x, z, footY) => number  the walking surface at x/z
 *
 * Both are pure functions of position, allocation-free on the hot path, and
 * safe to call once per axis per frame.
 */

import {
  WALLS,
  OPENINGS,
  STAIRS,
  FOOTPRINTS,
  LEVELS,
  LEVEL_KEYS,
  CEIL,
  VOIDS,
} from './dims.js';

/* ------------------------------------------------------------------ */
/* geometry helpers                                                     */
/* ------------------------------------------------------------------ */

/** Even-odd point-in-polygon. `poly` is an array of [x, z]. */
export function pointInPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0];
    const zi = poly[i][1];
    const xj = poly[j][0];
    const zj = poly[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Distance from a point to a segment, plus how far along the segment the
 * closest point falls (in feet from `a`). Written out rather than using
 * THREE.Line3 so it allocates nothing.
 */
function segClosest(px, pz, ax, az, bx, bz, out) {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const cx = ax + t * dx;
  const cz = az + t * dz;
  out.dist = Math.hypot(px - cx, pz - cz);
  out.along = t * Math.sqrt(len2);
  return out;
}

/** Which level's floor a given eye/foot Y belongs to. */
export function levelAt(y) {
  let best = 'first';
  let bestDy = Infinity;
  for (const k of LEVEL_KEYS) {
    const dy = y - LEVELS[k];
    // Prefer the closest floor at or below y, tolerating a little slop so a
    // camera easing up a stair does not flicker between levels.
    const score = dy >= -0.6 ? dy : Infinity;
    if (score < bestDy) {
      bestDy = score;
      best = k;
    }
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* collision                                                            */
/* ------------------------------------------------------------------ */

/**
 * An opening is walkable if you can physically step through it: a door, a
 * cased opening or an arch whose sill sits on (or within a step of) the floor.
 * Windows, with their raised sills, are not.
 */
function isWalkThrough(op) {
  if (!op) return false;
  if ((op.sill ?? 0) > 1.0) return false;
  if ((op.h ?? 0) < 5.0) return false;
  const t = op.type || '';
  return (
    t === 'door' ||
    t === 'cased' ||
    t === 'opening' ||
    t === 'arch' ||
    t === 'archway' ||
    t === 'garageDoor'
  );
}

/**
 * Build the per-level wall index once. Each entry carries the segment, the
 * half-thickness to keep clear, and the walkable gaps measured in feet from
 * the wall's `a` end — the same parameterisation `OPENINGS[].center` uses.
 */
function buildWallIndex() {
  const gapsByWall = Object.create(null);
  for (const op of OPENINGS) {
    if (!isWalkThrough(op)) continue;
    const list = gapsByWall[op.wall] || (gapsByWall[op.wall] = []);
    list.push([op.center - op.w / 2, op.center + op.w / 2]);
  }

  const byLevel = Object.create(null);
  for (const k of LEVEL_KEYS) byLevel[k] = [];

  for (const w of WALLS) {
    if (!byLevel[w.level]) continue;
    // Knee walls and guards are stepped over visually but should still stop
    // you; anything under ~2 ft tall is trim, not an obstacle.
    if ((w.h ?? 8) < 2.0) continue;
    byLevel[w.level].push({
      ax: w.a[0],
      az: w.a[1],
      bx: w.b[0],
      bz: w.b[1],
      half: (w.t ?? 0.5) / 2,
      gaps: gapsByWall[w.id] || null,
    });
  }
  return byLevel;
}

let WALL_INDEX = null;

/**
 * @param {object} [o]
 * @param {number} [o.margin=0]  extra clearance in feet, on top of the radius
 * @returns {(x:number,z:number,y:number,r:number)=>boolean}
 */
export function makeCollider({ margin = 0 } = {}) {
  if (!WALL_INDEX) WALL_INDEX = buildWallIndex();
  const hit = { dist: 0, along: 0 };

  return function blocked(x, z, y, r = 0.75) {
    const walls = WALL_INDEX[levelAt(y)];
    if (!walls) return false;
    const reach = r + margin;

    for (let i = 0; i < walls.length; i++) {
      const w = walls[i];
      segClosest(x, z, w.ax, w.az, w.bx, w.bz, hit);
      if (hit.dist >= w.half + reach) continue;

      // Inside the wall's slab — the only way through is a doorway, and you
      // have to clear its jambs by your own radius.
      if (w.gaps) {
        let through = false;
        for (let g = 0; g < w.gaps.length; g++) {
          const inset = Math.min(r, (w.gaps[g][1] - w.gaps[g][0]) / 4);
          if (hit.along > w.gaps[g][0] + inset && hit.along < w.gaps[g][1] - inset) {
            through = true;
            break;
          }
        }
        if (through) continue;
      }
      return true;
    }
    return false;
  };
}

/* ------------------------------------------------------------------ */
/* floor following                                                      */
/* ------------------------------------------------------------------ */

/** Stair wells, normalised to min/max rectangles with their ramp maths. */
function buildStairs() {
  const out = [];
  for (const key of Object.keys(STAIRS)) {
    const s = STAIRS[key];
    const [x0, z0, x1, z1] = s.well;
    out.push({
      id: s.id,
      xMin: Math.min(x0, x1),
      xMax: Math.max(x0, x1),
      zMin: Math.min(z0, z1),
      zMax: Math.max(z0, z1),
      // Every flight in this house ascends toward -Z, so the ramp height is a
      // straight lerp on Z from the south (bottom) edge to the north (top).
      zBottom: Math.max(z0, z1),
      zTop: Math.min(z0, z1),
      bottomY: s.bottomY,
      topY: s.topY,
      toLevel: s.toLevel,
    });
  }
  return out;
}

/** Floor openings: the level whose slab is missing, and where. */
function buildHoles(stairs) {
  const holes = [];
  for (const v of VOIDS) {
    if (v.poly && v.level) holes.push({ level: v.level, poly: v.poly });
  }
  // The slab a flight arrives at is cut away over the well.
  for (const s of stairs) {
    holes.push({
      level: s.toLevel,
      rect: [s.xMin, s.zMin, s.xMax, s.zMax],
    });
  }
  return holes;
}

let STAIR_INDEX = null;
let HOLE_INDEX = null;

/**
 * Walking-surface sampler.
 *
 * Returns the height of the floor under (x, z), choosing the candidate
 * *nearest* the walker's current foot height rather than simply the highest.
 * That single choice is what makes both flights usable: at the foot of the
 * main stair the ascending ramp is the nearest surface, and at the head of it
 * the descending flight is — so you walk up or down naturally depending on
 * which end you approach, with no mode switch.
 *
 * @param {object} [o]
 * @param {number} [o.stepUp=1.6]   how far you can rise in one sample, feet
 * @param {number} [o.stepDown=1.6] how far you can drop before it is a fall
 */
export function makeFloorSampler({ stepUp = 1.6, stepDown = 1.6 } = {}) {
  if (!STAIR_INDEX) STAIR_INDEX = buildStairs();
  if (!HOLE_INDEX) HOLE_INDEX = buildHoles(STAIR_INDEX);

  const cand = [];

  return function floorAt(x, z, footY) {
    cand.length = 0;

    // Stair ramps.
    for (let i = 0; i < STAIR_INDEX.length; i++) {
      const s = STAIR_INDEX[i];
      if (x < s.xMin || x > s.xMax || z < s.zMin || z > s.zMax) continue;
      const span = s.zBottom - s.zTop;
      const t = span > 0 ? (s.zBottom - z) / span : 0;
      cand.push(s.bottomY + (s.topY - s.bottomY) * Math.max(0, Math.min(1, t)));
    }

    // Level slabs, minus any hole punched in them.
    for (let i = 0; i < LEVEL_KEYS.length; i++) {
      const k = LEVEL_KEYS[i];
      const fp = FOOTPRINTS[k];
      if (!fp || !pointInPoly(x, z, fp)) continue;

      let holed = false;
      for (let h = 0; h < HOLE_INDEX.length; h++) {
        const hole = HOLE_INDEX[h];
        if (hole.level !== k) continue;
        if (hole.rect) {
          if (x >= hole.rect[0] && x <= hole.rect[2] && z >= hole.rect[1] && z <= hole.rect[3]) {
            holed = true;
            break;
          }
        } else if (pointInPoly(x, z, hole.poly)) {
          holed = true;
          break;
        }
      }
      if (!holed) cand.push(LEVELS[k]);
    }

    if (cand.length === 0) return footY;

    // Nearest surface within one step, up or down.
    let best = null;
    let bestD = Infinity;
    for (let i = 0; i < cand.length; i++) {
      const d = cand[i] - footY;
      if (d > stepUp || d < -stepDown) continue;
      const ad = Math.abs(d);
      if (ad < bestD) {
        bestD = ad;
        best = cand[i];
      }
    }
    if (best !== null) return best;

    // Nothing reachable — stand on the highest surface below us so a walker
    // who somehow ends up over a void settles instead of hanging in the air.
    let below = null;
    for (let i = 0; i < cand.length; i++) {
      if (cand[i] <= footY && (below === null || cand[i] > below)) below = cand[i];
    }
    return below !== null ? below : footY;
  };
}

/** Ceiling height above a level, for head-room clamping. */
export function ceilingAt(y) {
  const k = levelAt(y);
  return LEVELS[k] + (CEIL[k] ?? 8.5);
}
