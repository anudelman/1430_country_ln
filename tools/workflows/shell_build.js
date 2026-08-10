export const meta = {
  name: 'house-shell',
  description: 'Build the house shell from dims.js: interior walls/floors/ceilings/openings, stairs, exterior massing and roof, and the site',
  phases: [
    { title: 'Shell', detail: 'interior enclosure, stairs, exterior massing, site' },
    { title: 'Assemble', detail: 'compose into one scene and prove it renders from real cameras' },
  ],
};

const REPO = '/home/user/1430_country_ln';

const COMMON = `
Repo: ${REPO}, branch claude/3d-house-walkthrough-esjiau.
We are building a Three.js walkthrough that must be INDISTINGUISHABLE from the professional listing
photos in listing_photos/.

READ FIRST:
  ${REPO}/docs/CONVENTIONS.md   binding contract — units (1 unit = 1 foot), axes (+X plan-right,
                                +Z toward the street, Y up), level datums, module layout
  ${REPO}/docs/CRITIC.md        how the work is judged
  ${REPO}/docs/PHOTOGRAPHY.md   the camera/grade we must match (if present)
  ${REPO}/docs/DETAILS.md       exhaustive per-room real-world detail checklist (if present)
  ${REPO}/app/src/core/dims.js  AUTHORITATIVE geometry. Never contradict it. If it is wrong, fix it
                                and re-run node tools/check_dims.mjs until it prints DIMS OK.

Use the shared libraries; do not reinvent them:
  app/src/core/materials.js  app/src/core/textures.js  app/src/core/kit.js  app/src/core/lighting.js

Hard rules: three.js 0.180 via the bare specifier 'three'. No network assets, no binary asset files.
No raw BoxGeometry on anything visible — every edge gets a bevel. Real, complete, working code.
Screenshot yourself with  node tools/shoot.mjs --preset <id> --quality high  and Read the PNG.
`;

phase('Shell');

const jobs = [
  {
    label: 'shell:interior',
    prompt: `${COMMON}

YOUR TASK: create ${REPO}/app/src/core/shell.js — the interior enclosure for all three levels, plus
${REPO}/app/src/core/stairs.js.

shell.js exports \`buildShell(ctx, { levels:['basement','first','second'] })\` returning a
THREE.Group, and must generate from dims.js alone:
- FLOOR SLABS/DECKS per level with the correct finish material per room (red oak in the living
  areas, tile in baths, carpet in the primary bedroom and basement rec, light plank in the mudroom,
  rubber in the gym) — each room's floor is its own mesh so the room module can override it, and
  each is UV-scaled to real-world size with applyUV. Flooring RUN DIRECTION per room must follow
  docs/DETAILS.md.
- CEILINGS per room at the level's ceiling height, with the two-story volumes left OPEN (the foyer/
  stair hall and the upper hall are one space from y=0 to the second-floor ceiling) and the vaulted
  ceiling with skylight over the upper hall.
- WALLS extruded from the WALLS table with correct thickness, both faces finished, with a real
  drywall corner bead radius (a ~1/8" rounded arris, not a knife edge) — this reads in photos.
- OPENINGS punched properly: use CSG-free construction (build each wall as a set of pieces around
  its openings — header, sill, jambs) so there are no z-fighting overlays. Every opening gets a
  returned JAMB and a CASING from ctx.kit, and doors/windows placed from the kit.
- BASEBOARD on every wall run, mitered at corners, scribed to the floor; CROWN MOLDING only in the
  rooms that actually have it per docs/DETAILS.md (living, dining, family, breakfast nook).
- The two-story VOID in the second floor deck, with the correct railing around it.
- Interior doors hung with correct hand and swing per dims.js OPENINGS.

stairs.js exports \`buildStairs(ctx)\`: the first-to-second stair (with the white oak railing and
black square balusters, treads, risers, skirt board, nosing) and the basement stair (white spindle
rail). Geometry must land exactly on the level datums — check that the top tread is flush with the
second floor.

Prove it: add a camera preset if needed and shoot foyer_view_of_front_door and
hallway_top_of_stairs_looking_down_at_front_door. Read both renders next to the real photos and
iterate until the ENCLOSURE (wall positions, opening positions, ceiling heights, stair geometry,
railing) matches. Ignore furniture and finish polish — that is other agents' work. At least 3 passes.
Return: the shell API, any dims.js corrections you made, and what still looks wrong.`,
  },
  {
    label: 'shell:exterior',
    prompt: `${COMMON}

YOUR TASK: create ${REPO}/app/src/rooms/exterior-front.js and ${REPO}/app/src/rooms/exterior-rear.js
plus a shared ${REPO}/app/src/core/massing.js that builds the exterior envelope of the house.

Study these photos closely and repeatedly with the Read tool:
  listing_photos/straight_on_view_of_house_from_street.png
  listing_photos/front_leftside_of_house.png
  listing_photos/front_rightside_of_house.png
  listing_photos/exterior_view_of_front_door.png
  listing_photos/backyard_straight_on_view_of_house.png
  listing_photos/backyard_1.png

Build:
- GRAY WEATHERED WOOD LAP SIDING over the whole envelope — real lapped board geometry with a
  shadow line at each course (~8" exposure), not a flat texture on a flat wall. The weathering is
  silvery-gray with visible grain and tonal variation board to board.
- The LOW-PITCHED ROOF with its deep flat fascia and bold soffit overhang; the two-story entry box
  that oversails; the single-story garage wing on the right with its own low-pitched roof; correct
  eave and ridge heights from dims.js MASSING.
- The ROUND PORTHOLE WINDOW high on the two-story facade, plus the tall narrow window beside it.
- The BLACK FRONT DOOR with its round frosted porthole and the two sidelights with WHITE PLANTATION
  SHUTTERS (kit.frontDoor).
- The FLAT-PANEL GARAGE DOOR.
- Rear elevation: the FLOOR-TO-CEILING WINDOW WALLS, the white sliding glass doors and the white
  French door, and the second-floor wraparound SUNROOM as a DARK TIMBER POST-AND-BEAM glazed box.
- Gutters, downspouts, vents, exterior lights, the address numbers, hose bibs, a meter — the small
  things a camera catches.
- Glass must be real: reflective, showing sky and trees, with interiors faintly visible.

Then LIGHT the exteriors for a clear late-summer midday: strong sun from the upper left in the front
view, deep blue sky with faint high cirrus, and the correct sun azimuth for the rear view. Use
env.makeSkyEnv and lighting.sunRig.

Iterate: shoot straight_on_view_of_house_from_street, exterior_view_of_front_door and
backyard_straight_on_view_of_house; Read each against its real photo; fix the biggest difference;
repeat at least 3 times. Fix the camera presets in app/cameras.json if the framing does not match.
Return what you built and what still differs from the photos.`,
  },
  {
    label: 'shell:site',
    prompt: `${COMMON}

YOUR TASK: create ${REPO}/app/src/core/site.js plus ${REPO}/app/src/rooms/deck-patio.js and
${REPO}/app/src/rooms/fire-pit.js — everything outside the house.

Study with the Read tool:
  listing_photos/straight_on_view_of_house_from_street.png, front_leftside_of_house.png,
  front_rightside_of_house.png, backyard_1.png, backyard_patio_1.png, backyard_patio_2.png,
  backyard_fire_pit_1.png, backyard_fire_pit_2.png, backyard_fire_pit_3.png,
  backyard_mulch_grass_1.png, backyard_mulch_stone_steps.png,
  backyard_straight_on_view_of_house.png

Build:
- LAWN: real mown grass with mower stripes — not a green plane. Use instanced blade geometry near
  the camera fading to a textured plane at distance, or a well-made shell/fin approach. It must read
  as grass at 10 feet and as a lawn at 100 feet.
- BLUESTONE FLAGSTONE walk and stoop at the front, and the rear flagstone patio: irregular
  rectangular slabs, blue-gray, tight joints, slightly uneven, with real thickness and edge shadow.
- Broom-finished CONCRETE DRIVEWAY curving in from the right with control joints.
- DARK SHREDDED MULCH beds with a clean spade edge against the lawn.
- ROUNDED BOXWOOD / PRIVET HEDGES — several large rounded masses of differing size, dense small
  leaves, not smooth spheres. One very large one to the right of the front walk.
- MATURE TREES: a large ornamental in the front lawn with a mulch ring and a visible branching
  structure, plus the mature trees behind the house. They must cast DAPPLED SHADOW — this is a huge
  realism cue in the exterior photos.
- The rear COMPOSITE DECK (gray boards, railing, steps down), the RAISED STACKED-LIMESTONE PLANTER
  WALL, and the circular STACKED-STONE FIRE PIT RING on flagstone.
- Neighbouring houses partially visible at the edges of the front view, a fence line at the rear,
  and a believable sky.

deck-patio.js and fire-pit.js follow the room module contract (export const meta, export function
build(ctx)) and may import from site.js.

Iterate: shoot backyard_patio_1, backyard_fire_pit_1 and straight_on_view_of_house_from_street;
Read each against the real photo; fix the biggest difference; repeat at least 3 times.
Return what you built and what still differs.`,
  },
];

const results = await parallel(jobs.map(j => () => agent(j.prompt, { label: j.label, phase: 'Shell' })));

phase('Assemble');
const assembled = await agent(`${COMMON}

The shell agents just finished. Their reports:
${jobs.map((j, i) => `### ${j.label}\n${results[i] || '(no result)'}`).join('\n\n')}

YOUR TASK: assemble everything into ONE coherent scene and prove it.
1. Rewrite ${REPO}/app/src/main.js properly: build the site, the exterior massing, the shell for all
   three levels, the stairs, and every room module found in app/src/core/registry.js. Support
   ?preset=, ?shot=1, ?quality=, ?room=, ?level=. Set window.__READY__ = true only after the scene
   is fully built AND one frame has rendered. Expose window.__APP__.
2. Make the interactive walkthrough actually work: walk with WASD + mouse look, collide with walls,
   climb the stairs between levels, a room jump menu, and a level switcher that hides the floors
   above so interiors are visible.
3. Fix every integration break between shell.js, stairs.js, massing.js, site.js and the room modules
   (duplicate geometry, doubled walls, z-fighting, rooms placed at the wrong level, missing exports).
4. Run node tools/check_dims.mjs (must print DIMS OK).
5. Shoot at least 8 presets across all levels and the exterior. Read every render. Report honestly
   which ones are broken (black, blank, camera inside a wall, geometry missing).
6. Fix camera presets that are inside walls or aimed wrongly.
7. node tools/progress.mjs, then git add -A && git commit -m "house shell assembled". Do not push.
Return a blunt per-preset table: preset, renders ok?, what is visibly wrong.
`, { label: 'assemble', phase: 'Assemble' });

return { results, assembled };
