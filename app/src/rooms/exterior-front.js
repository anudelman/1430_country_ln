/**
 * app/src/rooms/exterior-front.js — the street elevation.
 *
 * Photos: straight_on_view_of_house_from_street.png, front_leftside_of_house.png,
 *         front_rightside_of_house.png
 *
 * The building envelope lives in core/massing.js and is shared with
 * `exterior-rear` (both pieces are on the same `exterior` scene, so the massing
 * builder memoises itself on the scene). This module owns:
 *
 *   - THE PLANTING for the whole lot — trees, hedges, shrubs, mulch. Also
 *     memoised on the scene, so `exterior-rear` can call `buildSitePlanting`
 *     and get the same objects rather than a second, conflicting set.
 *   - the street-side hardscape the front photos catch: the bluestone walk and
 *     its landing, the broom-finished drive with its control joints and its
 *     curb cut, splash blocks, edging boulders;
 *   - the neighbours left and right, and the canopy that closes the sky behind
 *     the roof;
 *   - the small daylight correction the exterior scene needs on top of
 *     lighting.js's preset.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE STRAIGHT-ON PHOTOGRAPH ACTUALLY IS
 * ---------------------------------------------------------------------------
 * Solved rather than eyeballed, from f = 818 px on a 1021-px frame:
 *
 *   facade scale                 16.4 px/ft  -> the camera stands 49.9 ft off
 *                                              the front wall, i.e. z = 95
 *   horizon (frame centre)       y = 510     -> eye 5.6 ft above the garage
 *                                              grade: hand-held, not a tripod
 *   porthole glass               65 px       -> 4.0 ft over the trim ring
 *   siding courses               11 px       -> 8" exposure, confirmed
 *   front tree trunk base        280 px below the horizon
 *                                            -> 21 ft from the camera (z = 74)
 *   front tree canopy            640 px wide -> only 19 ft across
 *
 * That last line is the one that matters most. The tree owns a third of the
 * frame not because it is enormous but because it is CLOSE — and everything
 * about how it reads (leaves resolving individually, sky through the gaps, a
 * soft dappled shadow pooling to the WNW across the mown lawn) follows from
 * that. A canopy of smooth shaded lumps at this distance loses in one second.
 *
 * LIGHT — measured, not guessed. In `front_rightside_of_house.png` the EAST
 * flank of the garage is brighter than the front wall; in
 * `front_leftside_of_house.png` the WEST flank is in deep shade while the front
 * is lit. That puts the sun south-east of the house: azimuth ~132°, elevation
 * ~56°, i.e. a late-summer late morning. Grazing light across a +Z facade is
 * also exactly what makes the 8" lap courses read as a ladder of hard shadows,
 * which is the single most recognisable thing about this facade.
 *
 * The analytic sun itself belongs to `lighting.js`'s `exterior` preset —
 * main.js stands it up AFTER the rooms build, so a room that adds its own gets
 * a second sun and a doubled exposure. This module only adds the warm bounce
 * that a sunlit lawn throws back up under the eaves.
 */

import { buildMassing } from '../core/massing.js';
import { MASSING, SITE } from '../core/dims.js';
import { applyUV } from '../core/materials.js';
import { inch, deg } from '../core/units.js';

export const meta = {
  id: 'exterior-front',
  title: 'Front elevation',
  level: 'exterior',
  photos: [
    'straight_on_view_of_house_from_street.png',
    'front_leftside_of_house.png',
    'front_rightside_of_house.png',
  ],
};

/** The one sun this scene has. Both exterior pieces agree on it. */
export const SUN = { azimuth: 132, elevation: 56, turbidity: 2.3 };

const GRASS = SITE.lot.grassY;

/* ======================================================================== */
/* build                                                                     */
/* ======================================================================== */

export function build(ctx) {
  const { THREE } = ctx;
  buildMassing(ctx);
  applyExteriorDaylight(ctx);

  const g = new THREE.Group();
  g.name = 'exterior-front';
  ctx.group.add(g);

  buildHardscape(ctx, g);
  buildNeighbours(ctx, g);
  ctx.group.add(buildSitePlanting(ctx));
}

/* ======================================================================== */
/* 1. Hardscape — walk, drive, edging, splash blocks                         */
/* ======================================================================== */

function buildHardscape(ctx, g) {
  const { THREE, kit } = ctx;
  const stone = mat(ctx, 'bluestone');
  const concrete = mat(ctx, 'concreteDriveway');
  const mulchM = mat(ctx, 'mulchBed');

  /* ---- the bluestone landing + walk ------------------------------------
   * Irregular-RECTANGULAR ashlar, ~1.5" thick, tight sand joints ~3/8".
   * Never a running bond: the real walk is a jigsaw of four plan sizes, and
   * the eye reads the varied joint pattern long before it reads the stone. */
  const [lx0, lz0, lx1, lz1] = SITE.walkway.landing;
  const walk = new THREE.Group();
  walk.name = 'front:bluestoneWalk';
  layFlagstone(ctx, walk, stone, lx0 - 0.3, lz0, lx1 + 0.3, lz1 + 1.2, SITE.walkway.y + inch(0.9), 1701);
  // the run out toward the drive, three courses wide, stepping east
  layFlagstone(ctx, walk, stone, lx1 - 0.6, lz1 + 1.2, lx1 + 5.4, lz1 + 5.6, SITE.walkway.y + inch(0.6), 2802);
  g.add(walk);

  /* ---- stacked-stone step riser up to the porch ------------------------- */
  for (let i = 0; i < 5; i++) {
    const w = 2.5 + frac(i * 3.1) * 0.6;
    const s = kit.box(w, inch(5.6), 1.35, stone, { r: inch(0.6), seg: 2, uv: true });
    s.position.set(lx0 + 0.6 + i * 2.55, SITE.walkway.y + inch(4.4), lz0 - 0.05);
    s.rotation.y = deg((frac(i * 7.7) - 0.5) * 1.4);
    s.rotation.z = deg((frac(i * 4.3) - 0.5) * 0.5);   // one riser out of level
    s.receiveShadow = true;
    g.add(s);
  }

  /* ---- driveway control joints ----------------------------------------
   * Broom-finished concrete is poured in ~10 ft bays; the sawn joints are the
   * only thing that stops a big slab reading as one flat CG plane. */
  const joints = new THREE.Group();
  joints.name = 'front:driveJoints';
  const jm = mat(ctx, 'jointDark', { color: 0x6c6a64, roughness: 0.95 });
  const jointList = driveJoints();
  for (const [a, b] of jointList) {
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    const j = new THREE.Mesh(new THREE.PlaneGeometry(len, inch(0.55)), jm);
    j.rotation.x = -Math.PI / 2;
    j.rotation.z = -Math.atan2(dz, dx);
    j.position.set((a[0] + b[0]) / 2, SITE.driveway.y + 0.006, (a[1] + b[1]) / 2);
    j.receiveShadow = false;
    joints.add(j);
  }
  g.add(joints);

  /* ---- the mulch ring under the front tree ------------------------------
   * Measured as an ellipse ~13 ft across and ~8 ft deep, not a circle. */
  const tree = treeById('front-redbud');
  if (tree) {
    // CircleGeometry lives in local XY and three composes M = T*R*S, so the
    // ellipse has to be scaled in X and Y — scaling Z here squashed the ring
    // to 2 ft deep instead of 8.
    const ring = new THREE.Mesh(new THREE.CircleGeometry(1, 44), mulchM);
    ring.rotation.x = -Math.PI / 2;
    ring.scale.set(6.6, 4.2, 1);
    ring.position.set(tree.at[0], GRASS + 0.045, tree.at[1] + 0.6);
    ring.receiveShadow = true;
    applyUV(ring, undefined, { axes: 'xz', size: [13.2, 8.4] });
    g.add(ring);
    // the mulch is heaped an inch or two proud of the turf at its edge
    const lip = new THREE.Mesh(new THREE.TorusGeometry(1, 0.055, 6, 48), mulchM);
    lip.rotation.x = -Math.PI / 2;
    lip.scale.set(6.6, 4.2, 1);
    lip.position.set(tree.at[0], GRASS + 0.03, tree.at[1] + 0.6);
    lip.receiveShadow = true;
    g.add(lip);
  }

  /* ---- fieldstone boulders in the black mulch --------------------------- */
  const rockM = mat(ctx, 'boulder', { color: 0x8d8880, roughness: 0.95 });
  const rocks = [[6.2, 49.4, 0.85], [17.4, 50.2, 0.62], [24.6, 49.0, 0.7],
  [45.5, 49.4, 0.6], [56.0, 50.6, 0.75]];
  for (const [x, z, r] of rocks) {
    const b = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), rockM);
    b.scale.set(1.25, 0.62, 1.0);
    b.rotation.set(deg(frac(x) * 20), deg(frac(z) * 360), deg(frac(x * z) * 16));
    b.position.set(x, GRASS + r * 0.30, z);
    b.castShadow = true;
    b.receiveShadow = true;
    g.add(b);
  }

  /* ---- splash blocks under the front downspouts ------------------------- */
  for (const [x, z] of [[42.4, 48.6], [62.6, 48.0], [-2.1, 48.0]]) {
    const b = kit.box(1.1, 0.28, 1.9, concrete, { r: inch(1.2), seg: 2 });
    b.position.set(x, GRASS + 0.12, z);
    b.rotation.y = deg(frac(x) * 6 - 3);
    b.castShadow = false;
    g.add(b);
  }

  /* ---- public sidewalk slabs, subtly mismatched in tone ----------------- */
  const sw = SITE.street.sidewalk;
  for (let i = 0; i < 22; i++) {
    const x0 = -22 + i * 5.0;
    const s = kit.box(4.92, 0.34, sw.z1 - sw.z0 - 0.08, concrete, { r: inch(0.4), seg: 1, uv: true });
    s.position.set(x0 + 2.5, sw.y - 0.17 + (frac(i * 5.9) - 0.5) * 0.03,
      (sw.z0 + sw.z1) / 2);
    s.rotation.x = deg((frac(i * 3.3) - 0.5) * 0.6);
    s.receiveShadow = true;
    s.castShadow = false;
    g.add(s);
  }
}

/** Irregular-rectangular ashlar flagstone over a rectangle. */
function layFlagstone(ctx, parent, material, x0, z0, x1, z1, y, seed) {
  const { kit } = ctx;
  const J = inch(0.4);                    // sand joint
  const rows = [];
  let z = z0;
  let k = seed;
  while (z < z1 - 0.4) {
    const d = 1.5 + frac(k++ * 1.7) * 1.5;
    rows.push([z, Math.min(z1, z + d)]);
    z += d + J;
  }
  for (const [za, zb] of rows) {
    let x = x0;
    while (x < x1 - 0.4) {
      const w = 1.4 + frac(k++ * 2.3) * 1.9;
      const xb = Math.min(x1, x + w);
      const s = kit.box(xb - x - J, inch(1.5), zb - za - J, material,
        { r: inch(0.28), seg: 1 });
      // 22 ft per repeat lands each slab INSIDE one cell of the bluestone map,
      // with a per-slab offset for variety. At the map's own 6 ft scale every
      // slab carried a fragment of a baked cell outline and the walk read as
      // crazy paving laid on top of ashlar.
      applyUV(s, 22, { axes: 'xz', size: [xb - x, zb - za], offset: [frac(k * 1.9), frac(k * 4.7)] });
      s.position.set((x + xb) / 2, y, (za + zb) / 2);
      // a paver is never dead level or dead square
      s.rotation.y = deg((frac(k * 5.1) - 0.5) * 1.6);
      s.rotation.x = deg((frac(k * 8.9) - 0.5) * 1.1);
      s.castShadow = false;
      s.receiveShadow = true;
      parent.add(s);
      x = xb + J;
    }
  }
}

/** Sawn control joints on a ~10 ft grid across the driveway polygon. */
function driveJoints() {
  const out = [];
  for (let z = 54; z <= 104; z += 10) {
    const t = (z - 45) / 62;
    out.push([[40.0 + t * 8.0, z], [61.6 + t * 14.5, z]]);
  }
  out.push([[50.5, 45.4], [62.0, 106.0]]);
  return out;
}

/* ======================================================================== */
/* 2. Neighbours                                                             */
/* ======================================================================== */

function buildNeighbours(ctx, g) {
  const { THREE, kit } = ctx;
  const grp = new THREE.Group();
  grp.name = 'front:neighbours';

  for (const n of SITE.neighbours) {
    if (n.rearOnly || n.id === 'nbr-rear') continue;   // owned by exterior-rear
    const [x0, z0, x1, z1] = bbox(n.poly);
    const wallM = mat(ctx, `nbrWall:${n.id}`, { color: hex(n.color), roughness: 0.94 });
    const roofM = mat(ctx, `nbrRoof:${n.id}`, { color: hex(n.roofColor || '#5b5145'), roughness: 0.93 });

    const base = n.brickBase ? GRASS + n.brickBase : GRASS;
    if (n.brickBase) {
      const brickM = mat(ctx, 'nbrBrick', { color: 0x8a6558, roughness: 0.96 });
      const b = kit.box(x1 - x0, n.brickBase + 0.4, z1 - z0, brickM, { r: inch(1) });
      b.position.set((x0 + x1) / 2, GRASS + (n.brickBase - 0.4) / 2, (z0 + z1) / 2);
      grp.add(b);
    }
    const body = kit.box(x1 - x0, n.eaveY - base, z1 - z0, wallM, { r: inch(1.5) });
    body.position.set((x0 + x1) / 2, (base + n.eaveY) / 2, (z0 + z1) / 2);
    grp.add(body);

    // A gable whose ridge runs N-S, i.e. the gable END faces the street.
    const w = x1 - x0, d = z1 - z0;
    const rise = n.ridgeY - n.eaveY;
    const gable = gableRoof(THREE, w + 1.6, d + 1.4, rise, roofM, wallM);
    gable.position.set((x0 + x1) / 2, n.eaveY, (z0 + z1) / 2);
    grp.add(gable);

    if (n.chimney) {
      const c = kit.box(n.chimney.w, n.chimney.topY - GRASS, n.chimney.d, wallM, { r: inch(1.2) });
      c.position.set(n.chimney.at[0], (GRASS + n.chimney.topY) / 2, n.chimney.at[1]);
      grp.add(c);
      const cap = kit.box(n.chimney.w + 0.5, 0.28, n.chimney.d + 0.5, roofM, { r: inch(0.8) });
      cap.position.set(n.chimney.at[0], n.chimney.topY + 0.14, n.chimney.at[1]);
      grp.add(cap);
    }
  }
  g.add(grp);
}

/** Simple ridged roof, ridge along Z, with gable-end infill. */
function gableRoof(THREE, w, d, rise, roofM, wallM) {
  const grp = new THREE.Group();
  const slope = Math.hypot(w / 2, rise);
  const pitch = Math.atan2(rise, w / 2);
  for (const s of [-1, 1]) {
    // a horizontal plane (X across, Z along the ridge), then tilted about Z
    const q = new THREE.Mesh(new THREE.PlaneGeometry(slope, d), roofM);
    q.geometry.rotateX(-Math.PI / 2);
    q.rotation.z = -s * pitch;
    q.position.set(s * (w / 4), rise / 2, 0);
    q.castShadow = true;
    q.receiveShadow = true;
    grp.add(q);
  }
  for (const s of [-1, 1]) {
    const shape = new THREE.Shape();
    shape.moveTo(-w / 2, 0); shape.lineTo(w / 2, 0); shape.lineTo(0, rise); shape.closePath();
    const tri = new THREE.Mesh(new THREE.ShapeGeometry(shape), wallM);
    tri.position.set(0, 0, s * d / 2);
    tri.rotation.y = s > 0 ? 0 : Math.PI;
    tri.castShadow = true;
    tri.receiveShadow = true;
    grp.add(tri);
  }
  return grp;
}

/* ======================================================================== */
/* 3. PLANTING — the whole lot, memoised on the scene                        */
/* ======================================================================== */

/**
 * Trees, hedges and shrubs for the entire site. Both exterior pieces share one
 * scene, so this is built once and the second caller gets the same group back.
 * @returns {THREE.Group}
 */
export function buildSitePlanting(ctx) {
  const { THREE, kit } = ctx;
  const scene = ctx.scene;
  if (scene && scene.userData && scene.userData.__sitePlanting) {
    return scene.userData.__sitePlanting;
  }
  const g = new THREE.Group();
  g.name = 'site:planting';
  if (scene && scene.userData) scene.userData.__sitePlanting = g;

  // The rear framing maples photograph PALE — a smooth silver-green bark, not
  // the dark furrowed oak the raw map gives. One tint serves both yards.
  const bark = mat(ctx, 'bark', { color: 0xb6b3a4, roughness: 0.95 }, 'treeBark');
  const leaf = mat(ctx, 'leaf', null, 'foliageBroadleaf');
  const needle = mat(ctx, 'needle', null, 'foliageNeedle');
  const shrubLeaf = mat(ctx, 'shrubLeaf', null, 'foliageShrub');
  const shrubCore = mat(ctx, 'shrubCore', { color: 0x22320f, roughness: 0.99 });

  const draft = ctx.quality === 'draft' || ctx.quality === 'thumb';
  const K = draft ? 0.3 : 1.0;

  /* ---- trees ------------------------------------------------------------ */
  let n = 0;
  for (const t of SITE.trees) {
    // "near" = close enough to a camera station that individual leaves have to
    // resolve. Both the front hero tree AND the two trunks that frame
    // backyard_straight_on_view_of_house qualify — the rear pair stand 13 and
    // 20 ft off the lens and own the top third of that frame.
    const near = t.at[1] > 30 || t.id.indexOf('-frame-') !== -1;
    const bg = t.id.startsWith('bg-');
    if (t.species === 'pine') {
      g.add(kit.coniferTree({
        bark, leaf: needle,
        at: t.at, groundY: GRASS,
        height: t.crownTopY + GRASS,
        crownBase: t.crownBaseY + GRASS,
        spread: t.canopyR * 2,
        trunkR: t.trunkR,
        whorls: Math.round(11 * (draft ? 0.5 : 1)),
        cardsPer: Math.round(30 * K),
        card: 5.0,
        seed: 400 + n * 13,
        name: `tree:${t.id}`,
      }));
    } else {
      g.add(kit.deciduousTree({
        bark, leaf,
        at: t.at, groundY: GRASS,
        height: t.crownTopY + GRASS,
        crownBase: t.crownBaseY + GRASS,
        spread: t.canopyR * 2,
        trunkR: t.trunkR,
        // The front hero tree is a SINGLE-trunk katsura that forks at ~5'6"
        // into three limbs and opens into a flat umbrella. The rear framing
        // maple, by contrast, IS a multi-stem clump — five pale stems that
        // splay apart on the way up — so dims may declare `stems`.
        stems: t.stems || 1,
        lean: t.lean !== undefined ? t.lean : (t.species === 'redbud' ? 0.05 : 0.03),
        branches: near && !bg ? 7 : 4,
        subBranches: near && !bg ? 3 : 2,
        // The hero tree is 21 ft from the lens; it has to hold up at 6x zoom.
        // A redbud leaf is ~4", and a sheet is 150 leaves across 0.176 of its
        // own width, so a 2.0 ft card puts a leaf at 4.2" — right.
        // The background canopies close the sky behind the roof. At 26 clumps
        // a 40 ft crown reads as a handful of lollipops on sticks; it takes
        // ~70 to become the continuous leaf mass the photograph shows.
        clumps: Math.round((bg ? 78 : near ? 84 : 40) * (draft ? 0.35 : 1)),
        cardsPer: Math.round((bg ? 22 : 20) * K),
        card: bg ? 5.0 : near ? 2.0 : 3.0,
        seed: 100 + n * 29,
        name: `tree:${t.id}`,
      }));
    }
    n++;
  }

  /* ---- the clipped masses ----------------------------------------------
   * The big one right of the walk is one continuous privet blob ~9 ft wide
   * and 7.5 ft tall that swallows the left half of the garage door. It is
   * built as three overlapping lobes, because a single ellipsoid reads as a
   * balloon. */
  let h = 0;
  for (const hg of SITE.hedges) {
    const [x0, z0, x1, z1] = bbox(hg.poly);
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const rx = (x1 - x0) / 2, rz = (z1 - z0) / 2;
    // These are SHEARED, not natural: flat top, flat street face, softly
    // rounded corners. A clipped privet modelled as a sphere is the loudest
    // "CG garden" tell in a listing exterior, so the mass is a superellipsoid
    // (power 4.5) built from two or three overlapping lobes.
    const lobes = Math.max(2, Math.round((x1 - x0) / 4.5));
    for (let i = 0; i < lobes; i++) {
      const f = lobes === 1 ? 0.5 : i / (lobes - 1);
      const lr = rx / lobes * 1.5;
      g.add(kit.shrubMass({
        leaf: shrubLeaf, core: shrubCore,
        center: [
          x0 + lr * 0.85 + f * (x1 - x0 - lr * 1.7),
          GRASS + hg.h * (0.52 + 0.04 * frac(i * 3.1 + h)),
          cz + (frac(i * 5.7 + h) - 0.5) * rz * 0.35,
        ],
        radii: [lr, hg.h * 0.50 * (0.96 + 0.08 * frac(i * 7.3 + h)), rz * (0.92 + 0.16 * frac(i * 2.9))],
        card: 0.9,
        power: 4.5,
        jitter: 0.55,
        density: draft ? 0.7 : 2.6,
        lumps: 4,
        seed: 600 + i * 41 + h * 7,
        name: `hedge:${hg.id}:${i}`,
      }));
    }
    h++;
  }

  /* ---- the rounded boxwood balls along the facade ----------------------- */
  let s = 0;
  for (const sh of SITE.shrubs) {
    if (sh.at[1] < 30 && sh.at[1] > -40) { s++; continue; }   // rear-yard: skip here
    g.add(kit.shrubMass({
      leaf: shrubLeaf, core: shrubCore,
      center: [sh.at[0], GRASS + sh.r * 0.80, sh.at[1]],
      radii: [sh.r * 1.06, sh.r * 0.82, sh.r * 1.0],
      card: 0.8,
      density: draft ? 0.8 : 2.8,
      lumps: 5,
      seed: 800 + s * 23,
      name: `shrub:${s}`,
    }));
    s++;
  }

  /* ---- a low ragged skirt of ground cover where turf meets mulch -------- */
  const skirt = [];
  for (let i = 0; i < 34; i++) {
    const t = i / 34;
    const x = -7 + t * 33 + (frac(i * 3.7) - 0.5) * 1.4;
    const z = 52.0 + Math.sin(t * 5.1) * 1.6 + (frac(i * 9.1) - 0.5) * 1.2;
    skirt.push({ x, z, r: 0.55 + frac(i * 4.4) * 0.5 });
  }
  // This run used to be laid at x 33.5..43.5, z 51.5 — which is the middle of
  // the bluestone walk. Moved into the mulch EAST of the walk, where the
  // photographs actually show it (exterior_view_of_front_door bottom-right).
  for (let i = 0; i < 14; i++) {
    const t = i / 14;
    skirt.push({ x: 41.8 + t * 7.5 + (frac(i * 2.2) - 0.5), z: 50.0 + t * 9.0 + (frac(i * 6.1) - 0.5) * 1.6, r: 0.5 + frac(i * 8.8) * 0.45 });
  }
  if (!draft) {
    for (let i = 0; i < skirt.length; i++) {
      const p = skirt[i];
      g.add(kit.shrubMass({
        leaf: shrubLeaf, core: shrubCore,
        center: [p.x, GRASS + p.r * 0.55, p.z],
        radii: [p.r * 1.2, p.r * 0.62, p.r * 1.1],
        card: 0.55,
        density: 3.2,
        lumps: 4,
        seed: 1200 + i * 17,
        name: `groundcover:${i}`,
      }));
    }
  }

  return g;
}

/* ======================================================================== */
/* 4. Daylight                                                               */
/* ======================================================================== */

/**
 * The exterior sun and sky belong to lighting.js's `exterior` preset, which
 * main.js applies AFTER every room has built. A room that stands up its own
 * `sunRig` here gets a SECOND directional light and the whole frame renders
 * about an f-stop hot — that bug is why this function no longer makes one.
 *
 * What it does add is the bounce a sunlit lawn throws back up into the soffits
 * and the shaded west flank. PHOTOGRAPHY §3.2: the shadows in these photographs
 * are WARM (+3..+5 R−B) and open (exterior sun : sky = 5 : 1 linear), which a
 * blue sky-dome alone will never give you.
 */
export function applyExteriorDaylight(ctx) {
  const { THREE } = ctx;
  const scene = ctx.scene;
  if (!scene || (scene.userData && scene.userData.__extDaylight)) return;
  if (scene.userData) scene.userData.__extDaylight = true;

  const bounce = new THREE.HemisphereLight(0xe6e4dc, 0xc9b183, 0.50);
  bounce.name = 'exterior:groundBounce';
  bounce.position.set(30, 0, 45);
  scene.add(bounce);

  // A very soft warm fill from the sun's side keeps the shaded elevations off
  // black without touching the sunlit ones (they are already at the top of the
  // curve). This is the "bracketed exposure" term, not a second key.
  const fill = new THREE.DirectionalLight(0xffe9cf, 0.26);
  fill.name = 'exterior:warmFill';
  fill.position.set(120, 40, 150);
  fill.castShadow = false;
  scene.add(fill);
}

/* ======================================================================== */
/* helpers                                                                   */
/* ======================================================================== */

function frac(n) {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function hex(s) {
  return typeof s === 'string' ? parseInt(s.replace('#', ''), 16) : s;
}

function bbox(poly) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of poly) {
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  return [x0, z0, x1, z1];
}

function treeById(id) {
  return SITE.trees.find((t) => t.id === id) || null;
}

/**
 * A cached local material. `libName` pulls one out of ctx.mat (and clones it
 * only if `patch` asks for changes); otherwise a plain physical material.
 */
function mat(ctx, name, patch, libName) {
  ctx.__frontMats = ctx.__frontMats || new Map();
  if (ctx.__frontMats.has(name)) return ctx.__frontMats.get(name);
  let m;
  const lib = ctx.mat || {};
  const src = libName ? lib[libName] : lib[name];
  if (src && src.isMaterial) {
    m = patch ? src.clone() : src;
    if (patch) Object.assign(m, patch);
  } else {
    m = new ctx.THREE.MeshPhysicalMaterial(
      Object.assign({ roughness: 0.9, metalness: 0 }, patch || {})
    );
  }
  m.userData.keep = true;
  ctx.__frontMats.set(name, m);
  return m;
}

export default build;
