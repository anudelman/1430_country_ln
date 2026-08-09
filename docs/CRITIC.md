# The Blind Critic Protocol

The only definition of "done" in this project is: **a hostile expert, shown the render and the
real listing photo side by side with no labels, cannot reliably say which is which.**

## Setup

`tools/blind.mjs` produces `renders/blind/<piece>/A.png` and `B.png`. One is the professionally
shot listing photo; one is our render. Which is which varies per round and is recorded only in
`key.json`, which the critic never sees.

The two images are normalised so the test is about the *image*, not the *file*:
same pixel dimensions, same JPEG requantisation, the listing "N of 50" badge patched out of both.

## The critic's brief (verbatim, given to a fresh agent every round)

> You are a hostile image forensics expert and an architectural photographer with 20 years in
> real-estate marketing. You are shown two images, A and B, of the same room. **Exactly one is a
> photograph. The other is a 3D render trying to pass as that photograph.**
>
> Your reputation depends on not being fooled. Assume by default that you CAN tell, and hunt for
> the tell. Study both images at length before answering. Look specifically at:
>
> 1. **Light transport.** Contact shadows where objects meet the floor. Soft shadow gradients under
>    cabinets and furniture. Colour bleed from a rug onto a wall. Light falloff across a large wall
>    — a render often has a flat wash where a photograph has a gradient. Specular highlights that
>    are the wrong shape for the light that made them.
> 2. **Materials at grazing angles.** Real satin polyurethane on oak throws a long, smeared,
>    anisotropic sheen toward the light; CG floors often look uniformly matte or uniformly glossy.
>    Quartz has depth — the veining sits *under* a clear surface. Painted millwork has a faint
>    orange-peel. Carpet has a directional nap.
> 3. **Geometry tells.** Perfectly sharp edges (real edges have a ~1mm highlight), perfectly
>    straight lines with no settling, identical repeated objects, symmetric-to-the-pixel layouts,
>    intersecting geometry, gaps that are exactly 0.
> 4. **Optics.** Lens vignetting, chromatic fringing on high-contrast edges, depth of field,
>    diffraction on bright window frames, sensor noise in the shadows (a render is often too clean
>    in the dark areas and too clipped in the bright ones).
> 5. **Window blowout.** In a real bracketed listing photo the exterior is bright but usually still
>    has some detail and a colour cast; a render either clips to pure white or shows an
>    implausibly crisp outdoors.
> 6. **The lived-in tax.** Dust, scuffed baseboards, an outlet slightly off-level, a switch plate,
>    a vent register, a smoke detector, a thermostat, a door stop, caulk lines, grout that varies,
>    a slightly rumpled bed, cords. Renders are suspiciously tidy and suspiciously complete.
> 7. **Composition.** A professional shoots from a specific height with verticals corrected. If one
>    image has converging verticals, or a horizon that is not level, that is a tell in itself.
>
> Then answer in this exact JSON form and nothing else:
>
> ```json
> {
>   "render_is": "A" | "B" | "CANNOT_TELL",
>   "confidence": 0.0-1.0,
>   "reasoning": "the specific evidence that decided it, referencing image regions",
>   "biggest_gap": "the SINGLE most damaging difference — the one fix that would most improve the render's chance of passing. Be concrete and actionable: name the surface, the object, or the light.",
>   "ranked_gaps": ["second", "third", "fourth"],
>   "verdict_if_fixed": "would fixing biggest_gap alone flip your answer? yes/no + why"
> }
> ```
>
> If you genuinely cannot tell, say `CANNOT_TELL` — do not guess to seem decisive. But do not say
> it to be kind: if you can tell, say so and say how.

## Scoring

| critic `render_is` | meaning | status |
|---|---|---|
| correctly names the render, confidence ≥ 0.5 | spotted us | `PICKED_RENDER` — another round |
| correctly names it, confidence < 0.5 | coin flip | `UNSURE` — pass, but keep polishing |
| `CANNOT_TELL` | indistinguishable | `UNSURE` — **pass** |
| names the *photo* as the render | fooled | `PICKED_PHOTO_AS_RENDER` — **pass, best result** |

A piece is **done** when two consecutive rounds, with two independently spawned critics, both fail
to correctly identify the render with confidence ≥ 0.5.

## Anti-gaming rules

- The critic never reads `key.json`, the room source, `status.json`, or any prior critique.
- The critic is a **fresh agent with no project context** — it is told only "two images, one is a
  photo". It must not know which room, which house, or that a project exists.
- The builder never sees `key.json` either; it only receives `biggest_gap` and `ranked_gaps`.
- Never "fix" a gap by degrading the real photo or by cropping the render to hide a problem.
- Adding artificial noise/blur to fake photographic grain is allowed only as the final grade, and
  only at a level a real camera would produce. Blurring away bad geometry is cheating and will be
  caught by the next round's critic anyway.
