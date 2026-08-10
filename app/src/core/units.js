// app/src/core/units.js
//
// 1430 Country Ln — units, scale constants and small geometry helpers.
//
// CONTRACT (docs/CONVENTIONS.md §1):
//   * 1 world unit = 1 foot. Always.
//   * Y is up. Y = 0 is the FIRST-FLOOR finished floor.
//   * +X = plan-right (east).  +Z = toward the street (south, plan-down).
//   * Angles in radians; rotation about +Y is CCW seen from above.
//
// Nothing in this file imports three.js: it is pure data + math so that
// tools/check_dims.mjs can import it under plain node.

/* ------------------------------------------------------------------ */
/* length                                                              */
/* ------------------------------------------------------------------ */

export const FOOT = 1;
export const INCH = 1 / 12;

/** inches -> feet.  inch(1.75) === 0.14583… */
export function inch(n) {
  return n / 12;
}

/** feet + inches -> feet.  ft(6, 8) === 6.6667 (a 6'-8" door leaf) */
export function ft(feet, inches = 0) {
  return feet + inches / 12;
}

/**
 * Parse a floor-plan dimension string into feet.
 * Accepts:  `12'5"`  `12' 5"`  `12'-5"`  `12'`  `5"`  `13.5`
 */
export function ftin(s) {
  if (typeof s === 'number') return s;
  const str = String(s).trim();
  const m = str.match(/^(?:(\d+(?:\.\d+)?)\s*')?\s*-?\s*(?:(\d+(?:\.\d+)?)\s*")?$/);
  if (m && (m[1] !== undefined || m[2] !== undefined)) {
    return (m[1] ? parseFloat(m[1]) : 0) + (m[2] ? parseFloat(m[2]) / 12 : 0);
  }
  const n = parseFloat(str);
  if (Number.isFinite(n)) return n;
  throw new Error(`ftin: cannot parse "${s}"`);
}

/** feet -> `12'-5"` for labels / debug overlays. */
export function feetLabel(v) {
  const sign = v < 0 ? '-' : '';
  const a = Math.abs(v);
  let f = Math.floor(a + 1e-9);
  let i = Math.round((a - f) * 12);
  if (i === 12) {
    f += 1;
    i = 0;
  }
  return `${sign}${f}'-${i}"`;
}

export const METERS_PER_FOOT = 0.3048;
export const toMeters = (f) => f * METERS_PER_FOOT;
export const fromMeters = (m) => m / METERS_PER_FOOT;

/* ------------------------------------------------------------------ */
/* angle                                                               */
/* ------------------------------------------------------------------ */

export const DEG = Math.PI / 180;
export const deg = (d) => d * DEG;
export const toDeg = (r) => r / DEG;

/* ------------------------------------------------------------------ */
/* scale references used by every room module                          */
/* ------------------------------------------------------------------ */

/** Doors. Interior leaf 6'-8" x 1-3/4". */
export const DOOR = {
  leafH: ft(6, 8), //  6.6667
  leafT: inch(1.75), //  0.14583
  widthStd: ft(2, 8),
  widthNarrow: ft(2, 6),
  widthWide: ft(3, 0),
  entryW: ft(3, 0),
  entryH: ft(6, 10),
  entryT: inch(2.25),
  casingW: inch(3.5),
  casingT: inch(0.75),
  revealMargin: inch(0.1875),
  garageW: ft(16, 0),
  garageH: ft(7, 0),
};

/** Casework. Base 34.5" + 1.25" counter = 35.75" finished top. */
export const CAB = {
  baseH: inch(34.5),
  counterT: inch(1.25),
  counterY: inch(35.75),
  baseD: ft(2, 0),
  toeH: inch(4),
  toeD: inch(3),
  counterToUpper: inch(18),
  upperY: inch(35.75 + 18), //  4.479 — bottom of wall cabinets
  upperH: inch(42),
  upperD: inch(13),
  islandOverhang: inch(12),
  vanityH: inch(32),
  vanityCounterY: inch(33.25),
};

/** Trim. */
export const TRIM = {
  baseH: inch(5.5),
  baseT: inch(0.625),
  caseW: inch(3.5),
  caseT: inch(0.75),
  crownH: inch(4.5),
  shoeH: inch(0.75),
};

/** Electrical. Outlets 15" to centre, switches 46" to centre. */
export const ELEC = {
  outletY: inch(15),
  switchY: inch(46),
  outletW: inch(2.75),
  outletH: inch(4.5),
  plateW: inch(2.75),
  plateH: inch(4.5),
};

/** Windows — default head height matches the 6'-10" door head. */
export const WIN = {
  headY: ft(6, 10),
  sillStd: ft(2, 6),
  sillPicture: ft(1, 6),
  frameW: inch(2.5),
  frameT: inch(2),
  glassT: inch(0.75),
  muntinW: inch(0.875),
};

/** Stair code limits used to sanity-check STAIRS entries. */
export const STAIR_STD = {
  maxRiser: inch(7.75),
  minRiser: inch(4),
  minTread: inch(10),
  minWidth: ft(3, 0),
  minHeadroom: ft(6, 8),
  handrailY: ft(2, 10),
  guardY: ft(3, 0),
};

/* ------------------------------------------------------------------ */
/* tiny scalar helpers                                                 */
/* ------------------------------------------------------------------ */

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const round = (v, p = 4) => {
  const m = 10 ** p;
  return Math.round(v * m) / m;
};
export const approx = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

/* ------------------------------------------------------------------ */
/* 2-D polygon helpers (plan space: [x, z])                            */
/* ------------------------------------------------------------------ */

/** Axis-aligned rectangle [x0,z0,x1,z1] -> CW polygon in plan space. */
export function rectPoly(r) {
  const [x0, z0, x1, z1] = r;
  return [
    [x0, z0],
    [x1, z0],
    [x1, z1],
    [x0, z1],
  ];
}

/** Signed area doubled (shoelace). Positive = clockwise in (x, z-down). */
export function polySignedArea2(poly) {
  let s = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s;
}

export function polyArea(poly) {
  return Math.abs(polySignedArea2(poly)) / 2;
}

/** [minX, minZ, maxX, maxZ] */
export function polyBBox(poly) {
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  for (const p of poly) {
    if (p[0] < x0) x0 = p[0];
    if (p[0] > x1) x1 = p[0];
    if (p[1] < z0) z0 = p[1];
    if (p[1] > z1) z1 = p[1];
  }
  return [x0, z0, x1, z1];
}

export function bboxSize(bb) {
  return [bb[2] - bb[0], bb[3] - bb[1]];
}

export function bboxCenter(bb) {
  return [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2];
}

export function polyCentroid(poly) {
  const a2 = polySignedArea2(poly);
  if (Math.abs(a2) < 1e-9) return bboxCenter(polyBBox(poly));
  let cx = 0;
  let cz = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % n];
    const f = p[0] * q[1] - q[0] * p[1];
    cx += (p[0] + q[0]) * f;
    cz += (p[1] + q[1]) * f;
  }
  return [cx / (3 * a2), cz / (3 * a2)];
}

/** Ray-cast point-in-polygon. Boundary result is unspecified — sample centres. */
export function pointInPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0];
    const zi = poly[i][1];
    const xj = poly[j][0];
    const zj = poly[j][1];
    const hit = zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

/** Is `x,z` inside ANY polygon of the list. */
export function pointInAny(x, z, polys) {
  for (const p of polys) if (pointInPoly(x, z, p)) return true;
  return false;
}

export function segLen(a, b) {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

/** Unit direction of a wall segment in plan space. */
export function segDir(a, b) {
  const l = segLen(a, b) || 1;
  return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
}

/** Point at distance `d` along segment a->b. */
export function segPoint(a, b, d) {
  const u = segDir(a, b);
  return [a[0] + u[0] * d, a[1] + u[1] * d];
}

/** Left-hand normal of a->b (in plan space, +X right / +Z down). */
export function segNormal(a, b) {
  const u = segDir(a, b);
  return [u[1], -u[0]];
}

/** Expand an axis-aligned rect by `d` on every side. */
export function rectExpand(r, d) {
  return [r[0] - d, r[1] - d, r[2] + d, r[3] + d];
}

export function rectsOverlap(a, b, eps = 0) {
  return a[0] < b[2] - eps && b[0] < a[2] - eps && a[1] < b[3] - eps && b[1] < a[3] - eps;
}
