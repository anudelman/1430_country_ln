/**
 * renderer.js — the one and only WebGLRenderer factory for 1430 Country Ln.
 *
 * Locked settings (docs/CONVENTIONS.md §6):
 *   THREE.ColorManagement.enabled = true
 *   renderer.outputColorSpace     = SRGBColorSpace
 *   renderer.toneMapping          = ACESFilmicToneMapping
 *   renderer.shadowMap.type       = PCFSoftShadowMap
 *   shadow maps 2048 (high) / 1024 (draft)
 *   preserveDrawingBuffer = true   (the screenshot harness reads the canvas back)
 *   pixelRatio clamped             (software GL in CI must not render 4x)
 *
 * Nothing else in the project is allowed to construct a WebGLRenderer.
 *
 *   import { createRenderer, renderFrame } from './core/renderer.js';
 *   const renderer = createRenderer({ canvas, quality: 'high' });
 *   renderFrame(renderer, scene, camera, composer);   // composer may be null
 */

import * as THREE from 'three';

THREE.ColorManagement.enabled = true;

/* ======================================================================== */
/* Quality profiles                                                          */
/* ======================================================================== */

/**
 * Every knob that scales with quality lives here so lighting.js, post.js and
 * the room modules all agree about what "draft" means.
 *
 *  shadowMapSize  directional / spot shadow map resolution
 *  maxPixelRatio  hard clamp on renderer.setPixelRatio
 *  anisotropy     requested texture anisotropy (clamped to hardware max)
 *  envResolution  PMREM cubemap size used by env.js
 *  bloom          whether post.js instantiates UnrealBloomPass at all
 *  softShadows    whether spot/can lights are allowed to cast shadows
 *  maxShadowCasters  budget of shadow-casting artificial lights per scene
 */
export const QUALITY_PROFILES = Object.freeze({
  high: Object.freeze({
    name: 'high',
    shadowMapSize: 2048,
    maxPixelRatio: 2,
    anisotropy: 16,
    envResolution: 256,
    bloom: true,
    softShadows: true,
    shadowRadius: 3.0,
    maxShadowCasters: 6,
  }),
  medium: Object.freeze({
    name: 'medium',
    shadowMapSize: 1536,
    maxPixelRatio: 1.75,
    anisotropy: 8,
    envResolution: 192,
    bloom: true,
    softShadows: true,
    shadowRadius: 2.5,
    maxShadowCasters: 3,
  }),
  draft: Object.freeze({
    name: 'draft',
    shadowMapSize: 1024,
    maxPixelRatio: 1.25,
    anisotropy: 4,
    envResolution: 128,
    bloom: true,
    softShadows: false,
    shadowRadius: 2.0,
    maxShadowCasters: 0,
  }),
  thumb: Object.freeze({
    name: 'thumb',
    shadowMapSize: 512,
    maxPixelRatio: 1,
    anisotropy: 2,
    envResolution: 64,
    bloom: false,
    softShadows: false,
    shadowRadius: 1.5,
    maxShadowCasters: 0,
  }),
});

/** Resolve a quality name (or a renderer, or a profile) to a profile object. */
export function qualityProfile(quality) {
  if (!quality) return QUALITY_PROFILES.high;
  if (typeof quality === 'object') {
    if (quality.isWebGLRenderer) {
      return (quality.userData && quality.userData.profile) || QUALITY_PROFILES.high;
    }
    if (quality.shadowMapSize) return quality;
    if (quality.quality) return qualityProfile(quality.quality);
    return QUALITY_PROFILES.high;
  }
  return QUALITY_PROFILES[quality] || QUALITY_PROFILES.high;
}

/** Shadow map edge length for a quality name. 2048 high, 1024 draft. */
export function shadowMapSize(quality) {
  return qualityProfile(quality).shadowMapSize;
}

/* ======================================================================== */
/* Renderer                                                                  */
/* ======================================================================== */

function pickCanvas(canvas) {
  if (canvas) return canvas;
  if (typeof document === 'undefined') {
    throw new Error('createRenderer: no canvas given and no document to create one');
  }
  return document.createElement('canvas');
}

/**
 * Build the project renderer.
 *
 * @param {object}   o
 * @param {HTMLCanvasElement} [o.canvas]     target canvas (created if omitted)
 * @param {'high'|'medium'|'draft'|'thumb'} [o.quality='high']
 * @param {number}   [o.width]               CSS pixels; defaults to canvas size
 * @param {number}   [o.height]
 * @param {number}   [o.pixelRatio]          override; still clamped by profile
 * @param {number}   [o.exposure=1.0]        renderer.toneMappingExposure
 * @param {boolean}  [o.alpha=false]
 * @param {boolean}  [o.antialias=true]
 * @param {boolean}  [o.shadows=true]
 * @param {boolean}  [o.preserveDrawingBuffer=true]
 * @param {boolean}  [o.updateStyle=false]   let three write canvas.style.width
 * @param {string}   [o.powerPreference='high-performance']
 * @returns {THREE.WebGLRenderer}
 */
export function createRenderer({
  canvas,
  quality = 'high',
  width,
  height,
  pixelRatio,
  exposure = 1.0,
  alpha = false,
  antialias = true,
  shadows = true,
  preserveDrawingBuffer = true,
  updateStyle = false,
  powerPreference = 'high-performance',
  clearColor = 0x000000,
  clearAlpha = 0,
} = {}) {
  const profile = qualityProfile(quality);
  const cv = pickCanvas(canvas);

  const renderer = new THREE.WebGLRenderer({
    canvas: cv,
    antialias,
    alpha,
    // Mandatory: tools/shoot.mjs and tools/render_probe.mjs read the canvas
    // back with toDataURL() long after the draw call has returned.
    preserveDrawingBuffer,
    powerPreference,
    stencil: false,
    depth: true,
    premultipliedAlpha: true,
    failIfMajorPerformanceCaveat: false,
  });

  /* ---- colour pipeline ------------------------------------------------ */
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = exposure;

  /* ---- shadows -------------------------------------------------------- */
  renderer.shadowMap.enabled = !!shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = true;

  /* ---- misc ----------------------------------------------------------- */
  renderer.setClearColor(new THREE.Color(clearColor), clearAlpha);
  renderer.autoClear = true;
  renderer.info.autoReset = true;
  renderer.localClippingEnabled = false;

  /* ---- size + pixel ratio --------------------------------------------- */
  const dpr = pixelRatio !== undefined
    ? pixelRatio
    : (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  renderer.setPixelRatio(Math.max(0.5, Math.min(dpr, profile.maxPixelRatio)));

  const w = width || cv.width || 1200;
  const h = height || cv.height || 800;
  renderer.setSize(w, h, updateStyle);

  renderer.userData = renderer.userData || {};
  renderer.userData.quality = profile.name;
  renderer.userData.profile = profile;
  renderer.userData.maxAnisotropy = Math.min(
    profile.anisotropy,
    renderer.capabilities.getMaxAnisotropy()
  );
  renderer.userData.updateStyle = updateStyle;

  return renderer;
}

/**
 * Render one frame, with or without a post chain.
 *
 * With a composer the scene is rendered linear-HDR into the composer's
 * half-float buffers and post.js does tone mapping + sRGB encoding at the end
 * of the chain, so the renderer's own toneMappingExposure is forwarded to the
 * composer here to keep both paths exposure-identical.
 *
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.Scene} scene
 * @param {THREE.Camera} camera
 * @param {import('../../vendor/three/postprocessing/EffectComposer.js').EffectComposer|null} [composer]
 * @param {number} [dt=1/60] seconds, only used to animate film grain
 */
export function renderFrame(renderer, scene, camera, composer, dt = 1 / 60) {
  if (!renderer) throw new Error('renderFrame: renderer is required');
  if (!scene || !camera) throw new Error('renderFrame: scene and camera are required');

  if (composer && typeof composer.render === 'function') {
    const ud = composer.userData;
    if (ud) {
      // Keep the composer pointed at the camera actually being drawn.
      if (ud.renderPass && ud.renderPass.camera !== camera) ud.renderPass.camera = camera;
      if (ud.renderPass && ud.renderPass.scene !== scene) ud.renderPass.scene = scene;
      const u = ud.photoPass && ud.photoPass.uniforms;
      if (u) {
        u.uExposure.value = renderer.toneMappingExposure;
        if (ud.animateGrain) u.uSeed.value = (u.uSeed.value + dt * 37.13) % 1000;
      }
    }
    composer.render(dt);
    return;
  }

  renderer.render(scene, camera);
}

/**
 * Resize renderer + (optionally) camera aspect and composer buffers together.
 * The camera is expected to be a shift camera from camera.js; its off-axis
 * projection is rebuilt through its own updateProjectionMatrix override.
 */
export function setRenderSize(renderer, width, height, { camera, composer } = {}) {
  renderer.setSize(width, height, renderer.userData && renderer.userData.updateStyle);
  if (camera) {
    if (camera.isPerspectiveCamera) camera.aspect = width / height;
    if (camera.userData && camera.userData.shiftLens) camera.userData.shiftLens.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  if (composer && typeof composer.setSize === 'function') {
    composer.setSize(width, height);
    const u = composer.userData && composer.userData.photoPass && composer.userData.photoPass.uniforms;
    if (u && u.uResolution) u.uResolution.value.set(width, height);
  }
}

/** Set exposure in one place; the post chain follows on the next frame. */
export function setExposure(renderer, exposure, composer) {
  renderer.toneMappingExposure = exposure;
  const u = composer && composer.userData && composer.userData.photoPass
    && composer.userData.photoPass.uniforms;
  if (u && u.uExposure) u.uExposure.value = exposure;
  return exposure;
}

/**
 * PNG data URL of the last rendered frame. Requires preserveDrawingBuffer,
 * which createRenderer sets by default.
 */
export function captureDataURL(renderer, type = 'image/png', quality) {
  return renderer.domElement.toDataURL(type, quality);
}

/** Free GPU resources held by the renderer (and composer, if given). */
export function disposeRenderer(renderer, composer) {
  if (composer && typeof composer.dispose === 'function') composer.dispose();
  if (renderer) {
    renderer.shadowMap.enabled = false;
    renderer.dispose();
    if (renderer.forceContextLoss) {
      try {
        renderer.forceContextLoss();
      } catch (e) {
        /* context may already be gone */
      }
    }
  }
}

export default createRenderer;
