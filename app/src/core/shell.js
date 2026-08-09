/**
 * app/src/core/shell.js — the building shell.
 *
 * Turns the authoritative tables in `dims.js` into geometry: floors, ceilings,
 * walls with real punched openings, the door/window units that fill them,
 * stairs, columns, the sunken-living-room step, skylight wells, floor-void
 * guards — and, for the `exterior` level, the massing, roofs, siding and site.
 *
 * This is deliberately the DUMB layer.  It knows nothing about any particular
 * room's finishes; it produces the architecture that every room module then
 * decorates.  Where a real finish is obvious from the plan (oak on the first
 * floor, carpet in the bedrooms, tile in the baths) the shell lays a default
 * floor so the level is never a grey box — a room module that wants something
 * different calls `ctx.shell.hideFloor(roomId)` and lays its own.
 *
 * ---------------------------------------------------------------------------
 * CONVENTIONS THIS FILE PINS DOWN  (see docs/CONVENTIONS.md §3.1)
 * ---------------------------------------------------------------------------
 * A wall is a plan segment a -> b.  Let u = unit(b - a) in plan (x, z).
 *
 *   FRONT NORMAL   n = [-u.z, +u.x]
 *
 * That is the RIGHT-hand normal when +Z points down the page, and for the
 * clockwise-wound footprints in dims.js it is the INWARD normal — the one an
 * `align:'outer'` wall grows along from its outside face.  (dims.js's header
 * comment says `segNormal`, i.e. the left-hand normal; that is wrong — with
 * `segNormal` the rear wall of the house would be built at z ∈ [-0.55, 0]
 * instead of [0, 0.55] = F.zN.  The number 0.55 = F.zN decides it.)
 *
 * A wall mesh is a box rotated by
 *
 *   yaw = atan2(-u.z, u.x)
 *
 * which sends local +X along u and local +Y up; local +Z then lands exactly on
 * n.  Every kit door/window is anchored "bottom centre of the opening, wall
 * centreline z = 0" with its INTERIOR toward +Z, so the same yaw places them
 * the right way round with no special-casing.
 *
 * An opening's `center` is measured in feet from the wall's point a, along the
 * wall.  `sill` is above that level's finished floor.
 *
 * ---------------------------------------------------------------------------
 * API
 * ---------------------------------------------------------------------------
 *   buildShell(ctx) -> handle          (ctx.level picks what gets built)
 *
 * ctx is the room-module ctx from main.js: { group, THREE, mat, tex, kit,
 * dims, quality, level }.  Everything is added to ctx.group.
 *
 * The handle is also hung on `ctx.shell` for room modules:
 *   handle.level, handle.group
 *   handle.floors   Map roomId -> Mesh
 *   handle.ceilings Map 'level' -> Mesh
 *   handle.walls    Map wallId -> Group
 *   handle.openings Array of { opening, group }
 *   handle.hideFloor(roomId) / handle.hideCeiling() / handle.hideWall(id)
 *   handle.stats    { walls, openings, floors, meshes }
 */

import {
  LEVELS, CEIL, CEIL_Y, WALL, ASSEMBLY,
  FOOTPRINTS, ROOMS, WALLS, OPENINGS,
  STEPS, COLUMNS, SKYLIGHTS, STAIRS, VOIDS,
  MASSING, SITE,
  roomsOnLevel, wallsOnLevel, openingsOnWall,
} from './dims.js';
import { applyUV } from './materials.js';
import { inch, TRIM, segDir, segLen, polyBBox } from './units.js';

const EPS = 1e-6;

/* ======================================================================== */
/* 0. Default finishes                                                       */
/* ======================================================================== */

/**
 * Floor finish per dims room id.  Read off docs/DETAILS.md; a room module is
 * free to disagree — hide the shell plate and lay its own.
 */
export const FLOOR_FINISH = {
  // ---- first floor: site-finished red oak nearly everywhere -------------
  familyRoom: 'redOakFloor',
  breakfastNook: 'redOakFloor',
  kitchen: 'redOakFloor',
  diningRoom: 'redOakFloor',
  livingRoom: 'redOakFloor',
  hallCenter: 'redOakFloor',
  hallKitchen: 'redOakFloor',
  foyer: 'redOakFloor',
  bedroom1: 'redOakFloor',
  nookPassage: 'redOakFloor',
  pantryRun: 'redOakFloor',
  bedroomVestibule: 'redOakFloor',
  foyerClosets: 'redOakFloor',
  wetBar: 'redOakFloor',
  laundry: 'lightPlankFloor',      // DETAILS: blonde LVP, NOT the red oak
  bath1: 'marbleLookTile',
  bathLinen: 'marbleLookTile',
  garage: 'concreteDriveway',

  // ---- second floor -----------------------------------------------------
  primaryBedroom: 'carpetTan',
  primaryBuiltIn: 'carpetTan',
  primaryWindowSeat: 'carpetTan',
  bedroom2: 'carpetBeige',
  bedroom3: 'carpetBeige',
  bedroom4: 'carpetBeige',
  wic: 'carpetBeige',
  hallUpper: 'carpetBeige',
  hallUpperEast: 'carpetBeige',
  hallLanding: 'redOakFloor',
  upperLinen: 'carpetBeige',
  primaryBath: 'bronzePorcelainFloor',
  primaryWC: 'bronzePorcelainFloor',
  bath2: 'marbleLookTile',
  bath3: 'marbleLookTile',
  sunroom: 'sunroomDeckSlat',

  // ---- basement ---------------------------------------------------------
  recreationRoom: 'carpetBeige',
  gym: 'rubberGymFloor',
  basementBath: 'marbleLookTile',
  utilityRoom: 'concreteDriveway',
  basementMech: 'concreteDriveway',
  basementStorageNW: 'concreteDriveway',
  basementStorageS: 'concreteDriveway',
  basementStairWell: 'carpetBeige',
};

/** Fallback floor per level, used for the gapless base plate under the walls. */
const BASE_FLOOR = { first: 'redOakFloor', second: 'carpetBeige', basement: 'carpetBeige' };

/** Rooms that get no baseboard (unfinished or wet). */
const NO_BASE = new Set(['garage', 'utilityRoom', 'basementMech', 'basementStorageNW',
  'basementStorageS', 'entryVoid', 'stairWellFirst', 'stairWellSecond']);

/* ======================================================================== */
/* 1. Small geometry helpers                                                 */
/* ======================================================================== */

/** Unit direction and inward/front normal of a plan segment. See header. */
function frame2(a, b) {
  const u = segDir(a, b);
  return { u, n: [-u[1], u[0]], len: segLen(a, b), yaw: Math.atan2(-u[1], u[0]) };
}

/**
 * A plan polygon as a THREE.Shape laid in the XZ plane.
 *
 * Shape space is (x, -z) so that a mesh rotated by rotation.x = -PI/2 lands at
 * world (x, y, z) with its face normal pointing UP and the extrude direction
 * pointing up too.  UVs come out of ShapeGeometry in shape units, i.e. FEET —
 * `planUV()` below is what turns that into a repeat.
 */
function planShape(THREE, poly, holes) {
  const s = new THREE.Shape();
  poly.forEach(([x, z], i) => (i ? s.lineTo(x, -z) : s.moveTo(x, -z)));
  s.closePath();
  if (holes && holes.length) {
    for (const h of holes) {
      const p = new THREE.Path();
      h.forEach(([x, z], i) => (i ? p.lineTo(x, -z) : p.moveTo(x, -z)));
      p.closePath();
      s.holes.push(p);
    }
  }
  return s;
}

/**
 * ShapeGeometry/ExtrudeGeometry UVs are already in feet, so the repeat is
 * simply 1 / feetPerRepeat.  applyUV computes `repeat = size / feetPerRepeat`,
 * so we hand it size = [1, 1].
 */
function planUV(mesh, feetPerRepeat) {
  return applyUV(mesh, feetPerRepeat, { size: [1, 1] });
}

/** Material by name with a visible fallback, so a typo never renders black. */
function M(ctx, name, fallback) {
  const lib = ctx.mat;
  if (lib && name && lib[name]) return lib[name];
  if (lib && fallback && lib[fallback]) return lib[fallback];
  if (!ctx.__fallbackMat) {
    ctx.__fallbackMat = new ctx.THREE.MeshStandardMaterial({ color: 0xb9b3a8, roughness: 0.9 });
    ctx.__fallbackMat.userData.keep = true;
  }
  return ctx.__fallbackMat;
}

/** Feet-per-repeat a material wants, from textures.js metadata. */
function scaleOf(material, dflt = 4) {
  const s = material && material.userData && material.userData.scaleFeet;
  return s ? [s[0], s[1]] : [dflt, dflt];
}

function mesh(THREE, geo, material, name) {
  const m = new THREE.Mesh(geo, material);
  m.castShadow = true;
  m.receiveShadow = true;
  if (name) m.name = name;
  return m;
}

/* ======================================================================== */
/* 2. Floors and ceilings                                                    */
/* ======================================================================== */

/** Floor openings that pierce THIS level's floor. */
function floorHoles(level) {
  return VOIDS.filter((v) => v.level === level).map((v) => v.poly);
}
const ABOVE = { basement: 'first', first: 'second', second: null };

function buildFloors(ctx, level, handle) {
  const { THREE } = ctx;
  const holes = floorHoles(level);
  const y = LEVELS[level];

  /* Base plate: the whole footprint, 1/8" under the finished floor. It fills
   * the bands under every wall and every door threshold, so a doorway never
   * shows a black slot where two room polygons stop at their inside faces. */
  const baseMat = M(ctx, BASE_FLOOR[level], 'redOakFloor');
  const base = mesh(
    THREE,
    new THREE.ShapeGeometry(planShape(THREE, FOOTPRINTS[level], holes)),
    baseMat,
    `shell:floorBase:${level}`
  );
  base.rotation.x = -Math.PI / 2;
  base.position.y = y - inch(1.5);
  base.castShadow = false;
  planUV(base, scaleOf(baseMat));
  ctx.group.add(base);
  handle.stats.meshes++;

  /* Per-room finish plates. */
  for (const r of roomsOnLevel(level)) {
    if (r.isVoid) continue;
    const name = FLOOR_FINISH[r.id] || BASE_FLOOR[level];
    const material = M(ctx, name, 'redOakFloor');
    const roomHoles = holes.filter((h) => polysOverlap(h, r.poly));
    const g = mesh(
      THREE,
      new THREE.ShapeGeometry(planShape(THREE, r.poly, roomHoles)),
      material,
      `shell:floor:${r.id}`
    );
    g.rotation.x = -Math.PI / 2;
    g.position.y = r.floorY;
    g.castShadow = false;
    planUV(g, scaleOf(material));
    ctx.group.add(g);
    handle.floors.set(r.id, g);
    handle.stats.floors++;
    handle.stats.meshes++;
  }
}

function polysOverlap(a, b) {
  const A = polyBBox(a);
  const B = polyBBox(b);
  return A[0] < B[2] - EPS && B[0] < A[2] - EPS && A[1] < B[3] - EPS && B[1] < A[3] - EPS;
}

/**
 * The ceiling slab.  It is a SOLID, not a plane: the probe pass proved that an
 * interior ceiling which does not cast a shadow lets the sun pour straight
 * through it (six stops of overexposure).  Extruding it also gives the reveal
 * you see at a stair void or a skylight well.
 */
function buildCeiling(ctx, level, handle) {
  const { THREE } = ctx;
  const above = ABOVE[level];
  const holes = [
    ...(above ? floorHoles(above) : []),
    ...SKYLIGHTS.filter((s) => s.level === level).map((s) => rectPolyOf(s.plan)),
  ];
  const material = M(ctx, 'ceilingPaint', 'wallPaintWhite');
  const depth = level === 'first' ? ASSEMBLY.floorJoist : 0.6;
  const geo = new THREE.ExtrudeGeometry(planShape(THREE, FOOTPRINTS[level], holes), {
    depth, bevelEnabled: false, steps: 1, curveSegments: 2,
  });
  const c = mesh(THREE, geo, material, `shell:ceiling:${level}`);
  c.rotation.x = -Math.PI / 2;
  c.position.y = CEIL_Y[level];
  planUV(c, scaleOf(material));
  ctx.group.add(c);
  handle.ceilings.set(level, c);
  handle.stats.meshes++;
}

function rectPolyOf([x0, z0, x1, z1]) {
  return [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
}

/* ======================================================================== */
/* 3. Walls                                                                  */
/* ======================================================================== */

/**
 * One wall, punched by its openings.
 *
 * The wall is emitted as solid boxes: full-height panels between openings,
 * an apron under each window sill and a header over each opening head. Nothing
 * is booleaned — the openings are genuine gaps, which is what makes a jamb
 * reveal read correctly from an oblique camera.
 */
function buildWall(ctx, w, handle) {
  const { THREE } = ctx;
  const { u, n, len, yaw } = frame2(w.a, w.b);
  if (len < 1e-4) return null;

  // Centreline: an 'outer' wall's a->b is its OUTSIDE face and it grows inward.
  const off = w.align === 'outer' ? w.t / 2 : 0;
  const ax = w.a[0] + n[0] * off;
  const az = w.a[1] + n[1] * off;
  const baseY = LEVELS[w.level] + (w.base || 0);

  const material = M(ctx, w.kind === 'foundation' ? 'concreteDriveway' : 'wallPaintWarmWhite', 'wallPaintWhite');
  const g = new THREE.Group();
  g.name = `shell:wall:${w.id}`;

  const panel = (s0, s1, y0, y1) => {
    const L = s1 - s0;
    const H = y1 - y0;
    if (L < 1e-4 || H < 1e-4) return;
    const b = mesh(THREE, new THREE.BoxGeometry(L, H, w.t), material, `${w.id}:${s0.toFixed(2)}`);
    const s = (s0 + s1) / 2;
    b.position.set(ax + u[0] * s, baseY + (y0 + y1) / 2, az + u[1] * s);
    b.rotation.y = yaw;
    applyUV(b, scaleOf(material), { axes: 'xy', size: [L, H] });
    g.add(b);
    handle.stats.meshes++;
  };

  const ops = openingsOnWall(w.id).slice().sort((p, q) => p.center - q.center);
  let cursor = 0;
  for (const o of ops) {
    const s0 = Math.max(0, o.center - o.w / 2);
    const s1 = Math.min(len, o.center + o.w / 2);
    const sill = o.sill || 0;
    const head = Math.min(w.h, sill + o.h);
    if (s0 > cursor + EPS) panel(cursor, s0, 0, w.h);
    if (sill > EPS) panel(s0, s1, 0, sill);
    if (head < w.h - EPS) panel(s0, s1, head, w.h);
    cursor = Math.max(cursor, s1);
  }
  if (cursor < len - EPS) panel(cursor, len, 0, w.h);

  ctx.group.add(g);
  handle.walls.set(w.id, g);
  handle.stats.walls++;
  return { ax, az, u, n, yaw, baseY, len };
}

/* ======================================================================== */
/* 4. Doors, windows and cased openings                                      */
/* ======================================================================== */

/** Pick a sensible window type for an opening we only know the size of. */
function windowTypeFor(o) {
  if (o.shape === 'oval') return 'oval';
  if (o.shape === 'round') return 'round';
  if (o.w >= 7.5) return 'threePanelCasement';
  if (o.h >= 5.5 && o.w >= 3.0) return 'casement';
  if (o.w <= 2.6) return 'casement';
  return 'doubleHung';
}

function buildOpeningUnit(ctx, w, o, placed, handle) {
  const { THREE, kit } = ctx;
  if (!kit) return;
  const { ax, az, u, yaw, baseY } = placed;
  const px = ax + u[0] * o.center;
  const pz = az + u[1] * o.center;
  const y = baseY + (o.sill || 0);

  let unit = null;
  try {
    if (o.type === 'window') {
      unit = kit.window(
        { w: o.w, h: o.h, type: windowTypeFor(o) },
        { wall: w.t, casing: (o.sill || 0) > 0 }
      );
    } else if (o.type === 'garageDoor') {
      unit = kit.garageDoor({ w: o.w, h: o.h });
    } else if (o.type === 'opening' || o.swing === 'cased') {
      unit = kit.doorCasing({ w: o.w, h: o.h });
      // A cased opening is trimmed on both faces.
      const back = kit.doorCasing({ w: o.w, h: o.h });
      back.rotation.y = Math.PI;
      back.position.z = -w.t;
      unit.add(back);
    } else if (o.type === 'door') {
      const isFront = /FRONT DOOR/i.test(o.note || '');
      const hand = /right/.test(o.swing || '') ? 'right' : 'left';
      if (isFront) {
        unit = kit.frontDoor({ w: o.w, h: o.h, hand, open: 0, wall: w.t, sidelights: 'none' });
      } else if (o.swing === 'slide') {
        unit = kit.slidingGlassDoor({ w: o.w, h: o.h, wall: w.t });
      } else if (o.swing === 'bifold') {
        unit = kit.bypassClosetDoors({ w: o.w, h: o.h, wall: w.t });
      } else if (o.h > 6.75 || /full-lite|glass/i.test(o.note || '')) {
        unit = kit.frenchDoor({ w: o.w, h: o.h, wall: w.t, open: 0 });
      } else {
        unit = kit.interiorDoor({ w: o.w, h: o.h, hand, open: 0, wall: w.t });
      }
    }
  } catch (err) {
    unit = null;
    if (ctx.onWarn) ctx.onWarn(`opening "${o.note || o.type}" on ${w.id}: ${(err && err.message) || err}`);
  }
  if (!unit) return;

  unit.position.set(px, y, pz);
  unit.rotation.y = yaw;
  unit.name = `shell:opening:${w.id}:${o.center}`;
  unit.traverse((n2) => {
    if (n2.isMesh) { n2.castShadow = true; n2.receiveShadow = true; }
  });
  ctx.group.add(unit);
  handle.openings.push({ opening: o, wall: w.id, group: unit });
  handle.stats.openings++;
}

/* ======================================================================== */
/* 5. Trim                                                                   */
/* ======================================================================== */

/**
 * Baseboard around every finished room.
 *
 * dims room polygons are wound CLOCKWISE in plan, which puts the room interior
 * on the path's LEFT; kit.baseboard wants it on the right, hence flip:true.
 */
function buildBaseboards(ctx, level, handle) {
  const { kit } = ctx;
  if (!kit) return;
  for (const r of roomsOnLevel(level)) {
    if (r.isVoid || NO_BASE.has(r.id)) continue;
    let b;
    try {
      b = kit.baseboard(r.poly, { closed: true, flip: true, height: TRIM.baseH });
    } catch (err) {
      if (ctx.onWarn) ctx.onWarn(`baseboard ${r.id}: ${(err && err.message) || err}`);
      continue;
    }
    b.position.y = r.floorY;
    b.name = `shell:base:${r.id}`;
    ctx.group.add(b);
    handle.trim.set(r.id, b);
    handle.stats.meshes++;
  }
}

/* ======================================================================== */
/* 6. Stairs, columns, steps, skylights, guards                              */
/* ======================================================================== */

function buildStairs(ctx, level, handle) {
  const { THREE, kit } = ctx;
  if (!kit) return;
  for (const s of Object.values(STAIRS)) {
    // Draw a flight when we are standing on either end of it: from the lower
    // level you see the whole run, from the upper level you see the top treads
    // through the well.
    if (s.fromLevel !== level && s.toLevel !== level) continue;
    let flight;
    try {
      flight = kit.straightStair({
        rise: s.rise,
        treads: s.treads,
        run: s.treadD,
        width: s.width,
        treadMaterial: M(ctx, 'redOakFloor'),
        riserMaterial: M(ctx, 'paintedOffWhite', 'wallPaintWhite'),
      });
    } catch (err) {
      if (ctx.onWarn) ctx.onWarn(`stair ${s.id}: ${(err && err.message) || err}`);
      continue;
    }
    // dims: bottom at `bottom`, ascending toward -Z. The kit ascends toward +Z.
    flight.position.set(s.bottom[0], s.bottomY, s.bottom[1]);
    flight.rotation.y = Math.PI;
    flight.name = `shell:stair:${s.id}`;
    ctx.group.add(flight);
    handle.stats.meshes++;

    if (s.guardSide) {
      try {
        const rail = kit.stairRailing({
          length: s.treads * s.treadD,
          rise: s.rise,
          height: s.handrailY,
          style: 'whiteOakBlackSquare',
        });
        // Open side is west (-X) of the flight; the rail runs with the flight.
        rail.position.set(s.bottom[0] - s.width / 2 + inch(2), s.bottomY, s.bottom[1]);
        rail.rotation.y = Math.PI;
        rail.name = `shell:stairRail:${s.id}`;
        ctx.group.add(rail);
        handle.stats.meshes++;
      } catch { /* railing is decoration; the flight matters more */ }
    }
  }
}

function buildColumns(ctx, level, handle) {
  const { kit } = ctx;
  if (!kit) return;
  for (const c of COLUMNS) {
    if (c.level !== level) continue;
    const [x0, z0, x1, z1] = c.plan;
    let col;
    try {
      col = c.style === 'turnedWoodOak'
        ? kit.turnedOakPost({ h: CEIL[level] })
        : kit.supportColumn({ h: CEIL[level], size: c.w, style: 'squarePainted' });
    } catch (err) {
      if (ctx.onWarn) ctx.onWarn(`column ${c.id}: ${(err && err.message) || err}`);
      continue;
    }
    col.position.set((x0 + x1) / 2, LEVELS[level], (z0 + z1) / 2);
    col.name = `shell:column:${c.id}`;
    ctx.group.add(col);
    handle.stats.meshes++;
  }
}

/** The 7" step down into the plan's LIVING ROOM (piece `family`). */
function buildSteps(ctx, level, handle) {
  const { THREE } = ctx;
  for (const s of STEPS) {
    if (s.level !== level) continue;
    const a = s.line[0];
    const b = s.line[1];
    const { u, n, len, yaw } = frame2(a, b);
    const hi = LEVELS[level];
    const lo = hi - s.riserH;
    const riserM = M(ctx, 'paintedOffWhite', 'wallPaintWhite');
    const treadM = M(ctx, 'redOakFloor');

    // The riser faces the low side. dropSide 'east' == +X.
    const toLow = s.dropSide === 'east' ? 1 : -1;
    const face = [n[0] * toLow, n[1] * toLow];

    const riser = mesh(THREE, new THREE.BoxGeometry(len, s.riserH, inch(1.5)), riserM,
      `shell:step:${s.id}:riser`);
    riser.position.set(
      a[0] + u[0] * len / 2 + face[0] * inch(0.75),
      lo + s.riserH / 2,
      a[1] + u[1] * len / 2 + face[1] * inch(0.75)
    );
    riser.rotation.y = yaw;
    ctx.group.add(riser);

    const nose = s.treadNosing + inch(1.5);
    const tread = mesh(THREE, new THREE.BoxGeometry(len, inch(1.25), nose), treadM,
      `shell:step:${s.id}:tread`);
    tread.position.set(
      a[0] + u[0] * len / 2 + face[0] * (nose / 2 - inch(0.1)),
      hi - inch(0.6),
      a[1] + u[1] * len / 2 + face[1] * (nose / 2 - inch(0.1))
    );
    tread.rotation.y = yaw;
    applyUV(tread, scaleOf(treadM), { axes: 'xz', size: [len, nose] });
    ctx.group.add(tread);
    handle.stats.meshes += 2;
  }
}

function buildSkylights(ctx, level, handle) {
  const { kit } = ctx;
  if (!kit) return;
  for (const s of SKYLIGHTS) {
    if (s.level !== level) continue;
    const [x0, z0, x1, z1] = s.plan;
    let well;
    try {
      well = kit.skylightWell({
        w: x1 - x0,
        l: z1 - z0,
        depth: Math.max(1.2, s.roofY - s.ceilY),
        splay: s.wellSplay,
      });
    } catch (err) {
      if (ctx.onWarn) ctx.onWarn(`skylight ${s.id}: ${(err && err.message) || err}`);
      continue;
    }
    well.position.set((x0 + x1) / 2, s.ceilY, (z0 + z1) / 2);
    well.name = `shell:skylight:${s.id}`;
    ctx.group.add(well);
    handle.stats.meshes++;
  }
}

/** Guard rails around the two-storey voids. */
function buildVoidGuards(ctx, level, handle) {
  const { kit } = ctx;
  if (!kit) return;
  for (const v of VOIDS) {
    if (v.level !== level || !v.guard) continue;
    for (let i = 0; i < v.guard.segs.length; i++) {
      const [a, b] = v.guard.segs[i];
      const { len, yaw } = frame2(a, b);
      let rail;
      try {
        rail = kit.stairRailing({ length: len, rise: 0, height: v.guard.y, style: 'whiteOakBlackSquare' });
      } catch { continue; }
      rail.position.set(a[0], LEVELS[level], a[1]);
      // stairRailing runs toward +Z; rotate it onto the segment direction.
      rail.rotation.y = yaw - Math.PI / 2;
      rail.name = `shell:guard:${v.id}:${i}`;
      ctx.group.add(rail);
      handle.stats.meshes++;
    }
  }
}

/* ======================================================================== */
/* 6b. Default ceiling lighting                                              */
/* ======================================================================== */

/**
 * CONVENTIONS §6: "Every artificial fixture is ON in every photo, even in
 * daylight." Until a room module places its real fixtures, the shell puts a
 * plain grid of recessed cans on the ceiling of every room big enough to have
 * them — without it a ceiling only ever sees the environment's floor
 * hemisphere and renders as a brown lid, which is the single most obvious tell
 * in an interior render.
 *
 * A room module that places its own fixtures MUST first call
 * `ctx.shell.removeLights(<its dims room ids>)` or the room is double-lit.
 *
 * Spot lights are expensive under software GL, so the grid is capped and the
 * cans do not cast shadows (they are fill, the sun is the key).
 */
const MAX_CANS_PER_LEVEL = 22;

function buildDefaultLights(ctx, level, handle) {
  const { THREE, lights } = ctx;
  if (!lights || typeof lights.recessedCan !== 'function') return;
  const preset = typeof lights.lightPreset === 'function' ? lights.lightPreset(level) : null;
  const canCfg = (preset && preset.can) || {};
  const ceilY = CEIL_Y[level];

  const rooms = roomsOnLevel(level)
    .filter((r) => !r.isVoid && !r.hidden && r.areaComputed > 45)
    .sort((a, b) => b.areaComputed - a.areaComputed);

  let budget = MAX_CANS_PER_LEVEL;
  const group = new THREE.Group();
  group.name = 'shell:lights';

  for (const r of rooms) {
    if (budget <= 0) break;
    const [x0, z0, x1, z1] = r.bbox;
    const w = x1 - x0;
    const d = z1 - z0;
    const nx = Math.max(1, Math.min(3, Math.round(w / 7)));
    const nz = Math.max(1, Math.min(3, Math.round(d / 7)));
    const sub = new THREE.Group();
    sub.name = `shell:lights:${r.id}`;
    for (let i = 0; i < nx && budget > 0; i++) {
      for (let j = 0; j < nz && budget > 0; j++) {
        const x = x0 + (w * (i + 0.5)) / nx;
        const z = z0 + (d * (j + 0.5)) / nz;
        const can = lights.recessedCan([x, ceilY, z], {
          intensity: canCfg.intensity === undefined ? 46 : canCfg.intensity,
          temp: canCfg.temp,
          angle: canCfg.angle,
          penumbra: canCfg.penumbra,
          castShadow: false,
          quality: ctx.quality,
        });
        can.userData.shellLight = true;
        sub.add(can);
        budget--;
      }
    }
    group.add(sub);
    handle.lights.set(r.id, sub);
  }
  ctx.group.add(group);
  handle.stats.lights = MAX_CANS_PER_LEVEL - budget;
}

/* ======================================================================== */
/* 7. Outdoor backdrop for interior cameras                                  */
/* ======================================================================== */

/**
 * Every interior photo in the set has daylight and greenery in at least one
 * window. Without this the two-storey glass wall of the family room looks out
 * on nothing at all.
 */
function buildBackdrop(ctx, handle) {
  const { THREE } = ctx;
  const g = new THREE.Group();
  g.name = 'shell:backdrop';

  const grassM = M(ctx, 'lawnGrass', 'mulchBed');
  const lawn = mesh(THREE, new THREE.PlaneGeometry(420, 420), grassM, 'shell:backdrop:lawn');
  lawn.rotation.x = -Math.PI / 2;
  lawn.position.set(28, MASSING.grade.rear, -20);
  lawn.castShadow = false;
  applyUV(lawn, scaleOf(grassM, 12), { axes: 'xz', size: [420, 420] });
  g.add(lawn);

  const trunkM = M(ctx, 'mulchBed', 'blackMatte');
  const leafM = new THREE.MeshStandardMaterial({ color: 0x546b38, roughness: 0.95 });
  leafM.userData.keep = true;
  for (const t of SITE.trees) {
    const h = t.crownTopY - t.crownBaseY;
    const trunk = mesh(THREE, new THREE.CylinderGeometry(t.trunkR * 0.8, t.trunkR, t.crownBaseY + 2, 8),
      trunkM, `shell:tree:${t.id}:trunk`);
    trunk.position.set(t.at[0], MASSING.grade.rear + (t.crownBaseY + 2) / 2, t.at[1]);
    g.add(trunk);
    for (let i = 0; i < 3; i++) {
      const r = t.canopyR * (0.62 + 0.2 * i);
      const blob = mesh(THREE, new THREE.SphereGeometry(r, 12, 8), leafM, `shell:tree:${t.id}:${i}`);
      blob.scale.y = 0.72;
      blob.position.set(
        t.at[0] + (i - 1) * t.canopyR * 0.35,
        MASSING.grade.rear + t.crownBaseY + h * (0.35 + 0.16 * i),
        t.at[1] + (1 - i) * t.canopyR * 0.3
      );
      g.add(blob);
    }
  }
  ctx.group.add(g);
  handle.stats.meshes++;
}

/* ======================================================================== */
/* 8. Exterior: massing, roofs, site                                         */
/* ======================================================================== */

function extrudePoly(THREE, poly, y0, y1, material, name) {
  const geo = new THREE.ExtrudeGeometry(planShape(THREE, poly), {
    depth: y1 - y0, bevelEnabled: false, steps: 1, curveSegments: 2,
  });
  const m = mesh(THREE, geo, material, name);
  m.rotation.x = -Math.PI / 2;
  m.position.y = y0;
  return m;
}

/**
 * A hip / shed / flat roof over an axis-aligned footprint.
 *
 * The hip is built from the polygon's bounding box: the ridge is inset from
 * both ends by (ridgeY - eaveY) * 12 / pitch, which is exactly the horizontal
 * run the hip rafters need. Two trapezoids and two triangles, plus a fascia
 * band at the eave. Non-rectangular footprints use their bbox — good enough
 * from the street, and honestly flagged here.
 */
function buildRoof(ctx, r, group) {
  const { THREE } = ctx;
  const shingle = M(ctx, 'asphaltShingle', 'blackMatte');
  const fascia = M(ctx, 'paintedOffWhite', 'wallPaintWhite');
  const [x0, z0, x1, z1] = polyBBox(r.poly);
  const o = r.overhang || 1.5;
  const ax0 = x0 - o;
  const az0 = z0 - o;
  const ax1 = x1 + o;
  const az1 = z1 + o;
  const eave = r.eaveY;
  const ridge = r.ridgeY;

  if (r.type === 'flat') {
    const cap = mesh(THREE, new THREE.BoxGeometry(ax1 - ax0, 0.35, az1 - az0), shingle, `roof:${r.id}`);
    cap.position.set((ax0 + ax1) / 2, eave + 0.175, (az0 + az1) / 2);
    group.add(cap);
    addFascia(THREE, group, ax0, az0, ax1, az1, eave, r.fasciaH || 1.2, fascia, r.id);
    return;
  }

  const pos = [];
  const push = (p) => pos.push(p[0], p[1], p[2]);
  const A = [ax0, eave, az0];
  const B = [ax1, eave, az0];
  const C = [ax1, eave, az1];
  const D = [ax0, eave, az1];

  if (r.type === 'shed') {
    // Low at the +Z (street) edge, high at the -Z (rear) edge.
    const A2 = [ax0, ridge, az0];
    const B2 = [ax1, ridge, az0];
    push(A2); push(B2); push(C); push(A2); push(C); push(D);
  } else {
    const inset = Math.min(
      ((ridge - eave) * 12) / (r.pitch || 4),
      Math.min(ax1 - ax0, az1 - az0) / 2 - 0.01
    );
    const ew = (r.ridgeDir || 'ew') === 'ew';
    const R0 = ew ? [ax0 + inset, ridge, (az0 + az1) / 2] : [(ax0 + ax1) / 2, ridge, az0 + inset];
    const R1 = ew ? [ax1 - inset, ridge, (az0 + az1) / 2] : [(ax0 + ax1) / 2, ridge, az1 - inset];
    if (ew) {
      push(A); push(B); push(R1); push(A); push(R1); push(R0);   // north slope
      push(C); push(D); push(R0); push(C); push(R0); push(R1);   // south slope
      push(A); push(R0); push(D);                                 // west hip
      push(B); push(C); push(R1);                                 // east hip
    } else {
      push(D); push(A); push(R0); push(D); push(R0); push(R1);   // west slope
      push(B); push(C); push(R1); push(B); push(R1); push(R0);   // east slope
      push(A); push(B); push(R0);                                 // north hip
      push(C); push(D); push(R1);                                 // south hip
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  // Planar UVs in feet so the shingle courses stay the right size on every slope.
  const uv = [];
  for (let i = 0; i < pos.length; i += 3) uv.push(pos[i], pos[i + 2]);
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  const m = mesh(THREE, geo, shingle, `roof:${r.id}`);
  planUV(m, scaleOf(shingle, 3));
  group.add(m);
  addFascia(THREE, group, ax0, az0, ax1, az1, eave, r.fasciaH || 1.2, fascia, r.id);
}

function addFascia(THREE, group, x0, z0, x1, z1, eave, h, material, id) {
  const t = 0.3;
  const sides = [
    [(x0 + x1) / 2, z0 - t / 2, x1 - x0 + t, t],
    [(x0 + x1) / 2, z1 + t / 2, x1 - x0 + t, t],
    [x0 - t / 2, (z0 + z1) / 2, t, z1 - z0],
    [x1 + t / 2, (z0 + z1) / 2, t, z1 - z0],
  ];
  for (let i = 0; i < sides.length; i++) {
    const [cx, cz, w, d] = sides[i];
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    b.castShadow = true;
    b.receiveShadow = true;
    b.position.set(cx, eave - h / 2, cz);
    b.name = `roof:${id}:fascia${i}`;
    group.add(b);
  }
}

function buildExterior(ctx, handle) {
  const { THREE } = ctx;
  const siding = M(ctx, 'grayLapSiding', 'wallPaintWhite');

  /* ---- ground ---------------------------------------------------------- */
  const grassM = M(ctx, 'lawnGrass', 'mulchBed');
  const lawn = mesh(THREE, new THREE.PlaneGeometry(700, 700), grassM, 'site:lawn');
  lawn.rotation.x = -Math.PI / 2;
  lawn.position.set(28, SITE.lot.grassY, -10);
  lawn.castShadow = false;
  applyUV(lawn, scaleOf(grassM, 12), { axes: 'xz', size: [700, 700] });
  ctx.group.add(lawn);
  handle.stats.meshes++;

  const hard = [
    { poly: SITE.driveway.poly, y: SITE.driveway.y, mat: 'concreteDriveway', name: 'site:driveway' },
    { poly: MASSING.patio.poly, y: MASSING.patio.topY, mat: 'bluestone', name: 'site:patio' },
    { poly: SITE.mulchBeds[0].poly, y: SITE.mulchBeds[0].y, mat: 'mulchBed', name: 'site:bed-front' },
    { poly: SITE.mulchBeds[1].poly, y: SITE.mulchBeds[1].y, mat: 'mulchBed', name: 'site:bed-front-east' },
    { poly: SITE.mulchBeds[3].poly, y: SITE.mulchBeds[3].y, mat: 'mulchBed', name: 'site:bed-rear-north' },
    { poly: MASSING.deck.main.poly, y: MASSING.deck.main.topY, mat: 'compositeDeck', name: 'site:deck-main' },
    { poly: MASSING.deck.lower.poly, y: MASSING.deck.lower.topY, mat: 'compositeDeck', name: 'site:deck-lower' },
  ];
  for (const h of hard) {
    const material = M(ctx, h.mat, 'concreteDriveway');
    const m = mesh(THREE, new THREE.ShapeGeometry(planShape(THREE, h.poly)), material, h.name);
    m.rotation.x = -Math.PI / 2;
    m.position.y = h.y;
    m.castShadow = false;
    planUV(m, scaleOf(material, 6));
    ctx.group.add(m);
    handle.stats.meshes++;
  }

  /* ---- walls of every storey, with their openings ---------------------- */
  for (const w of WALLS) {
    if (w.kind !== 'exterior' && w.kind !== 'foundation') continue;
    const placed = buildWallExterior(ctx, w, handle, siding);
    if (!placed) continue;
    for (const o of openingsOnWall(w.id)) buildOpeningUnit(ctx, w, o, placed, handle);
  }

  /* ---- one-storey wings that have no exterior-wall records ------------- */
  // The garage and living wings are inside FOOTPRINTS.first, so their outside
  // walls already exist above; what is missing is the roof over each block.
  const roofs = new THREE.Group();
  roofs.name = 'shell:roofs';
  for (const r of MASSING.roofs) buildRoof(ctx, r, roofs);
  ctx.group.add(roofs);
  handle.stats.meshes++;

  /* ---- chimney --------------------------------------------------------- */
  const ch = MASSING.chimney;
  const chim = extrudePoly(THREE, rectPolyOf(ch.plan), ch.baseY, ch.topY, siding, 'shell:chimney');
  planUV(chim, scaleOf(siding, 8));
  ctx.group.add(chim);

  /* ---- entry porch floor + post ---------------------------------------- */
  const porch = MASSING.blocks.entryPorch;
  const blue = M(ctx, 'bluestone', 'concreteDriveway');
  const pf = mesh(THREE, new THREE.ShapeGeometry(planShape(THREE, porch.poly)), blue, 'shell:porch');
  pf.rotation.x = -Math.PI / 2;
  pf.position.y = porch.floorY;
  pf.castShadow = false;
  planUV(pf, scaleOf(blue, 6));
  ctx.group.add(pf);
  const postM = M(ctx, 'blackMatte', 'wallPaintWhite');
  const post = mesh(THREE, new THREE.BoxGeometry(porch.post.w, porch.post.topY - porch.floorY, porch.post.d),
    postM, 'shell:porchPost');
  post.position.set(porch.post.at[0], (porch.floorY + porch.post.topY) / 2, porch.post.at[1]);
  ctx.group.add(post);

  /* ---- planting, fence, neighbours ------------------------------------- */
  buildBackdrop(ctx, handle);

  const nbrM = new THREE.MeshStandardMaterial({ color: 0xbfb3a0, roughness: 0.95 });
  nbrM.userData.keep = true;
  for (const n of SITE.neighbours) {
    const b = extrudePoly(THREE, n.poly, SITE.lot.grassY, n.eaveY, nbrM, `site:${n.id}`);
    ctx.group.add(b);
    const [bx0, bz0, bx1, bz1] = polyBBox(n.poly);
    buildRoof(ctx, {
      id: n.id + '-roof', type: 'hip', poly: n.poly, eaveY: n.eaveY, ridgeY: n.ridgeY,
      pitch: 6, ridgeDir: bx1 - bx0 > bz1 - bz0 ? 'ew' : 'ns', overhang: 1.2, fasciaH: 0.8,
    }, ctx.group);
  }

  const shrubM = new THREE.MeshStandardMaterial({ color: 0x4d6135, roughness: 0.95 });
  shrubM.userData.keep = true;
  for (const s of SITE.shrubs) {
    const b = mesh(THREE, new THREE.SphereGeometry(s.r, 12, 8), shrubM, `site:shrub`);
    b.scale.y = 0.85;
    b.position.set(s.at[0], SITE.lot.grassY + s.r * 0.7, s.at[1]);
    ctx.group.add(b);
  }
  for (const h of SITE.hedges) {
    const b = extrudePoly(THREE, h.poly, SITE.lot.grassY, SITE.lot.grassY + h.h, shrubM, `site:${h.id}`);
    ctx.group.add(b);
  }
}

/** Exterior-level wall: same panelling as an interior wall, siding material. */
function buildWallExterior(ctx, w, handle, siding) {
  const { THREE } = ctx;
  const { u, n, len, yaw } = frame2(w.a, w.b);
  if (len < 1e-4) return null;
  const off = w.align === 'outer' ? w.t / 2 : 0;
  const ax = w.a[0] + n[0] * off;
  const az = w.a[1] + n[1] * off;
  const baseY = LEVELS[w.level] + (w.base || 0);
  const material = w.kind === 'foundation' ? M(ctx, 'concreteDriveway') : siding;

  const g = new THREE.Group();
  g.name = `shell:extwall:${w.id}`;
  const panel = (s0, s1, y0, y1) => {
    const L = s1 - s0;
    const H = y1 - y0;
    if (L < 1e-4 || H < 1e-4) return;
    const b = mesh(THREE, new THREE.BoxGeometry(L, H, w.t), material, `${w.id}:${s0.toFixed(2)}`);
    const s = (s0 + s1) / 2;
    b.position.set(ax + u[0] * s, baseY + (y0 + y1) / 2, az + u[1] * s);
    b.rotation.y = yaw;
    applyUV(b, scaleOf(material, 8), { axes: 'xy', size: [L, H] });
    g.add(b);
    handle.stats.meshes++;
  };

  const ops = openingsOnWall(w.id).slice().sort((p, q) => p.center - q.center);
  let cursor = 0;
  for (const o of ops) {
    const s0 = Math.max(0, o.center - o.w / 2);
    const s1 = Math.min(len, o.center + o.w / 2);
    const sill = o.sill || 0;
    const head = Math.min(w.h, sill + o.h);
    if (s0 > cursor + EPS) panel(cursor, s0, 0, w.h);
    if (sill > EPS) panel(s0, s1, 0, sill);
    if (head < w.h - EPS) panel(s0, s1, head, w.h);
    cursor = Math.max(cursor, s1);
  }
  if (cursor < len - EPS) panel(cursor, len, 0, w.h);
  // Band joist / rim between storeys so the siding reads continuous.
  if (w.level === 'first') panel(0, len, w.h, w.h + ASSEMBLY.floorJoist);

  ctx.group.add(g);
  handle.walls.set(w.id, g);
  handle.stats.walls++;
  return { ax, az, u, n, yaw, baseY, len };
}

/* ======================================================================== */
/* 9. Entry points                                                           */
/* ======================================================================== */

export const meta = { id: 'shell', title: 'Building shell', level: 'all' };

/**
 * Build the shell for ctx.level.
 * @param {object} ctx room-module context from main.js
 * @returns {object} handle (also assigned to ctx.shell)
 */
export function buildShell(ctx) {
  const level = ctx.level || 'first';
  const handle = {
    level,
    group: ctx.group,
    floors: new Map(),
    ceilings: new Map(),
    walls: new Map(),
    trim: new Map(),
    lights: new Map(),
    openings: [],
    stats: { walls: 0, openings: 0, floors: 0, meshes: 0, lights: 0 },
    hideFloor(id) { const m = handle.floors.get(id); if (m) m.visible = false; return m; },
    hideCeiling(lv) { const m = handle.ceilings.get(lv || handle.level); if (m) m.visible = false; return m; },
    hideWall(id) { const g = handle.walls.get(id); if (g) g.visible = false; return g; },
    hideTrim(id) { const g = handle.trim.get(id); if (g) g.visible = false; return g; },
    /** Drop the shell's placeholder cans before placing real fixtures. */
    removeLights(...ids) {
      const list = ids.flat();
      for (const id of list.length ? list : [...handle.lights.keys()]) {
        const g = handle.lights.get(id);
        if (g && g.parent) g.parent.remove(g);
        handle.lights.delete(id);
      }
    },
  };
  ctx.shell = handle;

  if (level === 'exterior') {
    buildExterior(ctx, handle);
    return handle;
  }

  if (!(level in LEVELS)) throw new Error(`shell.js: unknown level "${level}"`);

  buildFloors(ctx, level, handle);
  buildCeiling(ctx, level, handle);

  for (const w of wallsOnLevel(level)) {
    const placed = buildWall(ctx, w, handle);
    if (!placed) continue;
    for (const o of openingsOnWall(w.id)) buildOpeningUnit(ctx, w, o, placed, handle);
  }

  buildBaseboards(ctx, level, handle);
  buildStairs(ctx, level, handle);
  buildColumns(ctx, level, handle);
  buildSteps(ctx, level, handle);
  buildSkylights(ctx, level, handle);
  buildVoidGuards(ctx, level, handle);
  buildDefaultLights(ctx, level, handle);
  if (level !== 'basement') buildBackdrop(ctx, handle);

  return handle;
}

export const build = buildShell;
export default buildShell;
