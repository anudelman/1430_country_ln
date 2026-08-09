export const meta = {
  name: 'room-loop',
  description: 'Build → screenshot → blind-critic → fix loop for a batch of house pieces until critics cannot tell the render from the listing photo',
  whenToUse: 'Pass args: { pieces: ["kitchen","dining"], rounds: 3 }',
  phases: [
    { title: 'Build', detail: 'construct/refine the room module and shoot it' },
    { title: 'Critique', detail: 'fresh hostile critic, blind A/B vs the real photo' },
    { title: 'Report', detail: 'roll up verdicts and update the progress page' },
  ],
};

const REPO = '/home/user/1430_country_ln';
const SCRATCH = '/tmp/claude-0/-home-user-1430-country-ln/8c0b6d4d-3c85-50a8-b302-efe59197f362/scratchpad';

// ---------------------------------------------------------------------------
// The judged pieces. `hero` is the camera preset the critic judges. `photos` are
// every listing photo that constrains this piece. `brief` is the owner's spec.
// ---------------------------------------------------------------------------
const ALL_PIECES = {
  'exterior-front': {
    title: 'Front elevation', level: 'exterior', hero: 'straight_on_view_of_house_from_street',
    photos: ['straight_on_view_of_house_from_street.png', 'front_leftside_of_house.png', 'front_rightside_of_house.png'],
    brief: `Two-story GRAY WEATHERED WOOD LAP SIDING (~8" exposure, silvery-gray, visibly weathered,
      not painted). Low-pitched roof with a deep flat fascia and a bold horizontal soffit overhang on
      the two-story entry box. The two-story mass is centered on the entry and carries a large ROUND
      PORTHOLE WINDOW high on the gable-less flat facade, with a tall narrow window to its left. The
      attached TWO-CAR GARAGE is a single-story wing on the RIGHT with a flat-panel door and a
      low-pitched shingle roof. Left wing is single story with windows behind rounded shrubs.
      Foreground: mown lawn with mower stripes, a large mature ornamental tree with a mulch ring,
      dark shredded mulch beds, rounded boxwood/privet hedges (several large rounded masses, one very
      large one right of the walk), a broom-finished concrete driveway curving in from the right, and
      a BLUESTONE FLAGSTONE walk to the stoop. Neighbouring houses just visible left and right.
      Sky: clear deep blue with faint high cirrus. Late-summer midday sun from the upper left.`,
  },
  'exterior-entry': {
    title: 'Front door', level: 'exterior', hero: 'exterior_view_of_front_door',
    photos: ['exterior_view_of_front_door.png'],
    brief: `BLACK front door, flat slab, with a ROUND FROSTED-GLASS PORTHOLE window centered high.
      Flanked BOTH sides by full-height sidelights fitted with WHITE PLANTATION SHUTTERS (louvers
      ~2.5", visible tilt rod). Black surround/reveal. BLUESTONE FLAGSTONE stoop and walk — irregular
      rectangular slabs, blue-gray, with tight mortar joints. Gray weathered lap siding around.
      Rounded hedges crowd both sides. Recessed soffit light above. A COIR "WELCOME HOME" DOORMAT
      lies on the stoop — one of only a handful of movable objects in the entire house.`,
  },
  'exterior-rear': {
    title: 'Rear elevation', level: 'exterior', hero: 'backyard_straight_on_view_of_house',
    photos: ['backyard_straight_on_view_of_house.png', 'backyard_1.png', 'backyard_mulch_grass_1.png'],
    brief: `Rear of the house: FLOOR-TO-CEILING WINDOW WALLS across the family room / breakfast nook /
      living room, white sliding glass doors and a white French door out to the deck. Same gray
      weathered lap siding. The second floor carries the wraparound SUNROOM as a dark timber
      post-and-beam glazed box. Composite gray deck, flagstone patio below, raised stacked-limestone
      planter wall, mature trees, lawn.`,
  },
  'deck-patio': {
    title: 'Deck & patio', level: 'exterior', hero: 'backyard_patio_1',
    photos: ['backyard_patio_1.png', 'backyard_patio_2.png', 'backyard_mulch_stone_steps.png',
             'view_from_breakfast_nook_looking_out_at_backyard_patio.png'],
    brief: `Gray COMPOSITE DECK boards with a simple railing, steps down to an irregular BLUESTONE
      FLAGSTONE patio. Raised STACKED-LIMESTONE planter wall retaining a mulch bed with plantings.
      Stone steps. Mature trees casting dappled light. Lawn beyond.`,
  },
  'fire-pit': {
    title: 'Stone fire pit', level: 'exterior', hero: 'backyard_fire_pit_1',
    photos: ['backyard_fire_pit_1.png', 'backyard_fire_pit_2.png', 'backyard_fire_pit_3.png'],
    brief: `A circular STACKED-STONE FIRE PIT RING set into / beside the raised stacked-limestone
      planter wall, on flagstone. Surrounding mulch and plantings, lawn, mature trees, dappled shade.`,
  },

  foyer: {
    title: 'Foyer', level: 'first', hero: 'foyer_view_of_front_door', dims: `12'5" x 13'2"`,
    photos: ['foyer_view_of_front_door.png'],
    brief: `RED OAK hardwood floors. Looking back at the black front door with its round frosted
      porthole from inside; the flanking sidelights carry WHITE PLANTATION SHUTTERS, and the front
      window wall has more plantation shutters. WHITE SIX-PANEL BYPASS CLOSET DOORS. White trim,
      white walls. OPEN TO A TWO-STORY STAIR HALL — the ceiling above is the second floor's, with the
      upper hall railing visible. Recessed lights.`,
  },
  kitchen: {
    title: 'Kitchen', level: 'first', hero: 'kitchen_view_1', dims: `17'5" x 10'4"`,
    photos: ['kitchen_view_1.png', 'kitchen_view_2.png', 'kitchen_view_3.png', 'Kitchen_view_4.png',
             'kitchen_view_5.png'],
    brief: `TWO-TONE. LOWER cabinets and the ISLAND BASE are LIGHT NATURAL CHERRY/OAK — flat recessed
      panel doors and drawers, visible straight grain, warm honey tone — with slim BRASS/GOLD BAR
      PULLS. UPPER cabinets are a painted WARM GREIGE / MUSHROOM (NOT bright white — check the photo,
      they are a soft warm gray-beige) with recessed panel doors and DARK BRONZE/BLACK bar pulls, and
      they run to the ceiling with a slim crown. A matching painted HOOD SURROUND with a tapered
      chimney sits over the range, its underside showing a stainless liner and grille. Counters are
      WHITE QUARTZ with soft gray veining, ~1.25" eased edge. FULL-HEIGHT QUARTZ SLAB BACKSPLASH in
      the same stone, running counter to uppers with continuous veining. Appliances: stainless
      SLIDE-IN GAS RANGE (5 burners, cast grates, control knobs on the front bullnose, oven window),
      stainless DISHWASHER, and a PANEL-FLANKED BUILT-IN STAINLESS FRIDGE with a horizontal louvered
      GRILLE PANEL above it, boxed in by painted tall cabinets. Gooseneck spring-coil faucet in black
      + brass over an undermount sink. Two PENDANTS over the island: BLACK CONE SHADES on BRASS
      CHAINS with brass canopies. RED OAK floors. Flat white ceiling with 6" RECESSED CANS. White
      outlets with brass/dark screws visible on the backsplash and island end.`,
  },
  'breakfast-nook': {
    title: 'Breakfast nook', level: 'first', hero: 'kitchen_breakfast_nook', dims: `13'11" x 16'1"`,
    photos: ['kitchen_breakfast_nook.png', 'view_from_breakfast_nook_looking_out_at_backyard_patio.png'],
    brief: `Open to the kitchen and family room. RED OAK floors, CROWN MOLDING, recessed lights.
      Opens to the REAR WINDOW WALL — white sliding glass doors plus a French door out to the deck.
      THE ROOM IS EMPTY — no table, no chairs, no staging of any kind.`,
  },
  dining: {
    title: 'Dining room', level: 'first', hero: 'dining_room', dims: `13'11" x 10'11"`,
    photos: ['dining_room.png'],
    brief: `ANGLED BAY WALLS (canted corners — model as a polygon, not a rectangle). CROWN MOLDING.
      A THREE-PANEL CASEMENT WINDOW in the bay. A BLACK-AND-BRASS SPUTNIK GLOBE CHANDELIER (radiating
      arms ending in frosted glass globes). A RECESSED NICHE WITH SHELVING in one wall. RED OAK floors.`,
  },
  // NOTE: the listing photo FILENAMES are swapped relative to the floor plan LABELS.
  // Piece ids follow the PHOTO FILENAMES (matching docs/DETAILS.md and status.json):
  //   piece `family` = the FIREPLACE room   = floor plan "LIVING ROOM"  18'11" x 18'2"
  //   piece `living` = the REAR-WINDOW room = floor plan "FAMILY ROOM"  12'1"  x 19'8"
  family: {
    title: 'Fireplace room (plan: LIVING ROOM)', level: 'first', hero: 'family_room_1',
    dims: `18'11" x 18'2"  — plan label "LIVING ROOM"`,
    photos: ['family_room_1.png', 'family_room_2.png', 'family_room_3.png'],
    brief: `THE ROOM WITH THE FIREPLACE. This piece is called "family" after the photo filenames, but
      on the floor plan it is the LIVING ROOM, 18'11" x 18'2" — use that room in dims.js.
      A CORNER GAS FIREPLACE built of DRY-STACKED LEDGESTONE set across a canted corner, with a LIT
      GAS FIRE behind the glass, a RAISED STONE HEARTH BENCH wrapping the base, and a freestanding
      ROUND BLACK FLUE PIPE (~10") rising from the stone to the ceiling. TWO short awning/casement
      windows flank the flue directly above the stone, one on each canted face. A tall casement
      window on the left wall looking out to lawn and shrubs, another on the right wall. At the right
      edge the WET BAR is just visible: near-black slab cabinets, black stone top, bar sink,
      lit glass-door wine fridge. CROWN MOLDING throughout. RED OAK floors running north-south with a
      strong anisotropic sheen streaking toward the windows. Bronze/oak-finish floor registers set
      into the oak. White 5.25" baseboard, white casings with a mitered head cap. 6" white recessed
      cans on a non-symmetrical grid. THE ROOM IS COMPLETELY EMPTY — no furniture whatsoever.`,
  },
  living: {
    title: 'Rear-window room (plan: FAMILY ROOM)', level: 'first',
    hero: 'view_from_kitchen_of_living_room_looking_out_to_backyard',
    dims: `12'1" x 19'8"  — plan label "FAMILY ROOM"`,
    photos: ['view_from_kitchen_of_living_room_looking_out_to_backyard.png'],
    brief: `THE ROOM WITH THE REAR WINDOW WALL. This piece is called "living" after the photo
      filename, but on the floor plan it is the FAMILY ROOM, 12'1" x 19'8" — use that room in
      dims.js. It is SUNKEN one ~7" step down from the kitchen/hall level.
      A REAR WINDOW WALL of white-framed floor-to-ceiling glass: a run of large fixed/slider panels
      plus a WHITE FRENCH DOOR with a brass lever handle at the right, opening onto the composite
      deck. A SINGLE SQUARE WHITE SUPPORT COLUMN stands mid-room in front of the glass. CROWN
      MOLDING. RED OAK floors with heavy specular sheen from the window wall. A small high transom
      window on the far left wall. Beyond the glass: the deck with its railing and a bench, a wood
      fence, a very large mature tree, lawn. The kitchen cabinetry intrudes at the left edge of frame.
      THE ROOM IS COMPLETELY EMPTY — no furniture whatsoever.`,
  },
  mudroom: {
    title: 'Mudroom / laundry', level: 'first', hero: 'mudroom_1', dims: `12'2" x 7'11"`,
    photos: ['mudroom_1.png'],
    brief: `LIGHT PLANK FLOORING (gray-beige wood-look, ~7" boards). SLATE BLUE / BLUE-GRAY SHAKER
      UPPER CABINETS with a BUTCHER BLOCK LEDGE beneath them. WHITE QUARTZ counter. UTILITY SINK.
      FRONT-LOAD LG WASHER AND DRYER (white/graphite, big round glass doors, digital panels).
      An EXTERIOR DOOR with a BLIND-INSERT WINDOW (mini blinds between the glass).`,
  },
  'bed-first': {
    title: 'First-floor bedroom', level: 'first', hero: 'bedroom_first_floor_1', dims: `17'3" x 11'8"`,
    photos: ['bedroom_first_floor_1.png', 'bedroom_first_floor_2.png'],
    brief: `WHITE SIX-PANEL BYPASS CLOSET DOORS, RED OAK floors, RECESSED LIGHTS, white trim and
      baseboard, windows with white treatment.`,
  },
  'bath-first': {
    title: 'First-floor bath', level: 'first', hero: 'bathroom_first_floor_1', dims: `5'4" x 8'10"`,
    photos: ['bathroom_first_floor_1.png'],
    brief: `BEIGE MARBLE-LOOK TILE walk-in shower with a MOSAIC ACCENT BAND and a FRAMELESS GLASS
      DOOR. An OBSCURED GLASS WINDOW inside the shower. GREIGE SHAKER VANITY with a WHITE QUARTZ top.
      A ROUNDED RECTANGULAR MIRROR. CHROME fixtures.`,
  },

  'upper-hall': {
    title: 'Upper hall', level: 'second', hero: 'hallway_top_of_stairs_looking_down_at_front_door',
    dims: `11'5" x 9'1"`,
    photos: ['hallway_top_of_stairs_looking_down_at_front_door.png'],
    brief: `Open to below over the two-story foyer. VAULTED CEILING WITH A SKYLIGHT. An OVAL WINDOW.
      A GOLD DANDELION / SPUTNIK BURST CHANDELIER hanging in the volume. WHITE OAK RAILING with BLACK
      SQUARE BALUSTERS. Looking down the stair at the front door far below.`,
  },
  'primary-bed': {
    title: 'Primary bedroom', level: 'second', hero: 'master_bedroom_1', dims: `11'7" x 21'7"`,
    photos: ['master_bedroom_1.png', 'master_bedroom_2.png', 'master_bedroom_3.png'],
    brief: `FULL-HEIGHT VERTICAL WOOD SLAT ACCENT WALL on a BLACK BACKING — slats are real geometry,
      evenly spaced, warm wood, with the black recess reading between them. TAN CARPET. RECESSED
      LIGHTS. Sliding/glass access toward the wraparound sunroom.`,
  },
  'primary-bath': {
    title: 'Primary bath', level: 'second', hero: 'master_bedroom_bathroom_view_1', dims: `12'11" x 13'9"`,
    photos: ['master_bedroom_bathroom_view_1.png', 'master_bedroom_bathroom_view_2.png'],
    brief: `A LARGE SKYLIGHT in a splayed white well. BROWN/BRONZE METALLIC-LOOK PORCELAIN tile —
      large format on the walls of the shower and the tub surround with a cloudy metallic sheen, and a
      warmer terracotta-brown tile on the FLOOR with visible grout joints. A TILED DROP-IN JACUZZI TUB
      DECK with a dark stone cap. A GLASS CORNER SHOWER with recessed cans inside it. A MOSAIC ACCENT
      BAND running at about 4 ft. CHERRY DOUBLE VANITY with a BLACK GRANITE top and a BACKLIT SLATTED
      WOOD WALL behind the mirrors. BLACK fixtures and black square wall plates. SLIDING GLASS DOORS
      to the sunroom (white frame, dark sash) showing the dark slatted sunroom deck and trees beyond.
      A SEPARATE WATER CLOSET behind a white six-panel door with black hinges and lever. White walls,
      white baseboard.`,
  },
  sunroom: {
    title: 'Sunroom / wraparound patio', level: 'second',
    hero: 'master_bedroom_wrap-around_indoor_patio_from_bedroom_to_bathroom', dims: `24'9" x 4'11"`,
    photos: ['master_bedroom_wrap-around_indoor_patio_from_bedroom_to_bathroom.png'],
    brief: `A long narrow enclosed indoor patio running from the primary bedroom to the primary bath.
      DARK TIMBER POST-AND-BEAM WINDOW WALL — heavy dark wood posts and beams framing full-height
      glazing. SLATTED GRAY DECK FLOORING with visible gaps between boards. Trees and lawn outside.`,
  },
  'bed-second': {
    title: 'Secondary bedrooms', level: 'second', hero: 'bedroom_second_floor_1',
    dims: `12'5" x 12'9" / 13'2" x 13'2" / 10'10" x 13'2"`,
    photos: ['bedroom_second_floor_1.png', 'bedroom_second_floor_kid-1_1.png', 'bedroom_second_floor_kid-2_1.png'],
    brief: `Three more bedrooms plus the W.I.C. (13'11" x 7'6"). Carpet or wood per the photos, white
      trim, closets, windows with white treatment, ceiling fixtures per the photos.`,
  },
  'bath-second': {
    title: 'Hall bath', level: 'second', hero: 'bathroom_second_floor_1', dims: `5'2" x 7'5"`,
    photos: ['bathroom_second_floor_1.png'],
    brief: `Second-floor hall bath — match the photo exactly for tile, vanity, tub/shower, mirror and
      fixtures. There are two hall baths (5'2" x 7'5" and 5'2" x 5'6").`,
  },

  'basement-rec': {
    title: 'Recreation room', level: 'basement', hero: 'basement_view_1', dims: `37'1" x 20'1"`,
    photos: ['basement_view_1.png', 'basement_view_2_looking_at_workout_room.png',
             'basement_view_3.png', 'basement_view_4.png'],
    brief: `BEIGE CARPET, WHITE WALLS, TWO TURNED OAK SUPPORT POSTS, RECESSED LIGHTS, DROP BEAMS
      crossing the ceiling. The stair up to the first floor with a WHITE SPINDLE RAIL. Egress windows
      high on the wall.`,
  },
  'basement-gym': {
    title: 'Workout room', level: 'basement', hero: 'basement_workout_room', dims: `11'6" x 11'9"`,
    photos: ['basement_workout_room.png'],
    brief: `DARK GRAY RUBBER FLOOR (speckled). A FULL MIRRORED WALL / PARTITION — real reflections
      matter here, the mirror must reflect the room correctly. DROP CEILING with a FLUORESCENT PANEL.`,
  },
  'basement-bath': {
    title: 'Basement bath', level: 'basement', hero: 'basement_bathroom', dims: `35 sq ft`,
    photos: ['basement_bathroom.png'],
    brief: `Small basement bathroom, 35 sq ft — match the photo exactly.`,
  },
};

const CRITIC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['render_is', 'confidence', 'reasoning', 'biggest_gap', 'ranked_gaps', 'verdict_if_fixed'],
  properties: {
    render_is: { type: 'string', enum: ['A', 'B', 'CANNOT_TELL'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    reasoning: { type: 'string' },
    biggest_gap: { type: 'string' },
    ranked_gaps: { type: 'array', items: { type: 'string' }, maxItems: 6 },
    verdict_if_fixed: { type: 'string' },
  },
};

function criticPrompt(dir) {
  return `You are a hostile image-forensics expert and an architectural photographer with 20 years
in real-estate marketing. Your reputation rests on never being fooled by a render.

Read these two images and study them at length:
  ${dir}/A.png
  ${dir}/B.png

EXACTLY ONE of them is a photograph taken with a real camera. The other is a 3D render that is
trying to pass as that photograph. They show the same room from the same viewpoint.

Do not read any other file. Do not list directories, search the filesystem, or run any command.
Use only the Read tool on those two image paths. There is no other context available to you and
you must not seek any — the judgement must come from the pixels alone.

Hunt for the tell. Assume by default that you CAN find it. Examine in particular:
1. LIGHT TRANSPORT — contact shadows where objects meet the floor; soft shadow gradients under
   cabinets, counters and furniture; colour bleed from a rug or a wall onto adjacent surfaces;
   falloff across a large wall (renders wash flat where photographs gradate); specular highlights
   whose shape does not match the light that made them; light leaking through geometry.
2. MATERIALS AT GRAZING ANGLES — real satin polyurethane on oak smears a long anisotropic sheen
   toward the window; CG floors read uniformly matte or uniformly glossy. Quartz veining must sit
   UNDER a clear surface with real depth. Painted millwork has faint orange-peel. Carpet has nap
   direction. Stainless has directional brush and picks up the room.
3. GEOMETRY — edges that are perfectly sharp (real edges carry a fine highlight); repeated objects
   that are pixel-identical; pixel-perfect symmetry; intersecting or floating geometry; zero-width
   gaps; trim that miters impossibly.
4. OPTICS — vignetting, chromatic fringing on high-contrast edges, depth of field, diffraction on
   bright window frames, and sensor noise in the shadows. Renders are often too clean in the darks
   and too abruptly clipped in the brights.
5. WINDOW BLOWOUT — a bracketed listing photo keeps some detail and a colour cast outside; renders
   either clip to paper white or show an implausibly crisp exterior.
6. THE LIVED-IN TAX — dust, scuffs on the baseboard, an outlet very slightly off level, switch
   plates, vent registers, a smoke detector, a thermostat, a door stop, caulk lines, grout that
   varies, cords. Renders are suspiciously tidy, suspiciously complete, and suspiciously new.
7. COMPOSITION — a professional shoots from a fixed height with verticals corrected. Converging
   verticals or an off-level horizon in one image is itself a tell.

Then answer. If you genuinely cannot tell, answer CANNOT_TELL — do not guess to look decisive. But
do not say it to be generous either: if you can tell, say so and say exactly how.

For "biggest_gap": name the SINGLE most damaging difference — the one change that would most
improve the weaker image's chance of passing. Be concrete and actionable: name the surface, the
object, the material or the light, and say what is wrong with it and what it should look like.
Do not give vague advice like "improve realism".`;
}

function builderPrompt(p, round, prev, orderLetter, criticDir) {
  const isFirst = round === 1;
  return `You are building ONE piece of a photoreal Three.js walkthrough of a real house, in the git
repo ${REPO} (branch claude/3d-house-walkthrough-esjiau).

READ FIRST, in this order:
  ${REPO}/docs/CONVENTIONS.md   (binding contract: units, axes, module layout, render settings)
  ${REPO}/docs/CRITIC.md        (how your work will be judged)
  ${REPO}/docs/DETAILS.md       (exhaustive real-world detail checklist — read the GLOBAL RULES
                                 section AND your own piece's section; it lists every outlet,
                                 register, hinge, baseboard height, grout width and imperfection
                                 that a camera catches, and it records exactly what IS and IS NOT
                                 present in each room)
  ${REPO}/docs/PHOTOGRAPHY.md   (the camera and grade we must match — lens, height, exposure,
                                 black point, window blowout, noise, and the tuning table)
  ${REPO}/app/src/core/dims.js  (authoritative geometry — never contradict it)

YOUR PIECE: "${p.id}" — ${p.title}${p.dims ? ` (${p.dims})` : ''} on the ${p.level} level.

OWNER'S SPEC (must all be true when you are done):
${p.brief}

GROUND TRUTH PHOTOS — study every one of these with the Read tool before you write any code, and
go back to them repeatedly while you work:
${p.photos.map(f => `  ${REPO}/listing_photos/${f}`).join('\n')}

The hero camera preset judged this round is "${p.hero}", matching
${REPO}/listing_photos/${p.hero}.png.

${isFirst ? `THIS IS ROUND 1. Create ${REPO}/app/src/rooms/${p.id}.js following the room module
contract in CONVENTIONS.md (export const meta, export function build(ctx)). Register it in
${REPO}/app/src/core/registry.js (create or extend that file). Use the shared libraries — do NOT
reinvent materials, cabinets, doors, windows, trim or lights:
  ctx.mat   materials (app/src/core/materials.js)
  ctx.tex   procedural textures (app/src/core/textures.js)
  ctx.kit   parametric components (app/src/core/kit.js)
  ctx.lights lighting rigs (app/src/core/lighting.js)
If something you need is genuinely missing from the kit, ADD it to the kit rather than inlining a
one-off, so other rooms benefit — but do not break existing kit signatures.`
: `THIS IS ROUND ${round}. ${REPO}/app/src/rooms/${p.id}.js already exists. A blind critic compared
your last render against the real listing photo and CORRECTLY PICKED OUT YOUR RENDER.

Its verdict (confidence ${prev.confidence}):
  BIGGEST GAP: ${prev.biggest_gap}
  How it knew: ${prev.reasoning}
  Other gaps, ranked: ${(prev.ranked_gaps || []).map((g, i) => `\n    ${i + 1}. ${g}`).join('')}
  Would fixing the biggest gap flip it: ${prev.verdict_if_fixed}

FIX THE BIGGEST GAP FIRST and properly — not cosmetically. Then work down the ranked list as far as
you can. Do not regress anything that already matched.`}

*** THE HOUSE IS VACANT. THIS OVERRIDES EVERYTHING. ***
This house was photographed EMPTY, before staging. There is NO furniture, NO rugs, NO art, NO
plants, NO curtains, NO towels, NO countertop items, NO bedding — in ANY room. The floor plans show
furniture, but the floor plans are marketing illustrations and are WRONG about contents. The photos
are the truth. An empty room rendered with a sofa in it loses the blind test in one second.

The ONLY movable objects anywhere in the 47 photographs are: the coir "welcome home" doormat at the
front door, the LG front-load washer and dryer, the kitchen appliances plus the wine fridge in the
wet bar, the toilets, and one swing-arm magnifying mirror in the primary bath. Build those. Build
nothing else that is not attached to the house.

What fills these photographs instead is ARCHITECTURE and LIGHT: the floor, the trim, the cabinetry,
the tile, the glass, the way daylight rakes across an empty wall and streaks along the oak. That is
where all your effort goes. An empty room is HARDER to fake, not easier — there is nowhere to hide.

CRAFT RULES (these are what separate a render from a photograph):
- Model to the real dimensions in dims.js. If dims.js is wrong for your room, fix dims.js and
  re-run node tools/check_dims.mjs until it prints DIMS OK.
- NEVER use a raw BoxGeometry for anything visible. Every edge gets a bevel/chamfer — sharp CG
  edges are the single most common giveaway.
- Real-world detail is mandatory: outlets and switch plates, HVAC vent registers, a smoke detector,
  door stops, hinges, caulk lines at tile and counter, baseboard scribe, cabinet reveals of 1/8",
  grout that varies slightly, screw slots on plates.
- Nothing is perfectly symmetric and nothing is perfectly clean. Introduce small, believable
  irregularity — but never sloppiness.
- Light the room the way the photographer did: every artificial fixture ON even in daylight, window
  daylight pouring in via windowLight(), and an ambient fill that OPENS the shadows the way a
  bracketed exposure does. A single-sun render always looks CG.
- Materials must be the shared procedural ones at correct real-world scale (ctx.tex / applyUV).

WHEN THE GEOMETRY IS IN, ITERATE ON YOUR OWN BEFORE SUBMITTING — this is the important part:
  1. node ${REPO}/tools/shoot.mjs --preset ${p.hero} --quality high
  2. Read the produced render AND ${REPO}/listing_photos/${p.hero}.png side by side yourself.
  3. Be your own harshest critic. List what differs. Fix it. Repeat.
  Do at least THREE such self-iterations before you hand off. A round wasted on something you could
  have seen yourself is a round wasted.

If the camera preset "${p.hero}" does not frame the same view as the real photo, FIX THE PRESET in
${REPO}/app/cameras.json — position, yaw, vertical FOV and lens shift — until the framing matches
the photograph closely (same walls visible, same amount of ceiling and floor, same apparent lens
width). Verticals must stay perfectly vertical (see camera.js makeShiftCamera).

WHEN YOU ARE SATISFIED, hand off for blind judging — run exactly this:
  node ${REPO}/tools/shoot.mjs --preset ${p.hero} --quality high --out ${REPO}/renders/${p.hero}.png
  node ${REPO}/tools/blind.mjs --piece ${p.id} --round ${round} --order ${orderLetter} \\
      --photo ${REPO}/listing_photos/${p.hero}.png \\
      --render ${REPO}/renders/${p.hero}.png \\
      --criticdir ${criticDir}
  node ${REPO}/tools/status.mjs set ${p.id} --round ${round} --render renders/${p.hero}.png
  node ${REPO}/tools/progress.mjs
Then commit your work: git add -A && git commit -m "${p.id}: round ${round}". Do not push.

Report back concisely: what you built/changed this round, what you fixed from the critique, what
you still think is weak, and confirm the render PNG exists and is non-blank.`;
}

// ---------------------------------------------------------------------------

const pieceIds = (args && args.pieces) || Object.keys(ALL_PIECES);
const ROUNDS = (args && args.rounds) || 3;
const pieces = pieceIds.map(id => ({ id, ...ALL_PIECES[id] })).filter(p => p.title);

log(`Looping ${pieces.length} piece(s) × up to ${ROUNDS} round(s): ${pieces.map(p => p.id).join(', ')}`);

const outcomes = await pipeline(pieces, async (p, _orig, idx) => {
  let prev = null;
  let passes = 0;
  const history = [];

  for (let round = 1; round <= ROUNDS; round++) {
    // The orchestrator picks which letter is the render, so the answer key lives
    // here in memory and never touches a file the critic could read.
    const orderLetter = ((idx + round) % 2 === 0) ? 'A' : 'B';
    const criticDir = `${SCRATCH}/blind/${p.id}/r${round}`;

    const built = await agent(builderPrompt(p, round, prev, orderLetter, criticDir), {
      label: `build:${p.id}#${round}`, phase: 'Build',
    });
    if (!built) { log(`${p.id} round ${round}: builder produced nothing, aborting piece`); break; }

    const v = await agent(criticPrompt(criticDir), {
      label: `critic:${p.id}#${round}`, phase: 'Critique', schema: CRITIC_SCHEMA,
    });
    if (!v) { log(`${p.id} round ${round}: critic failed`); continue; }

    const spotted = v.render_is === orderLetter && v.confidence >= 0.5;
    const fooled = v.render_is !== 'CANNOT_TELL' && v.render_is !== orderLetter;
    const status = spotted ? 'PICKED_RENDER'
                 : fooled ? 'PICKED_PHOTO_AS_RENDER'
                 : 'UNSURE';

    history.push({ round, status, confidence: v.confidence, gap: v.biggest_gap });
    log(`${p.id} r${round}: ${status} (critic said ${v.render_is}, truth ${orderLetter}, conf ${v.confidence}) — ${v.biggest_gap}`);

    if (spotted) { passes = 0; prev = v; }
    else {
      passes++;
      prev = v; // keep polishing against the residual gaps even when we pass
      if (passes >= 2) {
        log(`${p.id}: PASSED — two consecutive critics could not identify the render.`);
        return { id: p.id, status, rounds: round, history, finalGap: v.biggest_gap };
      }
    }
  }
  return {
    id: p.id,
    status: history.length ? history[history.length - 1].status : 'NO_RESULT',
    rounds: history.length, history,
    finalGap: prev ? prev.biggest_gap : null,
  };
});

phase('Report');
const clean = outcomes.filter(Boolean);
const summary = clean.map(o => `${o.id}: ${o.status} after ${o.rounds} round(s) — residual: ${o.finalGap}`).join('\n');

await agent(`Batch of house pieces just finished their build/critique loops in ${REPO}.

Results:
${summary}

YOUR TASK:
1. For every piece above, make sure ${REPO}/status.json carries its final round, verdict and the
   critic's residual gap (use node tools/status.mjs set <id> --round N --verdict V --gap "...").
   Verdict values: PICKED_RENDER (critic spotted us), UNSURE (pass), PICKED_PHOTO_AS_RENDER (fooled).
2. Regenerate the dashboard: node tools/progress.mjs
3. Verify every referenced render PNG actually exists and is non-blank; report any that do not.
4. git add -A && git commit -m "round results: <piece list>". Do not push.
Return the per-piece table and a blunt assessment of which pieces are furthest from passing.`,
  { label: 'report', phase: 'Report' });

return clean;
