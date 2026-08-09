/**
 * env.js — procedural environment lighting. No HDRI files, no network.
 *
 * Two generators, both PMREM-filtered so MeshPhysicalMaterial gets proper
 * roughness-aware specular and a believable diffuse ambient:
 *
 *   makeSkyEnv(renderer, {...})    physical-ish daylight sky + sun disc.
 *                                  Used for exteriors, and for every interior
 *                                  that has a window (the sky is what the glass
 *                                  reflects and what the room bounces).
 *   makeIndoorEnv(renderer, {...}) RoomEnvironment-style emissive box giving
 *                                  interiors plausible bounce without GI —
 *                                  bright ceiling, mid walls, darker floor and
 *                                  one bright window wall for directionality.
 *
 * Everything is drawn with a ShaderMaterial that includes three's own
 * <tonemapping_fragment> / <colorspace_fragment> chunks. Consequence:
 *   - rendered into a PMREM / EffectComposer target -> linear HDR (correct)
 *   - rendered straight to the canvas               -> ACES + sRGB (correct)
 * so the same sky mesh can be the visible backdrop and the light source.
 */

import * as THREE from 'three';
import { qualityProfile } from './renderer.js';

const DEG = Math.PI / 180;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/* ======================================================================== */
/* Sun direction                                                             */
/* ======================================================================== */

/**
 * Compass bearing -> world direction *towards* the sun.
 *
 * CONVENTIONS §1: +X = east, +Z = south (street/front), so north is −Z.
 * `azimuth` is therefore a plain compass bearing in degrees:
 *   0 = north (backyard side), 90 = east (+X), 180 = south (street), 270 = west.
 *
 * @param {number} azimuth   degrees
 * @param {number} elevation degrees above the horizon
 * @param {THREE.Vector3} [out]
 */
export function sunDirection(azimuth, elevation, out = new THREE.Vector3()) {
  const a = azimuth * DEG;
  const e = elevation * DEG;
  const ce = Math.cos(e);
  return out.set(ce * Math.sin(a), Math.sin(e), -ce * Math.cos(a)).normalize();
}

/**
 * Atmospheric transmittance of direct sunlight, normalised so the brightest
 * channel is 1. Reddens hard near the horizon, which is what sells a late
 * afternoon listing shoot.
 */
export function sunTransmittance(elevation, turbidity = 2.6) {
  const elDeg = Math.max(elevation, -1.5);
  const el = elDeg * DEG;
  // Kasten-Young relative optical air mass.
  const m = 1 / (Math.sin(el) + 0.1500 * Math.pow(elDeg + 3.885, -1.253));
  const airmass = clamp(m, 1, 38);

  // Rayleigh optical depth, tau = 0.0088 * lambda^-4.15 (lambda in micron).
  const tauR = [0.0422, 0.1205, 0.2033];
  // Aerosol (Angstrom) with alpha = 1.3, scaled by turbidity.
  const aer = [1.635, 2.270, 2.680];
  const beta = 0.021 * Math.max(turbidity - 1, 0);

  const t = [0, 0, 0];
  let mx = 0;
  for (let i = 0; i < 3; i++) {
    t[i] = Math.exp(-(tauR[i] + (beta * aer[i]) / aer[1]) * airmass);
    if (t[i] > mx) mx = t[i];
  }
  if (mx <= 0) return { rgb: [1, 1, 1], attenuation: 0, airmass };
  return { rgb: [t[0] / mx, t[1] / mx, t[2] / mx], attenuation: mx, airmass };
}

/* ======================================================================== */
/* Sky shader                                                                */
/* ======================================================================== */

const SKY_VERT = /* glsl */ `
varying vec3 vWorldPos;
void main() {
  vec4 wp = modelMatrix * vec4( position, 1.0 );
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const SKY_FRAG = /* glsl */ `
uniform vec3  uZenith;
uniform vec3  uHorizon;
uniform vec3  uGround;
uniform vec3  uSunColor;
uniform vec3  uSunDir;
uniform float uSunDisc;
uniform float uSunAngular;   // radians, angular RADIUS of the disc
uniform float uGlow;
uniform float uGlowPower;
uniform float uGradient;
uniform float uHaze;
uniform float uIntensity;

varying vec3 vWorldPos;

void main() {
  vec3 dir = normalize( vWorldPos - cameraPosition );

  float up    = clamp( dir.y, -1.0, 1.0 );
  float cosG  = clamp( dot( dir, uSunDir ), -1.0, 1.0 );

  // Vertical gradient: dense warm haze at the horizon, thin blue at zenith.
  float t = pow( clamp( up, 0.0, 1.0 ), uGradient );
  vec3 col = mix( uHorizon, uZenith, t );

  // Broad forward-scattered halo around the sun (Mie).
  float mie = pow( max( cosG, 0.0 ), uGlowPower );
  col += uSunColor * ( uGlow * mie );

  // Extra haze low in the sky on the sun side.
  float lowHaze = pow( 1.0 - clamp( up, 0.0, 1.0 ), 6.0 ) * ( 0.35 + 0.65 * max( cosG, 0.0 ) );
  col += uSunColor * ( uHaze * lowHaze );

  // The disc itself, softened by one angular radius so PMREM has something to
  // filter instead of a single hot texel.
  float ang  = acos( cosG );
  float disc = 1.0 - smoothstep( uSunAngular * 0.55, uSunAngular * 1.6, ang );
  col += uSunColor * ( uSunDisc * disc );

  // Ground half: lawn / paving bounce, so nothing in the scene is lit from a
  // black lower hemisphere.
  float g = smoothstep( 0.004, -0.05, up );
  col = mix( col, uGround, g );

  gl_FragColor = vec4( col * uIntensity, 1.0 );

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/**
 * Procedural daylight environment.
 *
 * @param {THREE.WebGLRenderer} renderer
 * @param {object} o
 * @param {number} [o.sunAzimuth=196]    compass degrees (see sunDirection)
 * @param {number} [o.sunElevation=46]   degrees above horizon
 * @param {number} [o.turbidity=2.6]     1 = arctic clear, 10 = summer smog
 * @param {number} [o.intensity=1.0]     master multiplier on the whole sky
 * @param {number|THREE.Color} [o.groundColor=0x5c5a4e]
 * @param {number} [o.sunDisc=55]        disc radiance multiplier
 * @param {number} [o.resolution]        PMREM cube size; defaults per quality
 * @param {number} [o.skyRadius=3000]    size of the visible backdrop mesh, ft
 * @param {'high'|'medium'|'draft'|'thumb'} [o.quality]
 * @returns {{envTexture: THREE.Texture, skyMesh: THREE.Mesh,
 *            sunDirection: THREE.Vector3, sunColor: THREE.Color,
 *            renderTarget: THREE.WebGLRenderTarget, uniforms: object,
 *            update(patch): void, dispose(): void}}
 */
export function makeSkyEnv(renderer, {
  sunAzimuth = 196,
  sunElevation = 46,
  turbidity = 2.6,
  intensity = 1.0,
  groundColor = 0x5c5a4e,
  sunDisc = 55,
  resolution,
  skyRadius = 3000,
  quality,
} = {}) {
  const profile = qualityProfile(quality || (renderer && renderer.userData && renderer.userData.quality));
  const res = resolution || profile.envResolution;

  const dir = sunDirection(sunAzimuth, sunElevation);
  const trans = sunTransmittance(sunElevation, turbidity);

  // Pale/blue balance: more turbidity -> whiter sky, higher sun -> deeper blue.
  const paleness = clamp((turbidity - 1) / 9, 0, 1);
  const elevF = clamp(sunElevation / 60, 0, 1);

  const zenith = new THREE.Color().setRGB(
    THREE.MathUtils.lerp(0.075, 0.30, paleness) * THREE.MathUtils.lerp(0.55, 1.0, elevF),
    THREE.MathUtils.lerp(0.185, 0.36, paleness) * THREE.MathUtils.lerp(0.60, 1.0, elevF),
    THREE.MathUtils.lerp(0.480, 0.62, paleness) * THREE.MathUtils.lerp(0.75, 1.0, elevF),
    THREE.LinearSRGBColorSpace
  );
  const horizon = new THREE.Color().setRGB(
    THREE.MathUtils.lerp(0.62, 0.90, paleness) * (0.55 + 0.45 * elevF) * (0.75 + 0.25 * trans.rgb[0]),
    THREE.MathUtils.lerp(0.68, 0.90, paleness) * (0.55 + 0.45 * elevF) * (0.75 + 0.25 * trans.rgb[1]),
    THREE.MathUtils.lerp(0.80, 0.94, paleness) * (0.55 + 0.45 * elevF) * (0.75 + 0.25 * trans.rgb[2]),
    THREE.LinearSRGBColorSpace
  );
  const sunColor = new THREE.Color().setRGB(
    trans.rgb[0], trans.rgb[1], trans.rgb[2], THREE.LinearSRGBColorSpace
  );
  const ground = new THREE.Color(groundColor).convertSRGBToLinear().multiplyScalar(0.55);

  const uniforms = {
    uZenith: { value: zenith },
    uHorizon: { value: horizon },
    uGround: { value: ground },
    uSunColor: { value: sunColor },
    uSunDir: { value: dir.clone() },
    uSunDisc: { value: sunDisc * trans.attenuation },
    uSunAngular: { value: 1.6 * DEG },
    uGlow: { value: 0.30 },
    uGlowPower: { value: 70.0 },
    uGradient: { value: 0.55 },
    uHaze: { value: 0.16 },
    uIntensity: { value: intensity },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
    fog: false,
    toneMapped: true,
  });

  /* ---- PMREM ---------------------------------------------------------- */
  const capture = new THREE.Mesh(new THREE.BoxGeometry(20, 20, 20), material);
  capture.frustumCulled = false;
  const captureScene = new THREE.Scene();
  captureScene.add(capture);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const renderTarget = pmrem.fromScene(captureScene, 0.0, 0.1, 100, { size: res });
  pmrem.dispose();

  const envTexture = renderTarget.texture;
  envTexture.name = 'skyEnv';

  /* ---- the visible backdrop ------------------------------------------- */
  const skyMesh = new THREE.Mesh(new THREE.SphereGeometry(skyRadius, 48, 24), material);
  skyMesh.name = 'sky';
  skyMesh.frustumCulled = false;
  skyMesh.renderOrder = -1000;
  skyMesh.matrixAutoUpdate = false;
  skyMesh.updateMatrix();

  captureScene.remove(capture);
  capture.geometry.dispose();

  return {
    envTexture,
    renderTarget,
    skyMesh,
    material,
    uniforms,
    sunDirection: dir.clone(),
    sunColor,
    sunAzimuth,
    sunElevation,
    turbidity,
    /** Tweak uniforms live (does NOT re-bake the PMREM; call rebake for that). */
    update(patch = {}) {
      for (const [k, v] of Object.entries(patch)) {
        if (!uniforms[k]) continue;
        const u = uniforms[k].value;
        if (u && u.isColor) u.set(v);
        else if (u && u.isVector3 && Array.isArray(v)) u.set(v[0], v[1], v[2]);
        else uniforms[k].value = v;
      }
    },
    dispose() {
      renderTarget.dispose();
      material.dispose();
      skyMesh.geometry.dispose();
    },
  };
}

/* ======================================================================== */
/* Indoor bounce environment                                                 */
/* ======================================================================== */

const ROOM_FRAG = /* glsl */ `
uniform vec3  uCeiling;
uniform vec3  uWall;
uniform vec3  uFloor;
uniform vec3  uWindow;
uniform vec3  uWindowDir;
uniform float uWindowTight;
uniform float uIntensity;

varying vec3 vWorldPos;

void main() {
  vec3 dir = normalize( vWorldPos - cameraPosition );
  float up = clamp( dir.y, -1.0, 1.0 );

  // Ceiling plane (bright — every fixture is switched on), walls, then the
  // floor, which is always the darkest surface in a real room.
  vec3 col = uWall;
  col = mix( col, uCeiling, smoothstep( 0.16, 0.70, up ) );
  col = mix( col, uFloor,   smoothstep( -0.10, -0.62, up ) );

  // One bright window wall so the bounce has a direction instead of being a
  // flat grey dome. Horizontal lobe, gently faded above and below the head.
  vec3 hdir = normalize( vec3( dir.x + 1e-5, 0.0, dir.z + 1e-5 ) );
  float w = pow( max( dot( hdir, normalize( uWindowDir ) ), 0.0 ), uWindowTight );
  w *= 1.0 - smoothstep( 0.10, 0.62, abs( up ) );
  col += uWindow * w;

  gl_FragColor = vec4( col * uIntensity, 1.0 );

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/**
 * RoomEnvironment-like interior bounce map.
 *
 * @param {THREE.WebGLRenderer} renderer
 * @param {object} o
 * @param {number|string|THREE.Color} [o.wallColor=0xf2f0ec]
 * @param {number|string|THREE.Color} [o.floorColor=0xb08856]
 * @param {number|string|THREE.Color} [o.ceilingColor=0xffffff]
 * @param {number|string|THREE.Color} [o.windowColor=0xdce7f5]
 * @param {number} [o.intensity=1.0]      master multiplier
 * @param {number} [o.ceilingBoost=1.35]  fixtures on
 * @param {number} [o.floorFactor=0.42]
 * @param {number} [o.windowIntensity=1.6] 0 disables the window lobe
 * @param {number[]} [o.windowDir=[0,0,-1]] horizontal direction of the glass
 * @param {number} [o.windowTight=2.2]
 * @param {number} [o.resolution]
 * @param {number} [o.blur=0.035]         PMREM sigma
 * @returns {{envTexture, renderTarget, uniforms, dispose()}}
 */
export function makeIndoorEnv(renderer, {
  wallColor = 0xf2f0ec,
  floorColor = 0xb08856,
  ceilingColor = 0xffffff,
  windowColor = 0xdce7f5,
  intensity = 1.0,
  ceilingBoost = 1.35,
  wallFactor = 0.78,
  floorFactor = 0.42,
  windowIntensity = 1.6,
  windowDir = [0, 0, -1],
  windowTight = 2.2,
  resolution,
  blur = 0.035,
  quality,
} = {}) {
  const profile = qualityProfile(quality || (renderer && renderer.userData && renderer.userData.quality));
  const res = resolution || profile.envResolution;

  const lin = (c, k) => new THREE.Color(c).convertSRGBToLinear().multiplyScalar(k);

  const uniforms = {
    uCeiling: { value: lin(ceilingColor, ceilingBoost) },
    uWall: { value: lin(wallColor, wallFactor) },
    uFloor: { value: lin(floorColor, floorFactor) },
    uWindow: { value: lin(windowColor, windowIntensity) },
    uWindowDir: { value: new THREE.Vector3(windowDir[0], 0, windowDir[2]).normalize() },
    uWindowTight: { value: windowTight },
    uIntensity: { value: intensity },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: SKY_VERT,
    fragmentShader: ROOM_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    toneMapped: true,
  });

  const box = new THREE.Mesh(new THREE.BoxGeometry(20, 20, 20), material);
  box.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(box);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const renderTarget = pmrem.fromScene(scene, blur, 0.1, 100, { size: res });
  pmrem.dispose();

  const envTexture = renderTarget.texture;
  envTexture.name = 'indoorEnv';

  scene.remove(box);
  box.geometry.dispose();
  material.dispose();

  return {
    envTexture,
    renderTarget,
    uniforms,
    dispose() {
      renderTarget.dispose();
    },
  };
}

/* ======================================================================== */
/* Attaching                                                                 */
/* ======================================================================== */

/**
 * Put an environment map on a scene, with the intensity knob three exposes
 * on Scene (r163+) so we do not have to touch every material.
 *
 * @param {THREE.Scene} scene
 * @param {THREE.Texture} envTexture
 * @param {object} [o]
 * @param {number}  [o.intensity=1]
 * @param {boolean|THREE.Texture|THREE.Mesh} [o.background=false]
 * @param {number}  [o.rotationY=0] radians
 */
export function applyEnvironment(scene, envTexture, { intensity = 1, background = false, rotationY = 0 } = {}) {
  scene.environment = envTexture;
  scene.environmentIntensity = intensity;
  if (rotationY) {
    scene.environmentRotation = new THREE.Euler(0, rotationY, 0);
  }
  if (background === true) {
    scene.background = envTexture;
    scene.backgroundIntensity = intensity;
    if (rotationY) scene.backgroundRotation = new THREE.Euler(0, rotationY, 0);
  } else if (background && background.isTexture) {
    scene.background = background;
  } else if (background && background.isObject3D) {
    scene.add(background);
  }
  return scene;
}

export default { makeSkyEnv, makeIndoorEnv, applyEnvironment, sunDirection, sunTransmittance };
