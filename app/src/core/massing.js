/**
 * app/src/core/massing.js — THE EXTERIOR ENVELOPE.
 *
 * One shared builder used by `rooms/exterior-front.js` and
 * `rooms/exterior-rear.js` (and anything else that needs the outside of the
 * house). Both of those modules live on the same `exterior` scene, so the
 * envelope is **memoised on the scene**: whichever room builds first owns the
 * geometry and the second call is a no-op that returns the same handle.
 *
 * ---------------------------------------------------------------------------
 * WHAT MAKES THIS DIFFERENT FROM `shell.js`'s exterior
 * ---------------------------------------------------------------------------
 * `shell.js` puts a *texture* of lap siding on flat boxes. Every listing photo
 * of this house is dominated by the real thing: 8" cedar boards, each one
 * standing ~5/8" proud at its butt, throwing a hard 3/4" shadow onto the board
 * below, with the courses running dead level round every corner. At the grazing
 * sun angle of the front photos that shadow ladder *is* the facade. So here the
 * siding is REAL GEOMETRY — a merged wedge-profile board per course per wall
 * panel — and this module hides shell.js's flat version.
 *
 * Everything else follows: deep flat fascia, bold soffit, gutters and
 * downspouts, corner boards, the round porthole, the round louvered vents, the
 * black front door, the flat-panel garage door, the rear window walls and the
 * dark timber post-and-beam sunroom box.
 *
 * ---------------------------------------------------------------------------
 * COORDINATES
 * ---------------------------------------------------------------------------
 * CONVENTIONS §1. +X east, +Z toward the street, Y up, 1 unit = 1 foot.
 * A wall record's `a -> b` is its OUTSIDE face. Local wall space used here:
 *   local +X = a->b, local +Y = world up, local +Z = INWARD  (= shell.js yaw)
 * so the exterior is at local -Z, which is exactly what every kit window and
 * door already assumes.
 */

import {
  LEVELS, CEIL_Y, WALL, ASSEMBLY,
  FOOTPRINTS, WALLS, OPENINGS, MASSING, SITE,
  openingsOnWall,
} from './dims.js';
import { applyUV } from './materials.js';
import { inch, ft, deg, polyBBox, segDir, segLen } from './units.js';

const EPS = 1e-6;

/* ======================================================================== */
/* 0. Palette — measured off the photographs                                 */
/* ======================================================================== */

export const PALETTE = {
  /**
   * Weathered silver-greige cedar.
   *
   * NOTE this is a TINT ON TOP OF `grayLapSiding`, whose own tone already sits
   * at ~155/255. Multiplying that by a mid-grey put the effective albedo at
   * 0.14 and rendered a facade barely half as bright as the photograph's
   * MEASURED 138/132/113 sunlit siding. The tint therefore has to be light and
   * warm; the texture supplies the value, this supplies the hue.
   */
  siding: 0xd9cdba,
  /** Fascia / soffit / corner boards / window frames — the dark second tone. */
  trim: 0x4b4d48,
  /** Slightly warmer dark for stained timber (porch post, sunroom frame). */
  timber: 0x413a33,
  shingle: 0x4e5054,
  gutter: 0x494b47,
};

/* ======================================================================== */
/* 1. Small helpers                                                          */
/* ======================================================================== */

function frame(a, b) {
  const u = segDir(a, b);
  return { u, n: [-u[1], u[0]], len: segLen(a, b), yaw: Math.atan2(-u[1], u[0]) };
}

function meshOf(THREE, geo, material, name) {
  const m = new THREE.Mesh(geo, material);
  m.castShadow = true;
  m.receiveShadow = true;
  if (name) m.name = name;
  return m;
}

/** A cached local material; every one is marked keep so disposeScene spares it. */
function makeLocals(ctx) {
  const { THREE } = ctx;
  const lib = ctx.mat || {};
  const cache = new Map();

  const keep = (m) => { m.userData.keep = true; return m; };

  const derive = (name, base, patch) => {
    if (cache.has(name)) return cache.get(name);
    let m;
    if (base && base.isMaterial) {
      m = base.clone();
      // the clone shares the library's maps — that is what we want, but the
      // clone must never inherit an applyUV repeat, so reset offsets.
      Object.assign(m, patch);
      if (patch.color !== undefined) m.color = new THREE.Color(patch.color);
      if (patch.emissive !== undefined) m.emissive = new THREE.Color(patch.emissive);
      if (patch.normalScale !== undefined) m.normalScale = new THREE.Vector2(patch.normalScale, patch.normalScale);
    } else {
      m = new THREE.MeshPhysicalMaterial(Object.assign({ roughness: 0.8, metalness: 0 }, patch));
    }
    m.name = 'massing:' + name;
    cache.set(name, keep(m));
    return m;
  };

  return {
    /** Real lapped boards: the map's own course lines are aligned to them. */
    siding: () => derive('siding', lib.grayLapSiding, {
      color: PALETTE.siding, normalScale: 0.55, roughness: 0.86,
      envMapIntensity: 0.95, aoMapIntensity: 0.5,
    }),
    /** Same boards, the rear elevation's greener cast. */
    sidingRear: () => derive('sidingRear', lib.grayLapSiding, {
      color: 0xdfe0d4, normalScale: 0.55, roughness: 0.88,
      envMapIntensity: 0.9, aoMapIntensity: 0.5,
    }),
    /** Rough-sawn dark trim: fascia, soffit, corner boards, casings. */
    trim: () => derive('trim', lib.cherryCabinetDark, {
      color: PALETTE.trim, roughness: 0.82, clearcoat: 0.06,
      normalScale: 0.8, envMapIntensity: 0.7,
    }),
    /** Stained timber — porch post, sunroom posts and beams, fins. */
    timber: () => derive('timber', lib.cherryCabinetDark, {
      color: PALETTE.timber, roughness: 0.78, clearcoat: 0.1,
      normalScale: 1.0, envMapIntensity: 0.7,
    }),
    shingle: () => (lib.asphaltShingle || derive('shingleFallback', null, { color: PALETTE.shingle })),
    /** Charcoal metal: gutters, downspouts, vents, lights. */
    metal: () => derive('metalDark', null, {
      color: 0x36383a, roughness: 0.42, metalness: 0.7, envMapIntensity: 0.9,
    }),
    /** Anodised/painted dark window frame. */
    frameDark: () => derive('frameDark', null, {
      color: 0x35373a, roughness: 0.38, metalness: 0.25,
      clearcoat: 0.5, clearcoatRoughness: 0.25, envMapIntensity: 0.9,
    }),
    white: () => derive('extWhite', null, {
      color: 0xf3f1ec, roughness: 0.35, metalness: 0.0,
      clearcoat: 0.5, clearcoatRoughness: 0.2, envMapIntensity: 0.8,
    }),
    /** Exterior glazing: reflective, faintly transmissive, sky in every pane. */
    // MEASURED against exterior_view_of_front_door.png and foyer_view: the
    // glazing in these photographs is NOT a mirror. Through the entry lights
    // you read the plantation-shutter louvers, the tilt rods and the greenery
    // behind them; only the top corner of each pane carries a sky reflection.
    // envMapIntensity 1.55 turned every light into a sheet of blank blue sky
    // and cost the entry its single most recognisable feature.
    // A transmissive MeshPhysicalMaterial renders the entry lights as a flat
    // pale sheet — the plantation-shutter louvers behind them disappear
    // completely, which is the one feature of this facade nobody could miss.
    // Simple alpha glass with a strong specular is both cheaper and closer:
    // you read the louvers, and the sky still slides across the top corner.
    glass: () => derive('extGlass', null, {
      color: 0xbcc9cc, roughness: 0.05, metalness: 0.0,
      transmission: 0, transparent: true, opacity: 0.20,
      specularIntensity: 1.0, envMapIntensity: 0.85,
      clearcoat: 1.0, clearcoatRoughness: 0.02,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
    /** Interior surface seen faintly through the glass. */
    interior: () => derive('interiorCard', null, {
      color: 0xd9cfbe, roughness: 0.92, metalness: 0,
    }),
    // Never meant to be seen from outside — kept dark so that if a board run
    // ever falls short of a wall panel the gap reads as a shadow, not as a
    // white stripe across the elevation.
    sheathing: () => derive('sheathing', null, {
      color: 0x6d675d, roughness: 0.94, metalness: 0,
    }),
    concrete: () => (lib.concreteDriveway || derive('concreteFallback', null, { color: 0xa8a49c })),
    bluestone: () => (lib.bluestone || derive('bluestoneFallback', null, { color: 0x7c8189 })),
  };
}

/* ======================================================================== */
/* 2. Lap siding — real boards                                               */
/* ======================================================================== */

/**
 * Merged geometry for the lapped boards covering a set of (s, y) rectangles on
 * one wall. Built in wall-local space with the exterior at local −Z.
 *
 * The board section, drawn bottom-to-top, z going OUT (negative):
 *
 *        +Z (into the wall)          o  y1  ------------ 0
 *              |                     |          .
 *              |                     |    front face, tilted
 *              o  y0 -- chamfer -- o  butt, standing t1 proud
 *              |__ underside __|
 *
 * @param {object} THREE
 * @param {Array<[number,number,number,number]>} rects  [s0, y0, s1, y1]
 * @param {object} o  { base, exposure, seed }
 */
function lapSidingGeometry(THREE, rects, o = {}) {
  const exposure = o.exposure === undefined ? inch(8) : o.exposure;
  const base = o.base === undefined ? 0 : o.base;
  const seed = o.seed === undefined ? 1 : o.seed;

  const T_BUTT = inch(0.72);      // how far the butt edge stands off the wall
  const T_TOP = inch(0.24);       // the thin (upper) edge, tucked under the next
  const CH = inch(0.14);          // chamfer on the butt's outer arris
  const LAP = inch(1.1);          // how far each board runs up behind the next

  // The procedural map draws 6 courses at a 7.5" exposure across 3.75 ft of V
  // and 8 ft of U. Mapping ONE geometric course onto ONE texture course keeps
  // the map's baked butt-shadow exactly on our real butt line, and gives every
  // board a different cedar tone.
  const T_EXP = 7.5 / 12;
  const T_V = T_EXP * 6;
  const T_U = 8.0;

  const pos = [];
  const uv = [];
  const idx = [];

  const rnd = (n) => {
    let x = Math.sin((n + seed) * 12.9898) * 43758.5453;
    return x - Math.floor(x);
  };

  const vert = (x, y, z, u, v) => {
    pos.push(x, y, z);
    uv.push(u, v);
    return pos.length / 3 - 1;
  };

  for (const [s0, y0r, s1, y1r] of rects) {
    if (s1 - s0 < 1e-4 || y1r - y0r < 1e-4) continue;
    const k0 = Math.floor((y0r - base) / exposure + 1e-6);
    const k1 = Math.ceil((y1r - base) / exposure - 1e-6);

    for (let k = k0; k < k1; k++) {
      const cy0 = base + k * exposure;              // butt line of this course
      const yb = Math.max(cy0, y0r);
      const yt = Math.min(cy0 + exposure + LAP, y1r);
      if (yt - yb < 1e-4) continue;

      // per-course jitter: which cedar tone row, and where the butt joints land
      const rowShift = Math.floor(rnd(k * 3.1) * 6);
      const uShift = rnd(k * 7.7) * T_U;

      const texV = (y) => {
        const f = (y - cy0) / exposure;             // 0 at butt, 1 at top
        return 1 - ((k + rowShift) % 6 + 1 - f) * T_EXP / T_V;
      };
      const texU = (s) => (s + uShift) / T_U;

      // profile, bottom -> top, in (y, z) with z negative outward
      const prof = [
        [yb, 0],
        [yb, -(T_BUTT - CH)],
        [yb + CH, -T_BUTT],
        [yt, -T_TOP - (T_BUTT - T_TOP) * Math.max(0, 1 - (yt - yb) / exposure)],
        [yt, 0],
      ];
      // a board clipped short at a head/sill keeps a square cut end
      const nP = prof.length;

      const ring0 = [];
      const ring1 = [];
      for (let i = 0; i < nP; i++) {
        ring0.push(vert(s0, prof[i][0], prof[i][1], texU(s0), texV(prof[i][0])));
        ring1.push(vert(s1, prof[i][0], prof[i][1], texU(s1), texV(prof[i][0])));
      }
      for (let i = 0; i < nP - 1; i++) {
        const A = ring0[i], B = ring1[i], C = ring1[i + 1], D = ring0[i + 1];
        idx.push(A, C, B, A, D, C);
      }
      // end caps (square cut ends, visible at every opening jamb and corner)
      const cap0 = [];
      const cap1 = [];
      for (let i = 0; i < nP; i++) {
        cap0.push(vert(s0, prof[i][0], prof[i][1], prof[i][1] * 6, prof[i][0]));
        cap1.push(vert(s1, prof[i][0], prof[i][1], prof[i][1] * 6, prof[i][0]));
      }
      for (let i = 1; i < nP - 1; i++) {
        idx.push(cap0[0], cap0[i + 1], cap0[i]);
        idx.push(cap1[0], cap1[i], cap1[i + 1]);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('uv1', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/* ======================================================================== */
/* 3. The envelope                                                           */
/* ======================================================================== */

/** Wall panels (in s,y) left after the openings are punched out. */
function wallPanels(w, extraTop) {
  const len = segLen(w.a, w.b);
  const h = w.h + (extraTop || 0);
  const ops = openingsOnWall(w.id).slice().sort((p, q) => p.center - q.center);
  const out = [];
  let cursor = 0;
  for (const o of ops) {
    const s0 = Math.max(0, o.center - o.w / 2);
    const s1 = Math.min(len, o.center + o.w / 2);
    const sill = o.sill || 0;
    const head = Math.min(h, sill + o.h);
    if (s0 > cursor + EPS) out.push([cursor, 0, s0, h]);
    if (sill > EPS) out.push([s0, 0, s1, sill]);
    if (head < h - EPS) out.push([s0, head, s1, h]);
    cursor = Math.max(cursor, s1);
  }
  if (cursor < len - EPS) out.push([cursor, 0, len, h]);
  return out;
}

/**
 * Round louvered gable vent — the signature element of this facade.
 * Sits in a flat trim panel, with real louver blades and a screen behind.
 */
export function louveredVent(ctx, r, o = {}) {
  const { THREE, kit } = ctx;
  const L = o.locals;
  const g = new THREE.Group();
  g.name = 'vent:round';
  const trim = L.trim();
  const metal = L.metal();

  // the flat board the vent is let into
  if (o.panel !== false) {
    const pw = o.panelW === undefined ? r * 2 + ft(1, 2) : o.panelW;
    const ph = o.panelH === undefined ? r * 2 + ft(1, 2) : o.panelH;
    const p = kit.box(pw, ph, inch(0.9), trim, { r: inch(0.06), uv: true });
    p.position.z = -inch(0.45);
    p.material = L.siding();
    g.add(p);
  }
  const ring = kit.torus(r - inch(1.0), inch(1.1), metal, 48, 8);
  ring.position.z = -inch(1.1);
  g.add(ring);
  const back = kit.cyl(r - inch(1.6), r - inch(1.6), inch(0.3), metal, 40);
  back.rotation.x = Math.PI / 2;
  back.position.z = -inch(0.2);
  g.add(back);
  // louver blades, clipped to the circle
  const n = Math.max(6, Math.round((2 * r) / inch(1.5)));
  for (let i = 0; i < n; i++) {
    const y = -r + (2 * r * (i + 0.5)) / n;
    const halfW = Math.sqrt(Math.max(0, (r - inch(1.7)) ** 2 - y * y));
    if (halfW < inch(1)) continue;
    const bl = kit.box(halfW * 2, inch(1.05), inch(0.4), metal, { r: inch(0.06) });
    bl.rotation.x = deg(-26);
    bl.position.set(0, y, -inch(0.75));
    g.add(bl);
  }
  return g;
}

/** The round porthole: a real punched hole, dark ring, one big sheet of glass. */
function portholeWindow(ctx, outerR, o = {}) {
  const { THREE, kit } = ctx;
  const L = o.locals;
  const g = new THREE.Group();
  g.name = 'window:porthole';
  const frameW = inch(4.2);
  const dark = L.frameDark();

  // jamb liner through the wall
  const liner = kit.ellipseRing(outerR, outerR, outerR - inch(1.0), outerR - inch(1.0),
    WALL.ext, dark, { cast: false });
  liner.position.z = -WALL.ext / 2;
  g.add(liner);
  // the sash ring, proud of the siding
  const sash = kit.ellipseRing(outerR + inch(0.4), outerR + inch(0.4),
    outerR - frameW, outerR - frameW, inch(2.6), dark);
  sash.position.z = -inch(0.9) - inch(2.6);
  g.add(sash);
  // a second, thinner ring reads as the glazing bead
  const bead = kit.torus(outerR - frameW + inch(0.5), inch(0.45), dark, 56, 8);
  bead.position.z = -inch(2.6);
  g.add(bead);

  const gl = new THREE.Mesh(
    new THREE.CircleGeometry(outerR - frameW + inch(0.7), 64), L.glass());
  gl.position.z = -inch(1.9);
  gl.castShadow = false;
  g.add(gl);
  return g;
}

/** Deep charcoal K-style gutter with a rounded downspout. */
function gutterRun(ctx, locals, x0, z0, x1, z1, y) {
  const { THREE, kit } = ctx;
  const m = locals.metal();
  const g = new THREE.Group();
  const len = Math.hypot(x1 - x0, z1 - z0);
  if (len < 0.5) return g;
  const body = kit.box(len, inch(4.6), inch(4.4), m, { r: inch(0.35), seg: 2 });
  const lip = kit.box(len, inch(1.1), inch(1.1), m, { r: inch(0.4), seg: 2 });
  const grp = new THREE.Group();
  grp.add(body);
  lip.position.set(0, inch(2.4), -inch(1.9));
  grp.add(lip);
  grp.position.set((x0 + x1) / 2, y - inch(2.6), (z0 + z1) / 2);
  grp.rotation.y = Math.atan2(-(z1 - z0), x1 - x0);
  g.add(grp);
  return g;
}

function downspout(ctx, locals, x, z, yTop, yBot, outDir) {
  const { THREE, kit } = ctx;
  const m = locals.metal();
  const g = new THREE.Group();
  g.name = 'downspout';
  const h = yTop - yBot;
  if (h < 1) return g;
  const pipe = kit.box(inch(3.1), h, inch(2.4), m, { r: inch(0.45), seg: 2 });
  pipe.position.set(x, yBot + h / 2, z);
  g.add(pipe);
  for (const fy of [yBot + h * 0.22, yBot + h * 0.62, yTop - inch(9)]) {
    const strap = kit.box(inch(3.8), inch(0.9), inch(0.5), m, { r: inch(0.1) });
    strap.position.set(x, fy, z + (outDir[1] > 0 ? -inch(1.6) : inch(1.6)));
    g.add(strap);
  }
  // the elbow onto a splash block
  const elbow = kit.box(inch(3.1), inch(0.6), inch(11), m, { r: inch(0.4), seg: 2 });
  elbow.rotation.x = deg(12);
  elbow.position.set(x, yBot - inch(1.0), z + outDir[1] * ft(0, 5));
  g.add(elbow);
  return g;
}

/* ======================================================================== */
/* 4. Roofs                                                                  */
/* ======================================================================== */

function roofSurface(ctx, r, locals, group) {
  const { THREE } = ctx;
  const [x0, z0, x1, z1] = polyBBox(r.poly);
  const o = r.overhang || 1.5;
  const ax0 = x0 - o, az0 = z0 - o, ax1 = x1 + o, az1 = z1 + o;
  const eave = r.eaveY;
  const ridge = r.ridgeY;
  const pos = [];
  const push = (p) => pos.push(p[0], p[1], p[2]);
  const A = [ax0, eave, az0];
  const B = [ax1, eave, az0];
  const C = [ax1, eave, az1];
  const D = [ax0, eave, az1];

  if (r.type === 'flat') {
    const A2 = [ax0, ridge, az0], B2 = [ax1, ridge, az0];
    const C2 = [ax1, eave, az1], D2 = [ax0, eave, az1];
    push(A2); push(B2); push(C2); push(A2); push(C2); push(D2);
  } else if (r.type === 'shed') {
    const A2 = [ax0, ridge, az0], B2 = [ax1, ridge, az0];
    push(A2); push(B2); push(C); push(A2); push(C); push(D);
  } else {
    const inset = Math.min(((ridge - eave) * 12) / (r.pitch || 4),
      Math.min(ax1 - ax0, az1 - az0) / 2 - 0.01);
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
  const uvs = [];
  for (let i = 0; i < pos.length; i += 3) uvs.push(pos[i] / 3.0, pos[i + 2] / (5.5 / 12 * 4));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('uv1', new THREE.Float32BufferAttribute(uvs, 2));
  geo.computeVertexNormals();
  const m = meshOf(THREE, geo, locals.shingle(), `massing:roof:${r.id}`);
  group.add(m);
  return { ax0, az0, ax1, az1 };
}

/**
 * The eave assembly: bold soffit + deep flat fascia + gutter. This is the
 * single most recognisable move on this house, so it gets real depth.
 */
function eaveTrim(ctx, locals, box, r, group, opts = {}) {
  const { THREE, kit } = ctx;
  const { ax0, az0, ax1, az1 } = box;
  const fh = r.fasciaH || 1.2;
  const eave = r.eaveY;
  // MEASURED, and it contradicts the "everything dark" reading in DETAILS.md:
  // in straight_on_view_of_house_from_street the fascia and soffit of the
  // GARAGE and MAIN hip roofs are the same warm greige as the siding, while
  // the flat cap over the porthole box is charcoal. Window frames, corner
  // boards and the garage-door jambs are charcoal everywhere.
  const trim = r.fasciaTone === 'trim' ? locals.trim() : locals.siding();
  const t = inch(1.6);
  const soffitY = eave - fh;

  // soffit panel over the whole plan area (only its overhang band is ever seen)
  const sof = kit.box(ax1 - ax0, inch(0.9), az1 - az0, trim, { r: inch(0.05), uv: true });
  sof.position.set((ax0 + ax1) / 2, soffitY + inch(0.45), (az0 + az1) / 2);
  sof.castShadow = true;
  sof.receiveShadow = true;
  applyUV(sof, 4, { axes: 'xz', size: [ax1 - ax0, az1 - az0] });
  group.add(sof);

  const sides = [
    [(ax0 + ax1) / 2, az1 + t / 2, ax1 - ax0 + 2 * t, t, 'south', [0, 1]],
    [(ax0 + ax1) / 2, az0 - t / 2, ax1 - ax0 + 2 * t, t, 'north', [0, -1]],
    [ax0 - t / 2, (az0 + az1) / 2, t, az1 - az0, 'west', [-1, 0]],
    [ax1 + t / 2, (az0 + az1) / 2, t, az1 - az0, 'east', [1, 0]],
  ];
  for (const [cx, cz, w, d, side, dir] of sides) {
    if (opts.skip && opts.skip.indexOf(side) !== -1) continue;
    const f = kit.box(w, fh, d, trim, { r: inch(0.08), seg: 2, uv: true });
    f.position.set(cx, eave - fh / 2, cz);
    applyUV(f, 4, { axes: dir[0] ? 'zy' : 'xy', size: [dir[0] ? d : w, fh] });
    group.add(f);
    if (opts.gutter === false) continue;
    // gutter hung on the fascia
    const g = gutterRun(ctx, locals,
      dir[0] ? cx + dir[0] * inch(2.6) : ax0, dir[0] ? az0 : cz + dir[1] * inch(2.6),
      dir[0] ? cx + dir[0] * inch(2.6) : ax1, dir[0] ? az1 : cz + dir[1] * inch(2.6),
      eave - inch(1.5));
    group.add(g);
  }
}

/* ======================================================================== */
/* 5. Openings                                                               */
/* ======================================================================== */

const REAR_GLASS = /rear glass wall|sunroom glass wall|breakfast nook rear/i;

function windowTypeFor(o) {
  const note = (o.note || '').toLowerCase();
  if (REAR_GLASS.test(note)) return 'fixed';
  // The two entry lights are FIXED units, each with a single divided pane and
  // a pair of plantation-shutter panels behind — no casement sash bars, which
  // is exactly how they read in exterior_view_of_front_door.png.
  if (/entry window|sidelight/.test(note)) return 'fixed';
  if (o.w >= 7) return 'threePanelCasement';
  if (o.w >= 4.2) return 'threePanelCasement';
  if (o.h <= 2.0) return 'fixed';
  return 'casement';
}

function buildOpening(ctx, locals, w, o, place, group) {
  const { THREE, kit } = ctx;
  const { ax, az, u, yaw, baseY } = place;
  const px = ax + u[0] * o.center;
  const pz = az + u[1] * o.center;
  const y = baseY + (o.sill || 0);
  const dark = locals.frameDark();
  const white = locals.white();
  const glass = locals.glass();
  let unit = null;

  const isPorthole = /PORTHOLE/i.test(o.note || '');
  const isFront = /FRONT DOOR/i.test(o.note || '');
  const shutters = /shutter/i.test(o.note || '');

  if (isPorthole) {
    unit = portholeWindow(ctx, o.w / 2, { locals });
    unit.position.set(px, y + o.h / 2, pz);
    unit.rotation.y = yaw;
    group.add(unit);
    return;
  }

  if (o.type === 'window') {
    unit = kit.window(
      { w: o.w, h: o.h, type: windowTypeFor(o) },
      {
        wall: w.t, casing: false, frame: dark, glass,
        // Two panels with a divider rail, louvers nearly flat and open — the
        // entry shutters in the photograph are open enough to see the street
        // through, not closed like the foyer's.
        shutters: shutters
          ? { tilt: deg(24), panels: Math.max(1, Math.round(o.w / 2.0)), divider: 0.55, rod: true }
          : false,
      }
    );
    // exterior casing: this house trims every window in the dark tone
    const cw = inch(3.6);
    for (const [dx, dy, cwid, chh] of [
      [-(o.w / 2 + cw / 2), o.h / 2, cw, o.h + 2 * cw],
      [o.w / 2 + cw / 2, o.h / 2, cw, o.h + 2 * cw],
      [0, o.h + cw / 2, o.w, cw],
      [0, -cw / 2, o.w, cw],
    ]) {
      const c = kit.box(cwid, chh, inch(1.3), dark, { r: inch(0.06), uv: true });
      c.position.set(dx, dy, -w.t / 2 - inch(0.9));
      unit.add(c);
    }
  } else if (o.type === 'garageDoor') {
    unit = new THREE.Group();
    const door = kit.garageDoor({ w: o.w, h: o.h, rows: 5, cols: 1, material: locals.siding() });
    door.rotation.y = Math.PI;
    door.position.z = -w.t / 2 - inch(1.0);
    unit.add(door);
    // dark jamb + head casing round the opening
    for (const [dx, dy, cwid, chh] of [
      [-(o.w / 2 + inch(2)), o.h / 2, inch(4), o.h + inch(8)],
      [o.w / 2 + inch(2), o.h / 2, inch(4), o.h + inch(8)],
      [0, o.h + inch(2), o.w + inch(8), inch(4)],
    ]) {
      const c = kit.box(cwid, chh, inch(1.6), dark, { r: inch(0.06), uv: true });
      c.position.set(dx, dy, -w.t / 2 - inch(1.0));
      unit.add(c);
    }
  } else if (isFront) {
    unit = kit.frontDoor({
      w: o.w, h: o.h, hand: 'right', open: 0, wall: w.t,
      sidelights: 'none',
    });
  } else if (o.type === 'door') {
    if (o.swing === 'slide') {
      unit = kit.slidingGlassDoor({ w: o.w, h: o.h, wall: w.t, material: white });
    } else {
      unit = kit.frenchDoor({
        w: o.w, h: o.h, wall: w.t, open: 0, material: white,
        lites: { cols: 1, rows: 1 }, casing: false,
      });
    }
  }
  if (!unit) return;
  unit.position.set(px, y, pz);
  unit.rotation.y = yaw;
  unit.name = `massing:opening:${w.id}:${o.center}`;
  unit.traverse((n) => { if (n.isMesh) { n.castShadow = true; n.receiveShadow = true; } });
  group.add(unit);
}

/* ======================================================================== */
/* 6. Public builder                                                         */
/* ======================================================================== */

/**
 * Build (once per scene) the whole exterior envelope.
 *
 * @param {object} ctx  the room-module context
 * @returns {{group: THREE.Group, locals: object}}
 */
export function buildMassing(ctx) {
  const { THREE } = ctx;
  const host = ctx.scene || ctx.group;
  if (host.userData && host.userData.__massing) return host.userData.__massing;

  const locals = makeLocals(ctx);
  const G = new THREE.Group();
  G.name = 'massing';
  ctx.group.add(G);

  hideShellExterior(ctx);
  buildWallsAndSiding(ctx, locals, G);
  buildRoofs(ctx, locals, G);
  buildChimney(ctx, locals, G);
  buildEntry(ctx, locals, G);
  buildRearFeatures(ctx, locals, G);
  buildServiceDetails(ctx, locals, G);
  buildInteriorGlow(ctx, locals, G);

  const handle = { group: G, locals };
  if (host.userData) host.userData.__massing = handle;
  return handle;
}

/** shell.js's flat-boxes-with-a-siding-texture version has to go. */
function hideShellExterior(ctx) {
  const scene = ctx.scene || ctx.group;
  const kill = [];
  scene.traverse((o) => {
    const n = o.name || '';
    if (n.startsWith('shell:extwall:') || n.startsWith('shell:opening:ext-') ||
      n.startsWith('roof:roof-') || n === 'shell:chimney' || n === 'shell:porch' ||
      n === 'shell:porchPost') kill.push(o);
  });
  for (const o of kill) o.visible = false;
}

/* ---- walls ------------------------------------------------------------- */

function buildWallsAndSiding(ctx, locals, G) {
  const { THREE, kit } = ctx;
  const grp = new THREE.Group();
  grp.name = 'massing:walls';
  G.add(grp);

  const front = locals.siding();
  const rear = locals.sidingRear();
  const sheath = locals.sheathing();
  const trim = locals.trim();
  const exposure = MASSING.siding.exposure || inch(8);

  let wi = 0;
  for (const w of WALLS) {
    if (w.kind !== 'exterior') continue;
    wi++;
    const { u, n, len, yaw } = frame(w.a, w.b);
    const off = w.align === 'outer' ? w.t / 2 : 0;
    const ax = w.a[0] + n[0] * off;
    const az = w.a[1] + n[1] * off;
    const baseY = LEVELS[w.level] + (w.base || 0);
    // the band joist between storeys keeps the courses continuous
    const extraTop = w.level === 'first' ? ASSEMBLY.floorJoist : 0;
    const rects = wallPanels(w, extraTop);

    const g = new THREE.Group();
    g.name = `massing:wall:${w.id}`;
    g.position.set(ax, baseY, az);
    g.rotation.y = yaw;
    grp.add(g);

    // ---- structural core (also the interior surface) --------------------
    for (const [s0, y0, s1, y1] of rects) {
      const core = kit.box(s1 - s0, y1 - y0, w.t, sheath, { r: inch(0.02) });
      core.position.set((s0 + s1) / 2, (y0 + y1) / 2, w.t / 2);
      core.castShadow = true;
      core.receiveShadow = true;
      g.add(core);
    }
    // Below-grade skirt so no daylight slips under the bottom course. ONLY on
    // a wall that actually reaches the ground: adding it to an upper-storey
    // wall hangs a full-height slab of sheathing and siding down over the
    // storey below, which is exactly what used to bury the whole entry — door,
    // sidelights and all — behind a blank sheet of clapboard.
    const onGrade = baseY <= 0.01;
    if (onGrade) {
      const skirt = kit.box(len, 2.4, w.t, sheath, { r: inch(0.02) });
      skirt.position.set(len / 2, -1.2, w.t / 2);
      g.add(skirt);
    }

    // ---- the boards -----------------------------------------------------
    const isRear = w.a[1] < 12 && w.b[1] < 12;
    const sidingM = isRear ? rear : front;
    // the courses run level round the whole house, so they key off the LEVEL,
    // not off this wall's base.
    const geo = lapSidingGeometry(THREE,
      onGrade ? rects.concat([[0, -1.35 - baseY, len, 0]]) : rects, {
        exposure,
        base: -1.35 - baseY,
        seed: 11 + wi * 3,
      });
    const boards = meshOf(THREE, geo, sidingM, `massing:siding:${w.id}`);
    g.add(boards);

    // ---- jamb liners so every opening has a dark reveal ------------------
    for (const o of openingsOnWall(w.id)) {
      const s0 = o.center - o.w / 2, s1 = o.center + o.w / 2;
      const sill = o.sill || 0;
      const head = sill + o.h;
      const liner = (cs, cy, lw, lh, vert) => {
        const b = kit.box(lw, lh, w.t - inch(0.6), trim, { r: inch(0.03) });
        b.position.set(cs, cy, w.t / 2 + inch(0.3));
        g.add(b);
      };
      liner((s0 + s1) / 2, head + inch(0.5), o.w + inch(2), inch(1.0));
      liner(s0 - inch(0.5), (sill + head) / 2, inch(1.0), o.h);
      liner(s1 + inch(0.5), (sill + head) / 2, inch(1.0), o.h);
      if (sill > 0.05) liner((s0 + s1) / 2, sill - inch(0.5), o.w + inch(2), inch(1.0));
    }

    // ---- openings --------------------------------------------------------
    for (const o of openingsOnWall(w.id)) {
      buildOpening(ctx, locals, w, o, { ax, az, u, yaw, baseY }, grp);
    }
  }

  // ---- corner boards ------------------------------------------------------
  buildCornerBoards(ctx, locals, grp);
}

/**
 * 4" corner boards at every external corner of both storeys — they are what
 * stop the lap courses dead and read as a dark vertical accent in the photos.
 */
function buildCornerBoards(ctx, locals, grp) {
  const { THREE, kit } = ctx;
  const trim = locals.trim();
  const cw = inch(4.2);
  const runs = [
    { poly: FOOTPRINTS.first, y0: -1.4, y1: CEIL_Y.first + ASSEMBLY.floorJoist },
    { poly: FOOTPRINTS.second, y0: LEVELS.second, y1: CEIL_Y.second + 1.0 },
  ];
  for (const run of runs) {
    for (const [x, z] of run.poly) {
      for (const [dx, dz] of [[1, 0], [0, 1]]) {
        const b = kit.box(dx ? cw + inch(1.1) : inch(1.1), run.y1 - run.y0,
          dx ? inch(1.1) : cw + inch(1.1), trim, { r: inch(0.05), uv: true });
        b.position.set(x, (run.y0 + run.y1) / 2, z);
        b.castShadow = true;
        b.receiveShadow = true;
        grp.add(b);
      }
    }
  }
}

/* ---- roofs -------------------------------------------------------------- */

function buildRoofs(ctx, locals, G) {
  const { THREE } = ctx;
  const grp = new THREE.Group();
  grp.name = 'massing:roofs';
  G.add(grp);
  for (const r of MASSING.roofs) {
    const box = roofSurface(ctx, r, locals, grp);
    eaveTrim(ctx, locals, box, r, grp, {
      gutter: r.id !== 'roof-entry',
    });
  }
  // downspouts at the outside corners the photos show
  const d = [
    [42.4, 47.6, 19.9 - 2.2, -1.0, [0, 1]],    // east end of the entry cap
    [62.6, 47.0, 9.5 - 1.2, -1.0, [0, 1]],     // SE corner of the garage
    [-2.1, 47.0, 18.5 - 1.5, -1.0, [0, 1]],    // SW corner of the main block
    [-2.1, -2.1, 18.5 - 1.5, -1.35, [0, -1]],  // NW corner
    [42.4, -2.2, 18.5 - 1.5, -1.35, [0, -1]],  // NE of the two-storey block
  ];
  for (const [x, z, yTop, yBot, dir] of d) grp.add(downspout(ctx, locals, x, z, yTop, yBot, dir));
}

function buildChimney(ctx, locals, G) {
  const { THREE, kit } = ctx;
  const ch = MASSING.chimney;
  const [x0, z0, x1, z1] = ch.plan;
  const g = new THREE.Group();
  g.name = 'massing:chimney';
  const h = ch.topY - ch.baseY;
  const body = kit.box(x1 - x0, h, z1 - z0, locals.siding(), { r: inch(0.06), uv: true });
  body.position.set((x0 + x1) / 2, ch.baseY + h / 2, (z0 + z1) / 2);
  applyUV(body, 6, { axes: 'xy', size: [x1 - x0, h] });
  g.add(body);
  const cap = kit.box(x1 - x0 + inch(6), ch.capH, z1 - z0 + inch(6), locals.trim(),
    { r: inch(0.1), seg: 2 });
  cap.position.set((x0 + x1) / 2, ch.topY + ch.capH / 2, (z0 + z1) / 2);
  g.add(cap);
  // the black flue with a rain cap
  const flue = kit.cyl(inch(4), inch(4), 1.6, locals.metal(), 20);
  flue.position.set((x0 + x1) / 2, ch.topY + ch.capH + 0.8, (z0 + z1) / 2);
  g.add(flue);
  const rain = kit.cyl(inch(6.5), inch(6.5), inch(1.2), locals.metal(), 20);
  rain.position.set((x0 + x1) / 2, ch.topY + ch.capH + 1.7, (z0 + z1) / 2);
  g.add(rain);
  G.add(g);
}

/* ---- entry -------------------------------------------------------------- */

function buildEntry(ctx, locals, G) {
  const { THREE, kit } = ctx;
  const P = MASSING.blocks.entryPorch;
  const g = new THREE.Group();
  g.name = 'massing:entry';
  G.add(g);

  const [px0, pz0] = P.poly[0];
  const [px1] = P.poly[1];
  const pz1 = P.poly[2][1];
  const trim = locals.trim();
  const timber = locals.timber();

  // The bluestone stoop, its riser and the walk are NOT built here: they run
  // 5 ft past the facade and are laid slab by slab by rooms/exterior-entry.js,
  // which owns this piece. All that is left here is the structure overhead.

  // ---- the deep dark soffit under the oversailing second floor -----------
  const soffit = kit.box(px1 - px0, inch(3), pz1 - pz0 + 0.9, trim, { r: inch(0.06), uv: true });
  soffit.position.set((px0 + px1) / 2, CEIL_Y.first - inch(1.5), (pz0 + pz1) / 2 + 0.3);
  applyUV(soffit, 4, { axes: 'xz', size: [px1 - px0, pz1 - pz0 + 0.9] });
  g.add(soffit);
  // the beam face across the front of the overhang
  const beam = kit.box(px1 - px0 + inch(6), P.beamDepth, inch(8), trim, { r: inch(0.08), seg: 2, uv: true });
  beam.position.set((px0 + px1) / 2, CEIL_Y.first - P.beamDepth / 2, pz1 + 0.72);
  g.add(beam);

  // ---- the 8x8 reeded timber post ---------------------------------------
  const post = new THREE.Group();
  const pTop = CEIL_Y.first - P.beamDepth;
  const pH = pTop - P.floorY;
  const core = kit.box(P.post.w, pH, P.post.d, timber, { r: inch(0.12), seg: 2, uv: true });
  core.position.y = pH / 2;
  post.add(core);
  for (const side of [0, 1, 2, 3]) {
    for (let i = 0; i < 5; i++) {
      const reed = kit.cyl(inch(0.55), inch(0.55), pH - inch(1), timber, 8);
      reed.rotation.x = Math.PI / 2;
      const t = -inch(3.2) + i * inch(1.6);
      const r = inch(4.05);
      const a = (side * Math.PI) / 2;
      reed.position.set(Math.cos(a) * r - Math.sin(a) * t, pH / 2, Math.sin(a) * r + Math.cos(a) * t);
      reed.rotation.z = 0;
      reed.scale.set(0.55, 1, 1);
      post.add(reed);
    }
  }
  post.position.set(P.post.at[0], P.floorY, P.post.at[1]);
  g.add(post);

  // ---- angled corbel brackets under the beam -----------------------------
  const bracketAt = (x, z, w) => {
    const b = kit.box(inch(3.2), inch(13), w, timber, { r: inch(0.08), seg: 2, uv: true });
    b.position.set(x, CEIL_Y.first - P.beamDepth - inch(6.5), z);
    g.add(b);
    const knee = kit.box(inch(3.2), inch(15), inch(3.2), timber, { r: inch(0.08), seg: 2 });
    knee.rotation.x = deg(38);
    knee.position.set(x, CEIL_Y.first - P.beamDepth - inch(12), z - w / 2 + inch(4));
    g.add(knee);
  };
  bracketAt(P.post.at[0], P.post.at[1] - inch(3), inch(20));
  bracketAt(px0 - inch(9), pz1 + 0.55, inch(22));
  bracketAt(px1 + inch(9), pz1 + 0.55, inch(22));

  // ---- house numbers "1430" ----------------------------------------------
  const numbers = new THREE.Group();
  const digitW = inch(2.4), digitH = inch(4.0);
  for (let i = 0; i < 4; i++) {
    const d = kit.box(digitW, digitH, inch(0.35), locals.metal(), { r: inch(0.06) });
    d.position.set(i * inch(3.4), (i % 2) * inch(0.06), 0);
    numbers.add(d);
  }
  numbers.position.set(40.4, 6.6, 45.143 + inch(0.9));
  g.add(numbers);

  // ---- doorbell + recessed porch downlight --------------------------------
  const bell = kit.cyl(inch(0.8), inch(0.8), inch(0.5), locals.metal(), 16);
  bell.rotation.x = Math.PI / 2;
  bell.position.set(34.95, 3.40, 42.309 + inch(1.2));
  g.add(bell);

  const canTrim = kit.torus(inch(3.2), inch(0.6), locals.trim(), 24, 6);
  canTrim.rotation.x = Math.PI / 2;
  canTrim.position.set(33.30, CEIL_Y.first - inch(3.2), 43.55);
  g.add(canTrim);
  const canLens = new THREE.Mesh(new THREE.CircleGeometry(inch(3.0), 24),
    mkMat(ctx, 'porchLens', { color: 0xfff3e0, emissive: 0xffdfae, emissiveIntensity: 3.0, roughness: 0.4 }));
  canLens.rotation.x = Math.PI / 2;
  canLens.position.set(33.30, CEIL_Y.first - inch(3.4), 43.55);
  g.add(canLens);
  if (ctx.lights && ctx.lights.recessedCan) {
    try {
      const can = ctx.lights.recessedCan([33.30, CEIL_Y.first - inch(4), 43.55],
        { intensity: 26, temp: 2900, angle: deg(62), castShadow: false });
      if (can && can.group) g.add(can.group);
    } catch { /* optional */ }
  }

  // ---- the round louvered vent half-buried by the porch floor -------------
  // MEASURED off exterior_view_of_front_door.png (back-projected onto the front
  // plane): the vent centre lands at x 25.1, y 2.2 and the little square window
  // directly above it at x 24.9, y 5.25 — both on the FRONT wall west of the
  // post, both facing +Z, with the vent's bottom third lost behind the shrub.
  const v = louveredVent(ctx, ft(1, 1), { locals, panel: false });
  v.position.set(25.10, 2.15, 45.143 - inch(0.2));
  v.rotation.y = Math.PI;
  g.add(v);
  const sq = kit.window({ w: 1.35, h: 1.45, type: 'fixed' },
    { wall: WALL.ext, casing: false, frame: locals.frameDark(), glass: locals.glass() });
  sq.position.set(24.92, 4.52, 45.143);
  sq.rotation.y = Math.PI;
  g.add(sq);
  for (const [dx, dy, cw, ch] of [[-0.78, 0.725, inch(3.4), 1.45 + inch(6.8)],
    [0.78, 0.725, inch(3.4), 1.45 + inch(6.8)], [0, 1.45 + inch(3.4), 1.35 + inch(6.8), inch(3.4)],
    [0, -inch(3.4), 1.35 + inch(6.8), inch(3.4)]]) {
    const c = kit.box(cw, ch, inch(1.2), trim, { r: inch(0.06), uv: true });
    c.position.set(24.92 + dx, 4.52 + dy, 45.143 + WALL.ext / 2 + inch(0.8));
    g.add(c);
  }

  // ---- sidelights beside the front door -----------------------------------
  // dims puts them on ext-first-6 as ordinary windows; they are already built
  // there with plantation shutters. Nothing more to do.
}

function mkMat(ctx, name, patch) {
  ctx.__massingMats = ctx.__massingMats || new Map();
  if (ctx.__massingMats.has(name)) return ctx.__massingMats.get(name);
  const m = new ctx.THREE.MeshPhysicalMaterial(Object.assign({ roughness: 0.85, metalness: 0 }, patch));
  m.userData.keep = true;
  m.name = 'massing:' + name;
  ctx.__massingMats.set(name, m);
  return m;
}

/* ---- rear --------------------------------------------------------------- */

function buildRearFeatures(ctx, locals, G) {
  const { THREE, kit } = ctx;
  const g = new THREE.Group();
  g.name = 'massing:rear';
  G.add(g);
  const timber = locals.timber();

  // ---- the second-floor sunroom as a dark timber post-and-beam glazed box --
  // dims already punches the four sunroom lites in ext-second-0; what makes it
  // read as a BOX in backyard_straight_on_view_of_house is the heavy dark frame
  // laid over them, plus a continuous head beam and sill beam.
  const y0 = LEVELS.second + 1.0;
  const y1 = LEVELS.second + 7.2;
  const zF = -inch(2.0);
  const posts = [0.9, 7.2, 14.4, 21.0, 25.6];
  for (const x of posts) {
    const p = kit.box(inch(7), y1 - y0 + ft(1, 4), inch(6), timber, { r: inch(0.08), seg: 2, uv: true });
    p.position.set(x, (y0 + y1) / 2, zF);
    p.castShadow = true;
    g.add(p);
  }
  for (const [y, h] of [[y1 + inch(5), inch(11)], [y0 - inch(5), inch(10)]]) {
    const b = kit.box(posts[posts.length - 1] - posts[0] + ft(1, 2), h, inch(7), timber,
      { r: inch(0.08), seg: 2, uv: true });
    b.position.set((posts[0] + posts[posts.length - 1]) / 2, y, zF);
    g.add(b);
  }

  // ---- the two full-height dark fins flanking the glass box ---------------
  for (const x of [0.28, 19.35]) {
    const fin = kit.box(inch(8), 19.0, inch(3.4), timber, { r: inch(0.06), seg: 2, uv: true });
    fin.position.set(x, 8.6, -inch(2.6));
    g.add(fin);
  }

  // ---- exterior sconce between the second-floor lites, ON ------------------
  const sc = new THREE.Group();
  const body = kit.box(inch(5), inch(7), inch(4), locals.metal(), { r: inch(0.6), seg: 2 });
  sc.add(body);
  const lens = new THREE.Mesh(new THREE.PlaneGeometry(inch(4.2), inch(1.4)),
    mkMat(ctx, 'sconceLens', { color: 0xfff0d6, emissive: 0xffdcaa, emissiveIntensity: 4.0, roughness: 0.4 }));
  lens.position.set(0, -inch(3.2), 0);
  lens.rotation.x = Math.PI / 2;
  sc.add(lens);
  sc.position.set(10.6, LEVELS.second + 5.6, -inch(3.5));
  g.add(sc);
  if (ctx.lights && ctx.lights.fixtureBulb) {
    try {
      const b2 = ctx.lights.fixtureBulb([10.6, LEVELS.second + 5.2, -0.5],
        { intensity: 8, temp: 2700, radius: 0.12 });
      if (b2 && b2.group) g.add(b2.group);
    } catch { /* optional */ }
  }

  // ---- dryer vent + foundation vents --------------------------------------
  const dv = kit.cyl(inch(2.4), inch(2.4), inch(3), locals.metal(), 16);
  dv.rotation.x = Math.PI / 2;
  dv.position.set(21.8, 3.35, -inch(1.4));
  g.add(dv);
  for (const x of [4.5, 24.0, 33.0]) {
    const fv = kit.box(inch(14), inch(6), inch(1.2), locals.metal(), { r: inch(0.06) });
    fv.position.set(x, -0.72, -inch(1.0));
    g.add(fv);
  }

  // ---- AC condenser on the west flank -------------------------------------
  const ac = new THREE.Group();
  const pad = kit.box(3.0, 0.3, 3.0, locals.concrete(), { r: inch(0.2) });
  pad.position.y = 0.15;
  ac.add(pad);
  const cab = kit.box(2.5, 2.7, 2.5, locals.metal(), { r: inch(0.9), seg: 2 });
  cab.position.y = 0.3 + 1.35;
  ac.add(cab);
  const fan = kit.cyl(1.05, 1.05, inch(1.4), locals.metal(), 28);
  fan.position.y = 0.3 + 2.72;
  ac.add(fan);
  ac.position.set(-2.6, -1.28, 12.0);
  g.add(ac);
  const disc = kit.box(inch(8), inch(11), inch(4), locals.metal(), { r: inch(0.2) });
  disc.position.set(-0.2, 3.2, 12.0);
  g.add(disc);
}

/* ---- service bits ------------------------------------------------------- */

function buildServiceDetails(ctx, locals, G) {
  const { THREE, kit } = ctx;
  const g = new THREE.Group();
  g.name = 'massing:service';
  G.add(g);

  // the second signature round vent, high on the front wall west of the entry,
  // with the small square window directly above it (front_leftside_of_house).
  // MEASURED off exterior_view_of_front_door.png: the second-storey vent
  // back-projects to x 15.4, y 12.1 with the small window at y 14.8 directly
  // above it — i.e. it sits BETWEEN the second-floor window groups on the west
  // wing, not beside the entry box. It also has to face +Z (it was rotated
  // into the wall before), which is why it never appeared in a render.
  const v = louveredVent(ctx, ft(1, 0), { locals, panel: false });
  v.position.set(14.70, 12.10, 45.143 - inch(0.2));
  v.rotation.y = Math.PI;
  g.add(v);
  const sq = kit.window({ w: 2.0, h: 1.5, type: 'fixed' },
    { wall: WALL.ext, casing: false, frame: locals.frameDark(), glass: locals.glass() });
  sq.position.set(14.70, 14.80, 45.143);
  sq.rotation.y = Math.PI;
  g.add(sq);
  // and a small one on the one-storey living wing's east wall
  const v2 = louveredVent(ctx, ft(0, 9), { locals, panelW: ft(2, 2), panelH: ft(2, 2) });
  v2.position.set(60.684, 11.4, 14.0);
  v2.rotation.y = Math.PI / 2;
  g.add(v2);

  // electric meter + service conduit on the east flank (front_rightside)
  const meter = kit.cyl(inch(3.6), inch(3.6), inch(4.0), locals.metal(), 24);
  meter.rotation.z = Math.PI / 2;
  meter.rotation.y = Math.PI / 2;
  meter.position.set(60.684 + inch(3), 4.6, 34.0);
  g.add(meter);
  const mBox = kit.box(inch(2.5), inch(16), inch(11), locals.metal(), { r: inch(0.3), seg: 2 });
  mBox.position.set(60.684 + inch(1.3), 4.1, 34.0);
  g.add(mBox);
  const conduit = kit.cyl(inch(1.1), inch(1.1), 4.6, locals.metal(), 12);
  conduit.position.set(60.684 + inch(1.6), 7.2, 34.0);
  g.add(conduit);

  // hose bibs
  for (const [x, y, z, ry] of [[60.684 + inch(1), 1.6, 30.0, Math.PI / 2], [1.6, 1.5, -inch(1), 0]]) {
    const bib = kit.cyl(inch(0.55), inch(0.55), inch(5), locals.metal(), 10);
    bib.rotation.x = Math.PI / 2;
    bib.position.set(x, y, z);
    bib.rotation.y = ry;
    g.add(bib);
    const handle = kit.cyl(inch(1.5), inch(1.5), inch(0.5), locals.metal(), 12);
    handle.position.set(x, y + inch(2.4), z);
    g.add(handle);
  }
}

/* ---- interior glow ------------------------------------------------------ */

/**
 * The photographs show warm interior light in every pane, and legible rooms
 * behind the rear glass wall. Without something behind the glass an exterior
 * render reads as a stage flat, so: real floors, a real ceiling, and a handful
 * of shadowless warm lamps.
 */
function buildInteriorGlow(ctx, locals, G) {
  const { THREE, kit } = ctx;
  const g = new THREE.Group();
  g.name = 'massing:interior';
  G.add(g);

  const floorM = mkMat(ctx, 'intFloor', { color: 0x9d6f43, roughness: 0.42, clearcoat: 0.5 });
  const ceilM = mkMat(ctx, 'intCeil', { color: 0xf2efe8, roughness: 0.95 });

  const plate = (poly, y, m, flip) => {
    const shape = new THREE.Shape();
    poly.forEach(([x, z], i) => (i ? shape.lineTo(x, -z) : shape.moveTo(x, -z)));
    shape.closePath();
    const mesh2 = new THREE.Mesh(new THREE.ShapeGeometry(shape), m);
    mesh2.rotation.x = flip ? Math.PI / 2 : -Math.PI / 2;
    mesh2.position.y = y;
    mesh2.receiveShadow = true;
    g.add(mesh2);
  };
  plate(FOOTPRINTS.first, LEVELS.first + 0.02, floorM, false);
  plate(FOOTPRINTS.second, LEVELS.second + 0.02, floorM, false);
  plate(FOOTPRINTS.first, CEIL_Y.first - 0.02, ceilM, true);
  plate(FOOTPRINTS.second, CEIL_Y.second - 0.02, ceilM, true);

  const lamps = [
    [10, 6.6, 8, 2700, 30], [24, 6.6, 6, 2700, 26], [8, 6.4, 26, 2700, 22],
    [34, 6.4, 34, 2700, 20], [50, 6.6, 14, 2700, 24],
    [10, 15.6, 6, 2700, 26], [18, 15.6, 16, 2700, 20], [30, 15.6, 38, 2700, 18],
  ];
  for (const [x, y, z, k, i] of lamps) {
    const l = new THREE.PointLight(0xffd9a8, i, 34, 2);
    l.position.set(x, y, z);
    l.castShadow = false;
    g.add(l);
  }
}

export default buildMassing;
