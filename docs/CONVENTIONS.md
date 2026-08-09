# 1430 Country Ln — 3D Walkthrough: Shared Conventions

**This file is the contract.** Every module and every sub-agent obeys it. Do not
invent a second convention; if something is missing here, add it here first.

## 0. Goal

A Three.js walkthrough that is indistinguishable from the professional listing
photos in `listing_photos/`. Photoreal is the bar, not "nice 3D".

## 0.1 Two facts that override intuition

**The house is VACANT.** Every one of the 47 listing photographs shows an empty, unstaged house:
no furniture, rugs, art, plants, curtains, towels, bedding or countertop items. The floor plans
*do* show furniture — the floor plans are marketing illustrations and are wrong about contents.
The photographs are the truth. The only movable objects in the entire house are the coir
"welcome home" doormat, the LG washer and dryer, the kitchen appliances, the wet-bar wine fridge,
the toilets, and one swing-arm magnifying mirror in the primary bath.

Consequence: all realism effort goes into architecture, materials and light — floor, trim,
casework, tile, glass, and how daylight rakes an empty wall. An empty room is *harder* to fake
than a furnished one, because there is nothing to hide behind.

**The photo filenames are swapped against the floor-plan labels.**

**Piece ids follow the PHOTO FILENAMES** (matching `docs/DETAILS.md` and `status.json`), so a piece
id and its floor-plan room label disagree for exactly these two rooms:

| piece id | listing photos | what it actually is | floor-plan label | size |
|---|---|---|---|---|
| `family` | `family_room_1/2/3.png` | corner ledgestone fireplace, lit gas fire, black flue, wet bar — **SUNKEN one 7" step** below the kitchen/hall | **LIVING ROOM** | 18'11" x 18'2" |
| `living` | `view_from_kitchen_of_living_room_looking_out_to_backyard.png` | rear window wall, white support column, French door — **not** sunken | **FAMILY ROOM** | 12'1" x 19'8" |

The sunken room is the **fireplace** room, confirmed directly in `family_room_3.png` (two steps up
to the kitchen at the left of frame). `dims.js` encodes it as `ROOMS.livingRoom.floorOffset` plus a
`STEPS` entry — correct as written.

So: **piece `family` builds the plan's LIVING ROOM, and piece `living` builds the plan's FAMILY
ROOM.** This is deliberate. Do not "fix" it in either direction — just use the right dims.js room.

## 1. Units & axes

- **1 world unit = 1 foot.** Always. Inches are fractions (`8/12`).
- **Y is up.** Y = 0 is the *first-floor finished floor*.
- **+X = plan-right (east).** **+Z = toward the street (south, plan-down).**
  So the front facade faces **+Z**, the backyard is at **−Z**.
- Floor plan images are read with plan-right → +X, plan-down → +Z.
- Angles in radians. Rotation about +Y is counter-clockwise seen from above.

## 2. Level datums (feet)

| Level | Finished floor Y | Ceiling height | Ceiling Y |
|---|---|---|---|
| Basement | `LEVELS.basement = -9.0` | **7.49** (measured, not 7.75) | −1.51 |
| First floor | `LEVELS.first = 0.0` | 8.5 | 8.5 |
| Second floor | `LEVELS.second = 9.5` | 8.0 | 17.5 |

Two-story spaces (foyer/stair hall, upper hall) run from 0 to the second-floor
ceiling / vault. Exact vault geometry lives in `dims.js`.

Scale reference used everywhere: **interior door leaf = 6'8" tall × 1.75" thick**;
standard door width 2'6"–3'0". Base cabinets 34.5" + 1.25" counter = 35.75" top.
Wall outlets 15" to center. Switches 46" to center. Counter-to-upper 18".

## 3. Wall thickness

- Exterior walls: **0.55 ft** (6.6") framed + siding handled by exterior shell.
- Interior partitions: **0.375 ft** (4.5").
- Plumbing/chase walls: **0.54 ft** (6.5").
- Dimensions on the floor plans are **clear inside face to inside face.** Room
  rectangles in `dims.js` are therefore *inside* faces; walls are grown outward.

## 4. Module layout & import contract

```
app/
  index.html            walkthrough entry (dev)
  src/
    core/
      units.js          ft/in helpers, constants
      dims.js           AUTHORITATIVE geometry tables (rooms, walls, openings)
      textures.js       procedural CanvasTexture library (no network assets)
      materials.js      named PBR materials built on textures.js
      lighting.js       lighting rigs per room/scene
      renderer.js       renderer + tone mapping + post chain
      camera.js         shift-lens (perspective-corrected) camera + presets
      kit.js            parametric building components
      shell.js          walls/floors/ceilings/openings from dims.js
      registry.js       room registry: id -> { build(ctx), cameras }
    rooms/<id>.js       one file per judged piece; default-exports a builder
  cameras.json          camera preset per listing photo (generated/edited)
tools/
  serve.mjs             static dev server
  shoot.mjs             headless screenshot harness
  bundle.mjs            inlines everything into dist/walkthrough.html
  progress.mjs          builds the live progress page from status.json
```

- **ES modules only.** Import three via the bare specifier `three` — the dev
  server and the bundler both provide an import map. Never use a CDN URL
  (the page must work offline / from `file://` after bundling).
- **No binary asset files.** All textures are generated procedurally in
  `textures.js` with `<canvas>`. This keeps the bundle self-contained and the
  repo clean. Environment maps are generated procedurally too.

### Room module contract

```js
// app/src/rooms/kitchen.js
export const meta = {
  id: 'kitchen',
  title: 'Kitchen',
  level: 'first',
  photos: ['kitchen_view_1.png', 'kitchen_view_2.png'],
};
export function build(ctx) { /* returns void; adds to ctx.group */ }
```

`ctx` provides:
```
ctx.group     THREE.Group to add meshes to (already positioned at world origin)
ctx.THREE     the three namespace
ctx.mat       materials library (see materials.js)
ctx.tex       textures library
ctx.kit       component kit
ctx.dims      dims.js tables
ctx.lights    lighting helpers (adds to ctx.group)
ctx.quality   'high' | 'draft'
```

Rooms **must not** create their own renderer, camera, or global lights, and must
not modify another room's geometry. Rooms own everything inside their walls:
finishes on the inside faces, casework, furniture, fixtures, decor, artificial
lights.

## 5. Camera presets (`app/cameras.json`)

One entry per listing photo we are matched against:

```json
{
  "kitchen_view_1": {
    "photo": "kitchen_view_1.png",
    "room": "kitchen",
    "pos": [x, y, z],
    "target": [x, y, z],
    "fovV": 62,           // vertical FOV in degrees
    "shift": 0.0,         // lens rise/fall, fraction of half-height (+ = up)
    "aspect": 1.5
  }
}
```

**Perspective correction is mandatory.** Real-estate photos are shot with a
tilt-shift or corrected in post: **vertical lines are exactly vertical.** Our
camera therefore always looks horizontally (pitch = 0) and uses an off-axis
(shifted) frustum to include more ceiling or floor. `camera.js` exposes
`makeShiftCamera({fovV, aspect, shift})`. A preset with non-zero pitch is a bug.

**These optics are MEASURED, not assumed** — see `docs/PHOTOGRAPHY.md` for the derivation
(two-vanishing-point calibration on `family_room_1.png` and `master_bedroom_1.png`, f = 625/631 px,
cross-checked against the floor plan to within 0.5 ft and 1.7°). They supersede all earlier
estimates in this file:

| parameter | value |
|---|---|
| `fovV` interior | **78.5°** (≈14.6 mm equiv, hFOV 101.5°) — far wider than a typical guess |
| `fovV` exterior | **64°** |
| `shift` | **0.00** — the horizon sits within ±7 px of frame centre in every photo |
| camera height | **4.00 ft** first floor, **4.05** second, **3.90** basement — low, not eye height |
| aspect / render size | **1.505** / **1526×1014** |
| lens distortion | **0.0** — fully corrected (measured sag ≤0.6 px over 700 px) |
| residual pitch | **±0.25°** — the real photos are corrected only to ~0.3°, so a *perfectly* plumb render is marginally cleaner than the reference |

Interactive walk mode may use a normal eye height (~5.6 ft); **screenshots always use the table
above.**

## 6. Look & render settings (locked in `renderer.js`)

- `renderer.outputColorSpace = SRGBColorSpace`
- `toneMapping = ACESFilmicToneMapping`, `toneMappingExposure` per scene
- `shadowMap.type = PCFSoftShadowMap`, 2048 maps
- Physically-based light units; `THREE.ColorManagement.enabled = true`
### The post chain, corrected by measurement

An earlier draft of this file prescribed bloom, chromatic aberration, vignette and film grain.
**All four were measured as ABSENT from the real photographs.** Adding them does not make our
renders look photographic — it makes them *easier* to pick out. The one thing the photos DO have
that renders lack is a sharpening halo.

| stage | setting | measured evidence |
|---|---|---|
| bloom | threshold **0.98**, strength **0.06**, radius 0.15 (≈off) | ceiling 6 px from a 254-level can sits at its normal 193–197 |
| chromatic aberration | **0.00 px** | ≤0.03 px at r>700 |
| vignette | **0.02** (max 0.04) | none — the corners are actually *brighter* |
| film grain | **0.0006** (0.15/255) | σ 0.11–0.16 |
| **unsharp mask — ADD THIS** | radius **0.9 px**, amount **0.55** | every high-contrast edge carries a +36/−24 halo at ±1 px |
| `toneMappingExposure` | **1.15** interior, **0.95** exterior | calibrate so a white wall reads **188±6** and the frame median is **185–195** |
| black point | lift the floor to **14/255** | <0.3% of pixels below L=8; ordinary shadow bottoms sit at L 25–70 |
| white point | p99.9 = **250–254**, **≤0.15%** pure white | window medians 144–195, exterior stays fully legible |

### Lighting ratios (also measured)

- ambient fill : key, interior = **0.55 : 1**. Deepest occlusion only 0.31 linear.
- **No dark AO line in drywall corners.** A wall/ceiling junction gradates smoothly 190→184 over
  ~150 px with no local minimum. A contact-shadow crease there is a giveaway.
- sun patch : ambient on the floor = **1.5 : 1 linear**. Under-cabinet shadow is only 3–13% down.
- exterior sun : sky fill = **5 : 1 linear**.
- Shadows are **warm** (+4 to +5 R−B at L≈130). Never tint them blue.
- Walls are not flat washes: one blank basement wall spans 132→194, a 32% gradient.
- Depth of field **off** — everything from 2.5 ft to 60 ft resolves to 2-px edges.
- Every artificial fixture is **ON** in every photo, even in daylight.

## 7. Judged pieces

Each piece is built, screenshotted from the matching listing camera, and
blind-compared by a fresh critic. Piece ids are the room module ids.

## 8. Status file

`status.json` at repo root, consumed by `tools/progress.mjs`:

```json
{
  "updated": "iso8601",
  "pieces": [{
    "id": "kitchen", "title": "Kitchen", "level": "first",
    "photo": "listing_photos/kitchen_view_1.png",
    "render": "renders/kitchen_view_1.png",
    "round": 3,
    "verdict": "REAL_PHOTO_PICKED_RENDER",
    "confidence": 0.6,
    "gap": "Quartz backsplash lacks slab veining continuity",
    "history": [{"round":1,"gap":"..."}]
  }]
}
```

`verdict` ∈ `PENDING` | `PICKED_RENDER` (critic spotted it — needs work) |
`UNSURE` (pass) | `PICKED_PHOTO_AS_RENDER` (pass, critic fooled).
