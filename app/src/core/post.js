/**
 * post.js — the post chain.
 *
 * CONVENTIONS §6: mild bloom on light sources -> subtle chromatic aberration ->
 * vignette -> film grain -> highlight rolloff. Never crush blacks.
 *
 * Chain
 * -----
 *   RenderPass        scene -> linear HDR (half-float; three disables its own
 *                     tone mapping automatically when drawing to a target)
 *   UnrealBloomPass   threshold 0.9 / strength 0.25 / radius 0.4, in LINEAR,
 *                     so only genuinely bright things (lens of a can, a blown
 *                     window) bloom, exactly like a real lens
 *   PhotoFinishPass   ONE custom ShaderPass doing, in order:
 *                       radial chromatic aberration (lens)
 *                       cos^n vignette             (lens)
 *                       exposure                   (camera)
 *                       filmic highlight rolloff + highlight desaturation
 *                       ACES filmic tone map       (identical to three's)
 *                       sRGB encode
 *                       black lift + fine film grain (sensor)
 *
 * The last pass owns tone mapping and colour encoding, which is why it is
 * written in linear and outputs display-referred sRGB. That keeps the
 * composer path and the plain `renderer.render()` path exposure-identical:
 * renderer.js forwards `renderer.toneMappingExposure` into `uExposure`.
 *
 * ADDON RESOLUTION: the three examples modules this needs are COPIED into
 * `app/vendor/three/` (structure preserved, so their relative imports still
 * work) and imported by relative path. Nothing here depends on a
 * `three/addons/...` import-map entry, so the bundled single-file build and a
 * plain static server behave the same.
 */

import * as THREE from 'three';
import { EffectComposer } from '../../vendor/three/postprocessing/EffectComposer.js';
import { RenderPass } from '../../vendor/three/postprocessing/RenderPass.js';
import { ShaderPass } from '../../vendor/three/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from '../../vendor/three/postprocessing/UnrealBloomPass.js';
import { qualityProfile } from './renderer.js';

/* ======================================================================== */
/* Defaults — deliberately subtle                                            */
/* ======================================================================== */

/*
 * MEASURED, not assumed — docs/PHOTOGRAPHY.md §6.2 supersedes the earlier
 * guesses that lived here (bloom 0.25, CA 0.0016, vignette 0.16, grain 0.016).
 * All four of those were measured as ABSENT from the listing photographs, and
 * adding them makes a render EASIER to spot, not harder. The one thing the
 * photographs have that a render lacks is a 1-px unsharp halo, so that is now
 * part of the chain.
 */
export const BLOOM_DEFAULTS = Object.freeze({
  enabled: true,
  strength: 0.06,
  radius: 0.15,
  threshold: 0.98,
});

export const PHOTO_DEFAULTS = Object.freeze({
  exposure: 1.0,
  /** Lateral CA measured at <=0.03 px even at r>700 px. Keep it at zero. */
  aberration: 0.0,
  /** Radial luminance actually RISES 1.05x toward the frame edge. */
  vignette: 0.02,
  vignetteRadius: 0.62,
  /** Linear-space shoulder above `rolloffKnee`; keeps windows off pure white. */
  rolloff: 0.30,
  rolloffKnee: 0.85,
  /** Blown highlights lose saturation, the way a sensor does. */
  highlightDesat: 0.55,
  /** Fine grain amplitude in display space. Measured sigma = 0.11-0.16/255. */
  grain: 0.0008,
  /** Grain multiplier in the highlights (shadows always get the full amount). */
  grainHighlight: 0.35,
  /** Black lift — the anti-crush term. */
  lift: 0.006,
  /** Lightroom capture sharpening: radius ~0.9 px, amount ~0.55. */
  sharpen: 0.55,
  sharpenRadius: 0.9,
  saturation: 1.0,
  seed: 17.0,
  /**
   * Per-channel display-space gain, the camera's white balance.
   * ACES pushes bright neutrals warm; measured on kitchen_view_1 the render's
   * ceiling sat at [203,192,178] against the photo's neutral [189,189,189].
   * Neutralising the lights and the environment bounce did not move it, because
   * the skew is introduced by the tone mapping downstream of both. These gains
   * are 189/203, 189/192, 189/178.
   */
  whiteBalance: [0.931, 0.984, 1.062],
});

/* ======================================================================== */
/* PhotoFinishShader                                                         */
/* ======================================================================== */

export const PhotoFinishShader = {
  name: 'PhotoFinishShader',

  uniforms: {
    tDiffuse: { value: null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uExposure: { value: PHOTO_DEFAULTS.exposure },
    uAberration: { value: PHOTO_DEFAULTS.aberration },
    uVignette: { value: PHOTO_DEFAULTS.vignette },
    uVignetteRadius: { value: PHOTO_DEFAULTS.vignetteRadius },
    uRolloff: { value: PHOTO_DEFAULTS.rolloff },
    uRolloffKnee: { value: PHOTO_DEFAULTS.rolloffKnee },
    uHighlightDesat: { value: PHOTO_DEFAULTS.highlightDesat },
    uGrain: { value: PHOTO_DEFAULTS.grain },
    uGrainHighlight: { value: PHOTO_DEFAULTS.grainHighlight },
    uLift: { value: PHOTO_DEFAULTS.lift },
    uSaturation: { value: PHOTO_DEFAULTS.saturation },
    uSharpen: { value: PHOTO_DEFAULTS.sharpen },
    uSharpenRadius: { value: PHOTO_DEFAULTS.sharpenRadius },
    uSeed: { value: PHOTO_DEFAULTS.seed },
    uWhiteBalance: { value: new THREE.Vector3(...PHOTO_DEFAULTS.whiteBalance) },
  },

  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    }
  `,

  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2  uResolution;
    uniform float uExposure;
    uniform float uAberration;
    uniform float uVignette;
    uniform float uVignetteRadius;
    uniform float uRolloff;
    uniform float uRolloffKnee;
    uniform float uHighlightDesat;
    uniform float uGrain;
    uniform float uGrainHighlight;
    uniform float uLift;
    uniform float uSaturation;
    uniform float uSharpen;
    uniform float uSharpenRadius;
    uniform float uSeed;
    uniform vec3  uWhiteBalance;

    varying vec2 vUv;

    const vec3 LUMA = vec3( 0.2125, 0.7154, 0.0721 );

    // --- ACES, byte-for-byte the operator three ships, with the exposure term
    //     factored out because we apply it explicitly above. -----------------
    vec3 RRTAndODTFit( vec3 v ) {
      vec3 a = v * ( v + 0.0245786 ) - 0.000090537;
      vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081;
      return a / b;
    }

    vec3 ACESFilmic( vec3 color ) {
      const mat3 ACESInputMat = mat3(
        vec3( 0.59719, 0.07600, 0.02840 ),
        vec3( 0.35458, 0.90834, 0.13383 ),
        vec3( 0.04823, 0.01566, 0.83777 )
      );
      const mat3 ACESOutputMat = mat3(
        vec3(  1.60475, -0.10208, -0.00327 ),
        vec3( -0.53108,  1.10813, -0.07276 ),
        vec3( -0.07367, -0.00605,  1.07602 )
      );
      color /= 0.6;
      color = ACESInputMat * color;
      color = RRTAndODTFit( color );
      color = ACESOutputMat * color;
      return clamp( color, 0.0, 1.0 );
    }

    vec3 sRGBTransferOETF( vec3 c ) {
      return mix(
        pow( c, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ),
        c * 12.92,
        vec3( lessThanEqual( c, vec3( 0.0031308 ) ) )
      );
    }

    float hash21( vec2 p ) {
      vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
      p3 += dot( p3, p3.yzx + 33.33 );
      return fract( ( p3.x + p3.y ) * p3.z );
    }

    /* Fetch the linear HDR scene value with the lens applied. */
    vec3 fetch( vec2 uv ) {
      vec2 c  = uv - 0.5;
      float r2 = dot( c, c );
      float amt = uAberration * r2 * 4.0;
      vec3 col;
      if ( uAberration > 0.0 ) {
        col.r = texture2D( tDiffuse, uv + c * amt ).r;
        col.g = texture2D( tDiffuse, uv ).g;
        col.b = texture2D( tDiffuse, uv - c * amt ).b;
      } else {
        col = texture2D( tDiffuse, uv ).rgb;
      }
      col = max( col, vec3( 0.0 ) );
      float vr = clamp( r2 / max( uVignetteRadius, 1e-4 ), 0.0, 1.0 );
      return col * ( 1.0 - uVignette * pow( vr, 1.35 ) );
    }

    /* linear HDR -> display-referred sRGB. */
    vec3 grade( vec3 col ) {
      /* --- camera: exposure --------------------------------------------- */
      col *= uExposure;

      /* --- film: highlight shoulder before the tone curve --------------- */
      vec3 over = max( col - uRolloffKnee, vec3( 0.0 ) );
      col = min( col, vec3( uRolloffKnee ) ) + over / ( 1.0 + over * uRolloff );

      float lin = dot( col, LUMA );
      float hi  = smoothstep( uRolloffKnee * 0.85, uRolloffKnee * 2.8, lin );
      col = mix( col, vec3( lin ), hi * uHighlightDesat );

      /* --- tone map + display encode ------------------------------------ */
      col = ACESFilmic( col );
      col = sRGBTransferOETF( col );

      /* --- never crush blacks ------------------------------------------- */
      col += uLift * ( 1.0 - col );

      float lum = dot( col, LUMA );
      return mix( vec3( lum ), col, uSaturation );
    }

    void main() {
      vec2 uv = vUv;
      vec3 col = grade( fetch( uv ) );

      /* --- Lightroom capture sharpening --------------------------------
       * Measured on the reference set: a 140-level step carries a +36
       * overshoot at -1 px and a -24 undershoot at +1 px. Every high-contrast
       * edge in the photographs has it; a physically clean render edge does
       * not, and that alone reads as "3D". Done in DISPLAY space, which is
       * where Lightroom does it.                                            */
      if ( uSharpen > 0.0 ) {
        vec2 d = uSharpenRadius / uResolution;
        vec3 blur = grade( fetch( uv + vec2( d.x, 0.0 ) ) )
                  + grade( fetch( uv - vec2( d.x, 0.0 ) ) )
                  + grade( fetch( uv + vec2( 0.0, d.y ) ) )
                  + grade( fetch( uv - vec2( 0.0, d.y ) ) );
        col += uSharpen * ( col - blur * 0.25 );
      }

      /* --- white balance ------------------------------------------------
       * ACES skews bright neutrals warm. Measured on kitchen_view_1: the real
       * photo's ceiling is [189,189,189] — dead neutral — while the render came
       * out [203,192,178], a +25 R-B skew that survived neutralising both the
       * light colours AND the environment bounce, because it is introduced by
       * the tone mapping itself, downstream of all of them. A real camera fixes
       * exactly this with a white-balance multiplier, so we do too: per-channel
       * gain in DISPLAY space, applied after grading and sharpening.          */
      col *= uWhiteBalance;

      /* --- sensor: fine grain, heaviest in the shadows ------------------ */
      float lum = dot( col, LUMA );
      float n = hash21( gl_FragCoord.xy + vec2( uSeed, uSeed * 1.7 ) );
      col += ( n - 0.5 ) * uGrain * mix( 1.0, uGrainHighlight, lum );

      gl_FragColor = vec4( clamp( col, 0.0, 1.0 ), 1.0 );
    }
  `,
};

/* ======================================================================== */
/* createComposer                                                            */
/* ======================================================================== */

/**
 * Build the project post chain.
 *
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.Scene} scene
 * @param {THREE.Camera} camera
 * @param {object} [o]
 * @param {'high'|'medium'|'draft'|'thumb'} [o.quality]  defaults to the renderer's
 * @param {object|false} [o.bloom]   overrides for BLOOM_DEFAULTS, or false
 * @param {object|false} [o.photo]   overrides for PHOTO_DEFAULTS, or false
 * @param {number} [o.width]  defaults to the renderer's current size
 * @param {number} [o.height]
 * @param {boolean}[o.animateGrain=false]  advance the grain seed every frame
 * @returns {EffectComposer} with `.userData = { renderPass, bloomPass, photoPass }`
 */
export function createComposer(renderer, scene, camera, {
  quality,
  bloom,
  photo,
  width,
  height,
  animateGrain = false,
} = {}) {
  const profile = qualityProfile(quality || (renderer.userData && renderer.userData.quality));

  const size = renderer.getSize(new THREE.Vector2());
  const w = width || size.x;
  const h = height || size.y;

  const target = new THREE.WebGLRenderTarget(
    Math.max(1, Math.floor(w * renderer.getPixelRatio())),
    Math.max(1, Math.floor(h * renderer.getPixelRatio())),
    {
      type: THREE.HalfFloatType,
      colorSpace: THREE.LinearSRGBColorSpace,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      stencilBuffer: false,
      samples: 0,
    }
  );

  const composer = new EffectComposer(renderer, target);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(w, h);

  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  let bloomPass = null;
  const bloomOn = bloom !== false && profile.bloom;
  if (bloomOn) {
    const b = Object.assign({}, BLOOM_DEFAULTS, bloom || {});
    if (b.enabled !== false) {
      bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), b.strength, b.radius, b.threshold);
      composer.addPass(bloomPass);
    }
  }

  const params = Object.assign({}, PHOTO_DEFAULTS, photo === false ? {} : photo || {});
  const photoPass = new ShaderPass(PhotoFinishShader);
  photoPass.material.toneMapped = false;
  const u = photoPass.uniforms;
  u.uResolution.value = new THREE.Vector2(w, h);
  u.uExposure.value = renderer.toneMappingExposure;
  u.uAberration.value = photo === false ? 0 : params.aberration;
  u.uVignette.value = photo === false ? 0 : params.vignette;
  u.uVignetteRadius.value = params.vignetteRadius;
  u.uRolloff.value = params.rolloff;
  u.uRolloffKnee.value = params.rolloffKnee;
  u.uHighlightDesat.value = params.highlightDesat;
  u.uGrain.value = photo === false ? 0 : params.grain;
  u.uGrainHighlight.value = params.grainHighlight;
  u.uLift.value = params.lift;
  u.uSaturation.value = params.saturation;
  u.uSharpen.value = photo === false ? 0 : params.sharpen;
  u.uSharpenRadius.value = params.sharpenRadius;
  u.uSeed.value = params.seed;
  composer.addPass(photoPass);

  composer.userData = {
    renderPass,
    bloomPass,
    photoPass,
    params,
    profile,
    animateGrain,
  };

  return composer;
}

/** Patch PhotoFinish uniforms after the fact. Unknown keys are ignored. */
export function setPhotoFinish(composer, patch = {}) {
  const pass = composer && composer.userData && composer.userData.photoPass;
  if (!pass) return null;
  const u = pass.uniforms;
  const map = {
    exposure: 'uExposure',
    aberration: 'uAberration',
    vignette: 'uVignette',
    vignetteRadius: 'uVignetteRadius',
    rolloff: 'uRolloff',
    rolloffKnee: 'uRolloffKnee',
    highlightDesat: 'uHighlightDesat',
    grain: 'uGrain',
    grainHighlight: 'uGrainHighlight',
    lift: 'uLift',
    saturation: 'uSaturation',
    sharpen: 'uSharpen',
    sharpenRadius: 'uSharpenRadius',
    seed: 'uSeed',
    whiteBalance: 'uWhiteBalance',
  };
  for (const [k, v] of Object.entries(patch)) {
    const name = map[k];
    if (name && u[name]) {
      // whiteBalance arrives as [r,g,b]; the uniform is a Vector3
      if (name === 'uWhiteBalance' && Array.isArray(v)) u[name].value.set(v[0], v[1], v[2]);
      else u[name].value = v;
      composer.userData.params[k] = v;
    }
  }
  return composer.userData.params;
}

/** Patch the bloom pass. */
export function setBloom(composer, patch = {}) {
  const pass = composer && composer.userData && composer.userData.bloomPass;
  if (!pass) return null;
  if (patch.strength !== undefined) pass.strength = patch.strength;
  if (patch.radius !== undefined) pass.radius = patch.radius;
  if (patch.threshold !== undefined) pass.threshold = patch.threshold;
  if (patch.enabled !== undefined) pass.enabled = patch.enabled;
  return pass;
}

/** Swap the camera the chain renders with (screenshot harness uses this). */
export function setComposerCamera(composer, camera, scene) {
  const rp = composer && composer.userData && composer.userData.renderPass;
  if (!rp) return;
  rp.camera = camera;
  if (scene) rp.scene = scene;
}

/** Resize the whole chain, keeping the resolution uniform in sync. */
export function setComposerSize(composer, width, height) {
  composer.setSize(width, height);
  const u = composer.userData && composer.userData.photoPass && composer.userData.photoPass.uniforms;
  if (u && u.uResolution) u.uResolution.value.set(width, height);
  const bp = composer.userData && composer.userData.bloomPass;
  if (bp && bp.setSize) bp.setSize(width, height);
}

/** Release the composer's render targets and pass materials. */
export function disposeComposer(composer) {
  if (!composer) return;
  for (const pass of composer.passes) {
    if (pass.dispose) pass.dispose();
  }
  composer.dispose();
}

export default createComposer;
