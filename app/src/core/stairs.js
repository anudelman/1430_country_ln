/**
 * app/src/core/stairs.js — the two flights, built from `dims.js` alone.
 *
 * `hallway_top_of_stairs_looking_down_at_front_door.png` is the reference for
 * the main flight and its balustrade:
 *
 *   - rift white-oak top rail, ~2-1/2" x 2", natural mid-brown
 *   - square oak newels ~4" x 4" with a chamfered flat cap and a neck reveal
 *   - black square metal balusters, 1/2", ~4-1/8" on centre, top-mounted
 *   - white painted skirt board and white painted balcony fascia
 *   - oak treads with a bullnose nosing, white risers
 *
 * The basement flight (STAIRS.basementToFirst) runs directly beneath the main
 * one and carries a white turned-spindle rail instead.
 *
 * ---------------------------------------------------------------------------
 * WHY THE FLIGHT IS BUILT WITH ONE FEWER TREAD THAN RISER
 * ---------------------------------------------------------------------------
 * A flight of N risers has N-1 treads: the Nth riser lands you on the FLOOR
 * ABOVE, and that floor is the last tread.  dims.js records that honestly
 * (15 risers / 14 treads for the main flight), so this module:
 *
 *   1. asks kit.straightStair for `treads` treads over `treads * riserH` of
 *      rise — which puts the last tread at 8.867 ft, NOT at the second floor;
 *   2. adds the final riser board and the second floor's own bullnose nosing.
 *
 * Getting this wrong by one is the classic stair bug: either the top tread
 * floats 7-5/8" below the floor, or a phantom tread juts out into the landing.
 * `assertFlush()` below re-derives it at build time.
 *
 * ---------------------------------------------------------------------------
 * API
 * ---------------------------------------------------------------------------
 *   buildStairs(ctx, opts?) -> THREE.Group
 *
 *   opts.levels   array of level keys being rendered; a flight is built when
 *                 either of its ends is in the list.  Default: both flights.
 *   opts.guards   false to leave the balustrades out (the shell builds the
 *                 balcony guard separately from VOIDS).
 *
 * The returned group carries `group.userData.flights`, a map of flight id ->
 * { group, topY, bottomY, nosingZ, rail }.
 */

import { LEVELS, STAIRS, GRID } from './dims.js';
import { inch, ft, TRIM } from './units.js';
import { applyUV } from './materials.js';

const F = GRID.first;

/** Balcony / stair baluster spacing measured off the listing photo. */
export const BALUSTER_SPACING = inch(4.125);
export const BALUSTER_W = inch(0.5);
export const NEWEL_W = inch(4.0);

/* ======================================================================== */
/* helpers                                                                   */
/* ======================================================================== */

function M(ctx, name, fallback) {
  const lib = ctx.mat;
  if (lib && name && lib[name]) return lib[name];
  if (lib && fallback && lib[fallback]) return lib[fallback];
  if (!ctx.__stairFallback) {
    ctx.__stairFallback = new ctx.THREE.MeshStandardMaterial({ color: 0xb9b3a8, roughness: 0.9 });
    ctx.__stairFallback.userData.keep = true;
  }
  return ctx.__stairFallback;
}

function scaleOf(material, dflt = 4) {
  const s = material && material.userData && material.userData.scaleFeet;
  return s ? [s[0], s[1]] : [dflt, dflt];
}

/**
 * Re-derive the flight from dims and throw if the geometry would not land
 * exactly on the level datum.  Cheap insurance against a one-off.
 */
function assertFlush(s) {
  const total = s.riserH * s.risers;
  const dy = Math.abs(s.bottomY + total - s.topY);
  if (dy > 1e-6) {
    throw new Error(
      `stairs: ${s.id} rises ${total.toFixed(4)} ft over ${s.risers} risers but the ` +
      `datums are ${s.bottomY} -> ${s.topY} (out by ${dy.toFixed(4)} ft)`
    );
  }
  if (s.treads !== s.risers - 1) {
    throw new Error(`stairs: ${s.id} has ${s.treads} treads for ${s.risers} risers`);
  }
  const run = Math.abs(s.treadD * s.treads - (s.well[3] - s.well[1]));
  if (run > 1e-6) throw new Error(`stairs: ${s.id} run ${run} ft off the well`);
}

/* ======================================================================== */
/* one flight                                                                */
/* ======================================================================== */

function buildFlight(ctx, s, opts) {
  const { THREE, kit } = ctx;
  assertFlush(s);

  const g = new THREE.Group();
  g.name = `stair:${s.id}`;

  const treadMat = M(ctx, 'redOakFloor');
  const riserMat = M(ctx, 'paintedOffWhite', 'wallPaintWhite');
  const oak = (kit && kit.materials && kit.materials.whiteOak) || treadMat;

  // ---- the flight itself ------------------------------------------------
  // treads * riserH of rise, NOT the full storey height: see the header.
  const flightRise = s.riserH * s.treads;
  const flight = kit.straightStair({
    rise: flightRise,
    treads: s.treads,
    run: s.treadD,
    width: s.width,
    treadMaterial: treadMat,
    riserMaterial: riserMat,
    skirt: true,
  });
  // dims ascends toward -Z; the kit ascends toward +Z.
  flight.position.set(s.bottom[0], s.bottomY, s.bottom[1]);
  flight.rotation.y = Math.PI;
  g.add(flight);

  // ---- the last riser, and the floor above acting as the top tread ------
  // Its face is flush with the floor edge at the head of the well.
  const topZ = s.top[1];                       // = well north edge
  const lastRiser = kit.box(s.width, s.riserH - inch(1.0), inch(0.75), riserMat,
    { r: inch(0.05), uv: true, uvOpts: { axes: 'xy', size: [s.width, s.riserH] } });
  lastRiser.position.set(s.bottom[0], s.topY - inch(1.0) - (s.riserH - inch(1.0)) / 2,
    topZ + inch(0.375));
  lastRiser.name = `stair:${s.id}:lastRiser`;
  g.add(lastRiser);

  // Bullnose nosing on the landing edge, overhanging the last riser.
  const noseD = s.nosing + inch(1.0);
  const nose = kit.box(s.width, inch(1.0), noseD, treadMat,
    { r: inch(0.14), seg: 3, uv: true, uvOpts: { axes: 'xz', size: [s.width, noseD] } });
  nose.position.set(s.bottom[0], s.topY - inch(0.5), topZ + s.nosing - noseD / 2);
  nose.name = `stair:${s.id}:landingNosing`;
  g.add(nose);

  // ---- balustrade on the open side --------------------------------------
  let rail = null;
  if (opts.guards !== false && s.guardSide) {
    const spindle = s.id === 'basementToFirst';
    const openX = s.guardSide === 'west' ? s.well[0] : s.well[2];
    const inward = s.guardSide === 'west' ? 1 : -1;
    const railX = openX + inward * inch(2.6);

    rail = kit.stairRailing({
      length: s.treads * s.treadD,
      rise: s.topY - s.bottomY - s.riserH,   // nosing line, first tread -> floor
      height: s.handrailY,
      style: spindle ? 'whiteSpindle' : 'whiteOakBlackSquare',
      spacing: spindle ? inch(5.0) : BALUSTER_SPACING,
      railMaterial: spindle ? undefined : oak,
    });
    // Anchor: the walking surface at the FIRST TREAD, not the lower floor.
    rail.position.set(railX, s.bottomY + s.riserH, s.bottom[1]);
    rail.rotation.y = Math.PI;
    rail.name = `stair:${s.id}:rail`;
    g.add(rail);
    // kit.stairRailing already stands a newel at each end of the run, and
    // kit.straightStair already runs a white skirt board 3/4" proud of BOTH
    // stringers — a second one here would only z-fight.
  }

  g.userData.flight = {
    id: s.id, topY: s.topY, bottomY: s.bottomY, nosingZ: topZ, rail,
  };
  return g;
}

/* ======================================================================== */
/* entry point                                                               */
/* ======================================================================== */

/**
 * Build every flight that touches one of `opts.levels`.
 * @param {object} ctx  room-module context ({THREE, kit, mat, ...})
 * @param {object} [opts] { levels, guards }
 * @returns {THREE.Group}
 */
export function buildStairs(ctx, opts = {}) {
  const { THREE, kit } = ctx;
  const root = new THREE.Group();
  root.name = 'shell:stairs';
  root.userData.flights = {};
  if (!kit) return root;

  const levels = opts.levels || Object.keys(LEVELS);
  for (const s of Object.values(STAIRS)) {
    if (!levels.includes(s.fromLevel) && !levels.includes(s.toLevel)) continue;
    let g;
    try {
      g = buildFlight(ctx, s, opts);
    } catch (err) {
      if (ctx.onWarn) ctx.onWarn(`stairs ${s.id}: ${(err && err.message) || err}`);
      continue;
    }
    g.traverse((n) => { if (n.isMesh) { n.castShadow = true; n.receiveShadow = true; } });
    root.add(g);
    root.userData.flights[s.id] = g.userData.flight;
  }
  return root;
}

export const meta = { id: 'stairs', title: 'Stairs', level: 'all' };
export default buildStairs;
