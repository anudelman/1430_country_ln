# Camera & Grade Reverse-Engineering — `listing_photos/`

**Purpose:** everything a renderer needs to *be* this photographer. This is about the optics and the
grade, not the rooms. Where this file disagrees with `CONVENTIONS.md` §5/§6, **this file wins** — it
is measured, the convention was assumed. The disagreements are called out in **§0**.

All measurements were made on the decoded 8-bit RGB of the delivered PNGs (no resampling), using
sub-pixel edge fitting (parabolic interpolation on the gradient), RANSAC line fits, two-vanishing-point
calibration, and ROI statistics. Every number below is reproducible from the cited photo and pixel
coordinates.

---

## 0. Corrections to CONVENTIONS.md (read this first)

| CONVENTIONS.md says | Measured | Impact |
|---|---|---|
| `fovV 55–75°`, "16–24 mm full-frame" | **vFOV 78.6°, hFOV 101.5°, ≈14.6 mm equiv** | Every camera preset is ~20% too tight. Geometry will not line up. |
| camera height **4.6–5.4 ft** | **3.85–4.10 ft (46–49 in)** | Horizon lands ~1 ft too high; floors read too shallow. |
| "uses an off-axis (shifted) frustum" | **shift ≈ 0.00** (horizon within ±7 px of frame centre in every image) | Keep `shift: 0.0`. The wide FOV, not a rise, is what gets the ceiling in. |
| "subtle chromatic aberration" in the post chain | **CA = 0.00–0.03 px everywhere, including the frame edge** | Adding CA is a *tell against us*. Set it to zero. |
| "mild bloom on light sources" | **No measurable bloom.** Ceiling 6 px from a 254-level recessed can is at its normal 193–197 | Bloom ≤0.06 strength or off. |
| "film grain" | **σ = 0.11–0.16 of 255 on flat walls** | Essentially noiseless. Realistic grain would be *more* wrong than none. |
| "white balance … ~4600 K look" | **White walls are colour-corrected to neutral** (R−B = 0 to +9, median +3) | Don't tint the whole frame warm; let only the warm fixtures be warm. |
| "cool shadows" (implied by split-toning) | **Shadows are warm** (R−B +3…+5); deepest tones are red-biased | Never blue shadows. |

---

## 1. Lens and framing

### 1.1 Delivered pixel dimensions and aspect

47 photos (excluding the three `floorplan_*`). Widths **1519–1534 px**, heights **1000–1024 px**.
Aspect ratio **1.494–1.522, median 1.505** — i.e. nominal **3:2**, with per-image jitter of ±1.5%
because these are viewer-scrapes, cropped individually.

Three outliers to ignore when fitting: `backyard_straight_on_view_of_house.png` 1433×884 (1.621),
`backyard_fire_pit_1.png` 1311×900 (1.457), `foyer_view_of_front_door.png` 1514×987 (1.534).

**Render target: 1526 × 1014, aspect 1.505.** Every photo also carries a grey rounded
`"N of 50"` badge at roughly x ∈ [1445,1520], y ∈ [4,30]; `tools/blind.mjs` already patches it out
of both images, so do not reproduce it.

### 1.2 Focal length — derived by two-vanishing-point calibration

The only scale-free way to get focal length from a photograph is the angle between two known
perpendicular directions. Two rooms gave clean, long, high-contrast lines on two mutually
perpendicular walls.

**`family_room_1.png` (1526×1011, centre 763,505.5)** — the room is the plan's **LIVING ROOM
18'11" × 18'2"**, shot diagonally into the fireplace corner, so the left and right walls are
perpendicular.

| line | fit | RMS | span |
|---|---|---|---|
| left wall, crown/ceiling junction | `y = 0.234740x + 198.495` | 0.87 px | x 180→650 |
| left wall, floor junction | `y = −0.202169x + 783.129` | 0.53 px | x 60→660 |
| right wall, crown/ceiling junction | `y = −0.171148x + 525.795` | 0.18 px | x 1060→1395 |
| right wall, floor junction | `y = 0.139223x + 499.831` | 0.36 px | x 1000→1440 |

VP(left wall) = **(1338.1, 512.6)**, VP(right wall) = **(83.7, 511.5)**.
The two horizons agree to **1.1 px** — the calibration is sound.

`f² = −(83.7−763)(1338.1−763) = 390 675` → **f = 625.0 px**.

**`master_bedroom_1.png` (1532×1018, centre 766,509)** — plan's **PRIMARY BEDROOM 11'7" × 21'7"**.

* slat-wall top edge `y = 0.251242x + 150.887` (RMS 0.29, x 4→729)
* slat-wall bottom edge `y = −0.239745x + 835.969` (RMS 0.43, x 10→720) → VP = **(1395.3, 501.4)**
* far-wall floor `y = 0.141785x + 482.767`, far-wall ceiling `y = −0.137432x + 527.003` → VP = **(133, 508.6)**

`f = 631.1 px`. Re-solving instead by *forcing* the two reconstructed wall directions to be exactly
90° apart gives **f = 612.1 px**.

**Adopted: f = 620 ± 12 px on a 1526-px-wide frame.**

| quantity | value |
|---|---|
| f / image width | 0.406 |
| **35 mm equivalent (36×24)** | **14.6 mm** (36 × 620 / 1532) |
| **horizontal FOV** | **101.5°** |
| **vertical FOV** | **78.6°** |
| diagonal FOV | 111.5° |
| `fovV` for `cameras.json` | **78.5** |

**Independent sanity checks (all with f = 620–631, H = 4.07 ft):**

* Reconstructed depth from the camera to the master bedroom's far wall = **21.5 ft**; the plan says
  the room is **21'7"** long and the camera is visibly against the opposite wall. ✓
* Reconstructed length of the visible far wall = **12.1 ft**; the plan says **11'7"** (the fitted line
  over-runs the corner slightly). ✓
* Reconstructed angle between the slat wall and the far wall = **91.7°** (true 90°). At f = 800 px the
  same construction gives **105°** and a 13.9 ft wall — decisively wrong. ✓

**Exteriors are a different, tighter lens setting.** Estimated from `straight_on_view_of_house_from_street.png`:
the two-storey entry block is ~14.5 ft wide × ~20 ft tall and subtends 245 × 340 px, giving
f/Z ≈ 17 px/ft; at a plausible 45–50 ft stand-off, **f ≈ 765–850 px → 18–20 mm equiv, vFOV 62–66°,
hFOV 86–89°** (±15%). Use `fovV: 64` for the exterior presets.

### 1.3 Camera height above finished floor

Method: the horizon row `y₀` is the vanishing row of any wall (its floor line ∩ its ceiling line).
Then for a wall plane where the floor, a door head (known 6'10" = 6.833 ft to the head jamb) and the
ceiling are all at the same depth,

```
(v_floor − y₀) / (y₀ − v_head)  =  H / (6.833 − H)
C  =  6.833 · (v_floor − v_ceiling) / (v_floor − v_head)      (independent of y₀)
```

| photo | y₀ | v_floor | v_head | v_ceiling | **H** | **C** |
|---|---|---|---|---|---|---|
| `basement_workout_room.png` @x=950 | 517.4 | 719.5 | 364.0 | 329.9 | **3.89 ft** | 7.49 ft |
| `master_bedroom_1.png` @x=1000 | 505.0 | 624.6 | 424.0 | 389.6 | **4.07 ft** | 8.00 ft |
| `family_room_1.png` @x=400 (ratio only) | 512.0 | 702.3 | — | 292.4 | **3.87 ft** (at C=8.5) | — |

The master-bedroom case is self-consistent two ways: the door-head equation and the ceiling equation
both return **H = 4.07 ft**, and the ceiling comes out at **8.00 ft**, exactly the `LEVELS.second`
convention. The basement returns **C = 7.49 ft** (convention says 7.75 — worth revisiting `dims.js`).

**Use these:**

| room type | camera height (ft, Y above that level's finished floor) |
|---|---|
| First floor (kitchen, living, dining, foyer, mudroom) | **4.00** |
| Second floor (bedrooms, baths) | **4.05** |
| Basement | **3.90** |
| Exteriors (eye level, standing) | 5.3 (the exteriors are hand-held, not tripod) |

Rounded: **48 inches**, everywhere indoors. This is a low tripod — it is what makes the ceilings and
floors read the way they do, and it is 8–14 inches lower than the convention.

### 1.4 Verticals — measured, not assumed

I traced the strongest near-vertical edge in the left third, centre third and right third of 22
photos with sub-pixel RANSAC line fits. Slopes (positive = the line leans right going down):

```
kitchen_view_1          L −0.393°  C +0.532°  R +0.159°
kitchen_view_2          L +0.458°  C +0.557°  R −0.143°
kitchen_view_3          L −0.238°  C −0.116°  R −0.364°
dining_room             L +0.195°  C +0.587°
family_room_1           L +0.703°  C +0.005°  R −0.362°
mudroom_1               L +0.400°  C −0.224°  R −0.324°
foyer_view_of_front_door L +0.257°  C +0.183°  R −0.105°
basement_view_1         L +0.065°  C −0.072°  R +0.195°
basement_workout_room   L +0.205°  C +0.447°  R −0.284°
bathroom_first_floor_1  L +0.012°  C −0.036°
bathroom_second_floor_1 L +0.199°  C −0.212°  R −0.270°
master_bedroom_2        L −0.146°  C −0.483°  R −0.190°
bedroom_second_floor_1  L +0.233°  C +0.138°  R +0.016°
```

**Median |slope| = 0.27°; nothing exceeds 0.9°.** Concrete answers to "compare the pixel x-position
of a wall corner at the top and bottom of the frame":

* `master_bedroom_bathroom_view_1.png`, door casing near x = 1137: **x = 1138.7 at y = 210, x = 1135.9
  at y = 860** → 2.8 px over 650 rows (0.05°).
* `foyer_view_of_front_door.png`, window frame near x = 90: **x = 85.6 at y = 80, x = 90.4 at y = 830**
  → 4.8 px over 750 rows (0.36°).
* `basement_workout_room.png`, mirror edge x = 1080: 2.4 px over 480 rows (0.14°).

**Verdict: perspective-corrected, but not perfectly.** A vertical wall corner drifts **≤5 px**
horizontally across the whole frame height. In many images the left and right edges lean in opposite
senses with a half-difference of ~0.3°, i.e. a residual downward pitch of ~0.4°. Our shift-lens camera
(pitch exactly 0) is *slightly cleaner than the photographs*. That's a 0.3° tell nobody will win a
blind test on, but if you want to be exact, add a **±0.25° random residual pitch** per preset.

Horizon position: y₀ − centre = **+6.5 px** (`family_room_1`), **−4 px** (`master_bedroom_1`),
**+5.4 px** (`basement_workout_room`) — i.e. ≤1.3% of half-height. **`shift: 0.0`.**

### 1.5 Distortion — fully corrected

Long architectural straight lines were fitted with both a line and a quadratic; the quadratic "sag" at
mid-span is the residual barrel/pincushion.

| photo | line | span | line RMS | max dev | **quadratic sag** |
|---|---|---|---|---|---|
| `master_bedroom_1` | slat-wall top edge (runs to x=4, the extreme frame edge) | 726 px | 0.35 px | 1.12 px | **−0.49 px** |
| `master_bedroom_1` | slat-wall bottom edge | 714 px | 0.40 px | −2.26 px | **+0.40 px** |
| `basement_view_1` | ceiling/wall junction | 606 px | **0.21 px** | −0.47 px | **+0.61 px** |
| `basement_workout_room` | ceiling trim | 552 px | 0.31 px | 1.13 px | **−0.21 px** |
| `family_room_1` | right-wall crown | 162 px | 0.65 px | −2.10 px | +0.63 px |

**Residual distortion ≤0.6 px over 700 px, even on edges that touch the frame border.** In normalized
terms |k1| < 5×10⁻⁴. Lens profile corrections were applied in post. **Set the renderer's distortion to
exactly zero — do not add barrel "for realism".**

---

## 2. Exposure and dynamic range

### 2.1 These are bracketed HDR merges (or ambient + a window luminosity mask). Not flash.

Evidence, in order of strength:

1. **Windows hold full, legible exterior detail while the interior sits at 185.** In
   `family_room_1.png` the left window glass (ROI 160,310,150,300) has median L = 144, p99 = 249, and
   only **0.01%** pure-white pixels. At 6× zoom you can read individual leaves, a mulch bed, the
   edging stones, a lawn mowing pattern **and a small sticker on the glass**. A single exposure
   metered for a 185 wall would put a sunlit lawn 4–6 EV over clip.
2. `master_bedroom_bathroom_view_1.png` slider glass (95,370,180,270): median 164, p99 250,
   **0.04%** pure white — full tree and fence detail.
3. `foyer_view_of_front_door.png` through plantation shutters (130,260,410,560): median 185, p99 253,
   0.29% pure white — blue sky, a neighbour's roof, sunlit shrubs and the street all readable.
4. **No flash signature anywhere:** no double shadows, no specular hotspot on the floor in front of
   the camera, no near-field over-exposure, no ceiling hotspot above the camera. The averaged radial
   luminance profile across all 47 photos *rises* to 1.05× at r/r_max = 0.87 — there is no falloff of
   any kind, optical or flash.
5. **Shadows are open to a degree only an HDR merge or heavy shadow-lift gives:** the backsplash
   directly under the wall cabinets in `kitchen_view_3.png` (col 600 and 700, y 501–510) reads
   177–198 against 204 for the open backsplash 40 px lower — a 3–13% shadow, not a 60% one.

### 2.2 How blown are the windows, numerically

| photo / ROI | median L | p99 L | R p99 / G p99 / B p99 | % pure 255,255,255 |
|---|---|---|---|---|
| `family_room_1` left window (160,310,150,300) | 144 | 249 | 249 / 255 / 233 | 0.01% |
| `family_room_1` corner window R (880,405,95,60) — direct sky | 187 | 255 | 255 / 255 / 255 | **1.32%** |
| `dining_room` bay (235,340,410,230) | 170 | 250 | 255 / 255 / 241 | 0.13% |
| `master_bedroom_bathroom_view_1` slider L (95,370,180,270) | 164 | 250 | 251 / 255 / 235 | 0.04% |
| `master_bedroom_bathroom_view_1` slider R (330,375,140,255) | 153 | 249 | 252 / 255 / 232 | 0.04% |
| `foyer` shuttered windows (130,260,410,560) | 185 | 253 | 255 / 255 / 255 | 0.29% |
| `view_from_kitchen_of_living_room…` (700,300,200,200) | 194 | 251 | 253 / 255 / 245 | 0.14% |

**Typical bright window pixels sit at 240–252, not 255**, and they carry a colour cast: **G ≥ R > B**,
with B running 10–20 levels below R (foliage-green / warm), not a neutral white. Only where open sky
is directly in the aperture does the fraction of true 255 rise above 0.5%.

**Sky seen directly (exteriors) is a different animal:** `straight_on_view_of_house_from_street.png`
(400,40,300,120) is mean **R 148 / G 183 / B 253** with B clipped (B p99 = 255) but luminance only
**182**. `front_leftside_of_house.png` (950,60,250,110) is **146 / 182 / 253**. Clip the *blue channel
only*; never let a sky go to 255,255,255.

### 2.3 Black point

| photo | % of pixels L≤4 | darkest-1% mean RGB | darkest-5% mean RGB |
|---|---|---|---|
| `basement_view_1` | **0.004%** | 94.5, 75.7, 59.3 | 126.6, 107.7, 91.5 |
| `dining_room` | 0.012% | 67.9, 56.6, 29.2 | 104.8, 82.6, 52.9 |
| `bathroom_first_floor_1` | 0.023% | 53.2, 57.7, 56.7 | 101.9, 99.4, 87.8 |
| `family_room_1` | 0.028% | 58.0, 51.8, 34.1 | 106.9, 90.9, 63.2 |
| `foyer_view_of_front_door` | 0.077% | 24.6, 19.9, 16.6 | 46.5, 43.0, 39.4 |
| `mudroom_1` | 0.088% | 40.3, 31.8, 24.1 | 81.7, 68.2, 54.9 |
| `kitchen_view_1` (oven cavity) | 0.400% | 9.5, 4.8, 1.6 | 53.2, 38.6, 26.8 |
| `master_bedroom_1` (slat-wall gaps) | **2.93%** | 5.2, 0.2, 0.1 | 13.0, 1.5, 0.5 |
| `front_leftside_of_house` (exterior) | 0.672% | 4.1, 3.7, 1.8 | 14.3, 19.9, 4.4 |
| `backyard_patio_1` (exterior) | 0.507% | 2.9, 5.9, 0.3 | 12.9, 22.6, 3.1 |

**The rule:** an *ordinary* interior shadow — a room corner, under a vanity, the shaded side of a wall
— bottoms out at **L 25–70**, and typically 0.02–0.1% of an interior frame is below L=4. True black
appears only inside literal cavities (the oven, the 3/4-inch gaps in the master bedroom's slat wall,
the dark side of a mirror joint). **Exteriors are different: they genuinely clip, 0.5–0.7% below L=4.**

Deep tones are **red-biased and warm**, never neutral or cool: (9.1, 0.3, 0.1), (5.9, 0.6, 0.2),
(4.5, 1.2, 0.3), (2.5, 1.3, 0.4).

### 2.4 Histogram shape and mid-tone placement

Luminance deciles (p10 … p90) and band occupancy:

| photo | p10 | p30 | **p50** | p70 | p90 | 0–31 | 96–159 | **160–207** | 208–239 | 240–255 |
|---|---|---|---|---|---|---|---|---|---|---|
| `kitchen_view_1` | 102 | 149 | **183** | 191 | 200 | 1.8% | 26.2% | **62.6%** | 2.7% | 0.4% |
| `kitchen_view_3` | 110 | 155 | **184** | 193 | 200 | 0.9% | 25.9% | **64.4%** | 2.6% | 0.2% |
| `family_room_1` | 138 | 166 | **179** | 190 | 202 | 0.2% | 21.6% | **71.0%** | 4.5% | 0.6% |
| `dining_room` | 122 | 178 | **190** | 194 | 199 | 0.1% | 20.2% | **73.6%** | 1.8% | 1.2% |
| `bedroom_second_floor_1` | 162 | 180 | **185** | 191 | 203 | 0.0% | 8.0% | **85.9%** | 4.5% | 0.5% |
| `basement_view_1` | 145 | 158 | **171** | 183 | 193 | 0.0% | 31.1% | **66.6%** | 1.1% | 0.2% |
| `mudroom_1` | 137 | 183 | **200** | 211 | 220 | 0.4% | 10.6% | 47.9% | 36.6% | 0.6% |
| `front_leftside_of_house` | 48 | 92 | **132** | 174 | 208 | 5.3% | 30.6% | 27.8% | 7.7% | 2.3% |
| `backyard_patio_1` | 46 | 92 | **140** | 169 | 197 | 5.4% | 28.0% | 33.0% | 5.5% | 1.9% |
| `straight_on_view_of_house` | 62 | 106 | **144** | 177 | 210 | 2.8% | 32.5% | 32.1% | 8.2% | 2.4% |

**Interior signature: a tall, narrow, high-key peak.** 60–86% of every interior frame lives in
**160–207**. Mid-tone placement **L ≈ 185 (72% of full scale)**. A long thin tail to the left,
almost nothing to the right — only **0.2–1.4%** above 240. Mean per-image L runs **165–195**.

**Exterior signature is completely different:** broad and roughly flat from ~50 to ~210, median
132–144, with 3–5% genuinely black. Do not use one exposure setting for both.

---

## 3. Colour

### 3.1 White balance

Sampled flat white ceiling/wall patches (no fixture in frame, no window spill):

| photo / ROI | mean R, G, B | R−B |
|---|---|---|
| `basement_bathroom` right wall (1044,220) | 187, 187, 187 | **0.0** |
| `master_bedroom_1` wall (1280,470,180,120) | 198.6, 198.6, 198.0 | +0.6 |
| `basement_view_1` wall (1000,470,160,80) | 186.3, 186.3, 186.3 | **0.0** |
| `kitchen_view_3` ceiling (620,120,200,90) | 190.9, 190.3, 189.5 | +1.4 |
| `dining_room` ceiling (1000,180,200,90) | 195.5, 195.0, 193.7 | +1.8 |
| `bedroom_second_floor_1` ceiling (700,120,200,90) | 179.8, 178.9, 177.4 | +2.4 |
| `master_bedroom_1` ceiling (950,90,200,90) | 196.3, 195.1, 193.1 | +3.2 |
| `family_room_1` ceiling (520,80,180,90) | 184.5, 181.6, 179.1 | +5.4 |
| `bathroom_second_floor_1` ceiling (850,120,200,80) | 210.5, 206.8, 202.4 | +8.1 |
| `hallway_top_of_stairs…` wall (1000,300,200,150) | 182.8, 178.7, 173.7 | +9.1 |
| `mudroom_1` ceiling (1050,120,200,90) | 216.1, 216.1, 219.2 | **−3.1** (cool) |

**Indoors the white balance is neutral, not warm.** R−B on a white surface is **0 to +9, median +3**,
i.e. within roughly ±150 K of grey. The photographer white-balanced the *walls*, then let the warm
fixtures show only where they dominate (`hallway`, `bathroom_second_floor_1`, `family_room_1`).
One room (`mudroom_1`, a cool-blue cabinet scheme lit by a daylight flush-mount) is 3 levels *cool*.

**Outdoors:** blue sky R 146 / G 181 / B 253; sunlit grass mid-tone R 132–139 / G 141–148 / B 90–104.
Standard daylight WB, no warming filter.

**Lamp colours (measure these, they are what the emissives must be):**

* Decorative chandelier globes, `dining_room` row 245 x 764–808: **255, 245, 226** (B is 29 below R,
  R clipped) → ≈2700 K.
* Recessed cans, `family_room_1` row 45 x 318–354: **254, 254, 253** → ≈3500–4000 K, near-neutral.
* Pendant shade rim, `kitchen_view_1`: 240, 234, 226.

**Note the highlights keep their hue.** A default ACES filmic curve desaturates highlights toward
white; here a 255-clipped globe still reads 255/245/226. Soften the highlight desaturation.

### 3.2 Split-toning

**Warm shadows, neutral highlights — the opposite of the usual "teal shadows" grade.**

Cleanest measurement, same painted surface, `basement_bathroom.png` blank right wall:

```
top of wall     (1044,220)  187,187,187    L=187   R−B =  0
mid wall        (1044,535)  180,180,180    L=180   R−B =  0
bottom of wall  (1044,850)  161,161,159    L=161   R−B = +2
bottom-left     ( 760,850)  134,132,129    L=132   R−B = +5
```

The darker end of one continuous surface gains **+5 R−B**. Corroborated globally: the darkest 5% of
every interior is strongly R > G > B (see §2.3). There is **no cool cast anywhere in the shadows**.

### 3.3 Saturation

Mean per-pixel chroma (max(RGB) − min(RGB)) over the whole frame:

* **Interiors: 5.2 – 28.2.** `bedroom_second_floor_kid-2` 5.2, `basement_bathroom` 5.4,
  `bedroom_second_floor_kid-1` 6.7, `master_bedroom_3` 7.8, `bedroom_second_floor_1` 8.4,
  `basement_view_1` 12.0, `kitchen_view_1` 26.8, `kitchen_view_3` 27.8, `family_room_3` 33.5.
* **Exteriors: 32.3 – 60.1.** `front_leftside_of_house` 60.1, `backyard_1` 60.0,
  `straight_on_view_of_house` 59.2, `backyard_patio_1` 36.3.

This is a **vibrance-not-saturation** profile: a modern Adobe Color / Lightroom treatment with
vibrance pushed hard on foliage and sky while neutrals are held at literally zero chroma
(187,187,187 walls). It is *not* a film emulation — there is no toe crossover, no lifted-black
colour, no highlight tint.

### 3.4 Chromatic aberration

Measured as the difference in the 50%-crossing position of the R and B channels across
high-contrast edges, averaged over 150–600 rows, with sub-pixel interpolation:

| photo | edge | radius from centre | **R−B (px)** |
|---|---|---|---|
| `basement_workout_room` | mirror edge x=85 | 680 px | **−0.001** |
| `foyer_view_of_front_door` | black door / white casing x=601 | 165 px | **+0.001** |
| `foyer_view_of_front_door` | window frame x=90 | 670 px | **+0.009** |
| `kitchen_view_1` | fridge edge x=1281 | 525 px | **+0.013** |
| `master_bedroom_1` | slat wall x=60 | 710 px | **+0.027** |
| `master_bedroom_bathroom_view_1` | door edge x=1441 | 680 px | **−0.053** |

**Lateral CA is zero to within 0.05 px, even at r > 700 px.** Fully corrected in post.
**Set `chromaticAberration = 0.0`.**

---

## 4. Noise and micro-detail

### 4.1 Sensor noise: effectively none

Noise σ estimated as the standard deviation of the 4-neighbour Laplacian residual (÷√1.25) inside
flat wall/ceiling patches:

| photo / ROI | mean L | σR / σG / σB | σ luma |
|---|---|---|---|
| `family_room_1` ceiling (500,60,220,140) | 182.7 | 0.14 / 0.14 / 0.16 | **0.13** |
| `family_room_1` wall (380,470,200,120) | 191.2 | 0.16 / 0.15 / 0.10 | **0.12** |
| `basement_view_1` wall (950,470,200,90) | 184.1 | 0.14 / 0.14 / 0.14 | **0.14** |
| `master_bedroom_1` ceiling (900,80,260,150) | 195.4 | 0.15 / 0.13 / 0.10 | **0.11** |
| `master_bedroom_1` wall (1250,450,200,140) | 198.2 | 0.16 / 0.15 / 0.15 | **0.14** |

**σ ≈ 0.11–0.16 in 0–255 units** — about 0.05% of full scale, and *equal across R, G and B* (no
chroma-noise excess). This is what you get from averaging a 3–7 frame bracket, Lightroom NR, and a
downsample from ~24 MP to ~1.5 MP. There was no flat, mid-dark patch in the set large enough to
measure a shadow-noise figure separately, because there is no flat mid-dark patch — but nothing in
the darker regions reads noisier by eye at 6× zoom.

**Consequence: adding realistic film grain is a tell in the wrong direction.** Cap it at 0.2/255.

### 4.2 Sharpening halos

`foyer_view_of_front_door.png`, the black front door against its white casing at x = 601,
averaged over **401 rows** (y 300–700), aligned per row on peak gradient:

```
offset   R      G      B     (L)
  -4   198.2  196.2  193.6  196.5
  -3   194.5  192.5  189.7  192.8
  -2   202.0  200.0  197.3  200.3
  -1   232.3  230.2  227.8  230.6   <-- bright overshoot
   0   130.8  128.4  125.7  128.8
  +1    32.3   29.7   26.7   30.1   <-- dark undershoot
  +2    63.0   60.5   57.9   60.9
  +3    60.4   58.1   56.0   58.5
  +4    56.0   53.8   51.6   54.2
```

* plateaus: **194.8** (white) → **54.3** (dark), a 140-level step
* bright overshoot **+35.8** at exactly **−1 px**
* dark undershoot **−24.2** at exactly **+1 px**
* residual at ±2 px: +5.5 / +6.6; fully settled by ±3–4 px
* 10–90% transition width: **≈2 px**

**Halo width = 1 px core, ~2 px total. Amplitude ≈ 25% of the step on the bright side, 17% on the
dark side.** This is Lightroom capture sharpening (amount ≈120–150, radius ≈0.8–1.0) plus output
sharpening for screen. The 2-px transition also proves the images are at or near native pixel
resolution — they were not upscaled.

Confirmed on other edges: `kitchen_view_1` fridge edge +7.1 / −18.3; `master_bedroom_1` slat wall
+35.1 / −42.6; `foyer` window frame +2.9 / −46.5.

### 4.3 Depth of field: there isn't any

Edge transitions measured at every depth in the set are 1–2 px wide:

* `kitchen_view_1` near counter edge at x = 62, y 830–980 (≈2.5 ft from camera) — 10–90% in ~2 px
* `foyer` door edge at mid-depth (≈9 ft) — 2 px
* `kitchen_view_1` fridge edge at x = 1281 (≈18–20 ft) — 2 px
* `master_bedroom_bathroom_view_1` railing at x = 33 (≈3 ft, extreme corner) — 2 px

**Everything is sharp from ~2.5 ft to infinity.** Small aperture (f/8–f/11) at 14–15 mm makes the
whole frame hyperfocal. There is no bokeh, no focus falloff, and no diffraction softening anywhere.
Exteriors are equally uniform: `backyard_patio_1.png` has sharp deck-board seams at ~4 ft and sharp
foliage at 60 ft in the same frame.

---

## 5. Lighting behaviour to imitate

### 5.1 Every fixture is on, in every shot

Verified visually: recessed cans (`kitchen_view_1`, `kitchen_view_3`, `family_room_1`,
`basement_view_1`, `master_bedroom_1`, `bathroom_first_floor_1`, `master_bedroom_bathroom_view_1`),
brass pendants (`kitchen_view_1`, `kitchen_view_2`), the sputnik chandelier (`dining_room`), the
dandelion chandelier (`hallway_top_of_stairs…`), the vanity bar (`bathroom_first_floor_1`), the 2×4
lay-in troffer (`basement_workout_room`), the flush mount (`mudroom_1`), under-cabinet LED strips
(`kitchen_view_1`, `kitchen_view_3`), **and the gas fireplace is lit** (`family_room_1`) — in a
midday shot with sunlit windows.

### 5.2 Recessed cans produce no scallops

`family_room_1.png`, row 45, straight through a can:

```
x=300 →193   306→197   312→202   318→253   ... 354→254   360→196   366→180   372→189
```

The ceiling is at **193–197** right up to 6 px from the aperture, jumps to **253–254** inside it, and
returns to **189–196** on the far side (the 180 at x=366 is the trim ring's shadow, 1 sample wide).
**There is no glow, no halo, no scallop.**

Ceiling evenness across a whole frame:

* `family_room_1` row 110, x 60→1420: **205 → 178 → 183** — a smooth 13% gradient, monotonic, no peaks.
* `kitchen_view_3` row 150, x 60→1420: **196 → 190 → 201** — ±3%.

Walls below cans show no crescent either. Model the cans as broad, soft downlights with a very wide
cone, or simply as ceiling-attached area lights.

### 5.3 Shadow openness (ratio of shadow to lit surface)

| situation | shadow | lit | **sRGB ratio** | **linear ratio** |
|---|---|---|---|---|
| Backsplash directly under wall cabinets vs 40 px lower (`kitchen_view_3` col 600/700) | 177–198 | 204 | **0.87–0.97** | 0.79–0.95 |
| Island toe-kick recess vs lit oak floor 30 px away (`kitchen_view_3` col 700) | ~100 | ~185 | **0.54** | **0.31** |
| Bottom of a blank wall vs its top (`basement_bathroom` col 1044) | 161 | 187 | 0.86 | 0.75 |
| Corner of the same wall, worst case (`basement_bathroom` 760,850) | 132 | 194 | 0.68 | 0.48 |
| **Wall/ceiling inside corner** (`basement_bathroom` col 1200, y 40→190) | 184 | 190 | **0.97** | 0.95 |
| Direct-sun floor patch vs ambient carpet beside it (`master_bedroom_1`) | 190–199 (ambient) | 237 (sun) | **sun = 1.20–1.25×** | **sun = 1.47–1.64×** |

Two things to internalise:

* **There is NO ambient-occlusion line at a wall/ceiling junction.** The measured profile is a
  smooth 190 → 184 over 150 px with no local minimum at all. A render that drops a dark contact line
  into every drywall corner is instantly identifiable.
* **A direct-sun patch on a floor is only ~1.5× the ambient in linear display units.** The bracket
  merge and the tone curve compress the sun hard. A render with a 5:1 sun-to-ambient patch will scream.

### 5.4 Colour bleed between surfaces

Present and measurable. `basement_bathroom.png` white wall next to a warm beige tile floor:
R−B goes from **0** at the top of the wall to **+5** at the bottom (134,132,129 at 760,850), a bleed
that fades out over ~1 ft of wall. Kitchen and hallway walls adjacent to red-oak flooring carry a
sustained **+5 to +9 R−B** (`hallway_top_of_stairs…` wall 182.8/178.7/173.7).

### 5.5 A wall is never a flat wash

`basement_bathroom.png` — the blank right wall, 6×5 sample grid, box radius 12 px:

```
        x=760   x=902   x=1044  x=1186  x=1328  x=1470
y=220   166.8   186.4   187.0   185.5   188.4   194.0
y=378   183.4   184.9   185.9   186.8   190.1   193.5
y=535   179.2   181.5   179.9   178.5   181.8   185.1
y=693   151.1   172.1   161.3   171.4   173.7   179.0
y=850   131.9   159.6   160.8   164.6   169.6   175.0
```

One flat painted surface spans **132 → 194**, a **32% range**, with a smooth 2-D gradient driven by a
single ceiling fixture. Note also the *rightmost* column (nearest the frame edge) is the **brightest** —
further confirmation there is no vignette.

---

## 6. Concrete tuning table

### 6.1 `app/src/core/camera.js` / `cameras.json`

| parameter | value | source |
|---|---|---|
| `fovV` (interior) | **78.5°** | §1.2 |
| `fovV` (exterior) | **64°** | §1.2 |
| `aspect` | **1.505** | §1.1 |
| render size | **1526 × 1014** | §1.1 |
| `shift` | **0.00** (±0.02) | §1.4 |
| pitch | 0 (optionally ±0.25° random residual) | §1.4 |
| roll | 0 (optionally ±0.2° random residual) | §1.4 |
| camera Y, first floor | **LEVELS.first + 4.00** | §1.3 |
| camera Y, second floor | **LEVELS.second + 4.05** | §1.3 |
| camera Y, basement | **LEVELS.basement + 3.90** | §1.3 |
| lens distortion k1 | **0.0** | §1.5 |

### 6.2 `app/src/core/post.js`

| parameter | value | note |
|---|---|---|
| `toneMapping` | ACESFilmic, **softened highlight desaturation** | globes must stay 255/245/226, §3.1 |
| `toneMappingExposure` — interiors | **1.15** (start), then calibrate | target below |
| `toneMappingExposure` — exteriors | **0.95** | median 140, §2.4 |
| **calibration target (interiors)** | white wall (albedo 0.82) → **188 ± 6 sRGB**; frame median **185–195**; 60–75% of pixels in 160–207 | §2.4 |
| **calibration target (exteriors)** | frame median **135–145**; p10 ≈ 50, p90 ≈ 205 | §2.4 |
| **black point after grade** | lift output floor to **14/255 (0.055)**; p0.1 ≈ 12–30; **<0.3% below L=8**; only cavities reach 0 | §2.3 |
| **white point after grade** | p99.9 ≈ **250–254**; **≤0.15% at pure 255**; window medians **150–195** | §2.2 |
| `bloom.threshold` | **0.98** (emissive materials only) | §5.2 |
| `bloom.strength` | **0.06** (hard max 0.10) | §5.2 |
| `bloom.radius` | **0.15** | §5.2 |
| `vignette.amount` | **0.02** (hard max 0.04) | §2.1, §5.5 |
| `chromaticAberration.pixels` | **0.00** (hard max 0.03) | §3.4 |
| `filmGrain.amplitude` | **0.0006** (= 0.15/255), uniform, no chroma grain (hard max 0.0012) | §4.1 |
| **unsharp mask (add this — it's missing)** | radius **0.9 px**, amount **0.55**, threshold 0 → produces ≈ **+30 / −22** on a 140-level step | §4.2 |
| saturation / vibrance | interiors: neutral surfaces at **chroma 0**, frame mean chroma **8–28**; exteriors: frame mean chroma **40–60** | §3.3 |
| shadow tint | **warm**, +4 R−B at L≈130, decaying to 0 at L≈190. Never blue. | §3.2 |
| depth of field | **off** | §4.3 |

### 6.3 `app/src/core/lighting.js`

| parameter | value | source |
|---|---|---|
| **interior ambient-fill : key (linear)** | **0.55 : 1** — shadow-side surfaces must land at **0.45–0.65** of the lit value | §5.3 |
| deepest allowed interior occlusion | **0.31 linear** (toe-kicks, cabinet undersides); nothing darker except cavities | §5.3 |
| wall/ceiling corner AO | **0.95 minimum, no dark line, falloff over ≥100 px** | §5.3 |
| **sun patch : ambient on a floor** | **1.5 : 1 linear** (1.2 : 1 in sRGB) | §5.3 |
| **exterior sun : sky-fill** | **5 : 1 linear** (sun 83%, sky 17%) | §2.3, §5.3 |
| window/exterior plate luminance | must render at **0.9–1.1×** the adjacent interior wall's *display* luminance — i.e. tone-map the exterior separately, do not let it be 4–6 EV hot | §2.1, §2.2 |
| window plate tint | G ≥ R > B, B ≈ R − 15 | §2.2 |
| sky (seen directly, exteriors) | **R 147 / G 182 / B 253**, blue channel clipped, luma ≈ 182 | §2.2 |
| recessed cans | **3800 K**, emissive reads 254,254,253; very wide cone; no scallops | §3.1, §5.2 |
| decorative pendants / chandeliers | **2700 K**, emissive reads 255,245,226 | §3.1 |
| under-cabinet strips | on, ~3000 K, enough to keep the backsplash within 3–13% of the open counter | §5.3 |
| every fixture | **ON**, including the gas fireplace, in daylight scenes | §5.1 |
| single-surface gradient | a plain wall must span **≥15%** (target 20–32%) across its own extent | §5.5 |
| colour bleed | +5 R−B on white surfaces within 1 ft of warm wood/tile | §5.4 |

---

## 7. The top 10 things that will betray a render against *these* photographs

Ranked by how quickly a hostile critic will find them.

**1. Wrong field of view and camera height.**
`CONVENTIONS.md` prescribes fovV 55–75° at 4.6–5.4 ft; the photographs are **78.6° at 4.0 ft**. This
is not a subtle grade issue — the walls, the amount of ceiling, and the floor foreshortening will all
be visibly different from the reference, and it poisons every other comparison.
**Fix:** `fovV: 78.5`, `aspect: 1.505`, camera Y = level + 4.0 ft, `shift: 0.0`, pitch 0.

**2. Blown windows.**
The single loudest CG signature. A render clips windows to 255,255,255; these photographs put the
window median at **144–194** with p99 at **249** and **<0.5%** true white, and the exterior is
*legible* — leaves, fence pickets, mowing stripes, a sticker on the glass (`family_room_1`).
**Fix:** tone-map the exterior plate separately; land the window median at 150–195 sRGB, tinted
G ≥ R > B with B ≈ R−15; allow pure white only where open sky is in the aperture (≤1.3%).

**3. Crushed blacks.**
Renders sit on 0. An ordinary interior shadow in these photographs bottoms out at **L 25–70**, with
only **0.02–0.10%** of the frame below L=4 (`basement_view_1`: 0.004%).
**Fix:** lift the output floor to ~14/255; audit the histogram — if more than 0.3% of an interior
render is below L=8, the grade is wrong. Exteriors are the exception and *should* clip (0.5–0.7%).

**4. Bloom and glow around light fixtures.**
`CONVENTIONS.md` calls for "mild bloom". There is **none**. The ceiling 6 px from a 254-level recessed
can is at its normal 193–197 (`family_room_1` row 45); the ceiling 4 px from a 255-clipped chandelier
globe is at 195 (`dining_room` row 245).
**Fix:** bloom strength ≤0.06, threshold 0.98, radius 0.15 — or turn it off entirely.

**5. Missing the 1-px sharpening halo.**
Every high-contrast edge in the set carries a **+36 overshoot at −1 px and a −24 undershoot at +1 px**
on a 140-level step. A clean render edge, however physically correct, reads as "3D" because it lacks
this signature.
**Fix:** post-resize unsharp mask, radius 0.9 px, amount 0.55.

**6. Grain, CA and vignette added "for realism".**
All three are *absent* from the photographs: noise σ **0.11–0.16/255** on flat walls; lateral CA
**≤0.03 px** even at r > 700 px; radial luminance actually **rises** to 1.05× near the frame edge, and
the brightest column of `basement_bathroom`'s blank wall is the one nearest the frame border.
**Fix:** grain 0.0006 max, CA 0.0, vignette ≤0.02. Every one of these that you add makes the render
*easier* to spot, not harder.

**7. Cool shadows and a dark AO line in every corner.**
The photographs have **warm** shadows (+5 R−B at the dark end of one continuous wall) and **no
contact darkening at all** at a wall/ceiling junction — a smooth 190 → 184 over 150 px with no local
minimum.
**Fix:** tint shadows warm; suppress AO on drywall-to-drywall junctions; keep AO for real geometry
(toe-kicks, under-vanity, cabinet undersides) at a floor of 0.31 linear.

**8. Flat wall washes.**
`basement_bathroom`'s single blank wall runs **132 → 194** across itself. Uniform-albedo walls lit by
a distant ambient probe are the classic render giveaway.
**Fix:** place real fixtures, use area lights near the ceiling, and verify each large wall carries a
20–32% luminance gradient in the render.

**9. Sun and shadow contrast too high.**
The sunlit carpet patch in `master_bedroom_1` is only **1.2× the adjacent ambient carpet in sRGB
(1.5× linear)**. Under-cabinet shadows are only 3–13% down. A physically-lit render with an unclamped
sun and a 1:8 fill will look like a different building.
**Fix:** interior ambient-fill : key = 0.55 : 1; sun patch : ambient = 1.5 : 1 linear; exteriors 5 : 1.

**10. Depth of field, and any residual distortion or converging verticals.**
Nothing in the set is out of focus at any depth from 2.5 ft to 60 ft (2-px transitions throughout),
and long straight lines fit a straight line to **0.21–0.53 px RMS with ≤0.6 px sag** over 700-px spans.
Meanwhile verticals are corrected only to **~0.3°** — a wall corner still drifts up to 5 px across the
frame height, so a *perfectly* plumb render is very slightly cleaner than the reference.
**Fix:** DOF off; distortion exactly 0; and if you want the last 1%, add a ±0.25° residual pitch and
±0.2° roll per camera preset.

---

## 8. Reproducing these measurements

The scripts used are throwaway, but the methods are:

* **Sub-pixel edge tracing** — per scanline, take the peak of |∂L/∂x| within a small window, refine
  with a 3-point parabola, then RANSAC-fit a line (inlier band 1.0–1.5 px) and report slope, RMS and
  the quadratic sag. Low-contrast wall/ceiling junctions are traced as *luminance minima* rather than
  gradient peaks — the drywall shadow line is a 10–16 level dip, below any gradient threshold.
* **Two-VP calibration** — with the principal point on the frame's vertical centreline and square
  pixels, `f² = −(u₁ − c_x)(u₂ − c_x)` for the vanishing points of two perpendicular horizontal
  directions. Cross-check by reconstructing the two wall directions with the resulting `f` and
  confirming they come out 90° apart and match the floorplan lengths.
* **Camera height** — the horizon `y₀` is the intersection of a wall's floor line with its ceiling
  line; then `H / (h − H) = (v_floor − y₀) / (y₀ − v_head)` for any feature of known height `h`
  (door head 6'10"), and `C = h·(v_floor − v_ceiling)/(v_floor − v_head)` for the ceiling, which needs
  no `y₀` at all.
* **Noise** — σ of the 4-neighbour Laplacian residual ÷ √1.25 inside flat patches, per channel.
* **CA** — 50%-crossing position of each channel on a row-averaged edge profile.
* **Vignette** — average the per-image-normalised radial luminance profile over all 47 photos so that
  scene content cancels.
