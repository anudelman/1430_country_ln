/**
 * app/src/rooms/exterior-entry.js — the front door and its bluestone stoop.
 *
 * Photo: `exterior_view_of_front_door.png`
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS PIECE OWNS
 * ---------------------------------------------------------------------------
 * The envelope (siding, soffit, beam, reeded post, the door and the two
 * flanking shuttered lights, the porthole above) is shared geometry and lives
 * in `core/massing.js`, driven by `core/dims.js`. The whole-lot planting and
 * the walk out to the drive belong to `rooms/exterior-front.js`. What is left —
 * and what fills two thirds of this photograph — is:
 *
 *   - the RAISED bluestone stoop, laid slab by slab on a mortar bed, running
 *     5 ft past the facade with a one-riser nosing at its front edge;
 *   - the mulch beds and their stone edging on both sides of it;
 *   - the two big rounded shrubs that crowd the frame from the left (a
 *     purple-leaf ninebark and a green privet) and the privet that crowds it
 *     from the right;
 *   - the coir "welcome home" doormat — one of only a handful of movable
 *     objects in the whole house;
 *   - the small hardware a camera catches at 15 ft: the in-use GFCI cover, the
 *     door sweep, the caulk joint where the dark casing dies into the siding,
 *     the checked split in the post base;
 *   - the fill that keeps the porch shadow OPEN. PHOTOGRAPHY §5.3: an ordinary
 *     shadow in these photographs bottoms out at L 25-70, never at black. A
 *     sun-plus-sky exterior render crushes a recessed porch to nothing, and
 *     that single fact is the loudest tell in an entry shot.
 *
 * ---------------------------------------------------------------------------
 * WHERE THE NUMBERS COME FROM
 * ---------------------------------------------------------------------------
 * Everything below was back-projected out of the photograph rather than
 * guessed. A camera was fitted to the 3'0" x 6'8" door leaf and the two
 * corners of the entry recess (f = 623 px on a 1531 x 1020 frame, i.e. the
 * same ~14.6 mm lens as the interiors; station 37.9, 3.3, 58.0; yaw 40 deg
 * west of north). Feeding the observed pixel coordinates back through it puts
 *
 *   the step nosing at        z = 50.1 - 50.6   (5 ft past the facade)
 *   the porch paving at       y = -0.48
 *   the sidelight glass at    y = 0.21 .. 6.25  (full height, not a sill unit)
 *   the porthole centre at    y = 12.3 .. 12.5
 *   the little square window  x 24.9, y 5.2, on the FRONT plane, not the recess
 *
 * all of which are now in dims.js.
 */

import { buildMassing } from '../core/massing.js';
import { applyExteriorDaylight } from './exterior-front.js';
import { LEVELS, CEIL_Y, MASSING, SITE, WALL } from '../core/dims.js';
import { applyUV } from '../core/materials.js';
import { inch, ft, deg } from '../core/units.js';

export const meta = {
  id: 'exterior-entry',
  title: 'Front door / entry',
  level: 'exterior',
  photos: ['exterior_view_of_front_door.png'],
};

/* Measured geometry of the entry, all in feet. */
const P = MASSING.blocks.entryPorch;
const STOOP = P.stoop;                    // [x0, z0, x1, z1]
const STOOP_Y = P.floorY;                 // -0.45, top of the bluestone
const WALK_Y = SITE.walkway.y;            // -0.90, top of the walk
const GRASS = SITE.lot.grassY;            // -1.15

export function build(ctx) {
  const { THREE } = ctx;
  buildMassing(ctx);
  applyExteriorDaylight(ctx);

  const g = new THREE.Group();
  g.name = 'exterior-entry';
  ctx.group.add(g);

  hideStandIns(ctx);
  buildStoop(ctx, g);
  buildBeds(ctx, g);
  buildPlanting(ctx, g);
  buildDoormat(ctx, g);
  buildHardware(ctx, g);
  buildPorchFill(ctx, g);
}

/* ======================================================================== */
/* 0. materials                                                              */
/* ======================================================================== */

function mat(ctx, name, patch, libName) {
  ctx.__entryMats = ctx.__entryMats || new Map();
  if (ctx.__entryMats.has(name)) return ctx.__entryMats.get(name);
  const lib = ctx.mat || {};
  let m;
  const base = libName && lib[libName];
  if (base && base.isMaterial) {
    m = base.clone();
    if (patch) {
      Object.assign(m, patch);
      if (patch.color !== undefined) m.color = new ctx.THREE.Color(patch.color);
      if (patch.sheenColor !== undefined) m.sheenColor = new ctx.THREE.Color(patch.sheenColor);
    }
    m.userData = Object.assign({}, base.userData);
  } else {
    m = new ctx.THREE.MeshPhysicalMaterial(Object.assign({ roughness: 0.9, metalness: 0 }, patch));
  }
  m.name = 'entry:' + name;
  m.userData.keep = true;
  ctx.__entryMats.set(name, m);
  return m;
}

/** Deterministic hash in [0,1) — the planting must not move between shots. */
function frac(n) {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * shell.js drops a flat bluestone quad and a black box for the post before any
 * room module runs, and exterior-front lays its walk apron with a stacked
 * riser. Nothing of ours may fight with those, so kill the stand-ins that sit
 * inside the stoop footprint.
 */
function hideStandIns(ctx) {
  const scene = ctx.scene || ctx.group;
  const dead = ['shell:porch', 'shell:porchPost'];
  scene.traverse((o) => {
    if (dead.indexOf(o.name) !== -1) o.visible = false;
  });
}

/* ======================================================================== */
/* 1. The bluestone stoop                                                    */
/* ======================================================================== */

/**
 * Irregular-rectangular ashlar, laid by guillotine subdivision so no two
 * courses break in the same place. Real bluestone here is MORTARED, not
 * sand-set: the joints in the photograph are a pale gray band 3/8"-5/8" wide
 * that sits slightly below the stone face and catches its own light.
 */
function layAshlar(ctx, parent, x0, z0, x1, z1, y, seed, tones) {
  const { kit } = ctx;
  let k = seed;
  let z = z0;
  const rows = [];
  while (z < z1 - 0.55) {
    const d = 1.55 + frac(k++ * 1.7) * 1.35;
    rows.push([z, Math.min(z1, z + d)]);
    z += d;
  }
  if (rows.length && z1 - rows[rows.length - 1][1] > 0.2) rows[rows.length - 1][1] = z1;

  for (const [za, zb] of rows) {
    let x = x0;
    while (x < x1 - 0.55) {
      const w = 1.5 + frac(k++ * 2.31) * 1.85;
      let xb = Math.min(x1, x + w);
      if (x1 - xb < 0.75) xb = x1;               // no silly slivers at the edge
      // joint width varies 1/4" - 5/8", as it does on a hand-laid walk
      const j = inch(0.30) + frac(k * 5.9) * inch(0.34);
      const t = inch(1.45) + frac(k * 3.3) * inch(0.25);
      const m = tones[(k * 7) % tones.length];
      const s = kit.box(xb - x - j, t, zb - za - j, m, { r: inch(0.22), seg: 1 });
      // 22 ft per repeat puts each slab INSIDE one cell of the bluestone map,
      // so we get its cleft grain and iron staining without its baked cell
      // outlines fighting our real, rectangular joints.
      applyUV(s, 22, { axes: 'xz', size: [xb - x, zb - za], offset: [frac(k * 1.9), frac(k * 4.7)] });
      s.position.set((x + xb) / 2, y - t / 2 + inch(0.05) * (frac(k * 8.9) - 0.5), (za + zb) / 2);
      s.rotation.y = deg((frac(k * 5.1) - 0.5) * 1.1);
      s.rotation.x = deg((frac(k * 8.7) - 0.5) * 0.8);
      s.castShadow = false;
      s.receiveShadow = true;
      parent.add(s);
      k++;
      x = xb;
    }
  }
}

function buildStoop(ctx, g) {
  const { THREE, kit } = ctx;
  const [sx0, sz0, sx1, sz1] = STOOP;

  // SAMPLED off the photograph: sunlit stone runs 150-178 sRGB and shaded
  // stone 96-126, always blue-grey, never the near-white the first pass gave.
  // The tones are deliberately spread ~18% so no two adjacent slabs match.
  const stone = ctx.mat && ctx.mat.bluestone;
  const tones = [
    mat(ctx, 'stoneA', { color: 0x6f757c }, 'bluestone'),
    mat(ctx, 'stoneB', { color: 0x646a72 }, 'bluestone'),
    mat(ctx, 'stoneC', { color: 0x787d81 }, 'bluestone'),
    mat(ctx, 'stoneD', { color: 0x5d656e }, 'bluestone'),
    mat(ctx, 'stoneE', { color: 0x71736f }, 'bluestone'),
    mat(ctx, 'stoneF', { color: 0x6a7079 }, 'bluestone'),
  ];
  if (!stone) tones.forEach((m) => { m.color.setHex(0x6a7079); });

  const grp = new THREE.Group();
  grp.name = 'entry:stoop';
  g.add(grp);

  /* ---- the mortar bed the slabs sit in ---------------------------------- */
  const mortar = mat(ctx, 'mortar', { color: 0xb3b0a7, roughness: 0.97 }, 'concreteDriveway');
  const bed = kit.box(sx1 - sx0 + 0.5, 0.62, sz1 - sz0 + 0.4, mortar, { r: inch(0.5), seg: 2, uv: true });
  bed.position.set((sx0 + sx1) / 2, STOOP_Y - inch(1.45) - 0.31 + inch(0.6), (sz0 + sz1) / 2);
  bed.receiveShadow = true;
  bed.castShadow = true;
  applyUV(bed, 5, { axes: 'xz', size: [sx1 - sx0, sz1 - sz0] });
  grp.add(bed);

  /* ---- the paving ------------------------------------------------------- */
  layAshlar(ctx, grp, sx0, sz0, sx1, sz1, STOOP_Y, 4101, tones);

  /* ---- the nosing: one ~5.5" riser down to the walk ---------------------
   * In the photograph the nosing is a single band of thicker stone with the
   * courses of the walk butting into it, and it is very slightly out of level
   * from one end to the other. */
  let k = 91;
  for (let x = sx0; x < sx1 - 0.4; ) {
    const w = Math.min(sx1 - x, 2.6 + frac(k * 4.1) * 1.4);
    const r = kit.box(w - inch(0.35), STOOP_Y - WALK_Y + inch(1.6), 1.15, tones[(k * 3) % tones.length],
      { r: inch(0.30), seg: 2 });
    applyUV(r, 22, { axes: 'xz', size: [w, 1.15], offset: [frac(k * 2.3), frac(k * 5.1)] });
    r.position.set(x + w / 2, (STOOP_Y + WALK_Y) / 2 - inch(0.5),
      sz1 - 0.5 + (frac(k * 6.3) - 0.5) * 0.06);
    r.rotation.y = deg((frac(k * 7.7) - 0.5) * 1.2);
    r.rotation.z = deg((frac(k * 2.9) - 0.5) * 0.55);
    r.receiveShadow = true;
    grp.add(r);
    x += w;
    k++;
  }

  /* ---- a soldier edge along the east side, against the hedge ------------- */
  for (let z = sz0 + 0.4; z < sz1 - 0.4; ) {
    const d = 1.5 + frac(k * 3.7) * 1.1;
    const e = kit.box(0.95, inch(3.2), d - inch(0.4), tones[(k * 5) % tones.length],
      { r: inch(0.22), seg: 1 });
    applyUV(e, 22, { axes: 'xz', size: [0.95, d], offset: [frac(k * 3.7), frac(k * 6.1)] });
    e.position.set(sx1 + 0.45, STOOP_Y - inch(1.6), z + d / 2);
    e.rotation.y = deg((frac(k * 9.1) - 0.5) * 1.6);
    e.receiveShadow = true;
    grp.add(e);
    z += d;
    k++;
  }
}

/* ======================================================================== */
/* 2. Mulch beds and edging                                                  */
/* ======================================================================== */

function buildBeds(ctx, g) {
  const { THREE, kit } = ctx;
  const mulch = mat(ctx, 'mulch', { color: 0x2a221b, roughness: 0.99 }, 'mulchBed');
  const grp = new THREE.Group();
  grp.name = 'entry:beds';
  g.add(grp);

  const bedPlate = (poly, y) => {
    const shape = new THREE.Shape();
    poly.forEach(([x, z], i) => (i ? shape.lineTo(x, -z) : shape.moveTo(x, -z)));
    shape.closePath();
    const m = new THREE.Mesh(new THREE.ShapeGeometry(shape), mulch);
    m.rotation.x = -Math.PI / 2;
    m.position.y = y;
    m.receiveShadow = true;
    m.castShadow = false;
    applyUV(m, 3, { axes: 'xz' });
    grp.add(m);
    return m;
  };

  // west bed — the black mulch that fills the bottom-left of the frame
  bedPlate([
    [10.0, 47.6], [27.2, 48.4], [28.6, 51.2], [30.4, 56.6],
    [26.0, 60.5], [14.0, 59.0], [9.0, 54.0],
  ], GRASS + 0.05);
  // east bed behind the privet, and the wedge in the bottom-right corner
  bedPlate([
    [40.9, 46.0], [50.6, 46.4], [51.4, 58.2], [43.2, 60.6], [40.6, 53.0],
  ], GRASS + 0.05);

  /* ---- the pale stone edging band between walk and mulch ----------------
   * It shows clearly at the bottom-right of the photograph: a single course of
   * tan cut stone half-buried in the mulch. */
  const edgeM = mat(ctx, 'edgeStone', { color: 0xa79b88, roughness: 0.94 }, 'concreteDriveway');
  let k = 17;
  const run = (ax, az, bx, bz) => {
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.round(len / 2.1));
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 1) / n;
      const cx = ax + (bx - ax) * (t0 + t1) / 2;
      const cz = az + (bz - az) * (t0 + t1) / 2;
      const s = kit.box(len / n - inch(0.5), inch(4.6), 0.72, edgeM, { r: inch(0.16), seg: 1, uv: true });
      s.position.set(cx, WALK_Y - inch(0.6) + (frac(k * 3.1) - 0.5) * 0.04, cz);
      s.rotation.y = -Math.atan2(bz - az, bx - ax) + deg((frac(k * 5.3) - 0.5) * 2.0);
      s.receiveShadow = true;
      grp.add(s);
      k++;
    }
  };
  run(40.55, 51.6, 44.6, 60.2);
  run(30.2, 51.4, 33.4, 60.0);
}

/* ======================================================================== */
/* 3. The shrubs that crowd the frame                                        */
/* ======================================================================== */

function buildPlanting(ctx, g) {
  const { THREE, kit } = ctx;
  const grp = new THREE.Group();
  grp.name = 'entry:planting';
  g.add(grp);

  const draft = ctx.quality === 'draft' || ctx.quality === 'thumb';

  /* ---- foliage materials -------------------------------------------------
   * SAMPLED off the photograph. The left-hand mass is a purple-leaf ninebark:
   * olive-green in the shade, plum where the sun catches it, NOT the flat
   * brown a single dark albedo gives. Two card materials interleaved is what
   * makes a real shrub read as a shrub. The core ellipsoid inside
   * kit.shrubMass is 90% of the canopy radius, so it must be dark enough to
   * pass for the shadowed interior of the bush — a mid-tone core is what turns
   * these into billiard balls. */
  const plumA = mat(ctx, 'leafPlumA', { color: 0x7f8348, sheenColor: 0xbfae7e }, 'foliageShrub');
  const plumB = mat(ctx, 'leafPlumB', { color: 0x86604f, sheenColor: 0xc09a86 }, 'foliageShrub');
  const darkCore = mat(ctx, 'shrubCoreDark', { color: 0x1b2410, roughness: 0.99 });
  const privetA = mat(ctx, 'leafPrivetA', { color: 0x7c9440, sheenColor: 0xb9cd7e }, 'foliageShrub');
  const privetB = mat(ctx, 'leafPrivetB', { color: 0x5e7c33, sheenColor: 0x9dba68 }, 'foliageShrub');

  /**
   * One shrub = two interleaved canopies of leaf cards at slightly different
   * radii and hues over a dark core, which is what stops the silhouette from
   * reading as a solid of revolution.
   */
  const blob = (a, b, cx, cy, cz, rx, ry, rz, seed, card) => {
    grp.add(kit.shrubMass({
      leaf: a, core: darkCore,
      center: [cx, cy, cz],
      radii: [rx, ry, rz],
      card: card === undefined ? 0.62 : card,
      density: draft ? 0.8 : 5.2,
      lumps: 7,
      seed,
      name: `entry:shrub:${seed}`,
    }));
    if (draft) return;
    grp.add(kit.leafCanopy(b, {
      center: [cx + rx * 0.06, cy + ry * 0.05, cz - rz * 0.05],
      radii: [rx * 1.04, ry * 1.03, rz * 1.04],
      count: Math.round(rx * ry * rz * 11),
      card: (card === undefined ? 0.62 : card) * 0.82,
      shell: 0.95,
      lumps: 6,
      flatten: 0.18,
      seed: seed + 7,
      name: `entry:shrub:${seed}:b`,
    }));
  };

  /* ---- the two big masses that crowd in from the left -------------------- */
  blob(plumA, plumB, 15.2, GRASS + 3.2, 52.2, 4.4, 3.2, 3.9, 3101, 0.72);
  blob(plumB, plumA, 11.6, GRASS + 2.5, 55.4, 3.2, 2.6, 3.0, 3117, 0.66);
  blob(privetA, privetB, 22.2, GRASS + 2.9, 51.4, 3.4, 2.9, 3.2, 3131, 0.62);
  blob(privetB, privetA, 19.8, GRASS + 1.9, 55.0, 2.7, 2.0, 2.6, 3149, 0.58);
  // the low straggly ground cover that spills off the bed into the mulch
  if (!draft) {
    for (let i = 0; i < 10; i++) {
      const t = i / 10;
      blob(privetA, privetB,
        12.5 + t * 13.0 + (frac(i * 3.7) - 0.5) * 1.6,
        GRASS + 0.5 + frac(i * 5.1) * 0.45,
        55.8 + Math.sin(t * 4.7) * 1.8 + (frac(i * 9.1) - 0.5) * 1.4,
        1.0 + frac(i * 2.2) * 0.45, 0.55, 0.95 + frac(i * 6.6) * 0.35,
        3200 + i * 13, 0.42);
    }
  }

  /* ---- the privet that crowds the right edge of the frame ---------------
   * In the photograph it fills the right fifth of the frame from the stoop
   * edge to the bottom corner and is CLOSER to the camera than the stoop is,
   * which is what gives that side of the picture its depth. */
  blob(privetA, privetB, 42.4, GRASS + 3.0, 49.0, 2.9, 3.0, 3.0, 3301, 0.66);
  blob(privetB, privetA, 43.6, GRASS + 3.3, 53.4, 3.4, 3.3, 3.4, 3317, 0.70);
  blob(privetA, privetB, 44.8, GRASS + 2.6, 57.6, 3.0, 2.7, 3.0, 3323, 0.62);
  blob(privetB, privetA, 41.4, GRASS + 2.1, 45.6, 2.1, 2.2, 2.3, 3329, 0.55);
}

/* ======================================================================== */
/* 4. The coir doormat — a movable object, and there are only six in the set */
/* ======================================================================== */

/**
 * Woven coir with a dark bound edge and "welcome home" in a light script.
 * This is the one genuinely bespoke object in the piece, so its map is drawn
 * here rather than added to textures.js: nothing else in the house can use a
 * doormat that says this.
 */
function coirTexture(THREE) {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const x = c.getContext('2d');
  x.fillStyle = '#b08c58';
  x.fillRect(0, 0, S, S);
  // the weave: alternating warp/weft bundles, ~5 per inch on a 30" mat
  const pitch = S / 46;
  for (let i = 0; i < 46; i++) {
    for (let j = 0; j < 46; j++) {
      const over = (i + j) % 2 === 0;
      const t = 0.72 + Math.random() * 0.34;
      const r = Math.round((over ? 196 : 150) * t);
      const gg = Math.round((over ? 154 : 116) * t);
      const b = Math.round((over ? 92 : 66) * t);
      x.fillStyle = `rgb(${r},${gg},${b})`;
      x.fillRect(i * pitch, j * pitch, pitch * 0.96, pitch * 0.96);
    }
  }
  // loose fibre noise
  for (let i = 0; i < 5200; i++) {
    const px = Math.random() * S, py = Math.random() * S;
    const l = 3 + Math.random() * 9, a = Math.random() * Math.PI;
    x.strokeStyle = `rgba(${190 + Math.random() * 50 | 0},${150 + Math.random() * 50 | 0},90,0.25)`;
    x.lineWidth = 1;
    x.beginPath();
    x.moveTo(px, py);
    x.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l);
    x.stroke();
  }
  // bound edge
  x.strokeStyle = '#6a4c2c';
  x.lineWidth = S * 0.035;
  x.strokeRect(S * 0.045, S * 0.075, S * 0.91, S * 0.85);
  // the script legend, deliberately soft and low-contrast — in the photograph
  // it is barely legible at all
  x.save();
  x.translate(S / 2, S * 0.53);
  x.rotate(-0.012);
  x.font = `italic 600 ${Math.round(S * 0.13)}px Georgia, "Times New Roman", serif`;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillStyle = 'rgba(58,38,22,0.72)';
  x.fillText('welcome home', 0, 0);
  x.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

function buildDoormat(ctx, g) {
  const { THREE, kit } = ctx;
  const map = coirTexture(THREE);
  const m = new THREE.MeshPhysicalMaterial({
    map, roughness: 0.99, metalness: 0, envMapIntensity: 0.6,
    sheen: 0.35, sheenRoughness: 0.95,
    sheenColor: new THREE.Color(0xd8bb8c),
  });
  m.userData.keep = true;
  m.name = 'entry:coir';

  // 18" x 30", oval-ended: a rounded box with a big corner radius reads as the
  // real shape far better than a rectangle, and the mat is genuinely askew.
  const mat0 = kit.box(2.55, inch(0.85), 1.52, m, { r: inch(4.6), seg: 3 });
  mat0.position.set(33.55, STOOP_Y + inch(0.42), 44.05);
  mat0.rotation.y = deg(3.4);
  mat0.castShadow = true;
  mat0.receiveShadow = true;
  g.add(mat0);
}

/* ======================================================================== */
/* 5. Hardware, caulk and wear                                               */
/* ======================================================================== */

function buildHardware(ctx, g) {
  const { THREE, kit } = ctx;
  const grp = new THREE.Group();
  grp.name = 'entry:hardware';
  g.add(grp);

  const zR = 42.309 + WALL.ext / 2;      // outside face of the recess wall
  const zF = 45.143 + WALL.ext / 2;      // outside face of the front plane
  const dark = mat(ctx, 'darkTrim', { color: 0x3a3b38, roughness: 0.78, clearcoat: 0.1 });
  const grayPlastic = mat(ctx, 'inUseCover', { color: 0x9b9a94, roughness: 0.55, clearcoat: 0.25 });
  const metal = mat(ctx, 'entryMetal', { color: 0x2e2f31, roughness: 0.4, metalness: 0.6 });

  /* ---- exterior GFCI in a gray in-use cover, 24" AFG, a shade off plumb -- */
  const cover = kit.box(inch(4.2), inch(6.4), inch(1.9), grayPlastic, { r: inch(0.28), seg: 2 });
  cover.position.set(31.05, STOOP_Y + ft(2, 0), zR + inch(0.9));
  cover.rotation.z = deg(0.8);
  grp.add(cover);
  const lid = kit.box(inch(4.0), inch(2.4), inch(0.5), grayPlastic, { r: inch(0.2), seg: 2 });
  lid.position.set(31.05, STOOP_Y + ft(2, 0) + inch(3.0), zR + inch(1.7));
  lid.rotation.x = deg(-16);
  lid.rotation.z = deg(0.8);
  grp.add(lid);

  /* ---- a hose bib low on the same wall ---------------------------------- */
  const bib = kit.cyl(inch(0.5), inch(0.5), inch(4.5), metal, 12);
  bib.rotation.x = Math.PI / 2;
  bib.position.set(31.9, STOOP_Y + ft(1, 4), zR + inch(2.2));
  grp.add(bib);
  const wheel = kit.cyl(inch(1.4), inch(1.4), inch(0.45), metal, 14);
  wheel.position.set(31.9, STOOP_Y + ft(1, 4) + inch(2.2), zR + inch(3.6));
  grp.add(wheel);

  /* ---- caulk joint where the dark casing dies into the siding ------------
   * A 3/8" bead, slightly glossier than either surface and never quite
   * straight. It is one of the details a hostile eye looks for. */
  const caulk = mat(ctx, 'caulk', { color: 0x50524e, roughness: 0.55, clearcoat: 0.35 });
  const bead = (x, y0, y1, z) => {
    const b = kit.cyl(inch(0.19), inch(0.19), y1 - y0, caulk, 8);
    b.position.set(x, (y0 + y1) / 2, z);
    b.rotation.z = deg((frac(x) - 0.5) * 0.6);
    b.castShadow = false;
    grp.add(b);
  };
  bead(27.98, STOOP_Y, 7.2, zR + inch(0.2));
  bead(39.55, STOOP_Y, 7.2, zR + inch(0.2));
  bead(24.06, GRASS, 5.5, zF + inch(0.2));

  /* ---- door sweep and threshold wear ------------------------------------- */
  const sweep = kit.box(3.05, inch(0.9), inch(1.4), dark, { r: inch(0.2), seg: 2 });
  sweep.position.set(33.30, LEVELS.first - inch(1.2), zR - inch(0.4));
  grp.add(sweep);

  /* ---- the checked split in the base of the reeded post ------------------ */
  const timber = mat(ctx, 'postSplit', { color: 0x241f1a, roughness: 0.95 });
  const split = kit.box(inch(0.55), 1.35, inch(1.0), timber, { r: inch(0.06) });
  split.position.set(P.post.at[0] - inch(4.1), STOOP_Y + 0.62, P.post.at[1] - inch(1.6));
  split.rotation.z = deg(2.2);
  grp.add(split);
}

/* ======================================================================== */
/* 6. Light                                                                  */
/* ======================================================================== */

/**
 * The porch is a 2'10" deep hole in a sunlit facade. Left to sun + sky alone
 * it renders as a black slot; in the photograph the door, the shutters and
 * the stone under the soffit are all fully legible, because a bracketed merge
 * lifts them (PHOTOGRAPHY §2.1, §5.3 — shadow : lit = 0.45..0.65 linear).
 *
 * Three shadowless fills do it, all warm, none of them a "light source" the
 * viewer could point at:
 *   - a broad bounce off the sunlit bluestone back into the recess;
 *   - a soft wash across the door face;
 *   - the recessed soffit can, which is genuinely ON in the photograph.
 */
function buildPorchFill(ctx, g) {
  const { THREE } = ctx;
  const grp = new THREE.Group();
  grp.name = 'entry:fill';
  g.add(grp);

  // Ranges pulled in so the fill cannot reach the sunlit facade: at 26 ft it
  // printed two bright pools on the garage wall in the straight-on elevation,
  // which is a hotspot no midday exterior has.
  const bounce = new THREE.PointLight(0xffe9cf, 18, 13, 2);
  bounce.position.set(33.4, 1.1, 46.6);
  bounce.castShadow = false;
  grp.add(bounce);

  const wash = new THREE.PointLight(0xfff0dc, 9, 9, 2);
  wash.position.set(31.2, 4.4, 44.4);
  wash.castShadow = false;
  grp.add(wash);

  const east = new THREE.PointLight(0xffeedd, 8, 9, 2);
  east.position.set(38.2, 3.2, 44.2);
  east.castShadow = false;
  grp.add(east);

  // The stone under the soffit still has to read as stone, so give the paving
  // its own low bounce rather than lifting the whole scene's ambient.
  const stoneBounce = new THREE.PointLight(0xf6e6cd, 8, 12, 2);
  stoneBounce.position.set(33.4, 0.6, 43.8);
  stoneBounce.castShadow = false;
  grp.add(stoneBounce);
}

export default build;
