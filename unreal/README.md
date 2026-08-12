# Kitchen → Unreal prototype

The purpose of this directory is to answer one question with evidence rather than
argument: **is the visual gap an engine gap or a lighting gap?**

The way to answer it is three images of the same viewpoint side by side —
our Three.js render, an Unreal/Lumen render, and the actual listing photograph.

## Why this exists

The house is ~18,300 lines of procedural JavaScript that builds geometry at
runtime, plus 47 procedural texture generators that are CPU pixel loops rather
than shaders. None of that ports to Unreal.

But it does not need to. Three can serialise the **built result** — meshes,
materials, and the canvas textures baked to PNG — into a `.glb` that Unreal
imports natively. `tools/export_glb.mjs` does that for one room at a time. It
turns "rewrite 18,000 lines" into "open a file".

That bridge is worth having regardless of what you decide about Unreal.

## Before you start

Unreal Engine 5.2+ runs natively on Apple Silicon (universal binary, no Rosetta).
For **this** job — one room, roughly 700 meshes and a handful of lights — a
MacBook Air is adequate. Check:

- **16 GB RAM minimum.** Epic recommends 32 GB, but that targets full game
  projects, not a single-room look test.
- **~100 GB free disk.** The engine is tens of GB before the derived-data cache,
  which grows fast.
- **A base 8 GB / 256 GB Air is not worth attempting.**
- The Air is **fanless** and will thermally throttle under sustained load. Fine
  for importing a room and taking screenshots; painful for long bakes.
- Lumen runs in **software ray tracing** on Apple GPUs — there is no hardware RT
  path on Metal. Still a large upgrade on analytic lights alone.

Confirm current numbers against Epic's own macOS requirements page; the container
this was written in has both Epic domains blocked by its egress proxy, so the
figures above are not quoted from source.

## Steps

**1. Export** (on any machine, no GPU needed):

```bash
node tools/export_glb.mjs --room kitchen --quality medium --maxtex 1024
```

Writes `export/kitchen.glb` and `export/kitchen.cameras.json`, and round-trips
the `.glb` back through `GLTFLoader` to prove it parses before you spend an
evening on an install.

**What is actually in that file, and why:** not the kitchen alone. `?room=`
filters *room modules*, but `shell.js` still builds the whole shell — walls,
floors, ceilings, every window and door. That is the right thing here: Lumen
needs an enclosure to bounce light around, and a kitchen floating in a void
would test nothing. So the export is **the first floor, with the kitchen as the
only furnished room** — about 3,100 meshes.

Two knobs matter:

- `--maxy 10` (default) culls anything sitting entirely above 10 ft. `shell.js`
  builds *both* storeys even when you ask for the first, because the two-storey
  foyer void needs them; for a kitchen look test the upper floor is dead weight.
  Pass `--maxy none` to keep it.
- `--maxtex 1024` caps exported texture size. The scene carries ~1,700 `Texture`
  objects backed by only **83 distinct images** — a consequence of
  `materials.js` keying its clone cache on each mesh's bounding box. The
  exporter dedupes what it can; the rest are distinct only in UV transform, and
  `GLTFExporter` encodes each image once regardless, so the file stays sane.

**2. New Unreal project.** Games → Blank, no starter content. Blank is
deliberate: starter content ships its own lighting and post-process defaults that
would quietly contaminate the comparison.

**3. Import.** Either drag `export/kitchen.glb` into the Content Browser, or run
`import_kitchen.py` from the Output Log's Python console:

```python
exec(open(r"/path/to/repo/unreal/import_kitchen.py").read())
```

The script imports the mesh, forces Lumen on via an unbound PostProcessVolume,
and places the five calibrated viewpoints with the axis conversion already
worked out. **It has never been run** — it was written on a machine with no GPU
and no Unreal install — so treat it as a strong starting point, not a guarantee.
Everything it does is a few clicks by hand if it argues with you; the camera
maths is the only part genuinely worth automating.

**4. Check Lumen is actually on.** Project Settings → Rendering:
Dynamic Global Illumination Method = **Lumen**, Reflection Method = **Lumen**.
If the room looks flat, this is the first thing to check.

**5. Render** `kitchen_view_1` at 1526×1014 (the listing-photo size, per
`docs/PHOTOGRAPHY.md` §1.1) and put it beside:

- `renders/kitchen_view_1.png` — current Three.js render
- `listing_photos/kitchen_view_1.png` — the real photograph

## What will look wrong, and why that is expected

**Judge the lighting, not the materials.** glTF cannot carry everything
`MeshPhysicalMaterial` does, and Unreal's importer supports only a subset of what
glTF does carry. On a first import expect:

- **Stainless reading flat** — no environment reflection until you give it a
  reflection source in Unreal.
- **The oak floor losing its anisotropic sheen** — anisotropy does not survive.
- **Glass** — transmission will need rebuilding as an Unreal material.

Two of those are already open complaints against the Three.js render too
(`status.json` kitchen: *"flat untextured stainless with no environment
reflection"*, *"matte tiling oak floor with no anisotropic sheen"*), so they are
not evidence either way. A first import may well look **worse** overall than the
current render for exactly this reason.

What you are looking for is the thing Lumen does and we have not built: **indirect
bounce light.** Warm light coming off the oak floor onto the ceiling and the
undersides of the upper cabinets, colour bleeding from the cabinetry into the
white quartz, soft occlusion in the corners that nobody authored. If that reads as
obviously more real, the engine argument has merit. If it looks much like our
render with better contact shadows, then the gap was our missing GI, and the
cheaper path is to build that in Three.js and keep the single shareable file.

## The honest cost, if you decide to migrate

Only 6 of 23 rooms are built, so switching now is far cheaper than later — that is
the strongest argument for Unreal. Against it:

- ~18,300 lines rewritten; roughly 15% carries over as data (`dims.js`,
  `cameras.json`).
- The `shoot → blind → critic → status` loop, which is what has been ratcheting
  quality, is browser-bound and would need rebuilding — weeks of work producing
  zero pixels.
- You lose the 4.4 MB file that opens by double-click, and gain a multi-GB
  install.
