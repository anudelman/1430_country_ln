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

const MAP_KEYS = ['map', 'normalMap', 'roughnessMap', 'aoMap', 'metalnessMap'];

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
  const M = {};

  /* ------------------------------------------------------------ floors */

  // Site-finished red oak: satin polyurethane film over open-pore oak.
  M.redOakFloor = withMaps(THREE, phys(THREE, {
    color: 0xffffff,
    metalness: 0.0,
    clearcoat: 0.62,
    clearcoatRoughness: 0.22,
    envMapIntensity: 0.85,
    sheen: 0.0,
  }), T('redOakFloor'), { normalScale: 1.0, aoMapIntensity: 0.85 });

  M.lightPlankFloor = withMaps(THREE, phys(THREE, {
    metalness: 0.0,
    clearcoat: 0.25,
    clearcoatRoughness: 0.45,
    envMapIntensity: 0.7,
  }), T('lightPlankFloor'), { normalScale: 1.0, aoMapIntensity: 0.9 });

  M.carpetTan = withMaps(THREE, phys(THREE, {
    metalness: 0.0,
    sheen: 0.55,
    sheenRoughness: 0.9,
    sheenColor: new THREE.Color(0xd9c9ad),
    envMapIntensity: 0.5,
  }), T('carpetTan'), { normalScale: 1.0, aoMapIntensity: 1.0 });

  M.carpetBeige = withMaps(THREE, phys(THREE, {
    metalness: 0.0,
    sheen: 0.7,
    sheenRoughness: 0.85,
    sheenColor: new THREE.Color(0xefe3cd),
    envMapIntensity: 0.5,
  }), T('carpetBeige'), { normalScale: 0.9, aoMapIntensity: 0.9 });

  M.rubberGymFloor = withMaps(THREE, phys(THREE, {
    metalness: 0.0,
    clearcoat: 0.10,
    clearcoatRoughness: 0.7,
    envMapIntensity: 0.6,
  }), T('rubberGymFloor'), { normalScale: 0.8 });

  M.compositeDeck = withMaps(THREE, phys(THREE, {
    metalness: 0.0,
    clearcoat: 0.12,
    clearcoatRoughness: 0.65,
    envMapIntensity: 0.9,
  }), T('compositeDeck'), { normalScale: 1.0, aoMapIntensity: 1.0 });

  M.sunroomDeckSlat = withMaps(THREE, phys(THREE, {
    metalness: 0.0,
    clearcoat: 0.18,
    clearcoatRoughness: 0.5,
    envMapIntensity: 0.8,
  }), T('sunroomDeckSlat'), { normalScale: 1.0, aoMapIntensity: 1.0 });

  /* -------------------------------------------------------- stone & tile */

  // Polished quartz: hard, near-mirror film over a low-scatter body.
  M.quartzWhite = withMaps(THREE, phys(THREE, {
    metalness: 0.0,
    clearcoat: 0.85,
    clearcoatRoughness: 0.045,
    reflectivity: 0.6,
    envMapIntensity: 1.15,
  }), T('quartzWhite'), { normalScale: 0.35, aoMapIntensity: 0.35 });

  M.quartzSlabBacksplash = withMaps(THREE, phys(THREE, {
    metalness: 0.0,
    clearcoat: 0.8,
    clearcoatRoughness: 0.06,
    reflectivity: 0.58,
    envMapIntensity: 1.05,
  }), T('quartzSlabBacksplash'), { normalScale: 0.3, aoMapIntensity: 0.3 });

  M.blackGranite = withMaps(THREE, phys(THREE, {
    metalness: 0.0,
    clearcoat: 0.95,
    clearcoatRoughness: 0.035,
    reflectivity: 0.65,
    envMapIntensity: 1.3,
  }), T('blackGranite'), { normalScale: 0.3, aoMapIntensity: 0.3 });

  M.bronzePorcelain = withMaps(THREE, phys(THREE, {
    clearcoat: 0.55,
    clearcoatRoughness: 0.18,
    envMapIntensity: 1.1,
  }), T('bronzePorcelain'), { normalScale: 1.0, aoMapIntensity: 1.0 });

  M.bronzePorcelainFloor = withMaps(THREE, phys(THREE, {
    metalness: 0.0,
    clearcoat: 0.35,
    clearcoatRoughness: 0.3,
    envMapIntensity: 0.95,
  }), T('bronzePorcelainFloor'), { normalScale: 1.0, aoMapIntensity: 1.0 });

  M.marbleLookTile = withMaps(THREE, phys(THREE, {
    metalness: 0.0,
    clearcoat: 0.5,
    clearcoatRoughness: 0.22,
    envMapIntensity: 1.0,
  }), T('marbleLookTile'), { normalScale: 1.0, aoMapIntensity: 1.0 });

  M.mosaicAccent = withMaps(THREE, phys(THREE, {
    metalness: 0.0,
    clearcoat: 0.55,
    clearcoatRoughness: 0.2,
    envMapIntensity: 1.0,
  }), T('mosaicAccent'), { normalScale: 1.0, aoMapIntensity: 1.1 });

  M.bluestone = withMaps(THREE, phys(THREE, {
    metalness: 0.0,
    envMapIntensity: 0.8,
  }), T('bluestone'), { normalScale: 1.0, aoMapIntensity: 1.0 });

  M.stackedLimestone = withMaps(THREE, phys(THREE, {
    metalness: 0.0,
    envMapIntensity: 0.75,
  }), T('stackedLimestone'), { normalScale: 1.0, aoMapIntensity: 1.15 });

  M.concreteDriveway = withMaps(THREE, phys(THREE, {
    metalness: 0.0,
    envMapIntensity: 0.8,
  }), T('concreteDriveway'), { normalScale: 0.8 });

  /* ---------------------------------------------------------------- wood */

  M.cherryCabinet = withMaps(THREE, phys(THREE, {
    metalness: 0.0,
    clearcoat: 0.5,
    clearcoatRoughness: 0.24,
    envMapIntensity: 0.85,
  }), T('cherryCabinet'), { normalScale: 0.9 });

  M.cherryCabinetDark = withMaps(THREE, phys(THREE, {
    metalness: 0.0,
    clearcoat: 0.40,
    clearcoatRoughness: 0.28,
    envMapIntensity: 0.85,
  }), T('cherryCabinetDark'), { normalScale: 0.9 });

  M.butcherBlock = withMaps(THREE, phys(THREE, {
    metalness: 0.0,
    clearcoat: 0.35,
    clearcoatRoughness: 0.3,
    envMapIntensity: 0.8,
  }), T('butcherBlock'), { normalScale: 0.9 });

  M.woodSlatWall = withMaps(THREE, phys(THREE, {
    metalness: 0.0,
    clearcoat: 0.3,
    clearcoatRoughness: 0.35,
    envMapIntensity: 0.8,
  }), T('woodSlatWall'), { normalScale: 1.0, aoMapIntensity: 1.25 });

  M.blackBacker = withMaps(THREE, phys(THREE, {
    metalness: 0.0,
    envMapIntensity: 0.25,
  }), T('blackBacker'), { normalScale: 0.6 });

  /* --------------------------------------------------------------- paint */

  M.paintedOffWhite = withMaps(THREE, phys(THREE, {
    metalness: 0.0,
    clearcoat: 0.35,
    clearcoatRoughness: 0.3,
    envMapIntensity: 0.8,
  }), T('paintedOffWhite'), { normalScale: 0.7 });

  M.paintedSlateBlue = withMaps(THREE, phys(THREE, {
    metalness: 0.0,
    clearcoat: 0.35,
    clearcoatRoughness: 0.3,
    envMapIntensity: 0.8,
  }), T('paintedSlateBlue'), { normalScale: 0.7 });

  M.paintedGreige = withMaps(THREE, phys(THREE, {
    metalness: 0.0,
    clearcoat: 0.32,
    clearcoatRoughness: 0.32,
    envMapIntensity: 0.8,
  }), T('paintedGreige'), { normalScale: 0.7 });

  M.wallPaintWhite = withMaps(THREE, phys(THREE, {
    metalness: 0.0,
    envMapIntensity: 0.7,
  }), T('wallPaintWhite'), { normalScale: 0.45, aoMapIntensity: 0.5 });

  M.wallPaintWarmWhite = withMaps(THREE, phys(THREE, {
    metalness: 0.0,
    envMapIntensity: 0.7,
  }), T('wallPaintWarmWhite'), { normalScale: 0.45, aoMapIntensity: 0.5 });

  M.ceilingPaint = withMaps(THREE, phys(THREE, {
    metalness: 0.0,
    envMapIntensity: 0.6,
  }), T('ceilingPaint'), { normalScale: 0.35, aoMapIntensity: 0.4 });

  M.drywallCeilingKnockdown = withMaps(THREE, phys(THREE, {
    metalness: 0.0,
    envMapIntensity: 0.6,
  }), T('drywallCeilingKnockdown'), { normalScale: 0.9, aoMapIntensity: 0.8 });

  M.blackMatte = withMaps(THREE, phys(THREE, {
    metalness: 0.15,
    envMapIntensity: 0.6,
  }), T('blackMatte'), { normalScale: 0.6 });

  /* ------------------------------------------------------------ exterior */

  M.grayLapSiding = withMaps(THREE, phys(THREE, {
    metalness: 0.0,
    envMapIntensity: 1.0,
  }), T('grayLapSiding'), { normalScale: 1.0, aoMapIntensity: 1.1 });

  M.asphaltShingle = withMaps(THREE, phys(THREE, {
    metalness: 0.0,
    envMapIntensity: 0.85,
  }), T('asphaltShingle'), { normalScale: 1.0, aoMapIntensity: 1.1 });

  M.lawnGrass = withMaps(THREE, phys(THREE, {
    metalness: 0.0,
    sheen: 0.35,
    sheenRoughness: 0.8,
    sheenColor: new THREE.Color(0x9dbb63),
    envMapIntensity: 0.95,
  }), T('lawnGrass'), { normalScale: 0.9 });

  M.mulchBed = withMaps(THREE, phys(THREE, {
    metalness: 0.0,
    envMapIntensity: 0.7,
  }), T('mulchBed'), { normalScale: 1.0, aoMapIntensity: 1.2 });

  /* ---------------------------------------------- metals / fabric / glass */

  M.stainlessBrushed = withMaps(THREE, phys(THREE, {
    color: 0xffffff,
    metalness: 1.0,
    envMapIntensity: 1.35,
  }), T('stainlessBrushed'), { normalScale: 0.55, aoMapIntensity: 0.3 });

  M.brassBrushed = withMaps(THREE, phys(THREE, {
    color: 0xffffff,
    metalness: 1.0,
    envMapIntensity: 1.3,
  }), T('brassBrushed'), { normalScale: 0.5, aoMapIntensity: 0.3 });

  M.fabricLinen = withMaps(THREE, phys(THREE, {
    metalness: 0.0,
    sheen: 0.8,
    sheenRoughness: 0.75,
    sheenColor: new THREE.Color(0xe6ddcd),
    envMapIntensity: 0.6,
  }), T('fabricLinen'), { normalScale: 1.0, aoMapIntensity: 1.0 });

  M.fabricVelvet = withMaps(THREE, phys(THREE, {
    metalness: 0.0,
    sheen: 1.0,
    sheenRoughness: 0.35,
    sheenColor: new THREE.Color(0x9fb4c2),
    envMapIntensity: 0.6,
  }), T('fabricVelvet'), { normalScale: 0.5, aoMapIntensity: 0.7 });

  M.leatherDark = withMaps(THREE, phys(THREE, {
    metalness: 0.0,
    clearcoat: 0.28,
    clearcoatRoughness: 0.5,
    sheen: 0.25,
    sheenRoughness: 0.6,
    envMapIntensity: 0.8,
  }), T('leatherDark'), { normalScale: 1.0, aoMapIntensity: 1.0 });

  M.mirrorGlass = withMaps(THREE, phys(THREE, {
    color: 0xf6f8f8,
    metalness: 1.0,
    roughness: 0.02,
    envMapIntensity: 1.6,
  }), T('mirrorGlass'), { normalScale: 0.15, roughnessMap: false, aoMap: false });

  M.frostedGlass = withMaps(THREE, phys(THREE, {
    color: 0xffffff,
    metalness: 0.0,
    transmission: 0.86,
    thickness: 0.03,
    ior: 1.5,
    envMapIntensity: 1.0,
    transparent: true,
  }), T('frostedGlass'), { normalScale: 0.35, aoMap: false });

  M.clearGlass = phys(THREE, {
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
  M.clearGlass.userData.scaleFeet = [3, 3];
  M.clearGlass.userData.textureName = 'clearGlass';

  /* ------------------------------------------------------------ metadata */

  for (const k of Object.keys(M)) {
    M[k].name = k;
    if (!M[k].userData.scaleFeet) M[k].userData.scaleFeet = [1, 1];
  }

  Object.defineProperty(M, '__textures', { value: tex, enumerable: false });
  Object.defineProperty(M, '__quality', { value: quality, enumerable: false });
  Object.defineProperty(M, 'dispose', {
    value() {
      for (const k of Object.keys(M)) M[k].dispose();
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
