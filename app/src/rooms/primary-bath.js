/**
 * app/src/rooms/primary-bath.js — the primary bath (12'11" x 13'9", second floor).
 *
 * Photos: `master_bedroom_bathroom_view_1.png` (hero), `master_bedroom_bathroom_view_2.png`.
 *
 * ---------------------------------------------------------------------------
 * THE ROOM, AS THE PHOTOGRAPHS SHOW IT
 * ---------------------------------------------------------------------------
 * Hero camera stands just past the SE corner of the cherry vanity, low (4.05 ft),
 * looking NE. Frame left: the white 2-panel slider to the sunroom — dark slat
 * deck, heavy dark timber glass wall, big backyard trees fully legible through
 * it. Centre: the NE-corner glass shower in a projecting surround of 12x24
 * metallic bronze porcelain (tiled header with two warm cans inside), then the
 * drop-in jetted tub in a tiled platform with a black granite deck, a bronze
 * tile wainscot capped by a 1" mosaic band at ~4 ft behind it. Right: the white
 * W.C. wall with two black square robe hooks and the six-panel W.C. door
 * standing open (black lever, black hinges), toilet just visible inside.
 * Overhead: the big splayed white skylight well — the room's main light.
 * Floor: 13x13 mottled terracotta-brown porcelain, tan grout, straight set.
 *
 * The room is UNSTAGED: no towels, no bottles, no mat. The only accessory in
 * the whole suite is the chrome swing-arm magnifying mirror by the slider.
 *
 * Everything here keys off dims.js (which this round corrected: the W.C. is at
 * the SE corner, shower NE — confirmed by both photos and the floor plan).
 */

import { LEVELS, CEIL_Y, GRID, WALL, SKYLIGHTS } from '../core/dims.js';
import { applyUV } from '../core/materials.js';
import { inch, ft } from '../core/units.js';

export const meta = {
  id: 'primary-bath',
  title: 'Primary bath',
  level: 'second',
  photos: ['master_bedroom_bathroom_view_1.png', 'master_bedroom_bathroom_view_2.png'],
};

const HALFPI = Math.PI / 2;

/* ------------------------------------------------------------------ */
/* Room geometry constants (all faces, all in feet)                    */
/* ------------------------------------------------------------------ */
const FLOOR = LEVELS.second;          // 9.5
const CEIL = CEIL_Y.second;           // 17.5

const W_FACE = 13.583;                // west wall inside face (slat / vanity wall)
const N_FACE = 5.842;                 // north wall inside face (slider wall)
const E_FACE = 26.6875;               // east drywall face (w2-bedroom2-w / w2-wc-e)
const S_FACE = 19.5095;               // south wall inside face
const WCW = 23.3125;                  // W.C. west wall, bath-side face
const WCN = 14.467;                   // W.C. north wall, bath-side face

// slider (matches the dims opening on w2-sunroom-s)
const SLIDER = { x0: 16.2, x1: 22.2, h: ft(6, 8) };

// shower enclosure (NE corner)
const SH = {
  x0: 22.95,          // front (glass) plane
  z1: 9.35,           // interior face of the south stub wall
  stubT: 0.375,       // stub thickness -> platform starts at 9.725
  pilZ1: 6.5,         // north pilaster, z 5.842 .. 6.5
  doorZ1: 8.62,       // hinged door glass, z 6.5 .. 8.62
  headY0: 16.10,      // tiled header soffit  (6.6 ft AFF)
  headY1: 16.92,      // tiled header top     (7.42 ft AFF)
  curbH: 0.40,
  curbD: 0.38,
};

// tub platform
const TUB = {
  x0: 23.15, x1: E_FACE,
  z0: SH.z1 + SH.stubT,               // 9.725
  z1: WCN,                            // 14.467
  deckH: inch(20),
};

// mosaic accent band (4 ft nominal)
const BAND = { y0: FLOOR + 3.70, h: inch(4) };

// vanity
const VAN = { z0: 6.0, z1: 16.0, d: 1.79, counterY: FLOOR + 2.98, counterT: inch(1.3) };

const TILE_T = 0.055;                 // thin-set tile build-out

/* ------------------------------------------------------------------ */

export function build(ctx) {
  const { THREE, kit, mat, lights } = ctx;
  const g = new THREE.Group();
  g.name = 'primary-bath';
  ctx.group.add(g);

  // The shell's placeholder can grid is replaced by the real fixture set.
  if (ctx.shell && ctx.shell.removeLights) ctx.shell.removeLights('primaryBath', 'primaryWC');
  // The shell baseboard runs straight through the tiled zones; rebuild it only
  // on the painted runs.
  if (ctx.shell && ctx.shell.hideTrim) ctx.shell.hideTrim('primaryBath');

  buildShower(ctx, g);
  buildTubPlatform(ctx, g);
  buildWainscot(ctx, g);
  buildVanityWall(ctx, g);
  buildWaterCloset(ctx, g);
  buildTrimAndDevices(ctx, g);
  buildSunroomView(ctx, g);
  buildLighting(ctx, g);

  return g;
}

/* ================================================================== */
/* Shower — NE corner, tiled surround with a glass front               */
/* ================================================================== */

function buildShower(ctx, g) {
  const { THREE, kit, mat } = ctx;
  const tile = mat.bronzePorcelain;
  const uvT = (m, opts) => applyUV(m, undefined, opts);

  const box = (x0, y0, z0, x1, y1, z1, material, o = {}) => {
    const b = kit.boxAt(x0, y0, z0, x1 - x0, y1 - y0, z1 - z0, material,
      Object.assign({ r: inch(0.07), uv: true }, o));
    g.add(b);
    return b;
  };

  /* interior tile: north wall, east wall, stub north face ------------- */
  // (each backer is nudged 0.005 off its drywall plane to avoid z-fighting)
  // north wall face (z = N_FACE), tile from the front plane to the corner
  box(SH.x0, FLOOR, N_FACE + 0.005, E_FACE, SH.headY0, N_FACE + 0.005 + TILE_T, tile);
  // east wall face
  box(E_FACE - 0.005 - TILE_T, FLOOR, N_FACE, E_FACE - 0.005, SH.headY0, SH.z1, tile);
  // south stub wall (solid tiled, both faces + west end)
  box(SH.x0 + SH.curbD, FLOOR, SH.z1, E_FACE, SH.headY0, SH.z1 + SH.stubT, tile);

  /* mosaic band inside, at ~4 ft ------------------------------------- */
  const mos = mat.mosaicAccent;
  box(SH.x0 + 0.02, BAND.y0, N_FACE + TILE_T, E_FACE - TILE_T, BAND.y0 + BAND.h,
    N_FACE + TILE_T + 0.02, mos, { r: inch(0.03) });
  box(E_FACE - TILE_T - 0.02, BAND.y0, N_FACE + 0.3, E_FACE - TILE_T, BAND.y0 + BAND.h,
    SH.z1 - 0.02, mos, { r: inch(0.03) });
  box(SH.x0 + SH.curbD, BAND.y0, SH.z1 - 0.02, E_FACE - TILE_T - 0.05,
    BAND.y0 + BAND.h, SH.z1, mos, { r: inch(0.03) });

  /* front composition (x = SH.x0 plane) -------------------------------- */
  // north pilaster — a full-height tiled column at the NW corner of the box
  box(SH.x0, FLOOR, N_FACE, SH.x0 + SH.curbD, SH.headY0, SH.pilZ1, tile);

  // tiled header: solid beam across the whole enclosure, tiled face +
  // soffit; the two warm cans recess into its underside.
  box(SH.x0, SH.headY0, N_FACE, E_FACE, SH.headY1, SH.z1 + SH.stubT, tile);
  // white drywall band above the header up to the ceiling
  box(SH.x0 + 0.02, SH.headY1, N_FACE, E_FACE, CEIL, SH.z1 + SH.stubT,
    ctx.mat.wallPaintWarmWhite, { r: inch(0.05) });

  /* curb across the glass bay ------------------------------------------ */
  const curb = box(SH.x0, FLOOR, SH.pilZ1 - 0.02, SH.x0 + SH.curbD, FLOOR + SH.curbH,
    SH.z1 + 0.02, tile);
  void curb;
  const cap = kit.boxAt(SH.x0 - inch(0.15), FLOOR + SH.curbH, SH.pilZ1 - 0.02,
    SH.curbD + inch(0.3), inch(0.7), SH.z1 - SH.pilZ1 + 0.04, mat.blackGranite,
    { r: inch(0.06), seg: 2, uv: true });
  g.add(cap);

  /* pan: mosaic floor + round chrome drain ----------------------------- */
  const pan = kit.boxAt(SH.x0 + SH.curbD, FLOOR + 0.015, N_FACE + TILE_T,
    E_FACE - SH.x0 - SH.curbD - TILE_T, inch(0.35), SH.z1 - N_FACE - TILE_T,
    mat.mosaicAccent, { r: inch(0.02), uv: true, cast: false });
  g.add(pan);
  const drain = kit.cyl(inch(2.0), inch(2.0), inch(0.1), kit.materials.chrome, 24);
  drain.position.set(24.9, FLOOR + 0.05, 7.6);
  g.add(drain);

  /* glass: hinged door + fixed panel ----------------------------------- */
  const doorW = SH.doorZ1 - SH.pilZ1;
  const glassH = SH.headY0 - (FLOOR + SH.curbH) - 0.06;
  const door = kit.framelessGlassShowerDoor({
    w: doorW, h: glassH, hinge: 'left', open: 0.10, finish: 'chrome',
  });
  door.rotation.y = -HALFPI;                       // glass into the x = SH.x0 plane
  door.position.set(SH.x0 + 0.02, FLOOR + SH.curbH + 0.02, (SH.pilZ1 + SH.doorZ1) / 2);
  g.add(door);

  const fixW = SH.z1 - SH.doorZ1 - 0.02;
  const fixed = kit.box(fixW, glassH + SH.curbH - 0.02, inch(0.45),
    doorGlassMat(ctx), { r: inch(0.05), cast: false });
  fixed.rotation.y = -HALFPI;
  fixed.position.set(SH.x0 + 0.02, FLOOR + 0.02 + (glassH + SH.curbH) / 2,
    (SH.doorZ1 + SH.z1) / 2);
  g.add(fixed);
  // chrome clips top + bottom of the fixed lite
  for (const y of [FLOOR + 0.55, SH.headY0 - 0.35]) {
    const clip = kit.box(inch(1.3), inch(2.2), inch(1.3), kit.materials.chrome, { r: inch(0.1) });
    clip.position.set(SH.x0 + 0.02, y, SH.z1 - 0.35);
    g.add(clip);
  }

  /* hardware: rain head, slide-bar handheld, valve --------------------- */
  const head = kit.showerHead({ finish: 'chrome' });
  head.position.set(24.95, 15.85, N_FACE + TILE_T);
  g.add(head);

  const valve = kit.showerValve({ finish: 'chrome' });
  valve.position.set(23.85, FLOOR + 3.6, N_FACE + TILE_T);
  g.add(valve);

  // slide bar + handheld near the door
  const chrome = kit.materials.chrome;
  const bar = kit.cyl(inch(0.35), inch(0.35), 2.4, chrome, 14);
  bar.position.set(23.62, FLOOR + 4.6, N_FACE + TILE_T + inch(1.6));
  g.add(bar);
  for (const s of [-1, 1]) {
    const foot = kit.cyl(inch(0.4), inch(0.5), inch(1.6), chrome, 14);
    foot.rotation.x = HALFPI;
    foot.position.set(23.62, FLOOR + 4.6 + s * 1.18, N_FACE + TILE_T + inch(0.8));
    g.add(foot);
  }
  const hh = kit.cyl(inch(0.5), inch(0.75), inch(3.6), chrome, 16);
  hh.position.set(23.62, FLOOR + 4.35, N_FACE + TILE_T + inch(2.1));
  hh.rotation.x = 0.28;
  g.add(hh);
  const hose = kit.tube([
    [23.62, FLOOR + 4.1, N_FACE + 0.22],
    [23.75, FLOOR + 3.2, N_FACE + 0.45],
    [23.6, FLOOR + 2.4, N_FACE + 0.3],
    [23.55, FLOOR + 3.0, N_FACE + 0.18],
  ], inch(0.16), chrome);
  g.add(hose);
}

/** Shared shower-glass material (clear, slightly green edge, reflective). */
function doorGlassMat(ctx) {
  if (!ctx.__showerGlass) {
    const m = new ctx.THREE.MeshPhysicalMaterial({
      color: 0xeef4f2, roughness: 0.02, metalness: 0.0, transmission: 0.96,
      thickness: inch(0.5), ior: 1.52, transparent: true, envMapIntensity: 1.5,
      side: ctx.THREE.DoubleSide,
    });
    m.userData.keep = true;
    ctx.__showerGlass = m;
  }
  return ctx.__showerGlass;
}

/* ================================================================== */
/* Tub platform — tiled deck, black granite cap, white jetted tub       */
/* ================================================================== */

function buildTubPlatform(ctx, g) {
  const { kit, mat } = ctx;
  const w = TUB.x1 - TUB.x0;
  const l = TUB.z1 - TUB.z0;
  const tub = kit.dropInJacuzziTub({
    w, l,
    deckH: TUB.deckH,
    tile: mat.bronzePorcelain,
    capMaterial: mat.blackGranite,
    tubW: w - 0.80,
    tubL: l - 1.05,
    depth: inch(16),
    jets: 6,
    finish: 'chrome',
  });
  tub.position.set((TUB.x0 + TUB.x1) / 2, FLOOR, (TUB.z0 + TUB.z1) / 2);
  g.add(tub);

  // The drop-in's white rolled rim sits ON the granite deck and overlaps the
  // opening ~2.5" all round — without it the tub reads as a hole in the deck.
  const tw = w - 0.80, tl = l - 1.05;
  const rim = kit.plateWithHoles(tw + 0.42, tl + 0.42,
    [[-(tw / 2) + 0.16, -(tl / 2) + 0.16, tw / 2 - 0.16, tl / 2 - 0.16]],
    inch(0.9), kit.materials.acrylic, { bevel: inch(0.35) });
  rim.rotation.x = -HALFPI;
  rim.position.set((TUB.x0 + TUB.x1) / 2, FLOOR + TUB.deckH + inch(0.02), (TUB.z0 + TUB.z1) / 2);
  g.add(rim);
}

/* ================================================================== */
/* Wainscot behind the tub — bronze tile to 3.7 ft + mosaic cap         */
/* ================================================================== */

function buildWainscot(ctx, g) {
  const { kit, mat } = ctx;
  // east wall, tub bay only; dies into the shower stub at the north and the
  // white W.C. wall at the south, exactly as the photo shows.
  const t = kit.boxAt(E_FACE - 0.005 - TILE_T, FLOOR + TUB.deckH - 0.4, TUB.z0 - 0.02,
    TILE_T, BAND.y0 - (FLOOR + TUB.deckH - 0.4), TUB.z1 - TUB.z0 + 0.04,
    mat.bronzePorcelain, { r: inch(0.05), uv: true });
  g.add(t);
  const band = kit.boxAt(E_FACE - 0.01 - TILE_T - 0.015, BAND.y0, TUB.z0 - 0.02,
    TILE_T + 0.015, BAND.h, TUB.z1 - TUB.z0 + 0.04,
    mat.mosaicAccent, { r: inch(0.03), uv: true });
  g.add(band);
}

/* ================================================================== */
/* Vanity wall — cherry double vanity, black granite, slat wall,        */
/* mirrors, brass bars, black plates, magnifying mirror                 */
/* ================================================================== */

function buildVanityWall(ctx, g) {
  const { THREE, kit, mat } = ctx;
  const dark = mat.cherryCabinetDark;

  /* cabinet bank: south -> north along the west wall ------------------- */
  // [door pair][3 drawers][door pair][3 drawers][door pair]
  const units = [
    { z0: 14.0, z1: 16.0, doors: 2, drawers: 0 },
    { z0: 12.4, z1: 14.0, doors: 0, drawers: 3 },
    { z0: 10.6, z1: 12.4, doors: 2, drawers: 0 },
    { z0: 9.0, z1: 10.6, doors: 0, drawers: 3 },
    { z0: 6.0, z1: 9.0, doors: 2, drawers: 0 },
  ];
  for (const u of units) {
    const cab = kit.baseCabinet({
      w: u.z1 - u.z0, d: VAN.d, h: VAN.counterY - FLOOR - VAN.counterT,
      style: 'shaker', material: dark,
      doors: u.doors, drawers: u.drawers, pulls: 'blackBar',
    });
    // back against the west wall, faces east: local +Z -> +X, local +X -> -Z
    cab.rotation.y = HALFPI;
    cab.position.set(W_FACE, FLOOR, (u.z0 + u.z1) / 2);
    g.add(cab);
  }

  /* black granite counter with two undermount bowls -------------------- */
  // plateWithHoles builds in local XY (extruded +Z); rotation.x = -HALFPI maps
  // local X -> world x, local Y -> world -z, depth -> up.
  const cw = VAN.z1 - VAN.z0 + 0.05;        // along z
  const cd = VAN.d + 0.12;                  // along x, ~1" overhang
  const czc = VAN.z0 + cw / 2 - 0.025;      // plate centre, world z
  const sinks = [7.5, 14.95];
  const holes = sinks.map((zc) => {
    const dz = zc - czc;
    return [-0.51, -dz - 0.62, 0.51, -dz + 0.62];
  });
  const top = kit.plateWithHoles(cd, cw, holes, VAN.counterT, mat.blackGranite,
    { bevel: inch(0.09) });
  top.rotation.x = -HALFPI;
  top.position.set(W_FACE + cd / 2, VAN.counterY, czc);
  g.add(top);

  for (const zc of sinks) {
    const bowl = kit.undermountSink({ bowls: 1, w: 1.24, d: 1.02, depth: inch(7.5),
      material: kit.materials.china });
    bowl.rotation.y = HALFPI;
    bowl.position.set(W_FACE + cd / 2 - 0.01, VAN.counterY, zc);
    g.add(bowl);
    const f = kit.faucet({ style: 'gooseneck', finish: 'black',
      height: inch(8.0), reach: inch(5.6), r: inch(0.42) });
    f.rotation.y = HALFPI;
    f.position.set(W_FACE + 0.38, VAN.counterY + VAN.counterT, zc);
    g.add(f);
  }

  /* backlit slat wall: counter to ceiling ------------------------------ */
  const slat = kit.boxAt(W_FACE, VAN.counterY + VAN.counterT - 0.02, VAN.z0,
    0.07, CEIL - VAN.counterY - VAN.counterT + 0.02, VAN.z1 - VAN.z0,
    mat.woodSlatWall, { r: inch(0.04) });
  applyUV(slat, undefined, { axes: 'zy' });
  g.add(slat);

  /* mirrors ------------------------------------------------------------ */
  // large frameless, rounded corners, over the SOUTH sink
  const big = kit.boxAt(-1.5, -1.4, 0, 3.0, 2.8, inch(0.4), mat.mirrorGlass,
    { r: inch(2.2), seg: 5, cast: false });
  const bigG = new THREE.Group();
  bigG.add(big);
  bigG.rotation.y = HALFPI;
  bigG.position.set(W_FACE + 0.10, FLOOR + 4.9, 14.4);
  g.add(bigG);
  // smaller black-framed rounded rectangle over the NORTH sink
  const small = kit.mirrorRounded({ w: 2.3, h: 2.7, finish: 'black' });
  small.rotation.y = HALFPI;
  small.position.set(W_FACE + 0.08, FLOOR + 4.85, 7.5);
  g.add(small);

  /* linear brass vanity bars over each mirror -------------------------- */
  for (const [zc, w] of [[14.4, 2.5], [7.5, 2.0]]) {
    const bar = kit.linearVanityBar({ w, finish: 'brass' });
    bar.rotation.y = HALFPI;
    bar.position.set(W_FACE + 0.08, FLOOR + 6.5, zc);
    g.add(bar);
  }

  /* BLACK decora plates between the mirrors (the only black plates in
   * the house — DETAILS G1). One is ~0.8 deg off plumb. */
  for (const [zc, tilt] of [[10.85, 0], [11.4, 0.014]]) {
    const plate = kit.box(inch(0.35), inch(4.6), inch(2.85), kit.materials.blackMetal,
      { r: inch(0.06), seg: 2 });
    plate.position.set(W_FACE + 0.09, FLOOR + 3.67, zc);
    plate.rotation.x = tilt;
    g.add(plate);
    const rocker = kit.box(inch(0.3), inch(2.5), inch(1.1), kit.materials.blackMetal,
      { r: inch(0.04) });
    rocker.position.set(W_FACE + 0.105, FLOOR + 3.67, zc);
    rocker.rotation.x = tilt;
    g.add(rocker);
  }

  /* chrome swing-arm magnifying mirror on the north wall by the slider - */
  const chrome = kit.materials.chrome;
  const mg = new THREE.Group();
  const base = kit.cyl(inch(1.4), inch(1.55), inch(0.4), chrome, 24);
  base.rotation.x = HALFPI;
  base.position.z = inch(0.2);
  mg.add(base);
  const arm1 = kit.cyl(inch(0.22), inch(0.22), inch(6.5), chrome, 12);
  arm1.rotation.x = HALFPI - 0.25;
  arm1.position.set(inch(1.2), -inch(0.6), inch(3.2));
  mg.add(arm1);
  const arm2 = kit.cyl(inch(0.2), inch(0.2), inch(6.0), chrome, 12);
  arm2.rotation.x = HALFPI + 0.35;
  arm2.rotation.z = 0.5;
  arm2.position.set(inch(2.6), -inch(0.4), inch(8.0));
  mg.add(arm2);
  const ring = kit.torus(inch(3.4), inch(0.35), chrome, 40, 10);
  ring.position.set(inch(4.0), 0, inch(10.6));
  ring.rotation.y = 0.5;
  mg.add(ring);
  const face = new THREE.Mesh(new THREE.CircleGeometry(inch(3.2), 36), mat.mirrorGlass);
  face.position.copy(ring.position);
  face.rotation.y = 0.5;
  mg.add(face);
  mg.traverse((n) => { if (n.isMesh) { n.castShadow = true; n.receiveShadow = true; } });
  // on the north wall, west of the slider
  mg.rotation.y = Math.PI;                    // faces -z? plate on z = N_FACE facing +z
  mg.rotation.y = 0;
  mg.position.set(15.35, FLOOR + 5.1, N_FACE + 0.01);
  g.add(mg);
}

/* ================================================================== */
/* Water closet — toilet + the door standing open                      */
/* ================================================================== */

function buildWaterCloset(ctx, g) {
  const { kit } = ctx;
  // toilet against the north wall of the W.C., facing south
  const t = kit.toilet({});
  t.position.set(25.05, FLOOR, WCN + WALL.int + 0.02);
  g.add(t);

  // tile threshold under the open door — otherwise the shell's base plate
  // (carpet) shows in the 4.5" wall band under the leaf.
  const thr = kit.boxAt(WCW - 0.03, FLOOR - 0.02, 16.45, WALL.int + 0.44, 0.033, 2.65,
    ctx.mat.bronzePorcelainFloor, { r: inch(0.02), uv: true, cast: false });
  g.add(thr);

  // swing the shell-built six-panel door open into the bath (~105 deg),
  // resting back toward the south wall the way the photo has it.
  if (ctx.shell && ctx.shell.openings) {
    for (const rec of ctx.shell.openings) {
      if (rec.wall === 'w2-wc-w' && rec.group && rec.group.userData.pivot) {
        rec.group.userData.pivot.rotation.y = -1.83;
      }
    }
  }
}

/* ================================================================== */
/* Trim, registers, hooks, floor vent                                  */
/* ================================================================== */

function buildTrimAndDevices(ctx, g) {
  const { THREE, kit, mat } = ctx;

  /* baseboard on the painted runs only --------------------------------- */
  const base = (path) => {
    const b = kit.baseboard(path, { height: inch(5.25), shoe: false });
    b.position.y = FLOOR;
    g.add(b);
  };
  // north wall (interior +z): run east -> west so the room is on the right
  base([[SLIDER.x0 - 0.30, N_FACE], [W_FACE, N_FACE]]);
  base([[SH.x0, N_FACE], [SLIDER.x1 + 0.30, N_FACE]]);
  // south wall (interior -z) + turn up the W.C. face to the door casing
  base([[W_FACE, S_FACE], [15.77, S_FACE]]);
  base([[19.03, S_FACE], [WCW, S_FACE], [WCW, 19.21]]);
  // W.C. west face, corner to door casing
  base([[WCW, 16.28], [WCW, WCN]]);
  // west wall between vanity end and the bedroom-door casing
  base([[W_FACE, VAN.z1], [W_FACE, 16.22]]);

  /* two black square robe hooks at ~60" on the W.C. wall ---------------- */
  for (const [zc, y] of [[15.05, FLOOR + 5.0], [16.05, FLOOR + 5.012]]) {
    const hookBase = kit.box(inch(0.3), inch(1.5), inch(1.5), kit.materials.blackMetal,
      { r: inch(0.08), seg: 2 });
    hookBase.position.set(WCW - inch(0.15), y, zc);
    g.add(hookBase);
    const arm = kit.box(inch(1.5), inch(0.55), inch(0.55), kit.materials.blackMetal,
      { r: inch(0.1), seg: 2 });
    arm.position.set(WCW - inch(0.9), y - inch(0.1), zc);
    g.add(arm);
    const tip = kit.box(inch(0.5), inch(1.1), inch(0.55), kit.materials.blackMetal,
      { r: inch(0.1), seg: 2 });
    tip.position.set(WCW - inch(1.55), y + inch(0.25), zc);
    g.add(tip);
  }

  /* white linear floor register in the tile at the slider --------------- */
  const regW = 1.15, regD = 0.34;
  const regFrame = kit.box(regW, inch(0.22), regD, kit.materials.trimWhite,
    { r: inch(0.05), seg: 2 });
  regFrame.position.set(20.9, FLOOR + inch(0.10), 6.55);
  regFrame.rotation.y = 0.008;
  g.add(regFrame);
  const slots = new THREE.Mesh(
    new THREE.PlaneGeometry(regW - inch(1.0), regD - inch(0.9)),
    slotMat(ctx));
  slots.rotation.x = -HALFPI;
  slots.rotation.z = 0.008;
  slots.position.set(20.9, FLOOR + inch(0.225), 6.55);
  g.add(slots);

  /* small white supply grille HIGH on the north wall, right of the slider */
  grille(ctx, g, [22.56, FLOOR + 7.25, N_FACE + inch(0.28)], 0.62, 0.4, 0);
  /* white ceiling exhaust grille, NW of the skylight well ---------------- */
  const ex = grille(ctx, g, [16.3, CEIL - inch(0.3), 7.1], 0.85, 0.62, 0);
  ex.rotation.x = HALFPI;
}

function grille(ctx, g, pos, w, h, yaw) {
  const { THREE, kit } = ctx;
  const grp = new THREE.Group();
  const frame = kit.box(w, h, inch(0.35), kit.materials.trimWhite, { r: inch(0.06), seg: 2 });
  grp.add(frame);
  // horizontal fins
  const finM = finMat(ctx);
  for (let i = 0; i < 4; i++) {
    const fin = new THREE.Mesh(new THREE.PlaneGeometry(w - inch(1.0), (h - inch(0.9)) / 4 * 0.55), finM);
    fin.position.set(0, -(h - inch(1.0)) / 2 + ((h - inch(1.0)) * (i + 0.5)) / 4, inch(0.19));
    fin.rotation.x = 0.55;
    grp.add(fin);
  }
  grp.position.set(pos[0], pos[1], pos[2]);
  grp.rotation.y = yaw;
  grp.traverse((n) => { if (n.isMesh) { n.castShadow = false; n.receiveShadow = true; } });
  g.add(grp);
  return grp;
}

function finMat(ctx) {
  if (!ctx.__finMat) {
    const m = new ctx.THREE.MeshStandardMaterial({ color: 0xd8d5d0, roughness: 0.6 });
    m.userData.keep = true;
    ctx.__finMat = m;
  }
  return ctx.__finMat;
}

function slotMat(ctx) {
  if (!ctx.__slotMat) {
    const m = new ctx.THREE.MeshStandardMaterial({ color: 0x35322e, roughness: 0.8 });
    m.userData.keep = true;
    ctx.__slotMat = m;
  }
  return ctx.__slotMat;
}

/* ================================================================== */
/* The view: sunroom timber + slat deck, trees, lawn, fence             */
/* ================================================================== */

/**
 * VIEW PROXY. The sunroom is its own judged piece; what is built here is only
 * the part of it (and of the yard) that this room's slider actually frames:
 * the heavy dark timber posts and head of the sunroom's glass wall, and real
 * canopy trees + a picket fence on the lawn beyond. Grouped and named so the
 * sunroom/exterior builders can find and remove it if they take over.
 */
function buildSunroomView(ctx, g) {
  const { THREE, kit, mat } = ctx;
  const v = new THREE.Group();
  v.name = 'primary-bath:viewProxy';
  g.add(v);

  const timber = kit.materials.timber;
  // posts at the real mullion stations of ext-second-0
  for (const x of [15.325, 19.395]) {
    const post = kit.boxAt(x - 0.26, FLOOR, 0.60, 0.52, 6.4, 0.55, timber, { r: inch(0.12), uv: true });
    v.add(post);
  }
  // head beam + sill band along the glass line
  v.add(kit.boxAt(13.6, FLOOR + 6.4, 0.58, 9.6, 0.55, 0.6, timber, { r: inch(0.1), uv: true }));
  v.add(kit.boxAt(13.6, FLOOR, 0.58, 9.6, 0.38, 0.55, timber, { r: inch(0.08), uv: true }));
  // dark linear floor grille strip along the glass (plenum cover)
  const grille2 = kit.boxAt(13.6, FLOOR + 0.02, 1.12, 9.6, inch(0.4), 0.55,
    mat.blackBacker, { r: inch(0.04), uv: true });
  v.add(grille2);

  /* trees + fence beyond ---------------------------------------------- */
  const GRASS = -1.15;
  const bark = mat.treeBark;
  const leaf = mat.foliageBroadleaf;
  const draft = ctx.quality === 'draft';
  const trees = [
    { at: [16.5, -14.5], stems: 3, trunkR: 0.5, base: 10.0, top: 34.0, spread: 24.0, card: 3.0, clumps: 46, seed: 41 },
    { at: [25.5, -23.0], stems: 1, trunkR: 0.7, base: 11.0, top: 40.0, spread: 28.0, card: 3.6, clumps: 40, seed: 57 },
    { at: [9.0, -26.0], stems: 2, trunkR: 0.6, base: 9.0, top: 33.0, spread: 22.0, card: 3.2, clumps: 34, seed: 73 },
    // canopy band behind the fence so no bare sky shows at the horizon
    { at: [14.0, -46.0], stems: 2, trunkR: 0.8, base: 8.0, top: 44.0, spread: 34.0, card: 4.4, clumps: 40, seed: 91 },
    { at: [30.0, -44.0], stems: 1, trunkR: 0.8, base: 9.0, top: 42.0, spread: 32.0, card: 4.2, clumps: 36, seed: 107 },
    { at: [2.0, -40.0], stems: 2, trunkR: 0.7, base: 8.0, top: 38.0, spread: 28.0, card: 4.0, clumps: 32, seed: 123 },
  ];
  for (const t of trees) {
    v.add(kit.deciduousTree({
      bark, leaf,
      at: t.at, groundY: GRASS,
      height: t.top + GRASS,
      crownBase: t.base + GRASS,
      spread: t.spread, trunkR: t.trunkR, stems: t.stems,
      lean: 0.06, branches: 5, subBranches: 2,
      clumps: Math.round(t.clumps * (draft ? 0.35 : 1)),
      cardsPer: 18, card: t.card, seed: t.seed,
      name: `primary-bath:viewTree`,
    }));
  }

  // weathered picket fence across the back of the lawn
  const fenceM = fenceMat(ctx);
  const fz = -37.0;
  for (let x = 2; x < 44; x += 0.66) {
    const p = kit.box(0.45, 3.6 + ((x * 7) % 3) * 0.04, 0.12, fenceM, { r: inch(0.05) });
    p.position.set(x, GRASS + 1.85, fz);
    v.add(p);
  }
  for (const y of [GRASS + 1.0, GRASS + 3.0]) {
    const rail = kit.box(42.5, 0.28, 0.15, fenceM, { r: inch(0.04) });
    rail.position.set(23.2, y, fz - 0.14);
    v.add(rail);
  }
  v.traverse((n) => { if (n.isMesh) n.castShadow = true; });
}

function fenceMat(ctx) {
  if (!ctx.__fenceMat) {
    const m = new ctx.THREE.MeshStandardMaterial({ color: 0xb9b3a6, roughness: 0.9 });
    m.userData.keep = true;
    ctx.__fenceMat = m;
  }
  return ctx.__fenceMat;
}

/* ================================================================== */
/* Lighting — skylight, slider daylight, cans                           */
/* ================================================================== */

function buildLighting(ctx, g) {
  const { THREE, lights } = ctx;
  if (!lights) return;

  const sky = SKYLIGHTS.find((s) => s.id === 'sky-primary-bath');
  const [sx0, sz0, sx1, sz1] = sky ? sky.plan : [18.2, 8.2, 23.0, 13.0];
  const scx = (sx0 + sx1) / 2, scz = (sz0 + sz1) / 2;
  const splay = sky ? sky.wellSplay : 1.1;
  const topW = (sx1 - sx0) - 2 * splay;
  const roofY = sky ? sky.roofY : 21.4;

  /* skylight: bright sky plate at the glass + soft downlight ------------ */
  lights.windowLight(g, {
    rect: { center: [scx, roofY - 0.15, scz], width: topW, height: topW },
    normal: [0, -1, 0],
    intensity: 24,
    color: 0xeaf1fa,
    glow: true, glowIntensity: 1.55, glowColor: 0xf4f8fd, glowOffset: 0.22,
    name: 'primaryBath:skylightTop',
  });
  // a second, wider rect just above the ceiling aperture washes the room the
  // way the splayed well does; glow off (the well is visible through it).
  lights.windowLight(g, {
    rect: { center: [scx, CEIL + 0.06, scz], width: sx1 - sx0 - 0.3, height: sz1 - sz0 - 0.3 },
    normal: [0, -1, 0],
    intensity: 2.0,
    color: 0xf3f6fb,
    glow: false,
    name: 'primaryBath:skylightWash',
  });
  // small point inside the well so the splayed white faces read bright
  const wellP = new THREE.PointLight(0xfdfaf4, 4.0, 10.0, 2.0);
  wellP.position.set(scx, CEIL + 1.6, scz);
  g.add(wellP);

  /* slider daylight ----------------------------------------------------- */
  lights.windowLight(g, {
    rect: { center: [(SLIDER.x0 + SLIDER.x1) / 2, FLOOR + SLIDER.h / 2 + 0.1, N_FACE + 0.06],
      width: SLIDER.x1 - SLIDER.x0 - 0.3, height: SLIDER.h - 0.3 },
    normal: [0, 0, 1],
    intensity: 3.2,
    color: 0xe9f0e4,
    glow: false,
    name: 'primaryBath:slider',
  });

  /* recessed cans -------------------------------------------------------- */
  const can = (pos, o = {}) => {
    const c = lights.recessedCan(pos, Object.assign({
      temp: 2900, intensity: 40, angle: 0.98, penumbra: 0.88,
      castShadow: false, quality: ctx.quality,
    }, o));
    g.add(c);
    return c;
  };
  // two in the room field, over the tub aisle (photo: a close pair)
  can([23.35, CEIL, 10.9]);
  can([23.35, CEIL, 12.6]);
  // two over the vanity aisle (visible in view_2)
  can([15.9, CEIL, 8.6]);
  can([15.9, CEIL, 12.9]);
  // two small warm cans in the shower's tiled header
  can([24.15, SH.headY0, 7.35], { apertureIn: 3.4, trimIn: 4.2, intensity: 22, temp: 2800 });
  can([25.75, SH.headY0, 7.35], { apertureIn: 3.4, trimIn: 4.2, intensity: 22, temp: 2800 });
  // one inside the W.C.
  can([25.0, CEIL, 17.3], { intensity: 30 });

  /* warm wash from the two brass bars down the slat wall ----------------- */
  for (const zc of [14.4, 7.5]) {
    const p = new THREE.PointLight(0xffe3b8, 1.6, 6.5, 2.0);
    p.position.set(W_FACE + 0.35, FLOOR + 6.4, zc);
    g.add(p);
  }
}
