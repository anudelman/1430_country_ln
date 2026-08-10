/**
 * app/src/rooms/kitchen.js — the two-tone kitchen (17'5" x 10'4").
 *
 * Photos: kitchen_view_1.png (hero), kitchen_view_2/3/5.png, Kitchen_view_4.png.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE PHOTOS + FLOOR PLAN ACTUALLY SHOW  (solved before building)
 * ---------------------------------------------------------------------------
 * The kitchen is a U open to the NORTH (breakfast nook) and entered from the
 * centre hall through a ~3 ft passage at the NE.  The SOUTH wall is solid —
 * the sink + range run stands against it for its whole length (dims.js's old
 * south opening was removed; see the OPENINGS note there):
 *
 *   WEST RUN  (fronts face EAST):  tall greige pantry (2x2 doors, pushed
 *     north into the pantryRun strip) -> panel-flanked built-in stainless
 *     fridge with a louvered grille -> two cherry base cabinets + counter.
 *   SOUTH RUN (fronts face NORTH), west to east:  corner blind, SINK (black +
 *     brass spring-coil faucet, raised valance cabinet + under-cab light
 *     above), drawers, DISHWASHER, drawers, RANGE + painted hood to the
 *     ceiling, drawers, then a 45-degree ANGLED CORNER cabinet…
 *   EAST RETURN (fronts face WEST):  two drawer stacks dying into the hall
 *     passage with a finished end panel.
 *
 * Island: cherry, panelled N/E/W faces, drawer stacks + microwave on the
 * SOUTH face, quartz top with a built-up edge and a ~10" overhang on the EAST
 * end only, and a 2-gang outlet on the east end panel (beige, not white —
 * kitchen_view_5 close-up).
 *
 * Two-tone per the owner's spec: bases/island in light natural cherry with
 * BLACK+BRASS bar pulls; uppers/hood/pantry in warm greige with dark bars and
 * NICKEL posts.  Uppers run to a stepped greige cornice with a dark shadow
 * reveal at the ceiling — the kitchen ceiling itself has NO crown.
 *
 * Per docs/DETAILS.md `kitchen`: full-height quartz slab backsplash with
 * continuous veining, horizontal white decora outlets at ~44", 6" cans
 * following the runs, two black-cone brass-chain pendants, a ceiling junction
 * blank, one outlet plate off plumb, and NOTHING on the counters.
 */

import { GRID, CEIL } from '../core/dims.js';
import { applyUV } from '../core/materials.js';
import { inch, ft, deg, CAB } from '../core/units.js';

export const meta = {
  id: 'kitchen',
  title: 'Kitchen',
  level: 'first',
  photos: [
    'kitchen_view_1.png', 'kitchen_view_2.png', 'kitchen_view_3.png',
    'Kitchen_view_4.png', 'kitchen_view_5.png',
  ],
};

const F = GRID.first;

/* Room envelope ---------------------------------------------------------- */
const X0 = F.xKitW;          // 13.133  west wall inside face
const X1 = F.xKitE;          // 30.550  east wall inside face
const Z1 = F.zKitS;          // 28.509  south wall inside face
const CEIL_Y = CEIL.first;   // 8.5

/* Casework datum lines --------------------------------------------------- */
const BASE_D = 2.0;                     // base cabinet depth
const BASE_H = CAB.baseH;               // 2.875
const CTR_T = CAB.counterT;             // 0.10417
const CTR_Y = BASE_H;
const CTR_TOP = BASE_H + CTR_T;         // 2.979
const UP_BOT = CAB.upperY;              // 4.479 bottom of wall cabinets
const UP_D = CAB.upperD;                // 1.0833
const UP_TOP = 8.042;                   // cabinet tops; cornice above
const CORN_TOP = 8.402;                 // cornice top; dark reveal above
const SLAB_T = inch(0.55);              // quartz slab backsplash thickness

/* South run stations, west -> east --------------------------------------- */
const SINK_X0 = 15.41, SINK_X1 = 18.11;
const DW_X0 = 19.71, DW_X1 = 21.71;
const RANGE_X0 = 23.31, RANGE_X1 = 25.81;
const RANGE_CX = (RANGE_X0 + RANGE_X1) / 2;     // 24.56
const HOOD_W = 3.3;
const SR_END = 27.35;        // where the south base run meets the diagonal

/* Planes */
const S_FACE = Z1 - BASE_D;             // 26.509 south-run fronts
const S_CTR_FRONT = S_FACE - inch(1);
const E_FACE = X1 - BASE_D;             // 28.55 east-return fronts
const E_CTR_FRONT = E_FACE - inch(1);
const W_FACE = X0 + BASE_D;             // 15.133 west-run base fronts
const W_CTR_FRONT = W_FACE + inch(1);
const S_UP_FACE = Z1 - UP_D;            // 27.426 south upper fronts
const E_UP_FACE = X1 - UP_D;            // 29.467
const W_UP_FACE = X0 + UP_D;            // 14.216

/* West run stations, north -> south -------------------------------------- */
const PAN_Z0 = 16.75, PAN_Z1 = 19.31;   // tall pantry (into the pantryRun strip)
const FR_Z0 = 19.31, FR_Z1 = 23.31;     // fridge incl. two 3" flank panels
const WB_Z0 = 23.31, WB_Z1 = 26.51;     // two cherry base cabinets
const TALL_D = 2.29;
const TALL_FACE = X0 + TALL_D;          // 15.423

/* East return */
const ER_Z0 = 22.81, ER_Z1 = 25.31;

/* Island ------------------------------------------------------------------ */
const ISL_W = 6.4, ISL_D = 3.5;
const ISL_CX = 21.0, ISL_CZ = 22.2;
const ISL_TOP_T = inch(2.0);            // built-up apron edge
const ISL_OVER_E = inch(10);
const ISL_LIP = inch(0.75);

const HALFPI = Math.PI / 2;

export function build(ctx) {
  const { THREE, group, kit, mat, lights, shell } = ctx;
  const P = kit.materials;

  /* ------------------------------ materials ----------------------------- */
  const greige = mat.paintedGreige.clone();
  greige.userData = Object.assign({}, mat.paintedGreige.userData);
  greige.color = new THREE.Color(0xd9d3c8);
  greige.name = 'kitchenGreige';
  const cherry = mat.cherryCabinet;
  const toe = cherry.clone();
  toe.userData = Object.assign({}, cherry.userData);
  toe.color = new THREE.Color(0x8a6f52);
  toe.name = 'kitchenToe';
  const quartz = mat.quartzWhite;
  const slab = mat.quartzSlabBacksplash;

  const RAISED = 'raised';
  const BASE_PULLS = 'blackBrassBar';
  const UPPER_PULLS = 'nickelBar';

  if (shell && typeof shell.removeLights === 'function') {
    shell.removeLights('kitchen', 'pantryRun');
  }

  /* ------------------------------- helpers ------------------------------ */
  function placeBase(x, z, yaw, o) {
    const g = kit.baseCabinet(Object.assign({
      style: RAISED, material: cherry, pulls: BASE_PULLS, toeMaterial: toe,
    }, o));
    g.position.set(x, 0, z);
    g.rotation.y = yaw;
    group.add(g);
    return g;
  }

  function placeUpper(x, y, z, yaw, o) {
    const g = kit.wallCabinet(Object.assign({
      style: RAISED, material: greige, pulls: UPPER_PULLS, d: UP_D,
    }, o));
    g.position.set(x, y, z);
    g.rotation.y = yaw;
    group.add(g);
    return g;
  }

  function counterBox(x0, z0, x1, z1, y = CTR_Y, t = CTR_T) {
    const m = kit.box(x1 - x0, t, z1 - z0, quartz, { r: inch(0.09), seg: 2 });
    m.position.set((x0 + x1) / 2, y + t / 2, (z0 + z1) / 2);
    applyUV(m, undefined, { axes: 'xz' });
    group.add(m);
    return m;
  }

  function slabOnWall(wall, a0, a1, y0, y1, opts = {}) {
    const w = a1 - a0, h = y1 - y0;
    const g = kit.fullHeightSlabBacksplash({ w, h, thickness: SLAB_T, material: slab });
    if (wall === 'south') {
      g.position.set((a0 + a1) / 2, y0, Z1);
      g.rotation.y = Math.PI;
    } else if (wall === 'west') {
      g.position.set(X0, y0, (a0 + a1) / 2);
      g.rotation.y = HALFPI;
    } else {
      g.position.set(X1, y0, (a0 + a1) / 2);
      g.rotation.y = -HALFPI;
    }
    if (opts.name) g.name = opts.name;
    group.add(g);
    return g;
  }

  function panel(x0, y0, z0, x1, y1, z1, m = greige) {
    const b = kit.box(Math.max(x1 - x0, 0.01), Math.max(y1 - y0, 0.01),
      Math.max(z1 - z0, 0.01), m, { r: inch(0.06), seg: 2 });
    b.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    applyUV(b);
    group.add(b);
    return b;
  }

  /* ---------------------------------------------------------------------- */
  /* SOUTH RUN                                                               */
  /* ---------------------------------------------------------------------- */
  panel(X0 + 0.02, 0, S_FACE, SINK_X0, BASE_H, Z1 - 0.02, cherry); // corner blind

  placeBase((SINK_X0 + SINK_X1) / 2, Z1, Math.PI,
    { w: SINK_X1 - SINK_X0, doors: 2, drawers: 1 });
  placeBase((SINK_X1 + DW_X0) / 2, Z1, Math.PI,
    { w: DW_X0 - SINK_X1, doors: 0, drawers: 3 });
  placeBase((DW_X1 + RANGE_X0) / 2, Z1, Math.PI,
    { w: RANGE_X0 - DW_X1, doors: 0, drawers: 3 });
  placeBase((RANGE_X1 + SR_END) / 2, Z1, Math.PI,
    { w: SR_END - RANGE_X1, doors: 0, drawers: 3 });

  {
    const dw = kit.dishwasher({ w: DW_X1 - DW_X0 });
    dw.position.set((DW_X0 + DW_X1) / 2, 0, Z1);
    dw.rotation.y = Math.PI;
    group.add(dw);
  }
  {
    const range = kit.slideInGasRange({ w: RANGE_X1 - RANGE_X0 });
    range.position.set(RANGE_CX, 0, Z1 - SLAB_T - 0.01);
    range.rotation.y = Math.PI;
    group.add(range);
  }
  {
    const hood = kit.rangeHoodSurround({
      w: HOOD_W, d: 1.62, h: CEIL_Y - 5.65, material: greige,
      chimFrac: 0.84, taperH: 0.5, apron: inch(9),
    });
    hood.position.set(RANGE_CX, 5.65, Z1 - 0.04);
    hood.rotation.y = Math.PI;
    group.add(hood);
  }

  /* 45-degree angled corner base: single tall door, long black+brass pull */
  {
    const a = [SR_END, S_FACE], b = [E_FACE, S_FACE - 1.26];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const cx = (a[0] + b[0]) / 2, cz = (a[1] + b[1]) / 2;
    // face normal must point NW into the kitchen
    const yaw = Math.atan2(-(a[1] - b[1]), a[0] - b[0]);
    const g = new THREE.Group();
    g.position.set(cx, 0, cz);
    g.rotation.y = yaw;
    const body = kit.box(len, BASE_H - CAB.toeH, 1.0, cherry, { r: inch(0.05) });
    body.position.set(0, CAB.toeH + (BASE_H - CAB.toeH) / 2, -0.5);
    applyUV(body);
    g.add(body);
    const tk = kit.box(len - 0.2, CAB.toeH, 0.8, toe, { r: inch(0.03) });
    tk.position.set(0, CAB.toeH / 2, -0.65);
    g.add(tk);
    const door = kit.raisedDoorPanel(len - 0.16, BASE_H - CAB.toeH - inch(1.0),
      { material: cherry });
    door.position.set(0, CAB.toeH + (BASE_H - CAB.toeH) / 2, 0.01);
    const pl = kit.pull(BASE_PULLS, inch(11));
    pl.rotation.z = HALFPI;
    pl.position.set(-(len / 2 - inch(2.2)), inch(1.5), inch(0.85));
    door.add(pl);
    g.add(door);
    group.add(g);
    // filler wedges behind (hide the gaps to the square wall corner)
    panel(SR_END, 0, S_FACE, X1 - 0.05, BASE_H, Z1 - 0.05, cherry);
  }

  /* EAST RETURN */
  placeBase(X1, ER_Z0 + 0.625, -HALFPI, { w: 1.25, doors: 0, drawers: 3 });
  placeBase(X1, ER_Z0 + 1.875, -HALFPI, { w: 1.25, doors: 0, drawers: 3 });
  panel(E_FACE - 0.02, 0, ER_Z0 - inch(1), X1 - 0.02, CTR_TOP + inch(0.8), ER_Z0, cherry);

  /* ---------------------------------------------------------------------- */
  /* WEST RUN                                                                */
  /* ---------------------------------------------------------------------- */
  placeBase(X0, WB_Z0 + 0.8, HALFPI, { w: 1.6, doors: 1, drawers: 1 });
  placeBase(X0, WB_Z0 + 2.4, HALFPI, { w: 1.6, doors: 1, drawers: 1 });
  panel(X0 + 0.02, 0, WB_Z1, W_FACE, BASE_H, S_FACE, cherry);  // SW corner blind

  {
    const fr = kit.builtInFridge({
      w: 3.5, d: TALL_D - 0.1, h: ft(6, 10), grille: 1.0, freezerDrawer: false,
    });
    fr.position.set(X0, 0, (FR_Z0 + FR_Z1) / 2);
    fr.rotation.y = HALFPI;
    group.add(fr);
    panel(X0, 0, FR_Z1 - inch(3), TALL_FACE, UP_TOP, FR_Z1);          // south flank
    panel(X0, 0, FR_Z0, TALL_FACE, UP_TOP, FR_Z0 + inch(3));          // north flank
    panel(X0, ft(6, 10) + 1.0, FR_Z0 + inch(2), TALL_FACE - inch(1), UP_TOP,
      FR_Z1 - inch(2));                                               // head filler
  }

  {
    const p = kit.tallCabinet({
      w: PAN_Z1 - PAN_Z0, d: TALL_D, h: UP_TOP, doors: 2,
      style: RAISED, material: greige, pulls: BASE_PULLS, toeMaterial: toe,
    });
    p.position.set(X0, 0, (PAN_Z0 + PAN_Z1) / 2);
    p.rotation.y = HALFPI;
    group.add(p);
  }
  // finished greige back (no wall north of the laundry wall) + north end panel
  panel(X0 - 0.03, 0, PAN_Z0, X0 + 0.03, UP_TOP, 20.45);
  panel(X0, 0, PAN_Z0 - inch(0.8), TALL_FACE, UP_TOP, PAN_Z0);

  /* ---------------------------------------------------------------------- */
  /* COUNTERS                                                                */
  /* ---------------------------------------------------------------------- */
  counterBox(X0, WB_Z0, W_CTR_FRONT, Z1 - 0.02);
  counterBox(W_CTR_FRONT, S_CTR_FRONT, RANGE_X0, Z1 - 0.02);
  counterBox(RANGE_X1, S_CTR_FRONT, SR_END, Z1 - 0.02);
  counterBox(E_CTR_FRONT, ER_Z0, X1 - 0.02, 25.6);
  {
    // diagonal corner: rotated slab, a hair thicker — reads as the seam
    const m = kit.box(2.9, CTR_T + 0.002, 2.4, quartz, { r: inch(0.09), seg: 2 });
    m.position.set(28.15, CTR_Y + (CTR_T + 0.002) / 2, 26.6);
    m.rotation.y = deg(45);
    applyUV(m, undefined, { axes: 'xz' });
    group.add(m);
  }

  /* ---------------------------------------------------------------------- */
  /* SLAB BACKSPLASH                                                         */
  /* ---------------------------------------------------------------------- */
  slabOnWall('south', X0 + 0.05, X1 - 0.06, CTR_TOP - inch(0.4), UP_BOT + inch(0.4));
  slabOnWall('south', RANGE_X0 - 0.35, RANGE_X1 + 0.35, UP_BOT + inch(0.45), 6.3,
    { name: 'slab:hood' });
  slabOnWall('south', SINK_X0, SINK_X1, UP_BOT + inch(0.45), 5.04, { name: 'slab:sink' });
  slabOnWall('west', WB_Z0 - 0.02, Z1 - 0.06, CTR_TOP - inch(0.4), UP_BOT + inch(0.4));
  slabOnWall('east', ER_Z0 - 0.02, Z1 - 0.06, CTR_TOP - inch(0.4), UP_BOT + inch(0.4));

  /* ---------------------------------------------------------------------- */
  /* UPPERS                                                                  */
  /* ---------------------------------------------------------------------- */
  const UP_H = UP_TOP - UP_BOT;

  // west run
  placeUpper(X0, UP_BOT, (FR_Z1 + S_FACE) / 2, HALFPI,
    { w: S_FACE - FR_Z1, h: UP_H, doors: 2 });
  // west corner filler (between the west run and the south run's back corner)
  placeUpper(X0, UP_BOT, (S_FACE + Z1 - UP_D) / 2, HALFPI,
    { w: Z1 - UP_D - S_FACE, h: UP_H, doors: 1, pulls: 'none' });

  // south run
  placeUpper((W_UP_FACE + SINK_X0) / 2, UP_BOT, Z1, Math.PI,
    { w: SINK_X0 - W_UP_FACE, h: UP_H, doors: 1 });
  placeUpper((SINK_X0 + SINK_X1) / 2, 5.05, Z1, Math.PI,
    { w: SINK_X1 - SINK_X0, h: UP_TOP - 5.05, d: 0.95, doors: 2 });
  panel(SINK_X0 + 0.02, 4.92, Z1 - 0.98, SINK_X1 - 0.02, 5.06, Z1 - 0.9); // valance
  placeUpper((SINK_X1 + RANGE_CX - HOOD_W / 2) / 2, UP_BOT, Z1, Math.PI,
    { w: RANGE_CX - HOOD_W / 2 - SINK_X1, h: UP_H, doors: 3 });
  placeUpper((RANGE_CX + HOOD_W / 2 + 28.27) / 2, UP_BOT, Z1, Math.PI,
    { w: 28.27 - (RANGE_CX + HOOD_W / 2), h: UP_H, doors: 2 });

  // angled corner upper (aligned over the base diagonal)
  {
    const a = [28.27, S_UP_FACE], b = [E_UP_FACE, S_UP_FACE - 1.2];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const cx = (a[0] + b[0]) / 2, cz = (a[1] + b[1]) / 2;
    const yaw = Math.atan2(-(a[1] - b[1]), a[0] - b[0]);
    const g = new THREE.Group();
    g.position.set(cx, UP_BOT, cz);
    g.rotation.y = yaw;
    const body = kit.box(len, UP_H, 0.9, greige, { r: inch(0.05) });
    body.position.set(0, UP_H / 2, -0.45);
    applyUV(body);
    g.add(body);
    const door = kit.raisedDoorPanel(len - 0.14, UP_H - inch(1.0), { material: greige });
    door.position.set(0, UP_H / 2, 0.02);
    const pl = kit.pull(UPPER_PULLS, inch(5));
    pl.rotation.z = HALFPI;
    pl.position.set(-(len / 2 - inch(2)), -(UP_H / 2 - inch(5)), inch(0.85));
    door.add(pl);
    g.add(door);
    group.add(g);
    // greige filler above the wall corner behind the diagonal
    panel(28.27, UP_BOT, S_UP_FACE, X1 - 0.05, UP_TOP, Z1 - 0.05, greige);
  }

  // east return uppers + end panel
  placeUpper(X1, UP_BOT, (S_UP_FACE - 1.2 + 23.3) / 2, -HALFPI,
    { w: S_UP_FACE - 1.2 - 23.3, h: UP_H, doors: 2 });
  panel(E_UP_FACE - 0.02, UP_BOT - 0.02, 23.28, X1 - 0.02, UP_TOP, 23.3, greige);

  /* ---------------------------------------------------------------------- */
  /* CORNICE — stepped greige bands + dark shadow reveal at the ceiling.     */
  /* Segments are ordered so the face normal (local +Z after yaw) points     */
  /* into the room.                                                          */
  /* ---------------------------------------------------------------------- */
  const dark = P.iron;
  function cornice(x0, z0, x1, z1) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const yaw = Math.atan2(-(z1 - z0), x1 - x0);
    const g = new THREE.Group();
    g.position.set(cx, 0, cz);
    g.rotation.y = yaw;
    const lower = kit.box(len + 0.02, 0.20, 0.16, greige, { r: inch(0.05), seg: 2 });
    lower.position.set(0, UP_TOP + 0.10, 0.02);
    g.add(lower);
    const upperB = kit.box(len + 0.12, 0.16, 0.2, greige, { r: inch(0.05), seg: 2 });
    upperB.position.set(0, UP_TOP + 0.20 + 0.08, 0.05);
    g.add(upperB);
    const reveal = kit.box(len + 0.02, CEIL_Y - CORN_TOP + 0.02, 0.1, dark,
      { r: inch(0.02) });
    reveal.position.set(0, (CORN_TOP + CEIL_Y) / 2, -0.1);
    reveal.castShadow = false;
    g.add(reveal);
    group.add(g);
    return g;
  }
  // each segment wound so local +Z faces the room interior:
  cornice(TALL_FACE, FR_Z1, TALL_FACE, PAN_Z0 - inch(0.8));      // tall fronts -> +X
  cornice(W_UP_FACE, FR_Z1, TALL_FACE, FR_Z1);                   // jog -> +Z
  cornice(W_UP_FACE, Z1 - UP_D, W_UP_FACE, FR_Z1);               // west uppers -> +X
  cornice(28.27, S_UP_FACE, W_UP_FACE, S_UP_FACE);               // south run -> -Z
  cornice(E_UP_FACE, S_UP_FACE - 1.2, 28.27, S_UP_FACE);         // diagonal -> NW
  cornice(E_UP_FACE, 23.3, E_UP_FACE, S_UP_FACE - 1.2);          // east return -> -X
  cornice(TALL_FACE, PAN_Z0 - inch(0.8), X0 + 0.05, PAN_Z0 - inch(0.8)); // north cap -> -Z

  /* ---------------------------------------------------------------------- */
  /* ISLAND                                                                  */
  /* ---------------------------------------------------------------------- */
  {
    const w = ISL_W, d = ISL_D;
    const g = new THREE.Group();
    g.position.set(ISL_CX, 0, ISL_CZ);

    const tk = kit.box(w - 0.5, CAB.toeH, d - 0.5, toe, { r: inch(0.03) });
    tk.position.y = CAB.toeH / 2;
    g.add(tk);
    const body = kit.box(w - 0.06, BASE_H - CAB.toeH, d - 0.06, cherry, { r: inch(0.05) });
    body.position.y = CAB.toeH + (BASE_H - CAB.toeH) / 2;
    applyUV(body);
    g.add(body);

    const faceH = BASE_H - CAB.toeH;
    const faceY = CAB.toeH + faceH / 2;

    // panelled faces: north (3), east end (1), west end (1)
    function panelFace(len, count, yawR, off) {
      const holder = new THREE.Group();
      holder.rotation.y = yawR;
      holder.position.set(off * Math.sin(yawR), faceY, off * Math.cos(yawR));
      const stile = inch(3.2);
      const skinT = inch(0.62);
      const each = (len - inch(0.5)) / count;
      const rects = [];
      for (let i = 0; i < count; i++) {
        const cx2 = -len / 2 + inch(0.25) + each * (i + 0.5);
        rects.push([cx2 - each / 2 + stile, -faceH / 2 + stile,
          cx2 + each / 2 - stile, faceH / 2 - stile]);
      }
      const skin = kit.plateWithHoles(len, faceH, rects, skinT, cherry, { bevel: inch(0.06) });
      holder.add(skin);
      for (const [xa, ya, xb, yb] of rects) {
        holder.add(kit.stickingRing(xa, ya, xb, yb, skinT, inch(0.02), inch(0.9), cherry));
      }
      g.add(holder);
    }
    panelFace(w, 3, Math.PI, d / 2);      // north long face
    panelFace(d, 1, HALFPI, w / 2);       // east end
    panelFace(d, 1, -HALFPI, w / 2);      // west end

    // SOUTH working face: two 3-drawer stacks, microwave bay, closing panel
    {
      const holder = new THREE.Group();
      holder.position.set(0, 0, d / 2 - 0.85);   // faces +Z (south); no yaw
      for (const cx2 of [-w / 2 + 0.9, -w / 2 + 2.6]) {
        const st = kit.baseCabinet({
          w: 1.68, d: 0.91, doors: 0, drawers: 3,
          style: RAISED, material: cherry, pulls: BASE_PULLS, toeMaterial: toe,
        });
        st.position.set(cx2, 0, 0);
        holder.add(st);
      }
      // microwave bay at the east portion
      const MW_CX = w / 2 - 1.95, MW_W = 2.05;
      const mw = kit.microwave({ w: MW_W, d: 1.5, h: 1.32 });
      mw.position.set(MW_CX, 1.05, -0.62);
      holder.add(mw);
      const dr = kit.raisedDoorPanel(MW_W - inch(0.3), 0.62, { material: cherry });
      dr.position.set(MW_CX, CAB.toeH + 0.34, 0.85);
      const dpl = kit.pull(BASE_PULLS, inch(7));
      dpl.position.set(0, 0, inch(0.72));
      dr.add(dpl);
      holder.add(dr);
      const fill = kit.box(MW_W, BASE_H - 1.05 - 1.32, inch(0.7), cherry, { r: inch(0.04) });
      fill.position.set(MW_CX, (1.05 + 1.32 + BASE_H) / 2, 0.85);
      holder.add(fill);
      // closing panel east of the microwave
      const cpW = w / 2 - (MW_CX + MW_W / 2) - 0.05;
      const cp = kit.raisedDoorPanel(cpW, faceH - inch(0.4), { material: cherry });
      cp.position.set(MW_CX + MW_W / 2 + cpW / 2 + 0.02, faceY, 0.85);
      holder.add(cp);
      g.add(holder);
    }

    // beige 2-gang outlet on the EAST end panel
    {
      const dev = kit.decoraDevice({
        kind: 'outlet', gangs: 2, plateColor: 0xd8cdbb, deviceColor: 0xd8cdbb,
      });
      dev.position.set(w / 2 + inch(0.75), 2.17, 0.3);
      dev.rotation.y = HALFPI;
      g.add(dev);
    }

    // top: built-up edge; flush 3/4" lip, 10" overhang on the east end
    const topW = w + ISL_LIP + ISL_OVER_E;
    const top = kit.box(topW, ISL_TOP_T, d + 2 * ISL_LIP, quartz, { r: inch(0.09), seg: 2 });
    top.position.set((ISL_OVER_E - ISL_LIP) / 2, BASE_H + ISL_TOP_T / 2, 0);
    applyUV(top, [5, 3.2], { axes: 'xz' });
    g.add(top);

    group.add(g);
  }

  /* ---------------------------------------------------------------------- */
  /* SINK + FAUCET                                                           */
  /* ---------------------------------------------------------------------- */
  {
    const sink = kit.undermountSink({ bowls: 1, w: 2.2, d: 1.45 });
    sink.position.set((SINK_X0 + SINK_X1) / 2, CTR_TOP, Z1 - 1.2);
    group.add(sink);
    const fct = kit.faucet({
      style: 'commercial', finish: 'black', accent: 'brass',
      height: inch(15.5), reach: inch(8.5), r: inch(0.6),
    });
    fct.position.set((SINK_X0 + SINK_X1) / 2, CTR_TOP, Z1 - 0.35);
    fct.rotation.y = Math.PI;
    group.add(fct);
  }

  /* ---------------------------------------------------------------------- */
  /* ELECTRICAL DEVICES                                                      */
  /* ---------------------------------------------------------------------- */
  const OUT_Y = 3.67;
  function southOutlet(x, o = {}) {
    const dev = kit.decoraDevice(Object.assign({ kind: 'outlet', gangs: 1 }, o));
    dev.rotation.z = HALFPI + (o.tilt || 0);   // horizontal on the backsplash
    dev.position.set(x, OUT_Y, Z1 - SLAB_T - inch(0.12));
    dev.rotation.y = Math.PI;
    group.add(dev);
    return dev;
  }
  southOutlet(26.5, { tilt: deg(0.8) });   // the off-plumb one
  southOutlet(22.5);
  southOutlet(18.9);
  {
    const sw = kit.decoraDevice({ kind: 'switch', gangs: 2 });
    sw.position.set(15.0, OUT_Y, Z1 - SLAB_T - inch(0.12));
    sw.rotation.y = Math.PI;
    group.add(sw);
  }
  {
    const d1 = kit.decoraDevice({ kind: 'outlet', gangs: 1 });
    d1.rotation.z = HALFPI;
    d1.position.set(X0 + SLAB_T + inch(0.12), OUT_Y, 25.3);
    d1.rotation.y = HALFPI;
    group.add(d1);
    const d2 = kit.decoraDevice({ kind: 'outlet', gangs: 1 });
    d2.rotation.z = HALFPI;
    d2.position.set(X1 - SLAB_T - inch(0.12), OUT_Y, 24.3);
    d2.rotation.y = -HALFPI;
    group.add(d2);
  }
  {
    const sw = kit.decoraDevice({ kind: 'switch', gangs: 2 });
    sw.position.set(X1 - inch(0.1), 3.83, 19.2);
    sw.rotation.y = -HALFPI;
    group.add(sw);
  }
  {
    const blank = kit.decoraDevice({ kind: 'blank', gangs: 1 });
    blank.position.set(23.1, CEIL_Y - inch(0.05), 22.4);
    blank.rotation.x = HALFPI;
    group.add(blank);
  }

  /* ---------------------------------------------------------------------- */
  /* LIGHTING — every fixture ON                                             */
  /* ---------------------------------------------------------------------- */
  const preset = lights.lightPreset ? lights.lightPreset('first') : null;
  const canCfg = (preset && preset.can) || {};

  const CANS = [
    [16.1, 25.35], [20.5, 25.6], [24.9, 25.3],
    [16.5, 21.2], [27.1, 23.4], [16.3, 18.3],
  ];
  for (const [cx, cz] of CANS) {
    const can = lights.recessedCan([cx, CEIL_Y, cz], {
      intensity: canCfg.intensity === undefined ? 46 : canCfg.intensity,
      temp: canCfg.temp || 2900,
      apertureIn: 6, trimIn: 7.2,
      castShadow: false,
      quality: ctx.quality,
    });
    group.add(can);
  }

  for (const px of [ISL_CX - 1.65, ISL_CX + 1.65]) {
    const p = kit.pendantBlackShadeBrassChain({ dropLen: 2.75, shadeD: 1.05 });
    p.position.set(px, CEIL_Y, ISL_CZ);
    group.add(p);
    const pl = new THREE.PointLight(0xffdcae, 13, 0, 2);
    pl.position.set(px, CEIL_Y - 2.55, ISL_CZ);
    pl.castShadow = false;
    group.add(pl);
  }

  const ucInt = (preset && preset.underCabinet && preset.underCabinet.intensity) || 3.0;
  const UC = [
    // corner door west of the sink
    { center: [(W_UP_FACE + SINK_X0) / 2, UP_BOT - 0.03, Z1 - 0.55],
      width: SINK_X0 - W_UP_FACE - 0.1, depth: 0.5 },
    // sink valance strip
    { center: [(SINK_X0 + SINK_X1) / 2, 4.9, Z1 - 0.5],
      width: SINK_X1 - SINK_X0 - 0.2, depth: 0.42 },
    // sink -> hood
    { center: [(SINK_X1 + RANGE_CX - HOOD_W / 2) / 2, UP_BOT - 0.03, Z1 - 0.55],
      width: RANGE_CX - HOOD_W / 2 - SINK_X1 - 0.1, depth: 0.5 },
    // hood -> diagonal
    { center: [(RANGE_CX + HOOD_W / 2 + 28.27) / 2, UP_BOT - 0.03, Z1 - 0.55],
      width: 28.27 - (RANGE_CX + HOOD_W / 2) - 0.1, depth: 0.5 },
    // west run
    { center: [X0 + 0.55, UP_BOT - 0.03, (FR_Z1 + S_FACE) / 2],
      width: 0.5, depth: S_FACE - FR_Z1 - 0.25 },
    // east return
    { center: [X1 - 0.55, UP_BOT - 0.03, (23.3 + S_UP_FACE - 1.2) / 2],
      width: 0.5, depth: S_UP_FACE - 1.2 - 23.3 - 0.2 },
  ];
  for (const rect of UC) {
    group.add(lights.underCabinet(rect, { intensity: ucInt, glow: true, glowGain: 1.4 }));
  }
}

export default { meta, build };
