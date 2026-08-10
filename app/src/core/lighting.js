/**
 * lighting.js — reusable lighting rigs for 1430 Country Ln.
 *
 * The bar is the listing photograph, and a listing photograph is not a single
 * sun. It is a bracketed / flash-blended exposure:
 *
 *   * shadows are OPEN — there is no black anywhere in the frame
 *   * windows are slightly blown but never clipped to paper white
 *   * every artificial fixture is switched on, even at midday
 *   * white balance sits neutral-to-slightly-warm, around a 4600K look
 *
 * So the house rig is always: daylight (sun + sky env) + every fixture on
 * (`recessedCan`, `pendant`, `sconce`, `underCabinet`, `coveLight`) + a low
 * `bakeAmbientFill` standing in for the bounced flash. A pure single-sun render
 * reads as CG immediately; the fill is what kills that.
 *
 * UNITS. World unit = 1 foot (CONVENTIONS §1), so three's inverse-square term
 * divides by feet-squared. `PHOTOMETRIC.candela` is the single constant that
 * converts real candela into the project's working scale at exposure 1.0 —
 * change it and the whole house re-balances together.
 */

import * as THREE from 'three';
import { qualityProfile } from './renderer.js';
import { RectAreaLightUniformsLib } from '../../vendor/three/lights/RectAreaLightUniformsLib.js';

const DEG = Math.PI / 180;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/* ======================================================================== */
/* Photometry                                                                */
/* ======================================================================== */

export const PHOTOMETRIC = {
  /**
   * Working intensity per real candela, for distances measured in FEET and
   * renderer.toneMappingExposure ≈ 1. Calibrated so an 800 lm / 50° BR30 can
   * five feet away puts a white wall at roughly 0.45 linear.
   */
  candela: 0.0306,
};

/** Solid angle of a cone of half-angle `angle` (radians), steradians. */
export function coneSolidAngle(angle) {
  return 2 * Math.PI * (1 - Math.cos(clamp(angle, 0.001, Math.PI)));
}

/**
 * Real lumens -> three intensity for a spot/point light in this project.
 * @param {number} lm            luminous flux
 * @param {number} [beamDeg=360] full beam angle; 360 = omnidirectional
 */
export function lumensToIntensity(lm, beamDeg = 360) {
  const omega = beamDeg >= 359 ? 4 * Math.PI : coneSolidAngle((beamDeg * DEG) / 2);
  return (lm / omega) * PHOTOMETRIC.candela;
}

/**
 * Correlated colour temperature -> THREE.Color, normalised so the brightest
 * channel is 1 (a light's colour is a tint; its brightness is `intensity`).
 * Set in sRGB space, which is how everyone reads "2900K warm white".
 */
export function kelvinToColor(kelvin, out = new THREE.Color()) {
  const t = clamp(kelvin, 1000, 40000) / 100;
  let r;
  let g;
  let b;

  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    b = 255;
  }

  r = clamp(r, 0, 255);
  g = clamp(g, 0, 255);
  b = clamp(b, 0, 255);
  const mx = Math.max(r, g, b) || 255;
  return out.setRGB(r / mx, g / mx, b / mx, THREE.SRGBColorSpace);
}

/** Standard colour temperatures used around this house. */
export const TEMP = Object.freeze({
  can: 2900,        // recessed LED trims throughout
  pendant: 2800,    // kitchen island + dining chandelier
  sconce: 2700,
  underCabinet: 3000,
  cove: 2900,
  fire: 1900,       // the gas fire in the family-room ledgestone
  daylight: 6200,
  shade: 8000,      // north-sky fill
});

let _rectAreaReady = false;
/** RectAreaLight needs its LTC uniform tables installed exactly once. */
export function ensureRectAreaLights() {
  if (_rectAreaReady) return;
  RectAreaLightUniformsLib.init();
  _rectAreaReady = true;
}

/* ======================================================================== */
/* small helpers                                                             */
/* ======================================================================== */

function asVec3(p, d = 0) {
  if (!p) return new THREE.Vector3(d, d, d);
  if (p.isVector3) return p.clone();
  if (Array.isArray(p)) return new THREE.Vector3(p[0], p[1], p[2]);
  return new THREE.Vector3(p.x || 0, p.y || 0, p.z || 0);
}

/**
 * Normalise anything bounds-shaped into { center: Vector3, radius, box }.
 * Accepts Box3, Object3D, [x0,y0,z0,x1,y1,z1], {min,max}, {center,radius}.
 */
export function normalizeBounds(bounds) {
  const box = new THREE.Box3();
  if (!bounds) {
    box.set(new THREE.Vector3(-40, -12, -40), new THREE.Vector3(40, 24, 40));
  } else if (bounds.isBox3) {
    box.copy(bounds);
  } else if (bounds.isObject3D) {
    box.setFromObject(bounds);
  } else if (Array.isArray(bounds) && bounds.length === 6) {
    box.set(
      new THREE.Vector3(bounds[0], bounds[1], bounds[2]),
      new THREE.Vector3(bounds[3], bounds[4], bounds[5])
    );
  } else if (bounds.min && bounds.max) {
    box.set(asVec3(bounds.min), asVec3(bounds.max));
  } else if (bounds.center && bounds.radius !== undefined) {
    const c = asVec3(bounds.center);
    const r = bounds.radius;
    box.set(
      new THREE.Vector3(c.x - r, c.y - r, c.z - r),
      new THREE.Vector3(c.x + r, c.y + r, c.z + r)
    );
  } else {
    box.set(new THREE.Vector3(-40, -12, -40), new THREE.Vector3(40, 24, 40));
  }
  const center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(box.getSize(new THREE.Vector3()).length() * 0.5, 1);
  return { box, center, radius };
}

/**
 * Fit a DirectionalLight's orthographic shadow camera to a bounds volume and
 * push the light far enough back that nothing clips the near plane.
 */
export function fitShadowToBounds(light, bounds, { quality, margin = 1.08, distance } = {}) {
  const profile = qualityProfile(quality);
  const { center, radius } = normalizeBounds(bounds);
  const r = radius * margin;
  const dist = distance === undefined ? r * 2.2 + 15 : distance;

  const dir = light.userData.direction
    ? light.userData.direction.clone()
    : light.position.clone().sub(light.target.position).normalize();

  light.target.position.copy(center);
  light.position.copy(center).addScaledVector(dir, dist);

  const cam = light.shadow.camera;
  cam.left = -r;
  cam.right = r;
  cam.top = r;
  cam.bottom = -r;
  cam.near = Math.max(0.5, dist - r - 5);
  cam.far = dist + r + 5;
  cam.updateProjectionMatrix();

  light.shadow.mapSize.set(profile.shadowMapSize, profile.shadowMapSize);
  light.shadow.radius = profile.shadowRadius;
  light.shadow.blurSamples = profile.name === 'high' ? 16 : 8;
  light.shadow.needsUpdate = true;
  return light;
}

/* ======================================================================== */
/* sunRig                                                                    */
/* ======================================================================== */

/**
 * Directional sun fitted to a bounds box, plus a hemisphere fill that stands in
 * for sky and ground bounce when no environment map is available.
 *
 * @param {THREE.Scene|THREE.Object3D} scene
 * @param {object} o
 * @param {number} [o.azimuth=196]     compass degrees; 180 = from the street
 * @param {number} [o.elevation=46]    degrees above the horizon
 * @param {number} [o.intensity=9.0]  full sun at exposure ~1 in this scale
 * @param {number|THREE.Color} [o.color]  defaults to a warm daylight tint
 * @param {*}      [o.shadowBounds]    Box3 / Object3D / [x0,y0,z0,x1,y1,z1]
 * @param {boolean}[o.castShadow=true]
 * @param {boolean}[o.hemisphere=true]
 * @param {number} [o.hemiIntensity=0.42]
 * @param {number} [o.bias=-0.0006]
 * @param {number} [o.normalBias=0.035] feet
 * @returns {{group, sun, hemi, direction, setBounds, setIntensity, dispose}}
 */
export function sunRig(scene, {
  azimuth = 196,
  elevation = 46,
  intensity = 9.0,
  color = 0xfff2df,
  shadowBounds = null,
  castShadow = true,
  hemisphere = true,
  hemiIntensity = 0.42,
  skyColor = 0xa9c6ef,
  groundColor = 0x7d7263,
  bias = -0.0006,
  normalBias = 0.035,
  quality,
  name = 'sunRig',
} = {}) {
  const group = new THREE.Group();
  group.name = name;

  const a = azimuth * DEG;
  const e = elevation * DEG;
  const direction = new THREE.Vector3(
    Math.cos(e) * Math.sin(a),
    Math.sin(e),
    -Math.cos(e) * Math.cos(a)
  ).normalize();

  const sun = new THREE.DirectionalLight(new THREE.Color(color), intensity);
  sun.name = `${name}.sun`;
  sun.castShadow = !!castShadow;
  sun.shadow.bias = bias;
  sun.shadow.normalBias = normalBias;
  sun.userData.direction = direction.clone();
  sun.target = new THREE.Object3D();
  sun.target.name = `${name}.target`;
  group.add(sun.target);
  group.add(sun);

  fitShadowToBounds(sun, shadowBounds, { quality });

  let hemi = null;
  if (hemisphere) {
    hemi = new THREE.HemisphereLight(
      new THREE.Color(skyColor),
      new THREE.Color(groundColor),
      hemiIntensity
    );
    hemi.name = `${name}.hemi`;
    group.add(hemi);
  }

  if (scene) scene.add(group);

  return {
    group,
    sun,
    hemi,
    direction,
    azimuth,
    elevation,
    setBounds(bounds, opts) {
      fitShadowToBounds(sun, bounds, Object.assign({ quality }, opts));
      return sun;
    },
    setIntensity(v) {
      sun.intensity = v;
      return v;
    },
    dispose() {
      if (group.parent) group.parent.remove(group);
      sun.dispose();
      if (hemi) hemi.dispose();
      if (sun.shadow && sun.shadow.map) sun.shadow.map.dispose();
    },
  };
}

/* ======================================================================== */
/* windowLight                                                               */
/* ======================================================================== */

/**
 * Daylight coming through an opening. A RectAreaLight the exact size of the
 * glass plus (optionally) an emissive card sitting just outside it so the
 * opening reads as a slightly-blown sky panel instead of a hole.
 *
 * @param {THREE.Scene|THREE.Object3D} scene
 * @param {object} o
 * @param {object} o.rect            { center:[x,y,z], width, height }
 * @param {number[]} o.normal        direction the light faces, INTO the room
 * @param {number} [o.intensity=3.0] RectAreaLight radiance (scale invariant)
 * @param {number|THREE.Color} [o.color=0xdfeaf7]
 * @param {boolean}[o.glow=true]     add the emissive card
 * @param {number} [o.glowIntensity=1.35]
 * @param {number} [o.glowOffset=0.18] feet outboard of the glass
 * @param {number|THREE.Color} [o.glowColor]
 * @param {number} [o.tilt=0]        radians, rotate the light about its normal
 * @returns {{group, light, card, setIntensity, dispose}}
 */
export function windowLight(scene, {
  rect,
  normal = [0, 0, 1],
  intensity = 3.0,
  color = 0xdfeaf7,
  glow = true,
  glowIntensity = 1.35,
  glowOffset = 0.18,
  glowColor,
  tilt = 0,
  name = 'windowLight',
} = {}) {
  ensureRectAreaLights();
  if (!rect) throw new Error('windowLight: rect { center, width, height } is required');

  const center = asVec3(rect.center);
  const width = rect.width;
  const height = rect.height;
  const n = asVec3(normal).normalize();

  const group = new THREE.Group();
  group.name = name;
  group.position.copy(center);

  // Orient so local -Z is the room-facing normal and local +Y stays world up.
  const up = Math.abs(n.y) > 0.98 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
  const zAxis = n.clone().negate(); // three area/spot lights emit along -Z
  const xAxis = new THREE.Vector3().crossVectors(up, zAxis).normalize();
  const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();
  const m = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
  group.quaternion.setFromRotationMatrix(m);
  if (tilt) group.rotateZ(tilt);

  const light = new THREE.RectAreaLight(new THREE.Color(color), intensity, width, height);
  light.name = `${name}.rect`;
  group.add(light);

  let card = null;
  if (glow) {
    const cardColor = new THREE.Color(glowColor === undefined ? color : glowColor);
    const mat = new THREE.MeshBasicMaterial({
      color: cardColor.multiplyScalar(glowIntensity),
      side: THREE.DoubleSide,
      toneMapped: true,
      fog: false,
    });
    card = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
    card.name = `${name}.card`;
    card.position.z = glowOffset; // local +Z is outboard
    card.receiveShadow = false;
    card.castShadow = false;
    group.add(card);
  }

  if (scene) scene.add(group);

  return {
    group,
    light,
    card,
    setIntensity(v) {
      light.intensity = v;
      return v;
    },
    dispose() {
      if (group.parent) group.parent.remove(group);
      light.dispose();
      if (card) {
        card.geometry.dispose();
        card.material.dispose();
      }
    },
  };
}

/* ======================================================================== */
/* recessedCan — this house has them in every single ceiling                 */
/* ======================================================================== */

const _canGeom = { ring: null, lens: null, baffle: null };

function canGeometry(rInner, rOuter, depth) {
  // The geometry is identical for every can in the house, so build it once.
  if (!_canGeom.ring) {
    _canGeom.ring = new THREE.RingGeometry(1, 1.18, 32);
    _canGeom.ring.rotateX(Math.PI / 2);
    _canGeom.lens = new THREE.CircleGeometry(1, 32);
    _canGeom.lens.rotateX(Math.PI / 2);
    _canGeom.baffle = new THREE.CylinderGeometry(1, 0.9, 1, 24, 1, true);
    _canGeom.baffle.translate(0, -0.5, 0);
  }
  return {
    ring: _canGeom.ring,
    lens: _canGeom.lens,
    baffle: _canGeom.baffle,
    ringScale: [rOuter / 1.18, 1, rOuter / 1.18],
    lensScale: [rInner, 1, rInner],
    baffleScale: [rInner, depth, rInner],
  };
}

let _canTrimMat = null;
let _canBaffleMat = null;

/**
 * One recessed can, as a self-contained group whose ORIGIN is the trim plane —
 * i.e. put the group exactly on the ceiling and it lands flush.
 *
 * Cheap by default: no shadow map, decay 2, a wide soft cone, plus a faintly
 * emissive lens so the fixture itself reads bright in frame the way it does in
 * every one of the listing photos.
 *
 * @param {number[]|THREE.Vector3} pos  ceiling point [x, y, z]
 * @param {object} o
 * @param {number} [o.angle=0.95]      spot cone half-angle, radians (~54°)
 * @param {number} [o.intensity=46]    working units (see PHOTOMETRIC)
 * @param {number} [o.temp=2900]       kelvin
 * @param {number[]}[o.aim]            world point to aim at; default straight down
 * @param {number} [o.penumbra=0.85]
 * @param {number} [o.decay=2]
 * @param {number} [o.distance=0]      0 = no cutoff
 * @param {boolean}[o.castShadow=false]
 * @param {number} [o.apertureIn=4.5]  inches
 * @param {number} [o.trimIn=5.4]      inches
 * @param {number} [o.recessIn=1.1]    inches the lens sits above the trim
 * @param {number} [o.lensGain=5.5]    emissive lens brightness multiplier —
 *        high enough that every channel clips, so the aperture reads as the
 *        near-white disc it is in the photographs rather than an orange dot
 * @param {boolean}[o.body=true]       draw trim/baffle/lens at all
 * @returns {THREE.Group} with .userData.light / .userData.setIntensity
 */
export function recessedCan(pos, {
  angle = 0.95,
  intensity = 46,
  temp = TEMP.can,
  aim = null,
  penumbra = 0.85,
  decay = 2,
  distance = 0,
  castShadow = false,
  apertureIn = 4.5,
  trimIn = 5.4,
  recessIn = 1.1,
  lensGain = 5.5,
  trimColor = 0xf4f2ef,
  body = true,
  quality,
  name = 'can',
} = {}) {
  const profile = qualityProfile(quality);
  const p = asVec3(pos);
  const color = kelvinToColor(temp);

  const group = new THREE.Group();
  group.name = name;
  group.position.copy(p);

  const rInner = apertureIn / 24; // radius, feet
  const rOuter = trimIn / 24;
  const depth = recessIn / 12;

  const light = new THREE.SpotLight(color.clone(), intensity, distance, angle, penumbra, decay);
  light.name = `${name}.spot`;
  light.position.set(0, -depth * 0.55, 0);
  light.castShadow = !!castShadow && profile.softShadows;
  if (light.castShadow) {
    light.shadow.mapSize.set(profile.shadowMapSize / 2, profile.shadowMapSize / 2);
    light.shadow.bias = -0.0008;
    light.shadow.normalBias = 0.03;
    light.shadow.radius = profile.shadowRadius;
    light.shadow.camera.near = 0.25;
    light.shadow.camera.far = 40;
  }

  const target = new THREE.Object3D();
  target.name = `${name}.target`;
  if (aim) {
    const a = asVec3(aim);
    target.position.copy(a).sub(p);
  } else {
    target.position.set(0, -1, 0);
  }
  group.add(target);
  light.target = target;
  group.add(light);

  if (body) {
    if (!_canTrimMat) {
      _canTrimMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(trimColor),
        roughness: 0.42,
        metalness: 0.0,
        side: THREE.DoubleSide,
      });
      _canBaffleMat = new THREE.MeshStandardMaterial({
        color: 0xe9e6e1,
        roughness: 0.85,
        metalness: 0.0,
        side: THREE.BackSide,
      });
    }
    const g = canGeometry(rInner, rOuter, depth);

    const ring = new THREE.Mesh(g.ring, _canTrimMat);
    ring.scale.set(g.ringScale[0], 1, g.ringScale[2]);
    ring.position.y = -0.004;
    ring.name = `${name}.trim`;
    group.add(ring);

    const baffle = new THREE.Mesh(g.baffle, _canBaffleMat);
    baffle.scale.set(g.baffleScale[0], g.baffleScale[1], g.baffleScale[2]);
    baffle.position.y = -0.004;
    baffle.name = `${name}.baffle`;
    group.add(baffle);

    const lensMat = new THREE.MeshBasicMaterial({
      color: color.clone().multiplyScalar(lensGain),
      toneMapped: true,
      fog: false,
      side: THREE.DoubleSide,
    });
    const lens = new THREE.Mesh(g.lens, lensMat);
    lens.scale.set(g.lensScale[0], 1, g.lensScale[2]);
    lens.position.y = -depth * 0.92;
    lens.name = `${name}.lens`;
    group.add(lens);
    group.userData.lens = lens;
  }

  group.userData.light = light;
  group.userData.kind = 'recessedCan';
  group.userData.setIntensity = (v) => {
    light.intensity = v;
    return v;
  };
  return group;
}

/* ======================================================================== */
/* fixtureBulb — the primitive behind pendants and sconces                   */
/* ======================================================================== */

/**
 * A visible bulb: emissive sphere + PointLight.
 *
 * @param {number[]} pos
 * @param {object} o
 * @param {number} [o.intensity=22]
 * @param {number} [o.temp=2800]
 * @param {number} [o.radiusIn=1.6]  bulb radius, inches
 * @param {number} [o.gain=4.0]      emissive multiplier on the glass
 * @param {boolean}[o.castShadow=false]
 * @returns {THREE.Group}
 */
export function fixtureBulb(pos = [0, 0, 0], {
  intensity = 22,
  temp = TEMP.pendant,
  radiusIn = 1.6,
  gain = 4.0,
  decay = 2,
  distance = 0,
  castShadow = false,
  opacity = 1,
  quality,
  name = 'bulb',
} = {}) {
  const profile = qualityProfile(quality);
  const color = kelvinToColor(temp);
  const group = new THREE.Group();
  group.name = name;
  group.position.copy(asVec3(pos));

  const light = new THREE.PointLight(color.clone(), intensity, distance, decay);
  light.name = `${name}.point`;
  light.castShadow = !!castShadow && profile.softShadows;
  if (light.castShadow) {
    light.shadow.mapSize.set(profile.shadowMapSize / 2, profile.shadowMapSize / 2);
    light.shadow.bias = -0.001;
    light.shadow.normalBias = 0.03;
    light.shadow.camera.near = 0.2;
    light.shadow.camera.far = 40;
  }
  group.add(light);

  const geo = new THREE.SphereGeometry(radiusIn / 12, 20, 14);
  const mat = new THREE.MeshBasicMaterial({
    color: color.clone().multiplyScalar(gain),
    toneMapped: true,
    fog: false,
    transparent: opacity < 1,
    opacity,
  });
  const glass = new THREE.Mesh(geo, mat);
  glass.name = `${name}.glass`;
  group.add(glass);

  group.userData.light = light;
  group.userData.glass = glass;
  group.userData.kind = 'fixtureBulb';
  group.userData.setIntensity = (v) => {
    light.intensity = v;
    return v;
  };
  return group;
}

/* ======================================================================== */
/* pendant                                                                   */
/* ======================================================================== */

/**
 * Cord-hung pendant. Origin is the CEILING mounting point; the fixture hangs
 * `drop` feet below it.
 *
 * @param {number[]} pos ceiling point
 * @param {object} o
 * @param {number}  [o.drop=3.1]         feet from ceiling to the bulb
 * @param {'cone'|'dome'|'globe'|'none'} [o.style='cone']
 * @param {number}  [o.shadeRadiusIn=5]
 * @param {number}  [o.shadeHeightIn=6]
 * @param {number|THREE.Color} [o.shadeColor=0x2b2b2b]
 * @param {number|THREE.Color} [o.shadeInterior=0xf0e6d2]
 * @param {number|THREE.Color} [o.cordColor=0xb08a3e]
 * @param {number}  [o.intensity=18]
 * @param {number}  [o.temp=2800]
 * @param {number}  [o.upFraction=0.18]  light escaping past an opaque shade
 * @returns {THREE.Group}
 */
export function pendant(pos = [0, 0, 0], {
  drop = 3.1,
  style = 'cone',
  shadeRadiusIn = 5,
  shadeHeightIn = 6,
  shadeColor = 0x2b2b2b,
  shadeInterior = 0xf0e6d2,
  cordColor = 0xb08a3e,
  cordRadiusIn = 0.28,
  intensity = 18,
  temp = TEMP.pendant,
  bulbRadiusIn = 1.5,
  castShadow = false,
  upFraction = 0.18,
  spotAngle = 1.15,
  quality,
  name = 'pendant',
} = {}) {
  // An opaque shade throws its light DOWN. Modelling that with a wide spot
  // instead of a bare point light is both cheaper and more accurate than
  // asking the shade geometry to cast a shadow map — and it stops every
  // pendant in the house from washing out the ceiling above it.
  const shaded = style === 'cone' || style === 'dome';
  const group = new THREE.Group();
  group.name = name;
  group.position.copy(asVec3(pos));

  const shadeR = shadeRadiusIn / 12;
  const shadeH = shadeHeightIn / 12;
  const cordLen = Math.max(drop - shadeH, 0.1);

  const cordMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(cordColor),
    roughness: 0.34,
    metalness: 0.85,
  });
  const cord = new THREE.Mesh(
    new THREE.CylinderGeometry(cordRadiusIn / 12, cordRadiusIn / 12, cordLen, 10),
    cordMat
  );
  cord.position.y = -cordLen / 2;
  cord.castShadow = false;
  cord.name = `${name}.cord`;
  group.add(cord);

  const canopy = new THREE.Mesh(
    new THREE.CylinderGeometry(shadeR * 0.42, shadeR * 0.42, 0.09, 16),
    cordMat
  );
  canopy.position.y = -0.045;
  canopy.name = `${name}.canopy`;
  group.add(canopy);

  let shade = null;
  if (style !== 'none') {
    const outMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(shadeColor),
      roughness: 0.45,
      metalness: 0.15,
      side: THREE.FrontSide,
    });
    const inMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(shadeInterior).multiplyScalar(0.85),
      side: THREE.BackSide,
      toneMapped: true,
    });
    let geo;
    if (style === 'cone') geo = new THREE.ConeGeometry(shadeR, shadeH, 32, 1, true);
    else if (style === 'dome') geo = new THREE.SphereGeometry(shadeR, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    else geo = new THREE.SphereGeometry(shadeR, 32, 20);

    shade = new THREE.Group();
    shade.name = `${name}.shade`;
    const outer = new THREE.Mesh(geo, style === 'globe'
      ? new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        roughness: 0.35,
        transmission: 0.6,
        thickness: 0.05,
        emissive: kelvinToColor(temp),
        emissiveIntensity: 0.9,
      })
      : outMat);
    outer.castShadow = false;
    shade.add(outer);
    if (style !== 'globe') {
      const inner = new THREE.Mesh(geo, inMat);
      shade.add(inner);
    }
    shade.position.y = -cordLen - shadeH * (style === 'cone' ? 0.5 : 0.0);
    group.add(shade);
  }

  const bulb = fixtureBulb([0, -drop, 0], {
    intensity: shaded ? intensity * upFraction : intensity,
    temp,
    radiusIn: bulbRadiusIn,
    castShadow,
    quality,
    name: `${name}.bulb`,
  });
  group.add(bulb);

  let spot = null;
  if (shaded) {
    spot = new THREE.SpotLight(kelvinToColor(temp), intensity, 0, spotAngle, 0.9, 2);
    spot.name = `${name}.spot`;
    spot.position.set(0, -drop, 0);
    spot.castShadow = false;
    const tgt = new THREE.Object3D();
    tgt.position.set(0, -drop - 1, 0);
    group.add(tgt);
    spot.target = tgt;
    group.add(spot);
  }

  group.userData.kind = 'pendant';
  group.userData.light = spot || bulb.userData.light;
  group.userData.shade = shade;
  group.userData.setIntensity = (v) => {
    if (spot) {
      spot.intensity = v;
      bulb.userData.setIntensity(v * upFraction);
    } else {
      bulb.userData.setIntensity(v);
    }
    return v;
  };
  return group;
}

/* ======================================================================== */
/* sconce                                                                    */
/* ======================================================================== */

/**
 * Wall sconce. Origin is the wall face; `normal` points into the room.
 *
 * @param {number[]} pos
 * @param {object} o
 * @param {number[]} [o.normal=[0,0,1]]
 * @param {number}   [o.intensity=14]
 * @param {number}   [o.temp=2700]
 * @param {number}   [o.armIn=4]
 * @param {'updown'|'globe'} [o.style='globe']
 * @returns {THREE.Group}
 */
export function sconce(pos = [0, 0, 0], {
  normal = [0, 0, 1],
  intensity = 14,
  temp = TEMP.sconce,
  armIn = 4,
  backplateIn = 4.5,
  style = 'globe',
  bodyColor = 0x1f1f1f,
  quality,
  name = 'sconce',
} = {}) {
  const group = new THREE.Group();
  group.name = name;
  group.position.copy(asVec3(pos));

  const n = asVec3(normal).normalize();
  const up = Math.abs(n.y) > 0.98 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
  const zAxis = n.clone();
  const xAxis = new THREE.Vector3().crossVectors(up, zAxis).normalize();
  const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();
  group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis));

  const bodyMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(bodyColor),
    roughness: 0.4,
    metalness: 0.5,
  });

  const back = new THREE.Mesh(
    new THREE.CylinderGeometry(backplateIn / 24, backplateIn / 24, 0.06, 20),
    bodyMat
  );
  back.rotation.x = Math.PI / 2;
  back.position.z = 0.03;
  back.name = `${name}.backplate`;
  group.add(back);

  const arm = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045, 0.045, armIn / 12, 10),
    bodyMat
  );
  arm.rotation.x = Math.PI / 2;
  arm.position.z = armIn / 24 + 0.05;
  arm.name = `${name}.arm`;
  group.add(arm);

  const bulb = fixtureBulb([0, 0, armIn / 12 + 0.12], {
    intensity,
    temp,
    radiusIn: style === 'globe' ? 2.4 : 1.4,
    gain: style === 'globe' ? 1.6 : 2.2,
    quality,
    name: `${name}.bulb`,
  });
  group.add(bulb);

  group.userData.kind = 'sconce';
  group.userData.light = bulb.userData.light;
  group.userData.setIntensity = bulb.userData.setIntensity;
  return group;
}

/* ======================================================================== */
/* underCabinet / coveLight — linear sources                                */
/* ======================================================================== */

function stripLight({
  rect,
  facing,
  intensity,
  color,
  glow,
  glowGain,
  glowOffset,
  name,
}) {
  ensureRectAreaLights();
  const center = asVec3(rect.center);
  const width = rect.width;
  const depth = rect.depth === undefined ? rect.height : rect.depth;
  const yaw = rect.yaw || 0;

  const group = new THREE.Group();
  group.name = name;
  group.position.copy(center);
  group.rotation.y = yaw;

  const light = new THREE.RectAreaLight(new THREE.Color(color), intensity, width, depth);
  light.name = `${name}.rect`;
  // Local -Z becomes world -Y (down) at -90°, world +Y (up) at +90°.
  light.rotation.x = facing === 'up' ? Math.PI / 2 : -Math.PI / 2;
  group.add(light);

  let card = null;
  if (glow) {
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color).multiplyScalar(glowGain),
      toneMapped: true,
      side: THREE.DoubleSide,
      fog: false,
    });
    card = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), mat);
    card.rotation.x = -Math.PI / 2;
    card.position.y = facing === 'up' ? -glowOffset : glowOffset;
    card.name = `${name}.card`;
    group.add(card);
  }

  group.userData.light = light;
  group.userData.card = card;
  group.userData.setIntensity = (v) => {
    light.intensity = v;
    return v;
  };
  return group;
}

/**
 * Under-cabinet LED tape washing a counter.
 *
 * @param {object} rect  { center:[x,y,z], width, depth, yaw? }
 *                       center sits at the underside of the wall cabinet
 * @param {object} [o]
 * @param {number} [o.intensity=3.0]  RectAreaLight radiance
 * @param {number} [o.temp=3000]
 * @returns {THREE.Group}
 */
export function underCabinet(rect, {
  intensity = 3.0,
  temp = TEMP.underCabinet,
  glow = true,
  glowGain = 0.9,
  glowOffset = 0.01,
  name = 'underCabinet',
} = {}) {
  if (!rect) throw new Error('underCabinet: rect { center, width, depth } is required');
  const g = stripLight({
    rect,
    facing: 'down',
    intensity,
    color: kelvinToColor(temp),
    glow,
    glowGain,
    glowOffset,
    name,
  });
  g.userData.kind = 'underCabinet';
  return g;
}

/**
 * Cove / tray-ceiling uplight. Same primitive, aimed up.
 *
 * @param {object} rect  { center:[x,y,z], width, depth, yaw? }
 * @param {object} [o]
 * @param {number} [o.intensity=2.2]
 * @param {number} [o.temp=2900]
 */
export function coveLight(rect, {
  intensity = 2.2,
  temp = TEMP.cove,
  glow = false,
  glowGain = 0.8,
  glowOffset = 0.01,
  name = 'coveLight',
} = {}) {
  if (!rect) throw new Error('coveLight: rect { center, width, depth } is required');
  const g = stripLight({
    rect,
    facing: 'up',
    intensity,
    color: kelvinToColor(temp),
    glow,
    glowGain,
    glowOffset,
    name,
  });
  g.userData.kind = 'coveLight';
  return g;
}

/* ======================================================================== */
/* bakeAmbientFill — the flash-blend                                        */
/* ======================================================================== */

/**
 * The fill that makes a render read as a *photograph*.
 *
 * A real-estate shooter fires a bounced speedlight (or blends a flash frame)
 * to lift every shadow while leaving the daylight direction intact. We emulate
 * that with three cheap, shadowless pieces:
 *
 *   hemi     sky/ground bounce, the bulk of the lift
 *   ambient  a floor under the darkest values so nothing ever clips to black
 *   fill     an ON-AXIS directional light that `follow(camera)` keeps behind
 *            the lens — exactly where the flash was
 *
 * @param {THREE.Scene|THREE.Object3D} scene
 * @param {object} o
 * @param {number} [o.intensity=1.0]    master; scales all three parts
 * @param {number|THREE.Color} [o.color=0xfff4e8]  the flash gel, ~4600K look
 * @param {number|THREE.Color} [o.groundColor=0xc9b79c]
 * @param {number} [o.hemi=0.55]        share of intensity
 * @param {number} [o.ambient=0.20]
 * @param {number} [o.onAxis=0.38]
 * @param {THREE.Camera} [o.camera]     if given, follow() is called once now
 * @returns {{group, hemi, ambient, fill, follow, setIntensity, dispose}}
 */
export function bakeAmbientFill(scene, {
  intensity = 1.0,
  // Near-neutral. A HemisphereLight's GROUND colour lights downward-facing surfaces — i.e. the
  // ceiling — so a saturated tan here turns every ceiling pink. docs/PHOTOGRAPHY.md measures the
  // real ceilings at a near-neutral 193-197 with only a slight warm cast, so both ends stay close
  // to white and the warmth comes from the light colour, not the bounce tint.
  color = 0xfff6ec,
  groundColor = 0xded8d0,
  skyColor,
  hemi: hemiShare = 0.55,
  ambient: ambientShare = 0.20,
  onAxis: onAxisShare = 0.38,
  name = 'ambientFill',
} = {}) {
  const group = new THREE.Group();
  group.name = name;

  const c = new THREE.Color(color);

  const hemi = new THREE.HemisphereLight(
    new THREE.Color(skyColor === undefined ? color : skyColor),
    new THREE.Color(groundColor),
    intensity * hemiShare
  );
  hemi.name = `${name}.hemi`;
  group.add(hemi);

  const ambient = new THREE.AmbientLight(c.clone(), intensity * ambientShare);
  ambient.name = `${name}.ambient`;
  group.add(ambient);

  const fill = new THREE.DirectionalLight(c.clone(), intensity * onAxisShare);
  fill.name = `${name}.onAxis`;
  fill.castShadow = false;
  fill.position.set(0, 6, 10);
  fill.target = new THREE.Object3D();
  group.add(fill.target);
  group.add(fill);

  if (scene) scene.add(group);

  const _p = new THREE.Vector3();
  const _d = new THREE.Vector3();

  /** Park the on-axis fill just behind the camera, aimed where it looks. */
  function follow(camera, backoff = 1.5) {
    if (!camera) return;
    camera.getWorldPosition(_p);
    camera.getWorldDirection(_d);
    fill.position.copy(_p).addScaledVector(_d, -backoff);
    fill.target.position.copy(_p).addScaledVector(_d, 40);
    fill.target.updateMatrixWorld();
  }

  return {
    group,
    hemi,
    ambient,
    fill,
    follow,
    setIntensity(v) {
      hemi.intensity = v * hemiShare;
      ambient.intensity = v * ambientShare;
      fill.intensity = v * onAxisShare;
      return v;
    },
    dispose() {
      if (group.parent) group.parent.remove(group);
      hemi.dispose();
      ambient.dispose();
      fill.dispose();
    },
  };
}

/* ======================================================================== */
/* Level presets                                                             */
/* ======================================================================== */

/**
 * One LightPreset per level. These are the numbers a room module should start
 * from; rooms then add their own cans / pendants with `preset.can` etc.
 *
 * `exposure` is renderer.toneMappingExposure for that level.
 */
export const LIGHT_PRESETS = Object.freeze({
  first: Object.freeze({
    name: 'first',
    exposure: 1.0,
    // A ceiling sees ONLY the environment's lower hemisphere, so floorColor x floorFactor is
    // literally the ceiling's colour. floorFactor was 0.66 against a saturated 0xb98a55 oak,
    // which rendered every ceiling salmon pink. docs/PHOTOGRAPHY.md measures the real ceilings at
    // a near-neutral 193-197, so the bounce is desaturated and its weight brought back near the
    // env.js default (0.15), with the ceiling lit mostly by its own boost and the walls.
    env: { kind: 'indoor', wallColor: 0xf3f1ee, floorColor: 0xc7ab8c, intensity: 1.28,
      wallFactor: 0.44, floorFactor: 0.20, ceilingBoost: 0.62, ceilingColor: 0xfbf9f6 },
    sun: { azimuth: 208, elevation: 52, intensity: 9.0, color: 0xfff1da },
    // groundColor is what lights a DOWN-facing normal, i.e. the ceiling. The
    // reference photos put the ceiling within ~5 L of the walls (185/181);
    // without GI only this hemisphere term can close that gap, so the "ground"
    // here is the bright bounce off a sunlit oak floor, not a dark floor.
    fill: { intensity: 0.62, color: 0xfff4e8, groundColor: 0xfff3e2, skyColor: 0xd9e2ec,
      hemi: 0.66, ambient: 0.12, onAxis: 0.22 },
    can: { temp: 2900, intensity: 46, angle: 0.95, penumbra: 0.85 },
    pendant: { temp: 2800, intensity: 18 },
    window: { intensity: 3.0, color: 0xdfeaf7, glowIntensity: 1.1 },
    underCabinet: { temp: 3000, intensity: 3.0 },
  }),
  second: Object.freeze({
    name: 'second',
    exposure: 1.0,
    env: { kind: 'indoor', wallColor: 0xf4f2ef, floorColor: 0xd5c7b3, intensity: 1.22,
      wallFactor: 0.44, floorFactor: 0.20, ceilingBoost: 0.60, ceilingColor: 0xfbf9f6 },
    sun: { azimuth: 214, elevation: 56, intensity: 8.6, color: 0xfff2de },
    fill: { intensity: 0.60, color: 0xfff5ea, groundColor: 0xfff4e6, skyColor: 0xdde5ee,
      hemi: 0.66, ambient: 0.12, onAxis: 0.22 },
    can: { temp: 2900, intensity: 42, angle: 0.98, penumbra: 0.88 },
    pendant: { temp: 2800, intensity: 16 },
    window: { intensity: 3.2, color: 0xe2ecf8, glowIntensity: 1.15 },
    underCabinet: { temp: 3000, intensity: 2.6 },
  }),
  basement: Object.freeze({
    name: 'basement',
    exposure: 1.05,
    // Almost no daylight: two small egress wells. The cans do all the work,
    // and the fill keeps the corners from going muddy.
    env: { kind: 'indoor', wallColor: 0xf2f0ed, floorColor: 0xded2c0, intensity: 0.95, windowIntensity: 0.35,
      wallFactor: 0.40, floorFactor: 0.18, ceilingBoost: 0.54, ceilingColor: 0xfaf8f5 },
    sun: null,
    fill: { intensity: 0.52, color: 0xfff2e2, groundColor: 0xfdf0dd, skyColor: 0xd6ccbb,
      hemi: 0.66, ambient: 0.12, onAxis: 0.22 },
    can: { temp: 2900, intensity: 58, angle: 1.0, penumbra: 0.88 },
    pendant: { temp: 2800, intensity: 20 },
    window: { intensity: 2.4, color: 0xd8e5f2, glowIntensity: 1.0 },
    underCabinet: { temp: 3000, intensity: 2.4 },
  }),
  exterior: Object.freeze({
    name: 'exterior',
    exposure: 0.92,
    env: { kind: 'sky', turbidity: 2.4, intensity: 1.0 },
    sun: { azimuth: 168, elevation: 54, intensity: 9.4, color: 0xfff4e0 },
    fill: { intensity: 0.20, color: 0xdfe9f7, groundColor: 0x8f9a6d },
    can: { temp: 2900, intensity: 40 },
    pendant: { temp: 2700, intensity: 18 },
    window: { intensity: 1.2, color: 0x2a2f33, glowIntensity: 0.6 },
    underCabinet: { temp: 3000, intensity: 2.0 },
  }),
});

/** Fetch a preset, falling back to `first`. */
export function lightPreset(level) {
  return LIGHT_PRESETS[level] || LIGHT_PRESETS.first;
}

/**
 * Stand up the standard rig for a level: sun (when the level has daylight)
 * plus the flash-blend fill. Environment maps are built by env.js and attached
 * by the caller — this only owns the analytic lights.
 *
 * @param {THREE.Scene} scene
 * @param {'first'|'second'|'basement'|'exterior'} level
 * @param {object} [o]
 * @param {*}       [o.bounds]     shadow bounds for the sun
 * @param {object}  [o.sun]        overrides merged over the preset
 * @param {object}  [o.fill]
 * @param {string}  [o.quality]
 * @param {THREE.WebGLRenderer} [o.renderer]  used to apply preset.exposure
 * @returns {{preset, sun, fill, dispose}}
 */
export function applyLightPreset(scene, level, {
  bounds = null,
  sun: sunOverride = null,
  fill: fillOverride = null,
  quality,
  renderer = null,
} = {}) {
  const preset = lightPreset(level);
  if (renderer) renderer.toneMappingExposure = preset.exposure;

  let sun = null;
  if (preset.sun) {
    sun = sunRig(scene, Object.assign({}, preset.sun, { shadowBounds: bounds, quality }, sunOverride || {}));
  }
  const fill = bakeAmbientFill(scene, Object.assign({}, preset.fill, fillOverride || {}));

  return {
    preset,
    sun,
    fill,
    dispose() {
      if (sun) sun.dispose();
      fill.dispose();
    },
  };
}

export default {
  sunRig,
  windowLight,
  recessedCan,
  pendant,
  sconce,
  underCabinet,
  coveLight,
  fixtureBulb,
  bakeAmbientFill,
  applyLightPreset,
  LIGHT_PRESETS,
  kelvinToColor,
  TEMP,
};
