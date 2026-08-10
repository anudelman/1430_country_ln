/**
 * app/src/core/registry.js — the room registry.
 *
 * One entry per JUDGED PIECE (docs/CONVENTIONS.md §7, docs/DETAILS.md §0,
 * status.json). The registry is the ONLY place that knows which
 * `app/src/rooms/<id>.js` modules exist, because a browser cannot glob a
 * directory and `tools/bundle.mjs` can only rewrite LITERAL import specifiers.
 *
 * ---------------------------------------------------------------------------
 * ADDING YOUR ROOM  (this is the whole contract)
 * ---------------------------------------------------------------------------
 * 1. Write `app/src/rooms/<id>.js` exporting:
 *
 *        export const meta = { id, title, level, photos: [...] };
 *        export function build(ctx) { ... }        // synchronous, ctx.group only
 *
 * 2. Uncomment (or add) your one line in LOADERS below. Nothing else.
 *
 * A piece with no LOADERS line still appears in PIECES — the HUD lists it and
 * `status.json` tracks it — it simply contributes no geometry beyond the shell.
 * Do NOT add a loader for a file that does not exist: the dynamic import fails,
 * `main.js` records a warning, and every screenshot of that level prints it.
 *
 * ---------------------------------------------------------------------------
 * WHAT main.js CONSUMES
 * ---------------------------------------------------------------------------
 *   roomsOnLevel(level) -> [{ id, level, title, load }]
 * `load` is awaited and its `build` called with a fresh sub-group. `REGISTRY`
 * is exported too, for tools that would rather have the table.
 */

/* ======================================================================== */
/* 1. The 23 judged pieces                                                   */
/* ======================================================================== */

/**
 * `dims` names the dims.js ROOMS this piece is responsible for. Note the two
 * deliberately swapped ids (CONVENTIONS §0.1): piece `family` builds the plan's
 * LIVING ROOM and piece `living` builds the plan's FAMILY ROOM.
 */
export const PIECES = [
  { id: 'exterior-front', title: 'Front elevation', level: 'exterior', hero: 'straight_on_view_of_house_from_street', dims: [] },
  { id: 'exterior-entry', title: 'Front door / entry', level: 'exterior', hero: 'exterior_view_of_front_door', dims: [] },
  { id: 'exterior-rear', title: 'Rear elevation / yard', level: 'exterior', hero: 'backyard_straight_on_view_of_house', dims: [] },
  { id: 'deck-patio', title: 'Deck & patio', level: 'exterior', hero: 'backyard_patio_1', dims: [] },
  { id: 'fire-pit', title: 'Fire pit', level: 'exterior', hero: 'backyard_fire_pit_1', dims: [] },

  { id: 'foyer', title: 'Foyer', level: 'first', hero: 'foyer_view_of_front_door', dims: ['foyer', 'foyerClosets'] },
  { id: 'kitchen', title: 'Kitchen', level: 'first', hero: 'kitchen_view_1', dims: ['kitchen', 'pantryRun'] },
  { id: 'breakfast-nook', title: 'Breakfast nook', level: 'first', hero: 'kitchen_breakfast_nook', dims: ['breakfastNook', 'nookPassage'] },
  { id: 'dining', title: 'Dining room', level: 'first', hero: 'dining_room', dims: ['diningRoom'] },
  { id: 'living', title: 'Living room (plan: FAMILY ROOM)', level: 'first', hero: 'view_from_kitchen_of_living_room_looking_out_to_backyard', dims: ['familyRoom'] },
  { id: 'family', title: 'Family room (plan: LIVING ROOM)', level: 'first', hero: 'family_room_1', dims: ['livingRoom', 'wetBar', 'fireplaceChase'] },
  { id: 'mudroom', title: 'Mudroom / laundry', level: 'first', hero: 'mudroom_1', dims: ['laundry'] },
  { id: 'bed-first', title: 'First-floor bedroom', level: 'first', hero: 'bedroom_first_floor_1', dims: ['bedroom1', 'bedroomVestibule'] },
  { id: 'bath-first', title: 'First-floor bath', level: 'first', hero: 'bathroom_first_floor_1', dims: ['bath1', 'bathLinen'] },

  { id: 'upper-hall', title: 'Upper hall / stairs', level: 'second', hero: 'hallway_top_of_stairs_looking_down_at_front_door', dims: ['hallUpper', 'hallUpperEast', 'hallLanding', 'entryVoid'] },
  { id: 'primary-bed', title: 'Primary bedroom', level: 'second', hero: 'master_bedroom_1', dims: ['primaryBedroom', 'primaryBuiltIn', 'primaryWindowSeat', 'wic'] },
  { id: 'primary-bath', title: 'Primary bath', level: 'second', hero: 'master_bedroom_bathroom_view_1', dims: ['primaryBath', 'primaryWC'] },
  { id: 'sunroom', title: 'Wrap-around sunroom', level: 'second', hero: 'master_bedroom_wrap-around_indoor_patio_from_bedroom_to_bathroom', dims: ['sunroom'] },
  { id: 'bed-second', title: 'Second-floor bedrooms', level: 'second', hero: 'bedroom_second_floor_1', dims: ['bedroom2', 'bedroom3', 'bedroom4'] },
  { id: 'bath-second', title: 'Second-floor bath', level: 'second', hero: 'bathroom_second_floor_1', dims: ['bath2', 'bath3'] },

  { id: 'basement-rec', title: 'Basement rec room', level: 'basement', hero: 'basement_view_1', dims: ['recreationRoom'] },
  { id: 'basement-gym', title: 'Basement gym', level: 'basement', hero: 'basement_workout_room', dims: ['gym'] },
  { id: 'basement-bath', title: 'Basement bath', level: 'basement', hero: 'basement_bathroom', dims: ['basementBath'] },
];

export const PIECE_BY_ID = Object.fromEntries(PIECES.map((p) => [p.id, p]));

/* ======================================================================== */
/* 2. Which room modules actually exist                                      */
/* ======================================================================== */

/**
 * id -> () => import('../rooms/<id>.js')
 *
 * EVERY specifier must be a string literal written out in full — the bundler
 * rewrites literals and cannot follow a variable or a template string.
 */
export const LOADERS = {
  // ---- exterior ---------------------------------------------------------
  'exterior-front': () => import('../rooms/exterior-front.js'),
  'exterior-entry': () => import('../rooms/exterior-entry.js'),
  'exterior-rear': () => import('../rooms/exterior-rear.js'),
  'deck-patio': () => import('../rooms/deck-patio.js'),
  // 'fire-pit':        () => import('../rooms/fire-pit.js'),
  // ---- first ------------------------------------------------------------
  // 'foyer':           () => import('../rooms/foyer.js'),
  // 'kitchen':         () => import('../rooms/kitchen.js'),
  // 'breakfast-nook':  () => import('../rooms/breakfast-nook.js'),
  // 'dining':          () => import('../rooms/dining.js'),
  // 'living':          () => import('../rooms/living.js'),
  // 'family':          () => import('../rooms/family.js'),
  // 'mudroom':         () => import('../rooms/mudroom.js'),
  // 'bed-first':       () => import('../rooms/bed-first.js'),
  // 'bath-first':      () => import('../rooms/bath-first.js'),
  // ---- second -----------------------------------------------------------
  // 'upper-hall':      () => import('../rooms/upper-hall.js'),
  // 'primary-bed':     () => import('../rooms/primary-bed.js'),
  // 'primary-bath':    () => import('../rooms/primary-bath.js'),
  // 'sunroom':         () => import('../rooms/sunroom.js'),
  // 'bed-second':      () => import('../rooms/bed-second.js'),
  // 'bath-second':     () => import('../rooms/bath-second.js'),
  // ---- basement ---------------------------------------------------------
  // 'basement-rec':    () => import('../rooms/basement-rec.js'),
  // 'basement-gym':    () => import('../rooms/basement-gym.js'),
  // 'basement-bath':   () => import('../rooms/basement-bath.js'),
};

/* ======================================================================== */
/* 3. Accessors                                                              */
/* ======================================================================== */

/** id -> { id, title, level, hero, dims, load? } for every piece. */
export const REGISTRY = Object.fromEntries(
  PIECES.map((p) => [p.id, LOADERS[p.id] ? Object.assign({}, p, { load: LOADERS[p.id] }) : Object.assign({}, p)])
);

/** Pieces with a real module, on this level. main.js calls exactly this. */
export function roomsOnLevel(level) {
  return PIECES.filter((p) => p.level === level && LOADERS[p.id])
    .map((p) => Object.assign({}, p, { load: LOADERS[p.id] }));
}

/** Every piece on a level, module or not — for HUDs and progress tooling. */
export function piecesOnLevel(level) {
  return PIECES.filter((p) => p.level === level);
}

export function hasRoomModule(id) {
  return !!LOADERS[id];
}

export const LEVELS_WITH_PIECES = ['exterior', 'first', 'second', 'basement'];

export default REGISTRY;
