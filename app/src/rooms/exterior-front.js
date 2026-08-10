/**
 * app/src/rooms/exterior-front.js — the street elevation.
 *
 * Photos: straight_on_view_of_house_from_street.png, front_leftside_of_house.png,
 *         front_rightside_of_house.png, exterior_view_of_front_door.png
 *
 * The envelope itself lives in core/massing.js and is shared with
 * `exterior-rear` (both pieces are on the same `exterior` scene, so the massing
 * builder memoises itself on the scene). This module owns:
 *
 *   - the daylight for the exterior scene: sky env + sun rig, aimed at the
 *     azimuth the photographs actually show;
 *   - the street-side ground furniture the front photos catch — walkway
 *     landing, splash blocks, the address plaque's shadow line, the mulch
 *     boulders — and the front planting the shell only stubs;
 *   - the neighbours and the street trees that fill the sky behind the roof.
 *
 * LIGHT — measured, not guessed. In `front_rightside_of_house.png` the EAST
 * flank of the garage is brighter than the front wall; in
 * `front_leftside_of_house.png` the WEST flank is in deep shade while the front
 * is lit. That puts the sun south-east of the house: azimuth ~132°, elevation
 * ~56°, i.e. a late-summer late morning. Grazing light across a +Z facade is
 * also exactly what makes the 8" lap courses read as a ladder of hard shadows,
 * which is the single most recognisable thing about this facade.
 */

import { buildMassing, louveredVent } from '../core/massing.js';
import { LEVELS, CEIL_Y, MASSING, SITE } from '../core/dims.js';
import { inch, ft, deg } from '../core/units.js';

export const meta = {
  id: 'exterior-front',
  title: 'Front elevation',
  level: 'exterior',
  photos: [
    'straight_on_view_of_house_from_street.png',
    'front_leftside_of_house.png',
    'front_rightside_of_house.png',
    'exterior_view_of_front_door.png',
  ],
};

/** The one sun this scene has. Both exterior pieces agree on it. */
export const SUN = { azimuth: 132, elevation: 56, turbidity: 2.3 };

export function build(ctx) {
  const { THREE, kit } = ctx;
  const M = buildMassing(ctx);
  applyExteriorDaylight(ctx);

  const g = new THREE.Group();
  g.name = 'exterior-front';
  ctx.group.add(g);

  const locals = M.locals;
  const stone = ctx.mat && ctx.mat.bluestone ? ctx.mat.bluestone : locals.trim();
  const concrete = locals.concrete();

  /* ---- the bluestone landing in front of the porch ---------------------- */
  const [lx0, lz0, lx1, lz1] = SITE.walkway.landing;
  for (let i = 0; i < 14; i++) {
    const col = i % 4, row = (i / 4) | 0;
    const w = (lx1 - lx0) / 4 - 0.08;
    const d = (lz1 - lz0) / 4 - 0.08;
    if (row > 3) break;
    const s = kit.box(w * (0.86 + 0.28 * frac(i * 3.7)), inch(1.6),
      d * (0.9 + 0.2 * frac(i * 7.1)), stone, { r: inch(0.35), seg: 2, uv: true });
    s.position.set(lx0 + w * (col + 0.5) + 0.04, SITE.walkway.y + inch(0.8),
      lz0 + d * (row + 0.5) + 0.04);
    s.rotation.y = deg((frac(i * 11.3) - 0.5) * 1.6);
    s.castShadow = false;
    s.receiveShadow = true;
    g.add(s);
  }

  /* ---- splash blocks under the two front downspouts --------------------- */
  for (const [x, z] of [[42.4, 48.6], [62.6, 48.0], [-2.1, 48.0]]) {
    const b = kit.box(1.1, 0.28, 1.9, concrete, { r: inch(1.2), seg: 2 });
    b.position.set(x, SITE.lot.grassY + 0.12, z);
    b.rotation.y = deg(frac(x) * 6 - 3);
    b.castShadow = false;
    g.add(b);
  }

  /* ---- fieldstone boulders in the black mulch --------------------------- */
  const rockM = mat(ctx, 'boulder', { color: 0x8d8880, roughness: 0.95 });
  const rocks = [[6.2, 49.6, 0.85], [17.4, 50.4, 0.62], [25.0, 49.2, 0.7],
  [45.5, 49.4, 0.6], [56.0, 50.6, 0.75]];
  for (const [x, z, r] of rocks) {
    const b = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), rockM);
    b.scale.set(1.25, 0.62, 1.0);
    b.rotation.set(deg(frac(x) * 20), deg(frac(z) * 360), deg(frac(x * z) * 16));
    b.position.set(x, SITE.lot.grassY + r * 0.34, z);
    b.castShadow = true;
    b.receiveShadow = true;
    g.add(b);
  }

  /* ---- the clipped privet mass right of the entry ----------------------- */
  const hedgeM = mat(ctx, 'privet', { color: 0x51702e, roughness: 0.98 });
  const hedge = new THREE.Group();
  for (let i = 0; i < 9; i++) {
    const r = 2.0 + 0.55 * frac(i * 5.3);
    const b = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), hedgeM);
    b.position.set(41.0 + i * 1.55 + frac(i * 2.9) * 0.5,
      SITE.lot.grassY + 2.3 + 0.5 * frac(i * 8.1),
      47.6 + frac(i * 3.3) * 1.0);
    b.scale.y = 1.15;
    b.castShadow = true;
    b.receiveShadow = true;
    hedge.add(b);
  }
  g.add(hedge);

  /* ---- the multi-stem front tree that dominates the straight-on shot ---- */
  const tree = SITE.trees.find((t) => t.id === 'front-redbud');
  if (tree) g.add(multiStemTree(ctx, tree, 0.9));
  const pine = SITE.trees.find((t) => t.id === 'front-pine');
  if (pine) g.add(conifer(ctx, pine));
  const maple = SITE.trees.find((t) => t.id === 'front-maple-e');
  if (maple) g.add(multiStemTree(ctx, maple, 0.7));

  /* ---- the mulch ring under the front tree ------------------------------ */
  if (tree) {
    const ring = new THREE.Mesh(new THREE.CircleGeometry(7.2, 40),
      ctx.mat && ctx.mat.mulchBed ? ctx.mat.mulchBed : rockM);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(tree.at[0], SITE.lot.grassY + 0.035, tree.at[1]);
    ring.receiveShadow = true;
    ring.scale.set(1.15, 1.0, 1.0);
    g.add(ring);
  }
}

/* ======================================================================== */
/* helpers                                                                   */
/* ======================================================================== */

function frac(n) {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function mat(ctx, name, patch) {
  ctx.__frontMats = ctx.__frontMats || new Map();
  if (ctx.__frontMats.has(name)) return ctx.__frontMats.get(name);
  const m = new ctx.THREE.MeshPhysicalMaterial(Object.assign({ roughness: 0.9, metalness: 0 }, patch));
  m.userData.keep = true;
  ctx.__frontMats.set(name, m);
  return m;
}

/**
 * Point the scene's sky and sun at the measured azimuth. Safe to call from
 * both exterior pieces: the second call is a no-op.
 */
export function applyExteriorDaylight(ctx) {
  const scene = ctx.scene;
  if (!scene || (scene.userData && scene.userData.__extDaylight)) return;
  if (scene.userData) scene.userData.__extDaylight = true;
  const L = ctx.lights;

  // 1. re-aim the sky (main.js built it from lighting.js's preset)
  const env = ctx.envHandle || (scene.userData && scene.userData.skyEnv);
  if (env && typeof env.update === 'function' && ctx.THREE) {
    // env.js exposes sunDirection(); re-derive it here so the visible sky disc
    // and the analytic sun agree exactly.
    const a = SUN.azimuth * Math.PI / 180;
    const e = SUN.elevation * Math.PI / 180;
    env.update({
      uSunDir: [Math.cos(e) * Math.sin(a), Math.sin(e), -Math.cos(e) * Math.cos(a)],
    });
  }

  // 2. the analytic sun + sky fill (CONVENTIONS §6: exterior sun:sky = 5:1)
  if (L && typeof L.sunRig === 'function') {
    // kill whatever the level preset put up, so we do not double-light
    const stale = scene.getObjectByName('sunRig');
    if (stale && stale.parent) stale.parent.remove(stale);
    const rig = L.sunRig(scene, {
      name: 'sunRig',
      azimuth: SUN.azimuth,
      elevation: SUN.elevation,
      intensity: 8.2,
      color: 0xfff3df,
      hemisphere: true,
      hemiIntensity: 0.55,
      skyColor: 0x9dbdea,
      groundColor: 0x7f8259,
      shadowBounds: [-30, -14, -60, 92, 34, 100],
      quality: ctx.quality,
      normalBias: 0.02,
      bias: -0.00035,
    });
    if (rig && rig.sun && rig.sun.shadow) {
      rig.sun.shadow.mapSize.set(ctx.quality === 'draft' ? 1024 : 3072,
        ctx.quality === 'draft' ? 1024 : 3072);
    }
  }
}

/** A believable multi-stem deciduous canopy: leaning trunks + clustered foliage. */
function multiStemTree(ctx, t, leafiness) {
  const { THREE, kit } = ctx;
  const g = new THREE.Group();
  g.name = `tree:${t.id}`;
  const bark = mat(ctx, 'bark', { color: 0x594d40, roughness: 0.97 });
  const leaf = mat(ctx, 'leaf', {
    color: 0x527f2b, roughness: 0.86, sheen: 0.5, sheenColor: 0x9ec86a,
    sheenRoughness: 0.6,
  });
  const leaf2 = mat(ctx, 'leaf2', { color: 0x6c9a36, roughness: 0.88 });
  const y0 = -1.15;
  const stems = 4;
  for (let i = 0; i < stems; i++) {
    const a = (i / stems) * Math.PI * 2 + frac(i * 3.1) * 1.4;
    const lean = 0.16 + frac(i * 5.7) * 0.16;
    const h = t.crownBaseY + 2.5 + frac(i * 9.1) * 2.4 - y0;
    const r = t.trunkR * (0.55 + 0.35 * frac(i * 2.2));
    const tr = kit.cyl(r * 0.55, r, h, bark, 10);
    tr.position.set(t.at[0] + Math.cos(a) * 0.55, y0 + h / 2, t.at[1] + Math.sin(a) * 0.55);
    tr.rotation.z = -Math.cos(a) * lean;
    tr.rotation.x = Math.sin(a) * lean;
    tr.castShadow = true;
    g.add(tr);
  }
  const cy = (t.crownBaseY + t.crownTopY) / 2;
  const n = Math.round(26 * leafiness) + 8;
  for (let i = 0; i < n; i++) {
    const a = frac(i * 1.7) * Math.PI * 2;
    const rr = t.canopyR * (0.25 + 0.72 * Math.sqrt(frac(i * 4.3)));
    const yy = cy + (frac(i * 6.1) - 0.5) * (t.crownTopY - t.crownBaseY) * 0.82;
    const blobR = t.canopyR * (0.20 + 0.16 * frac(i * 8.9));
    const b = new THREE.Mesh(new THREE.IcosahedronGeometry(blobR, 1),
      frac(i * 2.4) > 0.55 ? leaf2 : leaf);
    b.position.set(t.at[0] + Math.cos(a) * rr, yy, t.at[1] + Math.sin(a) * rr);
    b.scale.set(1.0, 0.7, 1.0);
    b.rotation.set(frac(i) * 3, frac(i * 2) * 3, frac(i * 3) * 3);
    b.castShadow = true;
    b.receiveShadow = true;
    g.add(b);
  }
  return g;
}

function conifer(ctx, t) {
  const { THREE, kit } = ctx;
  const g = new THREE.Group();
  const bark = mat(ctx, 'bark', { color: 0x594d40, roughness: 0.97 });
  const needle = mat(ctx, 'needle', { color: 0x2f4a2a, roughness: 0.95 });
  const y0 = -1.15;
  const tr = kit.cyl(t.trunkR * 0.4, t.trunkR, t.crownTopY - y0, bark, 12);
  tr.position.set(t.at[0], y0 + (t.crownTopY - y0) / 2, t.at[1]);
  tr.castShadow = true;
  g.add(tr);
  const tiers = 9;
  for (let i = 0; i < tiers; i++) {
    const f = i / (tiers - 1);
    const y = t.crownBaseY + f * (t.crownTopY - t.crownBaseY);
    const r = t.canopyR * (1.0 - f * 0.82) * (0.85 + 0.3 * frac(i * 4.1));
    const c = new THREE.Mesh(new THREE.ConeGeometry(r, 5.5, 12, 1, true), needle);
    c.position.set(t.at[0] + (frac(i * 3.3) - 0.5) * 1.6, y + 1.4,
      t.at[1] + (frac(i * 5.9) - 0.5) * 1.6);
    c.castShadow = true;
    c.material.side = THREE.DoubleSide;
    g.add(c);
  }
  return g;
}

export default build;
