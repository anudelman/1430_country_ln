/**
 * textures.js — procedural CanvasTexture library for 1430 Country Ln.
 *
 * CONTRACT (see docs/CONVENTIONS.md)
 * ---------------------------------
 * - 1 world unit = 1 foot.  Every texture declares `scaleFeet = [u, v]`, the
 *   real-world size in FEET that one full 0..1 UV tile covers.  Nothing in this
 *   file is "arbitrary tiling": a red-oak strip really is 3.25" wide.
 * - No network assets, no binaries.  Everything is drawn into a <canvas> from
 *   seeded noise, so the same build always yields the same pixels.
 * - Each entry returns a texture SET:
 *       { map, normalMap, roughnessMap, aoMap,
 *         [metalnessMap], [anisotropyMap], scaleFeet, size }
 *   `map` is SRGBColorSpace; every data map is NoColorSpace.  All are
 *   RepeatWrapping (except slabs flagged `clamp`) with anisotropy 8.
 * - DIRECTIONAL surfaces (satin-poly floors, carpet nap, mown grass) may also
 *   emit `anisotropyMap` (KHR_materials_anisotropy: RG = groove direction,
 *   B = strength) and a `tiltU`/`tiltV` field.  The tilt is a MACROSCOPIC
 *   surface orientation added to the sobel normal — carpet pile combed one
 *   way, mower blades laid over — not a bump, so it must not be differentiated
 *   out of the height field.
 * - Normal maps are DERIVED from the generated height field with a sobel
 *   operator, scaled by the texture's physical relief depth (`reliefFt`) and the
 *   texel footprint, so bump strength is physically consistent at every scale.
 *   `normalScale` in materials.js can therefore stay at 1.
 * - AO is a cavity map derived from the same height field.
 * - Resolution: 1024 base / 2048 hero (floors, counters, primary bath tile) at
 *   quality 'high'.  Lower qualities scale both down.  Results are cached by
 *   `name|size`.
 *
 * Public API
 * ----------
 *   makeTextures({ quality })   -> proxy object; `tex.redOakFloor` builds lazily
 *   getTexture(name, size?)     -> texture set
 *   TEXTURE_NAMES               -> string[]
 *   TEXTURE_INFO                -> { name: { scaleFeet, hero, note } }
 *   QUALITY_SIZES               -> { high, medium, draft, thumb }
 *   disposeTextures()           -> free GPU + cache
 *
 * Noise toolkit (exported for reuse by kit.js / rooms):
 *   mulberry32, perlin2, fbmT, noiseT, worleyT, ridgedT, warpT, streak,
 *   smoothstep, clamp01, mix, hexRGB
 *
 * Authoring rules learned the hard way (keep them)
 * ------------------------------------------------
 * 1. NYQUIST.  A noise frequency `f` over a tile of `L` feet rendered at `N`
 *    pixels gives L/f feet per cycle and N/f pixels per cycle.  Anything under
 *    ~3 px/cycle aliases into a fake cross-hatch ("canvas weave") instead of
 *    disappearing gracefully.  Keep detail frequencies under N/3.
 * 2. RELIEF IS PHYSICAL.  `reliefFt` is the true peak-to-valley depth of the
 *    surface.  A poly-finished floor is ~0.005", a slat wall is ~0.6".  Faking
 *    depth to "see the grain better" instantly reads as embossed plastic.
 * 3. VARIETY PER PIECE.  Every board / tile / stone gets its own seed AND its
 *    own parameters (see `boardGrain`).  One shared grain frequency across a
 *    whole floor reads as ripples, which is the fastest way to fail the blind
 *    test.
 * 4. RESTRAINT IN PALETTE.  Real finishes come from one mill / one dye lot.
 *    Wide random palettes read as patchwork laminate.  Calibrate the ALBEDO
 *    mean against the matching listing-photo crop (the red-oak atlas measures
 *    180/148/108, the photo's floor 181/143/109) before touching contrast.
 * 5. MODEL THE CAUSE, NOT THE LOOK.  The figure of a plain-sawn board is the
 *    intersection of cylindrical growth rings with a plane; a mower stripe is
 *    grass bent two ways; a quartz vein is a contour, not a threshold.  Every
 *    one of those got dramatically better the moment it was written as its own
 *    geometry instead of as stacked sine waves.
 *
 * Grain axes: redOakFloor / lightPlankFloor / butcherBlock / compositeDeck /
 * sunroomDeckSlat run along +U.  cherryCabinet* and woodSlatWall run along +V.
 */

import * as THREE from 'three';

/* ======================================================================== */
/* 1. Seeded PRNG + integer hashing                                          */
/* ======================================================================== */

/** Deterministic 32-bit PRNG.  Returns a function producing [0,1). */
export function mulberry32(seed) {
  let a = seed | 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 2D integer hash -> uint32. */
function ihash(x, y, seed) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Hash -> [0,1) */
function hrand(x, y, seed) {
  return ihash(x, y, seed) / 4294967296;
}

/* ======================================================================== */
/* 2. Scalar helpers                                                         */
/* ======================================================================== */

export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const mix = (a, b, t) => a + (b - a) * t;

export function smoothstep(e0, e1, x) {
  const t = clamp01((x - e0) / (e1 - e0 || 1e-9));
  return t * t * (3 - 2 * t);
}

/** #rrggbb or 0xrrggbb -> [r,g,b] in 0..1 (sRGB display values). */
export function hexRGB(h) {
  const v = typeof h === 'string' ? parseInt(h.replace('#', ''), 16) : h | 0;
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

function mixRGB(a, b, t) {
  return [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
}

function scaleRGB(c, k) {
  return [c[0] * k, c[1] * k, c[2] * k];
}

/* ======================================================================== */
/* 3. Tileable noise                                                         */
/* ======================================================================== */

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

// 256-entry unit-gradient table.  Using a table instead of cos/sin per corner
// makes perlin2 ~4x faster, which is what lets the hero floor be a 2048 atlas
// with five noise fields per texel.  Determinism is unchanged (same seed ->
// same index -> same gradient).
const GRAD_COS = new Float32Array(256);
const GRAD_SIN = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const a = (i + 0.5) * (Math.PI * 2 / 256);
  GRAD_COS[i] = Math.cos(a);
  GRAD_SIN[i] = Math.sin(a);
}

function pgrad(ix, iy, px, py, seed, dx, dy) {
  const wx = ((ix % px) + px) % px;
  const wy = ((iy % py) + py) % py;
  const h = ihash(wx, wy, seed) & 255;
  return GRAD_COS[h] * dx + GRAD_SIN[h] * dy;
}

/**
 * Periodic (tileable) Perlin gradient noise.  Repeats every `px` in x and
 * `py` in y (both must be positive integers).  Output roughly -1..1.
 */
export function perlin2(x, y, px, py, seed) {
  const X = Math.floor(x), Y = Math.floor(y);
  const fx = x - X, fy = y - Y;
  const u = fade(fx), v = fade(fy);
  const n00 = pgrad(X, Y, px, py, seed, fx, fy);
  const n10 = pgrad(X + 1, Y, px, py, seed, fx - 1, fy);
  const n01 = pgrad(X, Y + 1, px, py, seed, fx, fy - 1);
  const n11 = pgrad(X + 1, Y + 1, px, py, seed, fx - 1, fy - 1);
  const a = n00 + u * (n10 - n00);
  const b = n01 + u * (n11 - n01);
  return (a + v * (b - a)) * 1.45;
}

/**
 * Single-octave tileable noise in normalised tile space.
 * u,v in 0..1; fu,fv are INTEGER frequencies (cells across the tile).
 */
export function noiseT(u, v, fu, fv, seed) {
  const pu = Math.max(1, fu | 0), pv = Math.max(1, fv | 0);
  return perlin2(u * pu, v * pv, pu, pv, seed);
}

/**
 * Tileable fBm.  Frequencies double each octave so periodicity is preserved.
 * Returns approximately -1..1.
 */
export function fbmT(u, v, fu, fv, oct, seed, gain) {
  const g = gain === undefined ? 0.5 : gain;
  let amp = 1, sum = 0, norm = 0;
  for (let o = 0; o < oct; o++) {
    const pu = Math.max(1, (fu << o)), pv = Math.max(1, (fv << o));
    sum += amp * perlin2(u * pu, v * pv, pu, pv, seed + o * 7919);
    norm += amp;
    amp *= g;
  }
  return sum / norm;
}

/** Ridged multifractal — good for veins and cracks.  Returns 0..1. */
export function ridgedT(u, v, fu, fv, oct, seed, gain) {
  const g = gain === undefined ? 0.5 : gain;
  let amp = 1, sum = 0, norm = 0;
  for (let o = 0; o < oct; o++) {
    const pu = Math.max(1, (fu << o)), pv = Math.max(1, (fv << o));
    const n = 1 - Math.abs(perlin2(u * pu, v * pv, pu, pv, seed + o * 6151));
    sum += amp * n * n;
    norm += amp;
    amp *= g;
  }
  return sum / norm;
}

/**
 * Domain warp: returns warped [u,v] still in tile space.  Because the warp
 * field is itself periodic, the warped sample stays perfectly tileable.
 */
export function warpT(u, v, fu, fv, amount, seed) {
  const wu = fbmT(u, v, fu, fv, 3, seed);
  const wv = fbmT(u, v, fu, fv, 3, seed + 4517);
  return [u + wu * amount, v + wv * amount];
}

/**
 * Periodic Worley / cellular noise.  Returns { f1, f2, id } where f1/f2 are
 * distances to the nearest / second nearest feature point (grid units) and id
 * is the uint32 hash of the owning cell.
 */
export function worleyT(u, v, fu, fv, seed, jitter) {
  const px = Math.max(1, fu | 0), py = Math.max(1, fv | 0);
  const j = jitter === undefined ? 1 : jitter;
  const x = u * px, y = v * py;
  const xi = Math.floor(x), yi = Math.floor(y);
  let f1 = 1e9, f2 = 1e9, id = 0;
  for (let dj = -1; dj <= 1; dj++) {
    for (let di = -1; di <= 1; di++) {
      const cx = xi + di, cy = yi + dj;
      const h = ihash(((cx % px) + px) % px, ((cy % py) + py) % py, seed);
      const ox = 0.5 + (((h & 1023) / 1024) - 0.5) * j;
      const oy = 0.5 + ((((h >>> 10) & 1023) / 1024) - 0.5) * j;
      const dx = cx + ox - x, dy = cy + oy - y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < f1) { f2 = f1; f1 = d; id = h; }
      else if (d < f2) { f2 = d; }
    }
  }
  return { f1, f2, id };
}

/* ======================================================================== */
/* 4. Field utilities (Float32Array images)                                  */
/* ======================================================================== */

// Texture sizes are always powers of two; every field op wraps so the
// generated maps stay seamless.
function wrapIdx(x, y, s) {
  const xx = x < 0 ? x + s : x >= s ? x - s : x;
  const yy = y < 0 ? y + s : y >= s ? y - s : y;
  return yy * s + xx;
}

/** Separable box blur with wrap-around. */
function boxBlur(src, size, rx, ry) {
  const n = size * size;
  let tmp = new Float32Array(n);
  const out = new Float32Array(n);
  if (rx > 0) {
    const w = rx * 2 + 1;
    for (let y = 0; y < size; y++) {
      let acc = 0;
      for (let k = -rx; k <= rx; k++) acc += src[wrapIdx(k, y, size)];
      for (let x = 0; x < size; x++) {
        tmp[y * size + x] = acc / w;
        acc += src[wrapIdx(x + rx + 1, y, size)] - src[wrapIdx(x - rx, y, size)];
      }
    }
  } else {
    tmp = src;
  }
  if (ry > 0) {
    const w = ry * 2 + 1;
    for (let x = 0; x < size; x++) {
      let acc = 0;
      for (let k = -ry; k <= ry; k++) acc += tmp[wrapIdx(x, k, size)];
      for (let y = 0; y < size; y++) {
        out[y * size + x] = acc / w;
        acc += tmp[wrapIdx(x, y + ry + 1, size)] - tmp[wrapIdx(x, y - ry, size)];
      }
    }
  } else {
    out.set(tmp);
  }
  return out;
}

/**
 * Directional streak filter — anisotropic blur used for brushed metal, carpet
 * nap, broom-finished concrete and wood ray fleck.
 */
export function streak(src, size, rx, ry) {
  return boxBlur(src, size, rx | 0, ry | 0);
}

/**
 * Sobel height -> tangent-space normal RGBA (OpenGL green-up convention).
 * `sx`/`sy` are slope gains: reliefFeet / texelFeet along each axis.
 */
function normalFromHeight(h, size, sx, sy, tiltU, tiltV) {
  const out = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const l = h[wrapIdx(x - 1, y, size)], r = h[wrapIdx(x + 1, y, size)];
      const u = h[wrapIdx(x, y - 1, size)], d = h[wrapIdx(x, y + 1, size)];
      const ul = h[wrapIdx(x - 1, y - 1, size)], ur = h[wrapIdx(x + 1, y - 1, size)];
      const dl = h[wrapIdx(x - 1, y + 1, size)], dr = h[wrapIdx(x + 1, y + 1, size)];
      // Sobel
      const gx = (ul + 2 * l + dl) - (ur + 2 * r + dr);
      const gy = (dl + 2 * d + dr) - (ul + 2 * u + ur);
      let nx = gx * 0.125 * sx;
      let ny = gy * 0.125 * sy;
      // A *macroscopic* tilt that is not part of the height field: mown grass
      // blades laid over, carpet nap combed one way.  These are real surface
      // orientations, not bumps, so they must not be differentiated from h.
      if (tiltU) nx += tiltU[y * size + x];
      if (tiltV) ny += tiltV[y * size + x];
      const nz = 1;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx *= inv; ny *= inv;
      const i = (y * size + x) * 4;
      out[i] = (nx * 0.5 + 0.5) * 255;
      out[i + 1] = (ny * 0.5 + 0.5) * 255;
      out[i + 2] = (nz * inv * 0.5 + 0.5) * 255;
      out[i + 3] = 255;
    }
  }
  return out;
}

/** Cavity AO from a height field: crevices darken. */
function cavityAO(h, size, strength, radius) {
  const r = Math.max(1, Math.round((radius === undefined ? 0.012 : radius) * size));
  const blurred = boxBlur(h, size, r, r);
  const out = new Float32Array(size * size);
  for (let i = 0; i < out.length; i++) {
    const d = blurred[i] - h[i];
    out[i] = clamp01(1 - Math.max(0, d) * strength);
  }
  return out;
}

/* ======================================================================== */
/* 5. Canvas packing                                                         */
/* ======================================================================== */

function newCanvas(size) {
  if (typeof document !== 'undefined' && document.createElement) {
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    return c;
  }
  /* eslint-disable-next-line no-undef */
  return new OffscreenCanvas(size, size);
}

const to255 = (x) => (x <= 0 ? 0 : x >= 1 ? 255 : x * 255);

function canvasFromRGB(rgb, size) {
  const c = newCanvas(size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let i = 0, p = 0; i < size * size; i++) {
    d[i * 4] = to255(rgb[p++]);
    d[i * 4 + 1] = to255(rgb[p++]);
    d[i * 4 + 2] = to255(rgb[p++]);
    d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function canvasFromScalar(f, size) {
  const c = newCanvas(size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let i = 0; i < size * size; i++) {
    const v = to255(f[i]);
    d[i * 4] = v; d[i * 4 + 1] = v; d[i * 4 + 2] = v; d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/**
 * Pack an anisotropy map: RG = the tangent-space direction of the microfacet
 * grooves encoded as (dir*0.5+0.5), B = strength.  This is the glTF
 * KHR_materials_anisotropy layout that MeshPhysicalMaterial.anisotropyMap
 * consumes, and it is what makes a satin-poly floor smear its highlight ALONG
 * the boards instead of blooming isotropically.
 */
function canvasFromAniso(str, ang, size) {
  const c = newCanvas(size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let i = 0; i < size * size; i++) {
    const a = ang ? ang[i] : 0;
    d[i * 4] = to255(Math.cos(a) * 0.5 + 0.5);
    d[i * 4 + 1] = to255(Math.sin(a) * 0.5 + 0.5);
    d[i * 4 + 2] = to255(str[i]);
    d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function canvasFromRGBA(bytes, size) {
  const c = newCanvas(size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  img.data.set(bytes);
  ctx.putImageData(img, 0, 0);
  return c;
}

function makeTex(canvas, srgb, clamp) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  const w = clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  t.wrapS = w; t.wrapT = w;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

/**
 * Turn a generator spec into a texture set.
 * spec: { size, alb, hgt, rgh, met?, reliefFt, aoStrength?, aoRadius?, scaleFeet, clamp? }
 */
function pack(name, spec) {
  const size = spec.size;
  const [fu, fv] = spec.scaleFeet;
  const relief = spec.reliefFt === undefined ? 0.002 : spec.reliefFt;
  const sx = relief / (fu / size);
  const sy = relief / (fv / size);
  const nrm = normalFromHeight(spec.hgt, size, sx, sy, spec.tiltU, spec.tiltV);
  const ao = cavityAO(
    spec.hgt, size,
    spec.aoStrength === undefined ? 1.4 : spec.aoStrength,
    spec.aoRadius
  );
  const set = {
    name,
    size,
    scaleFeet: [fu, fv],
    clamp: !!spec.clamp,
    map: makeTex(canvasFromRGB(spec.alb, size), true, spec.clamp),
    normalMap: makeTex(canvasFromRGBA(nrm, size), false, spec.clamp),
    roughnessMap: makeTex(canvasFromScalar(spec.rgh, size), false, spec.clamp),
    aoMap: makeTex(canvasFromScalar(ao, size), false, spec.clamp),
  };
  if (spec.met) set.metalnessMap = makeTex(canvasFromScalar(spec.met, size), false, spec.clamp);
  // Cut-out sheets (foliage cards, screens): `spec.alp` is a 0..1 coverage
  // field. Used with material.alphaTest, so it also drives the shadow pass.
  if (spec.alp) set.alphaMap = makeTex(canvasFromScalar(spec.alp, size), false, spec.clamp);
  if (spec.anisoStr) {
    set.anisotropyMap = makeTex(canvasFromAniso(spec.anisoStr, spec.anisoAng, size), false, spec.clamp);
  }
  return set;
}

/** Allocate the working buffers for a generator. */
function blank(size, scaleFeet) {
  const n = size * size;
  return {
    size,
    scaleFeet,
    alb: new Float32Array(n * 3),
    hgt: new Float32Array(n),
    rgh: new Float32Array(n),
    met: null,
  };
}

function setPx(s, i, c, h, r) {
  s.alb[i * 3] = c[0];
  s.alb[i * 3 + 1] = c[1];
  s.alb[i * 3 + 2] = c[2];
  s.hgt[i] = h;
  s.rgh[i] = r;
}

/* ======================================================================== */
/* 6. Shared shape helpers                                                   */
/* ======================================================================== */

/**
 * Running-bond tile lattice.
 * u,v in FEET inside the tile; tw/th tile face size in FEET.
 * `stagger` is the per-row offset as a fraction of tw (0.5 = half bond).
 * Returns { i, j, lu, lv, edgeFt } where edgeFt is the distance in feet to the
 * nearest tile border.
 */
function lattice(u, v, tw, th, stagger) {
  const j = Math.floor(v / th);
  const uu = u - stagger * tw * j;
  const i = Math.floor(uu / tw);
  const lu = uu / tw - i;
  const lv = v / th - j;
  const du = Math.min(lu, 1 - lu) * tw;
  const dv = Math.min(lv, 1 - lv) * th;
  return { i, j, lu, lv, edgeFt: Math.min(du, dv) };
}

/**
 * Wood grain field.  Returns { ring, pore, fleck } all 0..1.
 * `t` is the local across-grain coordinate (0..1 within one board),
 * `u`,`v` are normalised tile coordinates used for the (tileable) noise.
 */
function woodGrain(u, v, t, seed, cfg) {
  // Slow along-grain warp bends the growth rings into cathedral arches.
  const warp = fbmT(u, v, cfg.warpFU, cfg.warpFV, 4, seed) * cfg.warpAmp
    + fbmT(u, v, cfg.warpFU * 3, cfg.warpFV * 2, 2, seed + 31) * cfg.warpAmp * 0.35
    + fbmT(u, v, cfg.warpFU * 9, cfg.warpFV * 3, 2, seed + 57) * cfg.warpAmp * 0.13;
  const phase = t * cfg.rings + warp;
  const f = phase - Math.floor(phase);
  const d = Math.min(f, 1 - f);
  // broad tonal band inside one growth ring (light earlywood -> dark latewood)
  const band = smoothstep(0.10, 0.92, f);
  // thin latewood line
  let ring = 1 - smoothstep(0.0, cfg.ringWidth, d);
  ring *= 0.6 + 0.4 * (0.5 + 0.5 * fbmT(u, v, cfg.warpFU * 2, cfg.warpFV * 4, 2, seed + 77));
  // fine straight grain streaks running along the board
  const fine = fbmT(u, v, cfg.fineFU, cfg.fineFV, 2, seed + 211);
  ring = clamp01(ring + Math.max(0, fine) * cfg.fineAmt);
  // open pores (oak): short dashes along the grain
  const pn = fbmT(u, v, cfg.poreFU, cfg.poreFV, 2, seed + 913);
  const pore = smoothstep(cfg.poreThresh, cfg.poreThresh + 0.16, pn) * cfg.poreAmt;
  // ray fleck: faint lighter slashes across the grain
  const fl = fbmT(u, v, cfg.fleckFU, cfg.fleckFV, 2, seed + 1777);
  const fleck = smoothstep(0.42, 0.72, fl) * cfg.fleckAmt;
  return { ring, pore, fleck, band };
}

/**
 * Derive a per-board grain config.  `r` in 0..1 slides the board from tight
 * rift-sawn (many straight rings) to plainsawn (few, strongly arched rings).
 */
function boardGrain(base, r) {
  const cut = r * r;                       // bias toward plainsawn
  return Object.assign({}, base, {
    rings: base.rings * (2.35 - 1.75 * cut),
    warpAmp: base.warpAmp * (0.22 + 1.55 * cut),
    fineAmt: base.fineAmt * (1.35 - 0.6 * cut),
  });
}

/* ======================================================================== */
/* 7. Generators                                                             */
/* ======================================================================== */

/* ---------------------------------------------------------- red oak floor */
/**
 * 3-1/4" site-finished red oak strip, natural (unstained), satin polyurethane.
 * THE hero surface: it is in almost every first-floor photograph.
 *
 * Tile: 12.0 ft of board run x 16 strips (4.333 ft) across.
 *
 * THE FIGURE IS GEOMETRY, NOT SINE WAVES.  A log's growth rings are cylinders
 * about the pith.  A plain-sawn board's face is a plane at distance D from that
 * axis, so the ring phase at a point on the face is
 *
 *      phase = ringsPerInch * sqrt( (x - x0)^2 + D^2 )
 *
 * with `x` the across-board position in INCHES.  D and x0 wander slowly along
 * the board, because no log is straight and no saw cut is parallel to the pith.
 * That single equation produces, in the correct proportions and without any
 * extra tuning:
 *
 *   - wide open CATHEDRAL arches wherever the wander brings D near zero,
 *   - the nested-V figure of one arch inside the next,
 *   - the fine, dense, near-parallel stripe that crowds the edges of the board
 *     (large |x-x0| -> phase ~ |x-x0| -> full ringsPerInch spacing),
 *   - and the smooth transition between the two along one board.
 *
 * Layered on top: the earlywood pore band (red oak's open pores, as short dark
 * ticks just after each ring boundary), ray fleck, per-board colour lottery
 * (some boards distinctly pink, some blond, some carrying a mineral streak),
 * a hairline seam at each strip, tight butt joints on a staggered layout, and
 * an ANISOTROPIC satin-poly sheen streaked along the boards.
 */
function genRedOakFloor(size) {
  const STRIP = 3.25 / 12;            // 3-1/4" face
  const rows = 14;
  const TV = STRIP * rows;            // 3.7917 ft across
  const TU = 11.0;                    // 11 ft of board run
  const s = blank(size, [TU, TV]);
  const rng = mulberry32(0x0a11ce);

  /* --- one mill, one dye lot: the spread is in figure and value, not hue --- */
  const AMBER = [
    hexRGB('#c4a374'), hexRGB('#bf9d6f'), hexRGB('#c9a97b'), hexRGB('#bb9769'),
    hexRGB('#c2a172'), hexRGB('#c6a678'),
  ];
  const PINK = [hexRGB('#c39a73'), hexRGB('#bf946e'), hexRGB('#c69e78')];
  const BLOND = [hexRGB('#cdb289'), hexRGB('#d0b68e'), hexRGB('#c9ad83')];

  /* --- board layout: 3-4 boards per 12 ft row, ends staggered ------------ */
  const rowsData = [];
  for (let r = 0; r < rows; r++) {
    const k = 3 + ((rng() * 2) | 0);          // 3 or 4 boards -> 3-4 ft average
    const lens = [];
    let sum = 0;
    for (let i = 0; i < k; i++) { const L = 0.62 + rng() * 0.95; lens.push(L); sum += L; }
    // rotate the cut list by a random phase so joints never line up row to row
    const rot = rng() * TU;
    const cuts = new Float64Array(k);
    let acc = 0;
    for (let i = 0; i < k; i++) { cuts[i] = (acc + rot) % TU; acc += (lens[i] / sum) * TU; }
    cuts.sort();
    const boards = [];
    for (let i = 0; i < k; i++) {
      const lot = rng();
      const tone = lot < 0.17 ? PINK[(rng() * PINK.length) | 0]
        : lot < 0.32 ? BLOND[(rng() * BLOND.length) | 0]
          : AMBER[(rng() * AMBER.length) | 0];
      boards.push({
        tone,
        light: 0.950 + rng() * 0.110,         // board-to-board value spread
        cool: 0.985 + rng() * 0.055,          // blue-channel trim (pink <-> neutral)
        seed: (rng() * 100000) | 0,
        // Pith geometry, in inches.  `Dmin` is how close the pith comes to
        // the face and `Damp` how much it wanders; both are small, because a
        // 3-1/4" strip is sawn close to the pith plane and its rings therefore
        // run mostly LENGTHWISE, flaring into a cathedral only where the pith
        // rises toward the face.  `x0` is where the flare sits across the
        // board: inside the face for a cathedral board, well outside it for a
        // rift/straight-grain board (roughly half the boards in the photos).
        Dmin: 0.03 + rng() * 0.22,
        Damp: 0.35 + rng() * 1.15,
        x0: rng() < 0.55 ? (rng() - 0.5) * 3.0 : (rng() < 0.5 ? -1 : 1) * (2.0 + rng() * 5.0),
        xw: 0.30 + rng() * 0.95,
        rpi: 6.0 + rng() * 4.0,               // 6-10 growth rings per inch
        lateW: 0.26 + rng() * 0.14,           // latewood share of a ring
        contrast: 0.19 + rng() * 0.20,
        poreAmt: 0.50 + rng() * 0.40,
        mineral: rng() < 0.16 ? 0.4 + rng() * 0.45 : 0,
        rough: -0.02 + rng() * 0.05,
      });
    }
    // per-x board index + distance to the nearest butt joint (circular)
    const idx = new Int32Array(size);
    const jd = new Float32Array(size);
    for (let x = 0; x < size; x++) {
      const u = ((x + 0.5) / size) * TU;
      let j = k - 1;
      for (let q = 0; q < k; q++) if (u >= cuts[q]) j = q;
      idx[x] = j;
      let best = 1e9;
      for (let q = 0; q < k; q++) {
        let d = Math.abs(u - cuts[q]);
        if (d > TU * 0.5) d = TU - d;
        if (d < best) best = d;
      }
      jd[x] = best;
    }
    rowsData.push({ boards, idx, jd });
  }

  /* --- satin-poly sheen: long streaks smeared ALONG the boards ----------- */
  const n = size * size;
  const raw = new Float32Array(n);
  for (let y = 0; y < size; y++) {
    const v01 = (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      const u01 = (x + 0.5) / size;
      raw[y * size + x] = fbmT(u01, v01, 3, 22, 3, 0x5ee, 0.62) * 0.5 + 0.5;
    }
  }
  const sheenF = streak(raw, size, Math.max(2, Math.round(size * 0.035)), 0);
  const buffRaw = new Float32Array(n);
  for (let y = 0; y < size; y++) {
    const v01 = (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      const u01 = (x + 0.5) / size;
      buffRaw[y * size + x] = fbmT(u01, v01, 6, 190, 2, 0x8ee) * 0.5 + 0.5;
    }
  }
  const buffF = streak(buffRaw, size, Math.max(3, Math.round(size * 0.05)), 0);

  s.anisoStr = new Float32Array(n);

  // across-board inches covered by one texel — drives the ring antialiasing
  const DXI_PER_PX = 3.25 * rows / size;
  const seam = hexRGB('#96754f');
  const joint = hexRGB('#7d5f42');
  const bevelFt = 0.0030;             // ~1/32" eased top edge, both sides
  const jointFt = 0.0055;             // tight butt joint, ~1/16" of visible line

  for (let y = 0; y < size; y++) {
    const v01 = (y + 0.5) / size;
    const v = v01 * TV;
    const row = Math.min(rows - 1, Math.floor(v / STRIP));
    const t = (v - row * STRIP) / STRIP;      // 0..1 across one strip
    const rd = rowsData[row];
    const edgeFt = Math.min(t, 1 - t) * STRIP;
    const bev = smoothstep(0, bevelFt, edgeFt);
    const xi0 = (t - 0.5) * 3.25;             // across-board position, inches

    for (let x = 0; x < size; x++) {
      const u01 = (x + 0.5) / size;
      const i = y * size + x;
      const b = rd.boards[rd.idx[x]];
      const sd = b.seed;

      /* -------- pith geometry -> ring phase --------
         The pith wanders along the board at ~2 ft per cycle, which is what
         sets the LENGTH of one cathedral flare; the photographs show flares
         roughly a foot long on a 3-1/4" face, with tight near-parallel grain
         in between where the pith has receded. */
      const q = clamp01(0.5 + 0.5 * (fbmT(u01, v01, 7, 1, 3, sd) * 0.80
        + fbmT(u01, v01, 18, 2, 2, sd + 811) * 0.30));
      const D = b.Dmin + b.Damp * q;
      const xa = b.x0 + b.xw * fbmT(u01, v01, 9, 1, 2, sd + 1117);
      const dx = xi0 - xa;
      const rad = Math.sqrt(dx * dx + D * D);
      let phase = b.rpi * rad;
      // the rings themselves are not perfect circles
      phase += fbmT(u01, v01, 6, 90, 2, sd + 31) * 0.34
        + fbmT(u01, v01, 2, 14, 2, sd + 47) * 0.30;
      const f = phase - Math.floor(phase);

      /* -------- one growth ring: pale porous earlywood ramping into dense
         dark latewood, then a hard boundary back to the next ring.
         The latewood line keeps a roughly constant PHYSICAL width, so where
         the rings splay open at an arch apex the dark band does not balloon
         into a lens: `g` is the ring's obliquity to the face. */
      const g = Math.abs(dx) / rad;
      let w = b.lateW * (0.30 + 0.70 * g);
      // Analytic antialiasing.  Where the rings crowd below ~3 texels the line
      // is widened and proportionally lightened, so it fades into an even
      // darkening instead of breaking into moire (see NYQUIST, top of file).
      const wMin = Math.min(0.46, 1.5 * b.rpi * g * DXI_PER_PX);
      const aa = w >= wMin ? 1 : w / wMin;
      if (w < wMin) w = wMin;
      const ring = smoothstep(1 - w, 1 - w * 0.25, f) * aa;
      const band = smoothstep(0.18, 1 - w, f) * 0.26;    // the tonal ramp
      const early = 1 - smoothstep(0.0, 0.40, f);        // pore zone
      // not every growth ring is equally dark
      const ringK = 0.55 + 0.55 * (0.5 + 0.5 * fbmT(u01, v01, 4, 34, 2, sd + 55));

      /* -------- open pores: short dark ticks in the earlywood band ------- */
      const poreN = fbmT(u01, v01, 420, 150, 2, sd + 913);
      const pore = smoothstep(0.02, 0.30, poreN) * early * b.poreAmt;

      /* -------- ray fleck: pale slashes lying across the grain ----------- */
      const fl = fbmT(u01, v01, 26, 90, 2, sd + 1777);
      const fleck = smoothstep(0.30, 0.66, fl) * 0.09;

      /* -------- colour -------- */
      let c = scaleRGB(b.tone, b.light);
      c = [c[0], c[1], c[2] * b.cool];
      // slow tonal drift down the length of the board
      c = scaleRGB(c, 1 + fbmT(u01, v01, 3, 2, 3, sd + 5) * 0.050
        + fbmT(u01, v01, 9, 7, 2, sd + 9) * 0.030);
      c = scaleRGB(c, 1 + early * 0.014 * g - band * b.contrast * 0.70);
      // the latewood line is warm dark brown, never neutral
      const k = 1 - b.contrast * 1.45 * ringK;
      c = mixRGB(c, [c[0] * k, c[1] * k * 0.955, c[2] * k * 0.90], ring);
      c = mixRGB(c, scaleRGB(c, 0.70), pore * 0.55);
      c = mixRGB(c, scaleRGB(c, 1.06), fleck);
      if (b.mineral) {
        const mn = smoothstep(0.58, 0.92, fbmT(u01, v01, 4, 30, 3, sd + 77));
        c = mixRGB(c, [c[0] * 0.62, c[1] * 0.60, c[2] * 0.63], mn * b.mineral);
      }

      /* -------- relief: only the pores and the ring valleys ------------- */
      let h = 0.62 - pore * 0.55 - ring * 0.12;

      /* -------- strip seam + butt joint -------- */
      h *= 0.30 + 0.70 * bev;
      c = mixRGB(seam, c, 0.34 + 0.66 * bev);
      const ej = smoothstep(0, jointFt, rd.jd[x]);
      h *= 0.34 + 0.66 * ej;
      c = mixRGB(joint, c, 0.40 + 0.60 * ej);

      /* -------- satin poly, streaked along the boards ------------------- */
      const sh = sheenF[i], bf = buffF[i];
      let r = 0.285 + b.rough + (sh - 0.5) * 0.11 + (bf - 0.5) * 0.05
        + pore * 0.16 + ring * 0.02;
      r = mix(0.55, r, bev * ej);
      setPx(s, i, c, h, clamp01(r));
      // the poly film's micro-grooves run with the boards (+U)
      s.anisoStr[i] = clamp01(0.72 + (sh - 0.5) * 0.5) * bev * ej;
    }
  }
  s.reliefFt = 0.00042;
  s.aoStrength = 0.30;
  s.aoRadius = 0.008;
  return s;
}

/* ------------------------------------------------------ light plank floor */
/** Mudroom LVP: ~7" wide gray-beige planks, matte, micro-beveled. */
function genLightPlankFloor(size) {
  const TU = 6.0, TV = 7 / 12 * 4; // 4 planks of 7"
  const PW = 7 / 12;
  const rows = 4;
  const s = blank(size, [TU, TV]);
  const rng = mulberry32(0x51a7b);

  const tones = [hexRGB('#cbb08a'), hexRGB('#c2a681'), hexRGB('#d1b993'), hexRGB('#bb9e79')];
  const rowsData = [];
  for (let r = 0; r < rows; r++) {
    const k = 2;
    const cut = TU * (0.35 + rng() * 0.3);
    const boards = [
      { u0: 0, u1: cut, tone: tones[(rng() * 4) | 0], seed: (rng() * 1e5) | 0, light: 0.93 + rng() * 0.16, r: rng() },
      { u0: cut, u1: TU, tone: tones[(rng() * 4) | 0], seed: (rng() * 1e5) | 0, light: 0.93 + rng() * 0.16, r: rng() },
    ];
    rowsData.push(boards);
  }

  const cfg = {
    rings: 1.3, ringWidth: 0.038, warpFU: 4, warpFV: 2, warpAmp: 0.85,
    fineFU: 6, fineFV: 210, fineAmt: 0.22,
    poreFU: 260, poreFV: 120, poreThresh: 0.34, poreAmt: 0.35,
    fleckFU: 30, fleckFV: 20, fleckAmt: 0.10,
  };
  const seam = hexRGB('#8b7c68');

  for (let y = 0; y < size; y++) {
    const v01 = (y + 0.5) / size;
    const v = v01 * TV;
    const row = Math.min(rows - 1, Math.floor(v / PW));
    const t = (v - row * PW) / PW;
    const boards = rowsData[row];
    for (let x = 0; x < size; x++) {
      const u01 = (x + 0.5) / size;
      const u = u01 * TU;
      const b = u < boards[0].u1 ? boards[0] : boards[1];
      const i = y * size + x;
      const g = woodGrain(u01, v01, t, b.seed, boardGrain(cfg, b.r));

      let c = scaleRGB(b.tone, b.light);
      c = scaleRGB(c, 1 + fbmT(u01, v01, 3, 2, 3, b.seed + 9) * 0.05);
      c = scaleRGB(c, 1 - g.band * 0.055 - g.ring * 0.115);
      // gray wash typical of coastal-oak LVP
      c = mixRGB(c, [0.66, 0.64, 0.61], 0.10 + g.ring * 0.10);
      c = mixRGB(c, scaleRGB(c, 0.76), g.pore * 0.4);

      let h = 0.6 - g.pore * 0.45 - g.ring * 0.18;
      const bw = 0.045;
      const bev = smoothstep(0, 1, Math.min(1, Math.min(t, 1 - t) / bw));
      h *= 0.1 + 0.9 * bev;
      c = mixRGB(seam, c, 0.3 + 0.7 * bev);

      const de = Math.min(u - b.u0, b.u1 - u);
      const ej = smoothstep(0, 0.006, de);
      h *= 0.2 + 0.8 * ej;
      c = mixRGB(seam, c, 0.35 + 0.65 * ej);

      const r = mix(0.70, 0.44 + g.pore * 0.18 + g.ring * 0.06, bev * ej);
      setPx(s, i, c, h, clamp01(r));
    }
  }
  s.reliefFt = 0.0010;
  s.aoStrength = 0.5;
  return s;
}

/* --------------------------------------------------------- quartz (white) */
/**
 * Calacatta-look engineered quartz (the counters AND the full-height slab
 * backsplash — one product, one slab lot).
 *
 * What the photographs actually show (`kitchen_view_1`, `kitchen_view_3`):
 * a near-white, very slightly warm field carrying THIN, wispy, branching grey
 * veins that run in long diagonal sweeps.  Individual veins are hairline —
 * about 1-3 mm — and they FADE: one stretch of a vein reads mid-grey, twenty
 * inches later the same vein is barely there.  Each strong vein trails a much
 * wider, much fainter grey shadow, because the pigment is suspended a
 * millimetre or two BELOW the polished surface and the resin scatters it.
 * Around and between them run finer capillaries at a third the width.
 *
 * So the field is built as four superimposed layers, each with its own
 * frequency, width, colour and — critically — its own low-frequency OPACITY
 * mask, rather than as one thresholded ridged-noise blob.
 */

/**
 * One vein.  A vein is the ZERO CONTOUR of a smooth noise field, not the ridge
 * of a threshold: that is what makes it a long, continuous, wandering line
 * that forks and rejoins instead of a chain of blobs.  `w` is the half-width
 * of the core in noise units; the same distance field gives the wide soft
 * halo for free.
 */
function veinLine(u, v, fu, fv, seed, w) {
  const n = noiseT(u, v, fu, fv, seed)
    + 0.26 * noiseT(u, v, fu * 3, fv * 3, seed + 7)
    + 0.07 * noiseT(u, v, fu * 8, fv * 8, seed + 13);
  const d = Math.abs(n);
  return {
    core: 1 - smoothstep(w * 0.30, w, d),
    halo: 1 - smoothstep(w, w * 7, d),
  };
}

function quartzField(size, TU, TV, seedBase, opts) {
  const o = opts || {};
  const s = blank(size, [TU, TV]);
  const base = hexRGB('#f4f3f0');
  const warm = hexRGB('#eeebe3');
  const veinDark = hexRGB('#7b828a');
  const veinMid = hexRGB('#9ba1a7');
  const veinPale = hexRGB('#c8ccce');
  const amt = o.veinAmt === undefined ? 1 : o.veinAmt;
  // Slab veins sweep diagonally, so the noise domain is sheared, not isotropic.
  const SH = o.shear === undefined ? 0.42 : o.shear;

  for (let y = 0; y < size; y++) {
    const v01 = (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      const u01 = (x + 0.5) / size;
      const i = y * size + x;
      const du = u01 + v01 * SH;
      const dv = v01 - u01 * SH * 0.25;

      // one shared domain warp: it is what makes the veins wander
      const w = warpT(du, dv, 2, 3, 0.16, seedBase + 3);
      const uu = w[0], vv = w[1];

      const L1 = veinLine(uu, vv, 2, 3, seedBase, 0.030);
      const L2 = veinLine(uu, vv, 3, 5, seedBase + 51, 0.020);
      const L3 = veinLine(uu, vv, 6, 9, seedBase + 91, 0.013);
      const L4 = veinLine(uu, vv, 11, 16, seedBase + 131, 0.009);

      // Opacity masks.  A real vein does not run at constant strength: it
      // surfaces, fades to nothing, and comes back a foot later.
      const mk = fbmT(u01, v01, 3, 3, 3, seedBase + 201);
      const m1 = 0.10 + 0.90 * smoothstep(-0.50, 0.35, mk);
      const m2 = 0.08 + 0.92 * smoothstep(0.35, -0.50, mk);
      const m3 = 0.12 + 0.88 * smoothstep(-0.45, 0.45,
        fbmT(u01, v01, 5, 5, 2, seedBase + 307));

      let c = mixRGB(base, warm, 0.5 + 0.5 * fbmT(u01, v01, 2, 2, 2, seedBase + 77));
      // haloes first — the pigment is suspended a millimetre UNDER the polish,
      // and the resin scatters it into a much wider, much fainter shadow.
      // Without this the veins read as ink printed on the surface.
      c = mixRGB(c, veinPale, clamp01((L1.halo * 0.34 * m1 + L2.halo * 0.20 * m2
        + L3.halo * 0.10 * m3) * amt));
      c = mixRGB(c, veinMid, clamp01((L4.core * 0.13 * m3 + L3.core * 0.22 * m3) * amt));
      c = mixRGB(c, veinMid, clamp01(L2.core * 0.46 * m2 * amt));
      c = mixRGB(c, veinDark, clamp01(L1.core * 0.80 * m1 * amt));
      // fine crystalline speckle in the resin
      const sp = fbmT(u01, v01, 300, 300, 2, seedBase + 55);
      c = scaleRGB(c, 1 + sp * 0.016);

      const vAll = clamp01(L1.core * m1 + L2.core * 0.7 * m2 + L3.core * 0.5 * m3);
      const r = 0.050 + vAll * 0.035 + Math.max(0, sp) * 0.015;
      // relief is essentially nil — a polished slab is flat to the touch
      const h = 0.5 + vAll * 0.05;
      setPx(s, i, c, h, r);
    }
  }
  s.reliefFt = 0.00022;
  s.aoStrength = 0.25;
  return s;
}

/** Counters and island: a 6 ft x 6 ft repeat of the slab. */
function genQuartzWhite(size) {
  return quartzField(size, 6, 6, 4211, { veinAmt: 1.0, shear: 0.42 });
}

/**
 * The full-height slab backsplash.  This one does NOT tile: `clamp` is set and
 * `applyUV` maps 0..1 across the whole wall, so the veining runs unbroken from
 * the counter to the underside of the uppers exactly as in `kitchen_view_1`.
 * Same seed family, same shear and the same 6 ft vein pitch as `quartzWhite`,
 * so the wall reads as the next slab off the same block — book-matched with
 * the counter across the caulk joint rather than a different stone.
 */
function genQuartzSlabBacksplash(size) {
  // 10 ft wide x 5 ft high piece of the SAME slab, mirrored top-to-bottom so
  // the veins that arrive at the counter line continue out of it.
  const s = quartzField(size, 10, 5, 4211, { veinAmt: 1.10, shear: 0.42 });
  // vertical mirror = the book-match fold at the counter seam
  const half = size >> 1;
  for (let y = 0; y < half; y++) {
    const y2 = size - 1 - y;
    for (let x = 0; x < size; x++) {
      const a = y * size + x, b = y2 * size + x;
      for (let k = 0; k < 3; k++) { const t = s.alb[a * 3 + k]; s.alb[a * 3 + k] = s.alb[b * 3 + k]; s.alb[b * 3 + k] = t; }
      let t = s.hgt[a]; s.hgt[a] = s.hgt[b]; s.hgt[b] = t;
      t = s.rgh[a]; s.rgh[a] = s.rgh[b]; s.rgh[b] = t;
    }
  }
  s.clamp = true;
  return s;
}

/* ---------------------------------------------------------- cabinet woods */
function cabinetWood(size, TU, TV, palette, cfg, seedBase, rough, grayWash) {
  const s = blank(size, [TU, TV]);
  const rng = mulberry32(seedBase);
  // vertical stiles: grain runs along +V (doors are hung with vertical grain)
  const strips = 5;
  const sw = 1 / strips;
  const stripTone = [];
  for (let i = 0; i < strips; i++) {
    stripTone.push({
      c: palette[(rng() * palette.length) | 0],
      light: 0.965 + rng() * 0.075,
      seed: (rng() * 1e5) | 0,
      r: rng(),
    });
  }
  for (let y = 0; y < size; y++) {
    const v01 = (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      const u01 = (x + 0.5) / size;
      const i = y * size + x;
      const si = Math.min(strips - 1, Math.floor(u01 / sw));
      const t = (u01 - si * sw) / sw;
      const st = stripTone[si];
      // grain evaluated with u/v swapped so it runs vertically
      const g = woodGrain(v01, u01, t, st.seed, boardGrain(cfg, st.r));
      let c = scaleRGB(st.c, st.light);
      c = scaleRGB(c, 1 + fbmT(u01, v01, 3, 4, 3, st.seed + 3) * 0.06);
      c = scaleRGB(c, 1 - g.band * 0.075 - g.ring * 0.115);
      c = mixRGB(c, scaleRGB(c, 0.75), g.pore * 0.30);
      c = mixRGB(c, scaleRGB(c, 1.06), g.fleck);
      if (grayWash > 0) c = mixRGB(c, [0.72, 0.70, 0.67], grayWash);
      const h = 0.55 - g.pore * 0.5 - g.ring * 0.12;
      const r = rough + g.pore * 0.16 + fbmT(u01, v01, 9, 9, 2, 771) * 0.03;
      setPx(s, i, c, h, clamp01(r));
    }
  }
  s.reliefFt = 0.00045;
  s.aoStrength = 0.35;
  return s;
}

const CAB_GRAIN = {
  rings: 1.7, ringWidth: 0.038, warpFU: 4, warpFV: 2, warpAmp: 1.05,
  fineFU: 6, fineFV: 150, fineAmt: 0.16,
  poreFU: 300, poreFV: 140, poreThresh: 0.22, poreAmt: 0.7,
  fleckFU: 36, fleckFV: 24, fleckAmt: 0.16,
};

/** Kitchen base cabinets / island: light natural cherry-oak, satin lacquer. */
function genCherryCabinet(size) {
  return cabinetWood(
    size, 2.5, 3.0,
    [hexRGB('#c39c72'), hexRGB('#bd966c'), hexRGB('#c9a47c'), hexRGB('#b88f66')],
    CAB_GRAIN, 6011, 0.30, 0.04
  );
}

/** Primary-bath vanity: rich stained cherry. */
function genCherryCabinetDark(size) {
  return cabinetWood(
    size, 2.5, 3.0,
    [hexRGB('#7a5540'), hexRGB('#6f4d3a'), hexRGB('#835d46'), hexRGB('#654733')],
    CAB_GRAIN, 3307, 0.26, 0.0
  );
}

/* -------------------------------------------------------------- butcher block */
function genButcherBlock(size) {
  const TU = 4.0, TV = 2.0;
  const SW = 1.5 / 12; // 1.5" strips running along U
  const rows = Math.round(TV / SW);
  const s = blank(size, [TU, TV]);
  const rng = mulberry32(0x8bcb);
  const tones = [hexRGB('#d6bd9a'), hexRGB('#ceb28d'), hexRGB('#ddc6a6'), hexRGB('#c8aa84')];
  const data = [];
  for (let r = 0; r < rows; r++) {
    data.push({ c: tones[(rng() * 4) | 0], seed: (rng() * 1e5) | 0, light: 0.95 + rng() * 0.12, r: rng() });
  }
  const cfg = {
    rings: 2.0, ringWidth: 0.05, warpFU: 4, warpFV: 2, warpAmp: 0.5,
    fineFU: 5, fineFV: 220, fineAmt: 0.5,
    poreFU: 200, poreFV: 100, poreThresh: 0.45, poreAmt: 0.2,
    fleckFU: 24, fleckFV: 18, fleckAmt: 0.12,
  };
  for (let y = 0; y < size; y++) {
    const v01 = (y + 0.5) / size;
    const v = v01 * TV;
    const r0 = Math.min(rows - 1, Math.floor(v / SW));
    const t = (v - r0 * SW) / SW;
    const d = data[r0];
    for (let x = 0; x < size; x++) {
      const u01 = (x + 0.5) / size;
      const i = y * size + x;
      const g = woodGrain(u01, v01, t, d.seed, boardGrain(cfg, d.r));
      let c = scaleRGB(d.c, d.light);
      c = scaleRGB(c, 1 - g.ring * 0.17);
      c = mixRGB(c, scaleRGB(c, 0.8), g.pore * 0.4);
      const bev = smoothstep(0, 1, Math.min(1, Math.min(t, 1 - t) / 0.05));
      const h = (0.6 - g.ring * 0.1) * (0.35 + 0.65 * bev);
      c = mixRGB(scaleRGB(c, 0.62), c, 0.35 + 0.65 * bev);
      setPx(s, i, c, h, clamp01(0.30 + g.pore * 0.1));
    }
  }
  s.reliefFt = 0.003;
  return s;
}

/* --------------------------------------------------------------- painting */
/**
 * Painted / rolled surfaces.  `stipple` = roller orange-peel amount,
 * `sheen` = base roughness (0.25 satin cabinet lacquer .. 0.95 flat ceiling).
 */
function paintSurface(size, TU, color, stipple, sheen, seedBase, brushed) {
  const s = blank(size, [TU, TU]);
  const c0 = hexRGB(color);
  for (let y = 0; y < size; y++) {
    const v01 = (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      const u01 = (x + 0.5) / size;
      const i = y * size + x;
      // roller stipple: fine cellular pitting
      const w = worleyT(u01, v01, 90, 90, seedBase, 1);
      const pit = smoothstep(0.0, 0.55, w.f1);
      const grain = fbmT(u01, v01, 160, 160, 3, seedBase + 5);
      let h = 0.5 + (pit - 0.5) * stipple + grain * stipple * 0.5;
      // long roller laps (very subtle vertical banding)
      const lap = fbmT(u01, v01, 6, 2, 2, seedBase + 41);
      let c = scaleRGB(c0, 1 + lap * 0.012 + grain * 0.008);
      if (brushed) {
        const br = fbmT(u01, v01, 3, 240, 2, seedBase + 88);
        h += br * stipple * 0.8;
        c = scaleRGB(c, 1 + br * 0.01);
      }
      const r = clamp01(sheen + grain * 0.05 + (1 - pit) * 0.04);
      setPx(s, i, c, clamp01(h), r);
    }
  }
  s.reliefFt = 0.0006 + stipple * 0.0015;
  s.aoStrength = 0.6;
  return s;
}

const genPaintedOffWhite = (n) => paintSurface(n, 3, '#d2cabb', 0.30, 0.31, 1201, true);
const genPaintedSlateBlue = (n) => paintSurface(n, 3, '#54707e', 0.30, 0.31, 1307, true);
const genPaintedGreige = (n) => paintSurface(n, 3, '#bfb09c', 0.30, 0.32, 1409, true);
const genWallPaintWhite = (n) => paintSurface(n, 4, '#eeeeec', 0.60, 0.62, 1511, false);
const genWallPaintWarmWhite = (n) => paintSurface(n, 4, '#efeade', 0.60, 0.62, 1613, false);
const genCeilingPaint = (n) => paintSurface(n, 4, '#f7f7f6', 0.65, 0.90, 1717, false);
const genBlackMatte = (n) => paintSurface(n, 1.5, '#1c1c1d', 0.35, 0.58, 1819, false);

/* -------------------------------------------------- knockdown drywall ceiling */
function genDrywallCeilingKnockdown(size) {
  const TU = 4.0;
  const s = blank(size, [TU, TU]);
  const c0 = hexRGB('#f5f5f3');
  for (let y = 0; y < size; y++) {
    const v01 = (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      const u01 = (x + 0.5) / size;
      const i = y * size + x;
      const w = warpT(u01, v01, 10, 10, 0.045, 2211);
      const n = fbmT(w[0], w[1], 14, 14, 4, 2211);
      // splatter blobs flattened by the knife -> plateaus with soft skirts
      const blob = smoothstep(-0.02, 0.20, n);
      const plateau = Math.min(1, blob * 1.25);
      const fine = fbmT(u01, v01, 200, 200, 2, 2233) * 0.25;
      const h = plateau * 0.85 + fine * 0.15;
      const c = scaleRGB(c0, 1 + (plateau - 0.5) * 0.035);
      setPx(s, i, c, h, clamp01(0.90 - plateau * 0.06));
    }
  }
  s.reliefFt = 0.0075;
  s.aoStrength = 1.6;
  return s;
}

/* ------------------------------------------------------------- slat wall */
/**
 * Primary-bath / bedroom feature wall: 1-1/8" white-oak slats on a black felt
 * backer, 0.45" reveal.  Tile = 8 slats wide x 4 ft tall.
 */
function genWoodSlatWall(size) {
  const SLAT = 1.125 / 12, GAP = 0.45 / 12;
  const PITCH = SLAT + GAP;
  const nSlats = 8;
  const TU = PITCH * nSlats, TV = 4.0;
  const s = blank(size, [TU, TV]);
  const rng = mulberry32(0x51a7);
  const tones = [hexRGB('#c2a077'), hexRGB('#bb9970'), hexRGB('#caa981'), hexRGB('#b39168')];
  const slats = [];
  for (let i = 0; i < nSlats; i++) {
    slats.push({ c: tones[(rng() * 4) | 0], light: 0.94 + rng() * 0.13, seed: (rng() * 1e5) | 0, r: rng() });
  }
  const backer = hexRGB('#141414');
  const cfg = {
    rings: 1.6, ringWidth: 0.06, warpFU: 3, warpFV: 2, warpAmp: 0.45,
    fineFU: 4, fineFV: 260, fineAmt: 0.55,
    poreFU: 160, poreFV: 90, poreThresh: 0.40, poreAmt: 0.3,
    fleckFU: 20, fleckFV: 16, fleckAmt: 0.10,
  };
  for (let y = 0; y < size; y++) {
    const v01 = (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      const u01 = (x + 0.5) / size;
      const u = u01 * TU;
      const i = y * size + x;
      const si = Math.min(nSlats - 1, Math.floor(u / PITCH));
      const lu = (u - si * PITCH) / PITCH;       // 0..1 across pitch
      const face = SLAT / PITCH;                  // fraction that is slat
      if (lu < face) {
        const t = lu / face;                      // 0..1 across the slat face
        const sl = slats[si];
        // grain runs vertically
        const g = woodGrain(v01, u01, t, sl.seed, boardGrain(cfg, sl.r));
        let c = scaleRGB(sl.c, sl.light);
        c = scaleRGB(c, 1 - g.ring * 0.12);
        c = mixRGB(c, scaleRGB(c, 0.80), g.pore * 0.28);
        // rounded/eased edges
        const ease = smoothstep(0, 0.07, Math.min(t, 1 - t));
        let h = 0.35 + 0.65 * ease;
        c = scaleRGB(c, 0.84 + 0.16 * ease);
        setPx(s, i, c, h, clamp01(0.34 + g.pore * 0.14));
      } else {
        const t = (lu - face) / (1 - face);
        const shade = smoothstep(0, 0.5, Math.min(t, 1 - t));
        const c = scaleRGB(backer, 0.85 + 0.35 * (1 - shade));
        setPx(s, i, c, 0.02, 0.95);
      }
    }
  }
  s.reliefFt = 0.055;   // slats stand ~5/8" proud of the backer
  s.aoStrength = 2.6;
  s.aoRadius = 0.03;
  return s;
}

/** Matte black felt backer used behind slat walls / inside reveals. */
function genBlackBacker(size) {
  const s = blank(size, [2, 2]);
  const c0 = hexRGB('#141516');
  for (let y = 0; y < size; y++) {
    const v01 = (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      const u01 = (x + 0.5) / size;
      const i = y * size + x;
      const f = fbmT(u01, v01, 220, 220, 3, 4404);
      const c = scaleRGB(c0, 1 + f * 0.18);
      setPx(s, i, c, 0.5 + f * 0.5, clamp01(0.93 + f * 0.05));
    }
  }
  s.reliefFt = 0.0012;
  return s;
}

/* --------------------------------------------------- bronze porcelain tile */
/**
 * Primary bath WALLS: 12"x24" metallic-look porcelain, half bond, thin joint.
 *
 * `master_bedroom_bathroom_view_1/2` at 4x show an oxidised-metal glaze, not a
 * chocolate stone: each tile is horizontally STRATIFIED, as if a sheet of steel
 * had rusted in bands.  The lot swings hard between two families — warm
 * rust/copper tiles and cool blue-grey steel tiles frosted with pale mineral
 * bloom — and adjacent tiles are often from opposite families.  Over the whole
 * face runs a fine speckled mottling, and the glaze is glossy enough to hold a
 * clear reflection of the tub.
 *
 * The two things the previous version got wrong were (a) isotropic blotches
 * instead of horizontal strata and (b) no cool family at all, which is what
 * made it read as flat chocolate.
 */
function genBronzePorcelain(size) {
  const TW = 2.0, TH = 1.0;    // 24" x 12"
  const TU = 4.0, TV = 4.0;
  const s = blank(size, [TU, TV]);
  const grout = hexRGB('#6f6055');
  const GW = 0.006;            // ~1/16" rectified joint

  // warm family
  const rust0 = hexRGB('#5b4234');
  const rust1 = hexRGB('#8d6549');
  const rust2 = hexRGB('#bc8f65');
  // cool family
  const steel0 = hexRGB('#4b4d4c');
  const steel1 = hexRGB('#7c807e');
  const steel2 = hexRGB('#a9aaa4');
  const frost = hexRGB('#cfccc3');
  s.met = new Float32Array(size * size);

  for (let y = 0; y < size; y++) {
    const v01 = (y + 0.5) / size;
    const v = v01 * TV;
    for (let x = 0; x < size; x++) {
      const u01 = (x + 0.5) / size;
      const u = u01 * TU;
      const i = y * size + x;
      const L = lattice(u, v, TW, TH, 0.5);
      if (L.edgeFt < GW) {
        const g = fbmT(u01, v01, 150, 150, 2, 55);
        const e = smoothstep(0, GW, L.edgeFt);
        const c = scaleRGB(grout, 0.92 + g * 0.16);
        setPx(s, i, c, 0.10 + e * 0.14, clamp01(0.78 + g * 0.06));
        continue;
      }
      // per-tile sampling window: every tile is a different piece of the glaze
      const tk = ihash(L.i, L.j, 8821);
      const ph = (tk & 1023) / 1024;
      const flip = (tk >>> 12) & 1;
      let su = L.lu;
      if (flip) su = 1 - su;
      const nu = (su * 0.42 + ph) % 1;
      const nv = (L.lv * 0.22 + ((tk >>> 20) & 255) / 256) % 1;
      // which family is this tile from, and how strongly
      const cool = ((tk >>> 6) & 255) / 255;

      // HORIZONTAL STRATA: the noise is stretched ~15:1 across the tile
      const w = warpT(nu, nv, 2, 10, 0.10, 991);
      const strat = fbmT(w[0], w[1], 2, 22, 4, 991) * 0.5 + 0.5;
      const strat2 = fbmT(w[0], w[1], 5, 54, 3, 1223) * 0.5 + 0.5;
      const bloom = ridgedT(w[0], w[1], 3, 30, 4, 1451, 0.55);
      const grit = fbmT(u01, v01, 340, 340, 2, 77);
      const grit2 = fbmT(u01, v01, 110, 150, 2, 179);

      let warmC = mixRGB(rust0, rust1, smoothstep(0.22, 0.80, strat));
      warmC = mixRGB(warmC, rust2, smoothstep(0.55, 0.96, strat2) * 0.80);
      let coolC = mixRGB(steel0, steel1, smoothstep(0.20, 0.82, strat));
      coolC = mixRGB(coolC, steel2, smoothstep(0.50, 0.94, strat2) * 0.85);
      coolC = mixRGB(coolC, frost, smoothstep(0.78, 1.0, bloom) * 0.60);

      // The cool oxide does not own whole tiles: it appears as BANDS inside a
      // tile, with the tile's own bias deciding how much of it there is.
      const coolMix = smoothstep(0.36, 0.92, cool * 0.44 + strat * 0.34 + bloom * 0.34);
      let c = mixRGB(warmC, coolC, coolMix);
      // a warm copper bloom crosses even the cool bands
      c = mixRGB(c, rust2, smoothstep(0.88, 1.0, bloom) * 0.35 * (1 - coolMix * 0.5));
      // whole-tile lightness lottery
      c = scaleRGB(c, 0.90 + ((tk >>> 4) & 255) / 255 * 0.24);
      // fine metallic sparkle and mineral pepper
      c = scaleRGB(c, 1 + grit * 0.095 + grit2 * 0.06);

      // Glazed and glossy, but mottled: the strata hold slightly different
      // gloss, which is what makes the reflection of the tub break up.
      const r = clamp01(0.10 + (1 - smoothstep(0.25, 0.92, strat2)) * 0.20
        + bloom * 0.10 + grit * 0.04);
      const h = 0.55 + (strat2 - 0.5) * 0.12 + grit * 0.06;
      setPx(s, i, c, h, r);
      // a metallic-look glaze really does carry some conductor response
      s.met[i] = clamp01(0.14 + smoothstep(0.55, 1.0, bloom) * 0.28 + coolMix * 0.12);
    }
  }
  s.reliefFt = 0.0045;
  s.aoStrength = 2.0;
  s.aoRadius = 0.014;
  return s;
}

/**
 * Primary bath FLOOR: a DIFFERENT tile — 13" square, straight set, warm
 * terracotta/rose-brown "slate look" with a dense salt-and-pepper mottle and
 * clearly visible LIGHT tan grout at ~3/16".  Measured mean in the photo
 * 180/158/143.  It must not read as the wall tile on the floor.
 */
function genBronzePorcelainFloor(size) {
  const TW = 13 / 12, TH = 13 / 12;
  const TU = TW * 4, TV = TH * 4;
  const s = blank(size, [TU, TV]);
  const grout = hexRGB('#cbb69d');
  const GW = 0.0135;           // ~3/16" joint, half-width
  const deep = hexRGB('#8a7365');
  const mid = hexRGB('#b39a88');
  const light = hexRGB('#d4c3b3');
  const rose = hexRGB('#bfa38f');

  for (let y = 0; y < size; y++) {
    const v01 = (y + 0.5) / size;
    const v = v01 * TV;
    for (let x = 0; x < size; x++) {
      const u01 = (x + 0.5) / size;
      const u = u01 * TU;
      const i = y * size + x;
      const L = lattice(u, v, TW, TH, 0);
      if (L.edgeFt < GW) {
        const g = fbmT(u01, v01, 160, 160, 2, 33);
        const e = smoothstep(0, GW, L.edgeFt);
        setPx(s, i, scaleRGB(grout, 0.95 + g * 0.10), 0.12 + e * 0.18, clamp01(0.88 + g * 0.05));
        continue;
      }
      const tk = ihash(L.i, L.j, 5533);
      const ph = (tk & 1023) / 1024;
      const rot = (tk >>> 11) & 3;
      let su = L.lu, sv = L.lv;
      if (rot & 1) { const t = su; su = sv; sv = t; }
      if (rot & 2) { su = 1 - su; }
      const nu = (su * 0.30 + ph) % 1;
      const nv = (sv * 0.30 + ((tk >>> 19) & 255) / 256) % 1;

      const w = warpT(nu, nv, 4, 4, 0.11, 707);
      const cloud = fbmT(w[0], w[1], 3, 3, 4, 707) * 0.5 + 0.5;
      const blotch = fbmT(w[0], w[1], 9, 9, 3, 313) * 0.5 + 0.5;
      const vein = ridgedT(w[0], w[1], 8, 8, 3, 1313, 0.5);
      // The signature of this product is a DENSE salt-and-pepper mottle at
      // roughly 1/16", sitting under broad cloudy tone shifts.  The pepper is
      // evaluated in TILE space (not per-tile) so it never repeats visibly.
      const pep1 = fbmT(u01, v01, 170, 170, 3, 909) * 0.5 + 0.5;
      const pep2 = fbmT(u01, v01, 480, 480, 2, 121) * 0.5 + 0.5;

      let c = mixRGB(mid, deep, smoothstep(0.55, 0.02, cloud) * 0.9);
      c = mixRGB(c, light, smoothstep(0.48, 0.96, cloud) * 0.85);
      c = mixRGB(c, deep, smoothstep(0.50, 0.95, blotch) * 0.52);
      c = mixRGB(c, light, smoothstep(0.46, 0.06, blotch) * 0.34);
      c = mixRGB(c, rose, smoothstep(0.60, 0.95, vein) * 0.30);
      // pepper: fine dark and pale specks over the whole face
      c = scaleRGB(c, 1 - smoothstep(0.56, 0.92, pep1) * 0.24);
      c = scaleRGB(c, 1 + smoothstep(0.44, 0.04, pep1) * 0.17);
      c = scaleRGB(c, 1 + (pep2 - 0.5) * 0.16);
      // tile-to-tile tone lottery (this product ships with a wide shade range)
      c = scaleRGB(c, 0.92 + ((tk >>> 3) & 255) / 255 * 0.17);

      const r = clamp01(0.34 + (1 - cloud) * 0.14 + (pep2 - 0.5) * 0.08);
      setPx(s, i, c, 0.6 + (pep1 - 0.5) * 0.30 + (pep2 - 0.5) * 0.24, r);
    }
  }
  s.reliefFt = 0.006;
  s.aoStrength = 2.2;
  s.aoRadius = 0.016;
  return s;
}

/* ------------------------------------------------- beige marble-look tile */
/** First-floor bath: 12"x12" cream/beige marble-look porcelain. */
function genMarbleLookTile(size) {
  const TW = 1.0, TH = 1.0;
  const TU = 4.0, TV = 4.0;
  const s = blank(size, [TU, TV]);
  const grout = hexRGB('#cbbca4');
  const GW = 0.010;
  const base = hexRGB('#d2bf9c');
  const pale = hexRGB('#e0d1b4');
  const deep = hexRGB('#b39c78');
  const vein = hexRGB('#9c8563');

  for (let y = 0; y < size; y++) {
    const v01 = (y + 0.5) / size;
    const v = v01 * TV;
    for (let x = 0; x < size; x++) {
      const u01 = (x + 0.5) / size;
      const u = u01 * TU;
      const i = y * size + x;
      const L = lattice(u, v, TW, TH, 0);
      if (L.edgeFt < GW) {
        const g = fbmT(u01, v01, 140, 140, 2, 61);
        const e = smoothstep(0, GW, L.edgeFt);
        setPx(s, i, scaleRGB(grout, 0.95 + g * 0.10), 0.12 + e * 0.14, clamp01(0.86 + g * 0.05));
        continue;
      }
      const tk = ihash(L.i, L.j, 3111);
      const rot = (tk >>> 9) & 3;
      let su = L.lu, sv = L.lv;
      if (rot & 1) { const t = su; su = sv; sv = t; }
      if (rot & 2) { su = 1 - su; sv = 1 - sv; }
      const nu = (su * 0.24 + (tk & 1023) / 1024) % 1;
      const nv = (sv * 0.24 + ((tk >>> 18) & 255) / 256) % 1;

      const w = warpT(nu, nv, 4, 4, 0.14, 313);
      const cloud = fbmT(w[0], w[1], 4, 4, 5, 313) * 0.5 + 0.5;
      const clast = fbmT(w[0], w[1], 12, 12, 4, 515) * 0.5 + 0.5;
      const vn = ridgedT(w[0], w[1], 6, 6, 4, 717, 0.5);

      let c = mixRGB(base, pale, smoothstep(0.25, 0.90, cloud));
      c = mixRGB(c, deep, smoothstep(0.38, 0.88, clast) * 0.85);
      c = mixRGB(c, vein, smoothstep(0.76, 0.99, vn) * 0.60);
      c = scaleRGB(c, 0.95 + ((tk >>> 2) & 255) / 255 * 0.10);
      // travertine pitting
      const pit = worleyT(nu, nv, 26, 26, 818, 1);
      const pd = smoothstep(0.07, 0.0, pit.f1) * (((pit.id >>> 7) & 7) < 2 ? 1 : 0);
      c = scaleRGB(c, 1 - pd * 0.10);

      const r = clamp01(0.28 + (1 - cloud) * 0.10 + pd * 0.25);
      setPx(s, i, c, 0.62 - pd * 0.30, r);
    }
  }
  s.reliefFt = 0.008;
  s.aoStrength = 2.0;
  s.aoRadius = 0.014;
  return s;
}

/* ------------------------------------------------------------- mosaic band */
/** 1" square mosaic accent in blended beige/tan/bronze — 6"x6" sheet. */
function genMosaicAccent(size) {
  const TW = 1 / 12, TH = 1 / 12;
  const TU = 0.5, TV = 0.5;
  const s = blank(size, [TU, TV]);
  const grout = hexRGB('#c3b49c');
  const GW = 0.0055;
  const pal = [
    hexRGB('#cdbb9c'), hexRGB('#c0ac8c'), hexRGB('#d8c8ab'),
    hexRGB('#b6a382'), hexRGB('#d2c1a2'), hexRGB('#a89478'),
  ];
  for (let y = 0; y < size; y++) {
    const v01 = (y + 0.5) / size;
    const v = v01 * TV;
    for (let x = 0; x < size; x++) {
      const u01 = (x + 0.5) / size;
      const u = u01 * TU;
      const i = y * size + x;
      const L = lattice(u, v, TW, TH, 0);
      if (L.edgeFt < GW) {
        const g = fbmT(u01, v01, 180, 180, 2, 71);
        const e = smoothstep(0, GW, L.edgeFt);
        setPx(s, i, scaleRGB(grout, 0.95 + g * 0.12), 0.10 + e * 0.2, clamp01(0.85 + g * 0.05));
        continue;
      }
      const tk = ihash(L.i, L.j, 6161);
      const c0 = pal[tk % pal.length];
      const nu = (L.lu * 0.1 + (tk & 1023) / 1024) % 1;
      const nv = (L.lv * 0.1 + ((tk >>> 16) & 1023) / 1024) % 1;
      const cloud = fbmT(nu, nv, 20, 20, 3, 505) * 0.5 + 0.5;
      let c = scaleRGB(c0, 0.93 + cloud * 0.15);
      const sp = fbmT(u01, v01, 400, 400, 2, 99);
      c = scaleRGB(c, 1 + sp * 0.03);
      // slightly domed/tumbled faces
      const dome = smoothstep(0, 0.22, Math.min(L.lu, 1 - L.lu, L.lv, 1 - L.lv));
      setPx(s, i, scaleRGB(c, 0.90 + 0.10 * dome), 0.25 + 0.6 * dome, clamp01(0.24 + (1 - cloud) * 0.10));
    }
  }
  s.reliefFt = 0.007;
  s.aoStrength = 2.4;
  s.aoRadius = 0.02;
  return s;
}

/* ------------------------------------------------------------------ carpet */
/**
 * Broadloom carpet, built the way carpet actually looks in the photographs.
 *
 * `master_bedroom_1.png` and `basement_view_1.png` at 4x show NO woven
 * checkerboard.  What they show is:
 *   1. a dense field of fine fibre striations running in ONE direction — the
 *      nap, combed by the last pass of the vacuum,
 *   2. broad, very low-contrast value banding across that direction (the
 *      vacuum tracks and foot traffic), with soft irregular edges,
 *   3. a fine salt-and-pepper of individual yarn ends, at the very edge of
 *      resolution, and
 *   4. essentially no hue variation at all — chroma is 15-25 levels.
 *
 * The nap is what makes carpet read as carpet: it is a directional surface, so
 * it gets a real anisotropy map (grooves along +U) and a slight normal tilt,
 * on top of the sheen lobe.  Value changes with view angle, exactly as the
 * banding in the photographs does.
 */
function carpetField(size, opts) {
  const TU = opts.tile, TV = opts.tile;
  const s = blank(size, [TU, TV]);
  const n = size * size;
  const base = hexRGB(opts.base);
  const dark = hexRGB(opts.dark);
  const lite = hexRGB(opts.lite);

  /* --- the nap: high-frequency fibre noise smeared along +U ------------- */
  const raw = new Float32Array(n);
  for (let y = 0; y < size; y++) {
    const v01 = (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      const u01 = (x + 0.5) / size;
      raw[y * size + x] = fbmT(u01, v01, opts.fibreU, opts.fibreV, 2, 6767, 0.65) * 0.5 + 0.5;
    }
  }
  const nap = streak(raw, size, Math.max(1, Math.round(size * opts.smear)), 0);

  s.anisoStr = new Float32Array(n);
  s.tiltU = new Float32Array(n);

  for (let y = 0; y < size; y++) {
    const v01 = (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      const u01 = (x + 0.5) / size;
      const i = y * size + x;

      /* --- vacuum / traffic banding: broad soft bands across the nap.
         This is the feature that survives to room scale, so it carries most
         of the carpet's read; the photographs show 10-15% value swings with
         soft, wandering edges. */
      const bandPhase = v01 * opts.bands + fbmT(u01, v01, 2, 2, 2, 5150) * 0.30;
      const band = smoothstep(-0.62, 0.62, Math.sin(bandPhase * Math.PI * 2));
      const drift = fbmT(u01, v01, 2, 3, 3, 8181) * 0.5 + 0.5;
      const shade = clamp01(band * 0.60 + drift * 0.40);

      /* --- individual yarn ends ---------------------------------------- */
      const tuft = worleyT(u01, v01, opts.tuftU, opts.tuftV, 9393, 0.95);
      const tip = 1 - smoothstep(0.06, 0.44, tuft.f1);
      const tipVar = 0.55 + 0.45 * ((tuft.id >>> 9) & 1);

      const nz = nap[i];
      const pepper = fbmT(u01, v01, 300, 300, 2, 4242);

      // loop/tuft rows: the pile is set in rows across the nap direction
      const row = opts.rowAmt
        ? (0.5 + 0.5 * Math.cos(v01 * opts.rows * Math.PI * 2)) * opts.rowAmt
        : 0;

      let c = mixRGB(dark, base, smoothstep(0.04, 0.96, shade));
      c = mixRGB(c, lite, (nz - 0.42) * opts.napAmt);
      c = scaleRGB(c, 1 + (nz - 0.5) * opts.napVal);
      c = scaleRGB(c, 0.965 + tip * opts.tipAmt * tipVar);
      c = scaleRGB(c, 1 + pepper * opts.pepper - row);

      const h = tip * opts.tipH + nz * opts.napH + Math.max(0, pepper) * 0.10 - row * 2.0;
      setPx(s, i, c, clamp01(h), clamp01(opts.rough - nz * 0.05 + pepper * 0.02));

      // the pile leans with the nap: a real surface tilt, not a bump
      s.tiltU[i] = opts.tilt * (0.6 + 0.8 * (shade - 0.5));
      s.anisoStr[i] = clamp01(opts.aniso * (0.75 + 0.5 * nz));
    }
  }
  s.reliefFt = opts.relief;
  s.aoStrength = opts.ao;
  s.aoRadius = 0.02;
  return s;
}

/**
 * Primary bedroom (`master_bedroom_1/2/3`): light greige CUT pile.  Softer,
 * deeper and more obviously combed than the basement; the nap banding is the
 * dominant read.  Measured mean in the photo 190/176/165 — a warm grey, NOT
 * a tan, with only 25 levels of chroma.
 */
function genCarpetTan(size) {
  return carpetField(size, {
    tile: 2.0,
    base: '#cfc3b4', dark: '#b7ab9c', lite: '#ded4c6',
    fibreU: 8, fibreV: 155, smear: 0.012, bands: 1,
    tuftU: 150, tuftV: 118,
    napAmt: 0.30, napVal: 0.105, tipAmt: 0.055, pepper: 0.028,
    rows: 0, rowAmt: 0,
    tipH: 0.45, napH: 0.42, rough: 0.90,
    relief: 0.010, ao: 2.2, tilt: 0.30, aniso: 0.60,
  });
}

/**
 * Basement rec room (`basement_view_1/3/4`): denser, flatter, slightly warmer
 * loop pile.  Shorter pile means the yarn ends read as a much finer, tighter
 * pepper and the nap banding is weaker.
 */
function genCarpetBeige(size) {
  return carpetField(size, {
    tile: 2.0,
    base: '#c6b39c', dark: '#ab9884', lite: '#d8c8b2',
    fibreU: 10, fibreV: 230, smear: 0.007, bands: 2,
    tuftU: 240, tuftV: 190,
    napAmt: 0.22, napVal: 0.085, tipAmt: 0.085, pepper: 0.040,
    rows: 168, rowAmt: 0.030,
    tipH: 0.55, napH: 0.30, rough: 0.93,
    relief: 0.0065, ao: 2.6, tilt: 0.16, aniso: 0.40,
  });
}

/* ------------------------------------------------------------ rubber gym */
function genRubberGymFloor(size) {
  const TU = 2.0, TV = 2.0;
  const s = blank(size, [TU, TV]);
  const base = hexRGB('#2c2e30');
  const flecks = [hexRGB('#d7d9dc'), hexRGB('#9aa0a6'), hexRGB('#6d7a86'), hexRGB('#b9a68c')];
  for (let y = 0; y < size; y++) {
    const v01 = (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      const u01 = (x + 0.5) / size;
      const i = y * size + x;
      const w = worleyT(u01, v01, 110, 110, 2468, 1);
      const n = fbmT(u01, v01, 260, 260, 2, 1357);
      let c = scaleRGB(base, 1 + n * 0.16);
      let h = 0.5 + n * 0.3;
      let r = 0.78 + n * 0.06;
      const isFleck = (w.id % 100) < 34 && w.f1 < 0.30;
      if (isFleck) {
        const fc = flecks[(w.id >>> 6) % flecks.length];
        const k = 1 - smoothstep(0.16, 0.30, w.f1);
        c = mixRGB(c, fc, k * 0.9);
        h += k * 0.25;
        r -= k * 0.16;
      }
      setPx(s, i, c, clamp01(h), clamp01(r));
    }
  }
  s.reliefFt = 0.0075;
  s.aoStrength = 1.6;
  return s;
}

/* ---------------------------------------------------------- black granite */
function genBlackGranite(size) {
  const TU = 4.0, TV = 4.0;
  const s = blank(size, [TU, TV]);
  const base = hexRGB('#141618');
  const mica = [hexRGB('#8d9299'), hexRGB('#5a6068'), hexRGB('#c8b48b'), hexRGB('#3d4247')];
  for (let y = 0; y < size; y++) {
    const v01 = (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      const u01 = (x + 0.5) / size;
      const i = y * size + x;
      const w = worleyT(u01, v01, 150, 150, 1717, 1);
      const w2 = worleyT(u01, v01, 320, 320, 2929, 1);
      const n = fbmT(u01, v01, 200, 200, 3, 3131);
      let c = scaleRGB(base, 1 + n * 0.25);
      const g1 = 1 - smoothstep(0.10, 0.34, w.f1);
      if ((w.id % 100) < 26) c = mixRGB(c, mica[(w.id >>> 8) % 4], g1 * 0.85);
      const g2 = 1 - smoothstep(0.06, 0.24, w2.f1);
      if ((w2.id % 100) < 40) c = mixRGB(c, mica[(w2.id >>> 8) % 4], g2 * 0.45);
      const r = clamp01(0.055 + g1 * 0.05 + Math.max(0, n) * 0.02);
      setPx(s, i, c, 0.5 + n * 0.2 + g1 * 0.1, r);
    }
  }
  s.reliefFt = 0.0006;
  s.aoStrength = 0.5;
  return s;
}

/* --------------------------------------------------------- gray lap siding */
/**
 * Weathered silvery-gray stained cedar lap siding, 7.5" exposure.
 *
 * `straight_on_view_of_house_from_street.png` at 6x is unambiguous about three
 * things the first pass missed:
 *   1. it is LIGHT — a shaded course measures 142/147/154, i.e. a mid-light
 *      silver that is faintly COOL, not a dark olive grey;
 *   2. the wood GRAIN reads straight through the semi-transparent stain as
 *      long, fine, high-contrast streaks running the length of each board;
 *   3. board-to-board tone varies visibly — some courses are a full 12%
 *      lighter than their neighbours, and a few have weathered browner.
 * The butt of every course throws a crisp dark shadow line onto the course
 * below, which is the strongest single feature at facade distance.
 */
function genGrayLapSiding(size) {
  const EXP = 7.5 / 12;
  const courses = 6;
  const TU = 8.0, TV = EXP * courses;
  const s = blank(size, [TU, TV]);
  const rng = mulberry32(0x51d1);
  const tones = [
    hexRGB('#9b9d9c'), hexRGB('#94979a'), hexRGB('#a1a29f'), hexRGB('#8d9194'),
    hexRGB('#9fa09b'), hexRGB('#979996'),
  ];
  const brown = hexRGB('#9a9188');       // a few boards weathered warmer
  const rowTone = [];
  for (let i = 0; i < courses; i++) {
    rowTone.push({
      c: tones[(rng() * tones.length) | 0],
      k: 0.935 + rng() * 0.13,
      warm: rng() < 0.30 ? 0.18 + rng() * 0.22 : 0,
      seed: (rng() * 1e5) | 0,
      // each board is a different piece of cedar
      grainF: 150 + ((rng() * 130) | 0),
      grainA: 0.10 + rng() * 0.08,
      // butt joint position along the run
      joint: rng(),
    });
  }

  for (let y = 0; y < size; y++) {
    const v01 = (y + 0.5) / size;
    const v = v01 * TV;
    const row = Math.min(courses - 1, Math.floor(v / EXP));
    const t = (v - row * EXP) / EXP;   // 0 at top of the course, 1 at its butt
    const rt = rowTone[row];
    for (let x = 0; x < size; x++) {
      const u01 = (x + 0.5) / size;
      const i = y * size + x;
      // rough-sawn cedar: long fine grain streaks + slow weathering blotches
      const grain = fbmT(u01, v01, 7, rt.grainF, 3, rt.seed);
      const saw = fbmT(u01, v01, 4, rt.grainF * 2, 2, rt.seed + 13);
      const weather = fbmT(u01, v01, 40, 6, 3, 4141);
      const lichen = fbmT(u01, v01, 14, 4, 3, 4242);
      let c = scaleRGB(rt.c, rt.k * (1 + grain * rt.grainA + saw * 0.045));
      if (rt.warm) c = mixRGB(c, brown, rt.warm);
      c = scaleRGB(c, 1 + weather * 0.05);
      c = mixRGB(c, [0.46, 0.47, 0.46], smoothstep(0.50, 1.0, lichen) * 0.14);
      // the stain has faded most on the exposed lower part of each board
      c = scaleRGB(c, 0.985 + t * 0.030);

      // board profile: thin at the top, thick at the butt, deep shadow below
      let h = 0.25 + 0.75 * t;
      let shade = 1;
      if (t < 0.12) {                     // shadow cast by the course above
        const k = 1 - t / 0.12;
        shade = 1 - k * k * 0.66;
        h = mix(0.0, h, 1 - k * 0.95);
      }
      // vertical butt joint between siding boards, with its caulk line
      const bj = Math.abs(((u01 + rt.joint) % 1) - 0.5);
      if (bj > 0.4975) { shade *= 0.72; h *= 0.5; }
      c = scaleRGB(c, shade);
      const r = clamp01(0.72 + grain * 0.07 + weather * 0.04);
      setPx(s, i, c, clamp01(h), r);
    }
  }
  s.reliefFt = 0.045;
  s.aoStrength = 2.0;
  s.aoRadius = 0.02;
  return s;
}

/* -------------------------------------------------------- asphalt shingle */
function genAsphaltShingle(size) {
  const EXP = 5.5 / 12;
  const TABW = 1.0;
  const courses = 4;
  const TU = 3.0, TV = EXP * courses;
  const s = blank(size, [TU, TV]);
  const tones = [hexRGB('#4a4c4f'), hexRGB('#46484c'), hexRGB('#4d4f52'), hexRGB('#44464a'), hexRGB('#4f5155')];

  for (let y = 0; y < size; y++) {
    const v01 = (y + 0.5) / size;
    const v = v01 * TV;
    const row = Math.min(courses - 1, Math.floor(v / EXP));
    const t = (v - row * EXP) / EXP;
    for (let x = 0; x < size; x++) {
      const u01 = (x + 0.5) / size;
      const u = u01 * TU;
      const i = y * size + x;
      const off = (row % 2) * TABW * 0.5;
      const tab = Math.floor((u - off) / TABW);
      const lu = ((u - off) / TABW) - tab;
      const tk = ihash(tab, row, 9021);

      // granules
      const gr = fbmT(u01, v01, 500, 500, 2, 4141);
      const blotch = fbmT(u01, v01, 24, 24, 3, 5151);
      let c = tones[tk % tones.length];
      c = scaleRGB(c, 1 + gr * 0.26 + blotch * 0.05);

      let h = 0.55 + gr * 0.35;
      // laminate: darker/raised dragon-tooth over the lower 45% of the course
      const teethEdge = 0.52 + fbmT(u01, v01, 14, 3, 2, 6161) * 0.14;
      if (t > teethEdge) {
        c = scaleRGB(c, 0.985);
        h += 0.14;
      }
      // shadow line under the butt of the course above
      if (t < 0.09) {
        const k = 1 - t / 0.09;
        c = scaleRGB(c, 1 - k * k * 0.38);
        h -= k * 0.45;
      }
      // keyway slots between tabs
      const slot = Math.min(lu, 1 - lu);
      if (slot < 0.008 && t > teethEdge) {
        c = scaleRGB(c, 0.62);
        h -= 0.3;
      }
      setPx(s, i, c, clamp01(h), clamp01(0.86 + gr * 0.06));
    }
  }
  s.reliefFt = 0.011;
  s.aoStrength = 1.4;
  return s;
}

/* ---------------------------------------------------------------- bluestone */
/** Irregular blue-gray cleft flagstone with sand joints. */
function genBluestone(size) {
  const TU = 6.0, TV = 6.0;
  const s = blank(size, [TU, TV]);
  // The joint is a MORTAR line barely lighter than the stone, and it has to be
  // faint: this map is tiled under real, separately-modelled slabs, and a
  // strong baked cell outline draws a second, crazy-paving set of joints
  // across the real ones. Tones sampled off exterior_view_of_front_door: the
  // stone is a blue-grey that lands at L 150-178 in sun, 96-126 in shade.
  const jointC = hexRGB('#73767a');
  const tones = [
    hexRGB('#666a6f'), hexRGB('#6d7174'), hexRGB('#61666b'), hexRGB('#717372'),
    hexRGB('#64686d'), hexRGB('#6a6c70'), hexRGB('#6e716d'),
  ];
  for (let y = 0; y < size; y++) {
    const v01 = (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      const u01 = (x + 0.5) / size;
      const i = y * size + x;
      // warp the cell grid so the slabs are irregular polygons, not hexes
      const w = warpT(u01, v01, 3, 3, 0.10, 3737);
      const cell = worleyT(w[0], w[1], 4, 4, 3737, 1);
      const border = cell.f2 - cell.f1;
      const jw = 0.004;
      if (border < jw) {
        const k = smoothstep(0, jw, border);
        const n = fbmT(u01, v01, 200, 200, 2, 4);
        const c = scaleRGB(jointC, 0.86 + n * 0.16);
        setPx(s, i, c, 0.10 + k * 0.30, clamp01(0.93 + n * 0.05));
        continue;
      }
      const tk = cell.id;
      let c = tones[tk % tones.length];
      c = scaleRGB(c, 0.945 + ((tk >>> 7) & 255) / 255 * 0.11);
      // cleft surface: layered, slightly rippled
      const cleft = fbmT(u01, v01, 22, 15, 4, 5 + (tk & 15));
      const fine = fbmT(u01, v01, 150, 120, 2, 6);
      c = scaleRGB(c, 1 + cleft * 0.10 + fine * 0.035);
      // faint iron staining
      c = mixRGB(c, [0.55, 0.50, 0.44], smoothstep(0.62, 1.0, fbmT(u01, v01, 6, 6, 3, 7)) * 0.07);
      const edge = smoothstep(jw, jw + 0.030, border);
      const h = (0.55 + cleft * 0.30 + fine * 0.12) * (0.45 + 0.55 * edge);
      setPx(s, i, c, clamp01(h), clamp01(0.72 + cleft * 0.10 + fine * 0.05));
    }
  }
  s.reliefFt = 0.020;
  s.aoStrength = 2.0;
  s.aoRadius = 0.02;
  return s;
}

/* ----------------------------------------------------- stacked limestone */
/** Buff dry-stack ledgestone: ~3" courses, random block lengths, deep joints. */
function genStackedLimestone(size) {
  const COURSE = 3.2 / 12;
  const rows = 12;                 // 12 courses
  const TV = COURSE * rows;
  const TU = 4.0;
  const s = blank(size, [TU, TV]);
  const rng = mulberry32(0x11e5);
  const tones = [
    hexRGB('#cdc0a4'), hexRGB('#c2b596'), hexRGB('#d8cdb2'), hexRGB('#b3a68a'),
    hexRGB('#c8bda3'), hexRGB('#a89b80'), hexRGB('#ded4bb'),
  ];
  const rowsData = [];
  for (let r = 0; r < rows; r++) {
    const k = 3 + ((rng() * 3) | 0);
    const lens = [];
    let sum = 0;
    for (let i = 0; i < k; i++) { const L = 0.5 + rng(); lens.push(L); sum += L; }
    const cuts = [0];
    let acc = 0;
    for (let i = 0; i < k; i++) { acc += (lens[i] / sum) * TU; cuts.push(acc); }
    cuts[k] = TU;
    const blocks = [];
    for (let i = 0; i < k; i++) {
      blocks.push({
        u0: cuts[i], u1: cuts[i + 1],
        c: tones[(rng() * tones.length) | 0],
        light: 0.92 + rng() * 0.18,
        seed: (rng() * 1e5) | 0,
        h: 0.72 + rng() * 0.28,
      });
    }
    rowsData.push(blocks);
  }
  const mortar = hexRGB('#6a6152');
  const JW = 0.010;  // tight dry-stack joint

  for (let y = 0; y < size; y++) {
    const v01 = (y + 0.5) / size;
    const v = v01 * TV;
    const row = Math.min(rows - 1, Math.floor(v / COURSE));
    const t = (v - row * COURSE) / COURSE;
    const blocks = rowsData[row];
    for (let x = 0; x < size; x++) {
      const u01 = (x + 0.5) / size;
      const u = u01 * TU;
      const i = y * size + x;
      let b = blocks[blocks.length - 1];
      for (let q = 0; q < blocks.length; q++) {
        if (u >= blocks[q].u0 && u < blocks[q].u1) { b = blocks[q]; break; }
      }
      const dv = Math.min(t, 1 - t) * COURSE;
      const du = Math.min(u - b.u0, b.u1 - u);
      const d = Math.min(du, dv);
      if (d < JW) {
        const n = fbmT(u01, v01, 180, 180, 2, 21);
        const k = smoothstep(0, JW, d);
        setPx(s, i, scaleRGB(mortar, 0.85 + n * 0.25), 0.02 + k * 0.18, clamp01(0.94 + n * 0.04));
        continue;
      }
      // cleft limestone face: horizontal bedding + chipped edges
      const bed = fbmT(u01, v01, 30, 90, 4, b.seed);
      const chip = fbmT(u01, v01, 120, 220, 3, b.seed + 5);
      let c = scaleRGB(b.c, b.light * (1 + bed * 0.14 + chip * 0.07));
      c = mixRGB(c, [0.52, 0.48, 0.41], smoothstep(0.4, 1.0, -bed) * 0.22);
      const edge = smoothstep(JW, JW + 0.022, d);
      const face = b.h * (0.55 + bed * 0.25 + chip * 0.2);
      const h = clamp01(face * (0.3 + 0.7 * edge));
      setPx(s, i, c, h, clamp01(0.82 + bed * 0.08 + chip * 0.05));
    }
  }
  s.reliefFt = 0.075;
  s.aoStrength = 2.6;
  s.aoRadius = 0.02;
  return s;
}

/* ------------------------------------------------------------ composite deck */
function genCompositeDeck(size) {
  const BW = 5.5 / 12, GAP = 0.22 / 12;
  const PITCH = BW + GAP;
  const boards = 4;
  const TU = 6.0, TV = PITCH * boards;
  const s = blank(size, [TU, TV]);
  const rng = mulberry32(0xdec4);
  const tones = [hexRGB('#8e8e8a'), hexRGB('#84847f'), hexRGB('#979792'), hexRGB('#7c7c78')];
  const rowsData = [];
  for (let i = 0; i < boards; i++) rowsData.push({ c: tones[(rng() * 4) | 0], k: 0.95 + rng() * 0.10, seed: (rng() * 1e5) | 0 });

  for (let y = 0; y < size; y++) {
    const v01 = (y + 0.5) / size;
    const v = v01 * TV;
    const row = Math.min(boards - 1, Math.floor(v / PITCH));
    const lv = (v - row * PITCH) / PITCH;
    const face = BW / PITCH;
    const d = rowsData[row];
    for (let x = 0; x < size; x++) {
      const u01 = (x + 0.5) / size;
      const i = y * size + x;
      if (lv > face) {
        const t = (lv - face) / (1 - face);
        const k = smoothstep(0, 0.5, Math.min(t, 1 - t));
        setPx(s, i, scaleRGB(d.c, 0.30 - k * 0.12), 0.0, 0.9);
        continue;
      }
      const t = lv / face;
      // embossed woodgrain streaks along the board
      const grain = fbmT(u01, v01, 7, 150, 3, d.seed);
      const brush = fbmT(u01, v01, 4, 260, 2, d.seed + 3);
      const drift = fbmT(u01, v01, 5, 3, 3, d.seed + 9);
      let c = scaleRGB(d.c, d.k * (1 + grain * 0.11 + brush * 0.05 + drift * 0.04));
      // slight crown + eased edges
      const ease = smoothstep(0, 0.06, Math.min(t, 1 - t));
      const crown = 1 - Math.pow(Math.abs(t - 0.5) * 2, 2) * 0.25;
      const h = (0.55 + grain * 0.30 + brush * 0.15) * crown * (0.25 + 0.75 * ease);
      c = scaleRGB(c, 0.9 + 0.1 * ease);
      setPx(s, i, c, clamp01(h), clamp01(0.62 + grain * 0.10));
    }
  }
  s.reliefFt = 0.022;
  s.aoStrength = 2.2;
  s.aoRadius = 0.02;
  return s;
}

/* --------------------------------------------------------- sunroom slats */
/** Dark stained narrow slat decking on the wrap-around indoor patio. */
function genSunroomDeckSlat(size) {
  const BW = 2.0 / 12, GAP = 0.55 / 12;
  const PITCH = BW + GAP;
  const boards = 8;
  const TU = 4.0, TV = PITCH * boards;
  const s = blank(size, [TU, TV]);
  const rng = mulberry32(0x51a71);
  const tones = [hexRGB('#3b342c'), hexRGB('#463d33'), hexRGB('#332d26'), hexRGB('#4d4238')];
  const rowsData = [];
  for (let i = 0; i < boards; i++) rowsData.push({ c: tones[(rng() * 4) | 0], k: 0.94 + rng() * 0.14, seed: (rng() * 1e5) | 0 });
  for (let y = 0; y < size; y++) {
    const v01 = (y + 0.5) / size;
    const v = v01 * TV;
    const row = Math.min(boards - 1, Math.floor(v / PITCH));
    const lv = (v - row * PITCH) / PITCH;
    const face = BW / PITCH;
    const d = rowsData[row];
    for (let x = 0; x < size; x++) {
      const u01 = (x + 0.5) / size;
      const i = y * size + x;
      if (lv > face) {
        setPx(s, i, [0.03, 0.028, 0.025], 0.0, 0.95);
        continue;
      }
      const t = lv / face;
      const grain = fbmT(u01, v01, 6, 170, 3, d.seed);
      let c = scaleRGB(d.c, d.k * (1 + grain * 0.16));
      const ease = smoothstep(0, 0.10, Math.min(t, 1 - t));
      const h = (0.6 + grain * 0.25) * (0.2 + 0.8 * ease);
      c = scaleRGB(c, 0.85 + 0.15 * ease);
      setPx(s, i, c, clamp01(h), clamp01(0.55 + grain * 0.10));
    }
  }
  s.reliefFt = 0.030;
  s.aoStrength = 2.4;
  s.aoRadius = 0.02;
  return s;
}

/* -------------------------------------------------------------- lawn grass */
/**
 * Fescue/bluegrass lawn with real MOWER STRIPES.
 *
 * A mower stripe is not a paint stripe: it is the SAME grass with the blades
 * bent in opposite directions by successive passes of the roller.  A band
 * mown away from you shows the backs of the blades and reads pale; the band
 * beside it shows the tips and reads dark.  So the stripe is modelled as an
 * alternating surface TILT (through `tiltU`, which is a genuine macroscopic
 * normal, not a bump) plus the albedo consequence, and it therefore changes
 * with the camera exactly as the stripes in
 * `straight_on_view_of_house_from_street.png` do.
 *
 * The other thing the photographs insist on is tonal RANGE: the front lawn
 * runs from deep shaded green through mid green to straw-yellow thin patches
 * within a few feet, and it is clumpy — the blades grow in tufts with visible
 * gaps, not as a uniform felt.
 */
function genLawnGrass(size) {
  const TU = 12.0, TV = 12.0;
  const s = blank(size, [TU, TV]);
  const n = size * size;
  // Sunlit turf in these photographs measures R 132-139 / G 141-148 /
  // B 90-104 — a yellow-green that is far LESS saturated than the green a
  // procedural lawn reaches for.  R/G is about 0.94, not 0.7.
  // Late-summer Michigan turf, re-measured: the LIT stripe is 164/161/68 —
  // R and G are equal and B is only 42% of R. The earlier palette was a
  // spring green (R/G 0.85, B/G 0.57) and rendered a lawn that was far too
  // blue-green to sit under this sky.
  const shade = hexRGB('#414a29');
  const deep = hexRGB('#596637');
  const mid = hexRGB('#737b41');
  const lite = hexRGB('#8f8d50');
  const straw = hexRGB('#9d9253');
  const thatch = hexRGB('#74663d');

  s.tiltU = new Float32Array(n);

  for (let y = 0; y < size; y++) {
    const v01 = (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      const u01 = (x + 0.5) / size;
      const i = y * size + x;

      /* --- mower stripes: 3 bands per 12 ft tile = 4 ft each ------------ */
      const edge = fbmT(u01, v01, 3, 2, 2, 6161) * 0.022;  // the roller wanders
      const sp = (v01 + edge) * 3;
      const sq = Math.sin(sp * Math.PI * 2);
      const stripe = smoothstep(-0.30, 0.30, sq);          // 0 = away, 1 = toward
      const lay = stripe * 2 - 1;                          // -1..1 lay direction

      /* --- blades: a fine anisotropic field whose direction FLIPS with the
         stripe, so the two bands are combed opposite ways ---------------- */
      const bw = warpT(u01, v01, 12, 12, 0.016, 1011);
      const bladeA = fbmT(bw[0] + bw[1] * 0.20, bw[1], 90, 620, 2, 1010);
      const bladeB = fbmT(bw[0] - bw[1] * 0.20, bw[1], 90, 620, 2, 2020);
      const blade = mix(bladeA, bladeB, stripe);

      /* --- clumps and bare/thin patches --------------------------------- */
      const clump = worleyT(u01, v01, 104, 104, 3030, 1);
      const tuft = 1 - smoothstep(0.14, 0.58, clump.f1);
      const patch = fbmT(u01, v01, 1.5, 1.5, 4, 4040) * 0.5 + 0.5;
      const patch2 = fbmT(u01, v01, 4, 4, 4, 4141) * 0.5 + 0.5;
      // late-summer turf is patchy: thin dry areas next to rich green ones,
      // a 30% swing over a few feet. A uniform lawn is a render giveaway.
      const patch3 = fbmT(u01, v01, 9, 9, 3, 4242) * 0.5 + 0.5;
      const dry = smoothstep(0.62, 0.98, patch * 0.6 + patch2 * 0.5);
      const rich = smoothstep(0.58, 0.10, patch * 0.55 + patch2 * 0.55);

      let c = mixRGB(deep, mid, smoothstep(0.15, 0.85, patch2));
      c = mixRGB(c, lite, smoothstep(-0.25, 0.60, blade) * 0.70);
      c = mixRGB(c, deep, smoothstep(-0.15, -0.65, blade) * 0.45);
      c = mixRGB(c, shade, rich * 0.55);
      c = mixRGB(c, straw, dry * 0.72);
      // thatch showing between the tufts
      c = mixRGB(c, thatch, (1 - tuft) * 0.16);
      // the bent blades of one stripe throw more light back
      c = scaleRGB(c, mix(0.955, 1.045, stripe));
      c = scaleRGB(c, 0.945 + tuft * 0.11);
      c = scaleRGB(c, 0.80 + 0.42 * patch3);
      c = mixRGB(c, straw, smoothstep(0.58, 0.95, patch3) * 0.35);

      const h = 0.45 + tuft * 0.24 + blade * 0.34 + (patch2 - 0.5) * 0.16;
      setPx(s, i, c, clamp01(h), clamp01(0.80 - stripe * 0.10 + (1 - tuft) * 0.05));
      // the actual lay of the blades — this is what makes the stripe survive
      // a change of viewpoint
      s.tiltU[i] = lay * 0.16;
    }
  }
  s.reliefFt = 0.020;
  s.aoStrength = 1.6;
  return s;
}

/* ---------------------------------------------------------------- foliage */
/**
 * A cut-out spray of leaves on a transparent card. Used with `alphaTest`, so
 * the same sheet drives the shadow pass and the canopy throws a real dappled
 * shadow instead of a smooth blob.
 *
 * The single most damaging thing about a CG tree is a canopy made of smooth
 * shaded lumps: a real canopy at 40 ft still resolves individual leaves, each
 * one catching the sun at its own angle, with sky showing through the gaps.
 * These sheets are what buy that.
 *
 * @param {number} size    texture size
 * @param {object} o
 * @param {number} o.count       leaves per sheet
 * @param {number} o.leafR       leaf half-length, in 0..1 sheet units
 * @param {number} o.aspect      leaf width / length
 * @param {number} o.pointy      1 = round (redbud/katsura), 3 = lanceolate
 * @param {string[]} o.tones     leaf albedos, sampled per leaf
 * @param {number} o.spread      radial spread of the spray, 0..0.5
 */
function leafSheet(size, o) {
  const s = blank(size, o.scaleFeet || [1, 1]);
  const n = size * size;
  s.alp = new Float32Array(n);
  s.clamp = true;
  const tones = o.tones.map(hexRGB);
  const depth = new Float32Array(n);     // painter's-algorithm z
  for (let i = 0; i < n; i++) depth[i] = -1;

  const R = mulberry32(o.seed || 1234);
  const count = o.count;
  for (let k = 0; k < count; k++) {
    // Cluster toward the middle of the sheet with a soft radial falloff, and
    // let a handful of leaves hang past the edge so the silhouette is ragged.
    const a = R() * Math.PI * 2;
    const rr = o.spread * Math.pow(R(), 0.62);
    const cx = 0.5 + Math.cos(a) * rr;
    const cy = 0.5 + Math.sin(a) * rr * 0.92;
    const ang = R() * Math.PI * 2;
    const len = o.leafR * (0.62 + 0.75 * R());
    const wid = len * o.aspect * (0.8 + 0.4 * R());
    // leaves near the sheet edge are further from the light -> darker
    const z = R();
    const tone = tones[(R() * tones.length) | 0];
    const shadeK = 0.62 + 0.55 * z;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const rad = Math.max(len, wid) + 2 / size;
    const x0 = Math.max(0, Math.floor((cx - rad) * size));
    const x1 = Math.min(size - 1, Math.ceil((cx + rad) * size));
    const y0 = Math.max(0, Math.floor((cy - rad) * size));
    const y1 = Math.min(size - 1, Math.ceil((cy + rad) * size));
    for (let y = y0; y <= y1; y++) {
      const py = (y + 0.5) / size - cy;
      for (let x = x0; x <= x1; x++) {
        const px = (x + 0.5) / size - cx;
        const lx = (px * ca + py * sa) / len;      // along the midrib
        const ly = (-px * sa + py * ca) / wid;
        // teardrop: full width at the base, tapering to the tip
        const taper = 1 - Math.pow(Math.max(0, (lx + 1) * 0.5), o.pointy) * 0.92;
        const d = lx * lx + (ly * ly) / Math.max(taper * taper, 0.02);
        if (d > 1) continue;
        const i = y * size + x;
        if (z < depth[i]) continue;
        depth[i] = z;
        const edge = 1 - d;                       // 0 at rim, 1 at midrib
        // midrib + a couple of side veins, and a curled highlight
        const vein = Math.exp(-Math.abs(ly) * 26) * 0.20
          + Math.exp(-Math.abs(Math.abs(ly) - 0.42) * 20) * 0.08;
        let c = scaleRGB(tone, shadeK * (0.90 + 0.30 * edge) * (1 - vein * 0.55));
        s.alb[i * 3] = c[0]; s.alb[i * 3 + 1] = c[1]; s.alb[i * 3 + 2] = c[2];
        // height: the leaf domes away from the midrib and sits proud of the
        // ones behind it, so the normal map lights each leaf separately
        s.hgt[i] = clamp01(0.18 + z * 0.55 + Math.sqrt(Math.max(edge, 0)) * 0.22 + vein * 0.4);
        s.rgh[i] = 0.60 + 0.18 * (1 - edge);
        // a soft 1-texel rim keeps alphaTest from aliasing into a jagged edge
        s.alp[i] = clamp01(0.35 + d * 0.0 + Math.min(1, edge * size * 0.06) * 0.75);
      }
    }
  }
  s.reliefFt = o.reliefFt === undefined ? 0.05 : o.reliefFt;
  s.aoStrength = 1.1;
  return s;
}

/** Broad round leaves — the front-yard ornamental (redbud/katsura habit). */
function genFoliageBroadleaf(size) {
  return leafSheet(size, {
    seed: 20604,
    count: 150,
    leafR: 0.088,
    aspect: 0.86,
    pointy: 2.2,
    spread: 0.40,
    scaleFeet: [4, 4],
    tones: [
      '#4b7229', '#55802f', '#5f8b36', '#6b973b', '#3d5c23',
      '#77a03e', '#57762c', '#83a545', '#456427', '#658a34',
    ],
  });
}

/** Small dense leaves — clipped boxwood / privet / euonymus. */
function genFoliageShrub(size) {
  return leafSheet(size, {
    seed: 771,
    count: 320,
    leafR: 0.048,
    aspect: 0.62,
    pointy: 1.6,
    spread: 0.44,
    scaleFeet: [1.6, 1.6],
    reliefFt: 0.02,
    tones: [
      '#3d5c24', '#476928', '#354e20', '#527a2c', '#2e441c',
      '#5d8631', '#436326', '#293c18',
    ],
  });
}

/** Conifer needle spray — the big pine on the west edge of the front lot. */
function genFoliageNeedle(size) {
  return leafSheet(size, {
    seed: 5099,
    count: 620,
    leafR: 0.12,
    aspect: 0.075,
    pointy: 0.6,
    spread: 0.40,
    scaleFeet: [3, 3],
    reliefFt: 0.015,
    tones: [
      '#25401f', '#2c4a24', '#1c3218', '#35562a', '#16280f', '#3d5f2e',
    ],
  });
}

/* ------------------------------------------------------------------ bark */
function genTreeBark(size) {
  const TU = 2.0, TV = 3.0;
  const s = blank(size, [TU, TV]);
  const dark = hexRGB('#3d362e');
  const mid = hexRGB('#6a6055');
  const lite = hexRGB('#8d857a');
  const moss = hexRGB('#5c6446');
  for (let y = 0; y < size; y++) {
    const v01 = (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      const u01 = (x + 0.5) / size;
      const i = y * size + x;
      // vertical fissures: ridged noise stretched hard along V
      const w = warpT(u01, v01, 6, 2, 0.05, 313);
      const fis = ridgedT(w[0], w[1], 26, 3, 4, 909, 0.5);
      const fine = fbmT(u01, v01, 90, 14, 3, 707);
      const plate = worleyT(u01, v01, 9, 3, 505, 0.9);
      const groove = smoothstep(0.72, 1.0, fis);
      let c = mixRGB(mid, lite, clamp01(fine * 0.5 + 0.5));
      c = mixRGB(c, dark, groove * 0.85);
      c = mixRGB(c, dark, (1 - smoothstep(0.02, 0.12, plate.f2 - plate.f1)) * 0.5);
      c = mixRGB(c, moss, clamp01(fbmT(u01, v01, 3, 3, 2, 1313) * 0.5 + 0.5) * 0.18);
      const h = 0.55 - groove * 0.5 + fine * 0.2;
      setPx(s, i, c, clamp01(h), clamp01(0.92 - fine * 0.05));
    }
  }
  s.reliefFt = 0.045;
  s.aoStrength = 2.0;
  return s;
}

/* ------------------------------------------------------------- mulch bed */
function genMulchBed(size) {
  const TU = 3.0, TV = 3.0;
  const s = blank(size, [TU, TV]);
  // Shredded hardwood, re-measured off the tree ring in
  // straight_on_view_of_house_from_street.png: SUNLIT mulch is a mid brown
  // around 110/85/60, not the near-black the old palette rendered. It only
  // goes black where it sits in the shade of the foundation planting.
  const tones = [
    hexRGB('#4a3a2a'), hexRGB('#5c4834'), hexRGB('#3e3024'), hexRGB('#6b543c'),
    hexRGB('#4f3d2c'), hexRGB('#7a6045'),
  ];
  for (let y = 0; y < size; y++) {
    const v01 = (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      const u01 = (x + 0.5) / size;
      const i = y * size + x;
      // shredded bark: long thin cells at two orientations
      const wA = worleyT(u01 * 1.0, v01 * 1.0, 90, 22, 5252, 1);
      const wB = worleyT(v01 * 1.0, u01 * 1.0, 90, 22, 6262, 1);
      const useA = ((wA.id ^ wB.id) & 1) === 0;
      const w = useA ? wA : wB;
      const c0 = tones[w.id % tones.length];
      const n = fbmT(u01, v01, 300, 300, 2, 7272);
      const shade = 0.75 + (1 - smoothstep(0.0, 0.55, w.f1)) * 0.45;
      let c = scaleRGB(c0, shade * (1 + n * 0.22));
      const big = fbmT(u01, v01, 5, 5, 3, 8282);
      c = scaleRGB(c, 1 + big * 0.15);
      const h = (1 - smoothstep(0.05, 0.6, w.f1)) * 0.8 + n * 0.2;
      setPx(s, i, c, clamp01(h), clamp01(0.88 + n * 0.06));
    }
  }
  s.reliefFt = 0.03;
  s.aoStrength = 2.4;
  s.aoRadius = 0.022;
  return s;
}

/* --------------------------------------------------------- concrete drive */
function genConcreteDriveway(size) {
  const TU = 6.0, TV = 6.0;
  const s = blank(size, [TU, TV]);
  // MEASURED off straight_on_view_of_house_from_street.png: sunlit broom
  // concrete reads 170 / 174 / 179 — a mid grey with a faint COOL cast, not
  // the near-white a default concrete albedo renders to.
  const base = hexRGB('#949699');
  for (let y = 0; y < size; y++) {
    const v01 = (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      const u01 = (x + 0.5) / size;
      const i = y * size + x;
      const agg = worleyT(u01, v01, 220, 220, 4321, 1);
      const fine = fbmT(u01, v01, 420, 420, 2, 5432);
      const broom = fbmT(u01, v01, 400, 8, 2, 6543);
      const stain = fbmT(u01, v01, 4, 4, 4, 7654);
      let c = scaleRGB(base, 1 + fine * 0.09 + stain * 0.07);
      const a = 1 - smoothstep(0.10, 0.35, agg.f1);
      if ((agg.id % 100) < 30) c = scaleRGB(c, 1 - a * 0.10);
      c = scaleRGB(c, 1 + broom * 0.035);
      const h = 0.5 + broom * 0.35 + fine * 0.25 - a * 0.2;
      setPx(s, i, c, clamp01(h), clamp01(0.80 + fine * 0.06 - broom * 0.04));
    }
  }
  s.reliefFt = 0.004;
  s.aoStrength = 1.2;
  return s;
}

/* ------------------------------------------------------------- metals */
function brushedMetal(size, TU, color, roughBase, seedBase, aniso) {
  const s = blank(size, [TU, TU]);
  const c0 = hexRGB(color);
  const n = size * size;
  const f = new Float32Array(n);
  for (let y = 0; y < size; y++) {
    const v01 = (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      const u01 = (x + 0.5) / size;
      f[y * size + x] = fbmT(u01, v01, 5, Math.round(aniso * 0.42), 3, seedBase, 0.62) * 0.5 + 0.5;
    }
  }
  const streaked = streak(f, size, Math.max(2, Math.round(size * 0.02)), 0);
  const met = new Float32Array(n);
  for (let y = 0; y < size; y++) {
    const v01 = (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      const u01 = (x + 0.5) / size;
      const i = y * size + x;
      const st = streaked[i];
      const micro = fbmT(u01, v01, 4, aniso, 2, seedBase + 17) * 0.5 + 0.5;
      const c = scaleRGB(c0, 0.88 + st * 0.25);
      const r = clamp01(roughBase + (st - 0.5) * 0.34 + (micro - 0.5) * 0.14);
      setPx(s, i, c, st * 0.6 + micro * 0.4, r);
      met[i] = 1.0;
    }
  }
  s.met = met;
  s.reliefFt = 0.0004;
  s.aoStrength = 0.4;
  return s;
}

const genStainlessBrushed = (n) => brushedMetal(n, 1.5, '#b8bcc0', 0.30, 8811, 320);
const genBrassBrushed = (n) => brushedMetal(n, 1.0, '#a08a5f', 0.34, 8822, 280);

/* -------------------------------------------------------------- fabrics */
function genFabricLinen(size) {
  const TU = 1.0, TV = 1.0;
  const s = blank(size, [TU, TV]);
  const base = hexRGB('#d2c9b8');
  const THREADS = 46;
  for (let y = 0; y < size; y++) {
    const v01 = (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      const u01 = (x + 0.5) / size;
      const i = y * size + x;
      const tu = u01 * THREADS, tv = v01 * THREADS;
      const iu = Math.floor(tu), iv = Math.floor(tv);
      const fu = tu - iu, fv = tv - iv;
      const over = ((iu + iv) & 1) === 0;   // plain weave
      // rounded thread cross-sections
      const wu = Math.sin(Math.PI * fu);
      const wv = Math.sin(Math.PI * fv);
      const h = over ? wu * 0.85 + wv * 0.25 : wv * 0.85 + wu * 0.25;
      // slub: irregular thread thickness
      const slub = fbmT(u01, v01, THREADS, 3, 2, 9911) * 0.5 + 0.5;
      const slub2 = fbmT(u01, v01, 3, THREADS, 2, 9922) * 0.5 + 0.5;
      const tint = over ? slub : slub2;
      let c = scaleRGB(base, 0.86 + tint * 0.28);
      c = scaleRGB(c, 0.78 + h * 0.42);
      setPx(s, i, c, clamp01(h * 0.9), clamp01(0.82 - h * 0.08));
    }
  }
  s.reliefFt = 0.007;
  s.aoStrength = 2.6;
  s.aoRadius = 0.02;
  return s;
}

function genFabricVelvet(size) {
  const TU = 1.5, TV = 1.5;
  const s = blank(size, [TU, TV]);
  const base = hexRGB('#3f4e57');
  for (let y = 0; y < size; y++) {
    const v01 = (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      const u01 = (x + 0.5) / size;
      const i = y * size + x;
      const fiber = fbmT(u01, v01, 500, 500, 2, 1212) * 0.5 + 0.5;
      const nap = fbmT(u01, v01, 4, 4, 4, 2323) * 0.5 + 0.5;
      const crush = fbmT(u01, v01, 12, 12, 3, 3434) * 0.5 + 0.5;
      let c = scaleRGB(base, 0.80 + nap * 0.45 + crush * 0.12);
      c = scaleRGB(c, 0.94 + fiber * 0.12);
      setPx(s, i, c, clamp01(fiber * 0.5 + nap * 0.5), clamp01(0.60 + nap * 0.20));
    }
  }
  s.reliefFt = 0.002;
  s.aoStrength = 1.0;
  return s;
}

function genLeatherDark(size) {
  const TU = 1.5, TV = 1.5;
  const s = blank(size, [TU, TV]);
  const base = hexRGB('#3b2d24');
  for (let y = 0; y < size; y++) {
    const v01 = (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      const u01 = (x + 0.5) / size;
      const i = y * size + x;
      const w = warpT(u01, v01, 20, 20, 0.012, 4545);
      const cell = worleyT(w[0], w[1], 44, 44, 4545, 1);
      const crease = smoothstep(0.10, 0.0, cell.f2 - cell.f1);
      const cell2 = worleyT(w[0], w[1], 110, 110, 5656, 1);
      const micro = smoothstep(0.12, 0.0, cell2.f2 - cell2.f1);
      const grain = fbmT(u01, v01, 260, 260, 2, 6767);
      let c = scaleRGB(base, 1 + grain * 0.12);
      c = scaleRGB(c, 1 - crease * 0.52 - micro * 0.20);
      c = scaleRGB(c, 0.88 + (1 - cell.f1) * 0.26);
      const h = (1 - crease) * 0.8 - micro * 0.15 + grain * 0.1;
      setPx(s, i, c, clamp01(h), clamp01(0.48 + crease * 0.25 + grain * 0.05));
    }
  }
  s.reliefFt = 0.008;
  s.aoStrength = 2.4;
  s.aoRadius = 0.016;
  return s;
}

/* ---------------------------------------------------------------- glass */
function flatSurface(size, TU, color, rough, seedBase, noiseAmt, roughNoise) {
  const s = blank(size, [TU, TU]);
  const c0 = hexRGB(color);
  for (let y = 0; y < size; y++) {
    const v01 = (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      const u01 = (x + 0.5) / size;
      const i = y * size + x;
      const n = fbmT(u01, v01, 90, 90, 3, seedBase);
      const c = scaleRGB(c0, 1 + n * noiseAmt);
      setPx(s, i, c, 0.5 + n * 0.5, clamp01(rough + n * roughNoise));
    }
  }
  s.reliefFt = 0.0002;
  s.aoStrength = 0.2;
  return s;
}

const genMirrorGlass = (n) => flatSurface(n, 3, '#f2f4f5', 0.020, 7001, 0.010, 0.010);
const genClearGlass = (n) => flatSurface(n, 3, '#ffffff', 0.020, 7002, 0.006, 0.008);

function genFrostedGlass(size) {
  const s = blank(size, [2, 2]);
  const c0 = hexRGB('#f0f3f4');
  for (let y = 0; y < size; y++) {
    const v01 = (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      const u01 = (x + 0.5) / size;
      const i = y * size + x;
      const n = fbmT(u01, v01, 260, 260, 3, 7003);
      const w = worleyT(u01, v01, 70, 70, 7004, 1);
      const etch = 1 - smoothstep(0.0, 0.5, w.f1);
      const c = scaleRGB(c0, 1 + n * 0.03);
      setPx(s, i, c, 0.5 + n * 0.4 + etch * 0.2, clamp01(0.55 + n * 0.12 + etch * 0.10));
    }
  }
  s.reliefFt = 0.0008;
  s.aoStrength = 0.3;
  return s;
}

/* ======================================================================== */
/* 8. Registry                                                               */
/* ======================================================================== */

const REG = {
  /* --- floors --- */
  redOakFloor: { hero: true, gen: genRedOakFloor, scaleFeet: [11, 3.25 / 12 * 14], note: '3-1/4" natural red oak strip, satin poly, anisotropic sheen. 14-board x 11 ft atlas. Grain runs along +U.' },
  lightPlankFloor: { hero: false, gen: genLightPlankFloor, scaleFeet: [6, 7 / 12 * 4], note: '7" gray-beige LVP plank, matte. Grain along +U.' },
  carpetTan: { hero: true, gen: genCarpetTan, scaleFeet: [2, 2], note: 'Primary bedroom greige CUT pile: directional nap + vacuum banding. Nap runs along +U.' },
  carpetBeige: { hero: true, gen: genCarpetBeige, scaleFeet: [2, 2], note: 'Basement/second-floor beige LOOP pile: denser and flatter than carpetTan. Nap along +U.' },
  rubberGymFloor: { hero: false, gen: genRubberGymFloor, scaleFeet: [2, 2], note: 'Charcoal flecked rubber gym flooring.' },
  sunroomDeckSlat: { hero: false, gen: genSunroomDeckSlat, scaleFeet: [4, (2 / 12 + 0.55 / 12) * 8], note: 'Dark 2" slat deck, sunroom / indoor patio.' },
  compositeDeck: { hero: false, gen: genCompositeDeck, scaleFeet: [6, (5.5 / 12 + 0.22 / 12) * 4], note: 'Gray composite decking, 5.5" boards.' },

  /* --- stone & tile --- */
  quartzWhite: { hero: true, gen: genQuartzWhite, scaleFeet: [6, 6], note: 'White quartz with soft gray veining, polished.' },
  quartzSlabBacksplash: { hero: true, gen: genQuartzSlabBacksplash, scaleFeet: [10, 7], clamp: true, note: 'Book-matched continuous slab; UVs must map the whole wall 0..1.' },
  blackGranite: { hero: false, gen: genBlackGranite, scaleFeet: [4, 4], note: 'Polished absolute-black granite with mica.' },
  bronzePorcelain: { hero: true, gen: genBronzePorcelain, scaleFeet: [4, 4], note: 'Primary bath 12x24 metallic bronze porcelain, half bond.' },
  bronzePorcelainFloor: { hero: true, gen: genBronzePorcelainFloor, scaleFeet: [13 / 12 * 4, 13 / 12 * 4], note: 'Primary bath floor, 13" tan-bronze porcelain.' },
  marbleLookTile: { hero: true, gen: genMarbleLookTile, scaleFeet: [4, 4], note: '1st-floor bath 12x12 beige marble-look porcelain.' },
  mosaicAccent: { hero: false, gen: genMosaicAccent, scaleFeet: [0.5, 0.5], note: '1" square blended mosaic accent band.' },
  bluestone: { hero: false, gen: genBluestone, scaleFeet: [6, 6], note: 'Irregular blue-gray cleft flagstone.' },
  stackedLimestone: { hero: false, gen: genStackedLimestone, scaleFeet: [4, 3.2 / 12 * 12], note: 'Buff dry-stack ledgestone, 3.2" courses.' },
  concreteDriveway: { hero: false, gen: genConcreteDriveway, scaleFeet: [6, 6], note: 'Broom-finished gray concrete.' },

  /* --- wood --- */
  cherryCabinet: { hero: false, gen: genCherryCabinet, scaleFeet: [2.5, 3], note: 'Light natural cherry/oak casework. Grain runs along +V.' },
  cherryCabinetDark: { hero: false, gen: genCherryCabinetDark, scaleFeet: [2.5, 3], note: 'Stained cherry vanity. Grain along +V.' },
  butcherBlock: { hero: false, gen: genButcherBlock, scaleFeet: [4, 2], note: 'Maple edge-grain butcher block, 1.5" strips along +U.' },
  woodSlatWall: { hero: false, gen: genWoodSlatWall, scaleFeet: [(1.125 / 12 + 0.45 / 12) * 8, 4], note: 'White-oak slat wall, 1-1/8" slats @ 0.45" reveal, vertical.' },
  blackBacker: { hero: false, gen: genBlackBacker, scaleFeet: [2, 2], note: 'Matte black felt backer / reveal interior.' },

  /* --- paint --- */
  paintedOffWhite: { hero: false, gen: genPaintedOffWhite, scaleFeet: [3, 3], note: 'Kitchen upper cabinets, warm off-white satin lacquer.' },
  paintedSlateBlue: { hero: false, gen: genPaintedSlateBlue, scaleFeet: [3, 3], note: 'Mudroom cabinets, slate blue satin.' },
  paintedGreige: { hero: false, gen: genPaintedGreige, scaleFeet: [3, 3], note: '1st-floor bath vanity, greige satin.' },
  wallPaintWhite: { hero: false, gen: genWallPaintWhite, scaleFeet: [4, 4], note: 'Eggshell wall paint, roller stipple.' },
  wallPaintWarmWhite: { hero: false, gen: genWallPaintWarmWhite, scaleFeet: [4, 4], note: 'Warm eggshell wall paint.' },
  ceilingPaint: { hero: false, gen: genCeilingPaint, scaleFeet: [4, 4], note: 'Flat ceiling white.' },
  drywallCeilingKnockdown: { hero: false, gen: genDrywallCeilingKnockdown, scaleFeet: [4, 4], note: 'Knockdown-textured ceiling.' },
  blackMatte: { hero: false, gen: genBlackMatte, scaleFeet: [1.5, 1.5], note: 'Matte black hardware / fixtures.' },

  /* --- exterior --- */
  grayLapSiding: { hero: true, gen: genGrayLapSiding, scaleFeet: [8, 7.5 / 12 * 6], note: 'Weathered silvery-gray cedar lap siding, 7.5" exposure, grain through the stain.' },
  asphaltShingle: { hero: false, gen: genAsphaltShingle, scaleFeet: [3, 5.5 / 12 * 4], note: 'Charcoal architectural shingle, 5.5" exposure.' },
  lawnGrass: { hero: true, gen: genLawnGrass, scaleFeet: [12, 12], note: 'Lawn: 4 ft mower stripes running along +U, real alternating blade lay, clumpy with straw patches.' },
  mulchBed: { hero: false, gen: genMulchBed, scaleFeet: [3, 3], note: 'Dark shredded hardwood mulch.' },
  treeBark: { hero: false, gen: genTreeBark, scaleFeet: [2, 3], note: 'Grey-brown fissured bark; fissures run along +V.' },
  foliageBroadleaf: { hero: true, clamp: true, gen: genFoliageBroadleaf, scaleFeet: [4, 4], note: 'Cut-out spray of broad round leaves (alphaMap). Canopy card for deciduous trees.' },
  foliageShrub: { hero: false, clamp: true, gen: genFoliageShrub, scaleFeet: [1.6, 1.6], note: 'Cut-out spray of small dense leaves (alphaMap). Clipped boxwood / privet.' },
  foliageNeedle: { hero: false, clamp: true, gen: genFoliageNeedle, scaleFeet: [3, 3], note: 'Cut-out conifer needle spray (alphaMap).' },

  /* --- metals, fabrics, glass --- */
  stainlessBrushed: { hero: false, gen: genStainlessBrushed, scaleFeet: [1.5, 1.5], note: 'Brushed stainless; brush runs along +U.' },
  brassBrushed: { hero: false, gen: genBrassBrushed, scaleFeet: [1, 1], note: 'Brushed/antique brass; brush along +U.' },
  fabricLinen: { hero: false, gen: genFabricLinen, scaleFeet: [1, 1], note: 'Plain-weave linen upholstery.' },
  fabricVelvet: { hero: false, gen: genFabricVelvet, scaleFeet: [1.5, 1.5], note: 'Velvet pile upholstery.' },
  leatherDark: { hero: false, gen: genLeatherDark, scaleFeet: [1.5, 1.5], note: 'Dark pebbled leather.' },
  mirrorGlass: { hero: false, gen: genMirrorGlass, scaleFeet: [3, 3], note: 'Mirror substrate (use with metalness 1).' },
  frostedGlass: { hero: false, gen: genFrostedGlass, scaleFeet: [2, 2], note: 'Acid-etched privacy glass.' },
  clearGlass: { hero: false, gen: genClearGlass, scaleFeet: [3, 3], note: 'Clear glazing.' },
};

export const TEXTURE_NAMES = Object.keys(REG);

export const TEXTURE_INFO = Object.freeze(
  TEXTURE_NAMES.reduce((acc, k) => {
    acc[k] = Object.freeze({
      scaleFeet: REG[k].scaleFeet.slice(),
      hero: !!REG[k].hero,
      clamp: !!REG[k].clamp,
      note: REG[k].note,
    });
    return acc;
  }, {})
);

export const QUALITY_SIZES = Object.freeze({
  high: { base: 1024, hero: 2048 },
  medium: { base: 512, hero: 1024 },
  draft: { base: 256, hero: 512 },
  thumb: { base: 192, hero: 256 },
});

let DEFAULT_QUALITY = 'high';
export function setTextureQuality(q) {
  if (QUALITY_SIZES[q]) DEFAULT_QUALITY = q;
}
export function getTextureQuality() { return DEFAULT_QUALITY; }

const CACHE = new Map();

function sizeFor(name, quality) {
  const q = QUALITY_SIZES[quality] || QUALITY_SIZES[DEFAULT_QUALITY];
  const n = REG[name].hero ? q.hero : q.base;
  // sizes must be powers of two (mipmaps + wrap arithmetic)
  return 1 << Math.round(Math.log2(n));
}

/**
 * Build (or fetch from cache) a texture set.
 * @param {string} name
 * @param {string} [quality] one of QUALITY_SIZES keys
 */
export function getTexture(name, quality) {
  const entry = REG[name];
  if (!entry) throw new Error(`textures.js: unknown texture "${name}"`);
  const size = sizeFor(name, quality);
  const key = `${name}|${size}`;
  const hit = CACHE.get(key);
  if (hit) return hit;
  const spec = entry.gen(size);
  spec.size = size;
  spec.scaleFeet = spec.scaleFeet || entry.scaleFeet;
  if (entry.clamp) spec.clamp = true;
  const set = pack(name, spec);
  set.note = entry.note;
  CACHE.set(key, set);
  return set;
}

/** Free every cached GPU texture. */
export function disposeTextures() {
  for (const set of CACHE.values()) {
    for (const k of ['map', 'normalMap', 'roughnessMap', 'aoMap', 'metalnessMap']) {
      if (set[k]) set[k].dispose();
    }
  }
  CACHE.clear();
}

/**
 * Library facade.  `tex.redOakFloor` generates on first access and caches.
 *   const tex = makeTextures({ quality: 'high' });
 *   tex.redOakFloor.map
 */
export function makeTextures(opts = {}) {
  const quality = opts.quality && QUALITY_SIZES[opts.quality] ? opts.quality : DEFAULT_QUALITY;
  const api = {
    quality,
    names: TEXTURE_NAMES.slice(),
    info: TEXTURE_INFO,
    get(name) { return getTexture(name, quality); },
    dispose: disposeTextures,
  };
  return new Proxy(api, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (typeof prop === 'string' && REG[prop]) return getTexture(prop, quality);
      return undefined;
    },
    has(target, prop) {
      return (prop in target) || (typeof prop === 'string' && !!REG[prop]);
    },
    ownKeys() { return TEXTURE_NAMES.slice(); },
    getOwnPropertyDescriptor() {
      return { enumerable: true, configurable: true };
    },
  });
}

export default makeTextures;
