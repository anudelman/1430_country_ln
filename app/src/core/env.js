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
uniform float uCirrus;
uniform vec2  uCirrusDir;

varying vec3 vWorldPos;

/* --- value noise + fbm, for the thin high cirrus ---------------------- */
float vhash( vec2 p ) {
  return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453123 );
}
float vnoise( vec2 p ) {
  vec2 i = floor( p ), f = fract( p );
  vec2 u = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( vhash( i ), vhash( i + vec2( 1.0, 0.0 ) ), u.x ),
              mix( vhash( i + vec2( 0.0, 1.0 ) ), vhash( i + vec2( 1.0, 1.0 ) ), u.x ), u.y );
}
float fbm2( vec2 p ) {
  float a = 0.5, s = 0.0;
  for ( int i = 0; i < 5; i++ ) { s += a * vnoise( p ); p *= 2.03; a *= 0.5; }
  return s;
}

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

  // Thin, streaky high cirrus. Every exterior in the reference set has a few
  // faint horsetail wisps in the upper sky; a perfectly clean gradient is a
  // tell all by itself. Projected onto a flat "cloud deck" so the streaks
  // converge toward the horizon the way real cirrus does.
  if ( uCirrus > 0.0 && up > 0.02 ) {
    vec2 cp = dir.xz / max( up, 0.02 );
    cp = vec2( dot( cp, uCirrusDir ), dot( cp, vec2( -uCirrusDir.y, uCirrusDir.x ) ) );
    float f = fbm2( vec2( cp.x * 0.09, cp.y * 0.55 ) + 11.0 );
    float wisp = smoothstep( 0.54, 0.86, f ) * smoothstep( 0.02, 0.35, up )
               * ( 1.0 - smoothstep( 0.62, 1.0, up ) * 0.55 );
    col = mix( col, col + uSunColor * 0.55 + vec3( 0.10, 0.12, 0.14 ), wisp * uCirrus );
  }

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
 * @param {number} [o.radianceScale=1.25] absolute brightness anchor: puts the
 *        zenith at ~0.6 and the horizon at ~1.0 linear, which is the ratio a
 *        listing photo shows between open sky and a sunlit white wall
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
  radianceScale = 1.25,
  groundColor = 0x5c5a4e,
  sunDisc = 55,
  resolution,
  skyRadius = 3000,
  quality,
  /** Thin high cirrus, 0 = none. The reference exteriors read ~0.30. */
  cirrus = 0.30,
  /** Bearing the wisps run along, radians. */
  cirrusAngle = 0.62,
} = {}) {
  const profile = qualityProfile(quality || (renderer && renderer.userData && renderer.userData.quality));
  const res = resolution || profile.envResolution;

  const dir = sunDirection(sunAzimuth, sunElevation);
  const trans = sunTransmittance(sunElevation, turbidity);

  // Pale/blue balance: more turbidity -> whiter sky, higher sun -> deeper blue.
  const paleness = clamp((turbidity - 1) / 9, 0, 1);
  const elevF = clamp(sunElevation / 60, 0, 1);

  // MEASURED against straight_on_view_of_house_from_street.png:
  //   top of frame (up ~0.47)  R 130 / G 171 / B 254, blue channel CLIPPED
  //   lower sky   (up ~0.30)   R 155 / G 187 / B 252
  // i.e. a deep, strongly blue-dominant sky that only pales in the last few
  // degrees above the treeline. The previous constants put a near-white
  // horizon 35% of the way up the frame, which read as an overcast haze.
  const K = radianceScale;
  const zenith = new THREE.Color().setRGB(
    K * THREE.MathUtils.lerp(0.190, 0.40, paleness) * THREE.MathUtils.lerp(0.55, 1.0, elevF),
    K * THREE.MathUtils.lerp(0.460, 0.62, paleness) * THREE.MathUtils.lerp(0.60, 1.0, elevF),
    K * THREE.MathUtils.lerp(1.420, 1.42, paleness) * THREE.MathUtils.lerp(0.75, 1.0, elevF),
    THREE.LinearSRGBColorSpace
  );
  const horizon = new THREE.Color().setRGB(
    K * THREE.MathUtils.lerp(0.50, 0.78, paleness) * (0.55 + 0.45 * elevF) * (0.75 + 0.25 * trans.rgb[0]),
    K * THREE.MathUtils.lerp(0.66, 0.86, paleness) * (0.55 + 0.45 * elevF) * (0.75 + 0.25 * trans.rgb[1]),
    K * THREE.MathUtils.lerp(1.30, 1.42, paleness) * (0.55 + 0.45 * elevF) * (0.75 + 0.25 * trans.rgb[2]),
    THREE.LinearSRGBColorSpace
  );
  const sunColor = new THREE.Color().setRGB(
    trans.rgb[0], trans.rgb[1], trans.rgb[2], THREE.LinearSRGBColorSpace
  );
  const ground = new THREE.Color(groundColor).convertSRGBToLinear().multiplyScalar(0.55 * K);

  const uniforms = {
    uZenith: { value: zenith },
    uHorizon: { value: horizon },
    uGround: { value: ground },
    uSunColor: { value: sunColor },
    uSunDir: { value: dir.clone() },
    uSunDisc: { value: sunDisc * trans.attenuation * K },
    uSunAngular: { value: 1.6 * DEG },
    uGlow: { value: 0.30 },
    uGlowPower: { value: 70.0 },
    uGradient: { value: 0.42 },
    uHaze: { value: 0.16 },
    uIntensity: { value: intensity },
    uCirrus: { value: cirrus },
    uCirrusDir: { value: new THREE.Vector2(Math.cos(cirrusAngle), Math.sin(cirrusAngle)) },
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
  // Unit sphere: onBeforeRender re-centres it on the camera and scales it to
  // sit just inside the far plane, so the backdrop can never be clipped away
  // no matter what `far` a preset uses.
  const skyMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), material);
  skyMesh.name = 'sky';
  skyMesh.frustumCulled = false;
  skyMesh.renderOrder = -1000;
  skyMesh.userData.maxRadius = skyRadius;
  skyMesh.onBeforeRender = function (rnd, scn, cam) {
    // onBeforeRender runs before three computes modelViewMatrix, so updating
    // matrixWorld here is picked up by this very draw call.
    const r = Math.min(skyMesh.userData.maxRadius, (cam.far || 1000) * 0.48);
    this.position.copy(cam.position);
    this.scale.setScalar(r);
    this.updateMatrixWorld(true);
  };

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
 * @param {number} [o.ceilingBoost=0.45]  fixtures on
 * @param {number} [o.floorFactor=0.15]
 * @param {number} [o.windowIntensity=0.80] 0 disables the window lobe
 *
 * The absolute level is a compromise the whole project depends on: the map is
 * BOTH the indirect-diffuse source and the specular reflection source. Set to
 * the true radiance of a lit room (~0.4) it double-counts against
 * bakeAmbientFill; set to a pure bounce fraction, chrome and brass go dead.
 * These numbers sit between the two — raise them and lower `fill.intensity`
 * together if a room needs livelier metal.
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
  ceilingBoost = 0.45,
  wallFactor = 0.30,
  floorFactor = 0.15,
  windowIntensity = 0.80,
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

/* ======================================================================== */
/* Captured environment — a real reflection of the room                      */
/* ======================================================================== */

/**
 * Replace the synthetic room box with an environment captured FROM the built
 * scene, so reflective surfaces reflect the actual room.
 *
 * `makeIndoorEnv` above is a hand-tuned emissive box: a bright ceiling, mid
 * walls, a darker floor and one bright "window" side. It is a decent stand-in
 * for diffuse ambient and a poor one for specular — which is precisely the
 * recorded critic gap on the kitchen: *"flat untextured stainless with no
 * environment reflection."* Stainless reflecting a smooth gradient cannot look
 * like stainless reflecting a room.
 *
 * This renders the real scene into a cube map, runs it through PMREM and hands
 * back an environment texture. Running it twice is worth the second pass: the
 * second capture sees the first capture's contribution, which is a crude but
 * genuine one-bounce of indirect light — the ceiling picks up floor colour the
 * way it does in the photographs, instead of the way it was hand-tuned to.
 *
 * Cost is 6 scene renders per iteration, once, at scene build. Zero per frame.
 *
 * `iterations` defaults to 1, i.e. the bounce is OFF. Capturing with tone
 * mapping disabled (which is required, or the grade bakes into the reflection
 * and is then applied a second time) leaves radiance unbounded, and a second
 * pass that re-reflects the first one overflowed the half-float cube target's
 * 65504 ceiling to Inf. PMREM's blur then smeared NaN across every texel and
 * the whole scene shaded black. One capture already replaces a flat gradient
 * with the real room, which is the point; re-enable the bounce only alongside
 * a clamp on the captured radiance.
 *
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.Scene} scene       must already have its geometry and lights
 * @param {object} [o]
 * @param {number[]} [o.position=[0,0,0]] capture point, world feet
 * @param {number} [o.resolution=256]     cube face size
 * @param {number} [o.iterations=1]       >1 adds a bounce; see the note above
 * @param {number} [o.near=0.1]
 * @param {number} [o.far=400]
 * @returns {{envTexture:THREE.Texture, renderTarget:THREE.WebGLRenderTarget, dispose:function}}
 */
/** Sun-disc radiance ceiling during an env capture; see captureSceneEnv. */
const SUN_DISC_CAPTURE_CAP = 250;

const DEBUG_CAPTURE = typeof location !== 'undefined' && /envdbg=1/.test(location.search);

export function captureSceneEnv(renderer, scene, {
  position = [0, 0, 0],
  resolution = 256,
  iterations = 1,
  near = 0.1,
  far = 400,
} = {}) {
  if (!renderer || !scene) throw new Error('captureSceneEnv: renderer and scene are required');

  // The capture is linear and unbounded whatever the renderer's tone mapping
  // says — three only applies tone mapping when drawing to the canvas, never
  // to a render target. So the sun disc arrives at full physical magnitude,
  // overflows the half-float cube target's 65504 ceiling to +Inf, and PMREM's
  // lowest mip averages the entire cube: a handful of Inf texels become NaN
  // irradiance on every surface and the whole render goes black. Four Inf
  // texels out of 16384 were enough to do it.
  //
  // Clamping the disc for the duration of the capture is the cheapest correct
  // fix. A mirror-sharp sun in a kitchen reflection is worth nothing here, and
  // the sky gradient — which is what the room actually bounces — is untouched.
  const suns = [];
  scene.traverse((o) => {
    const u = o.material && o.material.uniforms;
    if (u && u.uSunDisc && typeof u.uSunDisc.value === 'number') {
      suns.push({ u: u.uSunDisc, was: u.uSunDisc.value });
      u.uSunDisc.value = Math.min(u.uSunDisc.value, SUN_DISC_CAPTURE_CAP);
    }
  });

  // Shadow maps are frozen in walk mode; capturing before they are drawn would
  // bake a fully-lit room into the reflections.
  const prevShadowAuto = renderer.shadowMap.autoUpdate;
  renderer.shadowMap.needsUpdate = true;

  const spent = [];
  let out = null;

  try {
    for (let i = 0; i < Math.max(1, iterations); i++) {
      // The PMREM generator is built per iteration, AFTER the cube render, and
      // disposed before the cube target is released. Hoisting it out of the
      // loop (or freeing the cube first) produced NaN in the filtered output —
      // a valid cube went in and a black environment came out.
      let pmrem = null;
      const cubeRT = new THREE.WebGLCubeRenderTarget(resolution, {
        type: THREE.HalfFloatType,
        colorSpace: THREE.LinearSRGBColorSpace,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        generateMipmaps: false,
      });
      const cam = new THREE.CubeCamera(near, far, cubeRT);
      cam.position.set(position[0], position[1], position[2]);
      cam.updateMatrixWorld(true);
      cam.update(renderer, scene);

      if (DEBUG_CAPTURE) {
        const buf = new Uint16Array(resolution * resolution * 4);
        try {
          renderer.readRenderTargetPixels(cubeRT, 0, 0, resolution, resolution, buf, 0);
          let s = 0;
          for (let k = 0; k < buf.length; k += 4) s += buf[k];
          let lights = 0;
          scene.traverse((o) => { if (o.isLight && o.visible) lights++; });
          console.log(`[env dbg] iter ${i} face0 mean=${(s / (buf.length / 4)).toFixed(1)} ` +
            `lights=${lights} children=${scene.children.length} tm=${renderer.toneMapping}`);
        } catch (e) { console.log('[env dbg] readback failed: ' + e.message); }
      }
      pmrem = new THREE.PMREMGenerator(renderer);
      const rt = pmrem.fromCubemap(cubeRT.texture);
      pmrem.dispose();
      pmrem = null;
      cubeRT.dispose();

      if (DEBUG_CAPTURE) {
        const w = Math.min(64, rt.width);
        const h = Math.min(64, rt.height);
        const ob = new Uint16Array(w * h * 4);
        try {
          renderer.readRenderTargetPixels(rt, 0, 0, w, h, ob);
          let s = 0;
          let nan = 0;
          for (let k = 0; k < ob.length; k += 4) {
            s += ob[k];
            // half-float: exponent all-ones with non-zero mantissa == NaN
            if ((ob[k] & 0x7c00) === 0x7c00 && (ob[k] & 0x03ff) !== 0) nan++;
          }
          console.log(`[env dbg] iter ${i} PMREM out ${rt.width}x${rt.height} ` +
            `mean=${(s / (ob.length / 4)).toFixed(1)} nanTexels=${nan}/${ob.length / 4}`);
        } catch (e) { console.log('[env dbg] pmrem readback failed: ' + e.message); }
      }

      // Feed this pass back in so the next capture sees indirect light.
      if (out) spent.push(out.renderTarget);
      out = { renderTarget: rt, envTexture: rt.texture };
      out.envTexture.name = `capturedEnv${i}`;
      if (i < iterations - 1) {
        scene.environment = out.envTexture;
        scene.environmentIntensity = 1.0;
      }
    }
  } finally {
    for (const s2 of suns) s2.u.value = s2.was;
    renderer.shadowMap.autoUpdate = prevShadowAuto;
    for (const rt of spent) rt.dispose();
  }

  return {
    envTexture: out.envTexture,
    renderTarget: out.renderTarget,
    dispose() {
      out.renderTarget.dispose();
    },
  };
}
