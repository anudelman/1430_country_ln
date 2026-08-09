# 1430 Country Ln — 3D Walkthrough: Shared Conventions

**This file is the contract.** Every module and every sub-agent obeys it. Do not
invent a second convention; if something is missing here, add it here first.

## 0. Goal

A Three.js walkthrough that is indistinguishable from the professional listing
photos in `listing_photos/`. Photoreal is the bar, not "nice 3D".

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
| Basement | `LEVELS.basement = -9.0` | 7.75 | −1.25 |
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

Typical listing-photo optics: 16–24mm full-frame → **vertical FOV 55–75°**,
camera height **4.6–5.4 ft**, aspect **3:2**.

## 6. Look & render settings (locked in `renderer.js`)

- `renderer.outputColorSpace = SRGBColorSpace`
- `toneMapping = ACESFilmicToneMapping`, `toneMappingExposure` per scene
- `shadowMap.type = PCFSoftShadowMap`, 2048 maps
- Physically-based light units; `THREE.ColorManagement.enabled = true`
- Post chain: mild bloom on light sources → subtle chromatic aberration →
  vignette → film grain → highlight rolloff. Never crush blacks.

Photographic notes that matter for the blind test:
- Real listing shots are **bracketed/flash-blended**: shadows are *open*,
  windows are *slightly blown but not clipped white*, no black corners.
- Every artificial light is **on** in listing photos, even in daylight.
- White balance is neutral-to-slightly-warm indoors (~4600K look).

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
