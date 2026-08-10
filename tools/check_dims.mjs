#!/usr/bin/env node
//
// tools/check_dims.mjs
//
// Consistency checker for app/src/core/dims.js — the authoritative geometry
// table for 1430 Country Ln.  Prints "DIMS OK" and exits 0 when every rule
// holds; prints the failures and exits 1 otherwise.
//
//   node tools/check_dims.mjs            normal run
//   node tools/check_dims.mjs --verbose  also dump per-level statistics
//   node tools/check_dims.mjs --dump first   ASCII map of a level's coverage
//
// RULES
//   1  No two rooms on a level overlap.
//   2  Every room's bounding box matches its stated plan dimension (<= 0.05 ft),
//      and every room with a stated area matches it (<= 3 %).
//   3  Rooms tile their level footprint: the only uncovered material is wall
//      thickness. Measured with a distance transform — no un-assigned point may
//      lie more than half of MAX_WALL from a room or from the outside world.
//   4  First + second floor finished area is plausible (2,700 – 2,900 sf of
//      named rooms; halls reported separately).
//   5  The second-floor footprint is contained in the first-floor footprint
//      except inside the declared exception polygons (the entry oversail).
//   6  Structural sanity: stairs fit their wells and meet riser/tread limits,
//      openings reference real walls and fit inside them without colliding,
//      voids sit over real space, internal level changes have a declared step,
//      columns and skylights sit inside the rooms they belong to, and the level
//      datums agree with CONVENTIONS.md.

const DIMS_URL = new URL('../app/src/core/dims.js', import.meta.url);
const UNITS_URL = new URL('../app/src/core/units.js', import.meta.url);

const dims = await import(DIMS_URL.href);
const U = await import(UNITS_URL.href);

const {
  LEVELS,
  CEIL,
  CEIL_Y,
  WALL,
  FOOTPRINTS,
  SECOND_FLOOR_EXCEPTIONS,
  ROOMS,
  ROOM_IDS,
  WALLS,
  WALL_BY_ID,
  OPENINGS,
  STAIRS,
  VOIDS,
  MASSING,
  SITE,
  STEPS,
  COLUMNS,
  SKYLIGHTS,
  roomCenter,
  roomBox,
  roomsOnLevel,
  livingArea,
} = dims;

const { polyArea, polyBBox, pointInPoly, segLen } = U;

/* ------------------------------------------------------------------ */
/* tolerances                                                          */
/* ------------------------------------------------------------------ */

const TOL_SIZE = 0.05; // ft — stated plan dimension vs bounding box
const TOL_AREA_PCT = 3.0; // % — stated area vs polygon area
const CELL = 0.1; // ft — raster resolution for overlap / tiling
const MAX_WALL = 1.0; // ft — thickest thing allowed to be "just a wall"
const MAX_OVERLAP = 0.5; // sf — tolerated room/room intersection
const AREA_MIN = 2700; // sf
const AREA_MAX = 2900; // sf

const ARGS = process.argv.slice(2);
const VERBOSE = ARGS.includes('--verbose') || ARGS.includes('-v');
const DUMP = (() => {
  const i = ARGS.indexOf('--dump');
  return i >= 0 ? ARGS[i + 1] : null;
})();

const failures = [];
const warnings = [];
const fail = (rule, msg) => failures.push(`[${rule}] ${msg}`);
const warn = (rule, msg) => warnings.push(`[${rule}] ${msg}`);
const f2 = (v) => (Math.round(v * 100) / 100).toFixed(2);
const f3 = (v) => (Math.round(v * 1000) / 1000).toFixed(3);

/* ------------------------------------------------------------------ */
/* raster helper                                                       */
/* ------------------------------------------------------------------ */

class Raster {
  constructor(bbox, cell = CELL) {
    const [x0, z0, x1, z1] = bbox;
    this.cell = cell;
    this.x0 = x0;
    this.z0 = z0;
    this.nx = Math.ceil((x1 - x0) / cell);
    this.nz = Math.ceil((z1 - z0) / cell);
    this.n = this.nx * this.nz;
  }
  cx(i) {
    return this.x0 + (i + 0.5) * this.cell;
  }
  cz(j) {
    return this.z0 + (j + 0.5) * this.cell;
  }
  idx(i, j) {
    return j * this.nx + i;
  }
  /** Uint8Array marking cells whose centre falls inside `poly`. */
  mask(poly) {
    const m = new Uint8Array(this.n);
    const [bx0, bz0, bx1, bz1] = polyBBox(poly);
    const i0 = Math.max(0, Math.floor((bx0 - this.x0) / this.cell) - 1);
    const i1 = Math.min(this.nx - 1, Math.ceil((bx1 - this.x0) / this.cell) + 1);
    const j0 = Math.max(0, Math.floor((bz0 - this.z0) / this.cell) - 1);
    const j1 = Math.min(this.nz - 1, Math.ceil((bz1 - this.z0) / this.cell) + 1);
    for (let j = j0; j <= j1; j++) {
      const z = this.cz(j);
      for (let i = i0; i <= i1; i++) {
        if (pointInPoly(this.cx(i), z, poly)) m[this.idx(i, j)] = 1;
      }
    }
    return m;
  }
}

const cellArea = CELL * CELL;

/**
 * Two-pass chamfer distance transform, in CELLS.
 * `isFree(k)` marks the seed cells (distance 0); every other cell gets the
 * approximate Euclidean distance to the nearest seed.
 */
function chamferDistance(raster, isFree) {
  const { nx, nz, n } = raster;
  const BIG = 1e9;
  const D = new Float64Array(n);
  const A = 1.0;
  const B = Math.SQRT2;
  for (let k = 0; k < n; k++) D[k] = isFree(k) ? 0 : BIG;
  const at = (i, j) => (i < 0 || j < 0 || i >= nx || j >= nz ? 0 : D[j * nx + i]);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (D[k] === 0) continue;
      let v = D[k];
      v = Math.min(v, at(i - 1, j) + A, at(i, j - 1) + A, at(i - 1, j - 1) + B, at(i + 1, j - 1) + B);
      D[k] = v;
    }
  }
  for (let j = nz - 1; j >= 0; j--) {
    for (let i = nx - 1; i >= 0; i--) {
      const k = j * nx + i;
      if (D[k] === 0) continue;
      let v = D[k];
      v = Math.min(v, at(i + 1, j) + A, at(i, j + 1) + A, at(i + 1, j + 1) + B, at(i - 1, j + 1) + B);
      D[k] = v;
    }
  }
  return D;
}

/* ------------------------------------------------------------------ */
/* 0. basic structural invariants                                      */
/* ------------------------------------------------------------------ */

function checkDatums() {
  const want = { basement: -9.0, first: 0.0, second: 9.5 };
  for (const [k, v] of Object.entries(want)) {
    if (Math.abs(LEVELS[k] - v) > 1e-9) fail('datum', `LEVELS.${k} = ${LEVELS[k]}, expected ${v}`);
  }
  // basement 7.49 is measured from the photos (docs/PHOTOGRAPHY.md), superseding the 7.75 estimate
  const wantC = { basement: 7.49, first: 8.5, second: 8.0 };
  for (const [k, v] of Object.entries(wantC)) {
    if (Math.abs(CEIL[k] - v) > 1e-9) fail('datum', `CEIL.${k} = ${CEIL[k]}, expected ${v}`);
  }
  const wantW = { ext: 0.55, int: 0.375, plumb: 0.54 };
  for (const [k, v] of Object.entries(wantW)) {
    if (Math.abs(WALL[k] - v) > 1e-9) fail('datum', `WALL.${k} = ${WALL[k]}, expected ${v}`);
  }
  // second-floor structure must fit between the first ceiling and second floor
  const joist = LEVELS.second - CEIL_Y.first;
  if (joist < 0.5 || joist > 1.75) {
    fail('datum', `floor assembly between first ceiling and second floor is ${f2(joist)} ft`);
  }
  for (const id of ROOM_IDS) {
    const r = ROOMS[id];
    if (!LEVELS.hasOwnProperty(r.level)) fail('datum', `room "${id}" has unknown level "${r.level}"`);
    if (r.poly.length < 3) fail('datum', `room "${id}" polygon has < 3 vertices`);
    if (r.areaComputed < 1) fail('datum', `room "${id}" area is ${f2(r.areaComputed)} sf`);
  }
}

/* ------------------------------------------------------------------ */
/* 1. no two rooms on a level overlap                                  */
/* ------------------------------------------------------------------ */

function checkOverlaps(level, raster) {
  const rooms = roomsOnLevel(level);
  const masks = rooms.map((r) => raster.mask(r.poly));
  for (let a = 0; a < rooms.length; a++) {
    // cheap bbox reject first
    for (let b = a + 1; b < rooms.length; b++) {
      const A = rooms[a].bbox;
      const B = rooms[b].bbox;
      if (A[0] >= B[2] - 1e-9 || B[0] >= A[2] - 1e-9 || A[1] >= B[3] - 1e-9 || B[1] >= A[3] - 1e-9) continue;
      const ma = masks[a];
      const mb = masks[b];
      let n = 0;
      for (let k = 0; k < ma.length; k++) if (ma[k] && mb[k]) n++;
      const area = n * cellArea;
      if (area > MAX_OVERLAP) {
        fail('overlap', `${level}: "${rooms[a].id}" and "${rooms[b].id}" overlap by ${f2(area)} sf`);
      }
    }
  }
  return { rooms, masks };
}

/* ------------------------------------------------------------------ */
/* 2. stated dimensions                                                */
/* ------------------------------------------------------------------ */

function checkSizes() {
  for (const id of ROOM_IDS) {
    const r = ROOMS[id];
    if (r.size) {
      const [w, d] = [r.bbox[2] - r.bbox[0], r.bbox[3] - r.bbox[1]];
      const dw = Math.abs(w - r.size[0]);
      const dd = Math.abs(d - r.size[1]);
      if (dw > TOL_SIZE || dd > TOL_SIZE) {
        fail(
          'size',
          `"${id}" (${r.label}) bounding box ${f3(w)} x ${f3(d)} ft ` +
            `!= stated ${f3(r.size[0])} x ${f3(r.size[1])} ft ` +
            `(dx ${f3(dw)}, dz ${f3(dd)})`
        );
      }
    } else if (!r.hidden && r.area === undefined) {
      fail('size', `"${id}" (${r.label}) is a labelled room with no stated size or area`);
    }
    if (r.area !== undefined) {
      const pct = (Math.abs(r.areaComputed - r.area) / r.area) * 100;
      if (pct > TOL_AREA_PCT) {
        fail(
          'size',
          `"${id}" (${r.label}) area ${f2(r.areaComputed)} sf != stated ${r.area} sf (${f2(pct)} %)`
        );
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* 3. rooms tile the level footprint                                   */
/* ------------------------------------------------------------------ */
//  Every cell of the footprint interior must be covered by a room, OR be part
//  of something no thicker than MAX_WALL in at least one direction — that is,
//  a wall.  A fat uncovered blob means a room is missing or misplaced.

function checkTiling(level, raster, rooms, masks, dumpAscii = false) {
  const foot = raster.mask(FOOTPRINTS[level]);
  const covered = new Uint8Array(raster.n);
  for (const m of masks) for (let k = 0; k < m.length; k++) if (m[k]) covered[k] = 1;

  const gap = new Uint8Array(raster.n);
  let footCells = 0;
  let gapCells = 0;
  for (let k = 0; k < raster.n; k++) {
    if (foot[k]) {
      footCells++;
      if (!covered[k]) {
        gap[k] = 1;
        gapCells++;
      }
    } else if (covered[k]) {
      // a room poking outside the footprint is always an error
      gap[k] = 2;
    }
  }

  let outside = 0;
  for (let k = 0; k < raster.n; k++) if (gap[k] === 2) outside++;
  if (outside * cellArea > 1.0) {
    fail('tiling', `${level}: ${f2(outside * cellArea)} sf of room area falls outside the level footprint`);
  }

  // Distance transform: how deep into the un-assigned material can you get
  // before you touch either a room or the outside world?  A wall of thickness
  // t bottoms out at t/2, and that stays true at tees, corners and wall ends.
  // Anything deeper is a genuine hole in the plan.
  const dist = chamferDistance(raster, (k) => gap[k] !== 1); // seeds = "free"
  const maxDepthCells = MAX_WALL / 2 / CELL + 1.2; // half a wall + slop
  const bad = [];
  for (let k = 0; k < raster.n; k++) {
    if (gap[k] !== 1) continue;
    if (dist[k] > maxDepthCells) bad.push(k);
  }
  if (bad.length) {
    // report the worst blob's location so it is actually fixable
    let wx0 = Infinity;
    let wz0 = Infinity;
    let wx1 = -Infinity;
    let wz1 = -Infinity;
    for (const k of bad) {
      const i = k % raster.nx;
      const j = (k - i) / raster.nx;
      wx0 = Math.min(wx0, raster.cx(i));
      wx1 = Math.max(wx1, raster.cx(i));
      wz0 = Math.min(wz0, raster.cz(j));
      wz1 = Math.max(wz1, raster.cz(j));
    }
    fail(
      'tiling',
      `${level}: ${f2(bad.length * cellArea)} sf of un-assigned floor is deeper than half a ` +
        `${MAX_WALL} ft wall — somewhere in x ${f2(wx0)}..${f2(wx1)}, ` +
        `z ${f2(wz0)}..${f2(wz1)}. Add a room or a hidden service space there.`
    );
    if (VERBOSE) {
      const shown = new Set();
      for (const k of bad) {
        const i = k % raster.nx;
        const j = (k - i) / raster.nx;
        const key = `${Math.floor(raster.cx(i))},${Math.floor(raster.cz(j))}`;
        if (!shown.has(key)) {
          shown.add(key);
          if (shown.size <= 40) console.log(`        blob cell near x=${f2(raster.cx(i))} z=${f2(raster.cz(j))}`);
        }
      }
    }
  }

  const wallFrac = (gapCells * cellArea) / (footCells * cellArea);
  if (wallFrac > 0.22) {
    warn('tiling', `${level}: ${f2(wallFrac * 100)} % of the footprint is un-assigned (walls) — high`);
  }

  if (dumpAscii) dumpLevel(raster, foot, covered, gap);

  return {
    footArea: footCells * cellArea,
    gapArea: gapCells * cellArea,
    roomArea: rooms.reduce((s, r) => s + r.areaComputed, 0),
    wallFrac,
  };
}

function dumpLevel(raster, foot, covered, gap) {
  const stepI = Math.max(1, Math.round(raster.nx / 150));
  const stepJ = Math.max(1, Math.round(raster.nz / 70));
  const lines = [];
  for (let j = 0; j < raster.nz; j += stepJ) {
    let s = '';
    for (let i = 0; i < raster.nx; i += stepI) {
      const k = raster.idx(i, j);
      s += !foot[k] ? ' ' : covered[k] ? '.' : gap[k] === 1 ? '#' : '?';
    }
    lines.push(s);
  }
  console.log(lines.join('\n'));
}

/* ------------------------------------------------------------------ */
/* 4. finished floor area                                              */
/* ------------------------------------------------------------------ */

function checkArea() {
  const a = livingArea();
  if (a.named < AREA_MIN || a.named > AREA_MAX) {
    fail(
      'area',
      `first + second floor named-room area is ${f2(a.named)} sf, outside ${AREA_MIN}-${AREA_MAX} sf`
    );
  }
  return a;
}

/* ------------------------------------------------------------------ */
/* 5. second floor contained in the first floor                        */
/* ------------------------------------------------------------------ */

function checkContainment() {
  const bb = polyBBox([...FOOTPRINTS.first, ...FOOTPRINTS.second]);
  const raster = new Raster(bb);
  const second = raster.mask(FOOTPRINTS.second);
  const first = raster.mask(FOOTPRINTS.first);
  const exc = SECOND_FLOOR_EXCEPTIONS.map((e) => raster.mask(e.poly));

  let strayCells = 0;
  let allowed = 0;
  let sx0 = Infinity;
  let sz0 = Infinity;
  let sx1 = -Infinity;
  let sz1 = -Infinity;
  for (let k = 0; k < raster.n; k++) {
    if (!second[k] || first[k]) continue;
    if (exc.some((m) => m[k])) {
      allowed++;
      continue;
    }
    strayCells++;
    const i = k % raster.nx;
    const j = (k - i) / raster.nx;
    sx0 = Math.min(sx0, raster.cx(i));
    sx1 = Math.max(sx1, raster.cx(i));
    sz0 = Math.min(sz0, raster.cz(j));
    sz1 = Math.max(sz1, raster.cz(j));
  }
  if (strayCells * cellArea > 1.0) {
    fail(
      'containment',
      `second floor oversails the first floor by ${f2(strayCells * cellArea)} sf outside the declared ` +
        `exceptions — x ${f2(sx0)}..${f2(sx1)}, z ${f2(sz0)}..${f2(sz1)}`
    );
  }
  // Every declared exception must actually be used, otherwise it is dead data.
  for (let e = 0; e < SECOND_FLOOR_EXCEPTIONS.length; e++) {
    let used = 0;
    for (let k = 0; k < raster.n; k++) if (exc[e][k] && second[k] && !first[k]) used++;
    if (used * cellArea < 1.0) {
      warn('containment', `exception "${SECOND_FLOOR_EXCEPTIONS[e].id}" is never needed`);
    }
  }
  return { allowedArea: allowed * cellArea };
}

/* ------------------------------------------------------------------ */
/* 6. stairs, openings, voids                                          */
/* ------------------------------------------------------------------ */

function checkStairs() {
  for (const [key, s] of Object.entries(STAIRS)) {
    const [wx0, wz0, wx1, wz1] = s.well;
    const wellW = wx1 - wx0;
    const wellD = wz1 - wz0;
    if (Math.abs(wellW - s.width) > 0.02) fail('stair', `${key}: width ${f3(s.width)} != well width ${f3(wellW)}`);
    if (Math.abs(wellD - s.run) > 0.02) fail('stair', `${key}: run ${f3(s.run)} != well depth ${f3(wellD)}`);
    const rise = s.topY - s.bottomY;
    if (Math.abs(rise - s.rise) > 1e-6) fail('stair', `${key}: rise ${f3(s.rise)} != topY-bottomY ${f3(rise)}`);
    if (Math.abs(s.riserH * s.risers - rise) > 1e-6) fail('stair', `${key}: risers x riserH != rise`);
    if (s.treads !== s.risers - 1) fail('stair', `${key}: treads (${s.treads}) should be risers-1 (${s.risers - 1})`);
    if (Math.abs(s.treadD * s.treads - s.run) > 1e-6) fail('stair', `${key}: treads x treadD != run`);
    if (s.riserH > U.STAIR_STD.maxRiser + 1e-9) {
      fail('stair', `${key}: riser ${f3(s.riserH * 12)}" exceeds ${f3(U.STAIR_STD.maxRiser * 12)}"`);
    }
    if (s.treadD < U.STAIR_STD.minTread - 1e-9) {
      fail('stair', `${key}: tread ${f3(s.treadD * 12)}" is under ${f3(U.STAIR_STD.minTread * 12)}"`);
    }
    if (s.width < U.STAIR_STD.minWidth - 1e-9) fail('stair', `${key}: width ${f3(s.width)} ft is under 3'-0"`);
    if (Math.abs(s.bottomY - LEVELS[s.fromLevel]) > 1e-9) fail('stair', `${key}: bottomY != LEVELS.${s.fromLevel}`);
    if (Math.abs(s.topY - LEVELS[s.toLevel]) > 1e-9) fail('stair', `${key}: topY != LEVELS.${s.toLevel}`);
  }
  // the two flights must stack (both sit in the same plan footprint)
  const a = STAIRS.firstToSecond.well;
  const b = STAIRS.basementToFirst.well;
  for (let i = 0; i < 4; i++) {
    if (Math.abs(a[i] - b[i]) > 0.01) {
      warn('stair', 'the basement flight is not exactly under the main flight');
      break;
    }
  }
  // the main flight must sit inside the foyer/hall footprint on the first floor
  const well = STAIRS.firstToSecond.well;
  const wellPoly = U.rectPoly(well);
  const foot = FOOTPRINTS.first;
  for (const p of wellPoly) {
    const inset = [
      p[0] === well[0] ? p[0] + 0.05 : p[0] - 0.05,
      p[1] === well[1] ? p[1] + 0.05 : p[1] - 0.05,
    ];
    if (!pointInPoly(inset[0], inset[1], foot)) {
      fail('stair', `firstToSecond well corner ${f2(p[0])},${f2(p[1])} is outside the first-floor footprint`);
    }
  }
}

function checkOpenings() {
  for (const o of OPENINGS) {
    const w = WALL_BY_ID[o.wall];
    if (!w) {
      fail('opening', `opening "${o.note ?? o.type}" references unknown wall "${o.wall}"`);
      continue;
    }
    const L = segLen(w.a, w.b);
    const half = o.w / 2;
    if (o.center - half < -1e-6 || o.center + half > L + 1e-6) {
      fail(
        'opening',
        `${o.wall}: ${o.type} "${o.note ?? ''}" spans ${f2(o.center - half)}..${f2(o.center + half)} ft ` +
          `on a ${f2(L)} ft wall`
      );
    }
    const head = (o.sill ?? 0) + o.h;
    const lvlH = w.h ?? CEIL[w.level];
    if (head > lvlH + 1e-6) {
      fail('opening', `${o.wall}: ${o.type} "${o.note ?? ''}" head ${f2(head)} ft exceeds wall height ${f2(lvlH)} ft`);
    }
    if (o.type === 'door' && (o.sill ?? 0) !== 0 && o.swing !== 'slide') {
      warn('opening', `${o.wall}: door "${o.note ?? ''}" has a non-zero sill`);
    }
  }
  // two openings must not overlap on the same wall
  const byWall = new Map();
  for (const o of OPENINGS) {
    if (!byWall.has(o.wall)) byWall.set(o.wall, []);
    byWall.get(o.wall).push(o);
  }
  for (const [wid, list] of byWall) {
    const sorted = [...list].sort((p, q) => p.center - q.center);
    for (let i = 1; i < sorted.length; i++) {
      const prevEnd = sorted[i - 1].center + sorted[i - 1].w / 2;
      const thisStart = sorted[i].center - sorted[i].w / 2;
      if (thisStart < prevEnd - 1e-6) {
        fail('opening', `${wid}: "${sorted[i - 1].note ?? ''}" and "${sorted[i].note ?? ''}" overlap`);
      }
    }
  }
}

function checkVoids() {
  for (const v of VOIDS) {
    if (!LEVELS.hasOwnProperty(v.level)) fail('void', `void "${v.id}" has unknown level "${v.level}"`);
    if (polyArea(v.poly) < 1) fail('void', `void "${v.id}" has no area`);
    if (v.toY <= v.fromY) fail('void', `void "${v.id}" has toY <= fromY`);
    // a void on level L must be inside level L's footprint
    const foot = FOOTPRINTS[v.level];
    const c = U.polyCentroid(v.poly);
    if (!pointInPoly(c[0], c[1], foot)) {
      fail('void', `void "${v.id}" centroid is outside the ${v.level} footprint`);
    }
  }
  // the entry void must sit over the foyer
  const foy = ROOMS.foyer.bbox;
  const ev = polyBBox(VOIDS[0].poly);
  if (ev[0] > foy[2] || ev[2] < foy[0] || ev[1] > foy[3] || ev[3] < foy[1]) {
    fail('void', 'the entry void does not overlap the foyer below it');
  }
}

function checkWalls() {
  const seen = new Set();
  for (const w of WALLS) {
    if (seen.has(w.id)) fail('wall', `duplicate wall id "${w.id}"`);
    seen.add(w.id);
    if (segLen(w.a, w.b) < 0.05) fail('wall', `wall "${w.id}" is degenerate`);
    if (!(w.t > 0.05 && w.t < 2.0)) fail('wall', `wall "${w.id}" has implausible thickness ${w.t}`);
    if (!(w.h > 3 && w.h < 26)) fail('wall', `wall "${w.id}" has implausible height ${w.h}`);
  }
}

function checkMassingAndSite() {
  const need = ['grade', 'blocks', 'roofs', 'chimney', 'siding', 'deck', 'patio', 'planterWall', 'firePit'];
  for (const k of need) if (!MASSING[k]) fail('massing', `MASSING.${k} is missing`);
  for (const [k, b] of Object.entries(MASSING.blocks)) {
    if (!Array.isArray(b.poly) || b.poly.length < 3) fail('massing', `block "${k}" has no polygon`);
    if (!(b.topY > b.baseY)) fail('massing', `block "${k}" has topY <= baseY`);
  }
  for (const r of MASSING.roofs) {
    if (!(r.ridgeY >= r.eaveY)) fail('massing', `roof "${r.id}" has ridgeY < eaveY`);
    if (!Array.isArray(r.poly) || r.poly.length < 3) fail('massing', `roof "${r.id}" has no polygon`);
  }
  // the garage must be single-storey and the entry box two-storey
  if (MASSING.blocks.garageWing.storeys !== 1) fail('massing', 'the garage wing must be single storey');
  if (!MASSING.blocks.entryBox.porthole) fail('massing', 'the entry box has no porthole window');
  const ph = MASSING.blocks.entryBox.porthole.center;
  if (ph[1] < LEVELS.second || ph[1] > CEIL_Y.second) {
    fail('massing', 'the porthole window is not on the second-floor wall');
  }
  if (Math.abs(ph[2] - MASSING.blocks.entryBox.poly[2][1]) > 0.01) {
    warn('massing', 'the porthole is not on the entry box front plane');
  }

  const needSite = ['lot', 'street', 'driveway', 'walkway', 'hedges', 'shrubs', 'mulchBeds', 'trees'];
  for (const k of needSite) if (!SITE[k]) fail('site', `SITE.${k} is missing`);
  if (!(SITE.driveway.poly.length >= 4)) fail('site', 'the driveway needs a polygon');
  // the driveway must meet the garage door
  const dw = polyBBox(SITE.driveway.poly);
  if (dw[1] > FOOTPRINTS.first[4][1] + 0.6) fail('site', 'the driveway does not reach the garage door');
  // the walkway must end at the entry porch
  const wEnd = SITE.walkway.path[SITE.walkway.path.length - 1];
  const porch = MASSING.blocks.entryPorch.poly;
  if (Math.hypot(wEnd[0] - (porch[0][0] + porch[1][0]) / 2, wEnd[1] - porch[2][1]) > 12) {
    warn('site', 'the bluestone walk does not appear to reach the entry porch');
  }
}

function checkLevelChanges() {
  // Any room whose floor is offset from its level datum must have a declared
  // step at its boundary, otherwise it is an invisible trip hazard in the model.
  for (const id of ROOM_IDS) {
    const r = ROOMS[id];
    const off = r.floorOffset ?? 0;
    if (off === 0) continue;
    if (Math.abs(off) > 1.0) fail('step', `room "${id}" floor offset ${f3(off)} ft is too large`);
    const served = STEPS.some((st) => {
      if (st.level !== r.level) return false;
      if (st.room === id) return true;
      if (Array.isArray(st.rooms) && st.rooms.includes(id)) return true;
      // or the step line touches this room's bounding box
      const bb = r.bbox;
      return st.line.some((p) => p[0] >= bb[0] - 0.6 && p[0] <= bb[2] + 0.6 && p[1] >= bb[1] - 0.6 && p[1] <= bb[3] + 0.6);
    });
    if (!served) fail('step', `room "${id}" is offset ${f3(off * 12)} in but no STEPS entry reaches it`);
  }
  for (const st of STEPS) {
    if (!LEVELS.hasOwnProperty(st.level)) fail('step', `step "${st.id}" has unknown level`);
    if (segLen(st.line[0], st.line[1]) < 1) fail('step', `step "${st.id}" line is degenerate`);
    if (!(st.riserH > 0.2 && st.riserH <= U.STAIR_STD.maxRiser + 1e-9)) {
      fail('step', `step "${st.id}" riser ${f3(st.riserH * 12)}" is out of range`);
    }
    if (st.room && !ROOMS[st.room]) fail('step', `step "${st.id}" names unknown room "${st.room}"`);
    for (const rid of st.rooms ?? []) {
      if (!ROOMS[rid]) fail('step', `step "${st.id}" names unknown room "${rid}"`);
    }
  }
}

function checkColumnsAndSkylights() {
  for (const col of COLUMNS) {
    if (!LEVELS.hasOwnProperty(col.level)) fail('column', `column "${col.id}" has unknown level`);
    const [x0, z0, x1, z1] = col.plan;
    if (!(x1 > x0 && z1 > z0)) fail('column', `column "${col.id}" has an inverted plan rect`);
    const w = Math.max(x1 - x0, z1 - z0);
    if (Math.abs(w - col.w) > 0.06) fail('column', `column "${col.id}" plan ${f3(w)} != w ${f3(col.w)}`);
    if (!pointInPoly((x0 + x1) / 2, (z0 + z1) / 2, FOOTPRINTS[col.level])) {
      fail('column', `column "${col.id}" is outside the ${col.level} footprint`);
    }
  }
  for (const sk of SKYLIGHTS) {
    if (!ROOMS[sk.room]) fail('skylight', `skylight "${sk.id}" names unknown room "${sk.room}"`);
    else {
      const bb = ROOMS[sk.room].bbox;
      const [x0, z0, x1, z1] = sk.plan;
      if (x0 < bb[0] - 1e-6 || x1 > bb[2] + 1e-6 || z0 < bb[1] - 1e-6 || z1 > bb[3] + 1e-6) {
        fail('skylight', `skylight "${sk.id}" is not inside room "${sk.room}"`);
      }
    }
    if (!(sk.roofY > sk.ceilY)) fail('skylight', `skylight "${sk.id}" roofY must be above ceilY`);
  }
}

function checkAccessors() {
  for (const id of ROOM_IDS) {
    const c = roomCenter(id);
    const b = roomBox(id);
    if (!Number.isFinite(c[0]) || !Number.isFinite(c[1])) fail('accessor', `roomCenter("${id}") is not finite`);
    if (Math.abs(b.cx - c[0]) > 1e-9 || Math.abs(b.cz - c[1]) > 1e-9) {
      fail('accessor', `roomBox("${id}") centre disagrees with roomCenter`);
    }
    if (!(b.h > 5)) fail('accessor', `roomBox("${id}").h = ${b.h}`);
    const r = ROOMS[id];
    if (Math.abs(b.y0 - (LEVELS[r.level] + (r.floorOffset ?? 0))) > 1e-9) {
      fail('accessor', `roomBox("${id}").y0 wrong`);
    }
  }
  let threw = false;
  try {
    roomCenter('definitelyNotARoom');
  } catch {
    threw = true;
  }
  if (!threw) fail('accessor', 'roomCenter did not throw for an unknown id');
}

/* ------------------------------------------------------------------ */
/* required rooms from the listing plans                               */
/* ------------------------------------------------------------------ */

const REQUIRED = [
  ['foyer', 'first', [12.417, 13.167]],
  ['kitchen', 'first', [17.417, 10.333]],
  ['diningRoom', 'first', [13.917, 10.917]],
  ['livingRoom', 'first', [18.917, 18.167]],
  ['familyRoom', 'first', [12.083, 19.667]],
  ['breakfastNook', 'first', [13.917, 16.083]],
  ['hallCenter', 'first', [9.917, 16.333]],
  ['hallKitchen', 'first', [21.5, 3.667]],
  ['laundry', 'first', [12.167, 7.917]],
  ['bedroom1', 'first', [17.25, 11.667]],
  ['bath1', 'first', [5.333, 8.833]],
  ['garage', 'first', [19.917, 20.833]],
  ['primaryBedroom', 'second', [11.583, 21.583]],
  ['primaryBath', 'second', [12.917, 13.75]],
  ['sunroom', 'second', [24.75, 4.917]],
  ['wic', 'second', [13.917, 7.5]],
  ['primaryWC', 'second', [3.0, 4.75]],
  ['bedroom2', 'second', [12.417, 12.75]],
  ['bedroom3', 'second', [13.167, 13.167]],
  ['bedroom4', 'second', [10.833, 13.167]],
  ['bath2', 'second', [5.167, 7.417]],
  ['bath3', 'second', [5.167, 5.5]],
  ['hallUpperEast', 'second', [11.417, 9.083]],
  ['hallUpper', 'second', [22.0, 3.167]],
  ['recreationRoom', 'basement', [37.083, 20.083]],
  ['gym', 'basement', [11.5, 11.75]],
];

function checkRequired() {
  for (const [id, level, size] of REQUIRED) {
    const r = ROOMS[id];
    if (!r) {
      fail('required', `room "${id}" is missing from ROOMS`);
      continue;
    }
    if (r.level !== level) fail('required', `room "${id}" is on level "${r.level}", expected "${level}"`);
    if (!r.size) {
      fail('required', `room "${id}" has no stated size`);
      continue;
    }
    if (Math.abs(r.size[0] - size[0]) > 1e-3 || Math.abs(r.size[1] - size[1]) > 1e-3) {
      fail('required', `room "${id}" stated size ${r.size} != plan ${size}`);
    }
  }
  if (ROOMS.basementBath?.area !== 35) fail('required', 'basement Bathroom must be 35 sf');
  if (ROOMS.utilityRoom?.area !== 370) fail('required', 'basement Utility Room must be 370 sf');
  if (ROOMS.recreationRoom?.area !== 716) fail('required', 'Recreation Room must be 716 sf');
  if (ROOMS.gym?.area !== 135) fail('required', 'Gym must be 135 sf');
  if (!ROOMS.garage?.shellOnly) fail('required', 'the garage must be shell-only');
  if (!ROOMS.utilityRoom?.shellOnly) fail('required', 'the utility room must be shell-only');
  if (!VOIDS.some((v) => v.id === 'entryVoid')) fail('required', 'the OPEN TO BELOW void is missing');
}

/* ------------------------------------------------------------------ */
/* run                                                                 */
/* ------------------------------------------------------------------ */

checkDatums();
checkSizes();
checkRequired();
checkWalls();
checkStairs();
checkOpenings();
checkVoids();
checkMassingAndSite();
checkLevelChanges();
checkColumnsAndSkylights();
checkAccessors();

const stats = {};
for (const level of ['basement', 'first', 'second']) {
  const bb = polyBBox(FOOTPRINTS[level]);
  const raster = new Raster([bb[0] - 1, bb[1] - 1, bb[2] + 1, bb[3] + 1]);
  const { rooms, masks } = checkOverlaps(level, raster);
  stats[level] = checkTiling(level, raster, rooms, masks, DUMP === level);
}

const area = checkArea();
const contain = checkContainment();

/* ------------------------------------------------------------------ */
/* report                                                              */
/* ------------------------------------------------------------------ */

if (VERBOSE || failures.length) {
  console.log('1430 Country Ln — dims.js consistency report');
  console.log('--------------------------------------------------------------');
  for (const level of ['basement', 'first', 'second']) {
    const s = stats[level];
    const n = roomsOnLevel(level).length;
    console.log(
      `${level.padEnd(9)} footprint ${f2(s.footArea).padStart(8)} sf   ` +
        `rooms ${f2(s.roomArea).padStart(8)} sf (${String(n).padStart(2)})   ` +
        `walls ${f2(s.gapArea).padStart(7)} sf (${f2(s.wallFrac * 100)} %)`
    );
  }
  console.log('--------------------------------------------------------------');
  console.log(`named rooms, 1st + 2nd : ${f2(area.named)} sf   (target ${AREA_MIN}-${AREA_MAX})`);
  console.log(`labelled halls          : ${f2(area.halls)} sf`);
  console.log(`all labelled rooms      : ${f2(area.total)} sf`);
  console.log(`entry oversail          : ${f2(contain.allowedArea)} sf (declared exception)`);
  console.log(
    `overall footprint       : x 0..${f2(polyBBox(FOOTPRINTS.first)[2])} ft, ` +
      `z 0..${f2(polyBBox(FOOTPRINTS.first)[3])} ft`
  );
  console.log(
    `rooms ${ROOM_IDS.length}   walls ${WALLS.length}   openings ${OPENINGS.length}   ` +
      `voids ${VOIDS.length}   steps ${STEPS.length}   columns ${COLUMNS.length}   skylights ${SKYLIGHTS.length}`
  );
  console.log('--------------------------------------------------------------');
}

for (const w of warnings) console.log(`WARN  ${w}`);

if (failures.length) {
  console.error('');
  for (const f of failures) console.error(`FAIL  ${f}`);
  console.error(`\n${failures.length} failure(s).`);
  process.exit(1);
}

console.log('DIMS OK');
process.exit(0);
