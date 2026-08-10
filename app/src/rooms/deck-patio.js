/**
 * app/src/rooms/deck-patio.js — the rear deck and the flagstone patio.
 *
 * Photos: backyard_patio_1.png (hero), backyard_patio_2.png,
 *         and the deck edge as seen in backyard_fire_pit_2.png and
 *         view_from_breakfast_nook_looking_out_at_backyard_patio.png.
 *
 * ---------------------------------------------------------------------------
 * WHAT backyard_patio_1 ACTUALLY IS  (solved, not eyeballed — see dims.js
 * MASSING.deck for the full derivation)
 * ---------------------------------------------------------------------------
 *   horizon                     row 507 of 1022  -> shift 0, camera dead level
 *   board vanishing point       u = 1542         -> the camera looks 45.8 deg
 *                                                   EAST OF NORTH, because the
 *                                                   boards run E-W (confirmed
 *                                                   on the deck surface in
 *                                                   backyard_straight_on)
 *   board pitch 5-3/4" + bench leg 17-1/2"
 *                            -> h = 4.55 ft above the deck, f = 838 px
 *                               (fovV 62.7 deg, ~19 mm equivalent)
 *   cross-checks             railing post 5.6" (a 5-1/2" sleeve), river
 *                            cobbles 8", deck edge 13.5-17.9 ft out
 *
 * So the camera stands 1.7 ft off the rear glass wall at X = -5.7, looking
 * north-east across a ~39 x 19 ft deck at the flagstone, the fire pit, the
 * planter wall and the lawn.
 *
 * ---------------------------------------------------------------------------
 * THE THINGS THAT DECIDE THIS FRAME
 * ---------------------------------------------------------------------------
 * 1. VALUE. The deck is in the HOUSE'S OWN SHADOW (sun az 132, alt 56 puts the
 *    shadow line ~17 ft north of a 25 ft wall) and reads 168-180 sRGB — a light
 *    warm grey, not the dark grey it looks like at thumbnail size. The
 *    flagstone beyond it is in sun at 185-218 and is BUFF, not blue. Getting
 *    those two values and that one shadow line right is 80% of the frame.
 * 2. The deck is not a plane. 5-1/2" boards, 1/4" gaps you see into, eased
 *    arrises, a per-board cup and tone, board ENDS landing on a faceted
 *    outline, and a notch cut round a 2'-8" maple.
 * 3. The benches. Backless, two seat boards, plank legs whose feet land exactly
 *    ON the deck edge — which is why the photograph appears to cut them off.
 * 4. Nothing is staged. No table, no chairs, no grill, no cushions, no pots.
 *    The only "objects" in this frame are the lit fire pit and leaf litter.
 */

import { MASSING, SITE } from '../core/dims.js';
import { applyUV } from '../core/materials.js';
import { inch, ft, deg } from '../core/units.js';

export const meta = {
  id: 'deck-patio',
  title: 'Deck & patio',
  level: 'exterior',
  photos: ['backyard_patio_1.png', 'backyard_patio_2.png'],
};

const DECK = MASSING.deck;
const PATIO = MASSING.patio;
const WALL = MASSING.planterWall;
const PIT = MASSING.firePit;
const GRASS = SITE.lot.grassY;          // -1.15
const DECK_Y = DECK.main.topY;          // -0.50
const PATIO_Y = PATIO.topY;             // -1.02

/* ======================================================================== */
/* build                                                                     */
/* ======================================================================== */

export function build(ctx) {
  const { THREE } = ctx;
  const g = new THREE.Group();
  g.name = 'deck-patio';
  ctx.group.add(g);

  hideShellProxies(ctx);

  buildPatio(ctx, g);
  buildPlanter(ctx, g);
  buildFirePit(ctx, g);
  buildDeck(ctx, g);
  buildBeds(ctx, g);
  buildPlanting(ctx, g);
  buildBackdrop(ctx, g);
}

/**
 * shell.js lays flat ShapeGeometry proxies for the deck, the lower platform
 * and the patio straight off the dims polygons. They are useful before this
 * module exists and z-fight with it afterwards, so the real thing turns them
 * off — the same contract as ctx.shell.hideFloor() indoors.
 */
function hideShellProxies(ctx) {
  const root = ctx.scene || ctx.group;
  if (!root) return;
  const kill = new Set(['site:deck-main', 'site:deck-lower', 'site:patio']);
  root.traverse((o) => { if (kill.has(o.name)) o.visible = false; });
}

/* ======================================================================== */
/* 1. THE DECK                                                               */
/* ======================================================================== */

function buildDeck(ctx, parent) {
  const { THREE, kit } = ctx;
  const g = new THREE.Group();
  g.name = 'deck';
  parent.add(g);

  const deckM = mat(ctx, 'deckBoard', null, 'compositeDeck');
  const frameM = mat(ctx, 'deckFrame', { color: 0x6d6963, roughness: 0.93 });
  const poly = DECK.main.poly;

  /* ---- boards ----------------------------------------------------------
   * 5-1/2" faces at 1/4" gaps running E-W, laid one at a time over the real
   * outline so a board END lands on the faceted edge and on the tree notch. */
  g.add(kit.deckBoards({
    poly,
    y: DECK_Y,
    material: deckM,
    dir: DECK.boardDir === 'ns' ? 'ns' : 'ew',
    boardW: DECK.boardW,
    gap: DECK.boardGap,
    thickness: inch(1.0),
    cup: 0.006,
    seed: 4471,
    phase: 0.12,
  }));

  /* ---- rim / fascia + the framing you can see under the edge ------------ */
  g.add(kit.deckFascia({
    poly, y: DECK_Y, drop: inch(7.0), thickness: inch(0.95), material: deckM,
  }));
  // joist ends and a beam line, visible only where the ground falls away
  const rim = kit.deckFascia({
    poly, y: DECK_Y - inch(7.0), drop: inch(3.2), thickness: inch(0.8), material: frameM,
  });
  rim.name = 'deck:rimShadow';
  g.add(rim);

  /* ---- the step down to the flagstone ---------------------------------- */
  const st = DECK.step;
  if (st) {
    const a = st.line[0], b = st.line[1];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const L = Math.hypot(dx, dz);
    const tread = kit.box(L + 0.5, inch(1.1), st.treadW + 0.5, deckM, { r: inch(0.16), seg: 2 });
    tread.position.set((a[0] + b[0]) / 2, DECK_Y - st.riserH / 2, (a[1] + b[1]) / 2);
    tread.rotation.y = -Math.atan2(dz, dx);
    tread.translateZ(st.treadW * 0.55);
    applyUV(tread, undefined, { axes: 'xz', size: [L, st.treadW] });
    g.add(tread);
    const riser = kit.box(L + 0.5, st.riserH, inch(0.9), deckM, { r: inch(0.07) });
    riser.position.set((a[0] + b[0]) / 2, DECK_Y - st.riserH / 2 - inch(0.3), (a[1] + b[1]) / 2);
    riser.rotation.y = -Math.atan2(dz, dx);
    riser.translateZ(st.treadW * 1.05);
    g.add(riser);
  }

  /* ---- railings --------------------------------------------------------
   * Two different systems, both real: a grey composite guard with 5-1/2" post
   * sleeves at the east edge (the one in the hero frame, right of the pine),
   * and the black aluminium picket run at the west edge. */
  for (const r of DECK.main.railing || []) {
    const [a, b] = [r.path[0], r.path[1]];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const rail = r.system === 'blackAluminumPicket'
      ? kit.deckRailing({ length: L, height: r.h, material: mat(ctx, 'alumRail', { color: 0x24262a, roughness: 0.42, metalness: 0.45 }) })
      : compositeRailing(ctx, L, r.h, deckM);
    rail.position.set(a[0], DECK_Y, a[1]);
    rail.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]);
    g.add(rail);
  }

  /* ---- the built-in benches -------------------------------------------- */
  let bi = 0;
  for (const seg of DECK.bench.segs) {
    g.add(kit.deckBench({
      path: seg,
      seatY: DECK.bench.seatY,
      deckY: DECK_Y,
      material: deckM,
      screwMaterial: mat(ctx, 'benchScrew', { color: 0x6a6157, roughness: 0.55, metalness: 0.5 }),
      seed: 331 + bi * 97,
      name: `deck:bench:${bi}`,
    }));
    bi++;
  }

  /* ---- leaf litter in the board joints ----------------------------------
   * DETAILS §deck-patio E. A handful of dry maple keys and leaf fragments,
   * caught in the gaps. They are 3-6 px each in the hero frame and they are
   * the only thing on this deck — which is exactly the point. */
  const litterM = mat(ctx, 'litter', { color: 0x9a7f52, roughness: 0.95 });
  const litter = new THREE.Group();
  litter.name = 'deck:litter';
  for (let i = 0; i < 34; i++) {
    const x = -14 + frac(i * 3.13) * 32;
    const z = -1 - frac(i * 7.71) * 17;
    if (!kit.pointInPoly(poly, x, z)) continue;
    const w = 0.08 + frac(i * 5.3) * 0.13;
    const q = new THREE.Mesh(new THREE.PlaneGeometry(w, w * (0.6 + frac(i * 2.2) * 0.7)), litterM);
    q.rotation.x = -Math.PI / 2;
    q.rotation.z = frac(i * 9.7) * Math.PI * 2;
    q.position.set(x, DECK_Y + 0.004, z);
    q.receiveShadow = true;
    litter.add(q);
  }
  g.add(litter);

  /* ---- the tree notch: mulch collar at patio level ---------------------- */
  const cut = DECK.treeCutout;
  const collar = new THREE.Mesh(new THREE.CircleGeometry(cut.mulchR, 26),
    mat(ctx, 'mulch', null, 'mulchBed'));
  collar.rotation.x = -Math.PI / 2;
  collar.position.set(cut.center[0], PATIO_Y + 0.06, cut.center[1]);
  collar.receiveShadow = true;
  applyUV(collar, undefined, { axes: 'xz', size: [cut.mulchR * 2, cut.mulchR * 2] });
  g.add(collar);
}

/** Grey composite guard: 5-1/2" post sleeves, square balusters, flat cap. */
function compositeRailing(ctx, L, H, material) {
  const { THREE, kit } = ctx;
  const g = new THREE.Group();
  g.name = 'deck:compositeRail';
  const post = inch(5.5);
  const top = kit.box(L, inch(1.6), inch(3.5), material, { r: inch(0.1), seg: 2 });
  top.position.set(L / 2, H - inch(0.8), 0);
  g.add(top);
  const sub = kit.box(L, inch(1.4), inch(2.2), material, { r: inch(0.08) });
  sub.position.set(L / 2, H - inch(2.6), 0);
  g.add(sub);
  const bot = kit.box(L, inch(1.4), inch(2.2), material, { r: inch(0.08) });
  bot.position.set(L / 2, inch(3.6), 0);
  g.add(bot);
  const n = Math.max(2, Math.round(L / inch(5.2)));
  for (let i = 0; i < n; i++) {
    const b = kit.box(inch(1.45), H - inch(6.4), inch(1.45), material, { r: inch(0.05) });
    b.position.set((L * (i + 0.5)) / n, inch(4.3) + (H - inch(6.4)) / 2, 0);
    g.add(b);
  }
  for (const x of [0, L]) {
    const p = kit.box(post, H + inch(1.0), post, material, { r: inch(0.09), seg: 2 });
    p.position.set(x, (H + inch(1.0)) / 2 - inch(1.5), 0);
    g.add(p);
    // a real post cap with a shadow line under it
    const collar = kit.box(post + inch(0.5), inch(0.7), post + inch(0.5), material, { r: inch(0.08) });
    collar.position.set(x, H - inch(0.2), 0);
    g.add(collar);
    const cap = kit.box(post + inch(0.9), inch(1.1), post + inch(0.9), material, { r: inch(0.14), seg: 2 });
    cap.position.set(x, H + inch(0.9), 0);
    g.add(cap);
  }
  return g;
}

/* ======================================================================== */
/* 2. THE FLAGSTONE PATIO                                                    */
/* ======================================================================== */

function buildPatio(ctx, parent) {
  const { THREE, kit } = ctx;
  const g = new THREE.Group();
  g.name = 'patio';
  parent.add(g);

  const stone = mat(ctx, 'flag', null, 'flagstoneBuff');
  const deckPoly = DECK.main.poly;

  const paving = kit.crazyPaving({
    poly: PATIO.poly,
    y: PATIO_Y,
    material: stone,
    cell: 2.5,
    joint: 0.075,
    thickness: 0.17,
    settle: 0.007,
    seed: 20811,
    // Slabs that would end up under the deck are wasted geometry.
    skip: (x, z) => kit.pointInPoly(deckPoly, x, z),
    name: 'patio:flags',
  });
  // ExtrudeGeometry UVs are already in FEET, so one texture tile must cover
  // scaleFeet (7 ft) of UV: repeat = size/feetPerRepeat = 1/7.
  applyUV(paving, undefined, { axes: 'xz', size: [1, 1] });
  g.add(paving);

  // A dirt / stone-dust bed under the joints so the gaps never show grass or
  // sky through them.
  const bed = new THREE.Mesh(planShape(THREE, PATIO.poly),
    mat(ctx, 'patioBed', { color: 0x7a7266, roughness: 0.98 }));
  bed.rotation.x = -Math.PI / 2;
  bed.position.y = PATIO_Y - 0.10;
  bed.receiveShadow = true;
  g.add(bed);

  /* ---- turf creeping into the perimeter joints -------------------------
   * DETAILS §deck-patio C: "sand/soil joints, grass at the perimeter". */
  const tuftM = mat(ctx, 'tuft', null, 'foliageShrub');
  const tufts = new THREE.Group();
  tufts.name = 'patio:tufts';
  for (let i = 0; i < 46; i++) {
    const t = i / 46;
    const p = pointOnPath(PATIO.poly, t, true);
    const jx = (frac(i * 4.7) - 0.5) * 0.8;
    const jz = (frac(i * 8.1) - 0.5) * 0.8;
    if (kit.pointInPoly(deckPoly, p[0] + jx, p[1] + jz)) continue;
    tufts.add(kit.shrubMass({
      leaf: tuftM,
      core: mat(ctx, 'tuftCore', { color: 0x3f5223, roughness: 0.99 }),
      center: [p[0] + jx, PATIO_Y + 0.06, p[1] + jz],
      radii: [0.34 + frac(i * 2.9) * 0.22, 0.11, 0.30 + frac(i * 6.1) * 0.2],
      card: 0.30,
      density: 2.0,
      lumps: 3,
      seed: 3300 + i * 13,
    }));
  }
  g.add(tufts);
}

/* ======================================================================== */
/* 3. THE RAISED STACKED-LIMESTONE PLANTER                                   */
/* ======================================================================== */

function buildPlanter(ctx, parent) {
  const { THREE, kit } = ctx;
  const g = new THREE.Group();
  g.name = 'planterWall';
  parent.add(g);

  const stoneM = mat(ctx, 'ledge', null, 'stackedLimestone');
  const capM = mat(ctx, 'ledgeCap', { color: 0xf4efe3, roughness: 0.84 }, 'stackedLimestone');
  const mulchM = mat(ctx, 'mulch', null, 'mulchBed');

  const h = WALL.topY - WALL.baseY;
  const t = WALL.thickness;

  /* The wall is laid as real courses, not a swept box: a dry-stack ledgestone
   * wall's whole character is that every course is a different height and
   * every stone a different length, and the top course is out of level. */
  const courses = Math.max(3, Math.round(h / WALL.courseH));
  const path = WALL.path;
  let y = WALL.baseY;
  for (let c = 0; c < courses; c++) {
    const ch = (h - inch(2.5)) / courses * (0.86 + frac(c * 3.7) * 0.28);
    const prof = [
      [-t / 2 - (frac(c * 5.1) - 0.5) * inch(1.4), y],
      [t / 2 + (frac(c * 2.3) - 0.5) * inch(1.4), y],
      [t / 2 + (frac(c * 9.1) - 0.5) * inch(1.4), y + ch],
      [-t / 2 - (frac(c * 7.3) - 0.5) * inch(1.4), y + ch],
    ].map(([n, yy]) => [n, yy - WALL.baseY]);
    const m = kit.sweptMesh(path, prof, stoneM, {});
    m.position.y = WALL.baseY;
    m.castShadow = true; m.receiveShadow = true;
    g.add(m);
    y += ch;
  }
  // cap course, slightly over-sailing, with chipped ends
  const capProf = [
    [-t / 2 - WALL.capOverhang, y - WALL.baseY],
    [t / 2 + WALL.capOverhang, y - WALL.baseY],
    [t / 2 + WALL.capOverhang, y - WALL.baseY + WALL.capT],
    [-t / 2 - WALL.capOverhang, y - WALL.baseY + WALL.capT],
  ];
  const cap = kit.sweptMesh(path, capProf, capM, {});
  cap.position.y = WALL.baseY;
  cap.castShadow = true; cap.receiveShadow = true;
  g.add(cap);

  /* ---- the raised mulch bed the wall retains --------------------------- */
  const bedPoly = offsetPathToBed(path, 6.0);
  const fill = new THREE.Mesh(planShape(THREE, bedPoly), mulchM);
  fill.rotation.x = -Math.PI / 2;
  fill.position.y = WALL.fillTopY;
  fill.receiveShadow = true;
  applyUV(fill, undefined, { axes: 'xz', size: [24, 14] });
  g.add(fill);
  // the soil face on the far side, so the raised bed is not a floating plane
  g.add(skirtMesh(ctx, bedPoly, WALL.fillTopY, GRASS - 0.02, mulchM, path.length));
}

/**
 * The bed the planter wall retains: the wall centreline, then back along a
 * copy of it pushed `depth` feet NORTH (-Z) and spread a little at the ends,
 * so the raised bed reads as a lens of mulch behind the stone rather than a
 * rectangle stuck on the back of it.
 */
function offsetPathToBed(path, depth) {
  const out = path.slice();
  for (let i = path.length - 1; i >= 0; i--) {
    const t = path.length > 1 ? i / (path.length - 1) : 0.5;
    const bow = 0.55 + 0.45 * Math.sin(t * Math.PI);
    out.push([path[i][0] + (t - 0.5) * depth * 0.35, path[i][1] - depth * bow]);
  }
  return out;
}

/** Vertical soil face around all but the first `skipFirst` edges of a bed. */
function skirtMesh(ctx, poly, yTop, yBot, material, skipFirst) {
  const { THREE } = ctx;
  const g = new THREE.Group();
  g.name = 'bed:skirt';
  for (let i = 0; i < poly.length; i++) {
    if (i < (skipFirst || 0) - 1) continue;
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const L = Math.hypot(dx, dz);
    if (L < 0.1) continue;
    const q = new THREE.Mesh(new THREE.PlaneGeometry(L, yTop - yBot), material);
    q.position.set((a[0] + b[0]) / 2, (yTop + yBot) / 2, (a[1] + b[1]) / 2);
    q.rotation.y = -Math.atan2(dz, dx) + Math.PI / 2;
    q.receiveShadow = true;
    applyUV(q, undefined, { axes: 'xy', size: [L, yTop - yBot] });
    g.add(q);
  }
  return g;
}

/* ======================================================================== */
/* 4. FIRE PIT — lit, as it is in every frame it appears in                  */
/* ======================================================================== */

function buildFirePit(ctx, parent) {
  const { THREE, kit } = ctx;
  const scene = ctx.scene;
  if (scene && scene.userData) {
    if (scene.userData.__firePitBuilt) return;   // `fire-pit` may own it later
    scene.userData.__firePitBuilt = true;
  }
  const g = new THREE.Group();
  g.name = 'firePit';
  g.position.set(PIT.center[0], PIT.baseY, PIT.center[1]);
  parent.add(g);

  const stoneM = mat(ctx, 'ledge', null, 'stackedLimestone');
  const black = mat(ctx, 'pitSteel', { color: 0x1d1e20, roughness: 0.55, metalness: 0.55 });

  g.add(kit.stoneFirePitRing({ d: PIT.bowlOuterR * 2, h: PIT.bowlH, material: stoneM }));
  // steel ring and the soot line
  const ring = kit.cyl(PIT.bowlInnerR, PIT.bowlInnerR, inch(5), black, 32, { open: true });
  ring.position.y = PIT.bowlH - inch(2);
  g.add(ring);

  /* ---- the dome spark screen -------------------------------------------
   * Four bent ribs and a lifting handle, in dark steel. It is 60 px across in
   * the hero frame — small, but a black dome against a bright terrace is one
   * of the few high-contrast shapes in the left third. */
  const screen = new THREE.Group();
  screen.name = 'firePit:screen';
  const R = PIT.screen.r;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI;
    const pts = [];
    for (let k = 0; k <= 12; k++) {
      const th = (k / 12) * Math.PI;
      pts.push(new THREE.Vector3(Math.cos(th) * R * Math.cos(a), Math.sin(th) * PIT.screen.h,
        Math.cos(th) * R * Math.sin(a)));
    }
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, inch(0.22), 6, false), black);
    tube.castShadow = true;
    screen.add(tube);
  }
  for (const [rr, yy] of [[R * 0.99, 0.02], [R * 0.72, PIT.screen.h * 0.62]]) {
    const hoop = kit.torus(rr, inch(0.2), black, 32, 6);
    hoop.rotation.x = Math.PI / 2;
    hoop.position.y = yy;
    screen.add(hoop);
  }
  const handle = kit.torus(inch(2.6), inch(0.2), black, 20, 6);
  handle.position.y = PIT.screen.h + inch(2.0);
  screen.add(handle);
  screen.position.y = PIT.bowlH;
  g.add(screen);

  /* ---- the flame -------------------------------------------------------- */
  const flameM = new THREE.MeshBasicMaterial({
    map: kit.flameAlpha(), transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, color: 0xffb44a, opacity: 0.95,
  });
  flameM.userData.keep = false;
  for (let i = 0; i < 5; i++) {
    const w = 1.1 + frac(i * 3.3) * 0.7;
    const q = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 1.35), flameM);
    q.position.set((frac(i * 7.1) - 0.5) * 0.5, PIT.bowlH - inch(2) + w * 0.5,
      (frac(i * 5.9) - 0.5) * 0.5);
    q.rotation.y = (i / 5) * Math.PI;
    q.renderOrder = 4;
    g.add(q);
  }
  const fire = new THREE.PointLight(0xff7a24, 3.2, 14, 2);
  fire.position.y = PIT.bowlH + 0.3;
  fire.castShadow = false;
  g.add(fire);
}

/* ======================================================================== */
/* 5. MULCH BEDS, COBBLE EDGING, THE LAWN THAT SHOWS BETWEEN THEM            */
/* ======================================================================== */

function buildBeds(ctx, parent) {
  const { THREE, kit } = ctx;
  const g = new THREE.Group();
  g.name = 'beds';
  parent.add(g);

  const mulchM = mat(ctx, 'mulch', null, 'mulchBed');
  const cobbleM = mat(ctx, 'cobble', { color: 0x9a9086, roughness: 0.88 }, 'concreteDriveway');

  /* The big rear bed: it runs right across the middle distance of the hero
   * frame, holds every mature trunk, and is edged in one course of cobbles.
   * Its lawn-side line was traced off the photograph. */
  const rear = MASSING.riverRockEdge.paths[0];
  const rearBed = rear.concat([[52.0, -52.0], [-18.0, -50.0]]);
  layBed(ctx, g, rearBed, GRASS + 0.03, mulchM, [24, 24]);

  // the bed east of the deck, hard against the flagstone
  const east = MASSING.riverRockEdge.paths[1];
  const eastBed = east.concat([[34.0, -2.0], [33.0, -21.0]]);
  layBed(ctx, g, eastBed, GRASS + 0.03, mulchM, [16, 16]);

  for (const p of MASSING.riverRockEdge.paths) {
    g.add(kit.cobbleEdge({
      path: p, y: GRASS - 0.02, r: MASSING.riverRockEdge.stoneR,
      material: cobbleM, seed: 611 + p.length * 31,
    }));
  }
}

function layBed(ctx, g, poly, y, material, size) {
  const { THREE } = ctx;
  const m = new THREE.Mesh(planShape(THREE, poly), material);
  m.rotation.x = -Math.PI / 2;
  m.position.y = y;
  m.receiveShadow = true;
  m.castShadow = false;
  applyUV(m, undefined, { axes: 'xz', size });
  g.add(m);
  return m;
}

/* ======================================================================== */
/* 6. PLANTING — the trees that own the top two-thirds of the frame          */
/* ======================================================================== */

/**
 * The lot's trees live in SITE.trees and are built once by
 * `exterior-front.buildSitePlanting`. These are the rear-yard specimens that
 * only this frame proves the existence of, so this module owns them:
 *
 *   - the five-stem maple clump east of the deck. Its pale stems fill the
 *     right third of backyard_patio_1 and its trunk measures 2'-8" at 40 ft.
 *   - a small flowering tree and a willow in the middle distance
 *   - the spreading mugo pine at the east rail
 *   - viburnum / hydrangea masses along the rear bed
 */
function buildPlanting(ctx, parent) {
  const { THREE, kit } = ctx;
  const g = new THREE.Group();
  g.name = 'deck:planting';
  parent.add(g);

  const draft = ctx.quality === 'draft' || ctx.quality === 'thumb';
  const K = draft ? 0.35 : 1;
  const bark = mat(ctx, 'bark', null, 'treeBark');
  const leaf = mat(ctx, 'leaf', null, 'foliageBroadleaf');
  const needle = mat(ctx, 'needle', null, 'foliageNeedle');
  const shrubLeaf = mat(ctx, 'shrubLeaf', null, 'foliageShrub');
  const shrubCore = mat(ctx, 'shrubCore', { color: 0x22320f, roughness: 0.99 });

  const trees = [
    { id: 'clump-e', at: [33.0, -17.0], stems: 5, trunkR: 0.62, base: 15.0, top: 46.0,
      spread: 30.0, card: 2.4, clumps: 74, seed: 51, near: true },
    { id: 'maple-nw', at: [-9.0, -41.0], stems: 3, trunkR: 0.8, base: 13.0, top: 44.0,
      spread: 30.0, card: 3.2, clumps: 60, seed: 77 },
    { id: 'small-c', at: [14.0, -42.0], stems: 3, trunkR: 0.30, base: 7.0, top: 20.0,
      spread: 14.0, card: 1.9, clumps: 40, seed: 93 },
    { id: 'willow-ne', at: [34.0, -46.0], stems: 1, trunkR: 0.55, base: 9.0, top: 32.0,
      spread: 24.0, card: 3.0, clumps: 48, seed: 131 },
    { id: 'bg-ne', at: [58.0, -44.0], stems: 3, trunkR: 0.8, base: 12.0, top: 46.0,
      spread: 30.0, card: 4.2, clumps: 44, seed: 149 },
    { id: 'bg-n', at: [6.0, -66.0], stems: 2, trunkR: 0.8, base: 12.0, top: 48.0,
      spread: 32.0, card: 4.6, clumps: 40, seed: 167 },
  ];
  for (const t of trees) {
    g.add(kit.deciduousTree({
      bark, leaf,
      at: t.at, groundY: GRASS,
      height: t.top + GRASS,
      crownBase: t.base + GRASS,
      spread: t.spread,
      trunkR: t.trunkR,
      stems: t.stems,
      lean: 0.055,
      branches: t.near ? 7 : 5,
      subBranches: t.near ? 3 : 2,
      clumps: Math.round(t.clumps * (draft ? 0.35 : 1)),
      cardsPer: Math.round((t.near ? 22 : 20) * K),
      card: t.card,
      seed: t.seed,
      name: `tree:${t.id}`,
    }));
  }

  /* ---- the spreading pine at the east rail ------------------------------
   * Wide and low, not a cone: it is a mugo/white pine that has been let go,
   * and in the hero frame its branches lie almost horizontally behind the
   * grey railing. */
  g.add(kit.shrubMass({
    leaf: needle, core: shrubCore,
    center: [28.6, GRASS + 2.4, -9.0],
    radii: [5.2, 2.5, 4.2],
    card: 1.5, density: draft ? 0.7 : 2.2, lumps: 6, flatten: 0.30, seed: 771,
    name: 'shrub:pine-e',
  }));
  g.add(kit.shrubMass({
    leaf: needle, core: shrubCore,
    center: [30.4, GRASS + 1.5, -13.5],
    radii: [3.4, 1.6, 3.0],
    card: 1.3, density: draft ? 0.7 : 2.2, lumps: 5, flatten: 0.35, seed: 913,
    name: 'shrub:pine-e2',
  }));

  /* ---- viburnum / hydrangea masses in the rear bed ---------------------- */
  const shrubs = [
    [-13.0, -36.0, 2.6], [-4.0, -34.5, 2.2], [7.0, -33.5, 2.0], [16.5, -31.5, 2.4],
    [24.0, -28.0, 2.1], [30.0, -25.0, 2.6], [39.0, -23.0, 2.3], [45.0, -24.0, 2.0],
    [27.5, -20.0, 1.5], [22.0, -23.5, 1.4],
  ];
  let si = 0;
  for (const [x, z, r] of shrubs) {
    g.add(kit.shrubMass({
      leaf: shrubLeaf, core: shrubCore,
      center: [x, GRASS + r * 0.78, z],
      radii: [r * 1.15, r * 0.80, r * 1.0],
      card: 0.8, density: draft ? 0.8 : 2.6, lumps: 5, seed: 1500 + si * 29,
      name: `shrub:rear:${si}`,
    }));
    si++;
  }
}

/* ======================================================================== */
/* 7. BACKDROP — the fence, the neighbour's shed, the far lawn               */
/* ======================================================================== */

function buildBackdrop(ctx, parent) {
  const { THREE, kit } = ctx;
  const g = new THREE.Group();
  g.name = 'deck:backdrop';
  parent.add(g);

  const cedar = mat(ctx, 'cedarWeathered', { color: 0x8d8271, roughness: 0.95 }, 'grayLapSiding');

  /* ---- weathered board fence at the far west ---------------------------- */
  const fenceA = [[-24.0, -47.0], [2.0, -47.6]];
  buildPicketFence(ctx, g, fenceA, 6.0, cedar, 4801);
  buildPicketFence(ctx, g, [[16.0, -52.0], [44.0, -52.6]], 5.6, cedar, 5501);

  /* ---- the neighbour's gable shed -------------------------------------- */
  const shedM = mat(ctx, 'shedWall', { color: 0xc9bda6, roughness: 0.95 });
  const roofM = mat(ctx, 'shedRoof', { color: 0x5d6060, roughness: 0.92 });
  const shed = new THREE.Group();
  shed.name = 'backdrop:shed';
  const body = kit.box(9.0, 7.4, 8.0, shedM, { r: inch(1.2) });
  body.position.set(0, 3.7, 0);
  shed.add(body);
  for (const s of [-1, 1]) {
    const q = new THREE.Mesh(new THREE.PlaneGeometry(Math.hypot(4.9, 2.6), 8.6), roofM);
    q.geometry.rotateX(-Math.PI / 2);
    q.rotation.z = -s * Math.atan2(2.6, 4.9);
    q.position.set(s * 2.45, 7.4 + 1.3, 0);
    q.castShadow = true; q.receiveShadow = true;
    shed.add(q);
  }
  const door = kit.box(3.4, 5.6, 0.18, mat(ctx, 'shedDoor', { color: 0xe8e4da, roughness: 0.8 }),
    { r: inch(0.4) });
  door.position.set(-0.4, 2.9, 4.05);
  shed.add(door);
  shed.position.set(46.0, GRASS, -37.0);
  shed.rotation.y = deg(-14);
  g.add(shed);
}

function buildPicketFence(ctx, g, path, h, material, seed) {
  const { THREE, kit } = ctx;
  const a = path[0], b = path[1];
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const L = Math.hypot(dx, dz);
  const yaw = -Math.atan2(dz, dx);
  const grp = new THREE.Group();
  grp.name = 'backdrop:fence';
  const n = Math.round(L / 0.52);
  for (let i = 0; i < n; i++) {
    const hh = h * (0.96 + frac(i * 3.1 + seed) * 0.06);
    const p = kit.box(0.42, hh, 0.09, material, { r: inch(0.05) });
    p.position.set(0.26 + i * (L / n), hh / 2, 0);
    p.rotation.z = deg((frac(i * 7.7 + seed) - 0.5) * 1.2);
    p.castShadow = true; p.receiveShadow = true;
    grp.add(p);
  }
  for (const y of [h * 0.30, h * 0.78]) {
    const r = kit.box(L, 0.30, 0.10, material, { r: inch(0.05) });
    r.position.set(L / 2, y, -0.10);
    grp.add(r);
  }
  grp.position.set(a[0], GRASS, a[1]);
  grp.rotation.y = yaw;
  g.add(grp);
  return grp;
}

/* ======================================================================== */
/* helpers                                                                   */
/* ======================================================================== */

/**
 * Plan polygon -> ShapeGeometry, same convention as shell.js: the shape is
 * built with y = -z so that a subsequent `rotation.x = -PI/2` lands it in plan
 * coordinates with its normal UP and its winding intact. (Flipping with
 * scale(1,-1,1) instead reverses the winding and the top face gets culled.)
 */
function planShape(THREE, poly) {
  const s = new THREE.Shape();
  poly.forEach(([x, z], i) => (i ? s.lineTo(x, -z) : s.moveTo(x, -z)));
  s.closePath();
  return new THREE.ShapeGeometry(s);
}

/** Point at parameter t (0..1) along a closed plan path. */
function pointOnPath(poly, t, closed) {
  const n = closed ? poly.length : poly.length - 1;
  const segs = [];
  let total = 0;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    segs.push([a, b, L]);
    total += L;
  }
  let d = t * total;
  for (const [a, b, L] of segs) {
    if (d <= L) {
      const k = L ? d / L : 0;
      return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
    }
    d -= L;
  }
  return poly[0];
}

function frac(n) {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/** Cached local material; `libName` pulls (and clones only if patched). */
function mat(ctx, name, patch, libName) {
  ctx.__deckMats = ctx.__deckMats || new Map();
  if (ctx.__deckMats.has(name)) return ctx.__deckMats.get(name);
  let m;
  const lib = ctx.mat || {};
  const src = libName ? lib[libName] : lib[name];
  if (src && src.isMaterial) {
    m = patch ? src.clone() : src;
    if (patch) {
      for (const k of Object.keys(patch)) {
        m[k] = (k === 'color' || k === 'emissive' || k === 'sheenColor')
          ? new ctx.THREE.Color(patch[k]) : patch[k];
      }
    }
  } else {
    m = new ctx.THREE.MeshPhysicalMaterial(
      Object.assign({ roughness: 0.9, metalness: 0 }, patch || {}));
    if (patch && patch.color !== undefined) m.color = new ctx.THREE.Color(patch.color);
  }
  m.userData.keep = true;
  ctx.__deckMats.set(name, m);
  return m;
}

export default build;
