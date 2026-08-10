/**
 * materials.js — named PBR material library for 1430 Country Ln.
 *
 * Everything here is built on the procedural maps from textures.js.  The maps
 * carry the *absolute* roughness / metalness values, so `material.roughness`
 * and `material.metalness` stay at 1.0 wherever a map is present (three
 * multiplies scalar x map).  Where a value is genuinely uniform we skip the map
 * and use the scalar.
 *
 * Physical intent, per material family:
 *   - site-finished floors, painted casework, quartz  -> clearcoat film
 *   - carpet, linen, velvet                           -> sheen
 *   - glazing                                         -> transmission + ior
 *   - metals                                          -> metalnessMap = 1
 *
 * Usage
 * -----
 *   import { makeMaterials, applyUV } from './materials.js';
 *   const mat = makeMaterials(THREE, { quality: 'high' });
 *   const floor = new THREE.Mesh(geo, mat.redOakFloor);
 *   applyUV(floor);                     // real-world tiling from world size
 *   applyUV(wall, 4);                   // or force 4 ft per repeat
 *
 * `applyUV` never mutates the shared library material: it swaps in a cached
 * clone whose textures carry the right `repeat`/`offset`.
 */

import { makeTextures, TEXTURE_INFO, TEXTURE_NAMES } from './textures.js';

/* ======================================================================== */
/* Helpers                                                                   */
/* ======================================================================== */

const MAP_KEYS = ['map', 'normalMap', 'roughnessMap', 'aoMap', 'metalnessMap', 'anisotropyMap', 'alphaMap'];

/**
 * Attach a texture set to a material description and remember the real-world
 * scale so applyUV() can compute repeats later.
 */
function withMaps(THREE, mat, set, opts = {}) {
  mat.map = set.map;
  mat.normalMap = set.normalMap;
  mat.normalScale = new THREE.Vector2(
    opts.normalScale === undefined ? 1 : opts.normalScale,
    opts.normalScale === undefined ? 1 : opts.normalScale
  );
  if (opts.roughnessMap !== false) {
    mat.roughnessMap = set.roughnessMap;
    mat.roughness = opts.roughness === undefined ? 1.0 : opts.roughness;
  }
  if (opts.aoMap !== false) {
    mat.aoMap = set.aoMap;
    mat.aoMapIntensity = opts.aoMapIntensity === undefined ? 1.0 : opts.aoMapIntensity;
  }
  if (set.metalnessMap && opts.metalnessMap !== false) {
    mat.metalnessMap = set.metalnessMap;
    mat.metalness = opts.metalness === undefined ? 1.0 : opts.metalness;
  }
  // KHR_materials_anisotropy: the map's B channel scales `mat.anisotropy`, so
  // the scalar must be non-zero for three to compile USE_ANISOTROPY at all.
  if (set.anisotropyMap && opts.anisotropy !== false) {
    mat.anisotropyMap = set.anisotropyMap;
    mat.anisotropy = opts.anisotropy === undefined ? 1.0 : opts.anisotropy;
    mat.anisotropyRotation = opts.anisotropyRotation || 0;
  }
  if (set.alphaMap && opts.alphaMap !== false) {
    mat.alphaMap = set.alphaMap;
    mat.alphaTest = opts.alphaTest === undefined ? 0.45 : opts.alphaTest;
  }
  mat.userData.scaleFeet = set.scaleFeet.slice();
  mat.userData.textureName = set.name;
  mat.userData.clampSlab = !!set.clamp;
  return mat;
}

/** MeshPhysicalMaterial with the house-wide defaults already applied. */
function phys(THREE, params) {
  const m = new THREE.MeshPhysicalMaterial(
    Object.assign({ envMapIntensity: 1.0 }, params)
  );
  return m;
}

/* ======================================================================== */
/* Library                                                                   */
/* ======================================================================== */

/**
 * @param {object} THREE  the three namespace
 * @param {object} [opts] { quality: 'high'|'medium'|'draft'|'thumb' }
 * @returns {Readonly<Object>} frozen map of name -> Material
 */
export function makeMaterials(THREE, opts = {}) {
  const quality = opts.quality === 'draft' ? 'draft' : opts.quality || 'high';
  const tex = makeTextures({ quality });
  const T = (n) => tex.get(n);

  /* ----------------------------------------------------------------------
   * LAZY BY CONSTRUCTION.
   *
   * Every material below is registered as a THUNK, not built here.  Building
   * all 42 eagerly forces textures.js to generate all 42 procedural map sets,
   * which is ~217 s of pure JS at quality:'high' (measured under SwiftShader) —
   * longer than the screenshot harness's whole timeout, for a room that may
   * touch six of them.  A getter builds one material the first time something
   * reads it, and caches it forever.
   *
   * Consequences a caller must know about:
   *   - `Object.keys(M)` is cheap and complete; `Object.values(M)` is NOT —
   *     it builds the entire library.  Never enumerate values to "collect"
   *     materials; every library material carries `userData.keep = true`
   *     instead, so scene teardown can recognise a shared material without
   *     touching one that was never built.
   *   - `M.dispose()` only disposes what was actually built.
   * -------------------------------------------------------------------- */
  const M = {};
  const BUILT = new Map();
  const THUNKS = new Map();

  function def(name, make) {
    THUNKS.set(name, make);
    Object.defineProperty(M, name, {
      enumerable: true,
      configurable: false,
      get() {
        let m = BUILT.get(name);
        if (m) return m;
        m = make();
        m.name = name;
        if (!m.userData.scaleFeet) m.userData.scaleFeet = [1, 1];
        // Shared library material: scene teardown must never dispose it.
        m.userData.keep = true;
        BUILT.set(name, m);
        return m;
      },
    });
  }

  /* ------------------------------------------------------------ floors */

  // Site-finished red oak: satin polyurethane film over open-pore oak.
  // The satin sheen is ANISOTROPIC — the film's micro-grooves run with the
  // boards, so the window highlight smears into a long streak down the strips
  // instead of blooming into a round hotspot.  That streak is one of the most
  // recognisable things about a real site-finished floor.
  def('redOakFloor', () => withMaps(THREE, phys(THREE, {
    color: 0xffffff,
    metalness: 0.0,
    clearcoat: 0.48,
    clearcoatRoughness: 0.28,
    envMapIntensity: 0.70,
    sheen: 0.0,
  }), T('redOakFloor'), {
    normalScale: 1.0, aoMapIntensity: 0.7,
    anisotropy: 0.85, anisotropyRotation: 0,
  }));

  def('lightPlankFloor', () => withMaps(THREE, phys(THREE, {
    metalness: 0.0,
    clearcoat: 0.25,
    clearcoatRoughness: 0.45,
    envMapIntensity: 0.7,
  }), T('lightPlankFloor'), { normalScale: 1.0, aoMapIntensity: 0.9 }));

  // Cut pile (primary bedroom).  The nap is a directional microstructure, so
  // it gets sheen AND anisotropy: the pile leans one way, and the bands that
  // lean toward the camera go pale while the ones leaning away go dark.  That
  // view dependence is the whole reason vacuum tracks are visible at all.
  def('carpetTan', () => withMaps(THREE, phys(THREE, {
    metalness: 0.0,
    sheen: 0.75,
    sheenRoughness: 0.85,
    sheenColor: new THREE.Color(0xe4dbcd),
    envMapIntensity: 0.5,
  }), T('carpetTan'), {
    normalScale: 1.0, aoMapIntensity: 0.9,
    anisotropy: 1.0, anisotropyRotation: 0,
  }));

  // Loop pile (basement / secondary bedrooms): denser, flatter, less sheen.
  def('carpetBeige', () => withMaps(THREE, phys(THREE, {
    metalness: 0.0,
    sheen: 0.55,
    sheenRoughness: 0.9,
    sheenColor: new THREE.Color(0xded0b9),
    envMapIntensity: 0.45,
  }), T('carpetBeige'), {
    normalScale: 0.9, aoMapIntensity: 0.95,
    anisotropy: 1.0, anisotropyRotation: 0,
  }));

  def('rubberGymFloor', () => withMaps(THREE, phys(THREE, {
    metalness: 0.0,
    clearcoat: 0.10,
    clearcoatRoughness: 0.7,
    envMapIntensity: 0.6,
  }), T('rubberGymFloor'), { normalScale: 0.8 }));

  def('compositeDeck', () => withMaps(THREE, phys(THREE, {
    metalness: 0.0,
    clearcoat: 0.12,
    clearcoatRoughness: 0.65,
    envMapIntensity: 0.9,
  }), T('compositeDeck'), { normalScale: 1.0, aoMapIntensity: 1.0 }));

  def('sunroomDeckSlat', () => withMaps(THREE, phys(THREE, {
    metalness: 0.0,
    clearcoat: 0.18,
    clearcoatRoughness: 0.5,
    envMapIntensity: 0.8,
  }), T('sunroomDeckSlat'), { normalScale: 1.0, aoMapIntensity: 1.0 }));

  /* -------------------------------------------------------- stone & tile */

  // Polished quartz: hard, near-mirror film over a low-scatter body.
  def('quartzWhite', () => withMaps(THREE, phys(THREE, {
    metalness: 0.0,
    clearcoat: 0.85,
    clearcoatRoughness: 0.045,
    reflectivity: 0.6,
    envMapIntensity: 1.15,
  }), T('quartzWhite'), { normalScale: 0.35, aoMapIntensity: 0.35 }));

  def('quartzSlabBacksplash', () => withMaps(THREE, phys(THREE, {
    metalness: 0.0,
    clearcoat: 0.8,
    clearcoatRoughness: 0.06,
    reflectivity: 0.58,
    envMapIntensity: 1.05,
  }), T('quartzSlabBacksplash'), { normalScale: 0.3, aoMapIntensity: 0.3 }));

  def('blackGranite', () => withMaps(THREE, phys(THREE, {
    metalness: 0.0,
    clearcoat: 0.95,
    clearcoatRoughness: 0.035,
    reflectivity: 0.65,
    envMapIntensity: 1.3,
  }), T('blackGranite'), { normalScale: 0.3, aoMapIntensity: 0.3 }));

  // Metallic-look glazed porcelain: a glassy clearcoat over a partly
  // conductive body, which is what gives the tub its clear reflection in
  // `master_bedroom_bathroom_view_1`.
  def('bronzePorcelain', () => withMaps(THREE, phys(THREE, {
    clearcoat: 0.85,
    clearcoatRoughness: 0.10,
    reflectivity: 0.6,
    envMapIntensity: 1.25,
  }), T('bronzePorcelain'), { normalScale: 0.8, aoMapIntensity: 1.0 }));

  // The floor is a DIFFERENT product: matt-glazed, warm, barely reflective.
  def('bronzePorcelainFloor', () => withMaps(THREE, phys(THREE, {
    metalness: 0.0,
    clearcoat: 0.30,
    clearcoatRoughness: 0.34,
    envMapIntensity: 0.9,
  }), T('bronzePorcelainFloor'), { normalScale: 1.0, aoMapIntensity: 1.0 }));

  def('marbleLookTile', () => withMaps(THREE, phys(THREE, {
    metalness: 0.0,
    clearcoat: 0.5,
    clearcoatRoughness: 0.22,
    envMapIntensity: 1.0,
  }), T('marbleLookTile'), { normalScale: 1.0, aoMapIntensity: 1.0 }));

  def('mosaicAccent', () => withMaps(THREE, phys(THREE, {
    metalness: 0.0,
    clearcoat: 0.55,
    clearcoatRoughness: 0.2,
    envMapIntensity: 1.0,
  }), T('mosaicAccent'), { normalScale: 1.0, aoMapIntensity: 1.1 }));

  def('bluestone', () => withMaps(THREE, phys(THREE, {
    metalness: 0.0,
    envMapIntensity: 0.8,
  }), T('bluestone'), { normalScale: 1.0, aoMapIntensity: 1.0 }));

  def('stackedLimestone', () => withMaps(THREE, phys(THREE, {
    metalness: 0.0,
    envMapIntensity: 0.75,
  }), T('stackedLimestone'), { normalScale: 1.0, aoMapIntensity: 1.15 }));

  def('concreteDriveway', () => withMaps(THREE, phys(THREE, {
    metalness: 0.0,
    envMapIntensity: 0.8,
  }), T('concreteDriveway'), { normalScale: 0.8 }));

  /* ---------------------------------------------------------------- wood */

  def('cherryCabinet', () => withMaps(THREE, phys(THREE, {
    metalness: 0.0,
    clearcoat: 0.5,
    clearcoatRoughness: 0.24,
    envMapIntensity: 0.85,
  }), T('cherryCabinet'), { normalScale: 0.9 }));

  def('cherryCabinetDark', () => withMaps(THREE, phys(THREE, {
    metalness: 0.0,
    clearcoat: 0.40,
    clearcoatRoughness: 0.28,
    envMapIntensity: 0.85,
  }), T('cherryCabinetDark'), { normalScale: 0.9 }));

  def('butcherBlock', () => withMaps(THREE, phys(THREE, {
    metalness: 0.0,
    clearcoat: 0.35,
    clearcoatRoughness: 0.3,
    envMapIntensity: 0.8,
  }), T('butcherBlock'), { normalScale: 0.9 }));

  def('woodSlatWall', () => withMaps(THREE, phys(THREE, {
    metalness: 0.0,
    clearcoat: 0.3,
    clearcoatRoughness: 0.35,
    envMapIntensity: 0.8,
  }), T('woodSlatWall'), { normalScale: 1.0, aoMapIntensity: 1.25 }));

  def('blackBacker', () => withMaps(THREE, phys(THREE, {
    metalness: 0.0,
    envMapIntensity: 0.25,
  }), T('blackBacker'), { normalScale: 0.6 }));

  /* --------------------------------------------------------------- paint */

  def('paintedOffWhite', () => withMaps(THREE, phys(THREE, {
    metalness: 0.0,
    clearcoat: 0.35,
    clearcoatRoughness: 0.3,
    envMapIntensity: 0.8,
  }), T('paintedOffWhite'), { normalScale: 0.7 }));

  def('paintedSlateBlue', () => withMaps(THREE, phys(THREE, {
    metalness: 0.0,
    clearcoat: 0.35,
    clearcoatRoughness: 0.3,
    envMapIntensity: 0.8,
  }), T('paintedSlateBlue'), { normalScale: 0.7 }));

  def('paintedGreige', () => withMaps(THREE, phys(THREE, {
    metalness: 0.0,
    clearcoat: 0.32,
    clearcoatRoughness: 0.32,
    envMapIntensity: 0.8,
  }), T('paintedGreige'), { normalScale: 0.7 }));

  def('wallPaintWhite', () => withMaps(THREE, phys(THREE, {
    metalness: 0.0,
    envMapIntensity: 0.7,
  }), T('wallPaintWhite'), { normalScale: 0.45, aoMapIntensity: 0.5 }));

  def('wallPaintWarmWhite', () => withMaps(THREE, phys(THREE, {
    metalness: 0.0,
    envMapIntensity: 0.7,
  }), T('wallPaintWarmWhite'), { normalScale: 0.45, aoMapIntensity: 0.5 }));

  def('ceilingPaint', () => withMaps(THREE, phys(THREE, {
    metalness: 0.0,
    envMapIntensity: 0.6,
  }), T('ceilingPaint'), { normalScale: 0.35, aoMapIntensity: 0.4 }));

  def('drywallCeilingKnockdown', () => withMaps(THREE, phys(THREE, {
    metalness: 0.0,
    envMapIntensity: 0.6,
  }), T('drywallCeilingKnockdown'), { normalScale: 0.9, aoMapIntensity: 0.8 }));

  def('blackMatte', () => withMaps(THREE, phys(THREE, {
    metalness: 0.15,
    envMapIntensity: 0.6,
  }), T('blackMatte'), { normalScale: 0.6 }));

  /* ------------------------------------------------------------ exterior */

  def('grayLapSiding', () => withMaps(THREE, phys(THREE, {
    metalness: 0.0,
    envMapIntensity: 1.0,
  }), T('grayLapSiding'), { normalScale: 1.0, aoMapIntensity: 1.1 }));

  def('asphaltShingle', () => withMaps(THREE, phys(THREE, {
    metalness: 0.0,
    envMapIntensity: 0.85,
  }), T('asphaltShingle'), { normalScale: 1.0, aoMapIntensity: 1.1 }));

  // The mower stripes live in the texture's macroscopic tilt, so the normal
  // map must be applied at full strength or the stripes flatten out.
  def('lawnGrass', () => withMaps(THREE, phys(THREE, {
    metalness: 0.0,
    sheen: 0.45,
    sheenRoughness: 0.75,
    sheenColor: new THREE.Color(0xb7c98a),
    envMapIntensity: 0.95,
  }), T('lawnGrass'), { normalScale: 1.0, aoMapIntensity: 0.8 }));

  def('mulchBed', () => withMaps(THREE, phys(THREE, {
    metalness: 0.0,
    envMapIntensity: 0.7,
  }), T('mulchBed'), { normalScale: 1.0, aoMapIntensity: 1.2 }));

  def('treeBark', () => withMaps(THREE, phys(THREE, {
    metalness: 0.0,
    envMapIntensity: 0.7,
  }), T('treeBark'), { normalScale: 1.0, aoMapIntensity: 1.15 }));

  /* ------------------------------------------------------------- foliage */
  // Alpha-tested leaf sheets. DoubleSide because a card is seen from both
  // faces inside a canopy; `alphaTest` (not `transparent`) so they sort
  // correctly against each other AND cast a real perforated shadow.
  const leafCard = (name, o = {}) => def(name, () => {
    const m = withMaps(THREE, phys(THREE, {
      metalness: 0.0,
      envMapIntensity: 0.85,
      // Leaves are thin and translucent: the sun coming through the far side
      // of the canopy is most of what a real tree looks like.
      sheen: 0.55,
      sheenRoughness: 0.75,
      sheenColor: new THREE.Color(o.sheenColor || 0xc4d98a),
      transmission: 0,
      side: THREE.DoubleSide,
    }), T(name), { normalScale: o.normalScale === undefined ? 0.75 : o.normalScale, aoMapIntensity: 0.55, alphaTest: 0.42 });
    m.shadowSide = THREE.DoubleSide;
    return m;
  });
  leafCard('foliageBroadleaf');
  leafCard('foliageShrub', { sheenColor: 0xa8c079, normalScale: 0.6 });
  leafCard('foliageNeedle', { sheenColor: 0x6f8c4a, normalScale: 0.5 });

  /* ---------------------------------------------- metals / fabric / glass */

  def('stainlessBrushed', () => withMaps(THREE, phys(THREE, {
    color: 0xffffff,
    metalness: 1.0,
    envMapIntensity: 1.35,
  }), T('stainlessBrushed'), { normalScale: 0.55, aoMapIntensity: 0.3 }));

  def('brassBrushed', () => withMaps(THREE, phys(THREE, {
    color: 0xffffff,
    metalness: 1.0,
    envMapIntensity: 1.3,
  }), T('brassBrushed'), { normalScale: 0.5, aoMapIntensity: 0.3 }));

  def('fabricLinen', () => withMaps(THREE, phys(THREE, {
    metalness: 0.0,
    sheen: 0.8,
    sheenRoughness: 0.75,
    sheenColor: new THREE.Color(0xe6ddcd),
    envMapIntensity: 0.6,
  }), T('fabricLinen'), { normalScale: 1.0, aoMapIntensity: 1.0 }));

  def('fabricVelvet', () => withMaps(THREE, phys(THREE, {
    metalness: 0.0,
    sheen: 1.0,
    sheenRoughness: 0.35,
    sheenColor: new THREE.Color(0x9fb4c2),
    envMapIntensity: 0.6,
  }), T('fabricVelvet'), { normalScale: 0.5, aoMapIntensity: 0.7 }));

  def('leatherDark', () => withMaps(THREE, phys(THREE, {
    metalness: 0.0,
    clearcoat: 0.28,
    clearcoatRoughness: 0.5,
    sheen: 0.25,
    sheenRoughness: 0.6,
    envMapIntensity: 0.8,
  }), T('leatherDark'), { normalScale: 1.0, aoMapIntensity: 1.0 }));

  def('mirrorGlass', () => withMaps(THREE, phys(THREE, {
    color: 0xf6f8f8,
    metalness: 1.0,
    roughness: 0.02,
    envMapIntensity: 1.6,
  }), T('mirrorGlass'), { normalScale: 0.15, roughnessMap: false, aoMap: false }));

  def('frostedGlass', () => withMaps(THREE, phys(THREE, {
    color: 0xffffff,
    metalness: 0.0,
    transmission: 0.86,
    thickness: 0.03,
    ior: 1.5,
    envMapIntensity: 1.0,
    transparent: true,
  }), T('frostedGlass'), { normalScale: 0.35, aoMap: false }));

  def('clearGlass', () => {
    const _m = phys(THREE, {
    color: 0xffffff,
    metalness: 0.0,
    roughness: 0.03,
    transmission: 1.0,
    thickness: 0.02,
    ior: 1.52,
    specularIntensity: 1.0,
    envMapIntensity: 1.4,
    transparent: true,
    side: THREE.DoubleSide,
  });
    _m.userData.scaleFeet = [3, 3];
    _m.userData.textureName = 'clearGlass';
    return _m;
  });

  /* ------------------------------------------------------------ metadata */

  Object.defineProperty(M, '__textures', { value: tex, enumerable: false });
  Object.defineProperty(M, '__quality', { value: quality, enumerable: false });
  Object.defineProperty(M, '__names', { value: Object.freeze([...THUNKS.keys()]), enumerable: false });
  /** Names of the materials actually built so far — for diagnostics. */
  Object.defineProperty(M, '__built', { value: () => [...BUILT.keys()], enumerable: false });
  /** Force-build the whole library (contact sheets, cache warming). */
  Object.defineProperty(M, '__all', {
    value() {
      const out = {};
      for (const k of THUNKS.keys()) out[k] = M[k];
      return out;
    },
    enumerable: false,
  });
  Object.defineProperty(M, 'dispose', {
    value() {
      for (const m of BUILT.values()) m.dispose();
      BUILT.clear();
      for (const m of CLONE_CACHE.values()) m.dispose();
      CLONE_CACHE.clear();
      tex.dispose();
    },
    enumerable: false,
  });

  return Object.freeze(M);
}

/* ======================================================================== */
/* applyUV — real-world texture scaling                                      */
/* ======================================================================== */

const CLONE_CACHE = new Map();

function cloneWithRepeat(material, ru, rv, ou, ov, rot) {
  const key = `${material.uuid}|${ru.toFixed(4)}|${rv.toFixed(4)}|${ou.toFixed(4)}|${ov.toFixed(4)}|${rot.toFixed(3)}`;
  const hit = CLONE_CACHE.get(key);
  if (hit) return hit;
  const m = material.clone();
  m.userData = Object.assign({}, material.userData);
  for (const k of MAP_KEYS) {
    const t = material[k];
    if (!t) continue;
    const c = t.clone();          // shares the same image/source, cheap
    c.wrapS = t.wrapS;
    c.wrapT = t.wrapT;
    c.colorSpace = t.colorSpace;
    c.anisotropy = t.anisotropy;
    c.repeat.set(ru, rv);
    c.offset.set(ou, ov);
    c.center.set(0.5, 0.5);
    c.rotation = rot;
    c.needsUpdate = true;
    m[k] = c;
  }
  m.needsUpdate = true;
  CLONE_CACHE.set(key, m);
  return m;
}

/**
 * Set a mesh's texture repeat from its real-world size so every material tiles
 * at true scale (a 2.25" oak strip is always 2.25").
 *
 * @param {THREE.Mesh} mesh          mesh whose material came from makeMaterials
 * @param {number|number[]} [feetPerRepeat]
 *        Override the material's documented scale.  A number applies to both
 *        axes; `[u, v]` sets them separately.  Omit to use the texture's own
 *        real-world scale (the normal case).
 * @param {object} [opts]
 *        opts.offset  [u,v] UV offset in tile fractions (breaks repetition)
 *        opts.rotation  UV rotation in radians (e.g. rotate plank direction)
 *        opts.axes    force the mapping plane: 'xy' | 'xz' | 'zy'
 *        opts.size    [u,v] explicit world size in feet (skip bbox measurement)
 * @returns {THREE.Mesh} the same mesh (material may have been swapped)
 */
export function applyUV(mesh, feetPerRepeat, opts = {}) {
  if (!mesh || !mesh.material) return mesh;
  const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  const scaleFeet = (material.userData && material.userData.scaleFeet) || [1, 1];

  let fu, fv;
  if (feetPerRepeat === undefined || feetPerRepeat === null) {
    fu = scaleFeet[0]; fv = scaleFeet[1];
  } else if (Array.isArray(feetPerRepeat)) {
    fu = feetPerRepeat[0]; fv = feetPerRepeat[1];
  } else {
    fu = feetPerRepeat; fv = feetPerRepeat;
  }
  if (!(fu > 0)) fu = 1;
  if (!(fv > 0)) fv = 1;

  // Real-world size of the mesh face, in feet.
  let su, sv;
  if (opts.size) {
    su = opts.size[0]; sv = opts.size[1];
  } else {
    const geo = mesh.geometry;
    if (!geo) return mesh;
    if (!geo.boundingBox) geo.computeBoundingBox();
    const bb = geo.boundingBox;
    mesh.updateMatrixWorld(true);
    const s = mesh.getWorldScale ? mesh.getWorldScale(_scaleVec(mesh)) : { x: 1, y: 1, z: 1 };
    const dx = (bb.max.x - bb.min.x) * Math.abs(s.x);
    const dy = (bb.max.y - bb.min.y) * Math.abs(s.y);
    const dz = (bb.max.z - bb.min.z) * Math.abs(s.z);
    let axes = opts.axes;
    if (!axes) {
      // the thinnest axis is the surface normal
      const m = Math.min(dx, dy, dz);
      axes = m === dy ? 'xz' : m === dz ? 'xy' : 'zy';
    }
    if (axes === 'xz') { su = dx; sv = dz; }
    else if (axes === 'xy') { su = dx; sv = dy; }
    else { su = dz; sv = dy; }
  }
  if (!(su > 0)) su = fu;
  if (!(sv > 0)) sv = fv;

  // A clamped slab (book-matched backsplash) must map 0..1 across the surface.
  const clampSlab = material.userData && material.userData.clampSlab;
  const ru = clampSlab ? 1 : su / fu;
  const rv = clampSlab ? 1 : sv / fv;

  const off = opts.offset || [0, 0];
  const rot = opts.rotation || 0;
  const next = cloneWithRepeat(material, ru, rv, off[0], off[1], rot);
  if (Array.isArray(mesh.material)) mesh.material[0] = next;
  else mesh.material = next;
  mesh.userData.uvRepeat = [ru, rv];
  return mesh;
}

let _sv = null;
function _scaleVec(mesh) {
  if (!_sv) {
    const c = mesh.scale.constructor;   // THREE.Vector3 without importing three
    _sv = new c();
  }
  return _sv;
}

/** Discard every applyUV clone (call on scene teardown). */
export function clearUVClones() {
  for (const m of CLONE_CACHE.values()) m.dispose();
  CLONE_CACHE.clear();
}

export { TEXTURE_INFO, TEXTURE_NAMES };
export default makeMaterials;
