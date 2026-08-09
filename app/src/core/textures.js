/**
 * textures.js — procedural CanvasTexture library for 1430 Country Ln.
 *
 * CONTRACT (see docs/CONVENTIONS.md)
 * ---------------------------------
 * - 1 world unit = 1 foot.  Every texture declares `scaleFeet = [u, v]`, the
 *   real-world size in FEET that one full 0..1 UV tile covers.  Nothing in this
 *   file is "arbitrary tiling": a red-oak strip really is 2.25" wide.
 * - No network assets, no binaries.  Everything is drawn into a <canvas> from
 *   seeded noise, so the same build always yields the same pixels.
 * - Each entry returns a texture SET:
 *       { map, normalMap, roughnessMap, aoMap, [metalnessMap], scaleFeet, size }
 *   `map` is SRGBColorSpace; every data map is NoColorSpace.  All are
 *   RepeatWrapping (except slabs flagged `clamp`) with anisotropy 8.
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
 *    Wide random palettes read as patchwork laminate.
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

function pgrad(ix, iy, px, py, seed, dx, dy) {
  const wx = ((ix % px) + px) % px;
  const wy = ((iy % py) + py) % py;
  const h = ihash(wx, wy, seed);
  const a = (h & 65535) * (Math.PI * 2 / 65536);
  return Math.cos(a) * dx + Math.sin(a) * dy;
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
function normalFromHeight(h, size, sx, sy) {
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
  const nrm = normalFromHeight(spec.hgt, size, sx, sy);
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

const OAK_GRAIN = {
  rings: 2.6, ringWidth: 0.042, warpFU: 5, warpFV: 2, warpAmp: 1.85,
  fineFU: 10, fineFV: 200, fineAmt: 0.22,
  poreFU: 340, poreFV: 170, poreThresh: 0.22, poreAmt: 0.75,
  fleckFU: 40, fleckFV: 26, fleckAmt: 0.14,
};

/* ======================================================================== */
/* 7. Generators                                                             */
/* ======================================================================== */

/* ---------------------------------------------------------- red oak floor */
/**
 * 2.25" site-finished red oak strip, satin polyurethane.
 * Tile: 6.0 ft along the strips x 2.25 ft across = 12 strips.
 */
function genRedOakFloor(size) {
  const TU = 6.0, TV = 2.25, STRIP = 2.25 / 12;
  const rows = Math.round(TV / STRIP); // 12
  const s = blank(size, [TU, TV]);
  const rng = mulberry32(0x0a11ce);

  // A finished floor is one species from one mill: tone varies, but only a
  // little.  Wide random palettes read as patchwork laminate.
  const tones = [
    hexRGB('#b28a5c'), hexRGB('#ab8457'), hexRGB('#b79063'), hexRGB('#a67f53'),
    hexRGB('#b58d60'), hexRGB('#b0885a'),
  ];

  // Board layout: each strip row is cut into 2-3 boards summing exactly to TU
  // (so end joints land on the tile seam and the texture stays tileable).
  const rowsData = [];
  for (let r = 0; r < rows; r++) {
    const k = 2 + (rng() < 0.45 ? 1 : 0);
    const lens = [];
    let sum = 0;
    for (let i = 0; i < k; i++) { const L = 0.75 + rng() * 0.9; lens.push(L); sum += L; }
    const cuts = [0];
    let acc = 0;
    for (let i = 0; i < k; i++) { acc += (lens[i] / sum) * TU; cuts.push(acc); }
    cuts[k] = TU;
    const boards = [];
    for (let i = 0; i < k; i++) {
      boards.push({
        u0: cuts[i], u1: cuts[i + 1],
        tone: tones[(rng() * tones.length) | 0],
        light: 0.94 + rng() * 0.125,
        seed: (rng() * 100000) | 0,
        sat: 0.965 + rng() * 0.07,
        cfg: boardGrain(OAK_GRAIN, rng()),
      });
    }
    rowsData.push(boards);
  }

  const grout = hexRGB('#7a5a3a');
  const bevelW = 0.030;           // fraction of strip width
  const endW = 0.0035;            // feet

  for (let y = 0; y < size; y++) {
    const v01 = (y + 0.5) / size;
    const v = v01 * TV;
    const row = Math.min(rows - 1, Math.floor(v / STRIP));
    const t = (v - row * STRIP) / STRIP;
    const boards = rowsData[row];
    for (let x = 0; x < size; x++) {
      const u01 = (x + 0.5) / size;
      const u = u01 * TU;
      let b = boards[boards.length - 1];
      for (let i = 0; i < boards.length; i++) {
        if (u >= boards[i].u0 && u < boards[i].u1) { b = boards[i]; break; }
      }
      const i = y * size + x;

      const g = woodGrain(u01, v01, t, b.seed, b.cfg);

      // base colour with per-board tone / lightness / warmth
      let c = scaleRGB(b.tone, b.light);
      c = [c[0], c[1] * mix(1.0, 0.985, 1 - b.sat), c[2] * b.sat];
      // large slow colour drift within a board
      const drift = fbmT(u01, v01, 4, 3, 3, b.seed + 5) * 0.075;
      c = scaleRGB(c, 1 + drift);
      // Broad ring band first (this is the cathedral figure you see from 10 ft),
      // then the thin latewood line, then pores and rays.
      c = scaleRGB(c, 1 - g.band * 0.21);
      c = scaleRGB(c, 1 - g.ring * 0.30);
      c = mixRGB(c, scaleRGB(c, 0.62), g.pore * 0.42);
      c = mixRGB(c, scaleRGB(c, 1.08), g.fleck);

      // relief: pores and latewood sit a hair below the finish film
      let h = 0.55 - g.pore * 0.55 - g.ring * 0.10;

      // micro-bevel at strip seams
      const e = Math.min(t, 1 - t) / bevelW;
      const bev = smoothstep(0, 1, Math.min(1, e));
      h *= 0.35 + 0.65 * bev;
      c = mixRGB(grout, c, 0.58 + 0.42 * bev);

      // butt joints between boards
      const de = Math.min(u - b.u0, b.u1 - u);
      const ej = smoothstep(0, endW, de);
      h *= 0.4 + 0.6 * ej;
      c = mixRGB(scaleRGB(grout, 0.85), c, 0.55 + 0.45 * ej);

      // satin poly: mostly smooth, slightly duller in the open pores
      let r = 0.20 + g.pore * 0.22 + fbmT(u01, v01, 12, 6, 3, 991) * 0.045;
      r = mix(0.62, r, bev * ej);
      setPx(s, i, c, h, clamp01(r));
    }
  }
  s.reliefFt = 0.00040;
  s.aoStrength = 0.35;
  s.aoRadius = 0.010;
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
function quartzField(size, TU, TV, seedBase, bookMatch, veinAmt) {
  const s = blank(size, [TU, TV]);
  const base = hexRGB('#f4f3f0');
  const warm = hexRGB('#efece5');
  const vein = hexRGB('#93999f');
  const veinSoft = hexRGB('#d5d7d7');

  for (let y = 0; y < size; y++) {
    const v01 = (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      let u01 = (x + 0.5) / size;
      if (bookMatch) u01 = u01 < 0.5 ? u01 * 2 : (1 - u01) * 2; // mirrored slab halves
      const i = y * size + x;

      // domain-warped ridged noise = branching marble veining.
      // The vein field is stretched diagonally so veins run in long sweeps
      // rather than isotropic blobs, exactly like a book-matched quartz slab.
      const w = warpT(u01, v01, 2, 3, 0.30, seedBase + 3);
      const du = w[0] * 0.55 + w[1] * 0.30;
      const dv = w[1] * 1.00 - w[0] * 0.12;
      const primary = ridgedT(du, dv, 2, 3, 5, seedBase, 0.58);
      const secondary = ridgedT(du * 1.0, dv * 1.0, 4, 7, 4, seedBase + 101, 0.5);

      const vMain = smoothstep(0.795, 0.965, primary);
      const vHalo = smoothstep(0.52, 0.88, primary) * 0.62;
      const vFine = smoothstep(0.80, 0.985, secondary) * 0.70;

      let c = mixRGB(base, warm, 0.5 + 0.5 * fbmT(u01, v01, 2, 2, 3, seedBase + 77));
      c = mixRGB(c, veinSoft, clamp01((vHalo * 0.55 + vFine * 0.45) * veinAmt));
      c = mixRGB(c, vein, clamp01(vMain * veinAmt));
      // very fine crystalline speckle
      const sp = fbmT(u01, v01, 300, 300, 2, seedBase + 55);
      c = scaleRGB(c, 1 + sp * 0.022);

      // polished: veins are a touch less glossy than the field
      const r = 0.055 + vMain * 0.045 + Math.max(0, sp) * 0.02;
      const h = 0.5 + vMain * 0.06 - vFine * 0.02;
      setPx(s, i, c, h, r);
    }
  }
  s.reliefFt = 0.00045;
  s.aoStrength = 0.35;
  return s;
}

function genQuartzWhite(size) {
  const s = quartzField(size, 6, 6, 4211, false, 1.0);
  return s;
}

/** Continuous book-matched slab for the full-height backsplash. */
function genQuartzSlabBacksplash(size) {
  const s = quartzField(size, 10, 7, 9137, true, 1.25);
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
 * Primary bath: 12"x24" metallic bronze/brown large-format porcelain
 * (oxidised-iron look) laid in half bond.  Tile = 4 ft x 4 ft.
 */
function genBronzePorcelain(size) {
  const TW = 2.0, TH = 1.0;    // 24" x 12"
  const TU = 4.0, TV = 4.0;
  const s = blank(size, [TU, TV]);
  const grout = hexRGB('#57483c');
  const GW = 0.007;            // 1/16" rectified joint

  const dark = hexRGB('#382c25');
  const mid = hexRGB('#6b5240');
  const warm = hexRGB('#8a6b4d');
  const copper = hexRGB('#a58260');
  const steel = hexRGB('#565049');
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
        const g = fbmT(u01, v01, 120, 120, 2, 55);
        const e = smoothstep(0, GW, L.edgeFt);
        const c = scaleRGB(grout, 0.9 + g * 0.16);
        setPx(s, i, c, 0.06 + e * 0.10, clamp01(0.80 + g * 0.06));
        continue;
      }
      // per-tile variation: rotate the sampling phase so no two tiles match
      const tk = ihash(L.i, L.j, 8821);
      const ph = (tk & 1023) / 1024;
      const flip = (tk >>> 12) & 1;
      let su = L.lu, sv = L.lv;
      if (flip) { su = 1 - su; }
      const nu = (su * 0.5 + ph) % 1;
      const nv = (sv * 0.25 + ((tk >>> 20) & 255) / 256) % 1;

      const w = warpT(nu, nv, 3, 3, 0.16, 991);
      const cloud = fbmT(w[0], w[1], 3, 3, 5, 991) * 0.5 + 0.5;
      const cloud2 = fbmT(w[0], w[1], 9, 9, 4, 1223) * 0.5 + 0.5;
      const rust = ridgedT(w[0], w[1], 5, 5, 4, 1451, 0.55);

      let c = mixRGB(dark, mid, smoothstep(0.25, 0.75, cloud));
      c = mixRGB(c, warm, smoothstep(0.45, 0.95, cloud2) * 0.75);
      c = mixRGB(c, copper, smoothstep(0.82, 0.99, rust) * 0.45);
      c = mixRGB(c, steel, smoothstep(0.15, 0.0, cloud) * 0.5);
      // whole-tile lightness lottery
      c = scaleRGB(c, 0.86 + ((tk >>> 4) & 255) / 255 * 0.30);
      // fine crystalline sparkle
      const sp = fbmT(u01, v01, 400, 400, 2, 77);
      c = scaleRGB(c, 1 + sp * 0.05);

      // glazed but mottled gloss — the signature of this tile
      const r = clamp01(0.16 + (1 - smoothstep(0.3, 0.9, cloud2)) * 0.30 + rust * 0.14 + sp * 0.03);
      const h = 0.55 + (cloud2 - 0.5) * 0.10 + sp * 0.05;
      setPx(s, i, c, h, r);
      s.met[i] = clamp01(0.10 + smoothstep(0.6, 1.0, rust) * 0.35);
    }
  }
  s.reliefFt = 0.006;
  s.aoStrength = 2.2;
  s.aoRadius = 0.016;
  return s;
}

/** Primary bath FLOOR: same family, lighter tan-brown, 13" square. */
function genBronzePorcelainFloor(size) {
  const TW = 13 / 12, TH = 13 / 12;
  const TU = TW * 4, TV = TH * 4;
  const s = blank(size, [TU, TV]);
  const grout = hexRGB('#b6a189');
  const GW = 0.014;
  const dark = hexRGB('#6d5949');
  const mid = hexRGB('#8f7c68');
  const light = hexRGB('#ab9a86');

  for (let y = 0; y < size; y++) {
    const v01 = (y + 0.5) / size;
    const v = v01 * TV;
    for (let x = 0; x < size; x++) {
      const u01 = (x + 0.5) / size;
      const u = u01 * TU;
      const i = y * size + x;
      const L = lattice(u, v, TW, TH, 0);
      if (L.edgeFt < GW) {
        const g = fbmT(u01, v01, 120, 120, 2, 33);
        const e = smoothstep(0, GW, L.edgeFt);
        setPx(s, i, scaleRGB(grout, 0.94 + g * 0.12), 0.10 + e * 0.15, clamp01(0.85 + g * 0.05));
        continue;
      }
      const tk = ihash(L.i, L.j, 5533);
      const ph = (tk & 1023) / 1024;
      const rot = (tk >>> 11) & 3;
      let su = L.lu, sv = L.lv;
      if (rot & 1) { const t = su; su = sv; sv = t; }
      if (rot & 2) { su = 1 - su; }
      const nu = (su * 0.28 + ph) % 1;
      const nv = (sv * 0.28 + ((tk >>> 19) & 255) / 256) % 1;

      const w = warpT(nu, nv, 4, 4, 0.13, 707);
      const cloud = fbmT(w[0], w[1], 4, 4, 5, 707) * 0.5 + 0.5;
      const mottle = fbmT(w[0], w[1], 14, 14, 4, 909) * 0.5 + 0.5;
      let c = mixRGB(dark, mid, smoothstep(0.2, 0.8, cloud));
      c = mixRGB(c, light, smoothstep(0.5, 0.95, mottle) * 0.7);
      c = scaleRGB(c, 0.92 + ((tk >>> 3) & 255) / 255 * 0.17);
      const sp = fbmT(u01, v01, 380, 380, 2, 121);
      c = scaleRGB(c, 1 + sp * 0.04);
      const r = clamp01(0.30 + (1 - mottle) * 0.16 + sp * 0.03);
      setPx(s, i, c, 0.6 + (mottle - 0.5) * 0.08, r);
    }
  }
  s.reliefFt = 0.008;
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
/** Basement: tan berber loop pile. */
function genCarpetTan(size) {
  const TU = 1.0, TV = 1.0;
  const s = blank(size, [TU, TV]);
  const base = hexRGB('#c9b598');
  const d2 = hexRGB('#9c8767');
  const lite = hexRGB('#e3d6bd');
  const LOOPS = 40; // ~0.3" berber loop pitch
  for (let y = 0; y < size; y++) {
    const v01 = (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      const u01 = (x + 0.5) / size;
      const i = y * size + x;
      // loop grid, jittered
      const w = worleyT(u01, v01, LOOPS, Math.round(LOOPS * 0.86), 1234, 0.9);
      const loop = 1 - smoothstep(0.02, 0.42, w.f1);
      // alternating row height (berber has paired loops)
      const rowMod = ((w.id >>> 5) & 3) === 0 ? 0.6 : 1.0;
      // large cloudy shading from pile direction
      const cloud = fbmT(u01, v01, 2, 2, 3, 4242) * 0.5 + 0.5;
      const fiber = fbmT(u01, v01, 150, 70, 2, 88);
      let c = mixRGB(d2, base, smoothstep(-0.15, 1.15, cloud));
      c = mixRGB(c, lite, loop * 0.46 * rowMod);
      c = scaleRGB(c, 1 + fiber * 0.09);
      c = scaleRGB(c, 0.84 + loop * 0.30);
      const h = loop * rowMod * 0.9 + fiber * 0.1;
      setPx(s, i, c, clamp01(h), clamp01(0.86 - loop * 0.10 + fiber * 0.03));
    }
  }
  s.reliefFt = 0.008;
  s.aoStrength = 2.6;
  s.aoRadius = 0.02;
  return s;
}

/** Bedrooms: soft beige cut pile with vacuum shading. */
function genCarpetBeige(size) {
  const TU = 1.5, TV = 1.5;
  const s = blank(size, [TU, TV]);
  const base = hexRGB('#ded0ba');
  const dark = hexRGB('#c3b299');
  const lite = hexRGB('#ece1cd');
  // build a fiber field then streak it so tufts read as directional
  const n = size * size;
  const f = new Float32Array(n);
  for (let y = 0; y < size; y++) {
    const v01 = (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      const u01 = (x + 0.5) / size;
      f[y * size + x] = fbmT(u01, v01, 105, 58, 3, 6767, 0.62) * 0.5 + 0.5;
    }
  }
  const streaked = streak(f, size, Math.max(1, Math.round(size * 0.004)), 0);
  for (let y = 0; y < size; y++) {
    const v01 = (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      const u01 = (x + 0.5) / size;
      const i = y * size + x;
      const tuft = streaked[i];
      const cloud = fbmT(u01, v01, 2, 2, 4, 8181) * 0.5 + 0.5;
      const nap = fbmT(u01, v01, 5, 7, 3, 9191) * 0.5 + 0.5;
      const tick = fbmT(u01, v01, 140, 74, 2, 9292) * 0.5 + 0.5;
      // discrete tuft tips: a jittered grid of yarn ends catching the light
      const tuftCell = worleyT(u01, v01, 96, 78, 9393, 0.95);
      const tip = 1 - smoothstep(0.05, 0.46, tuftCell.f1);
      let c = mixRGB(dark, base, smoothstep(0.15, 0.95, cloud));
      c = mixRGB(c, lite, smoothstep(0.4, 0.9, nap) * 0.45);
      c = scaleRGB(c, 0.76 + tuft * 0.42);
      c = scaleRGB(c, 0.93 + tick * 0.14);
      c = scaleRGB(c, 0.90 + tip * 0.24 * (0.5 + 0.5 * ((tuftCell.id >>> 9) & 1)));
      const h = tip * 0.55 + tuft * 0.30 + tick * 0.12 + cloud * 0.03;
      setPx(s, i, c, clamp01(h), clamp01(0.90 - tuft * 0.06));
    }
  }
  s.reliefFt = 0.012;
  s.aoStrength = 3.0;
  s.aoRadius = 0.02;
  return s;
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
/** 8" exposure weathered gray cedar lap siding.  Tile = 4 ft x 4 courses. */
function genGrayLapSiding(size) {
  const EXP = 8 / 12;
  const courses = 4;
  const TU = 4.0, TV = EXP * courses;
  const s = blank(size, [TU, TV]);
  const rng = mulberry32(0x51d1);
  const tones = [hexRGB('#7b7d76'), hexRGB('#73756e'), hexRGB('#82847c'), hexRGB('#6c6e68')];
  const rowTone = [];
  for (let i = 0; i < courses; i++) rowTone.push({ c: tones[(rng() * 4) | 0], k: 0.94 + rng() * 0.12, seed: (rng() * 1e5) | 0 });

  for (let y = 0; y < size; y++) {
    const v01 = (y + 0.5) / size;
    const v = v01 * TV;
    const row = Math.min(courses - 1, Math.floor(v / EXP));
    const t = (v - row * EXP) / EXP;   // 0 at top of the course, 1 at its butt
    const rt = rowTone[row];
    for (let x = 0; x < size; x++) {
      const u01 = (x + 0.5) / size;
      const i = y * size + x;
      // rough-sawn cedar: horizontal grain + weathering streaks
      const grain = fbmT(u01, v01, 9, 150, 3, rt.seed);
      const saw = fbmT(u01, v01, 5, 190, 2, rt.seed + 13);
      const weather = fbmT(u01, v01, 90, 5, 3, 4141);
      let c = scaleRGB(rt.c, rt.k * (1 + grain * 0.085 + saw * 0.04));
      c = scaleRGB(c, 1 + weather * 0.06);
      c = mixRGB(c, [0.42, 0.43, 0.41], smoothstep(0.55, 1.0, weather) * 0.18);

      // board profile: thin at the top, thick at the butt, deep shadow below
      let h = 0.25 + 0.75 * t;
      let shade = 1;
      if (t < 0.14) {                     // shadow cast by the course above
        const k = 1 - t / 0.14;
        shade = 1 - k * k * 0.72;
        h = mix(0.0, h, 1 - k * 0.95);
      }
      // occasional vertical butt joint between siding boards
      const bj = Math.abs(((u01 + row * 0.37) % 1) - 0.5);
      if (bj > 0.4988) { shade *= 0.75; h *= 0.55; }
      c = scaleRGB(c, shade);
      const r = clamp01(0.68 + grain * 0.08 + weather * 0.05);
      setPx(s, i, c, clamp01(h), r);
    }
  }
  s.reliefFt = 0.05;
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
  const jointC = hexRGB('#8a877e');
  const tones = [
    hexRGB('#7e8184'), hexRGB('#848789'), hexRGB('#787c80'), hexRGB('#888a89'),
    hexRGB('#7b7f82'), hexRGB('#818385'), hexRGB('#868884'),
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
      const jw = 0.026;
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
/** Fescue/bluegrass lawn with 4 ft mower stripes running along +U. */
function genLawnGrass(size) {
  const TU = 8.0, TV = 8.0;
  const s = blank(size, [TU, TV]);
  const dark = hexRGB('#37502b');
  const mid = hexRGB('#4a6f36');
  const lite = hexRGB('#658a45');
  const dry = hexRGB('#8a8f55');
  for (let y = 0; y < size; y++) {
    const v01 = (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      const u01 = (x + 0.5) / size;
      const i = y * size + x;
      // blades: two crossed anisotropic fields
      // warp the blade field so the fibres wander instead of forming a weave
      const wb = warpT(u01, v01, 10, 10, 0.020, 1011);
      const b1 = fbmT(wb[0], wb[1], 30, 150, 2, 1010);
      const bl = worleyT(wb[0], wb[1], 130, 44, 2020, 1);
      const b2 = (1 - smoothstep(0.05, 0.6, bl.f1)) * 2 - 1;
      const clump = fbmT(u01, v01, 14, 14, 3, 3030);
      const patch = fbmT(u01, v01, 3, 3, 3, 4040);
      // mower stripes: 2 stripes per 8 ft tile => 4 ft each, soft edges
      const stripePhase = v01 * 2;
      const sq = Math.sin(stripePhase * Math.PI * 2);
      const stripe = smoothstep(-0.55, 0.55, sq);
      let c = mixRGB(dark, mid, smoothstep(-0.75, 0.85, clump));
      c = mixRGB(c, lite, smoothstep(-0.15, 0.75, b1) * 0.62);
      c = mixRGB(c, dry, smoothstep(0.45, 1.0, patch) * 0.22);
      // laid-over blades reflect more light in one stripe
      c = scaleRGB(c, mix(0.80, 1.18, stripe));
      c = scaleRGB(c, 1 + b2 * 0.12);
      const h = 0.5 + b1 * 0.3 + b2 * 0.2 + clump * 0.2;
      setPx(s, i, c, clamp01(h), clamp01(0.78 - stripe * 0.10 + clump * 0.05));
    }
  }
  s.reliefFt = 0.012;
  s.aoStrength = 1.4;
  return s;
}

/* ------------------------------------------------------------- mulch bed */
function genMulchBed(size) {
  const TU = 3.0, TV = 3.0;
  const s = blank(size, [TU, TV]);
  const tones = [
    hexRGB('#2b2119'), hexRGB('#3a2c20'), hexRGB('#241c15'), hexRGB('#493829'),
    hexRGB('#312519'), hexRGB('#54402d'),
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
  const base = hexRGB('#b7b5b0');
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
  redOakFloor: { hero: true, gen: genRedOakFloor, scaleFeet: [6, 2.25], note: '2.25" red oak strip, satin poly. Grain runs along +U.' },
  lightPlankFloor: { hero: false, gen: genLightPlankFloor, scaleFeet: [6, 7 / 12 * 4], note: '7" gray-beige LVP plank, matte. Grain along +U.' },
  carpetTan: { hero: false, gen: genCarpetTan, scaleFeet: [1, 1], note: 'Basement tan berber loop.' },
  carpetBeige: { hero: false, gen: genCarpetBeige, scaleFeet: [1.5, 1.5], note: 'Bedroom beige cut pile.' },
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
  grayLapSiding: { hero: false, gen: genGrayLapSiding, scaleFeet: [4, 8 / 12 * 4], note: 'Weathered gray cedar lap siding, 8" exposure.' },
  asphaltShingle: { hero: false, gen: genAsphaltShingle, scaleFeet: [3, 5.5 / 12 * 4], note: 'Charcoal architectural shingle, 5.5" exposure.' },
  lawnGrass: { hero: false, gen: genLawnGrass, scaleFeet: [8, 8], note: 'Lawn with 4 ft mower stripes running along +U.' },
  mulchBed: { hero: false, gen: genMulchBed, scaleFeet: [3, 3], note: 'Dark shredded hardwood mulch.' },

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
