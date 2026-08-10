// app/src/core/dims.js
//
// 1430 COUNTRY LN — AUTHORITATIVE GEOMETRY TABLE.
// Everything else in the walkthrough derives from this file. Nothing here is
// decorative: if a number is wrong, the whole house is wrong.
//
// ---------------------------------------------------------------------------
// COORDINATE SYSTEM  (docs/CONVENTIONS.md §1)
// ---------------------------------------------------------------------------
//   1 unit = 1 foot.  Y up.  Y = 0 = first-floor finished floor.
//   +X = plan-right (east).   +Z = plan-down = TOWARD THE STREET (south).
//   Front (street) facade faces +Z; back yard is at -Z.
//
//   ORIGIN: X = 0 is the OUTSIDE face of the west (plan-left) exterior wall of
//   the main house block.  Z = 0 is the OUTSIDE face of the north (rear)
//   exterior wall of the family-room / breakfast-nook block — the part of the
//   rear elevation that projects furthest into the back yard (the two-storey
//   glass wall in backyard_straight_on_view_of_house.png).
//   The house therefore lives in X >= 0, Z >= 0; the back yard is negative Z
//   and the front lawn / street is Z > 45.
//
//   ORIENTATION SANITY CHECK.  Standing on the street looking at the house you
//   look along -Z, so screen-right = +X = plan-right.  On
//   floorplan_first_floor.png the garage is at plan-right/plan-down, and in
//   straight_on_view_of_house_from_street.png the garage is on the right ->
//   garage at large X, large Z.  Confirmed.  The two-storey mass with the round
//   porthole window sits over the entry, between the bedroom wing and the
//   single-storey garage wing.
//
// ---------------------------------------------------------------------------
// PIECE ID  vs  DIMS ROOM ID   (CONVENTIONS.md §0.1)
// ---------------------------------------------------------------------------
//   The listing PHOTO filenames are swapped against the floor-plan labels for
//   two rooms, and piece ids follow the photo names.  This table uses the
//   FLOOR-PLAN labels, so:
//
//     piece `family`  (family_room_1/2/3.png)  ->  ROOMS.livingRoom   18'11" x 18'2"
//     piece `living`  (view_from_kitchen_...)  ->  ROOMS.familyRoom   12'1"  x 19'8"
//
//   Do not "fix" either side — just pick the right dims room.
//
// ---------------------------------------------------------------------------
// ROOM RECTANGLES ARE CLEAR (INSIDE-FACE TO INSIDE-FACE) DIMENSIONS
// ---------------------------------------------------------------------------
//   `size` is the dimension printed on the listing floor plan, [E-W, N-S].
//   For a rectangular room `rect` = [x0, z0, x1, z1] and its size matches
//   exactly.  For a room whose plan shape is notched / angled / bayed, `poly`
//   is given instead and the poly's BOUNDING BOX matches `size` — that is how
//   the plan's dimension string is measured.  tools/check_dims.mjs enforces it.
//
//   `hidden: true` marks unlabelled service volumes (closets, chases, pantry
//   runs, poche behind angled walls, stair wells).  They exist so each level
//   tiles cleanly; they carry no printed dimension.
//
// ---------------------------------------------------------------------------
// WALLS
// ---------------------------------------------------------------------------
//   { id, a:[x,z], b:[x,z], level, t, h, align, kind }
//   align:'center' (default, interior partitions) -> the wall straddles a->b.
//   align:'outer'  (exterior shells)             -> a->b is the OUTSIDE face and
//                                                   the wall grows inward, i.e.
//                                                   toward segNormal(a, b).
//   Footprint polygons are wound clockwise in plan (x right, z down) so the
//   inward side is consistently the left-hand normal.
//
// ---------------------------------------------------------------------------
// OPENINGS
// ---------------------------------------------------------------------------
//   { wall, type, center, w, h, sill, swing, note }
//   `center` = distance in feet along the host wall measured from its point a.
//   `sill`   = height above that level's finished floor (0 for doors).
//   `swing`  = 'left-in' | 'right-in' | 'left-out' | 'right-out' | 'slide' |
//              'bifold' | 'pocket' | 'roll-up' | 'cased' (no leaf) | null.

import {
  ft,
  inch,
  rectPoly,
  polyArea,
  polyBBox,
  bboxCenter,
  bboxSize,
} from './units.js';

/* =================================================================== */
/* 1. LEVELS / HEIGHTS / WALL THICKNESS                                */
/* =================================================================== */

export const LEVELS = { basement: -9.0, first: 0.0, second: 9.5 };

// basement 7.49 is MEASURED from basement_view_*.png (docs/PHOTOGRAPHY.md), not assumed.
// second 8.00 was measured and confirmed exactly.
export const CEIL = { basement: 7.49, first: 8.5, second: 8.0 };

/** Absolute Y of each ceiling plane. */
export const CEIL_Y = {
  basement: LEVELS.basement + CEIL.basement, // -1.25
  first: LEVELS.first + CEIL.first, //  8.50
  second: LEVELS.second + CEIL.second, // 17.50
};

export const WALL = {
  ext: 0.55, //  6-5/8"  framed exterior wall
  int: 0.375, //  4-1/2"  interior partition
  plumb: 0.54, //  6-1/2"  plumbing / chase wall
  found: 0.83, // 10"      poured foundation wall (basement)
  fire: 0.55, //  garage separation wall
};

/** Floor / ceiling assembly depths, used by shell.js. */
export const ASSEMBLY = {
  floorJoist: 1.0, // 8.50 first ceiling -> 9.50 second floor
  slabT: 0.42,
  roofDeck: 0.5,
  fasciaH: 1.5,
  soffitT: 0.25,
};

export const LEVEL_KEYS = ['basement', 'first', 'second'];

/* =================================================================== */
/* 2. PLAN GRID LINES                                                  */
/*    Derived once here and reused everywhere, so the plan can only     */
/*    ever be self-consistent.                                          */
/* =================================================================== */

// ---------------- first floor --------------------------------------------
const F = {
  // X, west -> east
  xW0: 0.0, //   west exterior, outside face
  xW: 0.55, //   west exterior, inside face
  xFamE: 12.633, //   0.55 + 12'1"  (family / nook are one open volume)
  xLdyE: 12.717, //   0.55 + 12'2"  laundry east inside face
  xKitW: 13.133,
  xNookE: 26.55, //  12.633 + 13'11"
  xDinW: 26.925,
  xKitE: 30.55, //  13.133 + 17'5"
  xHallW: 30.925,
  xDinE: 40.842, //  26.925 + 13'11"   (also the centre hall's east face)
  xLivW: 41.217,
  xGarWo: 39.667, //  garage separation wall, west face
  xGarW: 40.217, //  garage separation wall, east face = garage inside
  xLivE: 60.134, //  41.217 + 18'11"
  xE0: 60.684, //  east exterior, outside face
  xBedE: 17.8, //   0.55 + 17'3"
  xBthW: 18.175,
  xBthE: 23.508, //  18.175 + 5'4"
  xClsW: 23.883,
  xClsE: 26.875,
  xFoyW: 27.25, //  39.667 - 12'5"
  xFoyE: 39.667,
  xVestE: 5.375,
  xH21W: 5.75, //  hall 21'6" west face
  xH21E: 27.25, //   5.75 + 21'6"
  xStrW: 36.167, //  stair well, 3'-6" clear
  xStrE: 39.667,
  xWetW: 53.634, //  wet-bar alcove
  xWetE: 60.134,
  xGarNotchW: 53.259,

  // Z, rear -> street
  zN0: 0.0, //  rear exterior outside face (family/nook block)
  zN: 0.55,
  zFamS: 20.217, //   0.55 + 19'8"
  zLdyN: 20.592,
  zNookS: 16.633, //   0.55 + 16'1"
  zKitN: 18.176, //  pantry / servery run between nook and kitchen
  zKitS: 28.509, //  18.176 + 10'4"   (== laundry south, 20.592 + 7'11")
  zH21N: 28.884,
  zH21S: 32.551, //  28.884 + 3'8"
  zBedN: 32.926,
  zBedS: 44.593, //  32.926 + 11'8"  == main front wall inside face
  zFront0: 45.143, //  main front wall outside face
  zLinN: 32.926,
  zLinS: 35.385,
  zBthN: 35.76, //  bath 5'4" x 8'10", pushed to the front wall
  zBthS: 44.593,
  zDinS: 11.467, //   0.55 + 10'11"
  zH9N: 11.842,
  zH9S: 28.175, //  11.842 + 16'4"
  zFoyN: 28.592,
  zFoyS: 41.759, //  28.592 + 13'2"  == recessed entry wall inside face
  zRec0: 42.309, //  recessed entry wall outside face — porch is 2'-10" deep
  zLivN0: 4.493, //  living-room wing is set back from the family block
  zLivN: 5.043,
  zLivS: 23.21, //   5.043 + 18'2"
  zGarN: 23.76,
  zGarS: 44.593, //  23.76 + 20'10"
  zStrN: 26.258, //  stair well
  zStrS: 38.758,
  zWetS: 26.21,
  zGarNotchS: 26.585,
};

// ---------------- second floor -------------------------------------------
const S = {
  xW0: 0.0,
  xW: 0.55,
  xBiE: 1.625, //  primary-bedroom built-in (media / wardrobe run) east face
  xSunW: 1.625,
  xPbdE: 13.208, //   1.625 + 11'7"
  xPbaW: 13.583,
  xPbaE: 26.5, //  13.583 + 12'11"
  xSunE: 26.375, //   1.625 + 24'9"
  xWcW: 23.5, //  26.5 - 3'0"
  xWicE: 27.5, //  13.583 + 13'11"
  xLinW: 26.875, //  upper-hall linen
  xBrNW: 27.25,
  xHeW: 28.25, //  39.667 - 11'5"
  xE: 39.667, //  east inside face (sits on the 1st-floor garage wall)
  xE0: 40.217, //  east outside face
  xNStep: 26.925, //  where the rear wall steps back 3'-6"
  xSwbE: 11.383, //   0.55 + 10'10"
  xBthW: 11.758,
  xBthE: 16.925, //  11.758 + 5'2"
  xSbdW: 17.3,
  xSbdE: 30.467, //  17.3 + 13'2"
  xVoidW: 30.842,
  xHallE: 22.55, //   0.55 + 22'0"
  xLandW: 22.925,
  xLandNW: 27.875, //  north leg of the landing, east of the W.I.C. wall

  zN0: 0.0,
  zN: 0.55,
  zNE0: 3.5, //  rear wall of the east half steps back (shed roof over
  zNE: 4.05, //  the dining-room bay below)
  zSunS: 5.467, //   0.55 + 4'11"
  zPbdN: 5.842,
  zPbdS: 27.425, //   5.842 + 21'7"
  zPbaS: 19.592, //   5.842 + 13'9"
  zWcS: 10.592, //   5.842 + 4'9"
  zWicN: 19.967,
  zWicS: 27.467, //  19.967 + 7'6"
  zBrNS: 16.8, //   4.05 + 12'9"
  zLinN: 17.175,
  zLinS: 19.592,
  zHeN: 17.175,
  zHeS: 26.258, //  17.175 + 9'1" — lands exactly on the stair head
  zHallN: 27.842,
  zHallS: 31.009, //  27.842 + 3'2"
  zSouthN: 31.426,
  zSouthS: 44.593, //  31.426 + 13'2"
  zBthAN: 31.426,
  zBthAS: 38.843, //  31.426 + 7'5"
  zBthBN: 39.093,
  zBthBS: 44.593, //  39.093 + 5'6"
  zBiS: 22.0, //  built-in run stops short of the west window
  zFront0: 45.143,
};

// ---------------- basement ----------------------------------------------
const B = {
  xW0: 0.0,
  xW: 0.83,
  xNwE: 12.33, //  storage + gym share the west bay
  xMechW: 12.705,
  xMechE: 19.25,
  xUtlW: 19.625,
  xNotchW: 26.925, //  un-excavated NE corner, outside face
  xNotchWi: 26.095, //   ... inside face
  xUtlStepE: 32.361, //  utility narrows south of the mech room
  xStgSW: 32.736,
  xStgSE: 35.012,
  xBthW: 35.387,
  xBthE: 40.387, //  east inside face
  xE0: 41.217,
  xRecE: 37.913, //   0.83 + 37'1"
  xStrEnclW: 35.792,
  xStrW: 36.167,
  xStrE: 39.667,

  zN0: 0.0,
  zN: 0.83,
  zNotchS: 3.5, //  matches the second floor's rear set-back
  zNotchSi: 4.33,
  zStgNS: 11.73,
  zGymN: 12.105,
  zGymS: 23.855, //  12.105 + 11'9"
  zUtlStep: 16.625,
  zBthN: 17.0,
  zBthS: 24.0, //  17.0 + 7'0"
  zUtlS: 23.855,
  zRecN: 24.23,
  zRecS: 44.313, //  24.23 + 20'1"
  zS0: 45.143,
  zStrEnclN: 25.758,
  zStrN: 26.258,
  zStrS: 38.758,
};

export const GRID = { first: F, second: S, basement: B };

/* =================================================================== */
/* 3. LEVEL FOOTPRINTS (outside face of the shell, wound CW in plan)   */
/* =================================================================== */

export const FOOTPRINTS = {
  // Main block + one-storey living-room wing (NE) + one-storey garage (SE),
  // with the entry porch recessed 2'-10" between the bedroom wing and garage.
  first: [
    [0.0, 0.0],
    [F.xLivW, 0.0],
    [F.xLivW, F.zLivN0],
    [F.xE0, F.zLivN0],
    [F.xE0, F.zFront0],
    [F.xGarWo, F.zFront0],
    [F.xGarWo, F.zRec0],
    [F.xFoyW, F.zRec0],
    [F.xFoyW, F.zFront0],
    [0.0, F.zFront0],
  ],
  // Second floor stops short of the living-room wing and the garage; its NE
  // quarter steps 3'-6" back from the rear wall (shed roof over the dining bay).
  second: [
    [0.0, 0.0],
    [S.xNStep, 0.0],
    [S.xNStep, S.zNE0],
    [S.xE0, S.zNE0],
    [S.xE0, S.zFront0],
    [0.0, S.zFront0],
  ],
  // Basement is under the main block only — never under the garage or the
  // one-storey living-room wing; the dining-bay corner is un-excavated.
  basement: [
    [0.0, 0.0],
    [B.xNotchW, 0.0],
    [B.xNotchW, B.zNotchS],
    [B.xE0, B.zNotchS],
    [B.xE0, B.zS0],
    [0.0, B.zS0],
  ],
};

/**
 * Where the second floor legitimately is NOT over the first floor.
 * The street photos show the second storey (the box carrying the round
 * porthole window) cantilevering forward over the recessed entry porch; a
 * dark-stained post at the porch corner picks up the beam.
 */
export const SECOND_FLOOR_EXCEPTIONS = [
  {
    id: 'entryOversail',
    note:
      "Two-storey entry box oversails the recessed entry porch by 2'-10\"; the " +
      'round porthole window sits in this wall. See exterior_view_of_front_door.png ' +
      'and straight_on_view_of_house_from_street.png.',
    poly: rectPoly([F.xFoyW, F.zRec0, F.xGarWo, F.zFront0]),
  },
];

/* =================================================================== */
/* 4. ROOMS                                                            */
/* =================================================================== */

export const ROOMS = {
  /* ------------------------------- FIRST ------------------------------ */

  familyRoom: {
    level: 'first',
    label: 'Family Room',
    size: [12.083, 19.667], // 12'1" x 19'8"
    rect: [F.xW, F.zN, F.xFamE, F.zFamS],
    piece: 'living',
    notes:
      'Open to the breakfast nook; two-storey rear glass wall behind it; white boxed ' +
      'column mid-room. NO threshold at the kitchen opening — this room is NOT sunken.',
  },

  breakfastNook: {
    level: 'first',
    label: 'Breakfast Nook',
    size: [13.917, 16.083], // 13'11" x 16'1"
    rect: [F.xFamE, F.zN, F.xNookE, F.zNookS],
    notes: 'Open to the family room (west) and the kitchen (south).',
  },

  kitchen: {
    level: 'first',
    label: 'Kitchen',
    size: [17.417, 10.333], // 17'5" x 10'4"
    rect: [F.xKitW, F.zKitN, F.xKitE, F.zKitS],
  },

  diningRoom: {
    level: 'first',
    label: 'Dining Room',
    size: [13.917, 10.917], // 13'11" x 10'11"
    // Octagonal room: all four corners clipped at 45deg with a 2'-6" leg.
    poly: [
      [F.xDinW + 2.5, F.zN],
      [F.xDinE - 2.5, F.zN],
      [F.xDinE, F.zN + 2.5],
      [F.xDinE, F.zDinS - 2.5],
      [F.xDinE - 2.5, F.zDinS],
      [F.xDinW + 2.5, F.zDinS],
      [F.xDinW, F.zDinS - 2.5],
      [F.xDinW, F.zN + 2.5],
    ],
  },

  livingRoom: {
    level: 'first',
    label: 'Living Room',
    size: [18.917, 18.167], // 18'11" x 18'2"
    // NE corner cut at 45deg for the angled gas fireplace + stone surround.
    poly: [
      [F.xLivW, F.zLivN],
      [F.xLivE - 5.5, F.zLivN],
      [F.xLivE, F.zLivN + 5.5],
      [F.xLivE, F.zLivS],
      [F.xLivW, F.zLivS],
    ],
    piece: 'family',
    // DETAILS.md: `family` (this room) is SUNKEN one ~7" step below the
    // kitchen/hall level — white painted riser, oak bullnose tread, and the
    // baseboard steps with it. The ceiling stays at the first-floor plane, so
    // the clear height here is 9'-1".
    floorOffset: -inch(7),
    notes:
      'Corner dry-stacked ledgestone fireplace with a black round flue; wet-bar alcove ' +
      'off the SE corner; sunken one step from the hall.',
  },

  hallCenter: {
    level: 'first',
    label: 'Hall',
    size: [9.917, 16.333], // 9'11" x 16'4"
    // Steps in where the garage wall takes over from the living-room wall,
    // then the stair well eats the SE corner.
    poly: [
      [F.xHallW, F.zH9N],
      [F.xDinE, F.zH9N],
      [F.xDinE, F.zLivS],
      [F.xGarWo, F.zLivS],
      [F.xGarWo, F.zStrN],
      [F.xStrW, F.zStrN],
      [F.xStrW, F.zH9S],
      [F.xHallW, F.zH9S],
    ],
  },

  hallKitchen: {
    level: 'first',
    label: 'Hall',
    size: [21.5, 3.667], // 21'6" x 3'8"
    rect: [F.xH21W, F.zH21N, F.xH21E, F.zH21S],
  },

  foyer: {
    level: 'first',
    label: 'Foyer',
    size: [12.417, 13.167], // 12'5" x 13'2"
    // The stair well occupies the NE corner of the foyer's bounding box.
    poly: [
      [F.xFoyW, F.zFoyN],
      [F.xStrW, F.zFoyN],
      [F.xStrW, F.zStrS],
      [F.xFoyE, F.zStrS],
      [F.xFoyE, F.zFoyS],
      [F.xFoyW, F.zFoyS],
    ],
    notes: 'Two storeys tall — open to the second-floor hall (see VOIDS).',
  },

  laundry: {
    level: 'first',
    label: 'Laundry',
    size: [12.167, 7.917], // 12'2" x 7'11"
    rect: [F.xW, F.zLdyN, F.xLdyE, F.zKitS],
    notes: 'Doubles as the mudroom off the hall; side-by-side washer/dryer.',
  },

  bedroom1: {
    level: 'first',
    label: 'Bedroom',
    size: [17.25, 11.667], // 17'3" x 11'8"
    rect: [F.xW, F.zBedN, F.xBedE, F.zBedS],
  },

  bath1: {
    level: 'first',
    label: 'Bath',
    size: [5.333, 8.833], // 5'4" x 8'10"
    rect: [F.xBthW, F.zBthN, F.xBthE, F.zBthS],
  },

  garage: {
    level: 'first',
    label: 'Garage',
    size: [19.917, 20.833], // 19'11" x 20'10"
    // NW corner is notched by the living room's wet-bar alcove.
    poly: [
      [F.xGarW, F.zGarN],
      [F.xGarNotchW, F.zGarN],
      [F.xGarNotchW, F.zGarNotchS],
      [F.xLivE, F.zGarNotchS],
      [F.xLivE, F.zGarS],
      [F.xGarW, F.zGarS],
    ],
    shellOnly: true,
    excludeFromLivingArea: true,
  },

  // --- unlabelled first-floor service volumes -------------------------
  pantryRun: {
    level: 'first',
    label: 'Pantry / servery run',
    hidden: true,
    rect: [F.xKitW, F.zNookS, F.xKitE, F.zKitN],
    notes: 'Tall pantry + built-in refrigerator wall between nook and kitchen.',
  },
  nookPassage: {
    level: 'first',
    label: 'Passage',
    hidden: true,
    rect: [F.xDinW, F.zH9N, F.xKitE, F.zNookS],
    notes: 'Opening from breakfast nook / kitchen through to the centre hall.',
  },
  foyerClosets: {
    level: 'first',
    label: 'Closets',
    hidden: true,
    rect: [F.xClsW, F.zBedN, F.xClsE, F.zBedS],
  },
  bathLinen: {
    level: 'first',
    label: 'Linen',
    hidden: true,
    rect: [F.xBthW, F.zLinN, F.xBthE, F.zLinS],
  },
  bedroomVestibule: {
    level: 'first',
    label: 'Vestibule / closet',
    hidden: true,
    rect: [F.xW, F.zH21N, F.xVestE, F.zH21S],
  },
  wetBar: {
    level: 'first',
    label: 'Wet Bar',
    hidden: true,
    rect: [F.xWetW, F.zLivS, F.xWetE, F.zWetS],
    floorOffset: -inch(7), // part of the sunken living room
    notes: 'Alcove off the living room, tucked into the garage NW corner.',
  },
  stairWellFirst: {
    level: 'first',
    label: 'Stair',
    hidden: true,
    rect: [F.xStrW, F.zStrN, F.xStrE, F.zStrS],
  },
  // Poche: framed triangles behind the angled walls. Never entered, but they
  // are real volume and they make the level tile.
  pocheDinNW: {
    level: 'first',
    label: 'Poche',
    hidden: true,
    poche: true,
    poly: [
      [F.xDinW, F.zN],
      [F.xDinW + 2.5, F.zN],
      [F.xDinW, F.zN + 2.5],
    ],
  },
  pocheDinNE: {
    level: 'first',
    label: 'Poche',
    hidden: true,
    poche: true,
    poly: [
      [F.xDinE - 2.5, F.zN],
      [F.xDinE, F.zN],
      [F.xDinE, F.zN + 2.5],
    ],
  },
  pocheDinSE: {
    level: 'first',
    label: 'Poche',
    hidden: true,
    poche: true,
    poly: [
      [F.xDinE, F.zDinS - 2.5],
      [F.xDinE, F.zDinS],
      [F.xDinE - 2.5, F.zDinS],
    ],
  },
  pocheDinSW: {
    level: 'first',
    label: 'Poche',
    hidden: true,
    poche: true,
    poly: [
      [F.xDinW, F.zDinS - 2.5],
      [F.xDinW + 2.5, F.zDinS],
      [F.xDinW, F.zDinS],
    ],
  },
  fireplaceChase: {
    level: 'first',
    label: 'Fireplace chase',
    hidden: true,
    poche: true,
    poly: [
      [F.xLivE - 5.5, F.zLivN],
      [F.xLivE, F.zLivN],
      [F.xLivE, F.zLivN + 5.5],
    ],
    notes: 'Firebox, stone surround and flue behind the angled living-room wall.',
  },

  /* ------------------------------ SECOND ------------------------------ */

  primaryBedroom: {
    level: 'second',
    label: 'Primary Bedroom',
    size: [11.583, 21.583], // 11'7" x 21'7"
    rect: [S.xBiE, S.zPbdN, S.xPbdE, S.zPbdS],
  },

  primaryBath: {
    level: 'second',
    label: 'Primary Bath',
    size: [12.917, 13.75], // 12'11" x 13'9"
    // The 3'0" x 4'9" water closet is carved out of the NE corner.
    poly: [
      [S.xPbaW, S.zPbdN],
      [S.xWcW, S.zPbdN],
      [S.xWcW, S.zWcS],
      [S.xPbaE, S.zWcS],
      [S.xPbaE, S.zPbaS],
      [S.xPbaW, S.zPbaS],
    ],
  },

  primaryWC: {
    level: 'second',
    label: 'Bath',
    size: [3.0, 4.75], // 3'0" x 4'9"
    rect: [S.xWcW, S.zPbdN, S.xPbaE, S.zWcS],
  },

  sunroom: {
    level: 'second',
    label: 'Sunroom',
    size: [24.75, 4.917], // 24'9" x 4'11"
    rect: [S.xSunW, S.zN, S.xSunE, S.zSunS],
    notes:
      'Glazed strip wrapping the rear of the primary suite, bedroom -> bath. ' +
      'It is the upper half of the two-storey glass wall in the backyard photos.',
  },

  wic: {
    level: 'second',
    label: 'W.I.C.',
    size: [13.917, 7.5], // 13'11" x 7'6"
    rect: [S.xPbaW, S.zWicN, S.xWicE, S.zWicS],
  },

  bedroom2: {
    level: 'second',
    label: 'Bedroom',
    size: [12.417, 12.75], // 12'5" x 12'9"
    rect: [S.xBrNW, S.zNE, S.xE, S.zBrNS],
    notes: 'NE bedroom, over the dining room.',
  },

  bedroom3: {
    level: 'second',
    label: 'Bedroom',
    size: [13.167, 13.167], // 13'2" x 13'2"
    rect: [S.xSbdW, S.zSouthN, S.xSbdE, S.zSouthS],
  },

  bedroom4: {
    level: 'second',
    label: 'Bedroom',
    size: [10.833, 13.167], // 10'10" x 13'2"
    rect: [S.xW, S.zSouthN, S.xSwbE, S.zSouthS],
  },

  bath2: {
    level: 'second',
    label: 'Bath',
    size: [5.167, 7.417], // 5'2" x 7'5"
    rect: [S.xBthW, S.zBthAN, S.xBthE, S.zBthAS],
  },

  bath3: {
    level: 'second',
    label: 'Bath',
    size: [5.167, 5.5], // 5'2" x 5'6"
    rect: [S.xBthW, S.zBthBN, S.xBthE, S.zBthBS],
  },

  hallUpperEast: {
    level: 'second',
    label: 'Hall',
    size: [11.417, 9.083], // 11'5" x 9'1"
    rect: [S.xHeW, S.zHeN, S.xE, S.zHeS],
    notes: 'Top of the stair; overlooks the two-storey foyer.',
  },

  hallUpper: {
    level: 'second',
    label: 'Hall',
    size: [22.0, 3.167], // 22'0" x 3'2"
    rect: [S.xW, S.zHallN, S.xHallE, S.zHallS],
  },

  // --- unlabelled second-floor service volumes ------------------------
  primaryBuiltIn: {
    level: 'second',
    label: 'Built-in',
    hidden: true,
    rect: [S.xW, S.zN, S.xBiE, S.zBiS],
    notes: 'Full-height media / wardrobe run on the primary bedroom west wall.',
  },
  primaryWindowSeat: {
    level: 'second',
    label: 'Window seat',
    hidden: true,
    rect: [S.xW, S.zBiS, S.xBiE, S.zPbdS],
    notes: 'Built-in seat under the primary bedroom west window.',
  },
  upperLinen: {
    level: 'second',
    label: 'Linen',
    hidden: true,
    rect: [S.xLinW, S.zLinN, S.xHeW, S.zLinS],
  },
  hallLanding: {
    level: 'second',
    label: 'Landing',
    hidden: true,
    poly: [
      [S.xLandNW, S.zHeS],
      [S.xVoidW, S.zHeS],
      [S.xVoidW, S.zSouthN],
      [S.xLandW, S.zSouthN],
      [S.xLandW, S.zHallN],
      [S.xLandNW, S.zHallN],
    ],
  },
  stairWellSecond: {
    level: 'second',
    label: 'Stair',
    hidden: true,
    rect: [F.xStrW, F.zStrN, F.xStrE, F.zStrS],
  },
  entryVoid: {
    level: 'second',
    label: 'Open to Below',
    hidden: true,
    isVoid: true,
    // Everything east of bedroom3 that is not the stair well.
    poly: [
      [S.xVoidW, S.zHeS],
      [F.xStrW, S.zHeS],
      [F.xStrW, F.zStrS],
      [S.xE, F.zStrS],
      [S.xE, S.zSouthS],
      [S.xVoidW, S.zSouthS],
    ],
  },

  /* ----------------------------- BASEMENT ----------------------------- */

  recreationRoom: {
    level: 'basement',
    label: 'Recreation Room',
    size: [37.083, 20.083], // 37'1" x 20'1"
    area: 716,
    poly: [
      [B.xW, B.zRecN],
      [B.xRecE, B.zRecN],
      [B.xRecE, B.zStrEnclN],
      [B.xStrEnclW, B.zStrEnclN],
      [B.xStrEnclW, B.zRecS],
      [B.xW, B.zRecS],
    ],
  },

  gym: {
    level: 'basement',
    label: 'Gym',
    size: [11.5, 11.75], // 11'6" x 11'9"
    area: 135,
    rect: [B.xW, B.zGymN, B.xNwE, B.zGymS],
  },

  basementBath: {
    level: 'basement',
    label: 'Bathroom',
    area: 35,
    rect: [B.xBthW, B.zBthN, B.xBthE, B.zBthS],
  },

  utilityRoom: {
    level: 'basement',
    label: 'Utility Room',
    area: 370,
    shellOnly: true,
    poly: [
      [B.xUtlW, B.zN],
      [B.xNotchWi, B.zN],
      [B.xNotchWi, B.zNotchSi],
      [B.xBthE, B.zNotchSi],
      [B.xBthE, B.zUtlStep],
      [B.xUtlStepE, B.zUtlStep],
      [B.xUtlStepE, B.zUtlS],
      [B.xUtlW, B.zUtlS],
    ],
  },

  basementStorageNW: {
    level: 'basement',
    label: 'Storage',
    hidden: true,
    rect: [B.xW, B.zN, B.xNwE, B.zStgNS],
  },
  basementMech: {
    level: 'basement',
    label: 'Mechanical / storage',
    hidden: true,
    rect: [B.xMechW, B.zN, B.xMechE, B.zUtlS],
  },
  basementStorageS: {
    level: 'basement',
    label: 'Storage',
    hidden: true,
    rect: [B.xStgSW, B.zBthN, B.xStgSE, B.zUtlS],
  },
  basementStairWell: {
    level: 'basement',
    label: 'Stair',
    hidden: true,
    poly: [
      [B.xStrEnclW, B.zStrEnclN],
      [B.xRecE, B.zStrEnclN],
      [B.xRecE, B.zRecN],
      [B.xBthE, B.zRecN],
      [B.xBthE, B.zRecS],
      [B.xStrEnclW, B.zRecS],
    ],
  },
};

/* Give every room its id, cached polygon, bbox and area. -------------- */
for (const [id, r] of Object.entries(ROOMS)) {
  r.id = id;
  if (!r.poly) {
    if (!r.rect) throw new Error(`dims: room "${id}" has neither rect nor poly`);
    r.poly = rectPoly(r.rect);
  }
  r.bbox = polyBBox(r.poly);
  if (!r.rect) r.rect = r.bbox.slice();
  r.areaComputed = polyArea(r.poly);
  r.floorOffset = r.floorOffset ?? 0;
  r.ceilOffset = r.ceilOffset ?? 0;
  r.floorY = LEVELS[r.level] + r.floorOffset;
  r.ceilY = CEIL_Y[r.level] + r.ceilOffset;
}

export const ROOM_IDS = Object.keys(ROOMS);

export function roomsOnLevel(level) {
  return ROOM_IDS.map((id) => ROOMS[id]).filter((r) => r.level === level);
}

/* =================================================================== */
/* 5. WALLS                                                            */
/* =================================================================== */

export const WALLS = [];

function W(id, a, b, level, t = WALL.int, opts = {}) {
  const w = {
    id,
    a,
    b,
    level,
    t,
    h: opts.h ?? CEIL[level],
    align: opts.align ?? 'center',
    kind: opts.kind ?? 'partition',
  };
  if (opts.base !== undefined) w.base = opts.base;
  if (opts.note) w.note = opts.note;
  WALLS.push(w);
  return w;
}

/** Exterior shell: one wall per footprint edge, outside face on the edge. */
function shell(level, poly, t, h, prefix, kind = 'exterior') {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-6) continue;
    W(`${prefix}-${i}`, a, b, level, t, { h, align: 'outer', kind });
  }
}

shell('first', FOOTPRINTS.first, WALL.ext, CEIL.first, 'ext-first');
shell('second', FOOTPRINTS.second, WALL.ext, CEIL.second, 'ext-second');
shell('basement', FOOTPRINTS.basement, WALL.found, CEIL.basement, 'ext-bsmt', 'foundation');

/* centre line between two opposing wall faces */
const c = (a, b) => (a + b) / 2;

/* ---- first-floor partitions ---------------------------------------- */
W('w-family-s', [F.xW0, c(F.zFamS, F.zLdyN)], [c(F.xLdyE, F.xKitW), c(F.zFamS, F.zLdyN)], 'first');
W('w-laundry-e', [c(F.xLdyE, F.xKitW), c(F.zFamS, F.zLdyN)], [c(F.xLdyE, F.xKitW), c(F.zKitS, F.zH21N)], 'first', 0.416);
W('w-kitchen-s', [c(F.xLdyE, F.xKitW), c(F.zKitS, F.zH21N)], [c(F.xKitE, F.xHallW), c(F.zKitS, F.zH21N)], 'first');
W('w-hall21-n', [F.xW0, c(F.zKitS, F.zH21N)], [c(F.xLdyE, F.xKitW), c(F.zKitS, F.zH21N)], 'first');
W('w-hall21-s', [F.xW0, c(F.zH21S, F.zBedN)], [c(F.xClsE, F.xFoyW), c(F.zH21S, F.zBedN)], 'first');
W('w-vestibule-e', [c(F.xVestE, F.xH21W), c(F.zKitS, F.zH21N)], [c(F.xVestE, F.xH21W), c(F.zH21S, F.zBedN)], 'first');
W('w-bedroom-e', [c(F.xBedE, F.xBthW), c(F.zH21S, F.zBedN)], [c(F.xBedE, F.xBthW), F.zFront0], 'first');
W('w-bath-n', [c(F.xBedE, F.xBthW), c(F.zLinS, F.zBthN)], [c(F.xBthE, F.xClsW), c(F.zLinS, F.zBthN)], 'first');
W('w-bath-e', [c(F.xBthE, F.xClsW), c(F.zH21S, F.zBedN)], [c(F.xBthE, F.xClsW), F.zFront0], 'first', WALL.plumb);
W('w-closets-e', [c(F.xClsE, F.xFoyW), c(F.zH21S, F.zBedN)], [c(F.xClsE, F.xFoyW), F.zFront0], 'first');
W('w-foyer-w', [c(F.xClsE, F.xFoyW), c(F.zH9S, F.zFoyN)], [c(F.xClsE, F.xFoyW), c(F.zH21S, F.zBedN)], 'first');
W('w-foyer-n', [c(F.xClsE, F.xFoyW), c(F.zH9S, F.zFoyN)], [F.xGarWo, c(F.zH9S, F.zFoyN)], 'first');
W('w-kitchen-e', [c(F.xKitE, F.xHallW), c(F.zH9N, F.zNookS)], [c(F.xKitE, F.xHallW), c(F.zH9S, F.zFoyN)], 'first');
W('w-nook-e', [c(F.xNookE, F.xDinW), F.zN0], [c(F.xNookE, F.xDinW), F.zNookS], 'first');
W('w-dining-s', [c(F.xNookE, F.xDinW), c(F.zDinS, F.zH9N)], [F.xDinE, c(F.zDinS, F.zH9N)], 'first');
W('w-living-w', [c(F.xDinE, F.xLivW), F.zN0], [c(F.xDinE, F.xLivW), c(F.zLivS, F.zGarN)], 'first');
W('w-garage-n', [c(F.xDinE, F.xLivW), c(F.zLivS, F.zGarN)], [F.xGarNotchW, c(F.zLivS, F.zGarN)], 'first', WALL.fire, {
  note: 'garage separation',
});
W('w-wetbar-e', [F.xGarNotchW, c(F.zLivS, F.zGarN)], [F.xGarNotchW, c(F.zWetS, F.zGarNotchS)], 'first', WALL.fire);
W('w-wetbar-s', [F.xGarNotchW, c(F.zWetS, F.zGarNotchS)], [F.xE0, c(F.zWetS, F.zGarNotchS)], 'first', WALL.fire);
W('w-garage-w', [c(F.xGarWo, F.xGarW), c(F.zLivS, F.zGarN)], [c(F.xGarWo, F.xGarW), F.zFront0], 'first', WALL.fire, {
  note: 'garage separation, 20-minute rated door',
});
// CORRECTED (shell/stairs pass): this is NOT a drywall wall.  In
// `hallway_top_of_stairs_looking_down_at_front_door.png` the west side of the
// main flight is OPEN — oak rail, black square balusters, white skirt — and you
// see straight through it to the foyer floor.  A 12 ft partition here would
// wall the stair in and hide the whole railing.  kind:'guard' tells shell.js to
// build no drywall; stairs.js builds the balustrade from STAIRS.firstToSecond.
W('w-stair-w', [F.xStrW, F.zStrN], [F.xStrW, F.zStrS], 'first', WALL.int, {
  h: ft(3, 0),
  kind: 'guard',
  note: 'stair well, OPEN west side — balustrade, not drywall',
});
W('w-stair-head', [F.xStrW, F.zStrN], [F.xGarWo, F.zStrN], 'first');

/* ---- second-floor partitions --------------------------------------- */
W('w2-sunroom-s', [S.xSunW, c(S.zSunS, S.zPbdN)], [S.xSunE, c(S.zSunS, S.zPbdN)], 'second');
W('w2-builtin-e', [S.xBiE, S.zN0], [S.xBiE, S.zBiS], 'second', 0.2);
W('w2-primary-e', [c(S.xPbdE, S.xPbaW), c(S.zSunS, S.zPbdN)], [c(S.xPbdE, S.xPbaW), c(S.zPbdS, S.zHallN)], 'second');
W('w2-primarybath-s', [c(S.xPbdE, S.xPbaW), c(S.zPbaS, S.zWicN)], [S.xWicE, c(S.zPbaS, S.zWicN)], 'second', WALL.plumb);
W('w2-wc-w', [S.xWcW, S.zPbdN], [S.xWcW, S.zWcS], 'second');
W('w2-wc-s', [S.xWcW, S.zWcS + WALL.int / 2], [S.xPbaE, S.zWcS + WALL.int / 2], 'second');
W('w2-bedroom2-w', [c(S.xPbaE, S.xBrNW), S.zNE], [c(S.xPbaE, S.xBrNW), c(S.zBrNS, S.zHeN)], 'second');
W('w2-bedroom2-s', [c(S.xPbaE, S.xBrNW), c(S.zBrNS, S.zHeN)], [S.xE, c(S.zBrNS, S.zHeN)], 'second');
W('w2-wic-e', [c(S.xWicE, S.xHeW), c(S.zBrNS, S.zHeN)], [c(S.xWicE, S.xHeW), c(S.zWicS, S.zHallN)], 'second');
W('w2-hall-n', [S.xW0, c(S.zPbdS, S.zHallN)], [S.xVoidW, c(S.zPbdS, S.zHallN)], 'second');
W('w2-hall-s', [S.xW0, c(S.zHallS, S.zSouthN)], [S.xHallE, c(S.zHallS, S.zSouthN)], 'second');
W('w2-landing-w', [c(S.xHallE, S.xLandW), c(S.zPbdS, S.zHallN)], [c(S.xHallE, S.xLandW), S.zSouthN], 'second');
W('w2-bedroom4-e', [c(S.xSwbE, S.xBthW), c(S.zHallS, S.zSouthN)], [c(S.xSwbE, S.xBthW), S.zFront0], 'second');
W('w2-bath-e', [c(S.xBthE, S.xSbdW), c(S.zHallS, S.zSouthN)], [c(S.xBthE, S.xSbdW), S.zFront0], 'second', WALL.plumb);
W('w2-bath-mid', [S.xBthW, c(S.zBthAS, S.zBthBN)], [S.xBthE, c(S.zBthAS, S.zBthBN)], 'second');
W('w2-bedroom3-e', [c(S.xSbdE, S.xVoidW), S.zSouthN], [c(S.xSbdE, S.xVoidW), S.zFront0], 'second');
// Both of these are GUARDS around the two-storey opening, not partitions —
// the balcony rail in `hallway_top_of_stairs...` runs across the head of the
// void and turns down with the flight.  VOIDS.entryVoid.guard.segs holds the
// same two lines; shell.js builds the rail there and no drywall here.
W('w2-void-n', [S.xVoidW, S.zHeS], [F.xStrW, S.zHeS], 'second', WALL.int, { h: ft(3, 0), kind: 'guard', note: 'guard-rail head' });
W('w2-stair-w', [F.xStrW, S.zHeS], [F.xStrW, F.zStrS], 'second', WALL.int, { h: ft(3, 0), kind: 'guard', note: 'stair guard' });

/* ---- basement partitions ------------------------------------------- */
W('wb-storage-s', [B.xW0, c(B.zStgNS, B.zGymN)], [B.xNwE, c(B.zStgNS, B.zGymN)], 'basement');
W('wb-gym-e', [c(B.xNwE, B.xMechW), B.zN], [c(B.xNwE, B.xMechW), c(B.zUtlS, B.zRecN)], 'basement');
W('wb-mech-e', [c(B.xMechE, B.xUtlW), B.zN], [c(B.xMechE, B.xUtlW), c(B.zUtlS, B.zRecN)], 'basement');
W('wb-utility-s', [c(B.xMechE, B.xUtlW), c(B.zUtlS, B.zRecN)], [B.xBthE, c(B.zUtlS, B.zRecN)], 'basement');
W('wb-utility-step-e', [B.xUtlStepE, B.zUtlStep], [B.xUtlStepE, B.zUtlS], 'basement');
W('wb-utility-step-s', [B.xUtlStepE, B.zUtlStep], [B.xBthE, B.zUtlStep], 'basement');
W('wb-storS-w', [B.xStgSW, B.zBthN], [B.xStgSW, B.zUtlS], 'basement');
W('wb-bath-w', [c(B.xStgSE, B.xBthW), B.zBthN], [c(B.xStgSE, B.xBthW), B.zBthS], 'basement', WALL.plumb);
W('wb-bath-s', [B.xBthW, c(B.zBthS, B.zRecN)], [B.xBthE, c(B.zBthS, B.zRecN)], 'basement');
W('wb-stair-w', [B.xStrEnclW, B.zStrEnclN], [B.xStrEnclW, B.zRecS], 'basement');
W('wb-stair-head', [B.xStrEnclW, B.zStrEnclN], [B.xRecE, B.zStrEnclN], 'basement');

export const WALL_BY_ID = Object.fromEntries(WALLS.map((w) => [w.id, w]));

/* =================================================================== */
/* 6. OPENINGS                                                         */
/* =================================================================== */
//  Exterior shell segments are indexed by footprint edge, so for the first
//  floor: 0 = rear (family/nook/dining), 2 = rear of the living wing,
//  3 = east, 4 = garage front, 6 = recessed entry, 8 = bedroom-wing front,
//  9 = west.

const DH = ft(6, 8); // interior door leaf height

export const OPENINGS = [
  /* ---------------- first floor, exterior ---------------------------- */
  // Rear glass wall of the plan's FAMILY ROOM (piece `living`): four large
  // lites plus a full-lite exterior door — the lower half of the two-storey
  // glazed box in backyard_straight_on_view_of_house.png.
  { wall: 'ext-first-0', type: 'window', center: 2.7, w: 3.4, h: 6.3, sill: 1.0, note: 'rear glass wall, lite 1' },
  { wall: 'ext-first-0', type: 'window', center: 6.4, w: 3.4, h: 6.3, sill: 1.0, note: 'rear glass wall, lite 2' },
  {
    wall: 'ext-first-0',
    type: 'door',
    center: 10.1,
    w: 3.2,
    h: ft(6, 10),
    sill: 0,
    swing: 'right-out',
    note: 'full-lite exterior door to the deck, brass/bronze lever',
  },
  { wall: 'ext-first-0', type: 'window', center: 14.0, w: 3.4, h: 6.3, sill: 1.0, note: 'rear glass wall, lite 3' },
  { wall: 'ext-first-0', type: 'window', center: 17.7, w: 3.4, h: 6.3, sill: 1.0, note: 'rear glass wall, lite 4' },
  { wall: 'ext-first-0', type: 'window', center: 23.5, w: 5.0, h: 6.3, sill: 1.0, note: 'breakfast nook rear' },
  { wall: 'ext-first-0', type: 'window', center: 33.9, w: 8.0, h: 5.0, sill: 2.0, note: 'dining room rear bay glazing' },

  { wall: 'ext-first-2', type: 'window', center: 6.0, w: 5.5, h: 4.5, sill: 2.5, note: 'living room rear' },
  { wall: 'ext-first-2', type: 'window', center: 13.5, w: 5.5, h: 4.5, sill: 2.5, note: 'living room rear' },

  { wall: 'ext-first-3', type: 'window', center: 8.0, w: 3.0, h: 4.5, sill: 2.5, note: 'living room east' },
  { wall: 'ext-first-3', type: 'window', center: 14.5, w: 3.0, h: 4.5, sill: 2.5, note: 'living room east' },
  { wall: 'ext-first-3', type: 'window', center: 30.0, w: 2.5, h: 3.0, sill: 4.0, note: 'garage east, obscure' },

  {
    wall: 'ext-first-4',
    type: 'garageDoor',
    center: 10.6,
    w: 16.0,
    h: 7.0,
    sill: 0,
    swing: 'roll-up',
    note: 'two-car overhead door, flush panel, dark bronze',
  },

  // CORRECTED (exterior-entry, round 1) — measured off
  // `exterior_view_of_front_door.png` by back-projecting the observed jamb
  // edges onto z = 42.309 with a camera fitted to the door leaf (3'0" x 6'8")
  // and the two recess corners.  The three units are NOT symmetric about the
  // door and they are NOT sill-height windows: both flanking lights run
  // essentially floor to head (glass bottom measured at y = +0.2, i.e. 0.65 ft
  // above the bluestone), which is what `foyer_view_of_front_door.png` shows
  // from inside — full-height plantation shutters on both sides.
  //   east light  x 35.1 .. 39.3  (4.2 ft, two shutter panels)
  //   door leaf   x 31.8 .. 34.8  (3.0 ft, centre 33.30)
  //   west light  x 28.3 .. 31.6  (3.3 ft, two shutter panels)
  {
    wall: 'ext-first-6',
    type: 'window',
    center: 2.45,
    w: 4.2,
    h: 6.4,
    sill: 0.15,
    note: 'entry window east of the door, white plantation shutters',
  },
  {
    wall: 'ext-first-6',
    type: 'door',
    center: 6.37,
    w: 3.0,
    h: ft(6, 10),
    sill: 0,
    // CORRECTED: `foyer_view_of_front_door.png` shows the three black hinges on
    // the RIGHT jamb and the handleset on the left, seen from inside — so the
    // leaf is right-hand and swings in.  DETAILS.md `foyer` §B says the same.
    swing: 'right-in',
    note: 'FRONT DOOR — dark painted panel door with a round obscure-glass light',
  },
  {
    wall: 'ext-first-6',
    type: 'window',
    center: 9.72,
    w: 3.3,
    h: 6.4,
    sill: 0.15,
    note: 'front-door sidelight west of the door, white plantation shutters',
  },

  { wall: 'ext-first-8', type: 'window', center: 4.6, w: 3.2, h: 5.0, sill: 2.0, note: 'first-floor bath, obscure' },
  { wall: 'ext-first-8', type: 'window', center: 12.0, w: 4.5, h: 5.5, sill: 1.8, note: 'front bedroom, plantation shutters' },
  { wall: 'ext-first-8', type: 'window', center: 17.5, w: 4.5, h: 5.5, sill: 1.8, note: 'front bedroom, plantation shutters' },
  { wall: 'ext-first-8', type: 'window', center: 23.0, w: 4.5, h: 5.5, sill: 1.8, note: 'front bedroom, plantation shutters' },

  { wall: 'ext-first-9', type: 'window', center: 6.0, w: 3.0, h: 5.0, sill: 2.0, note: 'front bedroom west' },
  { wall: 'ext-first-9', type: 'window', center: 18.5, w: 3.0, h: 4.0, sill: 3.0, note: 'laundry west' },
  { wall: 'ext-first-9', type: 'window', center: 33.0, w: 5.0, h: 1.5, sill: ft(6, 6), note: 'family room west — small high awning' },

  /* ---------------- first floor, interior ---------------------------- */
  { wall: 'w-family-s', type: 'door', center: 8.4, w: ft(2, 8), h: DH, sill: 0, swing: 'right-in', note: 'family room to laundry' },
  { wall: 'w-hall21-n', type: 'door', center: 8.0, w: ft(2, 8), h: DH, sill: 0, swing: 'left-in', note: 'hall to laundry / mudroom' },
  { wall: 'w-hall21-s', type: 'door', center: 3.0, w: ft(2, 8), h: DH, sill: 0, swing: 'right-in', note: 'hall to bedroom vestibule' },
  { wall: 'w-hall21-s', type: 'door', center: 20.5, w: ft(2, 6), h: DH, sill: 0, swing: 'left-in', note: 'hall to bath lobby' },
  { wall: 'w-hall21-s', type: 'door', center: 25.0, w: ft(3, 0), h: DH, sill: 0, swing: 'bifold', note: 'coat closet' },
  { wall: 'w-vestibule-e', type: 'opening', center: 1.8, w: ft(3, 6), h: ft(7, 0), sill: 0, swing: 'cased' },
  { wall: 'w-bath-n', type: 'door', center: 2.6, w: ft(2, 6), h: DH, sill: 0, swing: 'left-in', note: 'bath lobby to bath' },
  { wall: 'w-kitchen-s', type: 'opening', center: 4.0, w: ft(6, 0), h: ft(7, 6), sill: 0, swing: 'cased', note: 'kitchen to hall' },
  { wall: 'w-kitchen-e', type: 'opening', center: 10.5, w: ft(7, 0), h: ft(7, 6), sill: 0, swing: 'cased', note: 'kitchen to centre hall' },
  { wall: 'w-dining-s', type: 'opening', center: 6.9, w: ft(6, 0), h: ft(7, 6), sill: 0, swing: 'cased', note: 'dining room to centre hall' },
  { wall: 'w-nook-e', type: 'opening', center: 6.0, w: ft(5, 0), h: ft(7, 6), sill: 0, swing: 'cased', note: 'breakfast nook to dining room' },
  { wall: 'w-living-w', type: 'opening', center: 18.0, w: ft(8, 0), h: ft(8, 0), sill: 0, swing: 'cased', note: 'centre hall to living room' },
  { wall: 'w-foyer-n', type: 'opening', center: 6.0, w: ft(9, 0), h: ft(8, 0), sill: 0, swing: 'cased', note: 'foyer to centre hall' },
  { wall: 'w-foyer-w', type: 'door', center: 2.2, w: ft(2, 8), h: DH, sill: 0, swing: 'right-in', note: 'foyer to kitchen hall' },
  // CORRECTED: the foyer coat closet is a WIDE bypass pair, not a 3'-0" single —
  // `foyer_view_of_front_door.png` shows two full six-panel leaves side by side
  // on one head track, ~5'-4" of opening, with round black finger pulls.
  { wall: 'w-closets-e', type: 'door', center: 4.2, w: ft(5, 4), h: DH, sill: 0, swing: 'bifold', note: 'foyer coat closet, white six-panel bypass pair' },
  { wall: 'w-garage-w', type: 'door', center: 16.5, w: ft(3, 0), h: DH, sill: 0, swing: 'left-in', note: 'foyer to garage, 20-minute rated' },

  /* ---------------- second floor, exterior --------------------------- */
  { wall: 'ext-second-0', type: 'window', center: 4.0, w: 6.0, h: 6.2, sill: 1.0, note: 'sunroom glass wall' },
  { wall: 'ext-second-0', type: 'window', center: 11.0, w: 6.0, h: 6.2, sill: 1.0, note: 'sunroom glass wall' },
  { wall: 'ext-second-0', type: 'window', center: 18.0, w: 6.0, h: 6.2, sill: 1.0, note: 'sunroom glass wall' },
  { wall: 'ext-second-0', type: 'window', center: 23.9, w: 4.4, h: 6.2, sill: 1.0, note: 'sunroom glass wall' },

  { wall: 'ext-second-2', type: 'window', center: 6.5, w: 5.0, h: 3.2, sill: 3.6, note: 'NE bedroom rear' },

  { wall: 'ext-second-3', type: 'window', center: 6.0, w: 4.0, h: 4.5, sill: 2.5, note: 'NE bedroom east' },
  { wall: 'ext-second-3', type: 'window', center: 20.0, w: 3.0, h: 4.5, sill: 2.5, note: 'upper hall east' },

  {
    wall: 'ext-second-4',
    type: 'window',
    center: 4.6,
    w: 4.3,
    h: 4.3,
    // CORRECTED (exterior-entry, round 1): the porthole sits LOW in the entry
    // box, not high. In `exterior_view_of_front_door.png` its centre projects
    // 8.2 ft above the camera at the door's own depth; with the camera height
    // fixed by the 6'8" door leaf that puts the centre at y = 12.7, i.e. only
    // 3.2 ft above the second-floor deck. The old sill of 3.1 put it 2 ft too
    // high and pushed it out of that frame entirely.
    sill: 1.05,
    shape: 'round',
    note: 'ROUND PORTHOLE WINDOW over the entry — reads into the two-storey foyer',
  },
  { wall: 'ext-second-4', type: 'window', center: 15.5, w: 5.0, h: 5.0, sill: 2.0, note: 'front bedroom (13\'2") ' },
  { wall: 'ext-second-4', type: 'window', center: 21.5, w: 5.0, h: 5.0, sill: 2.0, note: 'front bedroom (13\'2") ' },
  { wall: 'ext-second-4', type: 'window', center: 27.5, w: 2.5, h: 3.0, sill: 4.0, note: 'hall bath, obscure' },
  { wall: 'ext-second-4', type: 'window', center: 34.5, w: 5.0, h: 5.0, sill: 2.0, note: 'SW bedroom front' },

  { wall: 'ext-second-5', type: 'window', center: 7.0, w: 3.5, h: 4.5, sill: 2.5, note: 'SW bedroom west' },
  { wall: 'ext-second-5', type: 'window', center: 20.0, w: 3.5, h: 5.5, sill: 1.5, note: 'primary bedroom west' },

  /* ---------------- second floor, interior --------------------------- */
  { wall: 'w2-sunroom-s', type: 'opening', center: 5.0, w: ft(8, 0), h: ft(7, 0), sill: 0, swing: 'cased', note: 'primary bedroom to sunroom' },
  { wall: 'w2-sunroom-s', type: 'opening', center: 18.0, w: ft(6, 0), h: ft(7, 0), sill: 0, swing: 'cased', note: 'primary bath to sunroom' },
  { wall: 'w2-primary-e', type: 'door', center: 10.0, w: ft(2, 8), h: DH, sill: 0, swing: 'left-in', note: 'primary bedroom to bath' },
  { wall: 'w2-primarybath-s', type: 'door', center: 4.0, w: ft(2, 8), h: DH, sill: 0, swing: 'right-in', note: 'primary bath to W.I.C.' },
  { wall: 'w2-wc-w', type: 'door', center: 2.4, w: ft(2, 4), h: DH, sill: 0, swing: 'left-in', note: 'water closet' },
  { wall: 'w2-wic-e', type: 'door', center: 3.8, w: ft(2, 8), h: DH, sill: 0, swing: 'right-in', note: 'W.I.C. to upper hall' },
  { wall: 'w2-bedroom2-s', type: 'door', center: 8.0, w: ft(2, 8), h: DH, sill: 0, swing: 'left-in', note: 'NE bedroom' },
  { wall: 'w2-hall-n', type: 'door', center: 4.0, w: ft(2, 8), h: DH, sill: 0, swing: 'right-in', note: 'hall to primary bedroom' },
  { wall: 'w2-hall-s', type: 'door', center: 5.0, w: ft(2, 8), h: DH, sill: 0, swing: 'left-in', note: 'SW bedroom' },
  { wall: 'w2-hall-s', type: 'door', center: 13.5, w: ft(2, 6), h: DH, sill: 0, swing: 'right-in', note: 'hall bath' },
  { wall: 'w2-hall-s', type: 'door', center: 20.0, w: ft(2, 8), h: DH, sill: 0, swing: 'left-in', note: 'front bedroom (13\'2")' },
  { wall: 'w2-bath-mid', type: 'door', center: 2.6, w: ft(2, 4), h: DH, sill: 0, swing: 'left-in', note: 'between the two hall baths' },

  /* ---------------- basement ----------------------------------------- */
  { wall: 'ext-bsmt-4', type: 'window', center: 9.0, w: 3.0, h: 1.9, sill: 5.45, note: 'rec room window well' },
  { wall: 'ext-bsmt-4', type: 'window', center: 19.0, w: 3.0, h: 1.9, sill: 5.45, note: 'rec room window well' },
  { wall: 'ext-bsmt-4', type: 'window', center: 29.0, w: 3.0, h: 1.9, sill: 5.45, note: 'rec room window well' },
  { wall: 'ext-bsmt-5', type: 'window', center: 26.0, w: 3.0, h: 1.9, sill: 5.45, note: 'gym window well' },
  { wall: 'wb-gym-e', type: 'door', center: 16.0, w: ft(2, 8), h: DH, sill: 0, swing: 'left-in', note: 'gym' },
  { wall: 'wb-gym-e', type: 'door', center: 6.0, w: ft(2, 8), h: DH, sill: 0, swing: 'left-in', note: 'seasonal storage' },
  { wall: 'wb-utility-s', type: 'door', center: 3.0, w: ft(2, 8), h: DH, sill: 0, swing: 'right-in', note: 'utility room' },
  { wall: 'wb-bath-s', type: 'door', center: 3.6, w: ft(2, 4), h: DH, sill: 0, swing: 'left-in', note: 'basement bath' },
  { wall: 'wb-stair-w', type: 'opening', center: 6.0, w: ft(4, 0), h: ft(7, 0), sill: 0, swing: 'cased', note: 'rec room to stair' },
];

/* =================================================================== */
/* 6b. INTERNAL LEVEL CHANGES, COLUMNS, SKYLIGHTS                      */
/* =================================================================== */

/**
 * Single-riser steps inside a level.  `line` is the nosing line in plan;
 * `dropSide` says which side of a->b is the LOW side.
 */
export const STEPS = [
  {
    id: 'step-living',
    level: 'first',
    room: 'livingRoom',
    rooms: ['livingRoom', 'wetBar'], // both sit on the low side
    line: [
      [F.xLivW, F.zLivN],
      [F.xLivW, F.zLivS],
    ],
    dropSide: 'east', // the living room is the low side
    riserH: inch(7),
    treadNosing: inch(1.125),
    riserFinish: 'paintWhite',
    treadFinish: 'oakBullnose',
    note:
      'The plan\'s LIVING ROOM (piece `family`) sits one ~7" step below the ' +
      'kitchen/hall level; the baseboard steps with it. DETAILS.md, family_room_3.',
  },
];

/** Boxed square columns. `plan` is [x0, z0, x1, z1]. */
export const COLUMNS = [
  {
    id: 'col-family-mid',
    level: 'first',
    plan: [F.xFamE - 0.417, 9.4, F.xFamE + 0.417, 10.234],
    w: inch(10),
    style: 'boxedSquareWhite',
    baseMitred: true,
    note: 'White boxed column mid-room in the plan\'s FAMILY ROOM (piece `living`).',
  },
  {
    id: 'col-nook-mid',
    level: 'first',
    plan: [F.xNookE - 4.6, F.zNookS - 0.834, F.xNookE - 3.766, F.zNookS],
    w: inch(10),
    style: 'boxedSquareWhite',
    baseMitred: true,
    note: 'White boxed column at the kitchen / breakfast-nook opening.',
  },
  {
    id: 'col-bsmt-rec-w',
    level: 'basement',
    plan: [12.9, 32.0, 13.7, 32.8],
    w: inch(9.5),
    style: 'turnedWoodOak',
    note: 'Lally column cover: round turned honey-oak column with a collar cap.',
  },
  {
    id: 'col-bsmt-rec-e',
    level: 'basement',
    plan: [24.6, 32.0, 25.4, 32.8],
    w: inch(9.5),
    style: 'turnedWoodOak',
    note: 'Lally column cover: round turned honey-oak column with a collar cap.',
  },
];

/** Skylights and light slots. `plan` is the ceiling opening; `wellSplay` is
 *  the horizontal spread of the splayed white shaft at the roof deck. */
export const SKYLIGHTS = [
  {
    id: 'sky-primary-bath',
    level: 'second',
    room: 'primaryBath',
    plan: [17.6, 8.6, 22.4, 13.4],
    ceilY: CEIL_Y.second,
    roofY: 21.4,
    wellSplay: 1.1,
    glassTint: 0.06,
    note: 'Large rectangular skylight with a splayed white well over the tub / vanity zone.',
  },
  {
    id: 'sky-primary-vestibule',
    level: 'second',
    room: 'primaryBedroom',
    plan: [4.2, 23.6, 7.6, 26.2],
    ceilY: CEIL_Y.second,
    roofY: 21.0,
    wellSplay: 0.9,
    glassTint: 0.06,
    note: 'Vaulted light slot / splayed white shaft over the primary bedroom vestibule.',
  },
  {
    // ADDED (shell pass).  `hallway_top_of_stairs_looking_down_at_front_door.png`
    // shows a long bright slot cut lengthwise through the vault over the
    // stairwell — it is what lights the two-storey entry and it throws the hard
    // white wedge across the sloped ceiling in the top-left of that frame.
    // cameras.json already described it ("sculptural skylight slots cut across
    // the vaulted ceiling"); it was simply missing from this table.
    id: 'sky-upper-hall',
    level: 'second',
    room: 'entryVoid',
    plan: [32.4, 27.6, 36.2, 36.6],
    ceilY: 18.0, // the vault plane at that z (see VOIDS.entryVoid.ceiling)
    roofY: 21.8,
    wellSplay: 0.75,
    glassTint: 0.05,
    slope: true,
    note: 'Long slot skylight in the vault over the two-storey entry / stair hall.',
  },
];

/* =================================================================== */
/* 7. STAIRS                                                           */
/* =================================================================== */
//  Both flights stack in the same well on the east side of the plan, hard
//  against the garage wall, and both climb toward -Z (the plan arrow points
//  up / toward the rear).  The main flight starts in the foyer and lands in
//  the second-floor hall; the basement flight runs directly beneath it and
//  is entered from the north end of the centre hall.

export const STAIRS = {
  firstToSecond: {
    id: 'firstToSecond',
    fromLevel: 'first',
    toLevel: 'second',
    well: [F.xStrW, F.zStrN, F.xStrE, F.zStrS],
    width: F.xStrE - F.xStrW, //  3.500 ft clear
    run: F.zStrS - F.zStrN, // 12.500 ft
    rise: LEVELS.second - LEVELS.first, //  9.500 ft
    risers: 15,
    riserH: (LEVELS.second - LEVELS.first) / 15, // 0.6333 ft = 7-5/8"
    treads: 14,
    treadD: (F.zStrS - F.zStrN) / 14, // 0.8929 ft = 10-3/4"
    nosing: inch(1.125),
    dir: [0, -1], // ascends toward -Z
    bottom: [F.xStrW + 1.75, F.zStrS],
    top: [F.xStrW + 1.75, F.zStrN],
    bottomY: LEVELS.first,
    topY: LEVELS.second,
    guardSide: 'west',
    handrailY: ft(2, 10),
    guardY: ft(3, 0),
    balusters: { spacing: inch(4), w: inch(0.5), material: 'ironBlack' },
    newel: { w: inch(3.5), h: ft(3, 4) },
    treadMaterial: 'oakStain',
    riserMaterial: 'paintWhite',
    note: 'Straight run, open west side, square oak newels and black iron balusters.',
  },
  basementToFirst: {
    id: 'basementToFirst',
    fromLevel: 'basement',
    toLevel: 'first',
    well: [B.xStrW, B.zStrN, B.xStrE, B.zStrS],
    width: B.xStrE - B.xStrW, //  3.500 ft
    run: B.zStrS - B.zStrN, // 12.500 ft
    rise: LEVELS.first - LEVELS.basement, //  9.000 ft
    risers: 14,
    riserH: (LEVELS.first - LEVELS.basement) / 14, // 0.6429 ft = 7-23/32"
    treads: 13,
    treadD: (B.zStrS - B.zStrN) / 13, // 0.9615 ft = 11-1/2"
    nosing: inch(1.0),
    dir: [0, -1],
    bottom: [B.xStrW + 1.75, B.zStrS],
    top: [B.xStrW + 1.75, B.zStrN],
    bottomY: LEVELS.basement,
    topY: LEVELS.first,
    guardSide: 'west',
    handrailY: ft(2, 10),
    guardY: ft(3, 0),
    treadMaterial: 'oakStain',
    riserMaterial: 'paintWhite',
    note: 'Directly under the main flight; landing opens into the centre hall.',
  },
};

/* =================================================================== */
/* 8. VOIDS (two-storey volumes / floor openings)                       */
/* =================================================================== */

export const VOIDS = [
  {
    id: 'entryVoid',
    label: 'Open to Below',
    level: 'second', // the level whose FLOOR is missing
    poly: ROOMS.entryVoid.poly,
    fromY: LEVELS.first,
    toY: CEIL_Y.second,
    // The two-storey foyer is not flat-topped: the ceiling lifts into a shallow
    // shed / tray toward the front wall (hallway_top_of_stairs photo).
    ceiling: {
      type: 'trayShed',
      lowY: CEIL_Y.second, // 17.50 at the hall side
      highY: 19.6, // over the front wall
      lowZ: S.zHeS,
      highZ: S.zFront0,
      soffitDepth: 1.4,
      // The front wall of the two-storey foyer leans back with the vault; the
      // oval window sits in that sloped plane, crossed by a white boxed beam.
      frontWallSlope: true,
      beam: { at: 33.0, w: 0.9, d: 0.75, finish: 'paintWhite' },
    },
    guard: {
      segs: [
        [
          [S.xVoidW, S.zHeS],
          [F.xStrW, S.zHeS],
        ],
        [
          [F.xStrW, S.zHeS],
          [F.xStrW, F.zStrS],
        ],
      ],
      y: ft(3, 0),
      handrail: 'oakStain',
      balusters: 'ironBlack',
    },
    note: 'The round porthole window lights this volume from the front wall.',
  },
  {
    id: 'stairWellSecond',
    label: 'Stair opening',
    level: 'second',
    poly: rectPoly([F.xStrW, F.zStrN, F.xStrE, F.zStrS]),
    fromY: LEVELS.first,
    toY: CEIL_Y.second,
    note: 'Floor opening for the first-to-second flight.',
  },
  {
    id: 'stairWellFirst',
    label: 'Basement stair opening',
    level: 'first',
    // CORRECTED: the opening is only as long as the basement flight needs for
    // headroom.  The full 12'-6" well was wrong: it left the BOTTOM three
    // treads of the main first-to-second flight standing over a hole in the
    // foyer floor.  6'-8" of headroom on a 7-23/32" riser is used up 3.5 treads
    // from the top, i.e. by z = 35.3; south of that the first floor is solid
    // and carries the foot of the main stair.
    poly: rectPoly([B.xStrW, B.zStrN, B.xStrE, 35.3]),
    fromY: LEVELS.basement,
    toY: LEVELS.first,
    note: 'Floor opening for the basement flight, directly under the main stair.',
  },
];

/* =================================================================== */
/* 9. MASSING — the exterior                                           */
/* =================================================================== */

const GRADE = { front: -1.0, rear: -1.35, sides: -1.15 };

export const MASSING = {
  grade: {
    ...GRADE,
    slabTop: LEVELS.basement,
    foundationExposed: 1.0,
  },

  /** Building volumes. Each is an extruded plan polygon. */
  blocks: {
    mainTwoStory: {
      label: 'Two-storey main block',
      poly: FOOTPRINTS.second,
      baseY: GRADE.sides,
      topY: CEIL_Y.second + 1.0, // 18.5 — top of the second-floor plate
      storeys: 2,
    },
    livingWing: {
      label: 'One-storey living-room wing (NE)',
      poly: [
        [F.xLivW, F.zLivN0],
        [F.xE0, F.zLivN0],
        [F.xE0, F.zGarN],
        [F.xLivW, F.zGarN],
      ],
      baseY: GRADE.sides,
      topY: CEIL_Y.first + 1.0, // 9.5
      storeys: 1,
      note: 'One storey — confirmed by the NE notch on floorplan_second_floor and by backyard_straight_on_view_of_house.',
    },
    garageWing: {
      label: 'One-storey attached two-car garage (SE)',
      poly: [
        [F.xGarWo, F.zGarN],
        [F.xE0, F.zGarN],
        [F.xE0, F.zFront0],
        [F.xGarWo, F.zFront0],
      ],
      baseY: GRADE.front,
      topY: CEIL_Y.first + 1.0,
      storeys: 1,
      note: 'Single storey with a low hip — straight_on_view_of_house_from_street.',
    },
    entryBox: {
      label: 'Two-storey entry box with the round porthole window',
      poly: [
        [F.xFoyW, F.zRec0],
        [F.xGarWo, F.zRec0],
        [F.xGarWo, F.zFront0],
        [F.xFoyW, F.zFront0],
      ],
      baseY: CEIL_Y.first, // cantilevered over the porch
      topY: CEIL_Y.second + 1.0,
      storeys: 1,
      cantilever: true,
      porthole: {
        shape: 'round',
        center: [F.xGarWo - 4.05, LEVELS.second + 3.2, F.zFront0],
        width: 4.3, // ~52" outside the trim ring; ~44" of glass
        height: 4.3, // MEASURED circular in straight_on_view_of_house_from_street.png
        frame: 'charcoal',
        frameW: inch(4.2),
        note:
          'Round fixed porthole, ~48" outside diameter with a charcoal ring and ~42" of ' +
          'glass, high on the two-storey entry wall. Measured off ' +
          'straight_on_view_of_house_from_street.png: the glass spans 56 px where the 8" ' +
          'siding courses run 10.7 px, i.e. 3.5 ft, and it is unambiguously CIRCULAR — the ' +
          'earlier "oval 48x30" reading was wrong.',
      },
    },
    entryPorch: {
      label: 'Recessed entry porch (outdoor)',
      poly: [
        [F.xFoyW, F.zRec0],
        [F.xGarWo, F.zRec0],
        [F.xGarWo, F.zFront0 + 0.6],
        [F.xFoyW, F.zFront0 + 0.6],
      ],
      baseY: -0.45, // bluestone paving, one riser below the threshold
      topY: CEIL_Y.first, // underside of the cantilevered entry box
      floorY: -0.45,
      soffitY: CEIL_Y.first,
      storeys: 0,
      // MEASURED (exterior-entry): the reeded post stands just PROUD of the
      // facade, out on the bluestone, carrying the front edge of the beam.
      // Its base back-projects to x 27.9-28.1, z 45.4-46.0.
      post: {
        at: [F.xFoyW + 0.8, F.zFront0 + 0.35],
        w: inch(9),
        d: inch(9),
        topY: CEIL_Y.first,
        material: 'stainDark',
      },
      // The beam soffit reads at y = 7.25 in exterior_view_of_front_door.png,
      // i.e. 1.25 ft below the first-floor ceiling plane.
      beamDepth: 1.25,
      /** Bluestone stoop: it runs 5 ft PAST the facade, well beyond the soffit. */
      stoop: [F.xFoyW - 0.55, F.zRec0, F.xGarWo + 0.65, F.zFront0 + 5.0],
    },
  },

  /** Roof planes. `pitch` is rise per 12 of run. Overhangs are horizontal. */
  roofs: [
    {
      id: 'roof-main',
      type: 'hip',
      over: 'mainTwoStory',
      poly: FOOTPRINTS.second,
      eaveY: 18.5,
      ridgeY: 24.0,
      pitch: 4.0,
      ridgeDir: 'ew',
      overhang: 2.0,
      fasciaH: 1.5,
      rakeH: 1.5,
      material: 'asphaltCharcoal',
      note: 'Low hip with a deep flat fascia band — the dominant 1970s-modern move.',
    },
    {
      id: 'roof-living',
      type: 'hip',
      over: 'livingWing',
      poly: [
        [F.xLivW, F.zLivN0],
        [F.xE0, F.zLivN0],
        [F.xE0, F.zGarN],
        [F.xLivW, F.zGarN],
      ],
      eaveY: 9.5,
      ridgeY: 13.2,
      pitch: 4.0,
      ridgeDir: 'ns',
      overhang: 1.8,
      fasciaH: 1.2,
      material: 'asphaltCharcoal',
    },
    {
      id: 'roof-garage',
      type: 'hip',
      over: 'garageWing',
      poly: [
        [F.xGarWo, F.zGarN],
        [F.xE0, F.zGarN],
        [F.xE0, F.zFront0],
        [F.xGarWo, F.zFront0],
      ],
      eaveY: 9.5,
      ridgeY: 13.6,
      pitch: 4.0,
      ridgeDir: 'ew',
      overhang: 1.8,
      fasciaH: 1.2,
      material: 'asphaltCharcoal',
    },
    {
      id: 'roof-entry',
      type: 'flat',
      over: 'entryBox',
      poly: [
        [F.xFoyW, F.zRec0],
        [F.xGarWo, F.zRec0],
        [F.xGarWo, F.zFront0],
        [F.xFoyW, F.zFront0],
      ],
      eaveY: 19.5,
      ridgeY: 19.8,
      pitch: 0.4,
      overhang: 1.5,
      fasciaH: 1.35,
      fasciaTone: 'trim',
      material: 'membraneCharcoal',
      note: 'Deep fascia box reading as a flat cap over the porthole.',
    },
    {
      id: 'roof-diningbay',
      type: 'shed',
      over: 'diningBay',
      poly: [
        [F.xDinW, F.zN0],
        [F.xLivW, F.zN0],
        [F.xLivW, S.zNE0],
        [F.xDinW, S.zNE0],
      ],
      eaveY: 9.6,
      ridgeY: 10.6,
      pitch: 3.0,
      ridgeDir: 'ew',
      overhang: 1.2,
      fasciaH: 0.9,
      material: 'asphaltCharcoal',
      note: 'Small shed over the dining bay where the second floor steps back.',
    },
  ],

  chimney: {
    // Serves the living-room gas fireplace. In the rear photo (looking north
    // to south, so screen-left = +X) it reads on the left. Matches.
    plan: [F.xLivE - 4.6, F.zLivN + 0.2, F.xLivE - 0.4, F.zLivN + 3.6],
    baseY: GRADE.sides,
    topY: 16.4,
    capH: 0.5,
    material: 'sidingGray',
  },

  siding: {
    type: 'lapHorizontal',
    // MEASURED: the courses run 10.7-12.0 px in straight_on_view_of_house_from_street
    // against a 16-18 px/ft facade scale -> 8" exposure, not 7".
    exposure: inch(8),
    color: '#6f7169', // weathered gray-green stained cedar
    trimColor: '#585a54',
    cornerBoardW: inch(4),
    fasciaColor: '#4c4e49',
    soffitColor: '#4c4e49',
    windowFrameColor: '#3c3e3a',
  },

  /* ---- rear deck / patio / planter / fire pit ----------------------- */
  //  Read from backyard_1, backyard_patio_1/2, backyard_fire_pit_1..3 and
  //  backyard_straight_on_view_of_house.  Sizes are estimates scaled off the
  //  deck boards (5-1/2" faces) and the 6'-8" rear door.
  deck: {
    id: 'deck',
    label: 'Rear deck — two levels',
    material: 'deckGrayStain',
    boardW: inch(5.5),
    boardGap: inch(0.25),
    boardDir: 'ew', // parallel to the house wall
    screws: { pairsPerJoist: 2, joistSpacing: inch(16), rustStain: 0.15 },
    // Main deck, tight to the rear wall.
    main: {
      topY: -0.5,
      poly: [
        [7.5, -11.5],
        [30.5, -11.5],
        [30.5, 0.0],
        [7.5, 0.0],
      ],
      railing: { system: 'blackAluminumPicket', h: ft(3, 0), sides: ['east'] },
    },
    // Lower octagonal / angled platform, ~10" below the main deck.
    lower: {
      topY: -0.5 - inch(10),
      poly: [
        [2.0, -11.5],
        [7.5, -11.5],
        [7.5, -16.6],
        [11.0, -19.4],
        [18.0, -19.4],
        [21.5, -16.6],
        [21.5, -11.5],
        [2.0, -11.5],
      ],
      railing: { system: 'grayWood2x4Cap', h: ft(3, 0), balusterW: inch(1.5) },
    },
    step: { line: [[7.5, -11.5], [21.5, -11.5]], riserH: inch(10), treadW: 1.1, bullnose: true },
    skirt: { h: 0.85, material: 'latticeGrayDiagonal', lath: inch(1), frame: inch(3.5) },
    bench: {
      // backless built-in along the outer edge of the lower platform
      segs: [
        [
          [7.5, -16.6],
          [11.0, -19.4],
        ],
        [
          [11.0, -19.4],
          [18.0, -19.4],
        ],
      ],
      seatY: -0.5 - inch(10) + inch(17),
      seatW: 1.25,
      backH: 0,
      legStyle: 'angledPlank',
    },
    treeCutout: {
      // deck cut-out around a mature trunk with a mulch collar
      center: [15.0, -6.0],
      r: 1.9,
      mulchR: 1.9,
      note: 'Distinctive, must-build detail (backyard_patio_1/2).',
    },
  },

  patio: {
    id: 'patio',
    label: 'Irregular flagstone patio',
    material: 'bluestoneIrregular',
    topY: -1.35,
    poly: [
      [12.0, -24.0],
      [41.5, -24.0],
      [44.0, -14.0],
      [42.0, -1.0],
      [30.5, -1.0],
      [30.5, -13.0],
      [17.5, -14.6],
      [12.0, -18.0],
    ],
    jointGrass: true,
  },

  planterWall: {
    id: 'planterWall',
    label: 'Raised stacked-limestone planter / seat wall',
    material: 'limestoneStacked',
    // Faceted arc enclosing the raised fire-pit terrace, east of the deck.
    // `path` is the OUTER face; the wall is 1'-5" thick with a 2" stone cap.
    path: [
      [22.5, -18.4],
      [26.5, -21.6],
      [32.0, -22.6],
      [37.0, -21.4],
      [40.4, -18.2],
      [41.4, -14.2],
    ],
    thickness: 1.4,
    baseY: -1.35,
    topY: 0.55,
    capT: inch(2),
    capOverhang: inch(1.5),
    fillTopY: 0.35, // raised terrace inside the wall
    courseH: inch(3.5),
  },

  firePit: {
    id: 'firePit',
    label: 'Fire pit',
    center: [31.6, -17.6],
    baseY: 0.35,
    bowlOuterR: 1.9,
    bowlInnerR: 1.5,
    bowlH: 0.85,
    material: 'steelBlack',
    screen: { r: 1.75, h: 0.95, material: 'meshBlack' },
    surroundR: 4.6,
    note: 'Round steel bowl with a mesh spark screen, on the raised terrace.',
  },

  riverRockEdge: {
    material: 'riverCobble',
    stoneR: 0.42,
    topY: -1.05,
    paths: [
      [
        [-3.0, -30.0],
        [8.0, -27.0],
        [18.0, -25.2],
        [30.0, -25.6],
        [42.0, -25.0],
        [50.0, -21.0],
      ],
    ],
  },
};

/* =================================================================== */
/* 10. SITE                                                            */
/* =================================================================== */

export const SITE = {
  lot: {
    poly: [
      [-26.0, -96.0],
      [88.0, -96.0],
      [88.0, 112.0],
      [-26.0, 112.0],
    ],
    grassY: -1.15,
    frontSetback: 45.143,
  },

  // The straight-on photograph is taken from the FRONT LAWN, not the street:
  // the whole bottom edge of the 1021-px frame is turf, and with f = 818 px
  // and a 5.6 ft eye the nearest visible ground is 10.9 ft from the lens.
  // Since the facade scale fixes the camera 49.9 ft off the front wall
  // (z = 95), the walk cannot be closer to the house than ~53 ft.
  street: {
    curbZ: 107.0,
    curbH: 0.5,
    sidewalk: { z0: 98.0, z1: 103.0, y: -1.35, material: 'concreteBroom' },
    pavement: { z0: 107.5, z1: 134.0, y: -2.1, material: 'asphaltWorn' },
  },

  driveway: {
    material: 'concreteBroom',
    y: -0.95,
    poly: [
      [39.2, 45.4],
      [61.2, 45.4],
      [66.0, 58.0],
      [72.0, 80.0],
      [76.0, 107.5],
      [50.0, 107.5],
      [47.0, 82.0],
      [41.5, 58.0],
    ],
    jointSpacing: 10.0,
  },

  walkway: {
    material: 'bluestoneIrregular',
    y: -0.9,
    width: 4.6,
    path: [
      [44.6, 62.0],
      [41.0, 55.0],
      [36.5, 49.5],
      [33.4, 46.2],
    ],
    // The RAISED bluestone stoop (MASSING.blocks.entryPorch.stoop) runs from
    // the recess wall out to z = 50.14 — measured off exterior_view_of_front_door
    // by back-projecting the step nosing, which lands 5 ft PAST the facade.
    // `landing` is therefore the flat apron at WALK level directly in front of
    // that nosing, not the porch itself.
    landing: [F.xFoyW + 1.0, F.zFront0 + 5.0, F.xGarWo + 3.3, F.zFront0 + 9.4],
  },

  hedges: [
    {
      id: 'hedge-entry-east',
      poly: [
        [41.4, 46.6],
        [51.0, 46.6],
        [51.0, 55.6],
        [41.4, 55.6],
      ],
      h: 8.2,
      form: 'roundedBlob',
      species: 'privet',
      note: 'The tall rounded mass between the walk and the driveway.',
    },
    {
      id: 'hedge-entry-west',
      poly: [
        [22.6, 46.4],
        [27.0, 46.4],
        [27.0, 52.0],
        [22.6, 52.0],
      ],
      h: 4.2,
      form: 'roundedBlob',
      species: 'privet',
    },
    {
      id: 'hedge-garage-east',
      poly: [
        [62.0, 46.0],
        [70.0, 46.0],
        [70.0, 54.0],
        [62.0, 54.0],
      ],
      h: 3.2,
      form: 'roundedBlob',
      species: 'boxwood',
    },
  ],

  shrubs: [
    { at: [4.0, 48.4], r: 2.0, species: 'boxwoodSphere' },
    { at: [9.4, 48.6], r: 1.7, species: 'boxwoodSphere' },
    { at: [14.6, 48.4], r: 2.1, species: 'boxwoodSphere' },
    { at: [19.8, 48.6], r: 1.8, species: 'boxwoodSphere' },
    { at: [30.0, 50.8], r: 1.6, species: 'boxwoodSphere' },
    { at: [55.0, 47.6], r: 1.5, species: 'boxwoodSphere' },
    { at: [-3.4, 30.0], r: 2.4, species: 'viburnum' },
    { at: [-3.6, 20.0], r: 2.6, species: 'viburnum' },
    { at: [-3.4, 9.0], r: 2.2, species: 'viburnum' },
    { at: [46.0, -10.0], r: 2.4, species: 'hydrangea' },
    { at: [50.0, -18.0], r: 2.0, species: 'boxwoodSphere' },
  ],

  mulchBeds: [
    {
      id: 'bed-front',
      poly: [
        [-6.0, 46.0],
        [27.0, 46.0],
        [27.0, 53.5],
        [16.0, 58.0],
        [2.0, 60.0],
        [-9.0, 56.0],
        [-9.0, 48.0],
      ],
      y: -1.02,
    },
    {
      id: 'bed-front-east',
      poly: [
        [41.0, 46.0],
        [62.0, 46.0],
        [62.0, 55.0],
        [52.0, 58.0],
        [41.0, 55.0],
      ],
      y: -1.02,
    },
    {
      id: 'bed-rear-west',
      poly: [
        [-14.0, -34.0],
        [2.0, -30.0],
        [2.0, -2.0],
        [-14.0, -2.0],
      ],
      y: -1.22,
    },
    {
      id: 'bed-rear-north',
      poly: [
        [-14.0, -40.0],
        [30.0, -33.0],
        [44.0, -30.0],
        [52.0, -22.0],
        [52.0, -12.0],
        [44.0, -14.0],
        [41.5, -24.0],
        [12.0, -24.0],
        [-14.0, -30.0],
      ],
      y: -1.22,
    },
  ],

  trees: [
    {
      id: 'front-redbud',
      // SOLVED off straight_on_view_of_house_from_street.png, not guessed.
      // The trunk base sits 280 px below the horizon and the mulch ring's far
      // edge 200 px below it; with f = 818 px and a 5.6 ft eye that fixes the
      // trunk at ~21 ft from the camera (z = 74) and the ring at 13 x 8 ft.
      // The canopy is therefore only ~19 ft across — it dominates the frame
      // because it is CLOSE, not because it is huge.
      at: [19.6, 73.0],
      trunkR: 0.58,
      canopyR: 8.2,
      crownBaseY: 5.0,
      crownTopY: 15.0,
      species: 'redbud',
      note: 'The broad multi-stem canopy that dominates straight_on_view_of_house.',
    },
    { id: 'front-pine', at: [-13.0, 52.0], trunkR: 0.95, canopyR: 13.0, crownBaseY: 9.0, crownTopY: 46.0, species: 'pine' },
    { id: 'front-maple-e', at: [70.0, 62.0], trunkR: 0.5, canopyR: 7.5, crownBaseY: 6.0, crownTopY: 20.0, species: 'maple' },
    /* --- the canopy that closes the sky BEHIND the roof ---------------- */
    { id: 'bg-poplar-c', at: [28.0, -10.0], trunkR: 0.9, canopyR: 19.0, crownBaseY: 10.0, crownTopY: 50.0, species: 'poplar' },
    { id: 'bg-poplar-e', at: [62.0, -18.0], trunkR: 0.9, canopyR: 21.0, crownBaseY: 10.0, crownTopY: 54.0, species: 'poplar' },
    { id: 'bg-maple-w', at: [-2.0, -20.0], trunkR: 0.85, canopyR: 19.0, crownBaseY: 9.0, crownTopY: 46.0, species: 'maple' },
    { id: 'bg-maple-ne', at: [96.0, 2.0], trunkR: 0.8, canopyR: 20.0, crownBaseY: 9.0, crownTopY: 44.0, species: 'maple' },
    { id: 'bg-maple-far-e', at: [112.0, 40.0], trunkR: 0.7, canopyR: 17.0, crownBaseY: 8.0, crownTopY: 40.0, species: 'maple' },
    { id: 'bg-maple-far-w', at: [-34.0, -6.0], trunkR: 0.8, canopyR: 18.0, crownBaseY: 9.0, crownTopY: 44.0, species: 'maple' },
    { id: 'rear-maple-w', at: [-8.0, -34.0], trunkR: 0.85, canopyR: 17.0, crownBaseY: 9.0, crownTopY: 44.0, species: 'maple' },
    { id: 'rear-maple-c', at: [20.0, -46.0], trunkR: 0.75, canopyR: 16.0, crownBaseY: 10.0, crownTopY: 42.0, species: 'maple' },
    { id: 'rear-maple-e', at: [48.0, -30.0], trunkR: 0.8, canopyR: 16.0, crownBaseY: 9.0, crownTopY: 40.0, species: 'maple' },
    { id: 'rear-pine', at: [-20.0, -20.0], trunkR: 1.0, canopyR: 13.0, crownBaseY: 6.0, crownTopY: 48.0, species: 'pine' },
    { id: 'rear-pine-b', at: [-18.0, -60.0], trunkR: 0.9, canopyR: 12.0, crownBaseY: 6.0, crownTopY: 46.0, species: 'pine' },
  ],

  neighbours: [
    {
      // Cream stucco with a gable end and a stucco chimney on its west face,
      // just clearing our garage corner in straight_on_view_of_house.
      id: 'nbr-east',
      poly: [
        [69.0, -6.0],
        [101.0, -6.0],
        [101.0, 28.0],
        [69.0, 28.0],
      ],
      eaveY: 9.0,
      ridgeY: 19.5,
      ridgeDir: 'ns',
      color: '#cdc0ab',
      roofColor: '#585c5e',
      chimney: { at: [69.4, 25.0], w: 3.2, d: 3.6, topY: 21.5 },
    },
    {
      // Beige lap siding over a red brick base, gable roof, seen through the
      // pine at the far left edge.
      id: 'nbr-west',
      poly: [
        [-46.0, 4.0],
        [-18.0, 4.0],
        [-18.0, 40.0],
        [-46.0, 40.0],
      ],
      eaveY: 9.5,
      ridgeY: 19.0,
      ridgeDir: 'ns',
      color: '#bfae97',
      brickBase: 3.6,
      roofColor: '#5b5145',
    },
    {
      id: 'nbr-rear',
      poly: [
        [-6.0, -110.0],
        [40.0, -110.0],
        [40.0, -86.0],
        [-6.0, -86.0],
      ],
      eaveY: 10.0,
      ridgeY: 19.0,
      color: '#a89d8c',
    },
  ],

  fence: {
    path: [
      [-24.0, -6.0],
      [-24.0, -80.0],
      [40.0, -80.0],
    ],
    h: 6.0,
    material: 'cedarWeathered',
  },

  /** Sun for the daylight exteriors (late-morning, early September, Michigan). */
  sun: { azimuthDeg: 138, altitudeDeg: 52, kelvin: 5400 },
};

/* =================================================================== */
/* 11. ACCESSORS                                                       */
/* =================================================================== */

/** [x, z] centre of a room's bounding box (plan space). */
export function roomCenter(id) {
  const r = ROOMS[id];
  if (!r) throw new Error(`dims.roomCenter: unknown room "${id}"`);
  return bboxCenter(r.bbox);
}

/**
 * 3-D box of a room.
 * { id, level, x0, z0, x1, z1, y0, y1, w, d, h, cx, cy, cz, area, poly }
 */
export function roomBox(id) {
  const r = ROOMS[id];
  if (!r) throw new Error(`dims.roomBox: unknown room "${id}"`);
  const [x0, z0, x1, z1] = r.bbox;
  const y0 = r.floorY;
  const y1 = r.ceilY;
  const [w, d] = bboxSize(r.bbox);
  return {
    id,
    level: r.level,
    x0,
    z0,
    x1,
    z1,
    y0,
    y1,
    w,
    d,
    h: y1 - y0,
    cx: (x0 + x1) / 2,
    cy: (y0 + y1) / 2,
    cz: (z0 + z1) / 2,
    area: r.areaComputed,
    poly: r.poly,
  };
}

export function wallsOnLevel(level) {
  return WALLS.filter((w) => w.level === level);
}

export function openingsOnWall(wallId) {
  return OPENINGS.filter((o) => o.wall === wallId);
}

/** Sum of room polygon areas on a level. */
export function levelArea(level, opts = {}) {
  const includeHidden = opts.hidden ?? true;
  const includeGarage = opts.garage ?? false;
  const includeVoids = opts.voids ?? false;
  let a = 0;
  for (const r of roomsOnLevel(level)) {
    if (!includeHidden && r.hidden) continue;
    if (!includeGarage && r.excludeFromLivingArea) continue;
    if (!includeVoids && r.isVoid) continue;
    a += r.areaComputed;
  }
  return a;
}

/**
 * Finished area of the first + second floors.
 *
 *   `named` — the plan's named living / sleeping / service rooms.  This is the
 *             number that behaves like marketed square footage.
 *   `halls` — the circulation the plan sheets happen to label as rooms.
 *   `total` — named + halls, i.e. every labelled room on both floors.
 *
 * The garage and the open-to-below void are always excluded.
 */
export function livingArea() {
  let named = 0;
  let halls = 0;
  for (const level of ['first', 'second']) {
    for (const r of roomsOnLevel(level)) {
      if (r.hidden || r.isVoid || r.excludeFromLivingArea) continue;
      if (r.label === 'Hall') halls += r.areaComputed;
      else named += r.areaComputed;
    }
  }
  return { named, halls, total: named + halls };
}

export default {
  LEVELS,
  CEIL,
  CEIL_Y,
  WALL,
  ASSEMBLY,
  LEVEL_KEYS,
  GRID,
  FOOTPRINTS,
  SECOND_FLOOR_EXCEPTIONS,
  ROOMS,
  ROOM_IDS,
  WALLS,
  WALL_BY_ID,
  OPENINGS,
  STEPS,
  COLUMNS,
  SKYLIGHTS,
  STAIRS,
  VOIDS,
  MASSING,
  SITE,
  roomCenter,
  roomBox,
  roomsOnLevel,
  wallsOnLevel,
  openingsOnWall,
  levelArea,
  livingArea,
};
