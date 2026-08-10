/**
 * app/src/core/shell.js — the interior enclosure, generated from `dims.js`.
 *
 * Floors, ceilings, walls with genuinely punched openings, the door/window
 * units that fill them, baseboard, crown, the two-storey void and its guard,
 * the sunken-living-room step, columns, skylight wells — and, for the
 * `exterior` level, massing / roofs / siding / site.
 *
 * This is the DUMB layer.  It knows nothing about any one room's decoration;
 * it produces the architecture that every room module then dresses.  Where a
 * finish is unambiguous from `docs/DETAILS.md` (red oak on the first floor,
 * carpet in the bedrooms, tile in the baths, blonde plank in the mudroom,
 * rubber in the gym) the shell lays it, INCLUDING THE RUN DIRECTION, and a room
 * module that disagrees calls `ctx.shell.hideFloor(roomId)` and lays its own.
 *
 * ---------------------------------------------------------------------------
 * CONVENTIONS THIS FILE PINS DOWN  (docs/CONVENTIONS.md §1, §3)
 * ---------------------------------------------------------------------------
 * A wall is a plan segment a -> b.  Let u = unit(b - a) in plan (x, z).
 *
 *   FRONT NORMAL   n = [-u.z, +u.x]
 *
 * That is the right-hand normal when +Z points down the page, and for the
 * clockwise-wound footprints in dims.js it is the INWARD normal — the one an
 * `align:'outer'` wall grows along from its outside face.  (The number
 * 0.55 = F.zN decides it: with the other normal the rear wall would be built at
 * z ∈ [-0.55, 0].)
 *
 * A wall mesh is a box rotated by  yaw = atan2(-u.z, u.x), which sends local +X
 * along u and local +Z onto n.  Every kit door/window is anchored "bottom
 * centre of the opening, wall centreline z = 0" with its INTERIOR toward +Z, so
 * the same yaw places them the right way round with no special-casing.
 *
 * NO RAW BoxGeometry.  Every wall panel, header, apron and jamb return is a
 * `kit.roundedBox` with a 1/8" arris — a real drywall corner bead is a bullnose
 * of about that radius, and the 1-2 px specular line it carries is the
 * difference between "drywall" and "cardboard" at 1500 px wide.
 *
 * OPENINGS ARE NOT BOOLEANED.  Each wall is emitted as the solid pieces AROUND
 * its openings — jamb panels, sill apron, header — so an opening is a genuine
 * gap.  The reveal faces of those pieces ARE the returned jamb; casing from
 * ctx.kit lands on both faces of every opening.
 *
 * ---------------------------------------------------------------------------
 * API
 * ---------------------------------------------------------------------------
 *   buildShell(ctx, { levels: ['basement','first','second'] }) -> THREE.Group
 *
 * The returned Group is already added to `ctx.group`; it also carries the
 * handle API that room modules use (main.js assigns it to `ctx.shell`):
 *
 *   .levels                  string[] actually built
 *   .floors      Map roomId    -> Mesh
 *   .ceilings    Map roomId|level -> Mesh
 *   .walls       Map wallId    -> Group
 *   .trim        Map roomId    -> Group   (baseboard)
 *   .crown       Map roomId    -> Group
 *   .lights      Map roomId    -> Group
 *   .openings    Array of { opening, wall, group }
 *   .stairs      Group from stairs.js
 *   .hideFloor(id) .hideCeiling(id) .hideWall(id) .hideTrim(id) .removeLights(...)
 *   .stats       { walls, openings, floors, meshes, lights }
 *
 * `levels` defaults to the levels that share a two-storey volume with
 * `ctx.level` — first and second are always built together, because the foyer
 * and the upper hall are ONE room from y = 0 to the vault.
 */

import {
  LEVELS, CEIL, CEIL_Y, WALL, ASSEMBLY,
  FOOTPRINTS, ROOMS, WALLS, OPENINGS, GRID,
  STEPS, COLUMNS, SKYLIGHTS, VOIDS,
  MASSING, SITE,
  roomsOnLevel, wallsOnLevel, openingsOnWall,
} from './dims.js';
import { applyUV } from './materials.js';
import { inch, ft, TRIM, DOOR, segDir, segLen, polyBBox, polyCentroid, pointInPoly } from './units.js';
import { buildStairs } from './stairs.js';

const EPS = 1e-6;
const F = GRID.first;

/* ======================================================================== */
/* 0. Default finishes — docs/DETAILS.md §G5                                 */
/* ======================================================================== */

/** Floor finish per dims room id. */
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
  stairWellFirst: 'redOakFloor',
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
  // DETAILS `upper-hall` §C: the second-floor hall is RED OAK, not carpet,
  // and it runs EAST-WEST — the opposite of the first floor.
  hallUpper: 'redOakFloor',
  hallUpperEast: 'redOakFloor',
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

/**
 * Run direction per room — docs/DETAILS.md §G5.  'ns' = boards/nap run along
 * Z (front-to-back), 'ew' = along X.  Every texture in textures.js runs its
 * grain along +U, and a floor plate's U axis is world X, so 'ns' is a 90°
 * UV rotation.  Default for the first floor is 'ns', for everything else 'ew'.
 */
export const FLOOR_RUN = {
  // first floor oak: NORTH-SOUTH, perpendicular to the front wall
  familyRoom: 'ns', breakfastNook: 'ns', kitchen: 'ns', diningRoom: 'ns',
  livingRoom: 'ns', hallCenter: 'ns', hallKitchen: 'ns', foyer: 'ns',
  bedroom1: 'ns', nookPassage: 'ns', pantryRun: 'ns', bedroomVestibule: 'ns',
  foyerClosets: 'ns', wetBar: 'ns', stairWellFirst: 'ns',
  laundry: 'ew',                    // the mudroom plank crosses the oak
  // second floor
  hallUpper: 'ew', hallUpperEast: 'ew', hallLanding: 'ew',
  primaryBedroom: 'ns',             // nap parallel to the west window wall
  primaryBuiltIn: 'ns', primaryWindowSeat: 'ns',
  bedroom2: 'ew', bedroom3: 'ew', bedroom4: 'ew', wic: 'ew',
  sunroom: 'ew',                    // slats lengthwise along the strip
  // basement: berber banding across the long (E-W) dimension
  recreationRoom: 'ns', basementStairWell: 'ns',
};

/** Fallback floor per level, used for the gapless base plate under the walls. */
const BASE_FLOOR = { first: 'redOakFloor', second: 'carpetBeige', basement: 'carpetBeige' };

/** Rooms that get no baseboard (unfinished, wet, or not a room at all). */
const NO_BASE = new Set(['garage', 'utilityRoom', 'basementMech', 'basementStorageNW',
  'basementStorageS', 'entryVoid', 'pocheDinNW', 'pocheDinNE', 'pocheDinSE',
  'pocheDinSW', 'fireplaceChase']);

/**
 * Crown molding map — docs/DETAILS.md §G4.  "Getting this map wrong is an
 * instant tell."  PRESENT in `dining`, `family`, `breakfast-nook`, `living`
 * and on the hall side of the kitchen opening; ABSENT everywhere else,
 * including the whole second floor and the whole basement.
 *
 * Remember CONVENTIONS §0.1: piece `family` is ROOMS.livingRoom and piece
 * `living` is ROOMS.familyRoom.
 */
const CROWN_ROOMS = new Set(['diningRoom', 'livingRoom', 'breakfastNook',
  'familyRoom', 'hallCenter', 'wetBar']);

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
 * Shape space is (x, -z) so a mesh rotated by rotation.x = -PI/2 lands at world
 * (x, y, z) facing UP.  UVs come out of ShapeGeometry in shape units, i.e.
 * FEET — `planUV()` is what turns that into a repeat.
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
 * simply 1 / feetPerRepeat and `size` is [1, 1].
 *
 * `run` rotates the UV frame 90° so the grain runs along Z instead of X.  With
 * three's uv transform (scale then rotate about `center`), a rotation of +PI/2
 * makes the U axis follow the geometry's V, i.e. world -Z — which is exactly a
 * north-south floor.  The repeats stay in feet-per-tile either way.
 */
function planUV(mesh, feetPerRepeat, run) {
  return applyUV(mesh, feetPerRepeat, {
    size: [1, 1],
    rotation: run === 'ns' ? Math.PI / 2 : 0,
  });
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

function rectPolyOf([x0, z0, x1, z1]) {
  return [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
}

function polysOverlap(a, b) {
  const A = polyBBox(a);
  const B = polyBBox(b);
  return A[0] < B[2] - EPS && B[0] < A[2] - EPS && A[1] < B[3] - EPS && B[1] < A[3] - EPS;
}

/**
 * DRYWALL CORNER BEAD.  A taped-and-beaded arris is a bullnose of roughly
 * 1/8"; a knife edge is one of the loudest CG tells at this resolution.
 */
const BEAD = inch(0.125);

/** Rounded-box mesh with the house's standard arris. */
function slab(ctx, w, h, d, material, name, uvAxes) {
  const { kit, THREE } = ctx;
  let m;
  if (kit && kit.roundedBox) {
    m = new THREE.Mesh(kit.roundedBox(w, h, d, BEAD, 2), material);
  } else {
    m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  }
  m.castShadow = true;
  m.receiveShadow = true;
  if (name) m.name = name;
  if (uvAxes) {
    const size = uvAxes === 'xy' ? [w, h] : uvAxes === 'xz' ? [w, d] : [d, h];
    applyUV(m, scaleOf(material), { axes: uvAxes, size });
  }
  return m;
}

/* ======================================================================== */
/* 2. Floors                                                                 */
/* ======================================================================== */

/** Floor openings that pierce THIS level's floor. */
function floorHoles(level) {
  return VOIDS.filter((v) => v.level === level).map((v) => v.poly);
}

/**
 * Clip hole polygons to a footprint contour.
 *
 * THREE.ShapeGeometry does not intersect holes with their outer contour — it
 * triangulates on the assumption that every hole lies strictly inside. A hole
 * that crosses the contour silently produces overlapping, flipped triangles
 * instead of an opening. That is exactly what happened to the two-storey entry:
 * VOIDS.entryVoid runs to z 44.593, but the first-floor footprint is notched at
 * the entry oversail (x 27.25-39.667 stops at z 42.309), so the void crossed the
 * edge and the foyer got capped by a solid 8.5 ft ceiling — the stair climbed
 * into it and the vault above was unreachable. Measured proof at the time: the
 * first-floor deck triangulated to 2818.6 sf against a 2455.0 sf expectation,
 * i.e. MORE area than the uncut footprint.
 *
 * The holes are not all rectangles — entryVoid is an L (6 vertices) — so the
 * intersection is clipped as a polygon, by half-plane. Plain Sutherland-Hodgman
 * against every contour edge would be wrong here, because a rectilinear footprint
 * is NOT convex and clipping by all of its half-planes collapses it to its convex
 * hull. So only the edges the hole actually crosses are applied, and only while
 * they reduce the number of vertices lying outside. The result is exact when a
 * hole crosses a single edge (the real case), and degrades safely otherwise: the
 * output is always inside the contour, and if it cannot be made so the hole is
 * dropped rather than left to corrupt the whole plate.
 *
 * @param {number[][][]} holes    hole polygons, each [[x,z],...]
 * @param {number[][]}   contour  the outer footprint polygon
 * @returns {number[][][]} holes clipped to lie inside `contour`
 */
function clipHolesTo(holes, contour) {
  if (!contour || !contour.length) return holes;
  const EPS = 1e-6;
  const areaOf = (p) => {
    let a = 0;
    for (let i = 0, n = p.length; i < n; i++) {
      const [x0, z0] = p[i]; const [x1, z1] = p[(i + 1) % n];
      a += x0 * z1 - x1 * z0;
    }
    return a / 2;
  };
  // Interior lies to the LEFT of each directed edge for a CCW contour.
  const ccw = areaOf(contour) > 0;
  /**
   * Count vertices genuinely outside the contour.
   *
   * Clipping leaves vertices lying EXACTLY on a contour edge, where pointInPoly
   * is ambiguous and typically answers "outside". Taken at face value that makes
   * a correctly-clipped hole look like a failure and it gets dropped. So a vertex
   * that tests outside is retested a hair toward the hole's own centroid: still
   * outside means really outside, inside means it was only sitting on the edge.
   */
  const outsideCount = (p) => {
    let cx = 0; let cz = 0;
    for (const [x, z] of p) { cx += x; cz += z; }
    cx /= p.length; cz /= p.length;
    let n = 0;
    for (const [x, z] of p) {
      if (pointInPoly(x, z, contour)) continue;
      const t = 1e-3; // ft — 0.012", far below any construction dimension
      if (!pointInPoly(x + (cx - x) * t, z + (cz - z) * t, contour)) n++;
    }
    return n;
  };

  /** Sutherland-Hodgman clip of `poly` by the half-plane inside edge A->B. */
  const clipHalf = (poly, [ax, az], [bx, bz]) => {
    let nx = -(bz - az); let nz = bx - ax;          // left normal
    if (!ccw) { nx = -nx; nz = -nz; }
    const side = ([x, z]) => (x - ax) * nx + (z - az) * nz;
    const out = [];
    for (let i = 0, n = poly.length; i < n; i++) {
      const P = poly[i]; const Q = poly[(i + 1) % n];
      const sp = side(P); const sq = side(Q);
      if (sp >= -EPS) out.push(P);
      if ((sp > EPS && sq < -EPS) || (sp < -EPS && sq > EPS)) {
        const t = sp / (sp - sq);
        out.push([P[0] + (Q[0] - P[0]) * t, P[1] + (Q[1] - P[1]) * t]);
      }
    }
    return out;
  };

  const out = [];
  for (const hole of holes) {
    if (!hole || hole.length < 3) continue;
    let poly = hole.map(([x, z]) => [x, z]);
    let bad = outsideCount(poly);
    if (bad === 0) { out.push(hole); continue; }

    for (let pass = 0; pass < contour.length * 2 && bad > 0; pass++) {
      let improved = false;
      for (let i = 0; i < contour.length; i++) {
        const cand = clipHalf(poly, contour[i], contour[(i + 1) % contour.length]);
        if (cand.length < 3) continue;
        const candBad = outsideCount(cand);
        if (candBad < bad && Math.abs(areaOf(cand)) > 0.01) {
          poly = cand; bad = candBad; improved = true;
        }
      }
      if (!improved) break;
    }

    if (bad === 0 && poly.length >= 3 && Math.abs(areaOf(poly)) > 0.01) out.push(poly);
  }
  return out;
}
const ABOVE = { basement: 'first', first: 'second', second: null };

function buildFloors(ctx, level, handle) {
  const { THREE } = ctx;
  const holes = clipHolesTo(floorHoles(level), FOOTPRINTS[level]);
  const y = LEVELS[level];

  /* Base plate: the whole footprint, 1-1/2" under the finished floor.  It fills
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
  planUV(base, scaleOf(baseMat), level === 'first' ? 'ns' : 'ew');
  ctx.group.add(base);
  handle.stats.meshes++;

  /* Per-room finish plates — each is its own mesh so a room module can hide it
   * and lay its own, and each is UV'd to real-world size AND run direction. */
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
    planUV(g, scaleOf(material), FLOOR_RUN[r.id] || (level === 'first' ? 'ns' : 'ew'));
    ctx.group.add(g);
    handle.floors.set(r.id, g);
    handle.stats.floors++;
    handle.stats.meshes++;
  }
}

/* ======================================================================== */
/* 3. Ceilings — deck, per-room plates, and the entry vault                  */
/* ======================================================================== */

/** True when a room's floor plate is (partly) missing because of a void above. */
function openAbove(room) {
  const above = ABOVE[room.level];
  if (!above) {
    // the second floor's own ceiling is cut by the entry vault
    return VOIDS.some((v) => v.level === 'second' && v.ceiling && polysOverlap(v.poly, room.poly));
  }
  return floorHoles(above).some((h) => polysOverlap(h, room.poly));
}

/**
 * The ceiling assembly.
 *
 * `deck` is a SOLID extrusion, not a plane: the probe pass proved that an
 * interior ceiling which does not cast a shadow lets the sun pour straight
 * through it.  Extruding it also gives the reveal you see at a stair void or a
 * skylight well.  On top of the deck each room gets its own thin finish plate
 * 1/16" below, so a room module can swap a ceiling without touching the
 * structure and without leaving a hole for the light.
 */
function buildCeilings(ctx, level, handle) {
  const { THREE } = ctx;
  const above = ABOVE[level];
  const vaults = VOIDS.filter((v) => v.level === 'second' && v.ceiling);

  const holes = clipHolesTo([
    ...(above ? floorHoles(above) : []),
    ...SKYLIGHTS.filter((s) => s.level === level && !s.slope).map((s) => rectPolyOf(s.plan)),
    // the two-storey entry is capped by its vault, not by the flat deck
    ...(level === 'second' ? vaults.map((v) => v.poly) : []),
  ], FOOTPRINTS[level]);
  const material = M(ctx, 'ceilingPaint', 'wallPaintWhite');
  const depth = level === 'first' ? ASSEMBLY.floorJoist : 0.6;
  const geo = new THREE.ExtrudeGeometry(planShape(THREE, FOOTPRINTS[level], holes), {
    depth, bevelEnabled: false, steps: 1, curveSegments: 2,
  });
  const c = mesh(THREE, geo, material, `shell:ceilingDeck:${level}`);
  c.rotation.x = -Math.PI / 2;
  c.position.y = CEIL_Y[level];
  planUV(c, scaleOf(material));
  ctx.group.add(c);
  handle.ceilings.set(level, c);
  handle.stats.meshes++;

  /* Per-room finish plates. */
  for (const r of roomsOnLevel(level)) {
    if (r.isVoid || r.poche || openAbove(r)) continue;
    const skys = SKYLIGHTS.filter((s) => s.level === level && s.room === r.id && !s.slope)
      .map((s) => rectPolyOf(s.plan));
    const p = mesh(
      THREE,
      new THREE.ShapeGeometry(planShape(THREE, r.poly, skys)),
      material,
      `shell:ceiling:${r.id}`
    );
    p.rotation.x = -Math.PI / 2;
    p.position.y = r.ceilY - inch(0.0625);
    p.castShadow = false;
    planUV(p, scaleOf(material));
    ctx.group.add(p);
    handle.ceilings.set(r.id, p);
    handle.stats.meshes++;
  }

  if (level === 'second') for (const v of vaults) buildVault(ctx, v, handle);
}

/** Height of a trayShed vault at a given z. */
function vaultY(cfg, z) {
  const t = (z - cfg.lowZ) / Math.max(cfg.highZ - cfg.lowZ, EPS);
  return cfg.lowY + (cfg.highY - cfg.lowY) * Math.min(1, Math.max(0, t));
}

/**
 * The vaulted ceiling over the two-storey entry / stair hall, with its slot
 * skylight and the white boxed beam that crosses it
 * (`hallway_top_of_stairs_looking_down_at_front_door.png`).
 *
 * Built as a triangulated sloped plane rather than an extrusion, because the
 * plane is not horizontal; it is double-sided so it still occludes the sun.
 */
function buildVault(ctx, v, handle) {
  const { THREE } = ctx;
  const cfg = v.ceiling;
  const slots = SKYLIGHTS.filter((s) => s.slope && polysOverlap(rectPolyOf(s.plan), v.poly));

  const shape = planShape(THREE, v.poly, slots.map((s) => rectPolyOf(s.plan)));
  const geo = new THREE.ShapeGeometry(shape, 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    // local (x, y) with y = -worldZ; local z becomes world Y after the -90° X spin
    pos.setZ(i, vaultY(cfg, -pos.getY(i)));
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();

  const base = M(ctx, 'ceilingPaint', 'wallPaintWhite');
  const twoSided = base.clone();
  twoSided.userData = Object.assign({}, base.userData);
  twoSided.side = THREE.DoubleSide;
  twoSided.userData.keep = true;
  const m = mesh(THREE, geo, twoSided, `shell:vault:${v.id}`);
  m.rotation.x = -Math.PI / 2;
  planUV(m, scaleOf(base));
  ctx.group.add(m);
  handle.ceilings.set(`vault:${v.id}`, m);
  handle.stats.meshes++;

  /* Slot skylight wells: four splayed white cheeks from the sloped rim up to a
   * rectangle at the roof deck, capped with glazing. */
  for (const s of slots) buildSlotWell(ctx, s, cfg, handle);

  /* The white boxed beam across the vault. */
  if (cfg.beam) {
    const [x0, , x1] = polyBBox(v.poly);
    const bz = cfg.beam.at;
    const trim = M(ctx, 'paintedOffWhite', 'wallPaintWhite');
    const beam = slab(ctx, x1 - x0, cfg.beam.d, cfg.beam.w, trim, `shell:vaultBeam:${v.id}`, 'xy');
    beam.position.set((x0 + x1) / 2, vaultY(cfg, bz) - cfg.beam.d / 2, bz);
    ctx.group.add(beam);
    handle.stats.meshes++;
  }
}

/** Splayed light shaft for a slot skylight cut into a sloped ceiling. */
function buildSlotWell(ctx, s, cfg, handle) {
  const { THREE } = ctx;
  const [x0, z0, x1, z1] = s.plan;
  const sp = s.wellSplay || 0.7;
  const roofY = s.roofY;
  const B = [
    [x0, vaultY(cfg, z0), z0], [x1, vaultY(cfg, z0), z0],
    [x1, vaultY(cfg, z1), z1], [x0, vaultY(cfg, z1), z1],
  ];
  const T = [
    [x0 + sp, roofY, z0 + sp], [x1 - sp, roofY, z0 + sp],
    [x1 - sp, roofY, z1 - sp], [x0 + sp, roofY, z1 - sp],
  ];
  const p = [];
  const uv = [];
  const push = (a) => { p.push(a[0], a[1], a[2]); uv.push(a[0], a[2]); };
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    push(B[i]); push(B[j]); push(T[j]);
    push(B[i]); push(T[j]); push(T[i]);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  const base = M(ctx, 'paintedOffWhite', 'wallPaintWhite');
  const two = base.clone();
  two.userData = Object.assign({}, base.userData);
  two.side = THREE.DoubleSide;
  two.userData.keep = true;
  const well = mesh(THREE, geo, two, `shell:skylightWell:${s.id}`);
  well.castShadow = false;
  ctx.group.add(well);

  const glassM = M(ctx, 'clearGlass', 'frostedGlass');
  const glass = mesh(THREE, new THREE.PlaneGeometry(x1 - x0 - 2 * sp, z1 - z0 - 2 * sp),
    glassM, `shell:skylightGlass:${s.id}`);
  glass.rotation.x = -Math.PI / 2;
  glass.position.set((x0 + x1) / 2, roofY, (z0 + z1) / 2);
  glass.castShadow = false;
  ctx.group.add(glass);
  handle.stats.meshes += 2;
}

/**
 * The oversail deck over the recessed entry porch.
 *
 * MASSING.blocks.entryBox cantilevers 2'-10" forward of the first-floor entry
 * wall, so the two-storey foyer steps FORWARD above the door head: the front
 * wall you see from the second floor (with the oval) is 2'-10" nearer the
 * street than the wall the front door is in.  Without this slab there is a
 * 1 ft slot straight to the outdoors above the front door.
 */
function buildEntryOversail(ctx, handle) {
  const trim = M(ctx, 'ceilingPaint', 'wallPaintWhite');
  const zIn = F.zFoyS;                 // inside face of the first-floor entry wall
  const zOut = MASSING.blocks.entryBox.poly[2][1]; // 45.143, outside face above
  const d = zOut - zIn;
  const w = F.xGarWo - F.xFoyW;
  const s = slab(ctx, w, ASSEMBLY.floorJoist, d, trim, 'shell:entryOversailDeck', 'xz');
  s.position.set((F.xFoyW + F.xGarWo) / 2, CEIL_Y.first + ASSEMBLY.floorJoist / 2, zIn + d / 2);
  ctx.group.add(s);
  handle.stats.meshes++;
}

/* ======================================================================== */
/* 4. Walls                                                                  */
/* ======================================================================== */

/**
 * One wall, punched by its openings.
 *
 * Emitted as solid pieces: full-height jamb panels between openings, an apron
 * under each window sill, a header over each opening.  Nothing is booleaned, so
 * the reveal faces are real surfaces with a real corner bead — which is what
 * makes a jamb read correctly from an oblique camera.
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

  const material = M(ctx, 'wallPaintWarmWhite', 'wallPaintWhite');
  const g = new THREE.Group();
  g.name = `shell:wall:${w.id}`;

  const panel = (s0, s1, y0, y1, tag) => {
    const L = s1 - s0;
    const H = y1 - y0;
    if (L < 1e-4 || H < 1e-4) return;
    const b = slab(ctx, L, H, w.t, material, `${w.id}:${tag}`, 'xy');
    const s = (s0 + s1) / 2;
    b.position.set(ax + u[0] * s, baseY + (y0 + y1) / 2, az + u[1] * s);
    b.rotation.y = yaw;
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
    if (s0 > cursor + EPS) panel(cursor, s0, 0, w.h, `pier${s0.toFixed(2)}`);
    if (sill > EPS) panel(s0, s1, 0, sill, `apron${s0.toFixed(2)}`);
    if (head < w.h - EPS) panel(s0, s1, head, w.h, `header${s0.toFixed(2)}`);
    cursor = Math.max(cursor, s1);
  }
  if (cursor < len - EPS) panel(cursor, len, 0, w.h, 'pierEnd');

  /* Band joist.  A first-floor exterior wall must carry on past the ceiling
   * plane or the two-storey foyer shows a 1 ft slot to daylight above the
   * front door, and the family room's glass box shows one above its head. */
  if (w.level === 'first' && (w.kind === 'exterior' || w.kind === 'fire')) {
    panel(0, len, w.h, w.h + ASSEMBLY.floorJoist, 'rim');
  }

  ctx.group.add(g);
  handle.walls.set(w.id, g);
  handle.stats.walls++;
  return { ax, az, u, n, yaw, baseY, len };
}

/* ======================================================================== */
/* 5. Doors, windows and cased openings                                      */
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
  const { kit } = ctx;
  if (!kit) return;
  const { ax, az, u, yaw, baseY } = placed;
  const px = ax + u[0] * o.center;
  const pz = az + u[1] * o.center;
  const y = baseY + (o.sill || 0);
  const outward = /-out$/.test(o.swing || '');

  let unit = null;
  try {
    if (o.type === 'window') {
      const shutters = /shutter/i.test(o.note || '');
      unit = kit.window(
        { w: o.w, h: o.h, type: windowTypeFor(o), lites: o.w > 3.2 ? 2 : 1 },
        {
          wall: w.t,
          casing: true,
          shutters: shutters ? { divider: 0.52, tilt: 0.42 } : false,
        }
      );
    } else if (o.type === 'garageDoor') {
      unit = kit.garageDoor({ w: o.w, h: o.h });
    } else if (o.type === 'opening' || o.swing === 'cased') {
      unit = casedOpening(ctx, o, w);
    } else if (o.type === 'door') {
      const isFront = /FRONT DOOR/i.test(o.note || '');
      const hand = /right/.test(o.swing || '') ? 'right' : 'left';
      if (isFront) {
        unit = kit.frontDoor({ w: o.w, h: o.h, hand, open: 0, wall: w.t, sidelights: 'none' });
      } else if (o.swing === 'slide') {
        unit = kit.slidingGlassDoor({ w: o.w, h: o.h, wall: w.t });
      } else if (o.swing === 'bifold' || o.swing === 'bypass') {
        unit = kit.bypassClosetDoors({ w: o.w, h: o.h, wall: w.t, panels: o.w > 4.5 ? 2 : 2 });
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
  // '-out' hangs the leaf on the far face; rotating the whole unit keeps the
  // jamb, stop and casing consistent with the swing.
  unit.rotation.y = outward ? yaw + Math.PI : yaw;
  unit.name = `shell:opening:${w.id}:${o.center}`;
  unit.traverse((n2) => {
    if (n2.isMesh) { n2.castShadow = true; n2.receiveShadow = true; }
  });
  ctx.group.add(unit);
  handle.openings.push({ opening: o, wall: w.id, group: unit });
  handle.stats.openings++;
}

/**
 * A cased opening: drywall returns lining the reveal plus flat casing on BOTH
 * faces.  The wall pieces around the hole already give a beaded arris, so the
 * return here is a thin liner that carries the paint into the opening and stops
 * the header's underside from reading as a bare board edge.
 */
function casedOpening(ctx, o, w) {
  const { THREE, kit } = ctx;
  const g = new THREE.Group();
  g.userData.anchor = 'bottom centre of the opening, wall centreline z = 0';
  const paint = M(ctx, 'wallPaintWarmWhite', 'wallPaintWhite');
  const t = inch(0.6);

  // head return
  const head = slab(ctx, o.w + 2 * t, t, w.t, paint, 'casedHead', 'xz');
  head.position.set(0, o.h + t / 2 - inch(0.05), 0);
  g.add(head);
  // side returns
  for (const s of [-1, 1]) {
    const leg = slab(ctx, t, o.h, w.t, paint, 'casedJamb', 'zy');
    leg.position.set(s * (o.w / 2 + t / 2 - inch(0.05)), o.h / 2, 0);
    g.add(leg);
  }
  // casing on both faces
  for (const s of [1, -1]) {
    const c = kit.doorCasing({ w: o.w + 2 * t, h: o.h + t });
    c.position.z = (s * w.t) / 2;
    if (s < 0) c.rotation.y = Math.PI;
    g.add(c);
  }
  return g;
}

/* ======================================================================== */
/* 6. Trim — baseboard cut at every opening, crown only where it belongs      */
/* ======================================================================== */

/**
 * Every door-height opening that lands on this room's boundary, as intervals of
 * arc length along the room polygon.  Without this the baseboard runs straight
 * across every doorway — which is instantly wrong and instantly visible.
 */
function baseCuts(room) {
  const cuts = [];
  const loop = loopParam(room.poly);
  const margin = TRIM.caseW + inch(0.5);   // the base dies into the casing

  for (const o of OPENINGS) {
    if ((o.sill || 0) > 0.05) continue;    // windows do not cut the base
    const w = WALLS.find((x) => x.id === o.wall);
    if (!w || w.level !== room.level) continue;
    const { u, n, len } = frame2(w.a, w.b);
    const off = w.align === 'outer' ? w.t / 2 : 0;
    const ax = w.a[0] + n[0] * off;
    const az = w.a[1] + n[1] * off;
    const c0 = Math.max(0, o.center - o.w / 2 - margin);
    const c1 = Math.min(len, o.center + o.w / 2 + margin);
    const p0 = [ax + u[0] * c0, az + u[1] * c0];
    const p1 = [ax + u[0] * c1, az + u[1] * c1];

    for (let i = 0; i < loop.seg.length; i++) {
      const sg = loop.seg[i];
      const ue = [(sg.B[0] - sg.A[0]) / sg.L, (sg.B[1] - sg.A[1]) / sg.L];
      if (Math.abs(ue[0] * u[1] - ue[1] * u[0]) > 0.02) continue;   // not parallel
      const perp = [-ue[1], ue[0]];
      const d0 = (p0[0] - sg.A[0]) * perp[0] + (p0[1] - sg.A[1]) * perp[1];
      if (Math.abs(d0) > w.t / 2 + 0.06) continue;                  // not this face
      let s0 = (p0[0] - sg.A[0]) * ue[0] + (p0[1] - sg.A[1]) * ue[1];
      let s1 = (p1[0] - sg.A[0]) * ue[0] + (p1[1] - sg.A[1]) * ue[1];
      if (s0 > s1) { const t = s0; s0 = s1; s1 = t; }
      s0 = Math.max(0, s0);
      s1 = Math.min(sg.L, s1);
      if (s1 - s0 < 0.05) continue;
      cuts.push([sg.t0 + s0, sg.t0 + s1]);
    }
  }
  return { loop, cuts };
}

function loopParam(poly) {
  const seg = [];
  let total = 0;
  for (let i = 0; i < poly.length; i++) {
    const A = poly[i];
    const B = poly[(i + 1) % poly.length];
    const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
    if (L < 1e-6) continue;
    seg.push({ A, B, L, t0: total });
    total += L;
  }
  return { seg, total };
}

function pointAtParam(loop, t) {
  let x = ((t % loop.total) + loop.total) % loop.total;
  for (const sg of loop.seg) {
    if (x <= sg.t0 + sg.L + 1e-9) {
      const d = Math.max(0, x - sg.t0);
      const u = [(sg.B[0] - sg.A[0]) / sg.L, (sg.B[1] - sg.A[1]) / sg.L];
      return [sg.A[0] + u[0] * d, sg.A[1] + u[1] * d];
    }
  }
  const last = loop.seg[loop.seg.length - 1];
  return [last.B[0], last.B[1]];
}

/** Split a closed plan loop into the runs that survive a set of cut intervals. */
function splitLoop(loop, cutsIn) {
  if (!cutsIn.length) return { closed: true, runs: [loop.seg.map((s) => s.A)] };
  const cuts = cutsIn.slice().sort((a, b) => a[0] - b[0]);
  const merged = [cuts[0].slice()];
  for (let i = 1; i < cuts.length; i++) {
    const last = merged[merged.length - 1];
    if (cuts[i][0] <= last[1] + 1e-6) last[1] = Math.max(last[1], cuts[i][1]);
    else merged.push(cuts[i].slice());
  }
  const runs = [];
  for (let i = 0; i < merged.length; i++) {
    const a = merged[i][1];
    const b = (i + 1 < merged.length) ? merged[i + 1][0] : merged[0][0] + loop.total;
    if (b - a < 0.05) continue;
    const pts = [pointAtParam(loop, a)];
    for (const sg of loop.seg) {
      for (const tv of [sg.t0, sg.t0 + loop.total]) {
        if (tv > a + 1e-6 && tv < b - 1e-6) pts.push([sg.A[0], sg.A[1]]);
      }
    }
    pts.push(pointAtParam(loop, b));
    // drop duplicate consecutive points
    const clean = pts.filter((p, k) => k === 0 ||
      Math.hypot(p[0] - pts[k - 1][0], p[1] - pts[k - 1][1]) > 1e-4);
    if (clean.length >= 2) runs.push(clean);
  }
  return { closed: false, runs };
}

/**
 * Baseboard on every wall run, mitered at the corners, scribed to the floor,
 * and STOPPED at every door and cased opening.  docs/DETAILS.md §G4: white
 * satin, 5-1/4" on floors 1 and 2, 4-1/2" in the basement, no shoe mould.
 *
 * dims room polygons are wound CLOCKWISE in plan, which puts the interior on
 * the path's left; kit.baseboard wants it on the right, hence flip:true.
 */
function buildBaseboards(ctx, level, handle) {
  const { kit } = ctx;
  if (!kit) return;
  const h = level === 'basement' ? inch(4.5) : inch(5.25);
  for (const r of roomsOnLevel(level)) {
    if (r.isVoid || r.poche || NO_BASE.has(r.id)) continue;
    const { loop, cuts } = baseCuts(r);
    const { closed, runs } = splitLoop(loop, cuts);
    const g = new ctx.THREE.Group();
    g.name = `shell:base:${r.id}`;
    for (const path of runs) {
      try {
        const b = kit.baseboard(path, { closed, flip: true, height: h, shoe: false });
        g.add(b);
      } catch (err) {
        if (ctx.onWarn) ctx.onWarn(`baseboard ${r.id}: ${(err && err.message) || err}`);
      }
    }
    g.position.y = r.floorY;
    ctx.group.add(g);
    handle.trim.set(r.id, g);
    handle.stats.meshes++;
  }
}

/** Crown molding, only in the rooms that actually have it. */
function buildCrown(ctx, level, handle) {
  const { kit } = ctx;
  if (!kit) return;
  for (const r of roomsOnLevel(level)) {
    if (!CROWN_ROOMS.has(r.id)) continue;
    let c;
    try {
      c = kit.crownMolding(r.poly, {
        closed: true, flip: true, profile: 'stepped', height: inch(4.6),
      });
    } catch (err) {
      if (ctx.onWarn) ctx.onWarn(`crown ${r.id}: ${(err && err.message) || err}`);
      continue;
    }
    c.position.y = r.ceilY;
    c.name = `shell:crown:${r.id}`;
    ctx.group.add(c);
    handle.crown.set(r.id, c);
    handle.stats.meshes++;
  }
}

/* ======================================================================== */
/* 7. Columns, steps, skylights, guards                                      */
/* ======================================================================== */

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
  for (const s of STEPS) {
    if (s.level !== level) continue;
    const a = s.line[0];
    const b = s.line[1];
    const { u, n, len, yaw } = frame2(a, b);
    const hi = LEVELS[level];
    const lo = hi - s.riserH;
    const riserM = M(ctx, 'paintedOffWhite', 'wallPaintWhite');
    const treadM = M(ctx, 'redOakFloor');

    const toLow = s.dropSide === 'east' ? 1 : -1;
    const face = [n[0] * toLow, n[1] * toLow];

    const riser = slab(ctx, len, s.riserH, inch(1.5), riserM, `shell:step:${s.id}:riser`, 'xy');
    riser.position.set(
      a[0] + (u[0] * len) / 2 + face[0] * inch(0.75),
      lo + s.riserH / 2,
      a[1] + (u[1] * len) / 2 + face[1] * inch(0.75)
    );
    riser.rotation.y = yaw;
    ctx.group.add(riser);

    const nose = s.treadNosing + inch(1.5);
    const tread = slab(ctx, len, inch(1.25), nose, treadM, `shell:step:${s.id}:tread`, 'xz');
    tread.position.set(
      a[0] + (u[0] * len) / 2 + face[0] * (nose / 2 - inch(0.1)),
      hi - inch(0.6),
      a[1] + (u[1] * len) / 2 + face[1] * (nose / 2 - inch(0.1))
    );
    tread.rotation.y = yaw;
    ctx.group.add(tread);
    handle.stats.meshes += 2;
  }
}

function buildSkylights(ctx, level, handle) {
  const { kit } = ctx;
  if (!kit) return;
  for (const s of SKYLIGHTS) {
    if (s.level !== level || s.slope) continue;   // sloped slots live in the vault
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

/**
 * Guard rail around a two-storey void, plus the painted balcony fascia under
 * it.  `hallway_top_of_stairs...`: white fascia with a base cap, oak rail with
 * black square balusters, and the run turns down with the flight.
 */
function buildVoidGuards(ctx, level, handle) {
  const { kit, THREE } = ctx;
  if (!kit) return;
  for (const v of VOIDS) {
    if (v.level !== level || !v.guard) continue;
    const oak = (kit.materials && kit.materials.whiteOak) || M(ctx, 'redOakFloor');
    for (let i = 0; i < v.guard.segs.length; i++) {
      const [a, b] = v.guard.segs[i];
      const { len, yaw } = frame2(a, b);
      // The second run of the entry guard is the stair rake; stairs.js owns it.
      const isRake = Math.abs(a[1] - b[1]) > 0.01 && Math.abs(a[0] - b[0]) < 0.01
        && Math.abs(a[0] - F.xStrW) < 0.01;
      if (isRake) continue;
      let rail;
      try {
        rail = kit.stairRailing({
          length: len, rise: 0, height: v.guard.y,
          style: 'whiteOakBlackSquare', spacing: inch(4.125), railMaterial: oak,
        });
      } catch { continue; }
      rail.position.set(a[0], LEVELS[level], a[1]);
      rail.rotation.y = yaw - Math.PI / 2;   // the kit rail runs toward +Z
      rail.name = `shell:guard:${v.id}:${i}`;
      ctx.group.add(rail);
      handle.stats.meshes++;

      // Balcony fascia: the painted board that closes the floor edge below.
      const trim = M(ctx, 'paintedOffWhite', 'wallPaintWhite');
      const fasciaH = ASSEMBLY.floorJoist;
      const fa = slab(ctx, len, fasciaH, inch(0.9), trim, `shell:guardFascia:${v.id}:${i}`, 'xy');
      const { u, n } = frame2(a, b);
      fa.position.set(
        a[0] + (u[0] * len) / 2 - n[0] * inch(0.45),
        LEVELS[level] - fasciaH / 2,
        a[1] + (u[1] * len) / 2 - n[1] * inch(0.45)
      );
      fa.rotation.y = yaw;
      ctx.group.add(fa);
      handle.stats.meshes++;
    }
  }
}

/* ======================================================================== */
/* 8. Default ceiling lighting                                               */
/* ======================================================================== */

/**
 * CONVENTIONS §6: "Every artificial fixture is ON in every photo, even in
 * daylight."  Until a room module places its real fixtures the shell puts a
 * plain grid of recessed cans on the ceiling of every room big enough to have
 * them — without it a ceiling only ever sees the environment's floor hemisphere
 * and renders as a brown lid.
 *
 * A room module that places its own fixtures MUST first call
 * `ctx.shell.removeLights(<its dims room ids>)` or the room is double-lit.
 */
const MAX_CANS_PER_LEVEL = 22;

function buildDefaultLights(ctx, level, handle) {
  const { THREE, lights } = ctx;
  if (!lights || typeof lights.recessedCan !== 'function') return;
  const preset = typeof lights.lightPreset === 'function' ? lights.lightPreset(level) : null;
  const canCfg = (preset && preset.can) || {};

  const rooms = roomsOnLevel(level)
    .filter((r) => !r.isVoid && !r.hidden && !r.poche && r.areaComputed > 45)
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
    const ceilY = openAbove(r) ? CEIL_Y[level] : r.ceilY;
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
/* 9. Outdoor backdrop for interior cameras                                  */
/* ======================================================================== */

/**
 * Every interior photo in the set has daylight and greenery in at least one
 * window.  Without this the two-storey glass wall of the family room looks out
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
  // Neighbouring rooflines, seen through the foyer shutters and the oval.
  const nbrM = new THREE.MeshStandardMaterial({ color: 0xbfb3a0, roughness: 0.95 });
  nbrM.userData.keep = true;
  const roofM = new THREE.MeshStandardMaterial({ color: 0x6a5a4a, roughness: 0.92 });
  roofM.userData.keep = true;
  for (const n of SITE.neighbours) {
    const [x0, z0, x1, z1] = polyBBox(n.poly);
    const body = mesh(THREE, new THREE.BoxGeometry(x1 - x0, n.eaveY - SITE.lot.grassY, z1 - z0),
      nbrM, `shell:nbr:${n.id}`);
    body.position.set((x0 + x1) / 2, (SITE.lot.grassY + n.eaveY) / 2, (z0 + z1) / 2);
    g.add(body);
    const roof = mesh(THREE, new THREE.ConeGeometry(Math.max(x1 - x0, z1 - z0) * 0.72,
      n.ridgeY - n.eaveY, 4), roofM, `shell:nbrRoof:${n.id}`);
    roof.rotation.y = Math.PI / 4;
    roof.position.set((x0 + x1) / 2, (n.eaveY + n.ridgeY) / 2, (z0 + z1) / 2);
    g.add(roof);
  }
  const shrubM = new THREE.MeshStandardMaterial({ color: 0x4d6135, roughness: 0.95 });
  shrubM.userData.keep = true;
  for (const s of SITE.shrubs) {
    const b = mesh(THREE, new THREE.SphereGeometry(s.r, 10, 7), shrubM, 'shell:shrub');
    b.scale.y = 0.85;
    b.position.set(s.at[0], SITE.lot.grassY + s.r * 0.7, s.at[1]);
    g.add(b);
  }
  for (const hg of SITE.hedges) {
    const [x0, z0, x1, z1] = polyBBox(hg.poly);
    const b = mesh(THREE, new THREE.BoxGeometry(x1 - x0, hg.h, z1 - z0), shrubM, `shell:${hg.id}`);
    b.position.set((x0 + x1) / 2, SITE.lot.grassY + hg.h / 2, (z0 + z1) / 2);
    g.add(b);
  }
  // The front walk and driveway show through the entry windows.
  const conc = M(ctx, 'concreteDriveway');
  const drive = mesh(THREE, new THREE.ShapeGeometry(planShape(THREE, SITE.driveway.poly)),
    conc, 'shell:backdrop:driveway');
  drive.rotation.x = -Math.PI / 2;
  drive.position.y = SITE.driveway.y;
  drive.castShadow = false;
  planUV(drive, scaleOf(conc, 6));
  g.add(drive);

  ctx.group.add(g);
  handle.stats.meshes++;
}

/* ======================================================================== */
/* 10. Exterior: massing, roofs, site                                        */
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
 * A hip / shed / flat roof over an axis-aligned footprint.  The ridge is inset
 * from both ends by (ridgeY - eaveY) * 12 / pitch, which is exactly the run the
 * hip rafters need.  Non-rectangular footprints use their bbox — good enough
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
      push(A); push(B); push(R1); push(A); push(R1); push(R0);
      push(C); push(D); push(R0); push(C); push(R0); push(R1);
      push(A); push(R0); push(D);
      push(B); push(C); push(R1);
    } else {
      push(D); push(A); push(R0); push(D); push(R0); push(R1);
      push(B); push(C); push(R1); push(B); push(R1); push(R0);
      push(A); push(B); push(R0);
      push(C); push(D); push(R1);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
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
  if (w.level === 'first') panel(0, len, w.h, w.h + ASSEMBLY.floorJoist);

  ctx.group.add(g);
  handle.walls.set(w.id, g);
  handle.stats.walls++;
  return { ax, az, u, n, yaw, baseY, len };
}

function buildExterior(ctx, handle) {
  const { THREE } = ctx;
  const siding = M(ctx, 'grayLapSiding', 'wallPaintWhite');

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

  for (const w of WALLS) {
    if (w.kind !== 'exterior' && w.kind !== 'foundation') continue;
    const placed = buildWallExterior(ctx, w, handle, siding);
    if (!placed) continue;
    for (const o of openingsOnWall(w.id)) buildOpeningUnit(ctx, w, o, placed, handle);
  }

  const roofs = new THREE.Group();
  roofs.name = 'shell:roofs';
  for (const r of MASSING.roofs) buildRoof(ctx, r, roofs);
  ctx.group.add(roofs);
  handle.stats.meshes++;

  const ch = MASSING.chimney;
  const chim = extrudePoly(THREE, rectPolyOf(ch.plan), ch.baseY, ch.topY, siding, 'shell:chimney');
  planUV(chim, scaleOf(siding, 8));
  ctx.group.add(chim);

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

  buildBackdrop(ctx, handle);

  const shrubM = new THREE.MeshStandardMaterial({ color: 0x4d6135, roughness: 0.95 });
  shrubM.userData.keep = true;
  for (const h of SITE.hedges) {
    const b = extrudePoly(THREE, h.poly, SITE.lot.grassY, SITE.lot.grassY + h.h, shrubM, `site:${h.id}`);
    ctx.group.add(b);
  }
}

/* ======================================================================== */
/* 11. Entry points                                                          */
/* ======================================================================== */

export const meta = { id: 'shell', title: 'Building shell', level: 'all' };

/**
 * Which levels to build for a camera standing on `level`.
 *
 * The foyer and the upper hall are ONE room from y = 0 to the vault, so a first
 * or second floor camera always needs both decks, both sets of walls and both
 * flights of stairs.  The basement only ever sees up its own stair.
 */
function defaultLevels(level) {
  if (level === 'first' || level === 'second') return ['first', 'second'];
  return [level];
}

/**
 * Build the shell.
 * @param {object} ctx  room-module context from main.js
 * @param {object} [opts] { levels }
 * @returns {THREE.Group} the shell group (already added to ctx.group), carrying
 *                        the handle API described in the file header.
 */
export function buildShell(ctx, opts = {}) {
  const { THREE } = ctx;
  const primary = ctx.level || 'first';

  const root = new THREE.Group();
  root.name = `shell:${primary}`;
  ctx.group.add(root);

  // Everything below adds to `root` via a shadowed ctx.
  const sub = Object.assign({}, ctx, { group: root });

  const handle = root;
  handle.level = primary;
  handle.levels = [];
  handle.floors = new Map();
  handle.ceilings = new Map();
  handle.walls = new Map();
  handle.trim = new Map();
  handle.crown = new Map();
  handle.lights = new Map();
  handle.openings = [];
  handle.stairs = null;
  handle.stats = { walls: 0, openings: 0, floors: 0, meshes: 0, lights: 0 };
  handle.hideFloor = (id) => { const m = handle.floors.get(id); if (m) m.visible = false; return m; };
  handle.hideCeiling = (id) => {
    const m = handle.ceilings.get(id || handle.level); if (m) m.visible = false; return m;
  };
  handle.hideWall = (id) => { const g = handle.walls.get(id); if (g) g.visible = false; return g; };
  handle.hideTrim = (id) => { const g = handle.trim.get(id); if (g) g.visible = false; return g; };
  handle.removeLights = (...ids) => {
    const list = ids.flat();
    for (const id of list.length ? list : [...handle.lights.keys()]) {
      const g = handle.lights.get(id);
      if (g && g.parent) g.parent.remove(g);
      handle.lights.delete(id);
    }
  };

  ctx.shell = handle;

  if (primary === 'exterior') {
    handle.levels = ['exterior'];
    buildExterior(sub, handle);
    return handle;
  }
  if (!(primary in LEVELS)) throw new Error(`shell.js: unknown level "${primary}"`);

  const levels = (opts.levels || defaultLevels(primary)).filter((l) => l in LEVELS);
  handle.levels = levels.slice();

  for (const level of levels) {
    buildFloors(sub, level, handle);
    buildCeilings(sub, level, handle);

    for (const w of wallsOnLevel(level)) {
      if (w.kind === 'guard') continue;          // balustrade, not drywall
      const placed = buildWall(sub, w, handle);
      if (!placed) continue;
      for (const o of openingsOnWall(w.id)) buildOpeningUnit(sub, w, o, placed, handle);
    }

    buildBaseboards(sub, level, handle);
    buildCrown(sub, level, handle);
    buildColumns(sub, level, handle);
    buildSteps(sub, level, handle);
    buildSkylights(sub, level, handle);
    buildVoidGuards(sub, level, handle);
  }

  if (levels.includes('first')) buildEntryOversail(sub, handle);

  handle.stairs = buildStairs(sub, { levels });
  root.add(handle.stairs);

  buildDefaultLights(sub, primary, handle);
  buildBackdrop(sub, handle);

  return handle;
}

export const build = buildShell;
export default buildShell;
export { clipHolesTo as __clipHolesTo };
