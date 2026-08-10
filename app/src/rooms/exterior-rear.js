/**
 * app/src/rooms/exterior-rear.js — the rear elevation and the back yard.
 *
 * Photos: backyard_straight_on_view_of_house.png (hero), backyard_1.png,
 *         backyard_mulch_grass_1.png, backyard_mulch_stone_steps.png
 *
 * The building envelope itself lives in core/massing.js and is shared with
 * `exterior-front` (both pieces sit on the same `exterior` scene, so the
 * massing builder memoises itself on the scene). This module owns everything
 * OUTSIDE the walls on the −Z side:
 *
 *   - the two-level composite deck: boards, rim joists, posts, lattice skirt,
 *     the single 10" step, the gray 2x4-cap railing on the lower platform, the
 *     black aluminium picket railing on the west edge, the built-in bench;
 *   - the irregular flagstone patio with sand/soil joints;
 *   - the raised stacked-limestone planter/seat wall and its terrace;
 *   - the river-rock cobble edging that outlines every mulch bed, the black
 *     mulch itself and the stepping stones;
 *   - the rear-yard planting: the two framing maples, the mugo pine at the
 *     deck edge, the hydrangea/viburnum masses;
 *   - the weathered board fence on the rear property line, the red-brick
 *     neighbour to the west and the service objects (septic cover, landscape
 *     junction box) the photographs actually show.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE HERO PHOTOGRAPH ACTUALLY IS — solved, not eyeballed
 * ---------------------------------------------------------------------------
 * `backyard_straight_on_view_of_house.png` is 1433 x 884, f = 707 px (fovV 64).
 *
 *   house west corner  X = 0        -> photo x 1122
 *   second-floor step  X = 26.925   -> photo x  699      => 15.85 px/ft
 *   8" siding courses  10.6 px                            => agrees
 *   deck top           Y = -0.50    -> photo row 564
 *   1st-floor glass head Y = 6.83   -> photo row 447
 *      => horizon on row 472 for a 5.3 ft hand-held eye, 30 px BELOW the frame
 *         centre; this PNG is cropped harder off the bottom than the top, so
 *         the preset carries shift +0.068 and stays perfectly level.
 *   camera            X 25.6, Z -44.6
 *
 * Everything below is placed by back-projecting the photograph through that
 * camera. The two trunks own the top third of the frame because they stand 13
 * and 20 ft from the lens — not because they are large.
 *
 * LIGHT. `lighting.js`'s `exterior` preset owns the one sun (azimuth 132,
 * elevation 56) and main.js stands it up AFTER the rooms build; a room that
 * adds its own gets a second sun and an f-stop of over-exposure. Note the
 * consequence for THIS view: the sun is behind and to the left of the camera,
 * so the rear wall is FRONT-LIT and the deck throws its shadow back at the
 * house, exactly as the photograph shows.
 */

import { buildMassing } from '../core/massing.js';
import { MASSING, SITE, LEVELS } from '../core/dims.js';
import { applyUV } from '../core/materials.js';
import { inch, ft, deg } from '../core/units.js';
import { buildSitePlanting, applyExteriorDaylight } from './exterior-front.js';

export const meta = {
  id: 'exterior-rear',
  title: 'Rear elevation / yard',
  level: 'exterior',
  photos: [
    'backyard_straight_on_view_of_house.png',
    'backyard_1.png',
    'backyard_mulch_grass_1.png',
    'backyard_mulch_stone_steps.png',
  ],
};

const GRASS = SITE.lot.grassY;          // -1.15
const GRADE = MASSING.grade.rear;       // -1.35

/* ======================================================================== */
/* build                                                                     */
/* ======================================================================== */

export function build(ctx) {
  const { THREE } = ctx;
  buildMassing(ctx);
  applyExteriorDaylight(ctx);

  const g = new THREE.Group();
  g.name = 'exterior-rear';
  ctx.group.add(g);

  buildMulchAndEdging(ctx, g);
  /* The DECK, the flagstone PATIO, the stacked-limestone PLANTER WALL and the
   * FIRE PIT belong to the `deck-patio` and `fire-pit` pieces (DETAILS.md §0),
   * which are registered and building them on this same scene. Building them
   * from here too put two decks in the same 6 inches of air, and tied this
   * module to a MASSING.deck schema that is being rewritten under it — when
   * `deck.lower` was folded into `deck.main` the exterior scene went black.
   * `buildPatio`, `buildPlanterTerrace` and `buildDeck` are kept below, unused,
   * as the fallback if those pieces are ever un-registered. */
  if (!hasPiece(ctx, 'deck-patio')) {
    buildPatio(ctx, g);
    buildDeck(ctx, g);
  }
  buildYardObjects(ctx, g);
  buildFenceAndNeighbours(ctx, g);
  buildRearPlanting(ctx, g);

  // the shared lot planting (front-yard trees, the background canopy)
  ctx.group.add(buildSitePlanting(ctx));
}

/* ======================================================================== */
/* 1. Mulch beds + river-rock cobble edging                                  */
/* ======================================================================== */

/**
 * The single most characteristic thing about this back yard is that EVERY bed
 * is outlined with one course of 4"-8" rounded river cobbles, and the black
 * mulch sits proud of the turf behind them. Get the cobble line right and the
 * whole ground plane reads; leave it out and the lawn is a green carpet.
 */
function buildMulchAndEdging(ctx, g) {
  const { THREE, kit } = ctx;
  const mulchM = mat(ctx, 'mulch', { color: 0x3a3129 }, 'mulchBed');

  /* ---- the beds ---------------------------------------------------------
   * Read straight off the hero and off backyard_mulch_grass_1: a broad bed
   * sweeping across the whole rear of the lot, its lawn edge a long lazy
   * curve, and a second bed hugging the west side. */
  // The lawn edge is SOLVED off the hero: the cobble course crosses photo row
  // ~690 at frame centre and row ~660 at x 1150, which back-projects to a lazy
  // curve running from (-16, -26) east to (55, -10). Everything between that
  // curve and the house/deck is black mulch — in the photograph it is by far
  // the largest single area of ground, and laying the bed only as a narrow
  // strip left the lawn running all the way up to the siding.
  const bedNorth = [
    [-16.0, -26.0], [0.0, -23.5], [14.0, -21.6], [26.0, -20.4],
    [38.0, -19.4], [48.0, -16.5], [55.0, -10.0],
    [55.0, -1.0], [31.6, -1.0], [31.6, -12.6], [-2.4, -12.6], [-2.4, -1.0],
    [-16.0, -1.0],
  ];
  const bedWest = [
    [-22.0, -30.0], [-14.0, -30.0], [-14.0, -2.0], [-22.0, -2.0],
  ];
  // The mulch has to sit ABOVE the turf plane (SITE.lot.grassY = -1.15), not
  // at rear grade (-1.35): laid low it was buried under the lawn and the whole
  // bed rendered as grass.
  for (const [poly, y] of [[bedNorth, GRASS + 0.035], [bedWest, GRASS + 0.02]]) {
    const m = polyMesh(THREE, poly, y, mulchM);
    applyUV(m, undefined, { axes: 'xz', size: [30, 30] });
    m.receiveShadow = true;
    g.add(m);
  }

  /* ---- the cobble course ------------------------------------------------
   * Laid along the lawn edge of bedNorth, one stone deep, sizes and spacing
   * jittered, a couple of them shoved out of line (DETAILS E). */
  const stoneM = mat(ctx, 'cobble', { color: 0xcfc6b4, roughness: 0.88 }, 'bluestone');
  const edge = bedNorth.slice(0, 7);        // the lawn-facing run only
  layCobbleRun(ctx, g, stoneM, edge, 5101);
  layCobbleRun(ctx, g, stoneM, [[-16.0, -26.0], [-16.5, -14.0], [-16.0, -4.0]], 5407);

  /* ---- ragged mulch lip where it spills over the stones ----------------- */
  for (let i = 0; i < 26; i++) {
    const t = i / 25;
    const p = alongPath(edge, t);
    const b = new THREE.Mesh(new THREE.CircleGeometry(0.5 + frac(i * 3.1) * 0.5, 8), mulchM);
    b.rotation.x = -Math.PI / 2;
    b.position.set(p[0] + (frac(i * 7.7) - 0.5) * 0.7, GRASS + 0.05,
      p[1] + 0.35 + (frac(i * 2.3) - 0.5) * 0.5);
    b.receiveShadow = true;
    g.add(b);
  }

  /* ---- exposed-aggregate stepping stones through the side-yard mulch ----- */
  const pav = mat(ctx, 'paver', { color: 0x9c968b, roughness: 0.94 }, 'concreteDriveway');
  // Back-projected: the pale exposed-aggregate squares sit around (47, -10),
  // in the mulch strip east of the deck, not in the west side yard.
  const path = [[44.5, -3.4], [45.6, -7.0], [46.4, -10.6], [47.6, -14.2],
    [49.4, -17.4], [-15.5, -8.0], [-14.6, -13.2], [-13.9, -18.4]];
  for (let i = 0; i < path.length; i++) {
    const s = kit.box(1.5, inch(2.2), 1.5, pav, { r: inch(0.4), seg: 1, uv: true });
    s.position.set(path[i][0], GRASS + 0.06, path[i][1]);
    s.rotation.y = deg((frac(i * 5.9) - 0.5) * 9);
    s.rotation.x = deg((frac(i * 3.3) - 0.5) * 1.6);
    s.receiveShadow = true;
    g.add(s);
  }
}

/** One dry-laid course of rounded river cobbles along a plan path. */
function layCobbleRun(ctx, g, material, path, seed) {
  const { THREE } = ctx;
  const total = pathLength(path);
  const n = Math.max(6, Math.round(total / 0.72));
  let k = seed;
  const geoCache = [];
  for (let i = 0; i < 5; i++) geoCache.push(new THREE.IcosahedronGeometry(1, 1));
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const p = alongPath(path, t);
    const r = 0.34 + frac(k++ * 1.7) * 0.20;
    const s = new THREE.Mesh(geoCache[i % 5], material);
    // a cobble is an oblate pebble, longest across the run
    s.scale.set(r * 1.30, r * 0.86, r * 1.05);
    s.rotation.set(deg(frac(k++ * 2.1) * 24 - 12), deg(frac(k++ * 4.3) * 360),
      deg(frac(k++ * 6.7) * 20 - 10));
    // a couple of them are shoved out of line
    const kick = frac(k++ * 8.9) > 0.9 ? (frac(k * 1.3) - 0.5) * 0.55 : 0;
    s.position.set(p[0] + kick, GRASS + r * 0.50, p[1] + kick * 0.6);
    s.castShadow = true;
    s.receiveShadow = true;
    g.add(s);
  }
}

/* ======================================================================== */
/* 2. Flagstone patio                                                        */
/* ======================================================================== */

function buildPatio(ctx, g) {
  const { THREE, kit } = ctx;
  const stone = mat(ctx, 'flagstone', { color: 0xb6b2a8, roughness: 0.9 }, 'bluestone');
  const grp = new THREE.Group();
  grp.name = 'rear:patio';
  g.add(grp);

  const P = MASSING.patio;
  const y = GRADE + 0.09;
  // Irregular flagstone: a Voronoi-ish jigsaw, NOT a running bond. Each slab
  // gets its own tilt and a 3/4"-1.5" sand/soil joint that grass creeps into.
  let k = 3301;
  const rows = [];
  let z = -25.0;
  while (z < -1.0) {
    const d = 2.0 + frac(k++ * 1.9) * 2.2;
    rows.push([z, Math.min(-1.0, z + d)]);
    z += d + inch(1.1);
  }
  for (const [za, zb] of rows) {
    let x = 11.0;
    while (x < 46.0) {
      const w = 1.9 + frac(k++ * 2.7) * 2.4;
      const xb = Math.min(46.0, x + w);
      const cx = (x + xb) / 2, cz = (za + zb) / 2;
      if (insidePoly(P.poly, cx, cz)) {
        const s = kit.box(xb - x - inch(1.1), inch(1.9), zb - za - inch(1.1), stone,
          { r: inch(0.5), seg: 1, uv: true });
        applyUV(s, 9, { axes: 'xz', size: [xb - x, zb - za], offset: [frac(k * 2.9), frac(k * 5.1)] });
        s.position.set(cx, y, cz);
        s.rotation.y = deg((frac(k * 5.1) - 0.5) * 3.4);
        s.rotation.x = deg((frac(k * 8.9) - 0.5) * 1.8);
        s.rotation.z = deg((frac(k * 3.7) - 0.5) * 1.6);
        s.receiveShadow = true;
        grp.add(s);
      }
      x = xb + inch(1.1);
    }
  }
  // the soil/sand the joints are packed with, one plate under the whole patio
  const bed = polyMesh(THREE, P.poly, GRADE + 0.02,
    mat(ctx, 'patioJoint', { color: 0x6a6055, roughness: 0.98 }));
  bed.receiveShadow = true;
  grp.add(bed);
}

/* ======================================================================== */
/* 3. Raised stacked-limestone planter wall + terrace                        */
/* ======================================================================== */

function buildPlanterTerrace(ctx, g) {
  const { THREE, kit } = ctx;
  const W = MASSING.planterWall;
  const lime = mat(ctx, 'limestone', null, 'stackedLimestone');
  const cap = mat(ctx, 'limestoneCap', { color: 0xbfb6a2, roughness: 0.9 }, 'bluestone');
  const grp = new THREE.Group();
  grp.name = 'rear:planterWall';
  g.add(grp);

  /* Dry-laid, so it is built course by course out of individual blocks with
   * 3"-4" bed heights and staggered joints. A swept box with a stone texture
   * reads as a retaining wall from a video game. */
  const courses = Math.max(3, Math.round((W.topY - W.baseY - W.capT) / W.courseH));
  const ch = (W.topY - W.baseY - W.capT) / courses;
  const total = pathLength(W.path);
  for (let c = 0; c < courses; c++) {
    const n = Math.max(6, Math.round(total / (1.05 + 0.25 * frac(c * 3.1))));
    for (let i = 0; i < n; i++) {
      const t0 = (i + (c % 2) * 0.5) / n;
      if (t0 >= 1) continue;
      const p = alongPath(W.path, t0 + 0.5 / n > 1 ? t0 : t0 + 0.5 / n);
      const q = alongPath(W.path, Math.min(0.999, t0 + 1 / n));
      const r = alongPath(W.path, Math.max(0.001, t0));
      const ang = Math.atan2(-(q[1] - r[1]), q[0] - r[0]);
      const bw = total / n * (0.86 + 0.22 * frac(c * 7.7 + i * 1.3));
      const bh = ch * (0.82 + 0.2 * frac(c * 2.9 + i * 5.1));
      const b = kit.box(bw, bh, W.thickness * (0.94 + 0.1 * frac(i * 4.4)), lime,
        { r: inch(0.22), seg: 1, uv: true });
      b.position.set(p[0], W.baseY + c * ch + bh / 2 + 0.02, p[1]);
      b.rotation.y = ang;
      b.rotation.z = deg((frac(c * 9.1 + i) - 0.5) * 1.4);
      b.castShadow = true;
      b.receiveShadow = true;
      grp.add(b);
    }
  }
  // flatter cap stones, slightly overhanging
  const nCap = Math.max(6, Math.round(total / 1.5));
  for (let i = 0; i < nCap; i++) {
    const t = (i + 0.5) / nCap;
    const p = alongPath(W.path, t);
    const q = alongPath(W.path, Math.min(0.999, t + 0.01));
    const r = alongPath(W.path, Math.max(0.001, t - 0.01));
    const c = kit.box(total / nCap * 0.96, W.capT, W.thickness + 2 * W.capOverhang, cap,
      { r: inch(0.3), seg: 1, uv: true });
    c.position.set(p[0], W.topY - W.capT / 2, p[1]);
    c.rotation.y = Math.atan2(-(q[1] - r[1]), q[0] - r[0]);
    c.rotation.z = deg((frac(i * 5.3) - 0.5) * 0.8);
    c.castShadow = true;
    c.receiveShadow = true;
    grp.add(c);
  }
  // the raised terrace the wall retains — flagstone over fill
  const inner = W.path.map(([x, z]) => [x - 1.4, z + 1.9]);
  const terrace = polyMesh(THREE, inner.concat([[41.0, -13.0], [22.0, -13.0]]), W.fillTopY,
    mat(ctx, 'terraceStone', { color: 0xb2ada2, roughness: 0.92 }, 'bluestone'));
  terrace.receiveShadow = true;
  grp.add(terrace);
}

/* ======================================================================== */
/* 4. The deck                                                               */
/* ======================================================================== */

function buildDeck(ctx, g) {
  const { THREE, kit } = ctx;
  const D = MASSING.deck;
  // MEASURED: the deck photographs WARM — 142/128/104, R > G > B — not the
  // cool grey the library material renders against a blue sky.
  const deckM = mat(ctx, 'deckBoard',
    { color: 0xd8c4a6, roughness: 0.82, envMapIntensity: 0.35 }, 'compositeDeck');
  const frameM = mat(ctx, 'deckFrame', { color: 0x6d675d, roughness: 0.93 });
  const railM = mat(ctx, 'deckRail', { color: 0x8b8880, roughness: 0.86 });
  const blackRail = mat(ctx, 'blackRail', {
    color: 0x24262a, roughness: 0.45, metalness: 0.55, envMapIntensity: 0.8,
  });
  const grp = new THREE.Group();
  grp.name = 'rear:deck';
  g.add(grp);

  /* MASSING.deck is SHARED with the `deck-patio` piece, which owns it and is
   * refining it in parallel — its schema has already changed once under us
   * (`deck.lower` came and went, `bench.segs` became a pair of polylines).
   * So read it defensively: every platform is optional, and the bench follows
   * whatever polylines dims declares rather than indices into a fixed poly. */
  const platforms = [
    { poly: D.main && D.main.poly, topY: D.main ? D.main.topY : -0.5, seed: 8801 },
    D.lower ? { poly: D.lower.poly, topY: D.lower.topY, seed: 9407 } : null,
  ].filter((p) => p && p.poly && p.poly.length > 2);

  for (const pf of platforms) {
    deckBoards(ctx, grp, deckM, bbox(pf.poly), pf.topY, pf.seed, pf.poly, D.treeCutout);
    deckSkirtAndFrame(ctx, grp, frameM, pf.poly, pf.topY);
    // lattice on every outward-facing edge (anything not against the house)
    for (let i = 0; i < pf.poly.length; i++) {
      const a = pf.poly[i], b = pf.poly[(i + 1) % pf.poly.length];
      if (a[1] > -0.5 && b[1] > -0.5) continue;      // the run along the wall
      latticePanel(ctx, grp, [a, b], pf.topY, railM);
    }
  }

  /* ---- the single 10" step down off the deck, bullnosed ----------------- */
  if (D.step && D.step.line) {
    const [sa, sb] = D.step.line;
    const slen = Math.hypot(sb[0] - sa[0], sb[1] - sa[1]) + 0.4;
    const tread = kit.box(slen, inch(1.25), D.step.treadW || 1.1, deckM,
      { r: inch(0.5), seg: 2, uv: true });
    tread.position.set((sa[0] + sb[0]) / 2, (D.main.topY) - inch(5.2), (sa[1] + sb[1]) / 2 - 0.5);
    tread.rotation.y = Math.atan2(-(sb[1] - sa[1]), sb[0] - sa[0]);
    tread.castShadow = true;
    tread.receiveShadow = true;
    grp.add(tread);
  }

  /* ---- black aluminium picket railing on the WEST end of the deck --------
   * A different system from the gray woodwork, and DETAILS insists both stay. */
  const mb = bbox(D.main.poly);
  pickets(ctx, grp, blackRail, [mb[0], mb[1] + 1.0], [mb[0], -0.4], D.main.topY);

  /* ---- built-in backless bench along the outer deck edge -----------------
   * MEASURED: there is NO railing on the lower platform. What reads as one in
   * the hero frame is a backless bench — a wide flat gray cap 17" above the
   * deck on plank legs, running the whole outer edge. A 36" railing there is
   * a full foot too tall and the single loudest error in the deck. */
  const benchSegs = [];
  const seatBase = (D.lower ? D.lower.topY : D.main.topY);
  for (const line of (D.bench && D.bench.segs) || []) {
    for (let i = 0; i < line.length - 1; i++) benchSegs.push([line[i], line[i + 1]]);
  }
  for (const seg of benchSegs) {
    const a = seg[0], b = seg[1];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.6) continue;
    const yaw = Math.atan2(-(b[1] - a[1]), b[0] - a[0]);
    const seatY = seatBase + inch(17);
    const seat = kit.box(len + 0.25, inch(1.5), D.bench.seatW, deckM,
      { r: inch(0.45), seg: 2, uv: true });
    seat.position.set((a[0] + b[0]) / 2, seatY, (a[1] + b[1]) / 2);
    seat.rotation.y = yaw;
    seat.castShadow = true;
    seat.receiveShadow = true;
    grp.add(seat);
    // a second, narrower board behind the cap — the bench is two boards wide
    const seat2 = kit.box(len + 0.25, inch(1.4), inch(5.5), deckM,
      { r: inch(0.35), seg: 2, uv: true });
    seat2.position.set((a[0] + b[0]) / 2 - Math.sin(yaw) * 0.0, seatY - inch(0.1),
      (a[1] + b[1]) / 2);
    seat2.rotation.y = yaw;
    seat2.position.x += Math.sin(yaw + Math.PI / 2) * 0.0;
    grp.add(seat2);
    const nLeg = Math.max(2, Math.round(len / 3.4));
    for (let i = 0; i < nLeg; i++) {
      const t = (i + 0.5) / nLeg;
      const leg = kit.box(inch(1.5), Math.max(0.4, seatY - seatBase), inch(10), railM,
        { r: inch(0.1), seg: 1, uv: true });
      leg.position.set(a[0] + (b[0] - a[0]) * t,
        (seatY + seatBase) / 2 - inch(0.7),
        a[1] + (b[1] - a[1]) * t);
      leg.rotation.y = yaw;
      leg.rotation.z = deg((frac(i * 3.7) - 0.5) * 2.2);
      leg.castShadow = true;
      grp.add(leg);
    }
  }
}

/**
 * Composite boards running E-W (parallel to the house wall), 5-1/2" faces with
 * a 1/4" gap, each one very slightly cupped and out of tone. Screws come in
 * pairs at every joist line.
 */
function deckBoards(ctx, grp, material, box, topY, seed, clipPoly, cutout) {
  const { THREE, kit } = ctx;
  const [x0, z0, x1, z1] = box;
  const bw = MASSING.deck.boardW;
  const gap = MASSING.deck.boardGap;
  const pitch = bw + gap;
  const n = Math.max(1, Math.floor((z1 - z0) / pitch));
  let k = seed;
  const screwM = mat(ctx, 'deckScrew', { color: 0x6e6357, roughness: 0.55, metalness: 0.35 });
  for (let i = 0; i < n; i++) {
    const cz = z1 - (i + 0.5) * pitch;
    if (clipPoly && !insidePoly(clipPoly, (x0 + x1) / 2, cz)) {
      // clip to the polygon by walking the row
      let x = x0;
      while (x < x1) {
        const step = 1.0;
        if (insidePoly(clipPoly, x + step / 2, cz)) {
          let xe = x;
          while (xe < x1 && insidePoly(clipPoly, xe + step / 2, cz)) xe += step;
          addBoard(x, xe);
          x = xe;
        }
        x += step;
      }
      continue;
    }
    addBoard(x0, x1);

    function addBoard(ax, bx) {
      if (bx - ax < 0.3) return;
      // the deck is cut out around a mature trunk (DETAILS: must-build detail)
      if (cutout && cutout.center && Math.abs(cz - cutout.center[1]) < cutout.r) {
        const half = Math.sqrt(Math.max(0, cutout.r * cutout.r
          - (cz - cutout.center[1]) * (cz - cutout.center[1])));
        const cx0 = cutout.center[0] - half, cx1 = cutout.center[0] + half;
        if (ax < cx1 && bx > cx0) {
          addBoardRaw(ax, Math.min(bx, cx0));
          addBoardRaw(Math.max(ax, cx1), bx);
          return;
        }
      }
      addBoardRaw(ax, bx);
    }

    function addBoardRaw(ax, bx) {
      if (bx - ax < 0.3) return;
      const b = kit.box(bx - ax, inch(1.25), bw, material, { r: inch(0.09), seg: 2, uv: true });
      applyUV(b, undefined, { axes: 'xy', size: [bx - ax, bw] });
      b.position.set((ax + bx) / 2, topY - inch(0.62), cz);
      // faded / cupped: a hair of roll and a hair of tone variation
      b.rotation.z = deg((frac(k++ * 3.1) - 0.5) * 0.28);
      b.castShadow = true;
      b.receiveShadow = true;
      grp.add(b);
    }
  }
  // screw pairs at 16" joist centres
  for (let jx = x0 + 0.8; jx < x1; jx += ft(1, 4)) {
    for (let i = 0; i < n; i += 1) {
      const cz = z1 - (i + 0.5) * pitch;
      if (clipPoly && !insidePoly(clipPoly, jx, cz)) continue;
      if (frac(jx * 3.3 + i * 1.7) > 0.55) continue;      // not every one resolves
      for (const dz of [-inch(1.3), inch(1.3)]) {
        const s = new THREE.Mesh(new THREE.CircleGeometry(inch(0.16), 6), screwM);
        s.rotation.x = -Math.PI / 2;
        s.position.set(jx, topY + 0.004, cz + dz);
        grp.add(s);
      }
    }
  }
}

/** Rim joists, posts and the dark cavity under a deck platform. */
function deckSkirtAndFrame(ctx, grp, material, poly, topY, sides) {
  const { THREE, kit } = ctx;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.4) continue;
    const rim = kit.box(len, inch(9.25), inch(1.6), material, { r: inch(0.05), uv: true });
    rim.position.set((a[0] + b[0]) / 2, topY - inch(1.25) - inch(4.6), (a[1] + b[1]) / 2);
    rim.rotation.y = Math.atan2(-(b[1] - a[1]), b[0] - a[0]);
    rim.castShadow = true;
    rim.receiveShadow = true;
    grp.add(rim);
  }
  // the shadowed void under the platform, so nothing shows daylight through
  const under = polyMesh(THREE, poly, topY - inch(11),
    mat(ctx, 'deckVoid', { color: 0x241f19, roughness: 1.0 }));
  under.rotation.x = Math.PI / 2;
  grp.add(under);
  // 4x4 posts on concrete pads
  const [x0, z0, x1, z1] = bbox(poly);
  for (let x = x0 + 2.4; x < x1 - 1.0; x += 6.2) {
    for (const z of [z0 + 0.8, (z0 + z1) / 2]) {
      if (!insidePoly(poly, x, z)) continue;
      const ph = topY - inch(11) - GRADE;
      if (ph < 0.15) continue;                 // the deck is barely off grade here
      const p = kit.box(inch(4.6), ph, inch(4.6), material, { r: inch(0.08), seg: 1 });
      p.position.set(x, (topY - inch(11) + GRADE) / 2, z);
      p.castShadow = true;
      grp.add(p);
    }
  }
}

/** Gray diagonal lattice in a 1x frame, filling from grade to the rim joist. */
function latticePanel(ctx, grp, seg, topY, material, clipX) {
  const { THREE, kit } = ctx;
  let [a, b] = seg;
  if (clipX) { a = [clipX[0], a[1]]; b = [clipX[1], b[1]]; }
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < 0.5) return;
  // The deck platforms sit only 10-20" above rear grade, so `topY - rim - GRADE`
  // came out NEGATIVE and no lattice was built at all — the skirt that the
  // photograph shows as a clear 10" band of gray diagonal lath simply did not
  // exist. Hang the panel off the underside of the rim joist instead and let
  // its bottom edge run into the mulch, which is what actually happens.
  const yTop = topY - inch(10.5);
  const h = Math.max(0.62, yTop - GRADE);
  const yaw = Math.atan2(-(b[1] - a[1]), b[0] - a[0]);
  const holder = new THREE.Group();
  holder.position.set((a[0] + b[0]) / 2, yTop - h / 2, (a[1] + b[1]) / 2);
  holder.rotation.y = yaw;
  grp.add(holder);
  // dark backer so the lath reads against a shadow, not against the lawn
  const back = kit.box(len, h, inch(0.6),
    mat(ctx, 'latticeBack', { color: 0x1e1a16, roughness: 1.0 }), { r: inch(0.03) });
  back.position.z = -inch(0.9);
  holder.add(back);
  const diag = Math.hypot(len, h);
  for (const s of [1, -1]) {
    for (let d = -diag; d <= diag; d += 0.42) {
      const lath = kit.box(diag * 1.05, inch(1.0), inch(0.5), material, { r: inch(0.04) });
      lath.rotation.z = s * Math.PI / 4;
      lath.position.set(d * Math.SQRT1_2 * s, d * Math.SQRT1_2, s > 0 ? 0 : -inch(0.45));
      lath.castShadow = false;
      holder.add(lath);
    }
  }
  // clip the lath field with a frame
  for (const [w, hh, dx, dy] of [[len, inch(3.2), 0, h / 2 - inch(1.6)],
    [len, inch(3.2), 0, -h / 2 + inch(1.6)],
    [inch(3.2), h, -len / 2 + inch(1.6), 0],
    [inch(3.2), h, len / 2 - inch(1.6), 0]]) {
    const f = kit.box(w, hh, inch(1.5), material, { r: inch(0.06), uv: true });
    f.position.set(dx, dy, inch(0.5));
    holder.add(f);
  }
}

/** Gray wood railing: 2x4 cap, thin square balusters, 4x4 posts. */
function grayRail(ctx, grp, material, a, b, deckY) {
  const { kit } = ctx;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < 0.5) return;
  const yaw = Math.atan2(-(b[1] - a[1]), b[0] - a[0]);
  const H = ft(3, 0);
  const holder = ctx.THREE ? new ctx.THREE.Group() : null;
  holder.position.set((a[0] + b[0]) / 2, deckY, (a[1] + b[1]) / 2);
  holder.rotation.y = yaw;
  grp.add(holder);

  const cap = kit.box(len, inch(1.6), inch(3.6), material, { r: inch(0.14), seg: 2, uv: true });
  cap.position.y = H - inch(0.8);
  cap.castShadow = true;
  holder.add(cap);
  const under = kit.box(len, inch(3.2), inch(1.6), material, { r: inch(0.08), uv: true });
  under.position.y = H - inch(3.2);
  holder.add(under);
  const bot = kit.box(len, inch(1.4), inch(1.6), material, { r: inch(0.06) });
  bot.position.y = inch(3.6);
  holder.add(bot);
  const n = Math.max(2, Math.round(len / inch(5.0)));
  for (let i = 0; i < n; i++) {
    const bal = kit.box(inch(1.4), H - inch(8), inch(1.4), material, { r: inch(0.05) });
    bal.position.set(-len / 2 + (len * (i + 0.5)) / n, inch(4.4) + (H - inch(8)) / 2, 0);
    bal.rotation.y = deg((frac(i * 2.7) - 0.5) * 1.2);
    holder.add(bal);
  }
  for (const s of [-1, 1]) {
    const p = kit.box(inch(3.6), H + inch(2), inch(3.6), material, { r: inch(0.09), seg: 2, uv: true });
    p.position.set(s * (len / 2 - inch(1.8)), (H + inch(2)) / 2 - inch(1), 0);
    p.castShadow = true;
    holder.add(p);
  }
}

/** Black aluminium picket railing — a different system, kept different. */
function pickets(ctx, grp, material, a, b, deckY) {
  const { kit } = ctx;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < 0.5) return;
  const holder = new ctx.THREE.Group();
  holder.position.set((a[0] + b[0]) / 2, deckY, (a[1] + b[1]) / 2);
  holder.rotation.y = Math.atan2(-(b[1] - a[1]), b[0] - a[0]);
  grp.add(holder);
  const H = ft(3, 0);
  for (const [y, h, d] of [[H - inch(0.9), inch(1.8), inch(2.0)], [inch(3.2), inch(1.5), inch(1.6)]]) {
    const r = kit.box(len, h, d, material, { r: inch(0.08), seg: 2 });
    r.position.y = y;
    holder.add(r);
  }
  const n = Math.max(3, Math.round(len / inch(4.2)));
  for (let i = 0; i < n; i++) {
    const p = kit.box(inch(0.75), H - inch(4.4), inch(0.75), material, { r: inch(0.04) });
    p.position.set(-len / 2 + (len * (i + 0.5)) / n, inch(3.8) + (H - inch(4.4)) / 2, 0);
    holder.add(p);
  }
  for (const s of [-1, 1]) {
    const p = kit.box(inch(2.2), H + inch(1.6), inch(2.2), material, { r: inch(0.06), seg: 2 });
    p.position.set(s * (len / 2 - inch(1.1)), (H + inch(1.6)) / 2 - inch(0.8), 0);
    p.castShadow = true;
    holder.add(p);
  }
}

/* ======================================================================== */
/* 5. Yard objects the photographs actually show                             */
/* ======================================================================== */

function buildYardObjects(ctx, g) {
  const { THREE, kit } = ctx;
  const metal = mat(ctx, 'yardMetal', { color: 0x3b3d3f, roughness: 0.5, metalness: 0.6 });
  const conc = mat(ctx, 'yardConcrete', { color: 0x9a958c, roughness: 0.95 }, 'concreteDriveway');

  /* ---- round concrete cleanout/septic cover, flush in the lawn ----------- */
  const lid = kit.cyl(1.05, 1.05, inch(3.5), conc, 30, { uv: true });
  lid.position.set(6.0, GRASS - 0.03, -34.0);
  lid.rotation.y = deg(11);
  lid.receiveShadow = true;
  g.add(lid);
  const lidPlate = kit.cyl(0.78, 0.78, inch(1.0), metal, 26);
  lidPlate.position.set(6.0, GRASS + 0.07, -34.0);
  g.add(lidPlate);

  /* ---- landscape junction box on a wooden stake in the bed --------------- */
  const stake = kit.box(inch(3.2), 3.4, inch(3.2),
    mat(ctx, 'stake', { color: 0xa08a5c, roughness: 0.95 }), { r: inch(0.1), uv: true });
  stake.position.set(-2.5, GRADE + 1.6, -30.5);
  stake.rotation.y = deg(6);
  stake.castShadow = true;
  g.add(stake);
  const jbox = kit.box(inch(5), inch(6.5), inch(3),
    mat(ctx, 'jbox', { color: 0x1a1c1d, roughness: 0.6 }), { r: inch(0.25), seg: 2 });
  jbox.position.set(-2.5, GRADE + 2.9, -30.68);
  g.add(jbox);
  // the loose cable hanging off it
  const cable = kit.cyl(inch(0.28), inch(0.28), 2.0,
    mat(ctx, 'cable', { color: 0x101112, roughness: 0.8 }), 8);
  cable.position.set(-2.35, GRADE + 1.8, -30.7);
  cable.rotation.z = deg(9);
  g.add(cable);

  /* ---- hose bib + a coil of black poly at the wall ---------------------- */
  const bib = kit.cyl(inch(0.55), inch(0.55), inch(6), metal, 10);
  bib.rotation.x = Math.PI / 2;
  bib.position.set(33.0, 1.4, -inch(3));
  g.add(bib);

  /* ---- crawl-space access door low on the siding ------------------------ */
  const hatch = kit.box(2.2, 1.6, inch(1.2),
    mat(ctx, 'hatch', { color: 0x3f423e, roughness: 0.85 }), { r: inch(0.1), seg: 2 });
  hatch.position.set(30.4, -0.45, -inch(1.0));
  g.add(hatch);
}

/* ======================================================================== */
/* 6. Fence + the neighbours only this view sees                             */
/* ======================================================================== */

function buildFenceAndNeighbours(ctx, g) {
  const { THREE, kit } = ctx;
  const grp = new THREE.Group();
  grp.name = 'rear:fenceAndNeighbours';
  g.add(grp);

  /* ---- weathered board fence on the rear + west property lines ----------- */
  const board = mat(ctx, 'fenceBoard', { color: 0x9a8f7d, roughness: 0.96 }, 'grayLapSiding');
  const F = SITE.fence;
  const runs = [];
  for (let i = 0; i < F.path.length - 1; i++) runs.push([F.path[i], F.path[i + 1]]);
  runs.push([[-8.0, -6.0], [-8.0, -30.0]]);            // the near west line
  for (const [a, b] of runs) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const yaw = Math.atan2(-(b[1] - a[1]), b[0] - a[0]);
    const holder = new THREE.Group();
    holder.position.set((a[0] + b[0]) / 2, GRASS, (a[1] + b[1]) / 2);
    holder.rotation.y = yaw;
    grp.add(holder);
    const nB = Math.max(4, Math.round(len / 0.52));
    for (let i = 0; i < nB; i++) {
      const bd = kit.box(0.47, F.h - 0.1 - frac(i * 3.7) * 0.12, inch(0.85), board,
        { r: inch(0.05), uv: true });
      bd.position.set(-len / 2 + (len * (i + 0.5)) / nB, (F.h - 0.1) / 2, 0);
      bd.rotation.z = deg((frac(i * 5.9) - 0.5) * 0.7);
      bd.castShadow = true;
      bd.receiveShadow = true;
      holder.add(bd);
    }
    for (let i = 0; i <= Math.round(len / 7); i++) {
      const p = kit.box(inch(3.6), F.h + 0.4, inch(3.6), board, { r: inch(0.08), uv: true });
      p.position.set(-len / 2 + (len * i) / Math.max(1, Math.round(len / 7)), (F.h + 0.4) / 2, -inch(1.4));
      holder.add(p);
    }
  }

  /* ---- the red-brick neighbour that fills the right edge ----------------- */
  for (const n of SITE.neighbours) {
    if (!n.rearOnly) continue;
    const [x0, z0, x1, z1] = bbox(n.poly);
    const brick = mat(ctx, `nbrBrick:${n.id}`, { color: hex(n.color), roughness: 0.95 });
    const gableM = mat(ctx, `nbrGable:${n.id}`, { color: 0xbfb49c, roughness: 0.94 });
    const roofM = mat(ctx, `nbrRoof:${n.id}`, { color: hex(n.roofColor), roughness: 0.93 });
    const body = kit.box(x1 - x0, n.eaveY - GRASS, z1 - z0, brick, { r: inch(1.2), uv: true });
    body.position.set((x0 + x1) / 2, (GRASS + n.eaveY) / 2, (z0 + z1) / 2);
    body.castShadow = true;
    body.receiveShadow = true;
    grp.add(body);
    const rise = n.ridgeY - n.eaveY;
    const w = x1 - x0, d = z1 - z0;
    for (const s of [-1, 1]) {
      const q = new THREE.Mesh(new THREE.PlaneGeometry(Math.hypot(d / 2, rise) + 0.8, w + 1.4), roofM);
      q.geometry.rotateX(-Math.PI / 2);
      q.rotation.y = Math.PI / 2;
      q.rotation.x = s * Math.atan2(rise, d / 2);
      q.position.set((x0 + x1) / 2, n.eaveY + rise / 2, (z0 + z1) / 2 + s * d / 4);
      q.castShadow = true;
      grp.add(q);
    }
    for (const s of [-1, 1]) {
      const shape = new THREE.Shape();
      shape.moveTo(-d / 2, 0); shape.lineTo(d / 2, 0); shape.lineTo(0, rise); shape.closePath();
      const tri = new THREE.Mesh(new THREE.ShapeGeometry(shape), gableM);
      tri.position.set((x0 + x1) / 2 + s * w / 2, n.eaveY, (z0 + z1) / 2);
      tri.rotation.y = s > 0 ? Math.PI / 2 : -Math.PI / 2;
      grp.add(tri);
    }
    // a couple of white-framed windows so it is not a blank brick slab
    const white = mat(ctx, 'nbrWhite', { color: 0xe8e6e0, roughness: 0.6 });
    const glassM = mat(ctx, 'nbrGlass', { color: 0x2c3338, roughness: 0.2, metalness: 0.2 });
    for (const [wx, wy] of [[-6.5, 3.4], [-1.0, 3.4], [-6.5, 9.6], [-1.0, 9.6]]) {
      const fr = kit.box(2.6, 4.0, inch(2.5), white, { r: inch(0.15), seg: 2 });
      fr.position.set((x0 + x1) / 2 + wx, GRASS + wy, z0 - inch(1));
      grp.add(fr);
      const gl = kit.box(2.1, 3.5, inch(1.2), glassM, { r: inch(0.1) });
      gl.position.set((x0 + x1) / 2 + wx, GRASS + wy, z0 - inch(2.2));
      grp.add(gl);
    }
  }
}

/* ======================================================================== */
/* 7. Rear-yard planting                                                     */
/* ======================================================================== */

function buildRearPlanting(ctx, g) {
  const { kit } = ctx;
  const draft = ctx.quality === 'draft' || ctx.quality === 'thumb';
  const bark = mat(ctx, 'bark', null, 'treeBark');
  const shrubLeaf = mat(ctx, 'shrubLeaf', null, 'foliageShrub');
  const needle = mat(ctx, 'needle', null, 'foliageNeedle');
  const shrubCore = mat(ctx, 'shrubCore', { color: 0x23320f, roughness: 0.99 });

  /* ---- the mugo/white pine at the deck edge ------------------------------
   * It is the one plant that overlaps the house in the hero frame — a low,
   * open, silvery-green candelabra, NOT a cone. Built as four irregular
   * needle lobes on a short crooked stem. */
  const pineAt = [27.6, -13.6];
  const trunk = kit.cyl(inch(2.4), inch(3.6), 2.2, bark, 10);
  trunk.position.set(pineAt[0], GRADE + 1.1, pineAt[1]);
  trunk.rotation.z = deg(7);
  trunk.castShadow = true;
  g.add(trunk);
  const lobes = [
    [0.0, 3.2, 0.0, 2.1], [-1.3, 2.7, 0.5, 1.6], [1.2, 2.9, -0.4, 1.7],
    [0.3, 4.0, 0.6, 1.4], [-0.6, 3.6, -0.7, 1.3],
  ];
  for (let i = 0; i < lobes.length; i++) {
    const [dx, dy, dz, r] = lobes[i];
    g.add(kit.shrubMass({
      leaf: needle, core: shrubCore,
      center: [pineAt[0] + dx, GRADE + dy, pineAt[1] + dz],
      radii: [r * 1.18, r * 0.72, r * 1.05],
      card: 0.8, power: 2.1, jitter: 0.7,
      density: draft ? 0.9 : 3.0, lumps: 5,
      seed: 2100 + i * 37,
      name: `rear:mugo:${i}`,
    }));
  }

  /* ---- hydrangea / viburnum masses along the beds ----------------------- */
  const shrubs = [
    [46.5, -11.0, 2.5], [50.5, -17.5, 2.1], [44.0, -21.0, 1.9],
    [-11.0, -8.0, 2.3], [-12.0, -15.0, 2.6], [-11.5, -22.0, 2.2],
    [37.0, -27.0, 1.7], [24.0, -28.4, 1.5], [12.0, -29.6, 1.6],
  ];
  for (let i = 0; i < shrubs.length; i++) {
    const [x, z, r] = shrubs[i];
    g.add(kit.shrubMass({
      leaf: shrubLeaf, core: shrubCore,
      center: [x, GRADE + r * 0.82, z],
      radii: [r * 1.15, r * 0.86, r * 1.05],
      card: 0.85, jitter: 0.55,
      density: draft ? 0.8 : 2.7, lumps: 5,
      seed: 2400 + i * 29,
      name: `rear:shrub:${i}`,
    }));
  }
}

/* ======================================================================== */
/* helpers                                                                   */
/* ======================================================================== */

/** Is another registered piece already building this? */
function hasPiece(ctx, id) {
  try {
    const reg = ctx.registry || (typeof window !== 'undefined' && window.__APP__ && null);
    if (reg && reg.LOADERS) return !!reg.LOADERS[id];
  } catch { /* fall through */ }
  // No registry handle in ctx: fall back to the scene — deck-patio names its
  // group `room:deck-patio` and main.js creates it before any room builds.
  const scene = ctx.scene;
  if (!scene) return false;
  let found = false;
  scene.traverse((o) => { if (o.name === `room:${id}`) found = true; });
  return found;
}

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

function insidePoly(poly, x, z) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function pathLength(path) {
  let L = 0;
  for (let i = 0; i < path.length - 1; i++) {
    L += Math.hypot(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]);
  }
  return L;
}

/** Point at fraction t (0..1) of a polyline's arc length. */
function alongPath(path, t) {
  const L = pathLength(path);
  let want = Math.max(0, Math.min(1, t)) * L;
  for (let i = 0; i < path.length - 1; i++) {
    const seg = Math.hypot(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]);
    if (want <= seg || i === path.length - 2) {
      const f = seg > 1e-6 ? want / seg : 0;
      return [path[i][0] + (path[i + 1][0] - path[i][0]) * f,
        path[i][1] + (path[i + 1][1] - path[i][1]) * f];
    }
    want -= seg;
  }
  return path[path.length - 1];
}

/** A horizontal plan polygon as a mesh at height y, facing up. */
function polyMesh(THREE, poly, y, material) {
  const shape = new THREE.Shape();
  poly.forEach(([x, z], i) => (i ? shape.lineTo(x, -z) : shape.moveTo(x, -z)));
  shape.closePath();
  const m = new THREE.Mesh(new THREE.ShapeGeometry(shape), material);
  m.rotation.x = -Math.PI / 2;
  m.position.y = y;
  m.receiveShadow = true;
  return m;
}

/**
 * A cached local material. `libName` pulls one out of ctx.mat (cloning only if
 * `patch` asks for changes); otherwise a plain physical material.
 */
function mat(ctx, name, patch, libName) {
  ctx.__rearMats = ctx.__rearMats || new Map();
  if (ctx.__rearMats.has(name)) return ctx.__rearMats.get(name);
  let m;
  const lib = ctx.mat || {};
  const src = libName ? lib[libName] : lib[name];
  if (src && src.isMaterial) {
    m = patch ? src.clone() : src;
    if (patch) {
      Object.assign(m, patch);
      if (patch.color !== undefined) m.color = new ctx.THREE.Color(patch.color);
    }
  } else {
    m = new ctx.THREE.MeshPhysicalMaterial(
      Object.assign({ roughness: 0.9, metalness: 0 }, patch || {})
    );
  }
  m.userData.keep = true;
  ctx.__rearMats.set(name, m);
  return m;
}

export default build;
