/**
 * kit.js — the parametric component kit for 1430 Country Ln.
 *
 * Every room module builds from these factories.  Rooms must NOT reinvent a
 * cabinet, a door, a piece of trim or a light fixture: quality invested here
 * multiplies across 23 rooms, and consistency is most of what makes a set of
 * renders read as one house photographed by one photographer.
 *
 * CONTRACT (docs/CONVENTIONS.md)
 * -----------------------------
 *   * 1 world unit = 1 FOOT.  Inches are `inch(n)`.
 *   * Y is up.  Y = 0 is the level's finished floor.
 *   * Every factory returns a `THREE.Group` whose ORIGIN is a documented
 *     anchor (see the `@anchor` line of each JSDoc block).  `group.userData.anchor`
 *     repeats it at runtime, and `group.userData.size = [w, h, d]` gives the
 *     bounding size in feet.
 *   * Every mesh gets `castShadow` / `receiveShadow`.
 *   * NOTHING uses a raw `BoxGeometry`.  Sharp, perfectly-square edges are the
 *     number-one CG tell — real millwork, casework and appliances all carry an
 *     eased edge that picks up a 1–2 px specular line.  Use `roundedBox()`.
 *   * Real reveals: cabinet door gaps 1/8", drawer reveals 1/8", door leaf to
 *     jamb 1/8" with a 1/2" undercut, baseboard scribed to the floor.
 *
 * LOCAL FRAME (unless a factory documents otherwise)
 * --------------------------------------------------
 *   +X = width, to the right seen from the front
 *   +Y = up
 *   +Z = out of the wall, toward the viewer ("front")
 *   Origin = bottom / center / back  →  a cabinet placed at a wall whose inside
 *   face is the plane z = 0 (with the group rotated so +Z is into the room)
 *   simply sits at that point.
 *
 * USAGE
 * -----
 *   import { makeKit } from './kit.js';
 *   const kit = makeKit(THREE, mat, tex);
 *   const g = kit.baseCabinet({ w: 3, doors: 2 });
 *   g.position.set(x, 0, z); g.rotation.y = Math.PI; parent.add(g);
 */

import { applyUV } from './materials.js';
import { inch, ft, deg, DOOR, CAB, TRIM, WIN, clamp, lerp } from './units.js';

/* ======================================================================== */
/* 0.  Module-level constants                                                */
/* ======================================================================== */

/** Default eased-edge radius: 0.05" — one or two pixels of catch-light. */
const R_EASE = inch(0.05);
/** Bigger break for painted millwork (paint softens an arris). */
const R_PAINT = inch(0.09);
/** Cabinet door / drawer reveal. */
const REVEAL = inch(0.125);

const TAU = Math.PI * 2;
const HALFPI = Math.PI / 2;

/* ======================================================================== */
/* 1.  Geometry builder — non-indexed, orientation-checked                   */
/* ======================================================================== */

const v3sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const v3cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const v3dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function v3norm(a) {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

/**
 * Tiny non-indexed mesh accumulator.  `quad()` and `tri()` take the intended
 * OUTWARD normal and flip the winding automatically, which removes an entire
 * class of "my geometry is inside-out" bugs from the rest of this file.
 */
class Builder {
  constructor() {
    this.p = [];
    this.n = [];
    this.u = [];
  }

  _v(p, n, uv) {
    this.p.push(p[0], p[1], p[2]);
    this.n.push(n[0], n[1], n[2]);
    this.u.push(uv[0], uv[1]);
  }

  /** a,b,c,d in order around the face.  `nrm` = intended outward normal. */
  quad(a, b, c, d, nrm, uvs, vn) {
    const g = v3cross(v3sub(b, a), v3sub(d, a));
    let A = a, B = b, C = c, D = d;
    let ua = uvs[0], ub = uvs[1], uc = uvs[2], ud = uvs[3];
    let na = vn && vn[0], nb = vn && vn[1], nc = vn && vn[2], nd = vn && vn[3];
    if (v3dot(g, nrm) < 0) {
      B = d; D = b;
      ub = uvs[3]; ud = uvs[1];
      if (vn) { nb = vn[3]; nd = vn[1]; }
    }
    const N = nrm;
    this._v(A, na || N, ua); this._v(B, nb || N, ub); this._v(C, nc || N, uc);
    this._v(A, na || N, ua); this._v(C, nc || N, uc); this._v(D, nd || N, ud);
  }

  tri(a, b, c, nrm, uvs) {
    const g = v3cross(v3sub(b, a), v3sub(c, a));
    let A = a, B = b, C = c;
    let ua = uvs[0], ub = uvs[1], uc = uvs[2];
    if (v3dot(g, nrm) < 0) { B = c; C = b; ub = uvs[2]; uc = uvs[1]; }
    this._v(A, nrm, ua); this._v(B, nrm, ub); this._v(C, nrm, uc);
  }

  get count() { return this.p.length / 3; }

  geometry(THREE) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

/* ======================================================================== */
/* 2.  makeKit                                                               */
/* ======================================================================== */

/**
 * Build the component kit.
 *
 * @param {object} THREE  the three namespace
 * @param {object} mat    material library from materials.js
 * @param {object} [tex]  texture library (rarely needed directly)
 * @returns {Readonly<Object>} frozen map of factory name -> function
 */
export function makeKit(THREE, mat, tex) {
  /* ---------------------------------------------------------------- */
  /* 2.1  local material derivatives                                    */
  /* ---------------------------------------------------------------- */

  const LOCALS = new Map();
  /** Clone a library material once and cache it under `name`. */
  function local(name, base, over) {
    let m = LOCALS.get(name);
    if (m) return m;
    m = base ? base.clone() : new THREE.MeshPhysicalMaterial();
    if (base) m.userData = Object.assign({}, base.userData);
    if (over) {
      for (const k of Object.keys(over)) {
        const v = over[k];
        if (k === 'color' || k === 'emissive' || k === 'sheenColor' || k === 'attenuationColor') {
          m[k] = new THREE.Color(v);
        } else m[k] = v;
      }
    }
    m.name = name;
    m.needsUpdate = true;
    LOCALS.set(name, m);
    return m;
  }

  const P = {
    /** Semi-gloss trim white — casing, base, crown, doors, shutters. */
    get trimWhite() {
      return local('trimWhite', mat.paintedOffWhite, {
        color: 0xfefdfb, clearcoat: 0.55, clearcoatRoughness: 0.18, envMapIntensity: 0.85,
      });
    },
    /** Kitchen upper / hood off-white (warmer, greige). */
    get cabWhite() {
      return local('cabWhite', mat.paintedOffWhite, { color: 0xf6f2ea });
    },
    /** Black lacquered front door / black metal. */
    get black() {
      return local('paintBlack', mat.blackMatte, {
        color: 0x2a2b2d, clearcoat: 0.5, clearcoatRoughness: 0.25,
      });
    },
    /** Flat matte black — iron balusters, fixture bodies. */
    get iron() {
      return local('iron', mat.blackMatte, {
        color: 0x232426, roughness: 0.55, metalness: 0.35, envMapIntensity: 0.5,
      });
    },
    get wood() { return mat.cherryCabinet; },
    get woodDark() { return mat.cherryCabinetDark; },
    /** White oak handrail / newel — lighter, cooler than the cherry base. */
    get whiteOak() {
      return local('whiteOak', mat.cherryCabinet, {
        color: 0xd6b98d, clearcoat: 0.35, clearcoatRoughness: 0.3,
      });
    },
    get oakFloor() { return mat.redOakFloor; },
    get quartz() { return mat.quartzWhite; },
    get slab() { return mat.quartzSlabBacksplash; },
    get steel() { return mat.stainlessBrushed; },
    get brass() { return mat.brassBrushed; },
    get glass() { return mat.clearGlass; },
    get frosted() { return mat.frostedGlass; },
    get mirror() { return mat.mirrorGlass; },
    get stone() { return mat.stackedLimestone; },
    get tile() { return mat.bronzePorcelain; },
    get mosaic() { return mat.mosaicAccent; },
    get linen() { return mat.fabricLinen; },
    get velvet() { return mat.fabricVelvet; },
    get leather() { return mat.leatherDark; },
    get carpet() { return mat.carpetBeige; },
    /** Vitreous china — toilets, sinks, tubs. */
    get china() {
      return local('china', null, {
        color: 0xf8f8f6, roughness: 0.06, metalness: 0.0,
        clearcoat: 1.0, clearcoatRoughness: 0.03, envMapIntensity: 1.25,
      });
    },
    /** Acrylic tub / shower pan — slightly softer than china. */
    get acrylic() {
      return local('acrylic', null, {
        color: 0xf6f7f5, roughness: 0.10, metalness: 0.0,
        clearcoat: 0.9, clearcoatRoughness: 0.06, envMapIntensity: 1.1,
      });
    },
    /** Chrome/polished nickel plumbing. */
    get chrome() {
      return local('chrome', null, {
        color: 0xe9ecee, roughness: 0.045, metalness: 1.0, envMapIntensity: 1.6,
      });
    },
    /** Matte-black plumbing / hardware. */
    get blackMetal() {
      return local('blackMetal', null, {
        color: 0x1b1c1e, roughness: 0.34, metalness: 0.85, envMapIntensity: 0.9,
      });
    },
    /** Unlacquered brass hardware (pulls, chandelier arms). */
    get brassPolished() {
      return local('brassPolished', null, {
        color: 0xbb9553, roughness: 0.19, metalness: 1.0, envMapIntensity: 1.4,
      });
    },
    /** Opal glass globe / diffuser — emissive so it reads as ON. */
    get bulb() {
      return local('bulb', null, {
        color: 0xfff4e2, roughness: 0.42, metalness: 0.0,
        emissive: 0xffe6bd, emissiveIntensity: 2.6, envMapIntensity: 0.4,
        transmission: 0.25, thickness: 0.04, ior: 1.45, transparent: true,
      });
    },
    /** Dim emissive for a fixture that must not blow out. */
    get bulbSoft() {
      return local('bulbSoft', null, {
        color: 0xfff6ea, roughness: 0.5, emissive: 0xffeed2, emissiveIntensity: 1.2,
      });
    },
    get appliancePanel() {
      return local('appliancePanel', null, {
        color: 0x191a1c, roughness: 0.22, metalness: 0.25,
        clearcoat: 0.85, clearcoatRoughness: 0.06, envMapIntensity: 1.1,
      });
    },
    /** Smoked appliance glass (oven / washer doors). */
    get applianceGlass() {
      return local('applianceGlass', null, {
        color: 0x0d0e10, roughness: 0.06, metalness: 0.1,
        clearcoat: 1.0, clearcoatRoughness: 0.03, envMapIntensity: 1.5,
      });
    },
    get rubber() { return mat.rubberGymFloor; },
    get deck() { return mat.compositeDeck; },
    get bluestone() { return mat.bluestone; },
    /** Dark stained timber — sunroom post & beam wall. */
    get timber() {
      return local('timber', mat.cherryCabinetDark, {
        color: 0x4a4038, clearcoat: 0.18, clearcoatRoughness: 0.45,
      });
    },
  };

  /* ---------------------------------------------------------------- */
  /* 2.2  primitive helpers                                             */
  /* ---------------------------------------------------------------- */

  const GEO_CACHE = new Map();

  /**
   * Rounded / chamfered box — the ONLY box primitive this kit uses.
   *
   * Built as 6 flat faces + 12 quarter-cylinder edges + 8 spherical corners,
   * so a tiny radius stays tiny (unlike the "subdivide a BoxGeometry and push
   * the vertices" trick, which turns small boxes into pillows).  UVs are
   * 0..1 across the full extent on every face, so `applyUV()` works.
   *
   * @param {number} w width (X)
   * @param {number} h height (Y)
   * @param {number} d depth (Z)
   * @param {number} [r=R_EASE] edge radius in feet
   * @param {number} [seg=1] arc segments per quarter-round (1 = chamfer)
   * @returns {THREE.BufferGeometry} centred on the origin
   */
  function roundedBox(w, h, d, r = R_EASE, seg = 1) {
    const key = `rb|${w.toFixed(5)}|${h.toFixed(5)}|${d.toFixed(5)}|${r.toFixed(5)}|${seg}`;
    const hit = GEO_CACHE.get(key);
    if (hit) return hit;

    const hw = w / 2, hh = h / 2, hd = d / 2;
    const rr = Math.max(0, Math.min(r, hw * 0.9, hh * 0.9, hd * 0.9));
    let geo;
    if (!(rr > 1e-5)) {
      geo = new THREE.BoxGeometry(w, h, d);
      GEO_CACHE.set(key, geo);
      return geo;
    }
    const A = hw - rr, B = hh - rr, C = hd - rr;
    const b = new Builder();

    const UV = (px, py, pz, n) => {
      const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
      if (ax >= ay && ax >= az) {
        const u = (pz + hd) / d;
        return [n[0] < 0 ? 1 - u : u, (py + hh) / h];
      }
      if (ay >= az) {
        const v = (pz + hd) / d;
        return [(px + hw) / w, n[1] < 0 ? 1 - v : v];
      }
      const u = (px + hw) / w;
      return [n[2] < 0 ? 1 - u : u, (py + hh) / h];
    };
    const Q = (pts, n) => b.quad(pts[0], pts[1], pts[2], pts[3], n,
      pts.map((p) => UV(p[0], p[1], p[2], n)));
    const Qn = (pts, ns) => {
      const n = v3norm([
        (ns[0][0] + ns[1][0] + ns[2][0] + ns[3][0]) / 4,
        (ns[0][1] + ns[1][1] + ns[2][1] + ns[3][1]) / 4,
        (ns[0][2] + ns[1][2] + ns[2][2] + ns[3][2]) / 4,
      ]);
      b.quad(pts[0], pts[1], pts[2], pts[3], n,
        pts.map((p, i) => UV(p[0], p[1], p[2], ns[i])), ns);
    };

    /* ---- 6 flat faces ---- */
    Q([[hw, -B, C], [hw, -B, -C], [hw, B, -C], [hw, B, C]], [1, 0, 0]);
    Q([[-hw, -B, -C], [-hw, -B, C], [-hw, B, C], [-hw, B, -C]], [-1, 0, 0]);
    Q([[-A, hh, C], [A, hh, C], [A, hh, -C], [-A, hh, -C]], [0, 1, 0]);
    Q([[-A, -hh, -C], [A, -hh, -C], [A, -hh, C], [-A, -hh, C]], [0, -1, 0]);
    Q([[-A, -B, hd], [A, -B, hd], [A, B, hd], [-A, B, hd]], [0, 0, 1]);
    Q([[A, -B, -hd], [-A, -B, -hd], [-A, B, -hd], [A, B, -hd]], [0, 0, -1]);

    /* ---- 12 quarter-round edges ---- */
    const edge = (axis, s1, s2) => {
      // axis 0 = along X, 1 = along Y, 2 = along Z
      const half = axis === 0 ? A : axis === 1 ? B : C;
      for (let i = 0; i < seg; i++) {
        const t0 = (i / seg) * HALFPI, t1 = ((i + 1) / seg) * HALFPI;
        const mk = (t, e) => {
          const c = Math.cos(t), s = Math.sin(t);
          let n, ctr;
          if (axis === 0) { n = [0, s1 * c, s2 * s]; ctr = [e * half, s1 * B, s2 * C]; }
          else if (axis === 1) { n = [s1 * c, 0, s2 * s]; ctr = [s1 * A, e * half, s2 * C]; }
          else { n = [s1 * c, s2 * s, 0]; ctr = [s1 * A, s2 * B, e * half]; }
          return { p: [ctr[0] + rr * n[0], ctr[1] + rr * n[1], ctr[2] + rr * n[2]], n };
        };
        const a0 = mk(t0, -1), a1 = mk(t0, 1), b1 = mk(t1, 1), b0 = mk(t1, -1);
        Qn([a0.p, a1.p, b1.p, b0.p], [a0.n, a1.n, b1.n, b0.n]);
      }
    };
    for (const s1 of [-1, 1]) for (const s2 of [-1, 1]) {
      edge(0, s1, s2); edge(1, s1, s2); edge(2, s1, s2);
    }

    /* ---- 8 spherical corners ---- */
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      const ctr = [sx * A, sy * B, sz * C];
      const mk = (ai, ei) => {
        const az = (ai / seg) * HALFPI, el = (ei / seg) * HALFPI;
        const ce = Math.cos(el), se = Math.sin(el);
        const n = [sx * ce * Math.cos(az), sy * se, sz * ce * Math.sin(az)];
        return { p: [ctr[0] + rr * n[0], ctr[1] + rr * n[1], ctr[2] + rr * n[2]], n };
      };
      for (let i = 0; i < seg; i++) for (let j = 0; j < seg; j++) {
        const a = mk(i, j), bb = mk(i + 1, j), c = mk(i + 1, j + 1), dd = mk(i, j + 1);
        Qn([a.p, bb.p, c.p, dd.p], [a.n, bb.n, c.n, dd.n]);
      }
    }

    geo = b.geometry(THREE);
    GEO_CACHE.set(key, geo);
    return geo;
  }

  /** Mesh from `roundedBox`, shadows on, positioned by centre. */
  function box(w, h, d, material, opts = {}) {
    const m = new THREE.Mesh(roundedBox(w, h, d, opts.r === undefined ? R_EASE : opts.r,
      opts.seg || 1), material);
    m.castShadow = opts.cast !== false;
    m.receiveShadow = opts.receive !== false;
    if (opts.at) m.position.set(opts.at[0], opts.at[1], opts.at[2]);
    if (opts.uv) applyUV(m, opts.uv === true ? undefined : opts.uv, opts.uvOpts || {});
    if (opts.name) m.name = opts.name;
    return m;
  }

  /**
   * Convenience: a box positioned by its MIN corner instead of its centre.
   * `boxAt(x0, y0, z0, w, h, d, material)`
   */
  function boxAt(x0, y0, z0, w, h, d, material, opts = {}) {
    const m = box(w, h, d, material, opts);
    m.position.set(x0 + w / 2, y0 + h / 2, z0 + d / 2);
    return m;
  }

  /** Cylinder mesh with shadows, radius r, height h, axis +Y, centred. */
  function cyl(r0, r1, h, material, seg = 24, opts = {}) {
    const g = new THREE.CylinderGeometry(r0, r1, h, seg, 1, !!opts.open);
    const m = new THREE.Mesh(g, material);
    m.castShadow = true; m.receiveShadow = true;
    if (opts.at) m.position.set(opts.at[0], opts.at[1], opts.at[2]);
    return m;
  }

  /** Sphere mesh with shadows. */
  function ball(r, material, seg = 24) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.max(8, seg >> 1)), material);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }

  /** Torus mesh with shadows. */
  function torus(R, r, material, seg = 40, rseg = 12) {
    const m = new THREE.Mesh(new THREE.TorusGeometry(R, r, rseg, seg), material);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }

  /**
   * A flat plate with real holes punched through it, chamfered on every edge.
   * This is how every paneled door skin, porthole and louver frame in the kit
   * is made: a genuine opening reads completely differently from a texture or
   * an overlaid box, because the hole's chamfer catches its own highlight.
   *
   * @param {number} w plate width (X)
   * @param {number} h plate height (Y)
   * @param {Array} holes  rect holes as [x0,y0,x1,y1] or {circle:true,x,y,r}
   * @param {number} depth total thickness in Z
   * @returns {THREE.Mesh} spanning z = 0 .. depth, centred in X and Y
   */
  function plateWithHoles(w, h, holes, depth, material, o = {}) {
    const s = new THREE.Shape();
    const bx = w / 2, by = h / 2;
    s.moveTo(-bx, -by); s.lineTo(bx, -by); s.lineTo(bx, by); s.lineTo(-bx, by);
    s.closePath();
    for (const hl of holes || []) {
      const p = new THREE.Path();
      if (hl && hl.circle) p.absarc(hl.x, hl.y, hl.r, 0, TAU, true);
      else {
        p.moveTo(hl[0], hl[1]); p.lineTo(hl[0], hl[3]);
        p.lineTo(hl[2], hl[3]); p.lineTo(hl[2], hl[1]); p.closePath();
      }
      s.holes.push(p);
    }
    const bev = o.bevel === undefined ? inch(0.05) : o.bevel;
    const useBev = bev > 1e-5 && depth > 3 * bev;
    const geo = new THREE.ExtrudeGeometry(s, {
      depth: useBev ? depth - 2 * bev : depth,
      bevelEnabled: useBev,
      bevelThickness: bev, bevelSize: bev, bevelOffset: 0, bevelSegments: 1,
      curveSegments: o.curveSegments || 48,
      steps: 1,
    });
    geo.translate(0, 0, useBev ? bev : 0);
    // ExtrudeGeometry emits UVs in shape units (feet) — rescale to the
    // material's real-world tile so applyUV is not needed.
    const sf = uvs(material);
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / sf[0], uv.getY(i) / sf[1]);
    uv.needsUpdate = true;
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, material);
    m.castShadow = o.cast !== false;
    m.receiveShadow = true;
    return m;
  }

  /** Elliptical annulus, optionally extruded. @returns Mesh centred at origin. */
  function ellipseRing(rxOut, ryOut, rxIn, ryIn, depth, material, o = {}) {
    const s = new THREE.Shape();
    s.absellipse(0, 0, rxOut, ryOut, 0, TAU, false);
    if (rxIn > 0 && ryIn > 0) {
      const p = new THREE.Path();
      p.absellipse(0, 0, rxIn, ryIn, 0, TAU, true);
      s.holes.push(p);
    }
    let geo;
    if (depth > 1e-5) {
      geo = new THREE.ExtrudeGeometry(s, {
        depth, bevelEnabled: false, curveSegments: o.curveSegments || 64, steps: 1,
      });
    } else {
      geo = new THREE.ShapeGeometry(s, o.curveSegments || 64);
    }
    const sf = uvs(material);
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / sf[0], uv.getY(i) / sf[1]);
    uv.needsUpdate = true;
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, material);
    m.castShadow = o.cast !== false; m.receiveShadow = true;
    return m;
  }

  /**
   * Procedural flame alpha mask (canvas, no asset files).  Tongues of flame
   * that fade out at the tips, so the emissive plane in `gasFireplace` reads
   * as fire rather than a glowing rectangle.
   */
  let FLAME_TEX = null;
  function flameAlpha() {
    if (FLAME_TEX) return FLAME_TEX;
    if (typeof document === 'undefined') return null;
    const W = 256, H = 256;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const x = c.getContext('2d');
    x.fillStyle = '#000';
    x.fillRect(0, 0, W, H);
    let seed = 20240917;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const tongues = 9;
    for (let i = 0; i < tongues; i++) {
      const cx = W * (0.08 + 0.84 * ((i + 0.5) / tongues + (rnd() - 0.5) * 0.05));
      const bw = W * (0.055 + rnd() * 0.055);
      const th = H * (0.42 + rnd() * 0.5);
      const g2 = x.createLinearGradient(0, H, 0, H - th);
      g2.addColorStop(0.0, 'rgba(255,255,255,0.95)');
      g2.addColorStop(0.35, 'rgba(255,255,255,0.75)');
      g2.addColorStop(0.75, 'rgba(255,255,255,0.22)');
      g2.addColorStop(1.0, 'rgba(255,255,255,0)');
      x.fillStyle = g2;
      x.beginPath();
      x.moveTo(cx - bw, H);
      x.quadraticCurveTo(cx - bw * 0.85, H - th * 0.55, cx + (rnd() - 0.5) * bw, H - th);
      x.quadraticCurveTo(cx + bw * 0.85, H - th * 0.55, cx + bw, H);
      x.closePath();
      x.fill();
    }
    // ember glow along the log line
    const gl2 = x.createLinearGradient(0, H, 0, H * 0.72);
    gl2.addColorStop(0, 'rgba(255,255,255,0.9)');
    gl2.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = gl2;
    x.fillRect(0, H * 0.72, W, H * 0.28);
    // fade the vertical edges so the plane never shows a hard border
    x.globalCompositeOperation = 'destination-in';
    const fade = x.createLinearGradient(0, 0, W, 0);
    fade.addColorStop(0.0, 'rgba(0,0,0,0)');
    fade.addColorStop(0.14, 'rgba(0,0,0,1)');
    fade.addColorStop(0.86, 'rgba(0,0,0,1)');
    fade.addColorStop(1.0, 'rgba(0,0,0,0)');
    x.fillStyle = fade;
    x.fillRect(0, 0, W, H);
    x.globalCompositeOperation = 'source-over';
    FLAME_TEX = new THREE.CanvasTexture(c);
    FLAME_TEX.colorSpace = THREE.NoColorSpace;
    FLAME_TEX.needsUpdate = true;
    return FLAME_TEX;
  }

  /** New anchored group. */
  function G(anchor, size) {
    const g = new THREE.Group();
    g.userData.anchor = anchor;
    if (size) g.userData.size = size;
    return g;
  }

  /* ---------------------------------------------------------------- */
  /* 2.3  swept profiles (millwork)                                     */
  /* ---------------------------------------------------------------- */

  /**
   * Sweep a closed 2-D profile along a plan-space path, mitering at corners.
   *
   * @param {Array<[number,number]>} path  plan points [x, z]
   * @param {Array<[number,number]>} profile closed contour [n, y] where +n is
   *        the path's right-hand normal `(uz, 0, -ux)` and +y is up.
   * @param {object} [opts] {closed, caps, uvScale:[su,sv], flip}
   * @returns {THREE.BufferGeometry}
   */
  function sweepProfile(path, profile, opts = {}) {
    const pts = path.slice();
    const closed = !!opts.closed;
    if (closed && pts.length > 1) {
      const a = pts[0], b = pts[pts.length - 1];
      if (Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6) pts.pop();
    }
    const nP = pts.length;
    if (nP < 2) return new THREE.BufferGeometry();
    const flip = opts.flip ? -1 : 1;
    const su = (opts.uvScale && opts.uvScale[0]) || 1;
    const sv = (opts.uvScale && opts.uvScale[1]) || 1;

    const segCount = closed ? nP : nP - 1;
    // per-segment unit direction and right-hand normal
    const dir = [], nrm = [];
    for (let i = 0; i < segCount; i++) {
      const a = pts[i], b = pts[(i + 1) % nP];
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const l = Math.hypot(dx, dz) || 1;
      dir.push([dx / l, dz / l]);
      nrm.push([(dz / l) * flip, (-dx / l) * flip]);
    }
    // per-path-vertex miter direction + scale
    const mit = [], msc = [];
    for (let i = 0; i < nP; i++) {
      const inSeg = closed ? (i - 1 + segCount) % segCount : i - 1;
      const outSeg = closed ? i % segCount : Math.min(i, segCount - 1);
      const n0 = inSeg >= 0 ? nrm[inSeg] : nrm[outSeg];
      const n1 = outSeg <= segCount - 1 && (closed || i < segCount) ? nrm[outSeg] : nrm[inSeg];
      let mx = n0[0] + n1[0], mz = n0[1] + n1[1];
      const ml = Math.hypot(mx, mz);
      if (ml < 1e-6) { mx = n0[0]; mz = n0[1]; }
      else { mx /= ml; mz /= ml; }
      let sc = mx * n0[0] + mz * n0[1];
      if (Math.abs(sc) < 0.2) sc = 0.2 * Math.sign(sc || 1);
      mit.push([mx, mz]);
      msc.push(1 / sc);
    }

    // cumulative path distance for U
    const dist = [0];
    for (let i = 1; i < nP; i++) dist.push(dist[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    if (closed) dist.push(dist[nP - 1] + Math.hypot(pts[0][0] - pts[nP - 1][0], pts[0][1] - pts[nP - 1][1]));

    // cumulative profile perimeter for V
    const nF = profile.length;
    const pv = [0];
    for (let j = 1; j <= nF; j++) {
      const a = profile[j - 1], b2 = profile[j % nF];
      pv.push(pv[j - 1] + Math.hypot(b2[0] - a[0], b2[1] - a[1]));
    }

    const at = (i, j) => {
      const p = pts[i], m = mit[i], s = msc[i], f = profile[j];
      return [p[0] + m[0] * f[0] * s, f[1], p[1] + m[1] * f[0] * s];
    };

    const b = new Builder();
    for (let i = 0; i < segCount; i++) {
      const i1 = (i + 1) % nP;
      const N = nrm[i];
      for (let j = 0; j < nF; j++) {
        const j1 = (j + 1) % nF;
        const dn = profile[j1][0] - profile[j][0];
        const dy = profile[j1][1] - profile[j][1];
        // outward normal of this profile edge, in (normal, up) coords
        const ol = Math.hypot(dn, dy) || 1;
        const on = [(dy / ol) * N[0], (-dn / ol), (dy / ol) * N[1]];
        const A = at(i, j), B2 = at(i1, j), C = at(i1, j1), D = at(i, j1);
        const u0 = dist[i] / su, u1 = dist[i + 1] / su;
        const v0 = pv[j] / sv, v1 = pv[j + 1] / sv;
        b.quad(A, B2, C, D, on, [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
      }
    }
    // end caps
    if (!closed && opts.caps !== false) {
      const contour = profile.map((f) => new THREE.Vector2(f[0], f[1]));
      let tris = [];
      try { tris = THREE.ShapeUtils.triangulateShape(contour, []); } catch (e) { tris = []; }
      for (const end of [0, nP - 1]) {
        const seg = end === 0 ? 0 : segCount - 1;
        const t = dir[seg];
        const n = end === 0 ? [-t[0], 0, -t[1]] : [t[0], 0, t[1]];
        for (const tri of tris) {
          const A = at(end, tri[0]), B2 = at(end, tri[1]), C = at(end, tri[2]);
          b.tri(A, B2, C, n, [
            [profile[tri[0]][0] / su, profile[tri[0]][1] / sv],
            [profile[tri[1]][0] / su, profile[tri[1]][1] / sv],
            [profile[tri[2]][0] / su, profile[tri[2]][1] / sv],
          ]);
        }
      }
    }
    return b.geometry(THREE);
  }

  /**
   * Extrude a closed 2-D profile along +X, optionally mitering the ends at 45°.
   * Local axes: X = length, Y = profile "across", Z = profile "out".
   *
   * A 45° miter always puts the LONG POINT on the outer edge of the profile
   * (largest |across|), which is what a real mitered casing corner does.
   *
   * @param {Array<[number,number]>} profile  [across, out] contour
   * @param {number} len
   * @param {object} [opts] {miterStart, miterEnd, mirror, uvScale:[su,sv]}
   */
  function extrudeProfile(profileIn, len, opts = {}) {
    const profile = opts.mirror ? profileIn.map(([a, z]) => [-a, z]) : profileIn;
    const nF = profile.length;
    const su = (opts.uvScale && opts.uvScale[0]) || 1;
    const sv = (opts.uvScale && opts.uvScale[1]) || 1;
    const ms = opts.miterStart ? 1 : 0;
    const me = opts.miterEnd ? 1 : 0;
    let aMax = 0;
    for (const p of profile) aMax = Math.max(aMax, Math.abs(p[0]));
    const back = (a) => aMax - Math.abs(a);
    const x0 = (a) => ms * back(a);
    const x1 = (a) => len - me * back(a);
    const pv = [0];
    for (let j = 1; j <= nF; j++) {
      const a = profile[j - 1], b2 = profile[j % nF];
      pv.push(pv[j - 1] + Math.hypot(b2[0] - a[0], b2[1] - a[1]));
    }
    // orientation of the contour (positive area = CCW in (a, out))
    let area = 0;
    for (let j = 0; j < nF; j++) {
      const a = profile[j], b2 = profile[(j + 1) % nF];
      area += a[0] * b2[1] - b2[0] * a[1];
    }
    const sgn = area >= 0 ? 1 : -1;

    const b = new Builder();
    for (let j = 0; j < nF; j++) {
      const j1 = (j + 1) % nF;
      const a0 = profile[j], a1 = profile[j1];
      const da = a1[0] - a0[0], dz = a1[1] - a0[1];
      const l = Math.hypot(da, dz) || 1;
      const n = [0, (sgn * dz) / l, (-sgn * da) / l];
      const A = [x0(a0[0]), a0[0], a0[1]];
      const B2 = [x1(a0[0]), a0[0], a0[1]];
      const C = [x1(a1[0]), a1[0], a1[1]];
      const D = [x0(a1[0]), a1[0], a1[1]];
      b.quad(A, B2, C, D, n, [
        [0, pv[j] / sv], [len / su, pv[j] / sv], [len / su, pv[j + 1] / sv], [0, pv[j + 1] / sv],
      ]);
    }
    // caps (skip the mitered face — it butts its neighbour)
    const contour = profile.map((f) => new THREE.Vector2(f[0], f[1]));
    let tris = [];
    try { tris = THREE.ShapeUtils.triangulateShape(contour, []); } catch (e) { tris = []; }
    for (const tri of tris) {
      if (!opts.miterStart) {
        b.tri([0, profile[tri[0]][0], profile[tri[0]][1]],
          [0, profile[tri[1]][0], profile[tri[1]][1]],
          [0, profile[tri[2]][0], profile[tri[2]][1]], [-1, 0, 0],
          [[0, 0], [0, 0], [0, 0]]);
      }
      if (!opts.miterEnd) {
        b.tri([len, profile[tri[0]][0], profile[tri[0]][1]],
          [len, profile[tri[1]][0], profile[tri[1]][1]],
          [len, profile[tri[2]][0], profile[tri[2]][1]], [1, 0, 0],
          [[0, 0], [0, 0], [0, 0]]);
      }
      if (opts.miterStart) {
        // mitered end plane: normal at 45° in the (X, across) plane
        b.tri([x0(profile[tri[0]][0]), profile[tri[0]][0], profile[tri[0]][1]],
          [x0(profile[tri[1]][0]), profile[tri[1]][0], profile[tri[1]][1]],
          [x0(profile[tri[2]][0]), profile[tri[2]][0], profile[tri[2]][1]],
          [-0.7071, 0.7071, 0], [[0, 0], [0, 0], [0, 0]]);
      }
      if (opts.miterEnd) {
        b.tri([x1(profile[tri[0]][0]), profile[tri[0]][0], profile[tri[0]][1]],
          [x1(profile[tri[1]][0]), profile[tri[1]][0], profile[tri[1]][1]],
          [x1(profile[tri[2]][0]), profile[tri[2]][0], profile[tri[2]][1]],
          [0.7071, 0.7071, 0], [[0, 0], [0, 0], [0, 0]]);
      }
    }
    return b.geometry(THREE);
  }

  /* ---------------------------------------------------------------- */
  /* 2.4  standard millwork profiles (feet, [n, y] or [across, out])    */
  /* ---------------------------------------------------------------- */

  const PROFILE = {
    /** 5-1/2" modern base with a small eased cap. n=0 is the wall face. */
    base(h = TRIM.baseH, t = TRIM.baseT) {
      return [
        [0, 0], [t, 0],
        [t, h - inch(0.70)],
        [t * 0.74, h - inch(0.40)],
        [t * 0.74, h - inch(0.22)],
        [t * 0.34, h - inch(0.06)],
        [t * 0.30, h],
        [0, h],
      ];
    },
    /** Flat 4-1/4" contemporary base (basement / secondary rooms). */
    baseFlat(h = inch(4.25), t = inch(0.55)) {
      return [[0, 0], [t, 0], [t, h - inch(0.25)], [t * 0.55, h], [0, h]];
    },
    /**
     * Stepped crown.  y is measured DOWN from the ceiling (all y <= 0);
     * n = 0 is the wall face, +n into the room.
     */
    crownStepped(h = inch(4.6), p = inch(3.5)) {
      return [
        [0, 0], [0, -h],
        [inch(0.75), -h],
        [inch(0.75), -h + inch(0.42)],
        [inch(0.42), -h + inch(0.70)],
        [inch(0.42), -h + inch(1.20)],
        [p - inch(1.30), -inch(1.55)],
        [p - inch(1.30), -inch(1.15)],
        [p - inch(0.75), -inch(1.15)],
        [p - inch(0.75), -inch(0.70)],
        [p, -inch(0.70)],
        [p, 0],
      ];
    },
    /** Simple cove crown (bedrooms, halls). */
    crownCove(h = inch(3.5), p = inch(3.0)) {
      const pts = [[0, 0], [0, -h], [inch(0.55), -h]];
      for (let i = 0; i <= 6; i++) {
        const t = i / 6;
        pts.push([inch(0.55) + (p - inch(0.55)) * Math.sin(t * HALFPI), -h + h * (1 - Math.cos(t * HALFPI))]);
      }
      pts.push([p, 0]);
      return pts;
    },
    /** 3" chair rail with a bevelled cap. */
    chair(h = inch(3.0), t = inch(0.9)) {
      return [
        [0, 0], [t * 0.45, 0], [t * 0.45, inch(0.35)], [t, inch(0.80)],
        [t, h - inch(0.85)], [t * 0.5, h - inch(0.35)], [t * 0.5, h], [0, h],
      ];
    },
    /**
     * Flat 3-1/2" door / window casing with a 1/4" back-band step.
     * Coordinates are [across (0 = opening edge), out (0 = wall face)].
     */
    casing(w = TRIM.caseW, t = TRIM.caseT) {
      return [
        [0, 0], [w, 0],
        [w, t], [w - inch(0.30), t],
        [w - inch(0.30), t - inch(0.16)],
        [inch(0.28), t - inch(0.16)],
        [inch(0.28), t - inch(0.55)],
        [0, t - inch(0.62)],
      ];
    },
    /** Window stool (sill) profile — [across, out]. */
    stool(w = inch(4.5), t = inch(1.05)) {
      return [
        [0, 0], [w - inch(0.35), 0], [w, inch(0.35)], [w, t - inch(0.15)],
        [w - inch(0.2), t], [0, t],
      ];
    },
    /** Apron under the stool — [across = drop below the stool, out = thickness]. */
    apron(h = inch(2.6), t = inch(0.62)) {
      return [[0, 0], [0, t], [h - inch(0.30), t], [h, t * 0.55], [h, 0]];
    },
    /** Stair skirt / stringer board — [across = height, out = thickness]. */
    skirt(h = inch(9), t = inch(0.75)) {
      return [[0, 0], [0, t], [h, t], [h, 0]];
    },
  };

  /** UV scale (feet per repeat) for a library material. */
  function uvs(m) {
    const s = (m && m.userData && m.userData.scaleFeet) || [3, 3];
    return [s[0], s[1]];
  }

  /** Mesh from a swept profile with shadows on. */
  function sweptMesh(path, profile, material, opts = {}) {
    const g = sweepProfile(path, profile, Object.assign({ uvScale: uvs(material) }, opts));
    const m = new THREE.Mesh(g, material);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }

  /* ---------------------------------------------------------------- */
  /* 2.5  small shared parts                                            */
  /* ---------------------------------------------------------------- */

  /**
   * Cabinet pull.
   * @anchor centre of the pull's mounting face, on the door face (z = 0),
   *         projecting toward +Z.
   */
  function pull(style = 'brassBar', len = inch(5), material) {
    const g = G('face centre of the door, projecting +Z');
    if (style === 'none') return g;
    const m = material || (style === 'blackBar' ? P.blackMetal : P.brassPolished);
    const r = inch(0.28);
    const stand = inch(1.25);
    if (style === 'knob') {
      const post = cyl(inch(0.14), inch(0.14), inch(0.7), m, 12);
      post.rotation.x = HALFPI; post.position.z = inch(0.35);
      g.add(post);
      const k = ball(inch(0.42), m, 20);
      k.scale.set(1, 1, 0.8); k.position.z = inch(0.9);
      g.add(k);
      return g;
    }
    if (style === 'cup') {
      const c = new THREE.Mesh(new THREE.TorusGeometry(len / 2, r * 0.7, 8, 20, Math.PI), m);
      c.rotation.x = HALFPI; c.position.z = inch(0.5);
      c.castShadow = true; c.receiveShadow = true;
      g.add(c);
      return g;
    }
    // bar pull: two square posts + a bar with eased ends
    const bar = box(len, r * 2, r * 2, m, { r: r * 0.55, seg: 2 });
    bar.position.z = stand;
    g.add(bar);
    for (const s of [-1, 1]) {
      const post = box(inch(0.34), inch(0.34), stand, m, { r: inch(0.05) });
      post.position.set(s * (len / 2 - inch(0.4)), 0, stand / 2);
      g.add(post);
    }
    return g;
  }

  /**
   * Shaker (recessed flat panel) door or drawer face.
   * @anchor face centre; the BACK of the slab is z = 0, the front is z = +thickness.
   */
  function shakerDoorPanel(w, h, o = {}) {
    const stile = o.stileWidth === undefined ? inch(2.25) : o.stileWidth;
    const t = o.thickness === undefined ? inch(0.75) : o.thickness;
    const depth = o.panelDepth === undefined ? inch(0.25) : o.panelDepth;
    const m = o.material || P.wood;
    const g = G('face centre, back at z=0', [w, h, t]);
    const inner = t - depth;

    // back slab carries the recessed panel field
    const core = box(w, h, inner, m, { r: R_EASE, uv: true });
    core.position.z = inner / 2;
    g.add(core);

    const pw = Math.max(0.05, w - 2 * stile);
    const ph = Math.max(0.05, h - 2 * stile);
    // stiles (full height) + rails (between) — butt joints leave a fine groove
    const sL = box(stile, h, depth, m, { r: R_PAINT * 0.6, uv: true });
    sL.position.set(-w / 2 + stile / 2, 0, inner + depth / 2);
    const sR = sL.clone(); sR.position.x = w / 2 - stile / 2;
    const rT = box(pw + inch(0.02), stile, depth, m, { r: R_PAINT * 0.6, uv: true });
    rT.position.set(0, h / 2 - stile / 2, inner + depth / 2);
    const rB = rT.clone(); rB.position.y = -h / 2 + stile / 2;
    g.add(sL, sR, rT, rB);

    // ovolo sticking: a fine bead ring on the frame's inner edge
    if (o.bead !== false) {
      const bw = inch(0.16);
      const bh = box(pw + 2 * bw, bw, depth * 0.55, m, { r: inch(0.04) });
      bh.position.set(0, ph / 2 + bw / 2, inner + depth * 0.72);
      const bh2 = bh.clone(); bh2.position.y = -(ph / 2 + bw / 2);
      const bv = box(bw, ph, depth * 0.55, m, { r: inch(0.04) });
      bv.position.set(-(pw / 2 + bw / 2), 0, inner + depth * 0.72);
      const bv2 = bv.clone(); bv2.position.x = pw / 2 + bw / 2;
      g.add(bh, bh2, bv, bv2);
    }
    g.userData.panelRect = [pw, ph];
    return g;
  }

  /**
   * Flat slab door / drawer face (modern casework).
   * @anchor face centre; back at z = 0.
   */
  function slabDoorPanel(w, h, o = {}) {
    const t = o.thickness === undefined ? inch(0.75) : o.thickness;
    const m = o.material || P.wood;
    const g = G('face centre, back at z=0', [w, h, t]);
    const s = box(w, h, t, m, { r: inch(0.07), seg: 2, uv: true });
    s.position.z = t / 2;
    g.add(s);
    return g;
  }

  /* ---------------------------------------------------------------- */
  /* 2.6  millwork factories                                            */
  /* ---------------------------------------------------------------- */

  /**
   * Baseboard swept along a plan path and mitered at every corner.
   * Run the path so the room interior is on the path's RIGHT
   * (`(uz, 0, -ux)`), or pass `flip:true`.
   *
   * @anchor the path itself, at the finished-floor plane (y = 0).
   * @param {Array<[number,number]>} path plan points [x, z]
   * @param {object} [o] {height, thickness, profile:'modern'|'flat', closed,
   *                      material, shoe, scribe}
   */
  function baseboard(path, o = {}) {
    const h = o.height === undefined ? TRIM.baseH : o.height;
    const t = o.thickness === undefined ? TRIM.baseT : o.thickness;
    const prof = o.profile === 'flat' ? PROFILE.baseFlat(h, t) : PROFILE.base(h, t);
    const m = o.material || P.trimWhite;
    const g = G('plan path at finished floor, y = 0');
    // scribe: the board is undercut 1/32" at the back so it never z-fights the
    // wall, and lifted 1/64" off the floor where a shoe would cover the gap
    const scribe = o.scribe === undefined ? inch(1 / 32) : o.scribe;
    const p2 = prof.map(([n, y]) => [n - scribe, y]);
    const mesh = sweptMesh(path, p2, m, { closed: !!o.closed, flip: !!o.flip });
    g.add(mesh);
    if (o.shoe) {
      const sh = [[0, 0], [inch(0.5), 0], [inch(0.5), inch(0.2)], [inch(0.18), inch(0.62)], [0, inch(0.62)]];
      g.add(sweptMesh(path, sh.map(([n, y]) => [n + t - scribe, y]), m,
        { closed: !!o.closed, flip: !!o.flip }));
    }
    g.userData.size = [0, h, t];
    return g;
  }

  /**
   * Crown molding swept along a plan path, mitered at corners.
   * @anchor the path at the CEILING plane (y = 0 is the ceiling); the profile
   *         hangs below into negative y.
   */
  function crownMolding(path, o = {}) {
    const style = o.profile || 'stepped';
    const h = o.height === undefined ? (style === 'cove' ? inch(3.5) : inch(4.6)) : o.height;
    const p = o.projection === undefined ? (style === 'cove' ? inch(3.0) : inch(3.5)) : o.projection;
    const prof = style === 'cove' ? PROFILE.crownCove(h, p) : PROFILE.crownStepped(h, p);
    const m = o.material || P.trimWhite;
    const g = G('plan path at the ceiling plane, y = 0');
    g.add(sweptMesh(path, prof, m, { closed: !!o.closed, flip: !!o.flip }));
    g.userData.size = [0, h, p];
    return g;
  }

  /**
   * Chair rail swept along a plan path.
   * @anchor the path at the rail's BOTTOM edge (default 32" AFF — set y yourself).
   */
  function chairRail(path, o = {}) {
    const m = o.material || P.trimWhite;
    const g = G('plan path at the bottom edge of the rail');
    g.add(sweptMesh(path, PROFILE.chair(o.height, o.thickness), m,
      { closed: !!o.closed, flip: !!o.flip }));
    return g;
  }

  /**
   * Mitered flat casing around a rectangular opening (3 legs + head, or 4).
   * Built on ONE side of the wall; call twice for a through opening.
   *
   * @anchor bottom centre of the OPENING, in the wall face plane (z = 0);
   *         the casing projects toward +Z.
   * @param {object} o {w, h, width, thickness, sill:boolean, material}
   */
  function doorCasing(o = {}) {
    const w = o.w === undefined ? DOOR.widthStd : o.w;
    const h = o.h === undefined ? DOOR.leafH : o.h;
    const cw = o.width === undefined ? TRIM.caseW : o.width;
    const ct = o.thickness === undefined ? TRIM.caseT : o.thickness;
    const rev = o.reveal === undefined ? inch(0.25) : o.reveal;
    const m = o.material || P.trimWhite;
    const g = G('bottom centre of the opening, wall face at z = 0', [w + 2 * cw, h + cw, ct]);
    const prof = PROFILE.casing(cw, ct);
    const uv = uvs(m);
    const x0 = w / 2 + rev; // inner edge of the casing
    const y0 = h + rev;
    for (const leg of casingLegs(prof, x0, y0, cw, m, uv, true)) g.add(leg);
    return g;
  }

  /**
   * The three mitered casing legs shared by door and window casing.
   * Rz(+90) maps local X (length) -> +Y and local Y (across) -> -X, so the
   * right-hand leg uses a mirrored profile instead of a negative scale.
   */
  function casingLegs(prof, x0, y0, cw, m, uv, headOnly) {
    const out = [];
    for (const s of [-1, 1]) {
      const geo = extrudeProfile(prof, y0 + cw, { miterEnd: true, mirror: s > 0, uvScale: uv });
      const leg = new THREE.Mesh(geo, m);
      leg.castShadow = true; leg.receiveShadow = true;
      leg.rotation.z = HALFPI;
      leg.position.set(s * x0, 0, 0);
      out.push(leg);
    }
    const headGeo = extrudeProfile(prof, 2 * (x0 + cw), {
      miterStart: true, miterEnd: true, uvScale: uv,
    });
    const head = new THREE.Mesh(headGeo, m);
    head.castShadow = true; head.receiveShadow = true;
    head.position.set(-(x0 + cw), y0, 0);
    out.push(head);
    return out;
  }

  /**
   * Window casing: mitered casing on 3 sides plus a stool (sill) and apron.
   * @anchor bottom centre of the window OPENING, wall face at z = 0.
   */
  function windowCasing(o = {}) {
    const w = o.w === undefined ? 3 : o.w;
    const h = o.h === undefined ? 4 : o.h;
    const cw = o.width === undefined ? TRIM.caseW : o.width;
    const ct = o.thickness === undefined ? TRIM.caseT : o.thickness;
    const m = o.material || P.trimWhite;
    const rev = o.reveal === undefined ? inch(0.25) : o.reveal;
    const g = G('bottom centre of the window opening, wall face at z = 0');
    const uv = uvs(m);
    const prof = PROFILE.casing(cw, ct);
    const x0 = w / 2 + rev;
    const y0 = h + rev;

    if (o.picture) {
      // picture-framed: 4 mitered legs, no stool
      for (const s of [-1, 1]) {
        const geo = extrudeProfile(prof, y0 + 2 * cw, {
          miterStart: true, miterEnd: true, mirror: s > 0, uvScale: uv,
        });
        const leg = new THREE.Mesh(geo, m);
        leg.castShadow = true; leg.receiveShadow = true;
        leg.rotation.z = HALFPI;
        leg.position.set(s * x0, -cw, 0);
        g.add(leg);
      }
      for (const sy of [0, 1]) {
        const geo = extrudeProfile(prof, 2 * (x0 + cw), {
          miterStart: true, miterEnd: true, mirror: sy === 0, uvScale: uv,
        });
        const bar = new THREE.Mesh(geo, m);
        bar.castShadow = true; bar.receiveShadow = true;
        bar.position.set(-(x0 + cw), sy === 0 ? 0 : y0, 0);
        g.add(bar);
      }
      return g;
    }

    // stool: projects past the casing and past the wall face.  Mirrored so the
    // profile's "across" runs into the room (+Z) with thickness up (+Y).
    const stoolW = inch(4.6);
    const stoolLen = 2 * (x0 + cw) + inch(1.5);
    const stGeo = extrudeProfile(PROFILE.stool(stoolW, inch(1.05)), stoolLen, {
      mirror: true, uvScale: uv,
    });
    const stool = new THREE.Mesh(stGeo, m);
    stool.castShadow = true; stool.receiveShadow = true;
    stool.rotation.x = -HALFPI;
    stool.position.set(-stoolLen / 2, -inch(1.05), -inch(0.9));
    g.add(stool);

    // apron below the stool (mirror = the profile hangs downward)
    const apLen = 2 * (x0 + cw) - inch(1.2);
    const apGeo = extrudeProfile(PROFILE.apron(inch(2.6), inch(0.62)), apLen, {
      mirror: true, uvScale: uv,
    });
    const apron = new THREE.Mesh(apGeo, m);
    apron.castShadow = true; apron.receiveShadow = true;
    apron.position.set(-apLen / 2, -inch(1.05), 0);
    g.add(apron);

    for (const leg of casingLegs(prof, x0, y0, cw, m, uv)) g.add(leg);
    return g;
  }

  /* ---------------------------------------------------------------- */
  /* 2.7  door leaves                                                   */
  /* ---------------------------------------------------------------- */

  /**
   * A stile-and-rail door leaf built additively: a thin core slab plus
   * frame members on BOTH faces, with a bevelled sticking around every panel.
   * That is how a real moulded door is put together and it gives the panel
   * edges the soft shadow line a flat texture can never fake.
   *
   * @anchor bottom centre of the leaf; the leaf straddles z = 0 (+/- t/2).
   * @param {number} w leaf width
   * @param {number} h leaf height
   * @param {object} [o] {thickness, style:'sixPanel'|'twoPanel'|'slab'|'shaker',
   *                      material, raised}
   */
  function doorLeaf(w, h, o = {}) {
    const t = o.thickness === undefined ? DOOR.leafT : o.thickness;
    const style = o.style || 'sixPanel';
    const m = o.material || P.trimWhite;
    const g = G('bottom centre of the leaf, straddling z = 0', [w, h, t]);

    if (style === 'slab') {
      const s = box(w, h, t, m, { r: inch(0.08), seg: 2, uv: true });
      s.position.y = h / 2;
      g.add(s);
      return g;
    }

    const stile = o.stileWidth === undefined ? inch(4.5) : o.stileWidth;
    const railT = inch(4.5);          // top rail
    const railB = inch(8.5);          // bottom rail
    const railL = inch(7.0);          // lock rail
    const railM = inch(4.5);          // intermediate rail
    const mull = inch(4.5);           // centre mullion
    const rows = style === 'twoPanel' ? 2 : 3;
    const cols = style === 'twoPanel' ? 1 : 2;

    const fd = inch(0.28);            // frame thickness added to each face
    const core = t - 2 * fd;
    const cs = box(w, h, core, m, { r: R_EASE, uv: true });
    cs.position.y = h / 2;
    g.add(cs);

    // vertical panel columns
    const colXs = [];
    if (cols === 1) colXs.push([-w / 2 + stile, w / 2 - stile]);
    else {
      const inner = w - 2 * stile - mull;
      const cw2 = inner / 2;
      colXs.push([-w / 2 + stile, -w / 2 + stile + cw2]);
      colXs.push([w / 2 - stile - cw2, w / 2 - stile]);
    }
    // horizontal panel rows (bottom-up)
    const rowYs = [];
    if (rows === 2) {
      const free = h - railB - railL - railT;
      const y0 = railB;
      rowYs.push([y0, y0 + free * 0.55]);
      rowYs.push([y0 + free * 0.55 + railL, h - railT]);
    } else {
      const free = h - railB - railL - railM - railT;
      const hs = [free * 0.495, free * 0.29, free * 0.215]; // bottom, middle, top
      let y = railB;
      rowYs.push([y, y + hs[0]]); y += hs[0] + railL;
      rowYs.push([y, y + hs[1]]); y += hs[1] + railM;
      rowYs.push([y, y + hs[2]]);
    }

    // the panel openings, as rectangles in leaf coordinates
    const rects = [];
    for (const [xa, xb] of colXs) for (const [ya, yb] of rowYs) rects.push([xa, ya, xb, yb]);

    // skins: one real plate per face with the panel openings punched through
    for (const sgn of [1, -1]) {
      const skin = plateWithHoles(w, h,
        rects.map(([xa, ya, xb, yb]) => [xa, ya - h / 2, xb, yb - h / 2]),
        fd, m, { bevel: inch(0.045) });
      skin.position.set(0, h / 2, sgn > 0 ? core / 2 : -core / 2 - fd);
      g.add(skin);
      for (const [xa, ya, xb, yb] of rects) {
        g.add(stickingRing(xa, ya, xb, yb, sgn * (core / 2 + fd), sgn * (core / 2),
          inch(0.42), m));
        if (o.raised !== false) {
          const rp = box(xb - xa - inch(1.1), yb - ya - inch(1.1), inch(0.13), m,
            { r: inch(0.06), seg: 2, uv: true });
          rp.position.set((xa + xb) / 2, (ya + yb) / 2, sgn * (core / 2 + inch(0.065)));
          g.add(rp);
        }
      }
    }
    void mull;
    return g;
  }

  /** Four sloped quads: the bevel from a frame face down into a panel field. */
  function stickingRing(x0, y0, x1, y1, zTop, zBot, inset, material) {
    const b = new Builder();
    const iz = Math.sign(zTop) || 1;
    const quads = [
      // [outer a, outer b, inner a, inner b]
      [[x0, y0], [x1, y0], [x1 + -inset * 0, y0 + inset], [x0, y0 + inset], [0, -1]],
    ];
    void quads;
    const O = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    const I = [[x0 + inset, y0 + inset], [x1 - inset, y0 + inset],
      [x1 - inset, y1 - inset], [x0 + inset, y1 - inset]];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      const A = [O[i][0], O[i][1], zTop];
      const B2 = [O[j][0], O[j][1], zTop];
      const C = [I[j][0], I[j][1], zBot];
      const D = [I[i][0], I[i][1], zBot];
      const e1 = v3sub(B2, A), e2 = v3sub(D, A);
      const n = v3norm(v3cross(e1, e2));
      if (n[2] * iz < 0) { n[0] = -n[0]; n[1] = -n[1]; n[2] = -n[2]; }
      b.quad(A, B2, C, D, n, [[0, 0], [1, 0], [1, 1], [0, 1]]);
    }
    const m = new THREE.Mesh(b.geometry(THREE), material);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }

  /** Lever handle set (interior door). @anchor lever centre on the +Z face. */
  function leverSet(o = {}) {
    const m = o.material || P.blackMetal;
    const g = G('lever centre on the door face');
    for (const s of [1, -1]) {
      const rose = cyl(inch(1.3), inch(1.3), inch(0.35), m, 24);
      rose.rotation.x = HALFPI;
      rose.position.z = s * (o.leafT || DOOR.leafT) / 2;
      g.add(rose);
      const neck = cyl(inch(0.45), inch(0.42), inch(1.1), m, 16);
      neck.rotation.x = HALFPI;
      neck.position.z = s * ((o.leafT || DOOR.leafT) / 2 + inch(0.55));
      g.add(neck);
      const lev = box(inch(4.2), inch(0.62), inch(0.55), m, { r: inch(0.22), seg: 3 });
      lev.position.set(-s * inch(1.7), 0, s * ((o.leafT || DOOR.leafT) / 2 + inch(1.0)));
      g.add(lev);
    }
    return g;
  }

  /** Butt hinge. @anchor hinge barrel centre, barrel axis = Y. */
  function hinge(o = {}) {
    const m = o.material || P.blackMetal;
    const g = G('hinge barrel centre, axis Y');
    const barrel = cyl(inch(0.32), inch(0.32), inch(3.4), m, 14);
    g.add(barrel);
    const tip = cyl(inch(0.2), inch(0.2), inch(0.35), m, 10);
    tip.position.y = inch(1.85); g.add(tip);
    return g;
  }

  /* ---------------------------------------------------------------- */
  /* 2.8  interior door assemblies                                      */
  /* ---------------------------------------------------------------- */

  /**
   * Interior door: jamb + stop + leaf + hardware (+ casing both sides).
   *
   * @anchor bottom centre of the ROUGH OPENING, on the wall centreline
   *         (z = 0).  The leaf swings toward +Z.
   * @param {object} [o] {w, h, style:'sixPanel'|'slab', hand:'left'|'right',
   *                      open (radians), wall, casing, material}
   */
  function interiorDoor(o = {}) {
    const w = o.w === undefined ? DOOR.widthStd : o.w;
    const h = o.h === undefined ? DOOR.leafH : o.h;
    const wall = o.wall === undefined ? 0.375 : o.wall;
    const hand = o.hand === 'right' ? 'right' : 'left';
    const open = o.open === undefined ? 0 : o.open;
    const m = o.material || P.trimWhite;
    const g = G('bottom centre of the rough opening, wall centreline z = 0',
      [w + 2 * inch(0.75), h + inch(0.75), wall]);

    const jt = inch(0.75);
    const jd = wall;
    // jamb legs + head
    for (const s of [-1, 1]) {
      const leg = box(jt, h + jt, jd, m, { r: R_PAINT, uv: true });
      leg.position.set(s * (w / 2 + jt / 2), (h + jt) / 2, 0);
      g.add(leg);
    }
    const head = box(w + 2 * jt, jt, jd, m, { r: R_PAINT, uv: true });
    head.position.set(0, h + jt / 2, 0);
    g.add(head);
    // door stop bead, 3/4" back from the +Z face of the jamb
    const sd = inch(0.45), so = jd / 2 - DOOR.leafT - inch(0.12);
    for (const s of [-1, 1]) {
      const st = box(inch(0.5), h, sd, m, { r: inch(0.05) });
      st.position.set(s * (w / 2 - inch(0.25)), h / 2, so - sd / 2);
      g.add(st);
    }
    const sth = box(w, inch(0.5), sd, m, { r: inch(0.05) });
    sth.position.set(0, h - inch(0.25), so - sd / 2);
    g.add(sth);

    // leaf: 1/8" gap each side, 1/2" undercut
    const lw = w - 2 * REVEAL;
    const lh = h - REVEAL - inch(0.5);
    const hx = hand === 'left' ? -1 : 1;
    const pivot = new THREE.Group();
    pivot.position.set(hx * (w / 2 - REVEAL), inch(0.5), so - DOOR.leafT / 2);
    pivot.rotation.y = -hx * open;
    const leaf = doorLeaf(lw, lh, { style: o.style || 'sixPanel', material: m });
    leaf.position.x = -hx * lw / 2;
    pivot.add(leaf);
    // hardware
    const lev = leverSet({ leafT: DOOR.leafT });
    lev.position.set(-hx * (lw - inch(2.75)), ft(3, 0) - inch(6), 0);
    pivot.add(lev);
    g.add(pivot);
    g.userData.pivot = pivot;

    for (const y of [inch(9), lh / 2, lh - inch(9)]) {
      const hg = hinge();
      hg.position.set(hx * (w / 2 - REVEAL), y + inch(0.5), so - DOOR.leafT - inch(0.05));
      g.add(hg);
    }

    if (o.casing !== false) {
      for (const s of [1, -1]) {
        const c = doorCasing({ w: w + 2 * jt, h: h + jt, material: m });
        c.position.z = s * jd / 2;
        if (s < 0) c.rotation.y = Math.PI;
        g.add(c);
      }
    }
    return g;
  }

  /**
   * Bypass (sliding) closet doors — two leaves on a header track, the front
   * leaf offset toward +Z.  Matches the white six-panel bypass pair in
   * `foyer_view_of_front_door.png`, complete with round recessed finger pulls.
   *
   * @anchor bottom centre of the rough opening, wall centreline z = 0.
   * @param {object} [o] {w, h, panels, style, wall, open (0..1), casing}
   */
  function bypassClosetDoors(o = {}) {
    const w = o.w === undefined ? 5 : o.w;
    const h = o.h === undefined ? DOOR.leafH : o.h;
    const n = o.panels === undefined ? 2 : o.panels;
    const wall = o.wall === undefined ? 0.375 : o.wall;
    const m = o.material || P.trimWhite;
    const g = G('bottom centre of the rough opening, wall centreline z = 0', [w, h, wall]);
    const jt = inch(0.75);
    for (const s of [-1, 1]) {
      const leg = box(jt, h + jt, wall, m, { r: R_PAINT, uv: true });
      leg.position.set(s * (w / 2 + jt / 2), (h + jt) / 2, 0);
      g.add(leg);
    }
    const head = box(w + 2 * jt, jt, wall, m, { r: R_PAINT, uv: true });
    head.position.set(0, h + jt / 2, 0);
    g.add(head);
    // track fascia
    const tr = box(w, inch(1.6), inch(0.7), m, { r: inch(0.05) });
    tr.position.set(0, h - inch(0.8), wall / 2 - inch(0.35));
    g.add(tr);

    const overlap = inch(1.0);
    const lw = (w + (n - 1) * overlap) / n;
    const lh = h - inch(1.6) - inch(0.5);
    const open = clamp(o.open === undefined ? 0 : o.open, 0, 1);
    for (let i = 0; i < n; i++) {
      const front = i % 2 === 1;
      const z = wall / 2 - inch(0.95) - (front ? 0 : inch(1.15));
      const leaf = doorLeaf(lw, lh, { style: o.style || 'sixPanel', material: m });
      let x = -w / 2 + lw / 2 + i * (lw - overlap);
      if (front && open > 0) x -= (lw - overlap) * open;
      leaf.position.set(x, inch(0.4), z);
      g.add(leaf);
      // round recessed finger pull
      const fp = torus(inch(0.85), inch(0.11), P.blackMetal, 28, 8);
      fp.position.set(x + (i === 0 ? lw / 2 - inch(2.6) : -lw / 2 + inch(2.6)),
        ft(3, 4), z + DOOR.leafT / 2 + inch(0.02));
      g.add(fp);
      const fpd = new THREE.Mesh(new THREE.CircleGeometry(inch(0.85), 28), P.black);
      fpd.position.copy(fp.position);
      fpd.position.z -= inch(0.14);
      fpd.receiveShadow = true;
      g.add(fpd);
    }
    if (o.casing !== false) {
      for (const s of [1, -1]) {
        const c = doorCasing({ w: w + 2 * jt, h: h + jt, material: m });
        c.position.z = s * wall / 2;
        if (s < 0) c.rotation.y = Math.PI;
        g.add(c);
      }
    }
    return g;
  }

  /**
   * Plantation shutters as real geometry — frame, stiles/rails, tilting
   * louvers and (optionally) a front tilt rod.  Every listing photo of a
   * street-facing window shows these, so they carry a lot of the house's look.
   *
   * @anchor bottom centre of the opening they fill; the frame's BACK is z = 0
   *         and the assembly builds toward +Z (into the room).
   * @param {number} w
   * @param {number} h
   * @param {object} [o] {panels, louverW, spacing, tilt (rad), rod, material,
   *                      divider (fraction of h for a mid rail)}
   */
  function plantationShutters(w, h, o = {}) {
    const m = o.material || P.trimWhite;
    const n = o.panels === undefined ? Math.max(1, Math.round(w / 1.5)) : o.panels;
    const lw = o.louverW === undefined ? inch(3.5) : o.louverW;
    const sp = o.spacing === undefined ? inch(3.0) : o.spacing;
    const tilt = o.tilt === undefined ? deg(28) : o.tilt;
    const fr = inch(1.4);   // hanging frame
    const st = inch(2.1);   // panel stile
    const d = inch(1.05);   // panel thickness
    const g = G('bottom centre of the opening, frame back at z = 0', [w, h, fr]);

    // hanging frame
    for (const s of [-1, 1]) {
      const v = box(fr, h, inch(1.0), m, { r: R_PAINT, uv: true });
      v.position.set(s * (w / 2 - fr / 2), h / 2, inch(0.5));
      g.add(v);
      const hz = box(w - 2 * fr, fr, inch(1.0), m, { r: R_PAINT, uv: true });
      hz.position.set(0, s < 0 ? fr / 2 : h - fr / 2, inch(0.5));
      g.add(hz);
    }

    const pw = (w - 2 * fr) / n;
    const ph = h - 2 * fr;
    for (let i = 0; i < n; i++) {
      const cx = -w / 2 + fr + pw * (i + 0.5);
      const panel = new THREE.Group();
      panel.position.set(cx, fr + ph / 2, inch(1.05));
      // stiles and rails
      for (const s of [-1, 1]) {
        const v = box(st, ph, d, m, { r: R_PAINT, uv: true });
        v.position.set(s * (pw / 2 - st / 2 - inch(0.06)), 0, 0);
        panel.add(v);
        const hz = box(pw - 2 * st, inch(2.4), d, m, { r: R_PAINT, uv: true });
        hz.position.set(0, s * (ph / 2 - inch(1.2)), 0);
        panel.add(hz);
      }
      const bands = [];
      if (o.divider) {
        const dy = -ph / 2 + ph * o.divider;
        const dr = box(pw - 2 * st, inch(2.4), d, m, { r: R_PAINT, uv: true });
        dr.position.set(0, dy, 0);
        panel.add(dr);
        bands.push([-ph / 2 + inch(2.4), dy - inch(1.2)]);
        bands.push([dy + inch(1.2), ph / 2 - inch(2.4)]);
      } else {
        bands.push([-ph / 2 + inch(2.4), ph / 2 - inch(2.4)]);
      }
      const lvw = pw - 2 * st + inch(0.3);
      for (const [ya, yb] of bands) {
        const span = yb - ya;
        const cnt = Math.max(1, Math.floor(span / sp));
        const step = span / cnt;
        for (let k = 0; k < cnt; k++) {
          const y = ya + step * (k + 0.5);
          const lv = box(lvw, lw, inch(0.28), m, { r: inch(0.12), seg: 2 });
          lv.position.set(0, y, 0);
          lv.rotation.x = tilt;
          panel.add(lv);
        }
        if (o.rod) {
          const rod = box(inch(0.5), span, inch(0.5), m, { r: inch(0.1) });
          rod.position.set(0, (ya + yb) / 2, lw / 2 * Math.sin(tilt) + inch(0.45));
          panel.add(rod);
        }
      }
      g.add(panel);
    }
    return g;
  }

  /**
   * The front door: a BLACK slab with a round frosted-glass porthole, a
   * reeded centre panel below it and flanking flat panels — exactly the leaf
   * in `exterior_view_of_front_door.png` / `foyer_view_of_front_door.png`.
   *
   * @anchor bottom centre of the door OPENING (leaf only, no sidelights),
   *         wall centreline z = 0; +Z is the interior (the leaf swings in).
   * @param {object} [o] {w, h, open, hand, wall, sidelights, sidelightW,
   *                      shutters}
   */
  function frontDoor(o = {}) {
    const w = o.w === undefined ? DOOR.entryW : o.w;
    const h = o.h === undefined ? DOOR.entryH : o.h;
    const t = o.thickness === undefined ? DOOR.entryT : o.thickness;
    const wall = o.wall === undefined ? 0.55 : o.wall;
    const hand = o.hand === 'left' ? 'left' : 'right';
    const open = o.open === undefined ? 0 : o.open;
    const g = G('bottom centre of the door opening, wall centreline z = 0',
      [w, h, wall]);

    const jamb = P.black;
    const jt = inch(1.0);
    for (const s of [-1, 1]) {
      const leg = box(jt, h + jt, wall, jamb, { r: R_PAINT });
      leg.position.set(s * (w / 2 + jt / 2), (h + jt) / 2, 0);
      g.add(leg);
    }
    const head = box(w + 2 * jt, jt, wall, jamb, { r: R_PAINT });
    head.position.set(0, h + jt / 2, 0);
    g.add(head);
    // aluminium sill
    const sill = box(w + 2 * jt, inch(1.1), wall + inch(1.2), P.blackMetal, { r: inch(0.06) });
    sill.position.set(0, -inch(0.55), 0);
    g.add(sill);

    const lw = w - 2 * REVEAL;
    const lh = h - REVEAL;
    const hx = hand === 'left' ? -1 : 1;
    const pivot = new THREE.Group();
    pivot.position.set(hx * (w / 2 - REVEAL), 0, wall / 2 - t - inch(0.2));
    pivot.rotation.y = -hx * open;
    g.add(pivot);
    g.userData.pivot = pivot;

    const leaf = new THREE.Group();
    leaf.position.set(-hx * lw / 2, 0, t / 2);
    pivot.add(leaf);

    const bl = P.black;
    const fd = inch(0.32);
    const core = t - 2 * fd;

    // ---- layout: porthole above, three panel columns below --------------
    const stile = inch(4.6);
    const railT = inch(4.2), railB = inch(9.5);
    const portR = Math.min(lw * 0.34, inch(11.0));
    const portY = lh - railT - portR - inch(5.0);
    const panelTop = portY - portR - inch(6.0);
    const fieldW = lw - 2 * stile;
    const centreW = fieldW * 0.40;
    const mullW = inch(4.4);
    const sideW = (fieldW - centreW - 2 * mullW) / 2;
    const midY = railB + (panelTop - railB) * 0.62;
    const cx0 = -centreW / 2, cx1 = centreW / 2;

    const rects = [[cx0, railB, cx1, panelTop]];
    for (const s of [-1, 1]) {
      const a = s < 0 ? -(centreW / 2 + mullW + sideW) : centreW / 2 + mullW;
      const b2 = a + sideW;
      rects.push([a, railB, b2, midY - inch(2.1)]);
      rects.push([a, midY + inch(2.1), b2, panelTop]);
    }
    const port = { circle: true, x: 0, y: portY - lh / 2, r: portR };

    // the core is a real plate with a real hole through it for the porthole
    const slab = plateWithHoles(lw, lh, [port], core, bl, { bevel: inch(0.05) });
    slab.position.set(0, lh / 2, -core / 2);
    leaf.add(slab);

    // skins: panel openings AND the porthole punched through, both faces
    for (const sgn of [1, -1]) {
      const skin = plateWithHoles(lw, lh,
        rects.map(([xa, ya, xb, yb]) => [xa, ya - lh / 2, xb, yb - lh / 2]).concat([port]),
        fd, bl, { bevel: inch(0.05) });
      skin.position.set(0, lh / 2, sgn > 0 ? core / 2 : -core / 2 - fd);
      leaf.add(skin);
      for (const [xa, ya, xb, yb] of rects) {
        leaf.add(stickingRing(xa, ya, xb, yb, sgn * (core / 2 + fd), sgn * (core / 2),
          inch(0.55), bl));
      }
      // reeded centre panel: vertical half-round flutes in the tall panel
      const flutes = 11;
      const fw = (centreW - inch(2.6)) / flutes;
      for (let i = 0; i < flutes; i++) {
        const fl = cyl(fw * 0.5, fw * 0.5, panelTop - railB - inch(3.0), bl, 10);
        fl.position.set(-(centreW - inch(2.6)) / 2 + fw * (i + 0.5), (railB + panelTop) / 2,
          sgn * (core / 2 - inch(0.02)));
        fl.scale.z = 0.62;
        leaf.add(fl);
      }
      // the porthole gets a proud bevelled ring on each face
      const ring = ellipseRing(portR + inch(1.7), portR + inch(1.7), portR, portR,
        inch(0.30), bl, { curveSegments: 64 });
      ring.position.set(0, portY, sgn > 0 ? core / 2 + fd : -core / 2 - fd - inch(0.30));
      leaf.add(ring);
      const lip = torus(portR + inch(0.16), inch(0.20), bl, 64, 8);
      lip.position.set(0, portY, sgn * (core / 2 + fd + inch(0.16)));
      leaf.add(lip);
    }

    // textured frosted glass filling the porthole
    const gl = new THREE.Mesh(new THREE.CircleGeometry(portR + inch(0.25), 64), P.frosted);
    gl.position.set(0, portY, 0);
    gl.receiveShadow = true;
    leaf.add(gl);
    const gl2 = new THREE.Mesh(new THREE.CircleGeometry(portR + inch(0.25), 64), P.frosted);
    gl2.rotation.y = Math.PI;
    gl2.position.set(0, portY, -inch(0.06));
    leaf.add(gl2);

    // ---- handleset: long black backplate, lever, deadbolt ---------------
    const hs = new THREE.Group();
    hs.position.set(-hx * (lw / 2 - inch(3.0)), ft(3, 0), 0);
    leaf.add(hs);
    for (const zs of [1, -1]) {
      const plate = box(inch(2.4), inch(11), inch(0.28), P.blackMetal, { r: inch(0.25), seg: 2 });
      plate.position.z = zs * (core / 2 + fd + inch(0.1));
      hs.add(plate);
      const knob = ball(inch(0.9), P.blackMetal, 20);
      knob.scale.set(1, 1, 0.6);
      knob.position.set(0, inch(3.4), zs * (core / 2 + fd + inch(0.4)));
      hs.add(knob);
      const lev = box(inch(3.6), inch(0.55), inch(0.5), P.blackMetal, { r: inch(0.2), seg: 3 });
      lev.position.set(hx * inch(1.4), -inch(1.2), zs * (core / 2 + fd + inch(0.65)));
      hs.add(lev);
    }
    const db = cyl(inch(0.95), inch(0.95), inch(0.5), P.blackMetal, 24);
    db.rotation.x = HALFPI;
    db.position.set(-hx * (lw / 2 - inch(3.0)), ft(4, 0), core / 2 + fd + inch(0.25));
    leaf.add(db);

    for (const y of [inch(10), lh * 0.5, lh - inch(10)]) {
      const hg = hinge({ material: P.blackMetal });
      hg.position.set(hx * (w / 2 - REVEAL), y, wall / 2 - t - inch(0.25));
      g.add(hg);
    }

    // ---- sidelights with white plantation shutters ----------------------
    if (o.sidelights) {
      const sw = o.sidelightW === undefined ? ft(1, 4) : o.sidelightW;
      const sides = o.sidelights === 'left' ? [-1] : o.sidelights === 'right' ? [1] : [-1, 1];
      for (const s of sides) {
        const cx = s * (w / 2 + jt + sw / 2);
        // jamb legs + head only — never a solid panel across the light
        for (const sx of [-1, 1]) {
          const leg = box(jt, h + jt, wall, jamb, { r: R_PAINT });
          leg.position.set(cx + sx * (sw / 2 + jt / 2), (h + jt) / 2, 0);
          g.add(leg);
        }
        const hd2 = box(sw + 2 * jt, jt, wall, jamb, { r: R_PAINT });
        hd2.position.set(cx, h + jt / 2, 0);
        g.add(hd2);
        const sash = sashFrame(sw, h, {
          material: jamb, stile: inch(2.0), rail: inch(2.4), glass: P.glass,
          thickness: inch(1.8),
        });
        sash.position.set(cx, h / 2, -wall / 2 + inch(1.6));
        g.add(sash);
        // white plantation shutters on the inside face
        const sh = plantationShutters(sw - inch(0.4), h - inch(0.4), {
          panels: 1, divider: 0.52, tilt: deg(22), material: P.trimWhite,
        });
        sh.position.set(cx, inch(0.2), wall / 2 - inch(3.4));
        g.add(sh);
        const sc = windowCasing({ w: sw + 2 * jt, h: h + jt, material: P.trimWhite, picture: true });
        sc.position.set(cx, 0, wall / 2);
        g.add(sc);
      }
    }
    return g;
  }

  /* ---------------------------------------------------------------- */
  /* 2.9  windows                                                       */
  /* ---------------------------------------------------------------- */

  /** One glazed sash: frame members + glass + optional divided-lite muntins. */
  function sashFrame(w, h, o = {}) {
    const m = o.material || P.trimWhite;
    const st = o.stile === undefined ? inch(1.9) : o.stile;
    const t = o.thickness === undefined ? inch(1.6) : o.thickness;
    const g = G('sash centre, straddling z = 0', [w, h, t]);
    for (const s of [-1, 1]) {
      const v = box(st, h, t, m, { r: R_PAINT, uv: true });
      v.position.set(s * (w / 2 - st / 2), 0, 0);
      g.add(v);
      const hz = box(w - 2 * st, o.rail || st, t, m, { r: R_PAINT, uv: true });
      hz.position.set(0, s * (h / 2 - (o.rail || st) / 2), 0);
      g.add(hz);
    }
    const gw = w - 2 * st + inch(0.3), gh = h - 2 * (o.rail || st) + inch(0.3);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(gw, gh), o.glass || P.glass);
    glass.position.z = -t * 0.15;
    glass.receiveShadow = true;
    g.add(glass);
    const mu = o.muntins;
    if (mu && (mu.cols > 1 || mu.rows > 1)) {
      const mw = WIN.muntinW;
      for (let i = 1; i < (mu.cols || 1); i++) {
        const b2 = box(mw, gh, t * 0.7, m, { r: inch(0.04) });
        b2.position.set(-gw / 2 + (gw * i) / mu.cols, 0, 0);
        g.add(b2);
      }
      for (let j = 1; j < (mu.rows || 1); j++) {
        const b2 = box(gw, mw, t * 0.7, m, { r: inch(0.04) });
        b2.position.set(0, -gh / 2 + (gh * j) / mu.rows, 0);
        g.add(b2);
      }
    }
    g.userData.glassSize = [gw, gh];
    return g;
  }

  /**
   * A complete window unit: jamb with a real interior reveal, sash(es),
   * glass, exterior sill, interior stool + casing and optional plantation
   * shutters as real geometry.
   *
   * @anchor bottom centre of the finished OPENING (jamb inside faces), on the
   *         wall centreline z = 0.  +Z is the INTERIOR.
   * @param {object} spec {w, h, type:'casement'|'doubleHung'|'fixed'|
   *                       'threePanelCasement'|'oval'|'round'|'skylight'}
   * @param {object} [o] {frame, shutters, muntins, wall, casing, sill, glass}
   */
  function windowUnit(spec = {}, o = {}) {
    const type = spec.type || 'doubleHung';
    const w = spec.w === undefined ? 3 : spec.w;
    const h = spec.h === undefined ? 4 : spec.h;
    const wall = o.wall === undefined ? 0.55 : o.wall;
    const m = o.frame && o.frame.isMaterial ? o.frame : P.trimWhite;
    const glassM = o.glass || P.glass;
    const g = G('bottom centre of the finished opening, wall centreline z = 0',
      [w, h, wall]);
    const jt = inch(0.75);
    const zSash = -wall / 2 + inch(2.4);

    if (type === 'oval' || type === 'round') {
      const rx = w / 2, ry = type === 'round' ? w / 2 : h / 2;
      const jw = inch(0.6);            // drywall-return jamb liner
      const fw = inch(2.2);            // sash frame face width
      const cwid = inch(3.5);          // interior casing width
      // jamb liner through the wall
      const liner = ellipseRing(rx + jw, ry + jw, rx, ry, wall, m, { cast: false });
      liner.position.set(0, ry, -wall / 2);
      g.add(liner);
      // sash frame near the exterior face
      const sash = ellipseRing(rx + inch(0.1), ry + inch(0.1), rx - fw, ry - fw, inch(1.9), m);
      sash.position.set(0, ry, -wall / 2 + inch(0.6));
      g.add(sash);
      // glass
      const disc = ellipseRing(rx - fw + inch(0.25), ry - fw + inch(0.25), 0, 0, 0, glassM,
        { cast: false });
      disc.position.set(0, ry, -wall / 2 + inch(1.4));
      g.add(disc);
      // flat mitre-free casing ring on the interior
      const face = ellipseRing(rx + jw + cwid, ry + jw + cwid, rx + jw, ry + jw,
        TRIM.caseT, m);
      face.position.set(0, ry, wall / 2 - inch(0.02));
      g.add(face);
      g.userData.size = [2 * (rx + jw + cwid), 2 * (ry + jw + cwid), wall];
      return g;
    }

    if (type === 'skylight') {
      // built in the XY plane; the caller lays it into the roof/ceiling plane
      const curb = box(w + inch(7), h + inch(7), inch(9), m, { r: inch(0.6), seg: 2 });
      curb.position.set(0, h / 2, -inch(4.5));
      g.add(curb);
      const fr = sashFrame(w + inch(4), h + inch(4),
        { material: P.blackMetal, stile: inch(2.0), thickness: inch(2.2), glass: glassM });
      fr.position.set(0, h / 2, inch(1.2));
      g.add(fr);
      return g;
    }

    // ---- rectangular unit ------------------------------------------------
    for (const s of [-1, 1]) {
      const leg = box(jt, h + 2 * jt, wall, m, { r: R_PAINT, uv: true });
      leg.position.set(s * (w / 2 + jt / 2), h / 2, 0);
      g.add(leg);
      const hz = box(w, jt, wall, m, { r: R_PAINT, uv: true });
      hz.position.set(0, s < 0 ? -jt / 2 : h + jt / 2, 0);
      g.add(hz);
    }
    // exterior sloped sill
    const sill = box(w + 2 * jt + inch(1.5), inch(1.2), inch(4.0), m, { r: inch(0.1) });
    sill.rotation.x = deg(-9);
    sill.position.set(0, -inch(0.2), -wall / 2 - inch(0.9));
    g.add(sill);

    const mu = o.muntins && o.muntins !== true ? o.muntins : null;
    if (type === 'doubleHung') {
      const sh = h / 2 + inch(1.6);
      const lower = sashFrame(w, sh, { material: m, rail: inch(2.4), glass: glassM, muntins: mu });
      lower.position.set(0, sh / 2, zSash + inch(0.9));
      g.add(lower);
      const upper = sashFrame(w, sh, { material: m, rail: inch(2.4), glass: glassM, muntins: mu });
      upper.position.set(0, h - sh / 2, zSash - inch(0.9));
      g.add(upper);
      const lock = box(inch(3.0), inch(0.6), inch(0.7), P.blackMetal, { r: inch(0.12) });
      lock.position.set(0, h / 2 + inch(0.6), zSash + inch(1.8));
      g.add(lock);
    } else if (type === 'threePanelCasement') {
      const fracs = o.fracs || [0.28, 0.44, 0.28];
      let x = -w / 2;
      for (let i = 0; i < 3; i++) {
        const ww = w * fracs[i];
        const s = sashFrame(ww - inch(0.25), h - inch(0.25),
          { material: m, stile: inch(1.75), glass: glassM, muntins: mu });
        s.position.set(x + ww / 2, h / 2, zSash);
        g.add(s);
        x += ww;
        if (i < 2) {
          const mull = box(inch(1.5), h, inch(2.2), m, { r: R_PAINT, uv: true });
          mull.position.set(x, h / 2, zSash);
          g.add(mull);
        }
      }
      for (const s of [-1, 1]) {
        const crank = box(inch(2.4), inch(0.9), inch(1.1), P.blackMetal, { r: inch(0.2) });
        crank.position.set(s * (w * 0.5 - w * fracs[0] * 0.5), inch(4), zSash + inch(2.2));
        g.add(crank);
      }
    } else if (type === 'casement') {
      const n = spec.lites || 1;
      const ww = w / n;
      for (let i = 0; i < n; i++) {
        const s = sashFrame(ww - inch(0.25), h - inch(0.25),
          { material: m, stile: inch(1.85), glass: glassM, muntins: mu });
        s.position.set(-w / 2 + ww * (i + 0.5), h / 2, zSash);
        g.add(s);
        if (i < n - 1) {
          const mull = box(inch(1.5), h, inch(2.2), m, { r: R_PAINT, uv: true });
          mull.position.set(-w / 2 + ww * (i + 1), h / 2, zSash);
          g.add(mull);
        }
      }
      const crank = box(inch(2.6), inch(0.9), inch(1.2), P.blackMetal, { r: inch(0.2) });
      crank.position.set(-w / 2 + inch(4), inch(4.5), zSash + inch(2.2));
      g.add(crank);
    } else { // fixed / picture
      const s = sashFrame(w, h, { material: m, stile: inch(1.6), glass: glassM, muntins: mu });
      s.position.set(0, h / 2, zSash);
      g.add(s);
    }

    if (o.shutters) {
      const so = typeof o.shutters === 'object' ? o.shutters : {};
      const sh = plantationShutters(w - inch(0.2), h - inch(0.2), Object.assign({
        divider: 0.5, tilt: deg(26), material: P.trimWhite,
      }, so));
      sh.position.set(0, inch(0.1), wall / 2 - inch(3.2));
      g.add(sh);
    }
    if (o.casing !== false) {
      const c = windowCasing({ w: w + 2 * jt, h: h + 2 * jt, material: m, picture: !!o.picture });
      c.position.set(0, -jt, wall / 2);
      g.add(c);
    }
    return g;
  }

  /**
   * White sliding glass door (patio).
   * @anchor bottom centre of the opening, wall centreline z = 0, interior +Z.
   */
  function slidingGlassDoor(o = {}) {
    const w = o.w === undefined ? ft(6, 0) : o.w;
    const h = o.h === undefined ? ft(6, 10) : o.h;
    const n = o.panels === undefined ? 2 : o.panels;
    const wall = o.wall === undefined ? 0.55 : o.wall;
    const m = o.material || P.trimWhite;
    const g = G('bottom centre of the opening, wall centreline z = 0', [w, h, wall]);
    const jt = inch(1.6);
    for (const s of [-1, 1]) {
      const leg = box(jt, h + jt, wall, m, { r: R_PAINT, uv: true });
      leg.position.set(s * (w / 2 + jt / 2), (h + jt) / 2, 0);
      g.add(leg);
    }
    const head = box(w + 2 * jt, jt, wall, m, { r: R_PAINT, uv: true });
    head.position.set(0, h + jt / 2, 0);
    g.add(head);
    const track = box(w + 2 * jt, inch(1.4), wall, m, { r: inch(0.1) });
    track.position.set(0, inch(0.7), 0);
    g.add(track);

    const pw = w / n;
    for (let i = 0; i < n; i++) {
      const z = (i % 2 === 0 ? -1 : 1) * inch(1.1);
      const s = sashFrame(pw, h - inch(1.4),
        { material: m, stile: inch(2.6), rail: inch(2.6), glass: P.glass });
      s.position.set(-w / 2 + pw * (i + 0.5), inch(1.4) + (h - inch(1.4)) / 2, z);
      g.add(s);
      if (i % 2 === 1) {
        const handle = box(inch(1.1), inch(11), inch(1.4), P.blackMetal, { r: inch(0.22), seg: 2 });
        handle.position.set(-w / 2 + pw * i + inch(3.0), ft(3, 2), z + inch(1.6));
        g.add(handle);
      }
    }
    return g;
  }

  /**
   * White divided-lite French door pair.
   * @anchor bottom centre of the opening, wall centreline z = 0, interior +Z.
   */
  function frenchDoor(o = {}) {
    const w = o.w === undefined ? ft(5, 0) : o.w;
    const h = o.h === undefined ? DOOR.entryH : o.h;
    const wall = o.wall === undefined ? 0.55 : o.wall;
    const m = o.material || P.trimWhite;
    const lites = o.lites || { cols: 2, rows: 4 };
    const g = G('bottom centre of the opening, wall centreline z = 0', [w, h, wall]);
    const jt = inch(0.9);
    for (const s of [-1, 1]) {
      const leg = box(jt, h + jt, wall, m, { r: R_PAINT, uv: true });
      leg.position.set(s * (w / 2 + jt / 2), (h + jt) / 2, 0);
      g.add(leg);
    }
    const head = box(w + 2 * jt, jt, wall, m, { r: R_PAINT, uv: true });
    head.position.set(0, h + jt / 2, 0);
    g.add(head);
    const lw = w / 2 - REVEAL;
    const open = o.open || 0;
    for (const s of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(s * (w / 2 - REVEAL), 0, 0);
      pivot.rotation.y = -s * open;
      g.add(pivot);
      const leaf = sashFrame(lw, h - inch(0.5), {
        material: m, stile: inch(4.6), rail: inch(4.6), glass: P.glass,
        thickness: DOOR.leafT, muntins: lites,
      });
      leaf.position.set(-s * lw / 2, (h - inch(0.5)) / 2 + inch(0.25), 0);
      pivot.add(leaf);
      const brail = box(lw, inch(9), DOOR.leafT, m, { r: R_PAINT, uv: true });
      brail.position.set(-s * lw / 2, inch(5), 0);
      pivot.add(brail);
      const lev = leverSet({ leafT: DOOR.leafT });
      lev.position.set(-s * (lw - inch(3.0)), ft(3, 0), 0);
      pivot.add(lev);
    }
    if (o.casing !== false) {
      for (const s of [1, -1]) {
        const c = doorCasing({ w: w + 2 * jt, h: h + jt, material: m });
        c.position.z = s * wall / 2;
        if (s < 0) c.rotation.y = Math.PI;
        g.add(c);
      }
    }
    return g;
  }

  /**
   * Sectional garage door with raised panels.
   * @anchor bottom centre of the opening, door face at z = 0, exterior +Z.
   */
  function garageDoor(o = {}) {
    const w = o.w === undefined ? DOOR.garageW : o.w;
    const h = o.h === undefined ? DOOR.garageH : o.h;
    const m = o.material || P.trimWhite;
    const rows = o.rows === undefined ? 4 : o.rows;
    const cols = o.cols === undefined ? Math.max(2, Math.round(w / 3.2)) : o.cols;
    const g = G('bottom centre of the opening, door face at z = 0', [w, h, inch(2.2)]);
    const sh = h / rows;
    const t = inch(2.0);
    for (let r = 0; r < rows; r++) {
      const sec = box(w, sh - inch(0.18), t, m, { r: inch(0.1), seg: 2, uv: true });
      sec.position.set(0, sh * (r + 0.5), t / 2);
      g.add(sec);
      const pw = (w - inch(6)) / cols;
      for (let c = 0; c < cols; c++) {
        const px = -w / 2 + inch(3) + pw * (c + 0.5);
        // raised panel: the field stands PROUD of the section, so the bevel
        // reads at any camera angle instead of vanishing head-on
        const rz = inch(0.62);
        g.add(stickingRing(px - pw / 2 + inch(1.6), sh * r + inch(3.2),
          px + pw / 2 - inch(1.6), sh * (r + 1) - inch(3.2),
          t, t + rz, inch(1.05), m));
        const field = box(pw - inch(5.3), sh - inch(8.7), inch(0.30), m,
          { r: inch(0.08), uv: true });
        field.position.set(px, sh * (r + 0.5), t + rz + inch(0.12));
        g.add(field);
      }
    }
    return g;
  }

  /**
   * Floor-to-ceiling window wall (rear elevation): white mullion grid + glass.
   * @anchor bottom centre of the wall opening, wall centreline z = 0, interior +Z.
   */
  function windowWall(o = {}) {
    const w = o.w === undefined ? 14 : o.w;
    const h = o.h === undefined ? 8.5 : o.h;
    const wall = o.wall === undefined ? 0.55 : o.wall;
    const m = o.material || P.trimWhite;
    const cols = o.mullions === undefined ? 4 : (o.mullions.cols || o.mullions);
    const rows = (o.mullions && o.mullions.rows) || 1;
    const g = G('bottom centre of the opening, wall centreline z = 0', [w, h, wall]);
    const mw = inch(2.6), t = inch(3.0);
    const z = -wall / 2 + inch(2.6);
    // perimeter
    for (const s of [-1, 1]) {
      const v = box(mw, h, t, m, { r: R_PAINT, uv: true });
      v.position.set(s * (w / 2 - mw / 2), h / 2, z);
      g.add(v);
      const hz = box(w, mw, t, m, { r: R_PAINT, uv: true });
      hz.position.set(0, s < 0 ? mw / 2 : h - mw / 2, z);
      g.add(hz);
    }
    for (let i = 1; i < cols; i++) {
      const v = box(mw, h, t, m, { r: R_PAINT, uv: true });
      v.position.set(-w / 2 + (w * i) / cols, h / 2, z);
      g.add(v);
    }
    for (let j = 1; j < rows; j++) {
      const hz = box(w, mw, t, m, { r: R_PAINT, uv: true });
      hz.position.set(0, (h * j) / rows, z);
      g.add(hz);
    }
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(w - 2 * mw, h - 2 * mw), P.glass);
    glass.position.set(0, h / 2, z - inch(0.4));
    g.add(glass);
    // interior drywall return + stool
    return g;
  }

  /* ---------------------------------------------------------------- */
  /* 2.10  casework                                                     */
  /* ---------------------------------------------------------------- */

  /** Tapered (frustum) box — hoods, chimneys, lamp shades. @anchor bottom centre. */
  function taperBox(wB, dB, wT, dT, h, material, o = {}) {
    const b = new Builder();
    const B = [[-wB / 2, 0, dB / 2], [wB / 2, 0, dB / 2], [wB / 2, 0, -dB / 2], [-wB / 2, 0, -dB / 2]];
    const T = [[-wT / 2, h, dT / 2], [wT / 2, h, dT / 2], [wT / 2, h, -dT / 2], [-wT / 2, h, -dT / 2]];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      const n = v3norm(v3cross(v3sub(B[j], B[i]), v3sub(T[i], B[i])));
      const out = [B[i][0] + B[j][0], 0, B[i][2] + B[j][2]];
      if (v3dot(n, out) < 0) { n[0] = -n[0]; n[1] = -n[1]; n[2] = -n[2]; }
      b.quad(B[i], B[j], T[j], T[i], n, [[0, 0], [1, 0], [1, 1], [0, 1]]);
    }
    b.quad(T[0], T[1], T[2], T[3], [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
    if (o.bottom !== false) {
      b.quad(B[3], B[2], B[1], B[0], [0, -1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
    }
    const m = new THREE.Mesh(b.geometry(THREE), material);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }

  /** Lay out N fronts in a run of length L with 1/8" reveals. */
  function frontRun(L, n, reveal = REVEAL) {
    const each = (L - reveal * (n + 1)) / n;
    const out = [];
    for (let i = 0; i < n; i++) out.push([-L / 2 + reveal * (i + 1) + each * i + each / 2, each]);
    return out;
  }

  /** One door or drawer face + its pull. */
  function faceWithPull(w, h, o = {}) {
    const g = o.style === 'slab'
      ? slabDoorPanel(w, h, { material: o.material })
      : shakerDoorPanel(w, h, { material: o.material, stileWidth: o.stileWidth });
    if (o.pulls && o.pulls !== 'none') {
      const isDrawer = !!o.drawer;
      const len = isDrawer ? Math.min(w * 0.42, inch(7)) : inch(5);
      const p = pull(o.pulls, len);
      if (isDrawer) p.position.set(0, 0, inch(0.75));
      else {
        p.rotation.z = HALFPI;
        // door pulls sit near the opening stile: at the TOP of a base-cabinet
        // door, at the BOTTOM of a wall-cabinet door
        const yy = o.pullAt === 'bottom' ? -(h / 2 - inch(4.0)) : h / 2 - inch(4.0);
        p.position.set((o.hinge === 'right' ? -1 : 1) * (w / 2 - inch(1.6)), yy, inch(0.75));
      }
      g.add(p);
    }
    return g;
  }

  /**
   * Base cabinet: toe kick, carcass, full-overlay fronts with 1/8" reveals.
   * @anchor bottom centre of the cabinet BACK — sits on the floor with its
   *         back on the wall plane z = 0, growing toward +Z.
   * @param {object} [o] {w, d, h, style:'slab'|'shaker', doors, drawers,
   *                      pulls:'brassBar'|'blackBar'|'knob'|'none', toeKick,
   *                      material, filler}
   */
  function baseCabinet(o = {}) {
    const w = o.w === undefined ? 3 : o.w;
    const d = o.d === undefined ? CAB.baseD : o.d;
    const h = o.h === undefined ? CAB.baseH : o.h;
    const style = o.style || 'shaker';
    const m = o.material || P.wood;
    const pulls = o.pulls === undefined ? 'brassBar' : o.pulls;
    const toe = o.toeKick === false ? 0 : CAB.toeH;
    const doors = o.doors === undefined ? (o.drawers ? 0 : 2) : o.doors;
    const drawers = o.drawers === undefined ? 0 : o.drawers;
    const g = G('bottom centre of the cabinet back, on the floor', [w, h, d]);
    const doorT = inch(0.75);
    const cd = d - doorT;

    if (toe > 0) {
      const tk = boxAt(-w / 2, 0, 0, w, toe, cd - CAB.toeD, P.black, { r: inch(0.03) });
      g.add(tk);
    }
    const carc = boxAt(-w / 2, toe, 0, w, h - toe, cd, m, { r: R_EASE, uv: true });
    g.add(carc);

    const faceH = h - toe;
    const y0 = toe;
    if (drawers > 0 && doors === 0) {
      const rows = frontRun(faceH, drawers);
      for (const [cy, ch] of rows) {
        const f = faceWithPull(w - 2 * REVEAL, ch, { style, material: m, pulls, drawer: true });
        f.position.set(0, y0 + faceH / 2 + cy, cd);
        g.add(f);
      }
    } else {
      const topDrawerH = drawers > 0 ? Math.min(inch(7), faceH * 0.24) : 0;
      if (topDrawerH > 0) {
        const cols = doors >= 2 ? frontRun(w, doors) : [[0, w - 2 * REVEAL]];
        for (const [cx, cw] of cols) {
          const f = faceWithPull(cw, topDrawerH - 2 * REVEAL, {
            style, material: m, pulls, drawer: true,
          });
          f.position.set(cx, y0 + faceH - topDrawerH / 2, cd);
          g.add(f);
        }
      }
      const dh = faceH - topDrawerH;
      const cols = frontRun(w, Math.max(1, doors));
      for (let i = 0; i < cols.length; i++) {
        const [cx, cw] = cols[i];
        const f = faceWithPull(cw, dh - 2 * REVEAL, {
          style, material: m, pulls,
          hinge: cols.length === 1 ? 'left' : (i === 0 ? 'left' : 'right'),
        });
        f.position.set(cx, y0 + dh / 2, cd);
        g.add(f);
      }
    }
    g.userData.counterY = h;
    return g;
  }

  /**
   * Wall (upper) cabinet.
   * @anchor bottom centre of the cabinet BACK — set y to the cabinet's bottom.
   * @param {object} [o] {w, d, h, style, doors, pulls, material, glass, crown}
   */
  function wallCabinet(o = {}) {
    const w = o.w === undefined ? 3 : o.w;
    const d = o.d === undefined ? CAB.upperD : o.d;
    const h = o.h === undefined ? CAB.upperH : o.h;
    const m = o.material || P.cabWhite;
    const style = o.style || 'shaker';
    const pulls = o.pulls === undefined ? 'brassBar' : o.pulls;
    const doors = o.doors === undefined ? 2 : o.doors;
    const g = G('bottom centre of the cabinet back', [w, h, d]);
    const doorT = inch(0.75);
    const cd = d - doorT;
    const carc = boxAt(-w / 2, 0, 0, w, h, cd, m, { r: R_EASE, uv: true });
    g.add(carc);
    const cols = frontRun(w, Math.max(1, doors));
    for (let i = 0; i < cols.length; i++) {
      const [cx, cw] = cols[i];
      const f = faceWithPull(cw, h - 2 * REVEAL, {
        style, material: m, pulls, pullAt: 'bottom',
        hinge: cols.length === 1 ? 'left' : (i === 0 ? 'left' : 'right'),
      });
      f.position.set(cx, h / 2, cd);
      g.add(f);
    }
    if (o.crown) {
      // returns down both ends and runs across the face, mitered at the corners
      const cm = crownMolding([[-w / 2, 0], [-w / 2, d], [w / 2, d], [w / 2, 0]], {
        profile: 'cove', height: inch(2.6), projection: inch(2.2), material: m, flip: true,
      });
      cm.position.y = h;
      g.add(cm);
    }
    if (o.lightRail) {
      const lr = boxAt(-w / 2, -inch(1.1), 0, w, inch(1.1), cd + inch(0.3), m, { r: inch(0.06) });
      g.add(lr);
    }
    return g;
  }

  /**
   * Tall cabinet / pantry — a full-height run of doors with an optional
   * drawer bank at the bottom.
   * @anchor bottom centre of the cabinet BACK, on the floor.
   */
  function tallCabinet(o = {}) {
    const w = o.w === undefined ? 3 : o.w;
    const d = o.d === undefined ? ft(2, 0) : o.d;
    const h = o.h === undefined ? ft(7, 6) : o.h;
    const m = o.material || P.cabWhite;
    const style = o.style || 'shaker';
    const pulls = o.pulls === undefined ? 'brassBar' : o.pulls;
    const doors = o.doors === undefined ? 2 : o.doors;
    const toe = CAB.toeH;
    const g = G('bottom centre of the cabinet back, on the floor', [w, h, d]);
    const doorT = inch(0.75);
    const cd = d - doorT;
    g.add(boxAt(-w / 2, 0, 0, w, toe, cd - CAB.toeD, P.black, { r: inch(0.03) }));
    g.add(boxAt(-w / 2, toe, 0, w, h - toe, cd, m, { r: R_EASE, uv: true }));
    // split: lower doors to 7'0"-ish, upper doors above
    const splitY = o.split === undefined ? Math.min(h - inch(2), toe + ft(4, 4)) : o.split;
    const bands = splitY < h - inch(10) ? [[toe, splitY], [splitY, h]] : [[toe, h]];
    for (const [ya, yb] of bands) {
      const cols = frontRun(w, doors);
      for (let i = 0; i < cols.length; i++) {
        const [cx, cw] = cols[i];
        const f = faceWithPull(cw, (yb - ya) - 2 * REVEAL, {
          style, material: m, pulls, hinge: i === 0 ? 'left' : 'right',
        });
        f.position.set(cx, (ya + yb) / 2, cd);
        g.add(f);
      }
    }
    return g;
  }

  /**
   * Kitchen island: panelled base, counter with an eased edge and an
   * overhang for stools.
   * @anchor bottom CENTRE of the island in plan (X and Z), on the floor.
   * @param {object} [o] {w, d, h, overhang, panels, material, counter,
   *                      seatingSide:'+z'|'-z', doors}
   */
  function kitchenIsland(o = {}) {
    const w = o.w === undefined ? ft(6, 0) : o.w;
    const d = o.d === undefined ? ft(3, 6) : o.d;
    const h = o.h === undefined ? CAB.baseH : o.h;
    const over = o.overhang === undefined ? CAB.islandOverhang : o.overhang;
    const m = o.material || P.wood;
    const g = G('bottom centre of the island in plan, on the floor',
      [w + 2 * over, h + CAB.counterT, d]);
    const toe = CAB.toeH;
    g.add(box(w - inch(6), toe, d - inch(6), P.black, { r: inch(0.03), at: [0, toe / 2, 0] }));
    const body = box(w, h - toe, d, m, { r: R_EASE, uv: true });
    body.position.y = toe + (h - toe) / 2;
    g.add(body);

    // applied panels on all four faces
    // applied recessed panels on all four faces: a real perforated skin plus a
    // bevelled sticking, so each panel casts its own shadow line
    const np = o.panels === undefined ? Math.max(2, Math.round(w / 2.2)) : o.panels;
    const stile = inch(3.2);
    const skinT = inch(0.62);
    const faceH = h - toe;
    const addFace = (len, count, rotY, off) => {
      const cols = frontRun(len, count, inch(0.04));
      const rects = cols.map(([cx, cw]) => [
        cx - cw / 2 + stile, -faceH / 2 + stile, cx + cw / 2 - stile, faceH / 2 - stile,
      ]);
      const holder = new THREE.Group();
      holder.rotation.y = rotY;
      const sn = Math.sin(rotY), cs2 = Math.cos(rotY);
      holder.position.set(off * sn, toe + faceH / 2, off * cs2);
      const skin = plateWithHoles(len, faceH, rects, skinT, m, { bevel: inch(0.06) });
      holder.add(skin);
      for (const [xa, ya, xb, yb] of rects) {
        holder.add(stickingRing(xa, ya, xb, yb, skinT, inch(0.02), inch(0.62), m));
      }
      g.add(holder);
    };
    addFace(w, np, 0, d / 2);
    addFace(w, np, Math.PI, d / 2);
    addFace(d, Math.max(1, Math.round(d / 2.2)), HALFPI, w / 2);
    addFace(d, Math.max(1, Math.round(d / 2.2)), -HALFPI, w / 2);

    if (o.counter !== false) {
      const side = o.seatingSide === '-z' ? -1 : 1;
      const lip = inch(0.75);
      const cd = d + over + lip;
      // the deep overhang lands on the seating side, a 3/4" lip on the other
      const backZ = side > 0 ? -(d / 2 + lip) : -(d / 2 + over);
      const top = counterTop({
        w: w + 2 * lip, d: cd, material: o.counterMaterial || P.quartz,
        edge: o.edge || 'eased',
      });
      top.position.set(0, h, backZ);
      g.add(top);
      g.userData.counterY = h + CAB.counterT;
      g.userData.overhangSide = side;
    }
    return g;
  }

  /**
   * Bathroom vanity.
   * @anchor bottom centre of the vanity BACK, on the floor.
   * @param {object} [o] {w, d, h, style, drawers, doors, material, counter,
   *                      counterMaterial, legs}
   */
  function vanity(o = {}) {
    const w = o.w === undefined ? ft(4, 0) : o.w;
    const d = o.d === undefined ? ft(1, 9) : o.d;
    const h = o.h === undefined ? CAB.vanityH : o.h;
    const m = o.material || P.woodDark;
    const g = G('bottom centre of the vanity back, on the floor', [w, h, d]);
    const cab = baseCabinet({
      w, d, h, style: o.style || 'shaker', material: m,
      doors: o.doors === undefined ? 2 : o.doors,
      drawers: o.drawers === undefined ? 1 : o.drawers,
      pulls: o.pulls === undefined ? 'brassBar' : o.pulls,
      toeKick: o.toeKick !== false,
    });
    g.add(cab);
    if (o.counter !== false) {
      const top = counterTop({
        w: w + inch(1), d: d + inch(1), material: o.counterMaterial || P.quartz,
        edge: 'eased', backsplash: o.backsplash === undefined ? inch(4) : o.backsplash,
      });
      top.position.set(0, h, 0);
      g.add(top);
    }
    return g;
  }

  /**
   * Floating open shelf with concealed steel supports.
   * @anchor bottom centre of the shelf BACK (against the wall, z = 0).
   */
  function openShelf(o = {}) {
    const w = o.w === undefined ? 3 : o.w;
    const d = o.d === undefined ? inch(10) : o.d;
    const t = o.thickness === undefined ? inch(2.0) : o.thickness;
    const m = o.material || P.whiteOak;
    const g = G('bottom centre of the shelf back, against the wall', [w, t, d]);
    const s = boxAt(-w / 2, 0, 0, w, t, d, m, { r: inch(0.09), seg: 2, uv: true });
    g.add(s);
    if (o.brackets) {
      for (const sx of [-1, 1]) {
        const br = box(inch(0.6), inch(5.5), d - inch(1.5), P.blackMetal, { r: inch(0.05) });
        br.position.set(sx * (w / 2 - inch(4)), -inch(2.8), (d - inch(1.5)) / 2);
        g.add(br);
      }
    }
    return g;
  }

  /**
   * Painted off-white range hood surround: shaped apron, tapered shroud and
   * a chimney to the ceiling — the shape in `kitchen_view_1.png`.
   * @anchor bottom centre of the hood's BACK, at the bottom of the apron.
   */
  function rangeHoodSurround(o = {}) {
    const w = o.w === undefined ? ft(3, 6) : o.w;
    const d = o.d === undefined ? ft(1, 10) : o.d;
    const h = o.h === undefined ? ft(3, 0) : o.h;
    const m = o.material || P.cabWhite;
    const g = G('bottom centre of the hood back, bottom of the apron', [w, h, d]);
    const apron = inch(7.0);
    const chimW = w * 0.42, chimD = d * 0.5;

    // apron band with a stepped bottom edge and a small crown
    const band = boxAt(-w / 2, 0, 0, w, apron, d, m, { r: R_PAINT, uv: true });
    g.add(band);
    const lip = boxAt(-w / 2 - inch(0.6), -inch(1.1), -inch(0.3), w + inch(1.2), inch(1.4),
      d + inch(0.9), m, { r: inch(0.1) });
    g.add(lip);
    const shelf = boxAt(-w / 2 - inch(1.1), apron - inch(1.6), -inch(0.5),
      w + inch(2.2), inch(1.6), d + inch(1.4), m, { r: inch(0.1) });
    g.add(shelf);
    // corbel-like ends
    for (const s of [-1, 1]) {
      const cor = box(inch(1.4), apron - inch(1.0), d * 0.72, m, { r: inch(0.1) });
      cor.position.set(s * (w / 2 - inch(0.7)), apron / 2 - inch(0.5), d * 0.36 + inch(0.2));
      g.add(cor);
    }
    // tapered shroud
    const taperH = Math.max(inch(6), (h - apron) * 0.45);
    const tb = taperBox(w - inch(1.0), d - inch(0.6), chimW, chimD, taperH, m, { bottom: false });
    tb.position.set(0, apron, d / 2 - inch(0.2));
    g.add(tb);
    // chimney
    const chim = boxAt(-chimW / 2, apron + taperH - inch(0.2), d / 2 - chimD / 2 - inch(0.2),
      chimW, Math.max(inch(2), h - apron - taperH + inch(0.2)), chimD, m, { r: R_PAINT, uv: true });
    g.add(chim);
    // stainless insert liner + a hint of the baffle filters
    const liner = boxAt(-w / 2 + inch(3.5), -inch(0.2), inch(1.5), w - inch(7), inch(1.4),
      d - inch(4.5), P.steel, { r: inch(0.06) });
    g.add(liner);
    const baff = boxAt(-w / 2 + inch(4.5), -inch(0.05), inch(2.5), w - inch(9), inch(0.5),
      d - inch(6.5), P.appliancePanel, { r: inch(0.03) });
    g.add(baff);
    return g;
  }

  /**
   * Counter top with a real eased or mitered edge.
   * @anchor bottom centre of the counter's BACK edge — put it at the cabinet
   *         top (y = cabinet height, z = wall plane).
   * @param {object} [o] {w, d, thickness, edge:'eased'|'mitered'|'bullnose',
   *                      material, backsplash (height), overhangFront}
   */
  function counterTop(o = {}) {
    const w = o.w === undefined ? 4 : o.w;
    const d = o.d === undefined ? CAB.baseD + inch(1) : o.d;
    const t = o.thickness === undefined ? CAB.counterT : o.thickness;
    const m = o.material || P.quartz;
    const edge = o.edge || 'eased';
    const g = G('bottom centre of the counter back edge', [w, t, d]);
    const r = edge === 'bullnose' ? t * 0.45 : edge === 'mitered' ? inch(0.06) : inch(0.09);
    const slab = boxAt(-w / 2, 0, 0, w, t, d, m, { r, seg: edge === 'bullnose' ? 4 : 2, uv: true });
    g.add(slab);
    if (edge === 'mitered') {
      const apr = o.apron === undefined ? inch(3.0) : o.apron;
      const a = boxAt(-w / 2, -apr, d - t, w, apr, t, m, { r: inch(0.06), seg: 2, uv: true });
      g.add(a);
      for (const s of [-1, 1]) {
        const side = boxAt(s > 0 ? w / 2 - t : -w / 2, -apr, 0, t, apr, d, m,
          { r: inch(0.06), seg: 2, uv: true });
        g.add(side);
      }
    }
    if (o.backsplash) {
      const bs = boxAt(-w / 2, t, 0, w, o.backsplash, inch(0.6), m, { r: inch(0.06), uv: true });
      g.add(bs);
    }
    g.userData.topY = t;
    return g;
  }

  /**
   * Full-height quartz slab backsplash, counter to uppers, continuous veining.
   * @anchor bottom centre against the wall face (z = 0), growing +Z.
   */
  function fullHeightSlabBacksplash(o = {}) {
    const w = o.w === undefined ? 8 : o.w;
    const h = o.h === undefined ? CAB.counterToUpper : o.h;
    const t = o.thickness === undefined ? inch(0.55) : o.thickness;
    const m = o.material || P.slab;
    const g = G('bottom centre against the wall face', [w, h, t]);
    const s = boxAt(-w / 2, 0, 0, w, h, t, m, { r: inch(0.05), uv: true });
    g.add(s);
    return g;
  }

  /* ---------------------------------------------------------------- */
  /* 2.11  appliances                                                   */
  /* ---------------------------------------------------------------- */

  /** Tubular appliance handle. @anchor handle centre on the appliance face. */
  function applianceHandle(len, o = {}) {
    const m = o.material || P.steel;
    const g = G('handle centre on the appliance face');
    const r = o.r === undefined ? inch(0.55) : o.r;
    const stand = o.stand === undefined ? inch(2.2) : o.stand;
    const bar = cyl(r, r, len, m, 20);
    if (!o.vertical) bar.rotation.z = HALFPI;
    bar.position.z = stand;
    g.add(bar);
    for (const s of [-1, 1]) {
      const post = cyl(inch(0.42), inch(0.42), stand, m, 12);
      post.rotation.x = HALFPI;
      const off = len / 2 - inch(1.4);
      post.position.set(o.vertical ? 0 : s * off, o.vertical ? s * off : 0, stand / 2);
      g.add(post);
    }
    return g;
  }

  /** Round control knob with a pointer. @anchor knob base on the panel face. */
  function knob(o = {}) {
    const m = o.material || P.steel;
    const g = G('knob base on the panel');
    const body = cyl(inch(0.78), inch(0.95), inch(1.15), m, 24);
    body.rotation.x = HALFPI;
    body.position.z = inch(0.58);
    g.add(body);
    const mark = box(inch(0.12), inch(0.55), inch(0.1), P.appliancePanel, { r: inch(0.03) });
    mark.position.set(0, inch(0.42), inch(1.16));
    g.add(mark);
    return g;
  }

  /**
   * Slide-in gas range: continuous cast-iron grates, sealed burners, front
   * control knobs with a display, oven window and a warming drawer.
   * @anchor bottom centre of the range BACK, on the floor.
   */
  function slideInGasRange(o = {}) {
    const w = o.w === undefined ? ft(2, 6) : o.w;
    const d = o.d === undefined ? ft(2, 1) : o.d;
    const h = o.h === undefined ? CAB.baseH + CAB.counterT : o.h;
    const g = G('bottom centre of the range back, on the floor', [w, h, d]);
    const st = P.steel, dk = P.appliancePanel;
    const body = boxAt(-w / 2, inch(1.5), 0, w, h - inch(1.5) - inch(0.6), d - inch(1.0), st,
      { r: inch(0.08), seg: 2, uv: true });
    g.add(body);
    // levelling feet
    for (const sx of [-1, 1]) for (const sz of [0.18, 0.82]) {
      const f = cyl(inch(0.7), inch(0.7), inch(1.5), dk, 10);
      f.position.set(sx * (w / 2 - inch(2)), inch(0.75), d * sz);
      g.add(f);
    }
    // cooktop deck with a raised lip and a low back rail
    const deck = boxAt(-w / 2, h - inch(0.6), -inch(0.2), w, inch(0.6), d, st,
      { r: inch(0.1), seg: 2, uv: true });
    g.add(deck);
    const rail = boxAt(-w / 2, h, -inch(0.2), w, inch(1.5), inch(1.6), st, { r: inch(0.1) });
    g.add(rail);
    // 5 sealed burners
    const burners = [
      [-w * 0.28, d * 0.30, inch(2.1)], [w * 0.28, d * 0.30, inch(2.4)],
      [-w * 0.28, d * 0.70, inch(2.1)], [w * 0.28, d * 0.70, inch(1.9)],
      [0, d * 0.50, inch(2.7)],
    ];
    for (const [bx, bz, br] of burners) {
      const base = cyl(br, br * 0.9, inch(0.35), dk, 24);
      base.position.set(bx, h + inch(0.1), bz);
      g.add(base);
      const cap = cyl(br * 0.72, br * 0.78, inch(0.5), dk, 24);
      cap.position.set(bx, h + inch(0.42), bz);
      g.add(cap);
    }
    // two continuous cast-iron grates
    for (const s of [-1, 1]) {
      const gw = w / 2 - inch(1.2), gd = d - inch(3.0);
      const gr = new THREE.Group();
      gr.position.set(s * (w / 4 + inch(0.1)), h + inch(0.85), d / 2);
      for (const sx of [-1, 1]) {
        const bar = box(inch(0.55), inch(0.55), gd, dk, { r: inch(0.16), seg: 2 });
        bar.position.set(sx * (gw / 2 - inch(0.3)), 0, 0);
        gr.add(bar);
      }
      for (let i = 0; i < 4; i++) {
        const bar = box(gw, inch(0.55), inch(0.5), dk, { r: inch(0.16), seg: 2 });
        bar.position.set(0, 0, -gd / 2 + (gd * (i + 0.5)) / 4);
        gr.add(bar);
      }
      g.add(gr);
    }
    // control panel: brushed strip + display + 5 knobs
    const panY = h - inch(4.4);
    const pan = boxAt(-w / 2 + inch(0.4), panY, d - inch(1.0), w - inch(0.8), inch(3.6),
      inch(0.5), st, { r: inch(0.08), uv: true });
    g.add(pan);
    const disp = box(w * 0.30, inch(1.5), inch(0.14), dk, { r: inch(0.05) });
    disp.position.set(0, panY + inch(1.8), d - inch(0.42));
    g.add(disp);
    const dg = box(w * 0.24, inch(0.75), inch(0.1), local('rangeDisplay', null, {
      color: 0x0a1418, emissive: 0x2f6f7a, emissiveIntensity: 0.8, roughness: 0.2,
    }), { r: inch(0.03) });
    dg.position.set(0, panY + inch(1.8), d - inch(0.33));
    g.add(dg);
    for (let i = 0; i < 5; i++) {
      const k = knob();
      k.position.set(-w / 2 + inch(2.6) + ((w - inch(5.2)) * i) / 4, panY + inch(1.7), d - inch(0.5));
      g.add(k);
    }
    // oven door: stainless frame + smoked glass + handle
    const doorY0 = inch(9.5), doorH = panY - doorY0 - inch(0.6);
    const dr = boxAt(-w / 2 + inch(0.4), doorY0, d - inch(1.0), w - inch(0.8), doorH, inch(1.5),
      st, { r: inch(0.08), seg: 2, uv: true });
    g.add(dr);
    const win = box(w - inch(6.5), doorH - inch(4.5), inch(0.35), P.applianceGlass, { r: inch(0.06) });
    win.position.set(0, doorY0 + doorH / 2, d + inch(0.62));
    g.add(win);
    const hd = applianceHandle(w - inch(2.0), { r: inch(0.62), stand: inch(2.6) });
    hd.position.set(0, doorY0 + doorH - inch(1.8), d + inch(0.5));
    g.add(hd);
    // warming drawer
    const wd = boxAt(-w / 2 + inch(0.4), inch(1.6), d - inch(1.0), w - inch(0.8), inch(7.2),
      inch(1.4), st, { r: inch(0.08), uv: true });
    g.add(wd);
    const wh = applianceHandle(w - inch(4.0), { r: inch(0.42), stand: inch(1.8) });
    wh.position.set(0, inch(5.4), d + inch(0.42));
    g.add(wh);
    return g;
  }

  /**
   * Stainless dishwasher with a recessed bar handle and a control strip.
   * @anchor bottom centre of the appliance BACK, on the floor.
   */
  function dishwasher(o = {}) {
    const w = o.w === undefined ? ft(2, 0) : o.w;
    const d = o.d === undefined ? CAB.baseD : o.d;
    const h = o.h === undefined ? CAB.baseH : o.h;
    const g = G('bottom centre of the appliance back, on the floor', [w, h, d]);
    const st = P.steel;
    g.add(boxAt(-w / 2, 0, 0, w, CAB.toeH, d - CAB.toeD, P.appliancePanel, { r: inch(0.04) }));
    g.add(boxAt(-w / 2, CAB.toeH, 0, w, h - CAB.toeH, d - inch(0.8), st,
      { r: inch(0.07), seg: 2, uv: true }));
    const doorH = h - CAB.toeH - inch(2.6);
    const door = boxAt(-w / 2 + REVEAL, CAB.toeH + REVEAL, d - inch(0.9),
      w - 2 * REVEAL, doorH, inch(0.9), st, { r: inch(0.08), seg: 2, uv: true });
    g.add(door);
    // recessed pocket handle across the top of the door
    const pocket = boxAt(-w / 2 + inch(0.6), h - inch(3.6), d - inch(1.9),
      w - inch(1.2), inch(1.7), inch(1.1), P.appliancePanel, { r: inch(0.12) });
    g.add(pocket);
    const bar = box(w - inch(2.0), inch(0.6), inch(0.6), st, { r: inch(0.25), seg: 2 });
    bar.position.set(0, h - inch(2.7), d - inch(0.55));
    g.add(bar);
    const strip = box(w - inch(3.0), inch(0.5), inch(0.1), P.appliancePanel, { r: inch(0.03) });
    strip.position.set(0, h - inch(4.6), d + inch(0.02));
    g.add(strip);
    return g;
  }

  /**
   * Built-in refrigerator: stainless doors, long tubular handles and the
   * fluted GRILLE panel above (as in `kitchen_view_1.png`).
   * @anchor bottom centre of the fridge BACK, on the floor.
   */
  function builtInFridge(o = {}) {
    const w = o.w === undefined ? ft(3, 6) : o.w;
    const d = o.d === undefined ? ft(2, 1) : o.d;
    const h = o.h === undefined ? ft(6, 10) : o.h;      // to the top of the doors
    const grille = o.grille === undefined ? ft(1, 0) : o.grille;
    const g = G('bottom centre of the fridge back, on the floor', [w, h + grille, d]);
    const st = P.steel;
    g.add(boxAt(-w / 2, 0, 0, w, h, d - inch(1.6), st, { r: inch(0.08), seg: 2, uv: true }));
    const drawerH = o.freezerDrawer === false ? 0 : ft(1, 10);
    const doorH = h - drawerH - (drawerH ? inch(0.25) : 0);
    // French doors over a freezer drawer
    for (const s of [-1, 1]) {
      const dw = w / 2 - inch(0.15);
      const door = boxAt(s < 0 ? -w / 2 : inch(0.15), h - doorH, d - inch(1.7),
        dw, doorH, inch(1.7), st, { r: inch(0.09), seg: 2, uv: true });
      g.add(door);
      const hd = applianceHandle(doorH - inch(14), { vertical: true, r: inch(0.62), stand: inch(2.4) });
      hd.position.set(s * inch(2.6), h - doorH / 2, d + inch(0.1));
      g.add(hd);
    }
    if (drawerH) {
      g.add(boxAt(-w / 2, 0, d - inch(1.7), w, drawerH - inch(0.15), inch(1.7), st,
        { r: inch(0.09), seg: 2, uv: true }));
      const hd = applianceHandle(w - inch(8), { r: inch(0.62), stand: inch(2.4) });
      hd.position.set(0, drawerH - inch(4.5), d + inch(0.1));
      g.add(hd);
    }
    // fluted stainless grille above
    if (grille > 0) {
      const back = boxAt(-w / 2, h + inch(0.4), d - inch(2.2), w, grille - inch(0.4), inch(1.2),
        P.appliancePanel, { r: inch(0.05) });
      g.add(back);
      const n = Math.max(6, Math.round(grille / inch(1.5)));
      const step = (grille - inch(1.6)) / n;
      for (let i = 0; i < n; i++) {
        const sl = box(w - inch(1.0), step * 0.62, inch(1.2), st, { r: inch(0.12), seg: 2 });
        sl.position.set(0, h + inch(0.9) + step * (i + 0.5), d - inch(1.4));
        sl.rotation.x = deg(-16);
        g.add(sl);
      }
      for (const s of [-1, 1]) {
        const side = boxAt(s < 0 ? -w / 2 - inch(0.5) : w / 2 - inch(0.5), h, d - inch(2.4),
          inch(1.0), grille, inch(2.0), st, { r: inch(0.06), uv: true });
        g.add(side);
      }
    }
    return g;
  }

  /**
   * Built-in / over-range microwave.
   * @anchor bottom centre of the unit BACK.
   */
  function microwave(o = {}) {
    const w = o.w === undefined ? ft(2, 6) : o.w;
    const d = o.d === undefined ? ft(1, 4) : o.d;
    const h = o.h === undefined ? ft(1, 5) : o.h;
    const g = G('bottom centre of the unit back', [w, h, d]);
    const st = P.steel;
    g.add(boxAt(-w / 2, 0, 0, w, h, d - inch(1.0), st, { r: inch(0.07), seg: 2, uv: true }));
    const dw = w * 0.72;
    g.add(boxAt(-w / 2, 0, d - inch(1.1), dw, h, inch(1.1), st, { r: inch(0.08), seg: 2, uv: true }));
    const win = box(dw - inch(3.2), h - inch(3.2), inch(0.3), P.applianceGlass, { r: inch(0.06) });
    win.position.set(-w / 2 + dw / 2, h / 2, d + inch(0.05));
    g.add(win);
    const hd = applianceHandle(h - inch(6), { vertical: true, r: inch(0.42), stand: inch(1.8) });
    hd.position.set(-w / 2 + dw - inch(1.6), h / 2, d - inch(0.05));
    g.add(hd);
    const pan = boxAt(-w / 2 + dw + inch(0.2), inch(0.4), d - inch(1.1), w - dw - inch(0.6),
      h - inch(0.8), inch(1.1), P.appliancePanel, { r: inch(0.06) });
    g.add(pan);
    return g;
  }

  /**
   * Built-in wall oven (single or double).
   * @anchor bottom centre of the unit BACK.
   */
  function wallOven(o = {}) {
    const w = o.w === undefined ? ft(2, 6) : o.w;
    const d = o.d === undefined ? ft(2, 0) : o.d;
    const n = o.doors === undefined ? 1 : o.doors;
    const h = o.h === undefined ? (n === 2 ? ft(4, 3) : ft(2, 5)) : o.h;
    const g = G('bottom centre of the unit back', [w, h, d]);
    const st = P.steel;
    g.add(boxAt(-w / 2, 0, 0, w, h, d - inch(1.4), st, { r: inch(0.07), seg: 2, uv: true }));
    const each = h / n;
    for (let i = 0; i < n; i++) {
      const y0 = each * i + inch(0.2);
      const dh = each - inch(0.4);
      g.add(boxAt(-w / 2, y0, d - inch(1.5), w, dh, inch(1.5), st,
        { r: inch(0.08), seg: 2, uv: true }));
      const win = box(w - inch(5.5), dh - inch(6.5), inch(0.3), P.applianceGlass, { r: inch(0.06) });
      win.position.set(0, y0 + dh / 2 - inch(1.0), d + inch(0.05));
      g.add(win);
      const hd = applianceHandle(w - inch(2.4), { r: inch(0.6), stand: inch(2.4) });
      hd.position.set(0, y0 + dh - inch(2.4), d - inch(0.05));
      g.add(hd);
    }
    return g;
  }

  /**
   * Front-load LG-style washer or dryer with a big round glass door and a
   * sloped control console.
   * @anchor bottom centre of the machine BACK, on the floor.
   * @param {object} [o] {w, d, h, kind:'washer'|'dryer', pedestal, material}
   */
  function frontLoadMachine(o = {}) {
    const w = o.w === undefined ? ft(2, 3) : o.w;
    const d = o.d === undefined ? ft(2, 6) : o.d;
    const h = o.h === undefined ? ft(3, 3) : o.h;
    const kind = o.kind === 'dryer' ? 'dryer' : 'washer';
    const body = o.material || local('applianceWhite', null, {
      color: 0xf2f3f3, roughness: 0.16, metalness: 0.05,
      clearcoat: 0.85, clearcoatRoughness: 0.06, envMapIntensity: 1.1,
    });
    const g = G('bottom centre of the machine back, on the floor', [w, h, d]);
    const ped = o.pedestal ? inch(13) : 0;
    if (ped) {
      g.add(boxAt(-w / 2, 0, inch(0.5), w, ped, d - inch(1.0), body, { r: inch(0.1), seg: 2 }));
      const ph = applianceHandle(w - inch(6), { r: inch(0.4), stand: inch(1.2), material: P.steel });
      ph.position.set(0, ped / 2, d - inch(0.4));
      g.add(ph);
    }
    g.add(boxAt(-w / 2, ped, 0, w, h - inch(3.2), d - inch(1.2), body,
      { r: inch(0.16), seg: 3 }));
    // sloped console
    const con = boxAt(-w / 2, h - inch(3.6), d - inch(9), w, inch(3.6), inch(9), body,
      { r: inch(0.14), seg: 2 });
    con.rotation.x = deg(-9);
    g.add(con);
    const face = box(w - inch(2.5), inch(2.2), inch(0.2), P.appliancePanel, { r: inch(0.06) });
    face.position.set(0, h - inch(1.9), d - inch(1.1));
    face.rotation.x = deg(-9);
    g.add(face);
    const dial = cyl(inch(1.5), inch(1.6), inch(0.7), P.appliancePanel, 26);
    dial.rotation.x = HALFPI + deg(-9);
    dial.position.set(-w / 2 + inch(3.6), h - inch(1.9), d - inch(0.9));
    g.add(dial);
    const led = box(w * 0.34, inch(0.85), inch(0.12), local('applianceLed', null, {
      color: 0x0b1216, emissive: 0x3a7f8c, emissiveIntensity: 1.1, roughness: 0.2,
    }), { r: inch(0.04) });
    led.position.set(inch(1.5), h - inch(1.9), d - inch(0.95));
    led.rotation.x = deg(-9);
    g.add(led);
    // round door: chrome bezel, tinted glass, hinge on the left
    const dr = Math.min(w, h - ped) * 0.36;
    const bez = torus(dr, inch(1.05), P.steel, 48, 12);
    bez.position.set(0, ped + (h - ped) * 0.46, d - inch(1.0));
    g.add(bez);
    const rim = cyl(dr + inch(1.0), dr + inch(1.0), inch(1.3), body, 48);
    rim.rotation.x = HALFPI;
    rim.position.set(0, ped + (h - ped) * 0.46, d - inch(1.9));
    g.add(rim);
    // the drum you can actually see through the glass
    const drum = cyl(dr - inch(0.4), dr - inch(0.4), inch(9), local('washDrum', null, {
      color: 0x2b2f33, roughness: 0.35, metalness: 0.6, envMapIntensity: 0.7,
    }), 40);
    drum.rotation.x = HALFPI;
    drum.position.set(0, ped + (h - ped) * 0.46, d - inch(6.2));
    g.add(drum);
    const gl = new THREE.Mesh(new THREE.SphereGeometry(dr, 40, 24, 0, TAU, 0, Math.PI * 0.36),
      kind === 'washer' ? P.applianceGlass : P.glass);
    gl.rotation.x = -HALFPI;
    gl.position.set(0, ped + (h - ped) * 0.46, d - inch(1.2));
    g.add(gl);
    const latch = box(inch(0.9), inch(2.2), inch(0.8), P.steel, { r: inch(0.2), seg: 2 });
    latch.position.set(dr + inch(1.3), ped + (h - ped) * 0.46, d - inch(0.9));
    g.add(latch);
    return g;
  }

  /** @anchor bottom centre back. Front-load washer. */
  function washer(o = {}) { return frontLoadMachine(Object.assign({}, o, { kind: 'washer' })); }
  /** @anchor bottom centre back. Front-load dryer. */
  function dryer(o = {}) { return frontLoadMachine(Object.assign({}, o, { kind: 'dryer' })); }

  /**
   * Laundry / utility sink: deep basin on a steel frame with a faucet.
   * @anchor bottom centre of the sink BACK, on the floor.
   */
  function utilitySink(o = {}) {
    const w = o.w === undefined ? ft(2, 0) : o.w;
    const d = o.d === undefined ? ft(1, 10) : o.d;
    const h = o.h === undefined ? ft(2, 10) : o.h;
    const g = G('bottom centre of the sink back, on the floor', [w, h, d]);
    const m = o.material || P.china;
    const bowl = basin(w, d, inch(13), m, { wall: inch(1.1), r: inch(0.7) });
    bowl.position.set(0, h, d / 2);
    g.add(bowl);
    for (const sx of [-1, 1]) for (const sz of [0.2, 0.8]) {
      const leg = box(inch(1.4), h - inch(14), inch(1.4), P.blackMetal, { r: inch(0.1) });
      leg.position.set(sx * (w / 2 - inch(1.6)), (h - inch(14)) / 2, d * sz);
      g.add(leg);
    }
    const f = faucet({ style: 'gooseneck', finish: 'chrome', height: inch(13) });
    f.position.set(0, h, inch(2.2));
    g.add(f);
    return g;
  }

  /* ---------------------------------------------------------------- */
  /* 2.12  plumbing                                                     */
  /* ---------------------------------------------------------------- */

  /** Tube swept along a list of points (faucet spouts, chandelier arms). */
  function tube(points, r, material, o = {}) {
    const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
    const g = new THREE.TubeGeometry(curve, o.seg || 48, r, o.rad || 12, false);
    const m = new THREE.Mesh(g, material);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }

  function finishMat(f) {
    if (f === 'brass' || f === 'gold') return P.brassPolished;
    if (f === 'black' || f === 'matteBlack') return P.blackMetal;
    if (f === 'steel' || f === 'stainless') return P.steel;
    return P.chrome;
  }

  /**
   * Faucet.
   * @anchor centre of the faucet base, at the deck surface (y = 0); the spout
   *         reaches toward +Z (out over the bowl).
   * @param {object} [o] {style:'gooseneck'|'commercial'|'wallMount'|'bar',
   *                      finish:'chrome'|'brass'|'black', height, reach, handles}
   */
  function faucet(o = {}) {
    const style = o.style || 'gooseneck';
    const m = finishMat(o.finish);
    const accent = o.accent ? finishMat(o.accent) : m;
    const H = o.height === undefined ? inch(13) : o.height;
    const R = o.reach === undefined ? inch(8.5) : o.reach;
    const r = o.r === undefined ? inch(0.52) : o.r;
    const g = G('faucet base centre at the deck surface', [inch(3), H, R]);

    if (style === 'wallMount') {
      const esc = cyl(inch(1.4), inch(1.4), inch(0.6), m, 24);
      esc.rotation.x = HALFPI; esc.position.z = inch(0.3);
      g.add(esc);
      g.add(tube([[0, 0, 0], [0, 0, R * 0.55], [0, -inch(1.2), R]], r, m));
      return g;
    }

    const base = cyl(inch(1.35), inch(1.5), inch(0.85), m, 28);
    base.position.y = inch(0.42);
    g.add(base);

    if (style === 'commercial') {
      // spring-coil pull-down: straight column, helical spring, articulated head
      const colH = H;
      g.add(cyl(r, r, colH, m, 20, { at: [0, colH / 2, 0] }));
      const pts = [];
      const turns = 12, hCoil = colH * 0.62, rad = inch(1.1);
      for (let i = 0; i <= turns * 12; i++) {
        const t = i / (turns * 12);
        pts.push([Math.cos(t * TAU * turns) * rad, colH * 0.30 + hCoil * t,
          Math.sin(t * TAU * turns) * rad]);
      }
      g.add(tube(pts, inch(0.13), accent, { seg: turns * 14, rad: 6 }));
      g.add(tube([[0, colH, 0], [0, colH + inch(1.0), R * 0.35], [0, colH - inch(0.6), R * 0.8]],
        r * 0.85, m));
      const head = cyl(inch(0.75), inch(0.62), inch(3.4), accent, 20);
      head.rotation.x = deg(28);
      head.position.set(0, colH - inch(2.4), R * 0.82);
      g.add(head);
      const lev = box(inch(3.0), inch(0.42), inch(0.42), accent, { r: inch(0.18), seg: 2 });
      lev.position.set(inch(1.2), colH * 0.94, -inch(0.8));
      lev.rotation.z = deg(-18);
      g.add(lev);
      return g;
    }

    // gooseneck / bar
    const pts = [
      [0, 0, 0], [0, H * 0.55, 0], [0, H, R * 0.18], [0, H * 0.94, R * 0.72], [0, H * 0.72, R],
    ];
    g.add(tube(pts, r, m));
    const aer = cyl(inch(0.6), inch(0.52), inch(0.7), m, 18);
    aer.position.set(0, H * 0.72 - inch(0.5), R);
    g.add(aer);
    const handles = o.handles === undefined ? 1 : o.handles;
    if (handles === 1) {
      const lev = box(inch(3.2), inch(0.44), inch(0.44), m, { r: inch(0.19), seg: 2 });
      lev.position.set(inch(1.3), H * 0.55, -inch(0.6));
      lev.rotation.z = deg(-16);
      g.add(lev);
    } else {
      for (const s of [-1, 1]) {
        const hb = cyl(inch(0.7), inch(0.8), inch(1.0), m, 18);
        hb.position.set(s * inch(4), inch(0.6), 0);
        g.add(hb);
        const cross = box(inch(2.4), inch(0.32), inch(0.32), m, { r: inch(0.14) });
        cross.position.set(s * inch(4), inch(1.3), 0);
        g.add(cross);
      }
    }
    return g;
  }

  /**
   * The inside surfaces of an open-top basin: four inward-facing walls and a
   * floor, so the bowl is a real cavity rather than a dark box floating in a
   * bright one.
   * @anchor rim plane centre (y = 0); the cavity is below.
   */
  function basinCavity(w, d, depth, material, r = inch(1.0)) {
    const b = new Builder();
    const hx = w / 2, hz = d / 2, y0 = -depth;
    const U = [[0, 0], [1, 0], [1, 1], [0, 1]];
    b.quad([-hx, y0, hz], [hx, y0, hz], [hx, y0, -hz], [-hx, y0, -hz], [0, 1, 0], U);
    b.quad([hx, y0, hz], [hx, 0, hz], [hx, 0, -hz], [hx, y0, -hz], [-1, 0, 0], U);
    b.quad([-hx, y0, -hz], [-hx, 0, -hz], [-hx, 0, hz], [-hx, y0, hz], [1, 0, 0], U);
    b.quad([-hx, y0, hz], [-hx, 0, hz], [hx, 0, hz], [hx, y0, hz], [0, 0, -1], U);
    b.quad([hx, y0, -hz], [hx, 0, -hz], [-hx, 0, -hz], [-hx, y0, -hz], [0, 0, 1], U);
    void r;
    const m = new THREE.Mesh(b.geometry(THREE), material);
    m.castShadow = false; m.receiveShadow = true;
    return m;
  }

  /**
   * Interior surfaces of a box with its +Z face missing — a firebox, a niche,
   * an oven cavity.  Normals face into the void so you can see the back and
   * side walls through the opening.
   * @anchor centre of the cavity volume.
   */
  function cavityBox(w, h, d, material) {
    const b = new Builder();
    const hx = w / 2, hy = h / 2, hz = d / 2;
    const U = [[0, 0], [1, 0], [1, 1], [0, 1]];
    b.quad([-hx, -hy, -hz], [hx, -hy, -hz], [hx, hy, -hz], [-hx, hy, -hz], [0, 0, 1], U);
    b.quad([hx, -hy, -hz], [hx, -hy, hz], [hx, hy, hz], [hx, hy, -hz], [-1, 0, 0], U);
    b.quad([-hx, -hy, hz], [-hx, -hy, -hz], [-hx, hy, -hz], [-hx, hy, hz], [1, 0, 0], U);
    b.quad([-hx, -hy, -hz], [-hx, -hy, hz], [hx, -hy, hz], [hx, -hy, -hz], [0, 1, 0], U);
    b.quad([-hx, hy, hz], [-hx, hy, -hz], [hx, hy, -hz], [hx, hy, hz], [0, -1, 0], U);
    const m = new THREE.Mesh(b.geometry(THREE), material);
    m.castShadow = false; m.receiveShadow = true;
    return m;
  }

  /** Outer shell + rim + cavity + drain: the body of any undermount basin. */
  function basin(w, d, depth, material, o = {}) {
    const g = new THREE.Group();
    const wt = o.wall === undefined ? inch(0.55) : o.wall;
    const r = o.r === undefined ? inch(1.1) : o.r;
    const shell = box(w, depth, d, material, { r, seg: 3 });
    shell.position.y = -depth / 2 - inch(0.30);
    g.add(shell);
    const rim = plateWithHoles(w + inch(0.5), d + inch(0.5),
      [[-(w / 2 - wt), -(d / 2 - wt), w / 2 - wt, d / 2 - wt]],
      inch(0.30), material, { bevel: inch(0.05) });
    rim.rotation.x = -HALFPI;
    rim.position.y = 0;
    g.add(rim);
    g.add(basinCavity(w - 2 * wt, d - 2 * wt, depth - inch(0.4), material));
    const drain = cyl(inch(1.75), inch(1.75), inch(0.22), o.drainMaterial || P.chrome, 24);
    drain.position.y = -depth + inch(0.5);
    g.add(drain);
    return g;
  }

  /**
   * Undermount sink: bowls hung below the counter with a small reveal.
   * @anchor centre of the sink cut-out at the COUNTER TOP surface (y = 0);
   *         the bowls hang into negative y.
   */
  function undermountSink(o = {}) {
    const bowls = o.bowls === undefined ? 2 : o.bowls;
    const w = o.w === undefined ? (bowls === 2 ? ft(2, 8) : ft(2, 0)) : o.w;
    const d = o.d === undefined ? ft(1, 6) : o.d;
    const depth = o.depth === undefined ? inch(9.5) : o.depth;
    const m = o.material || P.steel;
    const g = G('centre of the sink cut-out at the counter top surface', [w, depth, d]);
    const bw = (w - (bowls - 1) * inch(0.8)) / bowls;
    for (let i = 0; i < bowls; i++) {
      const cx = -w / 2 + bw / 2 + i * (bw + inch(0.8));
      const b = basin(bw, d, depth, m, { wall: inch(0.5) });
      b.position.x = cx;
      g.add(b);
    }
    return g;
  }

  /**
   * Apron-front (farmhouse) sink.
   * @anchor centre of the sink cut-out at the COUNTER TOP surface; the apron
   *         faces +Z.
   */
  function farmhouseSink(o = {}) {
    const w = o.w === undefined ? ft(2, 8) : o.w;
    const d = o.d === undefined ? ft(1, 8) : o.d;
    const depth = o.depth === undefined ? inch(10) : o.depth;
    const m = o.material || P.china;
    const g = G('centre of the sink cut-out at the counter top surface', [w, depth, d]);
    g.add(basin(w, d, depth, m, { wall: inch(1.0), r: inch(0.8) }));
    // the apron front hangs proud of the cabinet face
    const apron = box(w + inch(0.8), depth + inch(2.0), inch(1.4), m, { r: inch(0.35), seg: 3 });
    apron.position.set(0, -(depth + inch(2.0)) / 2 + inch(0.5), d / 2 + inch(0.55));
    g.add(apron);
    return g;
  }

  /**
   * Elongated one-piece toilet.
   * @anchor bottom centre of the toilet BACK (tank against the wall, z = 0).
   */
  function toilet(o = {}) {
    const m = o.material || P.china;
    const g = G('bottom centre of the toilet back, on the floor', [ft(1, 6), ft(2, 6), ft(2, 5)]);
    const tankW = ft(1, 5), tankH = inch(15), tankD = inch(8);
    // base / trapway
    const foot = box(inch(8.5), inch(3.2), inch(9), m, { r: inch(1.4), seg: 3 });
    foot.position.set(0, inch(1.6), inch(6.5));
    g.add(foot);
    const ped = box(inch(9.5), inch(13), inch(13), m, { r: inch(3.0), seg: 4 });
    ped.position.set(0, inch(7.5), inch(9.5));
    g.add(ped);
    // bowl
    const bowl = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20, 0, TAU, HALFPI, HALFPI), m);
    bowl.scale.set(inch(8.4), inch(6.2), inch(10.4));
    bowl.position.set(0, inch(15.2), inch(11.5));
    bowl.castShadow = true; bowl.receiveShadow = true;
    g.add(bowl);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1, inch(0.9), 12, 44), m);
    rim.rotation.x = HALFPI;
    rim.scale.set(inch(8.0), inch(10.0), 1);
    rim.position.set(0, inch(15.2), inch(11.5));
    rim.castShadow = true; rim.receiveShadow = true;
    g.add(rim);
    // seat + lid
    const seat = new THREE.Mesh(new THREE.TorusGeometry(1, inch(0.75), 10, 44), m);
    seat.rotation.x = HALFPI;
    seat.scale.set(inch(7.9), inch(9.9), 1);
    seat.position.set(0, inch(16.4), inch(11.5));
    seat.castShadow = true; seat.receiveShadow = true;
    g.add(seat);
    const lid = box(inch(15.4), inch(0.8), inch(19.4), m, { r: inch(0.35), seg: 3 });
    lid.scale.set(1, 1, 1);
    lid.position.set(0, inch(17.3), inch(11.4));
    g.add(lid);
    // tank
    const tank = box(tankW, tankH, tankD, m, { r: inch(1.1), seg: 3 });
    tank.position.set(0, inch(15) + tankH / 2 - inch(1.0), tankD / 2 + inch(0.6));
    g.add(tank);
    const tlid = box(tankW + inch(0.5), inch(1.5), tankD + inch(0.5), m, { r: inch(0.4), seg: 3 });
    tlid.position.set(0, inch(15) + tankH - inch(0.4), tankD / 2 + inch(0.6));
    g.add(tlid);
    const lever = box(inch(2.4), inch(0.4), inch(0.4), P.chrome, { r: inch(0.15) });
    lever.position.set(-tankW / 2 + inch(2.0), inch(15) + tankH - inch(3.0), tankD + inch(0.7));
    g.add(lever);
    // supply + stop
    const sup = cyl(inch(0.28), inch(0.28), inch(8), P.chrome, 10);
    sup.position.set(-tankW / 2 + inch(2.5), inch(11), inch(1.4));
    g.add(sup);
    return g;
  }

  /**
   * Pedestal lavatory.
   * @anchor bottom centre of the pedestal BACK, on the floor.
   */
  function pedestalSink(o = {}) {
    const w = o.w === undefined ? ft(1, 10) : o.w;
    const d = o.d === undefined ? ft(1, 8) : o.d;
    const h = o.h === undefined ? inch(33) : o.h;
    const m = o.material || P.china;
    const g = G('bottom centre of the pedestal back, on the floor', [w, h, d]);
    const ped = taperBox(inch(9), inch(9), inch(7), inch(8), h - inch(7), m);
    ped.position.set(0, 0, d / 2);
    g.add(ped);
    const bowl = basin(w, d, inch(6.5), m, { wall: inch(2.2), r: inch(1.6) });
    bowl.position.set(0, h, d / 2);
    g.add(bowl);
    const f = faucet({ style: 'gooseneck', finish: o.finish || 'chrome', height: inch(8), reach: inch(5) });
    f.position.set(0, h, inch(2.4));
    g.add(f);
    return g;
  }

  /**
   * Drop-in jetted (jacuzzi) tub with a TILED deck surround and jets.
   * @anchor bottom CENTRE of the surround footprint in plan, on the floor.
   * @param {object} [o] {w, l, deckH, tubW, tubL, depth, tile, jets}
   */
  function dropInJacuzziTub(o = {}) {
    const w = o.w === undefined ? ft(6, 0) : o.w;
    const l = o.l === undefined ? ft(5, 0) : o.l;
    const deckH = o.deckH === undefined ? inch(21) : o.deckH;
    const tile = o.tile || P.tile;
    const g = G('bottom centre of the surround footprint, on the floor', [w, deckH, l]);
    const tw = o.tubW === undefined ? w - ft(1, 4) : o.tubW;
    const tl = o.tubL === undefined ? l - ft(1, 4) : o.tubL;
    const depth = o.depth === undefined ? inch(17) : o.depth;
    const capT = inch(1.4);
    // tiled deck built as a ring of four walls so the tub is a real void
    const sideW = (w - tw) / 2, endL = (l - tl) / 2;
    for (const s of [-1, 1]) {
      const b1 = box(w, deckH - capT, endL, tile, { r: inch(0.1), uv: true });
      b1.position.set(0, (deckH - capT) / 2, s * (l / 2 - endL / 2));
      g.add(b1);
      const b2 = box(sideW, deckH - capT, tl, tile, { r: inch(0.1), uv: true });
      b2.position.set(s * (w / 2 - sideW / 2), (deckH - capT) / 2, 0);
      g.add(b2);
    }
    // quartz deck cap with the tub opening cut through it
    const cap = plateWithHoles(w + inch(1.2), l + inch(1.2),
      [[-tw / 2, -tl / 2, tw / 2, tl / 2]], capT, o.capMaterial || P.quartz,
      { bevel: inch(0.07) });
    cap.rotation.x = -HALFPI;
    cap.position.y = deckH;
    g.add(cap);
    const cav = basinCavity(tw, tl, depth, P.acrylic);
    cav.position.y = deckH - capT;
    g.add(cav);
    // jets
    const jets = o.jets === undefined ? 6 : o.jets;
    for (let i = 0; i < jets; i++) {
      const a = (i / jets) * TAU;
      const jx = Math.cos(a) * (tw / 2 - inch(2.0));
      const jz = Math.sin(a) * (tl / 2 - inch(2.0));
      const j = cyl(inch(1.05), inch(1.05), inch(0.5), P.chrome, 16);
      j.rotation.z = HALFPI;
      j.rotation.y = -a;
      j.position.set(jx, deckH - inch(8), jz);
      g.add(j);
    }
    const drain = cyl(inch(1.1), inch(1.1), inch(0.3), P.chrome, 20);
    drain.position.set(0, deckH - capT - depth + inch(0.2), 0);
    g.add(drain);
    const f = faucet({ style: 'gooseneck', finish: o.finish || 'chrome', height: inch(9), reach: inch(7) });
    f.position.set(0, deckH, -l / 2 + inch(5));
    f.rotation.y = Math.PI;
    g.add(f);
    return g;
  }

  /**
   * Alcove bathtub with an integral apron.
   * @anchor bottom centre of the tub BACK (against the back wall), on the floor.
   */
  function alcoveTub(o = {}) {
    const w = o.w === undefined ? ft(5, 0) : o.w;
    const d = o.d === undefined ? ft(2, 6) : o.d;
    const h = o.h === undefined ? inch(20) : o.h;
    const m = o.material || P.acrylic;
    const g = G('bottom centre of the tub back, on the floor', [w, h, d]);
    const tw = w - inch(7), td = d - inch(7);
    const rimT = inch(2.2);
    // apron + deck as a ring so the bathing well is a genuine cavity
    const sideW = (w - tw) / 2, endD = (d - td) / 2;
    for (const s of [-1, 1]) {
      const b1 = box(w, h - rimT, endD, m, { r: inch(1.2), seg: 3 });
      b1.position.set(0, (h - rimT) / 2, d / 2 + s * (d / 2 - endD / 2));
      g.add(b1);
      const b2 = box(sideW, h - rimT, td, m, { r: inch(1.2), seg: 3 });
      b2.position.set(s * (w / 2 - sideW / 2), (h - rimT) / 2, d / 2);
      g.add(b2);
    }
    const rim = plateWithHoles(w, d, [[-tw / 2, -td / 2, tw / 2, td / 2]], rimT, m,
      { bevel: inch(0.5) });
    rim.rotation.x = -HALFPI;
    rim.position.set(0, h, d / 2);
    g.add(rim);
    const cav = basinCavity(tw, td, h - rimT - inch(1.0), m);
    cav.position.set(0, h - rimT, d / 2);
    g.add(cav);
    const drain = cyl(inch(1.1), inch(1.1), inch(0.3), P.chrome, 20);
    drain.position.set(-w / 2 + inch(6), inch(2.0), d / 2);
    g.add(drain);
    const spout = cyl(inch(0.9), inch(0.9), inch(5.5), P.chrome, 16);
    spout.rotation.x = HALFPI;
    spout.position.set(-w / 2 + inch(5), h - inch(2.5), inch(2.5));
    g.add(spout);
    return g;
  }

  /**
   * Tiled shower pan with a linear drain and a curb.
   * @anchor bottom CENTRE of the pan footprint in plan, on the floor.
   */
  function showerPan(o = {}) {
    const w = o.w === undefined ? ft(4, 0) : o.w;
    const d = o.d === undefined ? ft(3, 6) : o.d;
    const m = o.material || P.tile;
    const g = G('bottom centre of the pan footprint, on the floor', [w, inch(6), d]);
    const pan = box(w, inch(1.4), d, m, { r: inch(0.06), uv: true });
    pan.position.y = inch(0.7);
    g.add(pan);
    if (o.curb !== false) {
      const cw = o.curbSide === 'x' ? inch(4.5) : w;
      const cd = o.curbSide === 'x' ? d : inch(4.5);
      const curb = box(cw, inch(4.5), cd, m, { r: inch(0.12), uv: true });
      curb.position.set(o.curbSide === 'x' ? w / 2 - inch(2.25) : 0, inch(2.25),
        o.curbSide === 'x' ? 0 : d / 2 - inch(2.25));
      g.add(curb);
      const cap = box(cw + inch(0.4), inch(0.8), cd + inch(0.4), P.quartz, { r: inch(0.06), seg: 2 });
      cap.position.set(curb.position.x, inch(4.9), curb.position.z);
      g.add(cap);
    }
    const drain = box(w * 0.5, inch(0.2), inch(2.4), P.steel, { r: inch(0.03) });
    drain.position.set(0, inch(1.42), 0);
    g.add(drain);
    return g;
  }

  /**
   * Frameless glass shower door with a metal pivot hinge and a ladder pull.
   * @anchor bottom centre of the door opening; the glass plane is z = 0 and
   *         the door swings toward +Z.
   */
  function framelessGlassShowerDoor(o = {}) {
    const w = o.w === undefined ? ft(2, 6) : o.w;
    const h = o.h === undefined ? ft(6, 6) : o.h;
    const hinge = o.hinge === 'right' ? 1 : -1;
    const open = o.open === undefined ? 0 : o.open;
    const fin = finishMat(o.finish || 'chrome');
    const gm = o.glass || local('showerGlass', null, {
      color: 0xeef4f3, roughness: 0.02, metalness: 0.0, transmission: 0.97,
      thickness: inch(0.5), ior: 1.52, transparent: true, envMapIntensity: 1.5,
      side: THREE.DoubleSide,
    });
    const g = G('bottom centre of the shower door opening, glass plane z = 0', [w, h, inch(0.5)]);
    const pivot = new THREE.Group();
    pivot.position.x = hinge * w / 2;
    pivot.rotation.y = -hinge * open;
    g.add(pivot);
    const panel = box(w, h, inch(0.5), gm, { r: inch(0.05), cast: false });
    panel.position.set(-hinge * w / 2, h / 2, 0);
    pivot.add(panel);
    for (const y of [h * 0.16, h * 0.84]) {
      const hg = box(inch(2.4), inch(4.4), inch(1.5), fin, { r: inch(0.12), seg: 2 });
      hg.position.set(hinge * inch(0.5), y, 0);
      pivot.add(hg);
    }
    const bar = box(inch(0.7), inch(20), inch(0.7), fin, { r: inch(0.3), seg: 3 });
    bar.position.set(-hinge * (w - inch(3.0)), h * 0.52, inch(1.6));
    pivot.add(bar);
    for (const s of [-1, 1]) {
      const post = cyl(inch(0.35), inch(0.35), inch(1.6), fin, 12);
      post.rotation.x = HALFPI;
      post.position.set(-hinge * (w - inch(3.0)), h * 0.52 + s * inch(8.5), inch(0.8));
      pivot.add(post);
    }
    return g;
  }

  /**
   * Corner glass shower enclosure: two fixed panels + a door, with a curb.
   * @anchor bottom CENTRE of the enclosure footprint in plan, on the floor.
   */
  function cornerGlassShower(o = {}) {
    const w = o.w === undefined ? ft(4, 0) : o.w;
    const d = o.d === undefined ? ft(3, 6) : o.d;
    const h = o.h === undefined ? ft(6, 8) : o.h;
    const fin = finishMat(o.finish || 'chrome');
    const g = G('bottom centre of the enclosure footprint, on the floor', [w, h, d]);
    g.add(showerPan({ w, d, curb: true, curbSide: 'z', material: o.panMaterial }));
    const door = framelessGlassShowerDoor({ w: w * 0.55, h: h - inch(5), finish: o.finish, open: o.open });
    door.position.set(-w / 2 + w * 0.275, inch(5), d / 2);
    g.add(door);
    const gm = door.children.find((c) => c.isGroup) ? null : null;
    void gm;
    const fixed = box(w * 0.45 - inch(0.3), h - inch(5), inch(0.5),
      local('showerGlass', null, {
        color: 0xeef4f3, roughness: 0.02, transmission: 0.97, thickness: inch(0.5),
        ior: 1.52, transparent: true, envMapIntensity: 1.5, side: THREE.DoubleSide,
      }), { r: inch(0.05), cast: false });
    fixed.position.set(w / 2 - (w * 0.45) / 2, inch(5) + (h - inch(5)) / 2, d / 2);
    g.add(fixed);
    const side = box(inch(0.5), h - inch(5), d - inch(0.6),
      local('showerGlass', null, {}), { r: inch(0.05), cast: false });
    side.position.set(w / 2 - inch(0.25), inch(5) + (h - inch(5)) / 2, 0);
    g.add(side);
    for (const p of [[0, w / 2 - inch(0.25), d / 2], [1, w / 2 - inch(0.25), -d / 2 + inch(0.4)]]) {
      const clip = box(inch(1.4), inch(2.6), inch(1.4), fin, { r: inch(0.12) });
      clip.position.set(p[1], h - inch(4), p[2]);
      g.add(clip);
    }
    return g;
  }

  /**
   * Shower head on an arm.
   * @anchor wall face at the arm's escutcheon (z = 0), spray toward +Z.
   */
  function showerHead(o = {}) {
    const fin = finishMat(o.finish || 'chrome');
    const g = G('wall face at the shower arm escutcheon');
    const esc = cyl(inch(1.5), inch(1.5), inch(0.5), fin, 24);
    esc.rotation.x = HALFPI; esc.position.z = inch(0.25);
    g.add(esc);
    g.add(tube([[0, 0, 0], [0, -inch(0.5), inch(4)], [0, -inch(3.0), inch(6.5)]], inch(0.32), fin));
    const head = cyl(inch(3.2), inch(2.6), inch(1.3), fin, 32);
    head.rotation.x = deg(58);
    head.position.set(0, -inch(3.6), inch(7.4));
    g.add(head);
    return g;
  }

  /** Pressure-balance shower valve trim. @anchor wall face at the trim centre. */
  function showerValve(o = {}) {
    const fin = finishMat(o.finish || 'chrome');
    const g = G('wall face at the valve trim centre');
    const plate = cyl(inch(3.4), inch(3.4), inch(0.4), fin, 32);
    plate.rotation.x = HALFPI; plate.position.z = inch(0.2);
    g.add(plate);
    const stem = cyl(inch(0.7), inch(0.7), inch(1.5), fin, 18);
    stem.rotation.x = HALFPI; stem.position.z = inch(1.05);
    g.add(stem);
    const lev = box(inch(3.0), inch(0.5), inch(0.5), fin, { r: inch(0.22), seg: 2 });
    lev.position.set(inch(1.2), inch(0.4), inch(1.9));
    lev.rotation.z = deg(20);
    g.add(lev);
    return g;
  }

  /**
   * Recessed shower niche with a quartz shelf.
   * @anchor bottom centre of the niche opening on the wall face (z = 0);
   *         the niche recesses into negative z.
   */
  function showerNiche(o = {}) {
    const w = o.w === undefined ? ft(2, 0) : o.w;
    const h = o.h === undefined ? ft(1, 2) : o.h;
    const d = o.d === undefined ? inch(3.5) : o.d;
    const m = o.material || P.tile;
    const g = G('bottom centre of the niche opening on the wall face', [w, h, d]);
    const back = box(w, h, inch(0.4), m, { r: inch(0.04), uv: true, cast: false });
    back.position.set(0, h / 2, -d);
    g.add(back);
    for (const s of [-1, 1]) {
      const side = box(inch(0.4), h, d, m, { r: inch(0.04), uv: true, cast: false });
      side.position.set(s * (w / 2 - inch(0.2)), h / 2, -d / 2);
      g.add(side);
      const cap = box(w, inch(0.4), d, m, { r: inch(0.04), uv: true, cast: false });
      cap.position.set(0, s < 0 ? inch(0.2) : h - inch(0.2), -d / 2);
      g.add(cap);
    }
    if (o.shelf !== false) {
      const sh = box(w - inch(0.8), inch(0.8), d - inch(0.3), P.quartz, { r: inch(0.05), seg: 2 });
      sh.position.set(0, h * 0.5, -d / 2);
      g.add(sh);
    }
    return g;
  }

  /**
   * Mosaic accent band (shower / backsplash).
   * @anchor bottom centre against the wall face (z = 0).
   */
  function mosaicBand(o = {}) {
    const w = o.w === undefined ? 6 : o.w;
    const h = o.h === undefined ? inch(4) : o.h;
    const m = o.material || P.mosaic;
    const g = G('bottom centre against the wall face', [w, h, inch(0.5)]);
    const b2 = boxAt(-w / 2, 0, 0, w, h, inch(0.5), m, { r: inch(0.03), uv: true });
    g.add(b2);
    return g;
  }

  /* ---------------------------------------------------------------- */
  /* 2.13  light fixtures (geometry only — lighting.js owns the lights) */
  /* ---------------------------------------------------------------- */

  /**
   * Recessed can trim: white flange, dark baffle, lit lens.
   * @anchor centre of the trim at the CEILING plane; the can recesses upward.
   */
  function recessedTrim(o = {}) {
    const d = o.d === undefined ? inch(6) : o.d;
    const g = G('centre of the trim at the ceiling plane', [d, inch(0.4), d]);
    const m = o.material || P.trimWhite;
    const flange = new THREE.Mesh(
      new THREE.CylinderGeometry(d / 2 + inch(0.55), d / 2 + inch(0.35), inch(0.35), 40), m);
    flange.position.y = -inch(0.17);
    flange.castShadow = false; flange.receiveShadow = true;
    g.add(flange);
    const cone = new THREE.Mesh(
      new THREE.CylinderGeometry(d / 2, d / 2 - inch(0.9), inch(3.2), 40, 1, true),
      o.baffle || local('canBaffle', null, { color: 0xe9e7e3, roughness: 0.75, side: THREE.DoubleSide }));
    cone.position.y = inch(1.6);
    g.add(cone);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(d / 2 - inch(0.9), 36),
      o.lens || (o.on === false ? P.trimWhite : P.bulbSoft));
    lens.rotation.x = HALFPI;
    lens.position.y = inch(3.1);
    g.add(lens);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(d / 2 - inch(0.85), d / 2 - inch(0.85),
      inch(1.2), 36), o.can || local('canBody', null, { color: 0xdedcd8, roughness: 0.6 }));
    cap.position.y = inch(3.7);
    g.add(cap);
    return g;
  }

  /**
   * Dining-room sputnik: black canopy and stem, brass hub, black arms at
   * mixed angles, brass socket cups and white opal globes.
   * @anchor the CEILING attachment point; the fixture hangs into negative y.
   */
  function sputnikGlobeChandelier(o = {}) {
    const arms = o.arms === undefined ? 12 : o.arms;
    const drop = o.drop === undefined ? ft(1, 8) : o.drop;
    const armLen = o.armLen === undefined ? ft(1, 2) : o.armLen;
    const globeR = o.globeR === undefined ? inch(3.1) : o.globeR;
    const dark = P.blackMetal;
    const br = P.brassPolished;
    const g = G('ceiling attachment point; hangs into -y', [armLen * 2.4, drop + armLen, armLen * 2.4]);
    const can = cyl(inch(2.6), inch(2.6), inch(1.1), dark, 28);
    can.position.y = -inch(0.55);
    g.add(can);
    const stem = cyl(inch(0.32), inch(0.32), drop, dark, 14);
    stem.position.y = -drop / 2;
    g.add(stem);
    const hubY = -drop;
    const hub = cyl(inch(1.15), inch(1.15), inch(2.6), br, 24);
    hub.position.y = hubY;
    g.add(hub);
    const hubB = ball(inch(1.2), dark, 20);
    hubB.position.y = hubY - inch(1.5);
    g.add(hubB);
    for (let i = 0; i < arms; i++) {
      const a = (i / arms) * TAU + (i % 2 ? 0.16 : 0);
      const el = [0.42, -0.10, -0.46][i % 3];
      const L = armLen * [1.0, 0.82, 0.94][i % 3];
      const dirv = [Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el)];
      const arm = cyl(inch(0.20), inch(0.20), L, dark, 10);
      arm.position.set(dirv[0] * L / 2, hubY + dirv[1] * L / 2, dirv[2] * L / 2);
      arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(dirv[0], dirv[1], dirv[2]));
      g.add(arm);
      const cup = cyl(inch(0.72), inch(0.55), inch(1.6), br, 16);
      cup.position.set(dirv[0] * (L - inch(1.4)), hubY + dirv[1] * (L - inch(1.4)),
        dirv[2] * (L - inch(1.4)));
      cup.quaternion.copy(arm.quaternion);
      g.add(cup);
      const gl = ball(globeR, P.bulb, 24);
      gl.castShadow = false;
      gl.position.set(dirv[0] * (L + globeR * 0.55), hubY + dirv[1] * (L + globeR * 0.55),
        dirv[2] * (L + globeR * 0.55));
      g.add(gl);
    }
    return g;
  }

  /**
   * Upper-hall gold "dandelion" burst: a brass core with dozens of thin
   * stems, each tipped with a small frosted bead.
   * @anchor the CEILING attachment point; hangs into negative y.
   */
  function goldDandelionBurstChandelier(o = {}) {
    const R = o.r === undefined ? ft(1, 3) : o.r;
    const drop = o.drop === undefined ? ft(3, 0) : o.drop;
    const n = o.stems === undefined ? 96 : o.stems;
    const br = P.brassPolished;
    const g = G('ceiling attachment point; hangs into -y', [R * 2, drop + R, R * 2]);
    const can = cyl(inch(2.2), inch(2.2), inch(0.9), P.steel, 24);
    can.position.y = -inch(0.45);
    g.add(can);
    const cable = cyl(inch(0.06), inch(0.06), drop - R, P.steel, 8);
    cable.position.y = -(drop - R) / 2;
    g.add(cable);
    const cy = -drop;
    const core = ball(inch(3.2), local('dandelionCore', null, {
      color: 0xc09048, roughness: 0.25, metalness: 1.0,
      emissive: 0xffd9a0, emissiveIntensity: 1.6, envMapIntensity: 1.4,
    }), 28);
    core.castShadow = false;
    core.position.y = cy;
    g.add(core);
    const stemGeo = new THREE.CylinderGeometry(inch(0.045), inch(0.045), 1, 6);
    const beadGeo = new THREE.SphereGeometry(inch(0.42), 10, 8);
    const stemM = br;
    const beadM = P.bulb;
    const stems = new THREE.InstancedMesh(stemGeo, stemM, n);
    const beads = new THREE.InstancedMesh(beadGeo, beadM, n);
    stems.castShadow = false; beads.castShadow = false;
    const dummy = new THREE.Object3D();
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < n; i++) {
      // Fibonacci sphere for an even burst
      const t = (i + 0.5) / n;
      const phi = Math.acos(1 - 2 * t);
      const th = Math.PI * (1 + Math.sqrt(5)) * i;
      const dv = new THREE.Vector3(Math.sin(phi) * Math.cos(th), Math.cos(phi),
        Math.sin(phi) * Math.sin(th));
      const L = R * (0.78 + 0.22 * ((i * 7919) % 13) / 13);
      dummy.position.set(dv.x * L / 2, cy + dv.y * L / 2, dv.z * L / 2);
      dummy.quaternion.setFromUnitVectors(up, dv);
      dummy.scale.set(1, L, 1);
      dummy.updateMatrix();
      stems.setMatrixAt(i, dummy.matrix);
      dummy.position.set(dv.x * L, cy + dv.y * L, dv.z * L);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      beads.setMatrixAt(i, dummy.matrix);
    }
    stems.instanceMatrix.needsUpdate = true;
    beads.instanceMatrix.needsUpdate = true;
    g.add(stems, beads);
    return g;
  }

  /**
   * Kitchen-island pendant: black cone shade on a brass chain with a brass
   * canopy and socket cup (as in `kitchen_view_1.png`).
   * @anchor the CEILING attachment point; hangs into negative y.
   */
  function pendantBlackShadeBrassChain(o = {}) {
    const shadeD = o.shadeD === undefined ? ft(1, 1) : o.shadeD;
    const drop = o.dropLen === undefined ? ft(2, 8) : o.dropLen;
    const shadeH = o.shadeH === undefined ? shadeD * 0.62 : o.shadeH;
    const br = P.brassPolished;
    const g = G('ceiling attachment point; hangs into -y', [shadeD, drop + shadeH, shadeD]);
    const can = cyl(inch(2.5), inch(2.3), inch(1.4), br, 28);
    can.position.y = -inch(0.7);
    g.add(can);
    // chain: alternating tori
    const chainLen = drop - shadeH;
    const links = Math.max(4, Math.round(chainLen / inch(1.1)));
    for (let i = 0; i < links; i++) {
      const lk = torus(inch(0.36), inch(0.075), br, 16, 6);
      lk.position.y = -inch(1.4) - (chainLen - inch(1.4)) * ((i + 0.5) / links);
      lk.rotation.x = HALFPI;
      lk.rotation.y = i % 2 ? HALFPI : 0;
      lk.castShadow = false;
      g.add(lk);
    }
    const cy = -chainLen;
    const cup = cyl(inch(1.05), inch(0.85), inch(2.0), br, 20);
    cup.position.y = cy - inch(1.0);
    g.add(cup);
    const shade = taperBox(0, 0, 0, 0, 0, P.blackMetal);
    void shade;
    const cone = new THREE.Mesh(
      new THREE.CylinderGeometry(shadeD * 0.16, shadeD / 2, shadeH, 48, 1, true),
      local('pendantShade', null, {
        color: 0x232427, roughness: 0.34, metalness: 0.3, side: THREE.DoubleSide,
        envMapIntensity: 0.8,
      }));
    cone.position.y = cy - inch(2.0) - shadeH / 2;
    cone.castShadow = true; cone.receiveShadow = true;
    g.add(cone);
    const inner = new THREE.Mesh(
      new THREE.CylinderGeometry(shadeD * 0.155, shadeD / 2 - inch(0.1), shadeH - inch(0.2), 48, 1, true),
      local('pendantShadeIn', null, { color: 0xf5f0e6, roughness: 0.5, side: THREE.BackSide }));
    inner.position.copy(cone.position);
    g.add(inner);
    const bulb = ball(inch(1.8), P.bulb, 20);
    bulb.castShadow = false;
    bulb.position.y = cy - inch(2.0) - shadeH * 0.72;
    g.add(bulb);
    return g;
  }

  /**
   * Bath vanity bar light.
   * @anchor centre of the backplate on the WALL face (z = 0), lights toward +Z.
   */
  function vanityBar(o = {}) {
    const n = o.lights === undefined ? 3 : o.lights;
    const w = o.w === undefined ? n * ft(0, 8) : o.w;
    const fin = finishMat(o.finish || 'brass');
    const g = G('centre of the backplate on the wall face', [w, inch(7), inch(7)]);
    const plate = box(w, inch(2.0), inch(0.8), fin, { r: inch(0.25), seg: 2 });
    plate.position.z = inch(0.4);
    g.add(plate);
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + (w * (i + 0.5)) / n;
      const arm = cyl(inch(0.35), inch(0.35), inch(3.2), fin, 12);
      arm.rotation.x = HALFPI;
      arm.position.set(x, 0, inch(2.2));
      g.add(arm);
      const cup = cyl(inch(1.1), inch(0.85), inch(1.2), fin, 20);
      cup.rotation.x = HALFPI;
      cup.position.set(x, 0, inch(4.2));
      g.add(cup);
      const sh = new THREE.Mesh(new THREE.SphereGeometry(inch(2.4), 24, 16), P.bulb);
      sh.castShadow = false;
      sh.position.set(x, 0, inch(6.2));
      g.add(sh);
    }
    return g;
  }

  /**
   * Flush / semi-flush ceiling mount with an opal drum diffuser.
   * @anchor centre of the canopy at the CEILING plane.
   */
  function flushMount(o = {}) {
    const d = o.d === undefined ? ft(1, 1) : o.d;
    const h = o.h === undefined ? inch(5) : o.h;
    const fin = finishMat(o.finish || 'brass');
    const g = G('centre of the canopy at the ceiling plane', [d, h, d]);
    const can = cyl(d * 0.34, d * 0.34, inch(1.0), fin, 28);
    can.position.y = -inch(0.5);
    g.add(can);
    const drum = new THREE.Mesh(
      new THREE.SphereGeometry(d / 2, 40, 20, 0, TAU, Math.PI * 0.5, Math.PI * 0.5), P.bulb);
    drum.scale.y = (h / (d / 2)) * 1.15;
    drum.position.y = -inch(0.9);
    drum.castShadow = false;
    g.add(drum);
    const ring = torus(d / 2 * 0.99, inch(0.22), fin, 40, 8);
    ring.rotation.x = HALFPI;
    ring.position.y = -inch(1.0);
    g.add(ring);
    const top = new THREE.Mesh(new THREE.CircleGeometry(d / 2 * 0.99, 40), fin);
    top.rotation.x = HALFPI;
    top.position.y = -inch(0.88);
    top.receiveShadow = true;
    g.add(top);
    return g;
  }

  /**
   * 2x4 fluorescent troffer for the basement drop ceiling.
   * @anchor centre of the lens at the CEILING plane.
   */
  function fluorescentTroffer(o = {}) {
    const w = o.w === undefined ? 2 : o.w;
    const l = o.l === undefined ? 4 : o.l;
    const g = G('centre of the lens at the ceiling plane', [w, inch(4), l]);
    const m = local('trofferFrame', null, { color: 0xf0efec, roughness: 0.45, metalness: 0.1 });
    const frame = box(w, inch(3.6), l, m, { r: inch(0.06), cast: false });
    frame.position.y = inch(1.8);
    g.add(frame);
    const lens = box(w - inch(1.6), inch(0.5), l - inch(1.6),
      local('trofferLens', null, {
        color: 0xfffaf0, roughness: 0.55, emissive: 0xfff3dd, emissiveIntensity: 1.4,
        transmission: 0.35, thickness: 0.02, transparent: true,
      }), { r: inch(0.05), cast: false });
    lens.position.y = inch(0.1);
    g.add(lens);
    return g;
  }

  /**
   * Splayed skylight well (the light shaft between the roof and the ceiling).
   * @anchor centre of the CEILING opening at the ceiling plane; the well
   *         rises into +y.
   */
  function skylightWell(o = {}) {
    const w = o.w === undefined ? 3 : o.w;
    const l = o.l === undefined ? 4 : o.l;
    const depth = o.depth === undefined ? 2 : o.depth;
    const splay = o.splay === undefined ? 0.55 : o.splay; // ft of flare per side
    const m = o.material || P.trimWhite;
    const g = G('centre of the ceiling opening at the ceiling plane', [w, depth, l]);
    const b = new Builder();
    const B = [[-w / 2, 0, l / 2], [w / 2, 0, l / 2], [w / 2, 0, -l / 2], [-w / 2, 0, -l / 2]];
    const tw = w - 2 * splay, tl = l - 2 * splay;
    const T = [[-tw / 2, depth, tl / 2], [tw / 2, depth, tl / 2],
      [tw / 2, depth, -tl / 2], [-tw / 2, depth, -tl / 2]];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      const n = v3norm(v3cross(v3sub(T[i], B[i]), v3sub(B[j], B[i])));
      const inward = [-(B[i][0] + B[j][0]), 0, -(B[i][2] + B[j][2])];
      if (v3dot(n, inward) < 0) { n[0] = -n[0]; n[1] = -n[1]; n[2] = -n[2]; }
      b.quad(B[i], B[j], T[j], T[i], n, [[0, 0], [1, 0], [1, 1], [0, 1]]);
    }
    const well = new THREE.Mesh(b.geometry(THREE), m);
    well.castShadow = false; well.receiveShadow = true;
    g.add(well);
    if (o.glazing !== false) {
      const sk = windowUnit({ w: tw - inch(2), h: tl - inch(2), type: 'skylight' }, {});
      sk.rotation.x = -HALFPI;
      sk.position.set(0, depth + inch(1), (tl - inch(2)) / 2);
      g.add(sk);
    }
    return g;
  }

  /* ---------------------------------------------------------------- */
  /* 2.14  structure                                                    */
  /* ---------------------------------------------------------------- */

  /**
   * Straight run of stairs.  Treads are oak with a 1" bullnose nosing,
   * risers painted, skirt boards both sides.
   * @anchor bottom centre of the FIRST riser, on the lower floor (y = 0);
   *         the flight ascends toward +Z.
   * @param {object} [o] {rise (total), treads, run, width, style:'closed'|'open',
   *                      treadMaterial, riserMaterial, skirt}
   */
  function straightStair(o = {}) {
    const rise = o.rise === undefined ? 9.5 : o.rise;
    const n = o.treads === undefined ? Math.round(rise / inch(7.5)) : o.treads;
    const run = o.run === undefined ? inch(10.5) : o.run;
    const w = o.width === undefined ? ft(3, 6) : o.width;
    const tm = o.treadMaterial || P.oakFloor;
    const rm = o.riserMaterial || P.trimWhite;
    const r = rise / n;
    const g = G('bottom centre of the first riser, ascending +Z', [w, rise, n * run]);
    const tt = inch(1.0), nose = inch(1.125);
    for (let i = 0; i < n; i++) {
      const y = r * (i + 1);
      const z = run * i;
      const riser = boxAt(-w / 2, y - r, z, w, r - tt, inch(0.75), rm, { r: inch(0.05), uv: true });
      g.add(riser);
      const tread = boxAt(-w / 2, y - tt, z - nose, w, tt, run + nose, tm,
        { r: inch(0.14), seg: 3, uv: true });
      g.add(tread);
    }
    if (o.skirt !== false) {
      // A real skirt board: its TOP edge is cut to the staircase profile and
      // its bottom edge is a straight rake that dies into the floor.  A plain
      // raking plank cannot cover the step nosings and leaves them floating.
      const th = inch(0.75);
      const drop = inch(9.5);
      const totalRun = n * run;
      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      for (let i = 0; i < n; i++) {
        shape.lineTo(run * i, r * (i + 1));
        shape.lineTo(run * (i + 1), r * (i + 1));
      }
      shape.lineTo(totalRun, rise - drop);
      const zFloor = Math.min(totalRun * 0.9, (drop * totalRun) / Math.max(rise, 1e-6));
      shape.lineTo(zFloor, 0);
      shape.closePath();
      const geo = new THREE.ExtrudeGeometry(shape, {
        depth: th, bevelEnabled: true, bevelThickness: inch(0.05), bevelSize: inch(0.05),
        bevelSegments: 1, steps: 1, curveSegments: 4,
      });
      const sf = uvs(rm);
      const uvA = geo.attributes.uv;
      for (let i = 0; i < uvA.count; i++) uvA.setXY(i, uvA.getX(i) / sf[0], uvA.getY(i) / sf[1]);
      uvA.needsUpdate = true;
      geo.computeVertexNormals();
      for (const s of [-1, 1]) {
        const sk = new THREE.Mesh(geo, rm);
        sk.castShadow = true; sk.receiveShadow = true;
        sk.rotation.y = -HALFPI;          // shape X -> world +Z, extrude -> -X
        sk.position.set(s < 0 ? -w / 2 : w / 2 + th, 0, 0);
        g.add(sk);
      }
    }
    g.userData.stepRise = r;
    g.userData.stepRun = run;
    g.userData.length = n * run;
    return g;
  }

  /**
   * U-return stair: two flights around a mid landing (the foyer stair).
   * @anchor bottom centre of the FIRST riser of the lower flight, ascending +Z.
   */
  function returnStair(o = {}) {
    const rise = o.rise === undefined ? 9.5 : o.rise;
    const w = o.width === undefined ? ft(3, 6) : o.width;
    const run = o.run === undefined ? inch(10.5) : o.run;
    const n = o.treads === undefined ? Math.round(rise / inch(7.5)) : o.treads;
    const nLower = o.lowerTreads === undefined ? Math.floor(n / 2) : o.lowerTreads;
    const nUpper = n - nLower;
    const r = rise / n;
    const g = G('bottom centre of the first riser of the lower flight, ascending +Z');
    const lower = straightStair({
      rise: r * nLower, treads: nLower, run, width: w,
      treadMaterial: o.treadMaterial, riserMaterial: o.riserMaterial, skirt: o.skirt,
    });
    g.add(lower);
    const landZ = nLower * run;
    const landing = boxAt(-w / 2, r * nLower - inch(1.0), landZ, w * 2 + inch(1), inch(1.0), w,
      o.treadMaterial || P.oakFloor, { r: inch(0.1), uv: true });
    g.add(landing);
    const upper = straightStair({
      rise: r * nUpper, treads: nUpper, run, width: w,
      treadMaterial: o.treadMaterial, riserMaterial: o.riserMaterial, skirt: o.skirt,
    });
    upper.rotation.y = Math.PI;
    upper.position.set(w + inch(1), r * nLower, landZ + w);
    g.add(upper);
    g.userData.landingZ = landZ;
    g.userData.stepRise = r;
    return g;
  }

  /**
   * Newel post.
   * @anchor bottom centre of the post, on the floor / tread.
   */
  function newelPost(o = {}) {
    const h = o.h === undefined ? ft(3, 4) : o.h;
    const s = o.size === undefined ? inch(3.5) : o.size;
    const m = o.material || P.whiteOak;
    const g = G('bottom centre of the post', [s, h, s]);
    g.add(box(s, h - inch(1.6), s, m, { r: inch(0.09), seg: 2, at: [0, (h - inch(1.6)) / 2, 0], uv: true }));
    const cap = box(s + inch(0.9), inch(1.1), s + inch(0.9), m, { r: inch(0.12), seg: 2, uv: true });
    cap.position.y = h - inch(1.05);
    g.add(cap);
    const top = box(s + inch(0.2), inch(0.6), s + inch(0.2), m, { r: inch(0.2), seg: 3, uv: true });
    top.position.y = h - inch(0.2);
    g.add(top);
    return g;
  }

  /**
   * Stair / balcony railing: shoe rail, square iron balusters, oak top rail.
   * @anchor the bottom of the run at the walking surface (y = 0); the railing
   *         runs along +Z and rises by `rise` over `length`.
   * @param {object} [o] {length, rise, height, style:'whiteOakBlackSquare'|
   *                      'whiteSpindle', spacing, posts}
   */
  function stairRailing(o = {}) {
    const L = o.length === undefined ? 8 : o.length;
    const rise = o.rise === undefined ? 0 : o.rise;
    const H = o.height === undefined ? (rise > 0 ? ft(2, 10) : ft(3, 0)) : o.height;
    const style = o.style || 'whiteOakBlackSquare';
    const railM = style === 'whiteSpindle' ? P.trimWhite : (o.railMaterial || P.whiteOak);
    const balM = style === 'whiteSpindle' ? P.trimWhite : (o.balusterMaterial || P.iron);
    const ang = Math.atan2(rise, L);
    const slope = Math.hypot(L, rise);
    const g = G('bottom of the run at the walking surface, running +Z', [inch(3), H + rise, L]);

    const rail = box(inch(2.6), inch(2.0), slope - inch(0.5), railM,
      { r: inch(0.35), seg: 3, uv: true });
    rail.position.set(0, H + rise / 2, L / 2);
    rail.rotation.x = -ang;
    g.add(rail);
    const shoe = box(inch(1.6), inch(1.0), slope - inch(0.5), railM, { r: inch(0.1), uv: true });
    shoe.position.set(0, inch(0.5) + rise / 2, L / 2);
    shoe.rotation.x = -ang;
    g.add(shoe);

    const sp = o.spacing === undefined ? inch(4.4) : o.spacing;
    const cnt = Math.max(2, Math.round(L / sp));
    for (let i = 0; i < cnt; i++) {
      const t = (i + 0.5) / cnt;
      const z = L * t, y = rise * t;
      const hgt = H - inch(1.4);
      if (style === 'whiteSpindle') {
        const sp2 = new THREE.Mesh(new THREE.LatheGeometry(spindleProfile(hgt), 16), balM);
        sp2.position.set(0, y + inch(1.0), z);
        sp2.castShadow = true; sp2.receiveShadow = true;
        g.add(sp2);
      } else {
        const b2 = box(inch(0.55), hgt, inch(0.55), balM, { r: inch(0.05), at: [0, y + inch(1.0) + hgt / 2, z] });
        g.add(b2);
      }
    }
    if (o.posts !== false) {
      const p0 = newelPost({ h: H + inch(6), material: railM });
      p0.position.set(0, 0, -inch(1.8));
      g.add(p0);
      const p1 = newelPost({ h: H + inch(6), material: railM });
      p1.position.set(0, rise, L + inch(1.8));
      g.add(p1);
    }
    return g;
  }

  /** Lathe profile for a turned spindle of height h. */
  function spindleProfile(h) {
    const pts = [];
    const add = (r, y) => pts.push(new THREE.Vector2(r, y * h));
    add(inch(0.75), 0.00); add(inch(0.75), 0.05); add(inch(0.55), 0.09);
    add(inch(0.62), 0.13); add(inch(0.38), 0.20); add(inch(0.36), 0.52);
    add(inch(0.62), 0.60); add(inch(0.44), 0.66); add(inch(0.40), 0.86);
    add(inch(0.62), 0.92); add(inch(0.62), 1.00);
    return pts;
  }

  /**
   * Turned oak post (two of these stand in the basement rec room).
   * @anchor bottom centre of the post, on the floor.
   */
  function turnedOakPost(o = {}) {
    const h = o.h === undefined ? 7.49 : o.h;
    const m = o.material || P.whiteOak;
    const g = G('bottom centre of the post, on the floor', [inch(6), h, inch(6)]);
    const pts = [];
    const add = (r, y) => pts.push(new THREE.Vector2(inch(r), y * h));
    add(0.0, 0.000); add(3.6, 0.000); add(3.6, 0.055);
    add(3.1, 0.075); add(3.25, 0.100); add(2.55, 0.130);
    add(2.45, 0.165); add(3.05, 0.200); add(2.60, 0.235);
    add(2.42, 0.780); add(3.05, 0.815); add(2.60, 0.850);
    add(2.55, 0.895); add(3.25, 0.925); add(3.10, 0.948);
    add(3.6, 0.960); add(3.6, 1.000); add(0.0, 1.000);
    const lathe = new THREE.Mesh(new THREE.LatheGeometry(pts, 32), m);
    lathe.castShadow = true; lathe.receiveShadow = true;
    g.add(lathe);
    return g;
  }

  /**
   * Dropped beam (basement / open plan).
   * @anchor centre of the beam's BOTTOM face; the beam runs along +X.
   */
  function dropBeam(o = {}) {
    const w = o.w === undefined ? inch(7) : o.w;
    const h = o.h === undefined ? inch(10) : o.h;
    const l = o.l === undefined ? 12 : o.l;
    const m = o.material || P.trimWhite;
    const g = G('centre of the beam bottom face, running +X', [l, h, w]);
    const b2 = box(l, h, w, m, { r: R_PAINT, seg: 2, uv: true });
    b2.position.y = h / 2;
    g.add(b2);
    return g;
  }

  /**
   * Support column.
   * @anchor bottom centre of the column, on the floor.
   * @param {object} [o] {h, size, style:'squarePainted'|'round'|'timber'}
   */
  function supportColumn(o = {}) {
    const h = o.h === undefined ? 8.5 : o.h;
    const s = o.size === undefined ? inch(8) : o.size;
    const style = o.style || 'squarePainted';
    const m = o.material || (style === 'timber' ? P.timber : P.trimWhite);
    const g = G('bottom centre of the column, on the floor', [s, h, s]);
    if (style === 'round') {
      g.add(cyl(s / 2, s / 2 * 1.06, h - inch(3), m, 32, { at: [0, (h - inch(3)) / 2 + inch(1.5), 0] }));
    } else {
      g.add(box(s, h - inch(3), s, m, { r: R_PAINT, seg: 2, at: [0, (h - inch(3)) / 2 + inch(1.5), 0], uv: true }));
    }
    const base = box(s + inch(2.2), inch(1.5), s + inch(2.2), m, { r: inch(0.12), seg: 2, uv: true });
    base.position.y = inch(0.75);
    g.add(base);
    const cap = box(s + inch(2.2), inch(1.5), s + inch(2.2), m, { r: inch(0.12), seg: 2, uv: true });
    cap.position.y = h - inch(0.75);
    g.add(cap);
    return g;
  }

  /**
   * Direct-vent gas fireplace with a stacked-stone surround, firebox, log set,
   * an emissive flame plane, a mantel and a raised hearth.
   * @anchor bottom centre of the surround BACK, on the floor (surround against
   *         the wall plane z = 0, projecting +Z).
   */
  function gasFireplace(o = {}) {
    const w = o.w === undefined ? ft(6, 0) : o.w;
    const h = o.h === undefined ? ft(8, 0) : o.h;
    const d = o.d === undefined ? ft(1, 6) : o.d;
    const stone = o.surround === 'painted' ? P.trimWhite : (o.stoneMaterial || P.stone);
    const g = G('bottom centre of the surround back, on the floor', [w, h, d]);
    const fbW = o.fireboxW === undefined ? ft(3, 2) : o.fireboxW;
    const fbH = o.fireboxH === undefined ? ft(2, 0) : o.fireboxH;
    const hearthH = o.hearth === undefined ? inch(9) : o.hearth;
    const fbY = hearthH + inch(3);

    // surround: left, right, above
    const sideW = (w - fbW) / 2;
    for (const s of [-1, 1]) {
      const side = boxAt(s < 0 ? -w / 2 : fbW / 2, 0, 0, sideW, h, d, stone,
        { r: inch(0.08), uv: true });
      g.add(side);
    }
    g.add(boxAt(-fbW / 2, fbY + fbH, 0, fbW, h - fbY - fbH, d, stone, { r: inch(0.08), uv: true }));
    g.add(boxAt(-fbW / 2, 0, 0, fbW, fbY, d, stone, { r: inch(0.08), uv: true }));

    // hearth slab
    if (hearthH > 0) {
      const hs = boxAt(-w / 2 - inch(1.5), hearthH - inch(2.2), 0, w + inch(3), inch(2.2),
        d + inch(10), o.hearthMaterial || P.bluestone, { r: inch(0.08), seg: 2, uv: true });
      g.add(hs);
    }
    // firebox
    const fbD = d - inch(3.0);
    const fb = cavityBox(fbW - inch(3), fbH - inch(3), fbD, local('fireboxLiner', null, {
      color: 0x14151a, roughness: 0.62, metalness: 0.25, envMapIntensity: 0.3,
    }));
    fb.position.set(0, fbY + fbH / 2, fbD / 2 - inch(0.5));
    g.add(fb);
    const glass = box(fbW - inch(3.4), fbH - inch(3.4), inch(0.35),
      local('fireGlass', null, {
        // deliberately NOT a transmission material: three's transmission pass
        // does not capture transparent objects, so the flames behind the glass
        // would vanish.  Plain alpha blending keeps the fire visible.
        color: 0x1a1c20, roughness: 0.03, metalness: 0.0, transparent: true,
        opacity: 0.30, envMapIntensity: 1.6, side: THREE.DoubleSide,
        clearcoat: 1.0, clearcoatRoughness: 0.02, depthWrite: false,
      }), { r: inch(0.04), cast: false });
    glass.position.set(0, fbY + fbH / 2, d - inch(1.6));
    g.add(glass);
    // log set + ember bed
    const emb = boxAt(-fbW / 2 + inch(4), fbY + inch(2.0), inch(1.5), fbW - inch(8), inch(1.0),
      fbD - inch(6), local('emberBed', null, {
        color: 0x1c1410, roughness: 0.94, emissive: 0xff4a08, emissiveIntensity: 0.22,
      }), { r: inch(0.1) });
    g.add(emb);
    const logM = local('gasLog', null, {
      color: 0x453629, roughness: 0.88, emissive: 0x40140a, emissiveIntensity: 0.35,
    });
    for (let i = 0; i < 4; i++) {
      const lg = cyl(inch(1.8), inch(1.6), fbW - inch(9), logM, 12);
      lg.rotation.z = HALFPI;
      lg.rotation.y = deg(-8 + i * 5);
      lg.position.set(0, fbY + inch(4.2) + (i % 2) * inch(2.6),
        fbD * 0.45 + (i - 1.5) * inch(2.4));
      g.add(lg);
    }
    // emissive flame plane
    const flameM = local('flame', null, {
      color: 0x000000, emissive: 0xff8a1e, emissiveIntensity: 2.4, roughness: 1.0,
      transparent: true, opacity: 0.82, side: THREE.DoubleSide, depthWrite: false,
      alphaMap: flameAlpha(), toneMapped: true,
    });
    for (let i = 0; i < 3; i++) {
      const fw2 = (fbW - inch(11)) * (1 - i * 0.22);
      const fl = new THREE.Mesh(new THREE.PlaneGeometry(fw2, inch(11) - i * inch(1.6)), flameM);
      fl.position.set(0, fbY + inch(9) - i * inch(0.8), fbD * 0.30 + i * inch(2.4));
      g.add(fl);
    }
    const fl2 = new THREE.Mesh(new THREE.PlaneGeometry((fbW - inch(11)) * 0.5, inch(10)), flameM);
    fl2.rotation.y = HALFPI;
    fl2.position.set(0, fbY + inch(9), fbD * 0.45);
    g.add(fl2);

    if (o.mantel !== false) {
      const mh = o.mantelH === undefined ? ft(4, 6) : o.mantelH;
      const man = boxAt(-w / 2 - inch(2), mh, 0, w + inch(4), inch(4.5), d + inch(5),
        o.mantelMaterial || P.whiteOak, { r: inch(0.2), seg: 3, uv: true });
      g.add(man);
    }
    if (o.flue) {
      const fl3 = boxAt(-inch(9), h, d / 2 - inch(6), inch(18), o.flue, inch(12),
        P.blackMetal, { r: inch(0.1) });
      g.add(fl3);
    }
    return g;
  }

  /* ---------------------------------------------------------------- */
  /* 2.14b  polygonal decking, benches, irregular paving                */
  /* ---------------------------------------------------------------- */

  /**
   * Where a plan polygon crosses the line z = zc, as sorted [x0,x1] spans.
   * Standard even-odd scanline; handles concave outlines (a tree notch) and
   * multiple spans on one line.
   *
   * @param {Array<[number,number]>} poly  plan points [x, z], implicitly closed
   * @param {number} zc
   * @returns {Array<[number,number]>}
   */
  function polySpansX(poly, zc) {
    const xs = [];
    const n = poly.length;
    for (let i = 0; i < n; i++) {
      const a = poly[i], b = poly[(i + 1) % n];
      const z0 = a[1], z1 = b[1];
      if (z0 === z1) continue;
      if ((zc >= z0 && zc < z1) || (zc >= z1 && zc < z0)) {
        xs.push(a[0] + ((zc - z0) / (z1 - z0)) * (b[0] - a[0]));
      }
    }
    xs.sort((p, q) => p - q);
    const out = [];
    for (let i = 0; i + 1 < xs.length; i += 2) out.push([xs[i], xs[i + 1]]);
    return out;
  }

  /** Is [x,z] inside the plan polygon? */
  function pointInPoly(poly, x, z) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    }
    return inside;
  }

  /**
   * Composite / wood decking laid board by board over an arbitrary plan
   * polygon, boards running along +X ('ew') or +Z ('ns').
   *
   * Real decking is NOT one plane with a stripe texture: every board is a
   * separate 1" x 5-1/2" extrusion with a 1/4" gap you can see daylight
   * through, an eased edge that catches its own highlight, and a slightly
   * different cup, tone and height from its neighbours. That, and the fact
   * that a board END lands on the polygon outline instead of running to a
   * rectangle, is most of what makes a deck read as built rather than mapped.
   *
   * @param {object} o
   * @param {Array<[number,number]>} o.poly   plan outline [x, z]
   * @param {number} o.y                      finished deck surface, world Y
   * @param {THREE.Material} o.material
   * @param {'ew'|'ns'} [o.dir='ew']
   * @param {number} [o.boardW=5.5"]  face width
   * @param {number} [o.gap=0.25"]
   * @param {number} [o.thickness=1"]
   * @param {number} [o.cup=0.004]    max per-board tilt, radians
   * @param {number} [o.seed=91]
   * @param {number} [o.phase=0]      shifts where the first board lands
   * @returns {THREE.Group}
   */
  function deckBoards(o = {}) {
    const poly = o.poly;
    const y = o.y === undefined ? 0 : o.y;
    const bw = o.boardW === undefined ? inch(5.5) : o.boardW;
    const gap = o.gap === undefined ? inch(0.25) : o.gap;
    const th = o.thickness === undefined ? inch(1.0) : o.thickness;
    const pitch = bw + gap;
    const R = prng(o.seed === undefined ? 91 : o.seed);
    const ns = o.dir === 'ns';
    const g = G('deck surface, world coordinates');
    g.name = o.name || 'deck:boards';

    // Work in a local frame where the boards always run along +X.
    const P = ns ? poly.map(([x, z]) => [z, -x]) : poly;
    let a0 = Infinity, a1 = -Infinity;
    for (const p of P) { if (p[1] < a0) a0 = p[1]; if (p[1] > a1) a1 = p[1]; }
    const start = Math.floor((a0 - (o.phase || 0)) / pitch) * pitch + (o.phase || 0);

    let i = 0;
    for (let zc = start; zc < a1 + pitch; zc += pitch, i++) {
      const z0 = zc, z1 = zc + bw;
      // union of the spans at both faces so a board that only clips a corner
      // still gets laid
      const spans = [];
      for (const zs of [z0 + 0.002, (z0 + z1) / 2, z1 - 0.002]) {
        for (const s of polySpansX(P, zs)) spans.push(s);
      }
      if (!spans.length) continue;
      spans.sort((p, q) => p[0] - q[0]);
      const merged = [];
      for (const s of spans) {
        const last = merged[merged.length - 1];
        if (last && s[0] <= last[1] + 0.35) last[1] = Math.max(last[1], s[1]);
        else merged.push([s[0], s[1]]);
      }
      for (let k = 0; k < merged.length; k++) {
        const [x0, x1] = merged[k];
        const L = x1 - x0;
        if (L < 0.30) continue;
        const jr = R();
        const b = box(L, th, bw, o.material, { r: inch(0.09), seg: 2, cast: false });
        const cz = (z0 + z1) / 2;
        const lift = (jr - 0.5) * inch(0.05);
        if (ns) b.position.set(-cz, y - th / 2 + lift, (x0 + x1) / 2);
        else b.position.set((x0 + x1) / 2, y - th / 2 + lift, cz);
        if (ns) b.rotation.y = HALFPI;
        // cupping: a board that has been in the weather never sits dead flat
        const cup = (o.cup === undefined ? 0.005 : o.cup) * (R() - 0.5) * 2;
        if (ns) b.rotation.x = cup; else b.rotation.z = cup;
        b.receiveShadow = true;
        applyUV(b, undefined, {
          axes: 'xz',
          size: [L, bw],
          offset: [R() * 0.9, (i % 4) * 0.25 + R() * 0.02],
        });
        g.add(b);
      }
    }
    return g;
  }

  /**
   * Fascia / rim board around a deck polygon, top flush with the surface.
   * `only` selects edges by their outward normal: 'all', or a predicate
   * (a, b) => boolean on the two plan points.
   */
  function deckFascia(o = {}) {
    const poly = o.poly;
    const y = o.y === undefined ? 0 : o.y;
    const drop = o.drop === undefined ? inch(9.5) : o.drop;
    const t = o.thickness === undefined ? inch(0.9) : o.thickness;
    const keep = typeof o.only === 'function' ? o.only : () => true;
    const g = G('deck fascia');
    g.name = o.name || 'deck:fascia';
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      if (!keep(a, b, i)) continue;
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const L = Math.hypot(dx, dz);
      if (L < 0.05) continue;
      // extend a hair past the corner so mitres never open a 0-width slit
      const m = box(L + t * 1.6, drop, t, o.material, { r: inch(0.07), seg: 2 });
      m.position.set((a[0] + b[0]) / 2, y - drop / 2 - inch(0.05), (a[1] + b[1]) / 2);
      m.rotation.y = -Math.atan2(dz, dx);
      applyUV(m, undefined, { axes: 'xy', size: [L, drop] });
      g.add(m);
    }
    return g;
  }

  /**
   * Backless built-in deck bench: two seat boards over a rim apron on plank
   * legs, mitred where the run changes direction. Follows a plan path.
   *
   * @param {object} o
   * @param {Array<[number,number]>} o.path plan centreline of the SEAT
   * @param {number} o.seatY  finished seat top, world Y
   * @param {number} o.deckY  surface the legs land on
   * @param {number} [o.seatW=11.5"] total seat depth (2 boards + gap)
   * @param {number} [o.legSpacing=4.6]
   */
  function deckBench(o = {}) {
    const path = o.path;
    const seatY = o.seatY;
    const deckY = o.deckY === undefined ? seatY - ft(1, 5.5) : o.deckY;
    const m = o.material || P.deck;
    const bw = o.boardW === undefined ? inch(5.5) : o.boardW;
    const gap = o.gap === undefined ? inch(0.25) : o.gap;
    const th = o.thickness === undefined ? inch(1.0) : o.thickness;
    const apronH = o.apronH === undefined ? inch(5.5) : o.apronH;
    const R = prng(o.seed === undefined ? 33 : o.seed);
    const g = G('deck bench');
    g.name = o.name || 'deck:bench';
    const seatW = 2 * bw + gap;

    for (let i = 0; i + 1 < path.length; i++) {
      const a = path[i], b = path[i + 1];
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const L = Math.hypot(dx, dz);
      if (L < 0.2) continue;
      const yaw = -Math.atan2(dz, dx);
      const cx = (a[0] + b[0]) / 2, cz = (a[1] + b[1]) / 2;
      const ext = i === path.length - 2 ? inch(1.5) : 0;   // slight end overrun

      // two seat boards with a real gap between them
      for (const s of [-1, 1]) {
        const sb = box(L + ext, th, bw, m, { r: inch(0.11), seg: 2 });
        sb.position.set(cx, seatY - th / 2, cz);
        sb.rotation.y = yaw;
        sb.translateZ(s * (bw + gap) / 2);
        applyUV(sb, undefined, { axes: 'xz', size: [L, bw], offset: [R(), R()] });
        g.add(sb);
      }
      // apron under the outer edge, set back so the seat overhangs it
      const ap = box(L + ext - inch(0.5), apronH, inch(1.4), m, { r: inch(0.07), seg: 2 });
      ap.position.set(cx, seatY - th - apronH / 2, cz);
      ap.rotation.y = yaw;
      ap.translateZ(seatW / 2 - inch(1.6));
      applyUV(ap, undefined, { axes: 'xy', size: [L, apronH] });
      g.add(ap);
      // and a stretcher on the inner side
      const st = box(L + ext - inch(0.5), inch(3.5), inch(1.4), m, { r: inch(0.07), seg: 2 });
      st.position.set(cx, seatY - th - inch(1.75), cz);
      st.rotation.y = yaw;
      st.translateZ(-seatW / 2 + inch(1.6));
      g.add(st);

      // legs: an outer plank and a return plank, screwed through the apron
      const legs = Math.max(2, Math.round(L / (o.legSpacing === undefined ? 4.6 : o.legSpacing)) + 1);
      const legH = seatY - th - deckY;
      for (let k = 0; k < legs; k++) {
        const t = legs === 1 ? 0.5 : k / (legs - 1);
        const px = a[0] + dx * t, pz = a[1] + dz * t;
        const inset = t < 0.02 ? inch(3) : t > 0.98 ? -inch(3) : 0;
        for (const s of [1, -1]) {
          const w = s > 0 ? inch(1.5) : inch(3.5);
          const d = s > 0 ? inch(5.0) : inch(1.5);
          const lg = box(w, legH, d, m, { r: inch(0.06), seg: 2 });
          lg.position.set(px, deckY + legH / 2, pz);
          lg.rotation.y = yaw;
          lg.translateX(inset + (s > 0 ? 0 : inch(1.4)));
          lg.translateZ(s > 0 ? seatW / 2 - inch(3.4) : seatW / 2 - inch(1.4));
          g.add(lg);
        }
        // two screw heads in the apron face over every leg, very slightly proud
        for (const dy of [inch(1.5), inch(4.2)]) {
          const gg = new THREE.Group();
          gg.position.set(px, seatY - th - dy, pz);
          gg.rotation.y = yaw;
          const sc = cyl(inch(0.15), inch(0.15), inch(0.05), o.screwMaterial || P.iron, 10);
          sc.rotation.x = HALFPI;
          sc.castShadow = false;
          gg.add(sc);
          gg.translateX(inset);
          gg.translateZ(seatW / 2 - inch(1.55));
          g.add(gg);
        }
      }
    }
    return g;
  }

  /**
   * Irregular ("crazy") flagstone paving: a jittered Voronoi tessellation of a
   * plan polygon, every cell an individually extruded slab with a chamfered
   * arris, a sand joint between it and its neighbours, and a fraction of a
   * degree of settle. This is what an irregular bluestone patio actually is;
   * a textured plane is the loudest hardscape tell there is.
   *
   * @param {object} o
   * @param {Array<[number,number]>} o.poly   plan outline
   * @param {number} o.y                      top surface, world Y
   * @param {THREE.Material} o.material
   * @param {number} [o.cell=2.6]   mean slab size, feet
   * @param {number} [o.joint=0.06] sand joint width
   * @param {number} [o.thickness=0.16]
   * @param {number} [o.settle=0.006] max per-slab tilt, radians
   * @param {function} [o.skip]     (x, z) => true to drop a slab
   * @param {number} [o.seed=7]
   * @returns {THREE.Mesh}  one merged mesh
   */
  function crazyPaving(o = {}) {
    const poly = o.poly;
    const y = o.y === undefined ? 0 : o.y;
    const cell = o.cell === undefined ? 2.6 : o.cell;
    const joint = o.joint === undefined ? 0.06 : o.joint;
    const th = o.thickness === undefined ? 0.16 : o.thickness;
    const settle = o.settle === undefined ? 0.006 : o.settle;
    const R = prng(o.seed === undefined ? 7 : o.seed);

    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const [x, z] of poly) {
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
    // jittered grid of sites — a pure random set makes slivers
    const sites = [];
    for (let x = x0 - cell; x < x1 + cell; x += cell) {
      for (let z = z0 - cell; z < z1 + cell; z += cell) {
        sites.push([x + (R() - 0.3) * cell * 0.72, z + (R() - 0.3) * cell * 0.72]);
      }
    }
    const geos = [];
    for (let i = 0; i < sites.length; i++) {
      const s = sites[i];
      if (!pointInPoly(poly, s[0], s[1])) continue;
      if (o.skip && o.skip(s[0], s[1])) continue;
      // clip the outline by the perpendicular bisector against every near site
      let cellPoly = poly;
      for (let j = 0; j < sites.length; j++) {
        if (j === i) continue;
        const t = sites[j];
        const dx = t[0] - s[0], dz = t[1] - s[1];
        const d2 = dx * dx + dz * dz;
        if (d2 > cell * cell * 9) continue;
        // keep the half-plane nearer to s
        const mx = (s[0] + t[0]) / 2, mz = (s[1] + t[1]) / 2;
        cellPoly = clipHalfPlane(cellPoly, mx, mz, -dx, -dz);
        if (cellPoly.length < 3) break;
      }
      if (cellPoly.length < 3) continue;
      // inset for the sand joint
      let cx = 0, cz = 0;
      for (const p of cellPoly) { cx += p[0]; cz += p[1]; }
      cx /= cellPoly.length; cz /= cellPoly.length;
      const inner = [];
      for (const p of cellPoly) {
        const dx = p[0] - cx, dz = p[1] - cz;
        const d = Math.hypot(dx, dz) || 1;
        const k = Math.max(0.2, (d - joint / 2) / d);
        inner.push([cx + dx * k, cz + dz * k]);
      }
      let area = 0;
      for (let k = 0, l = inner.length - 1; k < inner.length; l = k++) {
        area += (inner[l][0] * inner[k][1] - inner[k][0] * inner[l][1]);
      }
      if (Math.abs(area / 2) < 0.35) continue;      // sliver

      const shape = new THREE.Shape();
      shape.moveTo(inner[0][0], inner[0][1]);
      for (let k = 1; k < inner.length; k++) shape.lineTo(inner[k][0], inner[k][1]);
      shape.closePath();
      const geo = new THREE.ExtrudeGeometry(shape, {
        depth: th, bevelEnabled: true, bevelSize: 0.022, bevelThickness: 0.018,
        bevelSegments: 1, curveSegments: 1,
      });
      // shape XY -> world XZ, top face up
      geo.rotateX(HALFPI);
      geo.translate(0, y + (R() - 0.5) * 0.014, 0);
      // no two flags are co-planar
      geo.translate(-cx, -y, -cz);
      geo.rotateX((R() - 0.5) * settle * 2);
      geo.rotateZ((R() - 0.5) * settle * 2);
      geo.translate(cx, y, cz);
      geo.computeVertexNormals();
      if (!geo.attributes.uv1) geo.setAttribute('uv1', geo.attributes.uv);
      geos.push(geo.toNonIndexed());
      geo.dispose();
    }
    if (!geos.length) return new THREE.Group();
    const mesh = new THREE.Mesh(mergeGeometries(geos), o.material);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.name = o.name || 'paving';
    return mesh;
  }

  /** Sutherland–Hodgman clip of a plan polygon by the half-plane n·(p-m) >= 0. */
  function clipHalfPlane(poly, mx, mz, nx, nz) {
    const out = [];
    const side = (p) => (p[0] - mx) * nx + (p[1] - mz) * nz;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const sa = side(a), sb = side(b);
      if (sa >= 0) out.push(a);
      if ((sa >= 0) !== (sb >= 0)) {
        const t = sa / (sa - sb);
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
    return out;
  }

  /**
   * Single course of rounded river cobbles along a plan path — the edging that
   * separates every mulch bed in this yard from the lawn.
   */
  function cobbleEdge(o = {}) {
    const path = o.path;
    const y = o.y === undefined ? 0 : o.y;
    const r0 = o.r === undefined ? 0.33 : o.r;
    const R = prng(o.seed === undefined ? 17 : o.seed);
    const g = G('cobble edging');
    g.name = o.name || 'cobbleEdge';
    const geos = [];
    for (let i = 0; i + 1 < path.length; i++) {
      const a = path[i], b = path[i + 1];
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const L = Math.hypot(dx, dz);
      const n = Math.max(1, Math.round(L / (r0 * 1.85)));
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        const rr = r0 * (0.72 + R() * 0.62);
        const px = a[0] + dx * t + (R() - 0.5) * r0 * 0.5;
        const pz = a[1] + dz * t + (R() - 0.5) * r0 * 0.5;
        const geo = new THREE.IcosahedronGeometry(rr, 1);
        const pos = geo.attributes.position;
        for (let v = 0; v < pos.count; v++) {
          const s = 0.90 + R() * 0.2;
          pos.setXYZ(v, pos.getX(v) * s, pos.getY(v) * s, pos.getZ(v) * s);
        }
        geo.scale(1.25, 0.78, 1.0);
        geo.rotateY(R() * TAU);
        geo.rotateX((R() - 0.5) * 0.4);
        geo.translate(px, y + rr * 0.30, pz);
        geo.computeVertexNormals();
        const nonIdx = geo.toNonIndexed();
        if (!nonIdx.attributes.uv) {
          const c = nonIdx.attributes.position.count;
          nonIdx.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(c * 2), 2));
        }
        nonIdx.setAttribute('uv1', nonIdx.attributes.uv);
        geos.push(nonIdx);
        geo.dispose();
      }
    }
    if (!geos.length) return g;
    const m = new THREE.Mesh(mergeGeometries(geos), o.material);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    return g;
  }

  /**
   * Deck framing + decking.
   * @anchor bottom CENTRE of the deck footprint in plan, at grade (y = 0);
   *         the deck surface ends up at +h.
   */
  function deckFrame(o = {}) {
    const w = o.w === undefined ? 16 : o.w;
    const d = o.d === undefined ? 12 : o.d;
    const h = o.h === undefined ? ft(2, 6) : o.h;
    const m = o.material || P.deck;
    const fm = o.frameMaterial || local('deckFrame', null, { color: 0x6b6257, roughness: 0.85 });
    const g = G('bottom centre of the deck footprint at grade', [w, h, d]);
    const bt = inch(1.25);
    const surf = box(w, bt, d, m, { r: inch(0.06), uv: true });
    surf.position.y = h - bt / 2;
    g.add(surf);
    const rim = inch(9.25);
    for (const s of [-1, 1]) {
      const r1 = box(w, rim, inch(1.5), fm, { r: inch(0.04) });
      r1.position.set(0, h - bt - rim / 2, s * (d / 2 - inch(0.75)));
      g.add(r1);
      const r2 = box(inch(1.5), rim, d, fm, { r: inch(0.04) });
      r2.position.set(s * (w / 2 - inch(0.75)), h - bt - rim / 2, 0);
      g.add(r2);
    }
    const posts = o.posts === undefined ? 4 : o.posts;
    for (let i = 0; i < posts; i++) {
      const x = -w / 2 + inch(8) + ((w - inch(16)) * i) / Math.max(1, posts - 1);
      const p = box(inch(5.5), h - bt - rim, inch(5.5), fm, { r: inch(0.06) });
      p.position.set(x, (h - bt - rim) / 2, d / 2 - inch(4));
      g.add(p);
    }
    return g;
  }

  /**
   * Deck railing: square posts, top and bottom rails, black round balusters.
   * @anchor start of the run at the deck surface (y = 0), running +X.
   */
  function deckRailing(o = {}) {
    const L = o.length === undefined ? 12 : o.length;
    const H = o.height === undefined ? ft(3, 0) : o.height;
    const m = o.material || local('deckRail', null, { color: 0x2f3234, roughness: 0.5, metalness: 0.3 });
    const g = G('start of the run at the deck surface, running +X', [L, H, inch(4)]);
    const top = box(L, inch(2.0), inch(3.4), m, { r: inch(0.12), seg: 2 });
    top.position.set(L / 2, H - inch(1.0), 0);
    g.add(top);
    const bot = box(L, inch(1.6), inch(2.6), m, { r: inch(0.1) });
    bot.position.set(L / 2, inch(3.5), 0);
    g.add(bot);
    const n = Math.max(2, Math.round(L / inch(4.5)));
    for (let i = 0; i < n; i++) {
      const b2 = cyl(inch(0.36), inch(0.36), H - inch(6), m, 10);
      b2.position.set((L * (i + 0.5)) / n, inch(4.3) + (H - inch(6)) / 2, 0);
      g.add(b2);
    }
    for (const x of [0, L]) {
      const p = box(inch(4), H + inch(1.5), inch(4), m, { r: inch(0.1), seg: 2 });
      p.position.set(x, (H + inch(1.5)) / 2 - inch(2), 0);
      g.add(p);
    }
    return g;
  }

  /**
   * Stone fire-pit ring.
   * @anchor centre of the ring at grade (y = 0).
   */
  function stoneFirePitRing(o = {}) {
    const d = o.d === undefined ? ft(3, 6) : o.d;
    const h = o.h === undefined ? inch(14) : o.h;
    const m = o.material || P.stone;
    const g = G('centre of the ring at grade', [d, h, d]);
    const courses = Math.max(2, Math.round(h / inch(4)));
    const ch = h / courses;
    for (let c = 0; c < courses; c++) {
      const n = Math.max(10, Math.round((Math.PI * d) / inch(9)));
      const off = (c % 2) * (Math.PI / n);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + off;
        const bw = (Math.PI * d) / n * 0.94;
        const s = box(bw, ch * 0.92, inch(5.5), m, { r: inch(0.09), uv: true });
        s.position.set(Math.cos(a) * (d / 2 - inch(2.75)), ch * (c + 0.5),
          Math.sin(a) * (d / 2 - inch(2.75)));
        s.rotation.y = -a + HALFPI;
        g.add(s);
      }
    }
    const bowl = new THREE.Mesh(new THREE.CircleGeometry(d / 2 - inch(5.5), 40),
      local('firePitAsh', null, { color: 0x2a2622, roughness: 0.95 }));
    bowl.rotation.x = -HALFPI;
    bowl.position.y = inch(1.5);
    bowl.receiveShadow = true;
    g.add(bowl);
    return g;
  }

  /**
   * Stacked-stone planter / seat wall swept along a plan path.
   * @anchor the path at grade (y = 0).
   */
  function stackedStonePlanterWall(o = {}) {
    const path = o.path || [[-6, 0], [6, 0]];
    const h = o.h === undefined ? inch(20) : o.h;
    const t = o.thickness === undefined ? inch(14) : o.thickness;
    const m = o.material || P.stone;
    const g = G('plan path at grade');
    const prof = [[-t / 2, 0], [t / 2, 0], [t / 2, h - inch(2.5)], [-t / 2, h - inch(2.5)]];
    g.add(sweptMesh(path, prof, m, { closed: !!o.closed }));
    const capProf = [[-t / 2 - inch(1.2), h - inch(2.5)], [t / 2 + inch(1.2), h - inch(2.5)],
      [t / 2 + inch(1.2), h], [-t / 2 - inch(1.2), h]];
    g.add(sweptMesh(path, capProf, o.capMaterial || P.bluestone, { closed: !!o.closed }));
    return g;
  }

  /**
   * Sunroom post-and-beam window wall: dark stained timber frame with glazed
   * bays.
   * @anchor bottom centre of the wall, wall plane z = 0, interior +Z.
   */
  function postAndBeamWall(o = {}) {
    const w = o.w === undefined ? 18 : o.w;
    const h = o.h === undefined ? 9 : o.h;
    const bays = o.bays === undefined ? 4 : o.bays;
    const m = o.material || P.timber;
    const post = o.post === undefined ? inch(5.5) : o.post;
    const g = G('bottom centre of the wall, wall plane z = 0', [w, h, post]);
    for (let i = 0; i <= bays; i++) {
      const x = -w / 2 + (w * i) / bays;
      const p = box(post, h, post, m, { r: inch(0.09), seg: 2, uv: true });
      p.position.set(x, h / 2, 0);
      g.add(p);
    }
    for (const y of [h - post / 2, post / 2]) {
      const b2 = box(w, post, post, m, { r: inch(0.09), seg: 2, uv: true });
      b2.position.set(0, y, 0);
      g.add(b2);
    }
    if (o.header !== false) {
      const hd = box(w + inch(6), inch(9), post + inch(2), m, { r: inch(0.09), seg: 2, uv: true });
      hd.position.set(0, h - inch(4.5), 0);
      g.add(hd);
    }
    const bw = w / bays - post;
    const bh = h - 2 * post - inch(9);
    for (let i = 0; i < bays; i++) {
      const x = -w / 2 + (w * (i + 0.5)) / bays;
      const gl = box(bw, bh, inch(0.6), P.glass, { r: inch(0.04), cast: false });
      gl.position.set(x, post + bh / 2, -inch(0.6));
      g.add(gl);
      if (o.transom) {
        const tr = box(bw, inch(7), inch(0.6), P.glass, { r: inch(0.04), cast: false });
        tr.position.set(x, h - post - inch(13), -inch(0.6));
        g.add(tr);
      }
    }
    return g;
  }

  /* ---------------------------------------------------------------- */
  /* 2.15  furniture                                                    */
  /* ---------------------------------------------------------------- */
  /* NOTE: the house is VACANT in every listing photo.  These exist for the
     interactive walkthrough and for staged variants; rooms matched against a
     photo must NOT place them. */

  /** Upholstered cushion with a soft edge and a seam. */
  function cushion(w, h, d, m, r = inch(1.6)) {
    return box(w, h, d, m, { r, seg: 3, uv: true });
  }

  /**
   * Sofa.
   * @anchor bottom CENTRE of the sofa footprint in plan; the seat faces +Z.
   */
  function sofa(o = {}) {
    const w = o.w === undefined ? ft(7, 0) : o.w;
    const d = o.d === undefined ? ft(3, 0) : o.d;
    const h = o.h === undefined ? ft(2, 8) : o.h;
    const m = o.material || P.linen;
    const legM = o.legMaterial || P.whiteOak;
    const g = G('bottom centre of the footprint, seat facing +Z', [w, h, d]);
    const legH = inch(5.5), seatY = inch(16);
    const base = box(w - inch(3), seatY - legH, d - inch(2), m, { r: inch(0.8), seg: 3, uv: true });
    base.position.y = legH + (seatY - legH) / 2;
    g.add(base);
    const backT = inch(7);
    const back = cushion(w - inch(3), h - seatY, backT, m);
    back.position.set(0, seatY + (h - seatY) / 2, -d / 2 + backT / 2 + inch(1));
    g.add(back);
    const arms = o.arms === undefined ? 'both' : o.arms;
    for (const s of [-1, 1]) {
      if (arms === 'none') break;
      if (arms === 'left' && s > 0) continue;
      if (arms === 'right' && s < 0) continue;
      const arm = cushion(inch(7), h - seatY - inch(4), d - inch(2), m);
      arm.position.set(s * (w / 2 - inch(3.5)), seatY + (h - seatY - inch(4)) / 2, 0);
      g.add(arm);
    }
    const seats = o.seats === undefined ? Math.max(2, Math.round(w / ft(2, 4))) : o.seats;
    const sw = (w - inch(14)) / seats;
    for (let i = 0; i < seats; i++) {
      const c = cushion(sw - inch(0.5), inch(5.5), d - backT - inch(4), m);
      c.position.set(-w / 2 + inch(7) + sw * (i + 0.5), seatY + inch(2.6),
        (backT + inch(4)) / 2 - inch(1));
      g.add(c);
      const bc = cushion(sw - inch(0.5), h - seatY - inch(5), inch(5), m);
      bc.position.set(c.position.x, seatY + inch(5) + (h - seatY - inch(5)) / 2,
        -d / 2 + backT + inch(3.5));
      g.add(bc);
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const leg = cyl(inch(0.9), inch(0.6), legH, legM, 12);
      leg.position.set(sx * (w / 2 - inch(4)), legH / 2, sz * (d / 2 - inch(4)));
      g.add(leg);
    }
    return g;
  }

  /**
   * L-shaped sectional (sofa + chaise return on `side`).
   * @anchor bottom CENTRE of the main run's footprint; seat faces +Z.
   */
  function sectional(o = {}) {
    const w = o.w === undefined ? ft(9, 0) : o.w;
    const d = o.d === undefined ? ft(3, 2) : o.d;
    const chaise = o.chaise === undefined ? ft(5, 6) : o.chaise;
    const side = o.side === 'left' ? -1 : 1;
    const g = G('bottom centre of the main run footprint, seat facing +Z',
      [w, ft(2, 8), d + chaise]);
    const main = sofa({
      w, d, material: o.material, h: o.h, arms: side > 0 ? 'left' : 'right',
    });
    g.add(main);
    const ret = sofa({
      w: chaise, d, material: o.material, h: o.h, seats: 2,
      arms: side > 0 ? 'left' : 'right',
    });
    // rotate so the return's seat faces inward, then butt it to the main run
    ret.rotation.y = -side * HALFPI;
    ret.position.set(side * (w / 2 - d / 2), 0, d / 2 + chaise / 2 - inch(1));
    g.add(ret);
    return g;
  }

  /**
   * Armchair.
   * @anchor bottom CENTRE of the footprint; seat faces +Z.
   */
  function armchair(o = {}) {
    return sofa(Object.assign({ w: ft(2, 10), d: ft(2, 10), seats: 1 }, o));
  }

  /**
   * Coffee table.
   * @anchor bottom CENTRE of the footprint.
   */
  function coffeeTable(o = {}) {
    const w = o.w === undefined ? ft(4, 0) : o.w;
    const d = o.d === undefined ? ft(2, 2) : o.d;
    const h = o.h === undefined ? inch(17) : o.h;
    const m = o.material || P.whiteOak;
    const g = G('bottom centre of the footprint', [w, h, d]);
    const top = box(w, inch(1.5), d, m, { r: inch(0.12), seg: 2, uv: true });
    top.position.y = h - inch(0.75);
    g.add(top);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const leg = box(inch(2.2), h - inch(1.5), inch(2.2), m, { r: inch(0.1), uv: true });
      leg.position.set(sx * (w / 2 - inch(3)), (h - inch(1.5)) / 2, sz * (d / 2 - inch(3)));
      g.add(leg);
    }
    if (o.shelf !== false) {
      const sh = box(w - inch(8), inch(0.9), d - inch(6), m, { r: inch(0.09), uv: true });
      sh.position.y = inch(5.5);
      g.add(sh);
    }
    return g;
  }

  /**
   * Side / end table.
   * @anchor bottom CENTRE of the footprint.
   */
  function sideTable(o = {}) {
    const w = o.w === undefined ? ft(1, 8) : o.w;
    const h = o.h === undefined ? ft(2, 0) : o.h;
    const m = o.material || P.whiteOak;
    const g = G('bottom centre of the footprint', [w, h, w]);
    const top = box(w, inch(1.3), w, m, { r: inch(0.12), seg: 2, uv: true });
    top.position.y = h - inch(0.65);
    g.add(top);
    const post = cyl(inch(1.5), inch(1.5), h - inch(1.3), m, 16);
    post.position.y = (h - inch(1.3)) / 2;
    g.add(post);
    const base = cyl(w * 0.34, w * 0.36, inch(1.2), m, 24);
    base.position.y = inch(0.6);
    g.add(base);
    return g;
  }

  /**
   * Dining table sized from a seat count.
   * @anchor bottom CENTRE of the footprint.
   */
  function diningTable(o = {}) {
    const seats = o.seats === undefined ? 6 : o.seats;
    const w = o.w === undefined ? Math.max(ft(4, 0), (Math.ceil(seats / 2)) * ft(2, 2)) : o.w;
    const d = o.d === undefined ? ft(3, 4) : o.d;
    const h = o.h === undefined ? inch(30) : o.h;
    const m = o.material || P.whiteOak;
    const g = G('bottom centre of the footprint', [w, h, d]);
    const top = box(w, inch(1.6), d, m, { r: inch(0.14), seg: 3, uv: true });
    top.position.y = h - inch(0.8);
    g.add(top);
    const apronH = inch(3.2);
    for (const s of [-1, 1]) {
      const a1 = box(w - inch(8), apronH, inch(1.1), m, { r: inch(0.06), uv: true });
      a1.position.set(0, h - inch(1.6) - apronH / 2, s * (d / 2 - inch(3)));
      g.add(a1);
      const a2 = box(inch(1.1), apronH, d - inch(8), m, { r: inch(0.06), uv: true });
      a2.position.set(s * (w / 2 - inch(3)), h - inch(1.6) - apronH / 2, 0);
      g.add(a2);
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const leg = box(inch(3.0), h - inch(1.6), inch(3.0), m, { r: inch(0.1), seg: 2, uv: true });
      leg.position.set(sx * (w / 2 - inch(3.5)), (h - inch(1.6)) / 2, sz * (d / 2 - inch(3.5)));
      g.add(leg);
    }
    return g;
  }

  /**
   * Dining chair.
   * @anchor bottom CENTRE of the footprint; the seat back is at -Z.
   */
  function diningChair(o = {}) {
    const w = o.w === undefined ? inch(19) : o.w;
    const d = o.d === undefined ? inch(20) : o.d;
    const sh = o.seatH === undefined ? inch(18) : o.seatH;
    const bh = o.h === undefined ? inch(34) : o.h;
    const m = o.material || P.whiteOak;
    const up = o.upholstery || P.linen;
    const g = G('bottom centre of the footprint, back at -Z', [w, bh, d]);
    const seat = box(w, inch(2.4), d, up, { r: inch(0.5), seg: 3, uv: true });
    seat.position.y = sh - inch(1.2);
    g.add(seat);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const legH = sz < 0 ? bh : sh - inch(2.4);
      const leg = box(inch(1.5), legH, inch(1.5), m, { r: inch(0.09), uv: true });
      leg.position.set(sx * (w / 2 - inch(1.2)), legH / 2, sz * (d / 2 - inch(1.2)));
      g.add(leg);
    }
    const back = box(w - inch(2.4), bh - sh - inch(4), inch(1.6), up, { r: inch(0.4), seg: 3, uv: true });
    back.position.set(0, sh + (bh - sh - inch(4)) / 2 + inch(2), -d / 2 + inch(1.4));
    g.add(back);
    return g;
  }

  /**
   * Bed.
   * @anchor bottom CENTRE of the bed footprint; the headboard is at -Z.
   * @param {object} [o] {size:'twin'|'full'|'queen'|'king', material, linens}
   */
  function bed(o = {}) {
    const SIZES = {
      twin: [ft(3, 3), ft(6, 6)], full: [ft(4, 6), ft(6, 6)],
      queen: [ft(5, 2), ft(6, 10)], king: [ft(6, 4), ft(6, 10)],
    };
    const [w, l] = SIZES[o.size] || SIZES.queen;
    const m = o.material || P.whiteOak;
    const lin = o.linens || local('bedLinen', null, {
      color: 0xf2efe8, roughness: 0.85, sheen: 0.5, sheenRoughness: 0.7,
    });
    const g = G('bottom centre of the bed footprint, headboard at -Z', [w, ft(3, 6), l]);
    const frameH = inch(11);
    const rail = box(w + inch(3), frameH, l + inch(3), m, { r: inch(0.12), seg: 2, uv: true });
    rail.position.y = inch(4) + frameH / 2;
    g.add(rail);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const leg = box(inch(3), inch(4.5), inch(3), m, { r: inch(0.08), uv: true });
      leg.position.set(sx * (w / 2 - inch(1)), inch(2.25), sz * (l / 2 - inch(1)));
      g.add(leg);
    }
    const mat2 = box(w, inch(11), l, lin, { r: inch(1.2), seg: 3, uv: true });
    mat2.position.y = inch(4) + frameH + inch(5.5);
    g.add(mat2);
    const duvet = box(w + inch(4), inch(3.5), l * 0.74, lin, { r: inch(1.6), seg: 3, uv: true });
    duvet.position.set(0, inch(4) + frameH + inch(12), l * 0.13);
    g.add(duvet);
    for (const s of [-1, 1]) {
      const pil = box(w * 0.42, inch(5.5), inch(15), lin, { r: inch(2.4), seg: 4, uv: true });
      pil.position.set(s * w * 0.23, inch(4) + frameH + inch(13), -l / 2 + inch(11));
      g.add(pil);
    }
    const hb = box(w + inch(4), ft(1, 10), inch(2.4), m, { r: inch(0.12), seg: 2, uv: true });
    hb.position.set(0, inch(4) + frameH + ft(0, 11), -l / 2 - inch(1.2));
    g.add(hb);
    return g;
  }

  /**
   * Nightstand.
   * @anchor bottom centre of the BACK, on the floor.
   */
  function nightstand(o = {}) {
    const w = o.w === undefined ? ft(1, 10) : o.w;
    const d = o.d === undefined ? ft(1, 4) : o.d;
    const h = o.h === undefined ? ft(2, 0) : o.h;
    const g = G('bottom centre of the back, on the floor', [w, h, d]);
    const cab = baseCabinet({
      w, d, h, drawers: 2, doors: 0, style: o.style || 'shaker',
      material: o.material || P.whiteOak, pulls: o.pulls || 'brassBar', toeKick: false,
    });
    g.add(cab);
    for (const sx of [-1, 1]) for (const sz of [0.15, 0.85]) {
      const leg = box(inch(1.6), inch(5), inch(1.6), o.material || P.whiteOak, { r: inch(0.08) });
      leg.position.set(sx * (w / 2 - inch(1.6)), inch(2.5), d * sz);
      g.add(leg);
    }
    const top = box(w + inch(1), inch(1.2), d + inch(1), o.material || P.whiteOak,
      { r: inch(0.1), seg: 2, uv: true });
    top.position.set(0, h + inch(0.6), d / 2);
    g.add(top);
    return g;
  }

  /**
   * Dresser.
   * @anchor bottom centre of the BACK, on the floor.
   */
  function dresser(o = {}) {
    const w = o.w === undefined ? ft(5, 0) : o.w;
    const d = o.d === undefined ? ft(1, 7) : o.d;
    const h = o.h === undefined ? ft(2, 8) : o.h;
    const m = o.material || P.whiteOak;
    const g = G('bottom centre of the back, on the floor', [w, h, d]);
    const cab = baseCabinet({
      w, d, h: h - inch(5), drawers: o.drawers === undefined ? 3 : o.drawers, doors: 0,
      style: o.style || 'shaker', material: m, pulls: o.pulls || 'brassBar', toeKick: false,
    });
    cab.position.y = inch(5);
    g.add(cab);
    for (const sx of [-1, 1]) for (const sz of [0.12, 0.88]) {
      const leg = box(inch(2), inch(5), inch(2), m, { r: inch(0.09) });
      leg.position.set(sx * (w / 2 - inch(2)), inch(2.5), d * sz);
      g.add(leg);
    }
    const top = box(w + inch(1), inch(1.4), d + inch(1), m, { r: inch(0.11), seg: 2, uv: true });
    top.position.set(0, h - inch(0.7), d / 2);
    g.add(top);
    return g;
  }

  /**
   * Wall-mounted flat-panel TV.
   * @anchor centre of the screen on the WALL face (z = 0), screen toward +Z.
   */
  function tvWallMounted(o = {}) {
    const diag = o.diag === undefined ? ft(5, 5) : o.diag;
    const w = diag * 0.872, h = diag * 0.49;
    const g = G('centre of the screen on the wall face', [w, h, inch(3)]);
    const bez = box(w, h, inch(1.5), P.blackMetal, { r: inch(0.08), seg: 2 });
    bez.position.z = inch(2.4);
    g.add(bez);
    const scr = box(w - inch(0.6), h - inch(0.6), inch(0.2),
      local('tvScreen', null, {
        color: 0x0a0b0d, roughness: 0.10, metalness: 0.2,
        clearcoat: 1.0, clearcoatRoughness: 0.02, envMapIntensity: 0.8,
      }), { r: inch(0.03) });
    scr.position.z = inch(3.2);
    g.add(scr);
    const mount = box(w * 0.3, h * 0.3, inch(1.8), P.blackMetal, { r: inch(0.06) });
    mount.position.z = inch(0.9);
    g.add(mount);
    return g;
  }

  /**
   * Area rug with a pile edge.
   * @anchor CENTRE of the rug in plan, on the floor (y = 0).
   */
  function areaRug(o = {}) {
    const w = o.w === undefined ? ft(8, 0) : o.w;
    const d = o.d === undefined ? ft(10, 0) : o.d;
    const pile = o.pile === undefined ? inch(0.55) : o.pile;
    const m = o.material || P.carpet;
    const g = G('centre of the rug in plan, on the floor', [w, pile, d]);
    const r = box(w, pile, d, m, { r: pile * 0.45, seg: 2, uv: true, cast: false });
    r.position.y = pile / 2;
    g.add(r);
    if (o.border !== false) {
      const b2 = box(w - inch(6), pile * 0.35, d - inch(6), m, { r: inch(0.05), uv: true, cast: false });
      b2.position.y = pile + pile * 0.1;
      g.add(b2);
    }
    return g;
  }

  /**
   * Open bookshelf.
   * @anchor bottom centre of the BACK, on the floor.
   */
  function bookshelf(o = {}) {
    const w = o.w === undefined ? ft(3, 0) : o.w;
    const d = o.d === undefined ? ft(1, 0) : o.d;
    const h = o.h === undefined ? ft(6, 0) : o.h;
    const shelves = o.shelves === undefined ? 5 : o.shelves;
    const m = o.material || P.whiteOak;
    const g = G('bottom centre of the back, on the floor', [w, h, d]);
    const t = inch(0.85);
    for (const s of [-1, 1]) {
      const side = box(t, h, d, m, { r: inch(0.07), uv: true });
      side.position.set(s * (w / 2 - t / 2), h / 2, d / 2);
      g.add(side);
    }
    const back = box(w - 2 * t, h, inch(0.35), m, { r: inch(0.03), uv: true });
    back.position.set(0, h / 2, inch(0.18));
    g.add(back);
    for (let i = 0; i <= shelves; i++) {
      const y = inch(3) + ((h - inch(4)) * i) / shelves;
      const sh = box(w - 2 * t, t, d - inch(0.4), m, { r: inch(0.06), uv: true });
      sh.position.set(0, y, d / 2 + inch(0.2));
      g.add(sh);
    }
    return g;
  }

  /**
   * Counter-height bar stool.
   * @anchor bottom CENTRE of the footprint.
   */
  function barStool(o = {}) {
    const h = o.h === undefined ? inch(26) : o.h;
    const w = o.w === undefined ? inch(16) : o.w;
    const m = o.material || P.whiteOak;
    const met = o.metal || P.blackMetal;
    const g = G('bottom centre of the footprint', [w, h + inch(14), w]);
    const seat = box(w, inch(1.6), w * 0.92, m, { r: inch(0.5), seg: 3, uv: true });
    seat.position.y = h;
    g.add(seat);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const leg = cyl(inch(0.5), inch(0.55), h, met, 12);
      leg.position.set(sx * (w / 2 - inch(1.4)), h / 2, sz * (w / 2 - inch(1.4)));
      leg.rotation.z = -sx * deg(3.5);
      leg.rotation.x = sz * deg(3.5);
      g.add(leg);
    }
    const ring = torus(w * 0.42, inch(0.32), met, 28, 8);
    ring.rotation.x = HALFPI;
    ring.position.y = inch(8);
    g.add(ring);
    if (o.back !== false) {
      const bk = box(w * 0.9, inch(11), inch(1.2), m, { r: inch(0.4), seg: 3, uv: true });
      bk.position.set(0, h + inch(7), -w * 0.42);
      g.add(bk);
    }
    return g;
  }

  /**
   * Potted plant (a simple ficus-like massing, low poly on purpose).
   * @anchor bottom CENTRE of the pot, on the floor.
   */
  function plantPotted(o = {}) {
    const potD = o.potD === undefined ? ft(1, 4) : o.potD;
    const h = o.h === undefined ? ft(4, 6) : o.h;
    const g = G('bottom centre of the pot, on the floor', [potD * 2, h, potD * 2]);
    const potM = o.potMaterial || local('terracotta', null, {
      color: 0xb1b0aa, roughness: 0.62, metalness: 0.0,
    });
    const pot = new THREE.Mesh(
      new THREE.CylinderGeometry(potD / 2, potD * 0.38, potD * 0.92, 32), potM);
    pot.position.y = potD * 0.46;
    pot.castShadow = true; pot.receiveShadow = true;
    g.add(pot);
    const soil = new THREE.Mesh(new THREE.CircleGeometry(potD / 2 - inch(1), 28),
      local('soil', null, { color: 0x2c2620, roughness: 0.95 }));
    soil.rotation.x = -HALFPI;
    soil.position.y = potD * 0.9;
    g.add(soil);
    const leafM = o.leafMaterial || local('foliage', null, {
      color: 0x4e7042, roughness: 0.72, sheen: 0.3, sheenColor: 0x9dbb63,
      side: THREE.DoubleSide,
    });
    const trunk = cyl(inch(0.9), inch(1.3), h - potD, local('plantTrunk', null,
      { color: 0x6d5c48, roughness: 0.85 }), 10);
    trunk.position.y = potD * 0.9 + (h - potD) / 2;
    g.add(trunk);
    const clusters = o.clusters === undefined ? 26 : o.clusters;
    for (let i = 0; i < clusters; i++) {
      const t = i / clusters;
      const a = t * TAU * 3.3;
      const rr = potD * (0.5 + 0.9 * Math.sin(t * Math.PI));
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(potD * 0.30, 10, 7), leafM);
      leaf.scale.set(1, 0.42, 1.25);
      leaf.position.set(Math.cos(a) * rr, potD * 0.9 + (h - potD) * (0.35 + 0.6 * t),
        Math.sin(a) * rr);
      leaf.rotation.set(deg(-20 + 40 * t), a, 0);
      leaf.castShadow = true; leaf.receiveShadow = true;
      g.add(leaf);
    }
    return g;
  }

  /**
   * Towel bar.
   * @anchor centre of the bar on the WALL face (z = 0).
   */
  function towelBar(o = {}) {
    const L = o.length === undefined ? ft(2, 0) : o.length;
    const fin = finishMat(o.finish || 'chrome');
    const g = G('centre of the bar on the wall face', [L, inch(3), inch(4)]);
    for (const s of [-1, 1]) {
      const post = cyl(inch(0.9), inch(0.75), inch(2.6), fin, 16);
      post.rotation.x = HALFPI;
      post.position.set(s * (L / 2 - inch(0.4)), 0, inch(1.3));
      g.add(post);
    }
    const bar = cyl(inch(0.35), inch(0.35), L - inch(0.8), fin, 16);
    bar.rotation.z = HALFPI;
    bar.position.z = inch(2.6);
    g.add(bar);
    if (o.towel) {
      const tw = box(L * 0.55, ft(1, 6), inch(1.1), o.towelMaterial || P.linen,
        { r: inch(0.3), seg: 2, uv: true });
      tw.position.set(0, -ft(0, 9), inch(2.6));
      g.add(tw);
    }
    return g;
  }

  /**
   * Framed art.
   * @anchor centre of the frame on the WALL face (z = 0).
   */
  function artFramed(o = {}) {
    const w = o.w === undefined ? ft(2, 6) : o.w;
    const h = o.h === undefined ? ft(3, 4) : o.h;
    const fw = o.frameWidth === undefined ? inch(1.6) : o.frameWidth;
    const fm = o.frameMaterial || P.blackMetal;
    const g = G('centre of the frame on the wall face', [w, h, inch(2)]);
    for (const s of [-1, 1]) {
      const v = box(fw, h, inch(1.4), fm, { r: inch(0.05) });
      v.position.set(s * (w / 2 - fw / 2), 0, inch(0.7));
      g.add(v);
      const hz = box(w - 2 * fw, fw, inch(1.4), fm, { r: inch(0.05) });
      hz.position.set(0, s * (h / 2 - fw / 2), inch(0.7));
      g.add(hz);
    }
    const mat2 = box(w - 2 * fw, h - 2 * fw, inch(0.5), o.matMaterial || P.trimWhite, { r: inch(0.02) });
    mat2.position.z = inch(0.25);
    g.add(mat2);
    const art = box((w - 2 * fw) * 0.76, (h - 2 * fw) * 0.78, inch(0.2),
      o.artMaterial || local('artCanvas', null, { color: 0x8a9aa6, roughness: 0.8 }),
      { r: inch(0.02) });
    art.position.z = inch(0.55);
    g.add(art);
    return g;
  }

  /**
   * Round / capsule wall mirror with a thin metal frame.
   * @anchor centre of the mirror on the WALL face (z = 0).
   */
  function mirrorRounded(o = {}) {
    const w = o.w === undefined ? ft(2, 6) : o.w;
    const h = o.h === undefined ? ft(3, 0) : o.h;
    const fin = finishMat(o.finish || 'brass');
    const g = G('centre of the mirror on the wall face', [w, h, inch(2)]);
    if (Math.abs(w - h) < 1e-6) {
      const ring = torus(w / 2, inch(0.7), fin, 64, 12);
      ring.position.z = inch(1.0);
      g.add(ring);
      const gl = new THREE.Mesh(new THREE.CircleGeometry(w / 2 - inch(0.2), 64), P.mirror);
      gl.position.z = inch(1.0);
      gl.receiveShadow = true;
      g.add(gl);
    } else {
      const r = Math.min(w, h) / 2;
      const rim = box(w, h, inch(1.4), fin, { r: r * 0.96, seg: 8 });
      rim.position.z = inch(0.7);
      g.add(rim);
      const gl = box(w - inch(1.0), h - inch(1.0), inch(0.5), P.mirror,
        { r: r * 0.94, seg: 8, cast: false });
      gl.position.z = inch(1.25);
      g.add(gl);
    }
    return g;
  }

  /**
   * Full-height frameless wall mirror (over a vanity).
   * @anchor bottom centre of the mirror on the WALL face (z = 0).
   */
  function wallMirrorFull(o = {}) {
    const w = o.w === undefined ? ft(4, 0) : o.w;
    const h = o.h === undefined ? ft(3, 6) : o.h;
    const g = G('bottom centre of the mirror on the wall face', [w, h, inch(1)]);
    const gl = boxAt(-w / 2, 0, 0, w, h, inch(0.35), P.mirror, { r: inch(0.05), cast: false });
    g.add(gl);
    if (o.clips !== false) {
      const fin = finishMat(o.finish || 'chrome');
      for (const sx of [-1, 1]) for (const sy of [0, 1]) {
        const c = box(inch(1.6), inch(0.9), inch(0.9), fin, { r: inch(0.1) });
        c.position.set(sx * (w / 2 - inch(3)), sy ? h - inch(0.45) : inch(0.45), inch(0.5));
        g.add(c);
      }
    }
    return g;
  }

  /**
   * Flat weight bench.
   * @anchor bottom CENTRE of the footprint.
   */
  function gymBench(o = {}) {
    const L = o.length === undefined ? ft(4, 0) : o.length;
    const w = o.w === undefined ? inch(12) : o.w;
    const h = o.h === undefined ? inch(18) : o.h;
    const met = o.metal || P.blackMetal;
    const pad = o.pad || P.leather;
    const g = G('bottom centre of the footprint', [w, h, L]);
    const p = box(w, inch(4), L, pad, { r: inch(1.4), seg: 3, uv: true });
    p.position.y = h - inch(2);
    g.add(p);
    for (const s of [-1, 1]) {
      const leg = box(inch(2.4), h - inch(4), inch(2.4), met, { r: inch(0.1) });
      leg.position.set(0, (h - inch(4)) / 2, s * (L / 2 - inch(5)));
      g.add(leg);
      const foot = box(w + inch(5), inch(2.2), inch(2.4), met, { r: inch(0.1) });
      foot.position.set(0, inch(1.1), s * (L / 2 - inch(3)));
      g.add(foot);
    }
    return g;
  }

  /**
   * Two-tier dumbbell rack.
   * @anchor bottom centre of the rack BACK, on the floor.
   */
  function dumbbellRack(o = {}) {
    const w = o.w === undefined ? ft(4, 0) : o.w;
    const d = o.d === undefined ? ft(1, 8) : o.d;
    const h = o.h === undefined ? ft(2, 6) : o.h;
    const met = o.metal || P.blackMetal;
    const g = G('bottom centre of the rack back, on the floor', [w, h, d]);
    for (const s of [-1, 1]) {
      const end = box(inch(2.4), h, d, met, { r: inch(0.1) });
      end.position.set(s * (w / 2 - inch(1.2)), h / 2, d / 2);
      g.add(end);
    }
    const tiers = [[h - inch(2), d * 0.30], [h * 0.45, d * 0.68]];
    for (const [y, z] of tiers) {
      const sh = box(w, inch(1.4), inch(7), met, { r: inch(0.08) });
      sh.position.set(0, y, z);
      sh.rotation.x = deg(-9);
      g.add(sh);
      const pairs = Math.max(3, Math.round(w / inch(11)));
      for (let i = 0; i < pairs; i++) {
        const x = -w / 2 + inch(6) + ((w - inch(12)) * i) / Math.max(1, pairs - 1);
        const sc = 1 - 0.35 * (i / pairs);
        const bar = cyl(inch(0.6), inch(0.6), inch(5.5) * sc, met, 10);
        bar.rotation.z = HALFPI;
        bar.position.set(x, y + inch(2.6), z);
        g.add(bar);
        for (const sx of [-1, 1]) {
          const wt = cyl(inch(2.3) * sc, inch(2.3) * sc, inch(2.0) * sc, met, 18);
          wt.rotation.z = HALFPI;
          wt.position.set(x + sx * inch(3.2) * sc, y + inch(2.6), z);
          g.add(wt);
        }
      }
    }
    return g;
  }

  /**
   * Treadmill.
   * @anchor bottom CENTRE of the footprint; the console is at -Z.
   */
  function treadmill(o = {}) {
    const w = o.w === undefined ? ft(2, 8) : o.w;
    const L = o.length === undefined ? ft(6, 0) : o.length;
    const h = o.h === undefined ? ft(4, 8) : o.h;
    const met = o.metal || local('treadmillBody', null, {
      color: 0x2b2d31, roughness: 0.42, metalness: 0.35,
    });
    const g = G('bottom centre of the footprint, console at -Z', [w, h, L]);
    const deck = box(w, inch(6), L, met, { r: inch(0.6), seg: 2 });
    deck.position.y = inch(5);
    g.add(deck);
    const belt = box(w - inch(8), inch(1.0), L - inch(10),
      local('treadBelt', null, { color: 0x111214, roughness: 0.75 }), { r: inch(0.1) });
    belt.position.set(0, inch(8.2), inch(2));
    g.add(belt);
    for (const s of [-1, 1]) {
      const up = box(inch(2.6), h - inch(8), inch(2.6), met, { r: inch(0.2), seg: 2 });
      up.position.set(s * (w / 2 - inch(2)), inch(8) + (h - inch(8)) / 2, -L / 2 + inch(8));
      up.rotation.x = deg(9);
      g.add(up);
      const hand = box(inch(2.0), inch(2.0), ft(1, 8), met, { r: inch(0.8), seg: 3 });
      hand.position.set(s * (w / 2 - inch(2)), h - ft(1, 3), -L / 2 + ft(1, 4));
      g.add(hand);
    }
    const con = box(w - inch(2), ft(1, 2), inch(3.5), met, { r: inch(0.35), seg: 2 });
    con.position.set(0, h - inch(7), -L / 2 + inch(5));
    con.rotation.x = deg(-14);
    g.add(con);
    const scr = box(w - inch(8), ft(0, 10), inch(0.3),
      local('treadScreen', null, {
        color: 0x0b0d10, roughness: 0.12, clearcoat: 1.0, clearcoatRoughness: 0.03,
      }), { r: inch(0.05) });
    scr.position.set(0, h - inch(7), -L / 2 + inch(7));
    scr.rotation.x = deg(-14);
    g.add(scr);
    return g;
  }

  /**
   * Foosball table.
   * @anchor bottom CENTRE of the footprint.
   */
  function foosballTable(o = {}) {
    const w = o.w === undefined ? ft(4, 8) : o.w;
    const d = o.d === undefined ? ft(2, 6) : o.d;
    const h = o.h === undefined ? inch(36) : o.h;
    const m = o.material || P.woodDark;
    const met = P.chrome;
    const g = G('bottom centre of the footprint', [w + ft(1, 4), h, d]);
    const body = box(w, inch(10), d, m, { r: inch(0.2), seg: 2, uv: true });
    body.position.y = h - inch(5);
    g.add(body);
    const field = box(w - inch(4), inch(0.6), d - inch(4),
      local('foosField', null, { color: 0x1e6b3c, roughness: 0.6 }), { r: inch(0.05) });
    field.position.y = h - inch(2.4);
    g.add(field);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const leg = box(inch(4), h - inch(10), inch(4), m, { r: inch(0.12), uv: true });
      leg.position.set(sx * (w / 2 - inch(2.5)), (h - inch(10)) / 2, sz * (d / 2 - inch(2.5)));
      g.add(leg);
    }
    for (let i = 0; i < 8; i++) {
      const rod = cyl(inch(0.55), inch(0.55), d + ft(1, 2), met, 12);
      rod.rotation.x = HALFPI;
      rod.position.set(-w / 2 + inch(6) + ((w - inch(12)) * i) / 7, h - inch(2), 0);
      g.add(rod);
      const men = i % 2 === 0 ? 3 : 2;
      const pm = i % 2 === 0 ? P.blackMetal : local('foosRed', null,
        { color: 0x9c2b26, roughness: 0.4 });
      for (let k = 0; k < men; k++) {
        const p = box(inch(1.6), inch(4.2), inch(1.6), pm, { r: inch(0.5), seg: 3 });
        p.position.set(rod.position.x, h - inch(1.0), -d / 2 + (d * (k + 1)) / (men + 1));
        g.add(p);
      }
      for (const s of [-1, 1]) {
        const grip = cyl(inch(0.85), inch(0.85), inch(4.5), m, 14);
        grip.rotation.x = HALFPI;
        grip.position.set(rod.position.x, h - inch(2), s * (d / 2 + inch(5)));
        g.add(grip);
      }
    }
    return g;
  }

  /**
   * Shuffleboard table.
   * @anchor bottom CENTRE of the footprint.
   */
  function shuffleboardTable(o = {}) {
    const L = o.length === undefined ? ft(12, 0) : o.length;
    const w = o.w === undefined ? ft(2, 6) : o.w;
    const h = o.h === undefined ? inch(30) : o.h;
    const m = o.material || P.woodDark;
    const g = G('bottom centre of the footprint', [w, h, L]);
    const play = box(w - inch(9), inch(3), L, mat.butcherBlock || P.whiteOak,
      { r: inch(0.1), seg: 2, uv: true });
    play.position.y = h - inch(3.5);   // recessed between the raised cradles
    g.add(play);
    for (const s of [-1, 1]) {
      const cr = box(inch(4.5), inch(12), L, m, { r: inch(0.14), seg: 2, uv: true });
      cr.position.set(s * (w / 2 - inch(2.25)), h - inch(6), 0);
      g.add(cr);
    }
    for (const s of [-1, 1]) {
      const end = box(w, inch(12), inch(4.5), m, { r: inch(0.14), seg: 2, uv: true });
      end.position.set(0, h - inch(6), s * (L / 2 - inch(2.25)));
      g.add(end);
      for (const sx of [-1, 1]) {
        const leg = box(inch(5), h - inch(12), inch(5), m, { r: inch(0.14), uv: true });
        leg.position.set(sx * (w / 2 - inch(3)), (h - inch(12)) / 2, s * (L / 2 - ft(1, 2)));
        g.add(leg);
      }
    }
    return g;
  }

  /* ---------------------------------------------------------------- */
  /* 2.15b  PLANTING                                                    */
  /*                                                                    */
  /* Every exterior in this set is more vegetation than building. A CG  */
  /* tree made of smoothly-shaded lumps is the fastest way to lose a    */
  /* blind test, so foliage here is built the way an offline renderer   */
  /* builds it: thousands of alpha-cut leaf cards on a real branch      */
  /* skeleton, merged into ONE BufferGeometry per plant so the draw     */
  /* cost stays flat and the shadow map gets a genuinely perforated     */
  /* canopy.                                                            */
  /* ---------------------------------------------------------------- */

  /** Deterministic PRNG — planting must be identical between screenshots. */
  function prng(seed) {
    let a = (seed >>> 0) || 1;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * Merge N oriented quads into one geometry.
   * `cards` = [{ p:[x,y,z], n:[..] (card normal), up:[..], w, h }]
   */
  function cardsGeometry(cards) {
    const n = cards.length;
    const pos = new Float32Array(n * 18);
    const nrm = new Float32Array(n * 18);
    const uv = new Float32Array(n * 12);
    let pi = 0, ni = 0, ui = 0;
    for (const c of cards) {
      const N = v3norm(c.n);
      let U = v3norm(v3cross(c.up || [0, 1, 0], N));
      if (!(U[0] * U[0] + U[1] * U[1] + U[2] * U[2] > 1e-6)) U = v3norm(v3cross([1, 0, 0], N));
      const V = v3norm(v3cross(N, U));
      const hw = c.w / 2, hh = c.h / 2;
      const P = (su, sv) => [
        c.p[0] + U[0] * su * hw + V[0] * sv * hh,
        c.p[1] + U[1] * su * hw + V[1] * sv * hh,
        c.p[2] + U[2] * su * hw + V[2] * sv * hh,
      ];
      const a = P(-1, -1), b = P(1, -1), d = P(1, 1), e = P(-1, 1);
      // Bend the vertex normals outward from the card centre so a flat quad
      // shades like a rounded clump instead of a piece of cardboard.
      const bulge = c.bulge === undefined ? 0.28 : c.bulge;
      const vn = (su, sv) => v3norm([
        N[0] + (U[0] * su + V[0] * sv) * bulge,
        N[1] + (U[1] * su + V[1] * sv) * bulge,
        N[2] + (U[2] * su + V[2] * sv) * bulge,
      ]);
      const na = vn(-1, -1), nb = vn(1, -1), nd = vn(1, 1), ne = vn(-1, 1);
      const tri = (p0, p1, p2, n0, n1, n2, u0, u1, u2) => {
        pos[pi++] = p0[0]; pos[pi++] = p0[1]; pos[pi++] = p0[2];
        pos[pi++] = p1[0]; pos[pi++] = p1[1]; pos[pi++] = p1[2];
        pos[pi++] = p2[0]; pos[pi++] = p2[1]; pos[pi++] = p2[2];
        nrm[ni++] = n0[0]; nrm[ni++] = n0[1]; nrm[ni++] = n0[2];
        nrm[ni++] = n1[0]; nrm[ni++] = n1[1]; nrm[ni++] = n1[2];
        nrm[ni++] = n2[0]; nrm[ni++] = n2[1]; nrm[ni++] = n2[2];
        uv[ui++] = u0[0]; uv[ui++] = u0[1];
        uv[ui++] = u1[0]; uv[ui++] = u1[1];
        uv[ui++] = u2[0]; uv[ui++] = u2[1];
      };
      tri(a, b, d, na, nb, nd, [0, 0], [1, 0], [1, 1]);
      tri(a, d, e, na, nd, ne, [0, 0], [1, 1], [0, 1]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('uv1', new THREE.BufferAttribute(uv, 2));   // aoMap channel
    g.computeBoundingSphere();
    return g;
  }

  /**
   * A cloud of leaf cards filling an ellipsoidal shell.
   *
   * @param {THREE.Material} material  an alpha-tested leaf sheet
   * @param {object} o
   * @param {number[]} o.center  [x,y,z]
   * @param {number[]} o.radii   [rx,ry,rz]
   * @param {number} o.count     cards
   * @param {number} o.card      card edge length in feet
   * @param {number} [o.shell=0.55]  0 = solid fill, 1 = surface only
   * @param {number} [o.lumps=5] low-frequency lobes that break the ellipsoid
   * @param {number} [o.flatten=0]   crop the bottom of the ellipsoid, 0..1
   * @param {number} [o.seed=7]
   * @returns {THREE.Mesh}
   */
  function leafCanopy(material, o) {
    const R = prng(o.seed === undefined ? 7 : o.seed);
    const [cx, cy, cz] = o.center;
    const [rx, ry, rz] = o.radii;
    const shell = o.shell === undefined ? 0.55 : o.shell;
    const lumps = o.lumps === undefined ? 5 : o.lumps;
    const flatten = o.flatten || 0;
    const card = o.card;
    const pw = o.power === undefined ? 2 : o.power;
    // A handful of lobes: real canopies are a bunch of overlapping masses,
    // never one smooth solid of revolution.
    // Lobes CUT IN rather than bulge out, so the finished cloud can never
    // exceed `radii` — otherwise a canopy specified as 17 ft across renders
    // 27 ft across and the tree stops matching the photograph.
    const lobe = [];
    for (let i = 0; i < lumps; i++) {
      const a = R() * Math.PI * 2, e = (R() - 0.42) * 1.3;
      lobe.push({
        d: [Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e)],
        k: 0.10 + R() * 0.24,
      });
    }
    const cards = [];
    let guard = 0;
    while (cards.length < o.count && guard++ < o.count * 12) {
      // uniform-ish direction
      const u = R() * 2 - 1, ph = R() * Math.PI * 2;
      const s = Math.sqrt(Math.max(0, 1 - u * u));
      const d = [s * Math.cos(ph), u, s * Math.sin(ph)];
      if (flatten > 0 && d[1] < -1 + flatten * 2 && R() > 0.12) continue;
      let g = 1;
      for (const L of lobe) g -= L.k * Math.max(0, d[0] * L.d[0] + d[1] * L.d[1] + d[2] * L.d[2]) ** 2;
      if (g < 0.42) g = 0.42;
      const t = Math.pow(R(), 1 / 3);                        // volume-uniform
      const rad = g * (1 - shell + shell * (0.72 + 0.28 * t));
      // Superellipsoid: p = 2 is a plain ellipsoid, p = 5-8 is the flat-topped,
      // flat-sided solid a sheared privet actually is. A clipped hedge read as
      // a sphere is one of the loudest "CG garden" tells there is.
      let ss = 1;
      if (pw > 2.0001) {
        ss = Math.pow(
          Math.pow(Math.abs(d[0]), pw) + Math.pow(Math.abs(d[1]), pw) + Math.pow(Math.abs(d[2]), pw),
          1 / pw
        ) || 1;
      }
      const dx = d[0] / ss, dy = d[1] / ss, dz = d[2] / ss;
      const p = [cx + dx * rx * rad, cy + dy * ry * rad, cz + dz * rz * rad];
      // Surface normal of the superellipsoid (gradient), so a flat face on a
      // clipped hedge really does face the sun as one plane.
      let sn = d;
      if (pw > 2.0001) {
        const q = pw - 1;
        sn = v3norm([
          Math.sign(dx) * Math.pow(Math.abs(dx), q) / rx,
          Math.sign(dy) * Math.pow(Math.abs(dy), q) / ry,
          Math.sign(dz) * Math.pow(Math.abs(dz), q) / rz,
        ]);
      }
      // Cards face outward, jittered, with a downward droop on the outside.
      const jit = o.jitter === undefined ? 0.75 : o.jitter;
      const nrm = v3norm([
        sn[0] + (R() - 0.5) * jit,
        sn[1] + (R() - 0.5) * jit - 0.18,
        sn[2] + (R() - 0.5) * jit,
      ]);
      const up = v3norm([(R() - 0.5) * 0.9, 1, (R() - 0.5) * 0.9]);
      const sc = card * (0.80 + 0.38 * R());
      cards.push({ p, n: nrm, up, w: sc, h: sc * (0.85 + 0.3 * R()), bulge: o.bulge === undefined ? 0.28 : o.bulge });
    }
    const m = new THREE.Mesh(cardsGeometry(cards), material);
    m.castShadow = true;
    m.receiveShadow = true;
    m.name = o.name || 'leafCanopy';
    return m;
  }

  /**
   * A tapered, slightly crooked limb from `a` to `b`.
   * Returns a mesh; radii are at the two ends.
   */
  function limb(material, a, b, r0, r1, seg = 8, bow = 0.0, rnd = Math.random) {
    const pts = [];
    const N = 5;
    const ax = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const side = v3norm(v3cross(ax, [0, 1, 0]));
    const side2 = v3norm(v3cross(ax, side));
    const s1 = (rnd() - 0.5) * bow, s2 = (rnd() - 0.5) * bow;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const w = Math.sin(t * Math.PI);
      pts.push(new THREE.Vector3(
        a[0] + ax[0] * t + (side[0] * s1 + side2[0] * s2) * w,
        a[1] + ax[1] * t + (side[1] * s1 + side2[1] * s2) * w,
        a[2] + ax[2] * t + (side[2] * s1 + side2[2] * s2) * w
      ));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const g = new THREE.TubeGeometry(curve, N * 2, 1, seg, false);
    // taper by rewriting the radius along the tube
    const pos = g.attributes.position;
    const nor = g.attributes.normal;
    const rings = N * 2 + 1;
    for (let i = 0; i < pos.count; i++) {
      const ring = Math.floor(i / (seg + 1));
      const t = ring / (rings - 1);
      const r = r0 + (r1 - r0) * t;
      const cxp = curve.getPointAt(Math.min(1, t));
      pos.setXYZ(i,
        cxp.x + nor.getX(i) * r,
        cxp.y + nor.getY(i) * r,
        cxp.z + nor.getZ(i) * r);
    }
    pos.needsUpdate = true;
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, material);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }

  /**
   * A multi-stem ornamental / shade tree: leaning trunks, a real branch
   * skeleton, and leaf-card clumps hung on the branch tips.
   *
   * @param {object} o
   * @param {THREE.Material} o.bark
   * @param {THREE.Material} o.leaf
   * @param {number[]} o.at        [x, z] plan position
   * @param {number} o.groundY
   * @param {number} o.height      overall height, feet
   * @param {number} o.spread      canopy diameter, feet
   * @param {number} o.crownBase   height of the lowest foliage
   * @param {number} [o.stems=3]
   * @param {number} [o.trunkR=0.6]
   * @param {number} [o.clumps=26] leaf-card clumps
   * @param {number} [o.cardsPer=34]
   * @param {number} [o.card=3.2]  leaf-card size, feet
   * @param {number} [o.seed=11]
   * @param {number} [o.lean=0.10]
   */
  function deciduousTree(o) {
    const R = prng(o.seed === undefined ? 11 : o.seed);
    const g = new THREE.Group();
    g.name = o.name || 'tree';
    const [x0, z0] = o.at;
    const y0 = o.groundY;
    const stems = o.stems === undefined ? 3 : o.stems;
    const trunkR = o.trunkR === undefined ? 0.6 : o.trunkR;
    const forkY = y0 + (o.crownBase - y0) * 0.42;
    const tips = [];

    // one short common butt, then the stems fan out of it
    if (stems > 1) {
      g.add(limb(o.bark, [x0, y0 - 0.6, z0], [x0, y0 + 0.9, z0], trunkR * 1.42, trunkR * 1.12, 12, 0.05, R));
    }
    for (let i = 0; i < stems; i++) {
      const a = (i / stems) * Math.PI * 2 + R() * 0.9;
      const lean = (o.lean === undefined ? 0.10 : o.lean) * (0.6 + R() * 0.9);
      const sr = trunkR * (0.62 + 0.42 * R());
      const base = [x0 + Math.cos(a) * trunkR * 0.5, y0 - 0.5, z0 + Math.sin(a) * trunkR * 0.5];
      const topY = forkY + (o.crownBase - forkY) * (0.55 + 0.5 * R());
      const top = [
        x0 + Math.cos(a) * (topY - y0) * lean * 2.6,
        topY,
        z0 + Math.sin(a) * (topY - y0) * lean * 2.6,
      ];
      g.add(limb(o.bark, base, top, sr * 1.15, sr * 0.55, 10, 0.30, R));
      // two orders of branch off each stem. A near tree needs a real skeleton:
      // in the reference photo the canopy is lacy enough that limbs, sky and
      // the house behind all show through it.
      // Every limb has to die INSIDE the leaf cloud. A branch tip that pokes
      // out past the foliage reads as a bare stick radiating from a bush and
      // is the ugliest thing a procedural tree can do.
      const RMAX = o.spread * 0.5 * 0.78;
      const clampToCrown = (p) => {
        const dx = p[0] - x0, dz = p[2] - z0;
        const d = Math.hypot(dx, dz);
        if (d > RMAX) { p[0] = x0 + dx * RMAX / d; p[2] = z0 + dz * RMAX / d; }
        if (p[1] > o.height - 1.0) p[1] = o.height - 1.0;
        return p;
      };
      const nb = (o.branches === undefined ? 3 : o.branches) + ((R() * 2) | 0);
      for (let j = 0; j < nb; j++) {
        const ba = a + (R() - 0.5) * 2.4 + (j / nb) * Math.PI * 2;
        const rr = o.spread * 0.5 * (0.34 + 0.34 * R());
        const by = topY + (o.height - topY) * (0.30 + 0.55 * R());
        const end = clampToCrown([top[0] + Math.cos(ba) * rr, by, top[2] + Math.sin(ba) * rr]);
        g.add(limb(o.bark, top, end, sr * 0.5, sr * 0.16, 7, 0.35, R));
        tips.push(end);
        const nb2 = (o.subBranches === undefined ? 2 : o.subBranches) + ((R() * 2) | 0);
        for (let k = 0; k < nb2; k++) {
          const ca = ba + (R() - 0.5) * 2.0;
          const cr = o.spread * 0.5 * (0.12 + 0.20 * R());
          const e2 = clampToCrown([
            end[0] + Math.cos(ca) * cr,
            by + (R() - 0.45) * (o.height - by) * 0.8,
            end[2] + Math.sin(ca) * cr,
          ]);
          g.add(limb(o.bark, end, e2, sr * 0.16, sr * 0.06, 5, 0.28, R));
          tips.push(e2);
        }
      }
    }

    // Leaf clumps hung on the tips, plus a few free-floating ones to close
    // the silhouette. One merged mesh per clump keeps the draw count sane.
    const clumps = o.clumps === undefined ? 26 : o.clumps;
    const cardsPer = o.cardsPer === undefined ? 34 : o.cardsPer;
    const cy = (o.crownBase + o.height) / 2;
    const cards = [];
    const cardW = o.card === undefined ? 3.2 : o.card;
    const R2 = o.spread * 0.5;
    for (let i = 0; i < clumps; i++) {
      // clump radius, and the envelope the clump CENTRE may occupy so the
      // finished canopy never grows past `spread` — cards included
      const cr = R2 * (0.17 + 0.11 * R());
      const room = Math.max(0.4, R2 - cr - cardW * 0.62);
      let c;
      if (i < tips.length) {
        const t = tips[(i * 7 + 3) % tips.length];
        const dx = t[0] - x0, dz = t[2] - z0;
        const d = Math.hypot(dx, dz);
        const k = d > room ? room / d : 1;
        c = [x0 + dx * k, t[1], z0 + dz * k];
      } else {
        const a = R() * Math.PI * 2;
        const rr = room * (0.25 + 0.72 * Math.sqrt(R()));
        c = [x0 + Math.cos(a) * rr, cy + (R() - 0.5) * (o.height - o.crownBase) * 0.9, z0 + Math.sin(a) * rr];
      }
      // and keep the clump inside the crown vertically too
      const yLo = o.crownBase + cr * 0.35;
      const yHi = o.height - cr - cardW * 0.55;
      c[1] = Math.min(yHi, Math.max(yLo, c[1]));
      const sub = leafCanopy(o.leaf, {
        center: c,
        radii: [cr, cr * 0.78, cr],
        count: cardsPer,
        card: cardW * (0.88 + 0.22 * R()),
        shell: 0.5,
        lumps: 3,
        seed: 900 + i * 17,
      });
      cards.push(sub.geometry);
      sub.geometry = null;
    }
    // merge the clumps
    const merged = mergeGeometries(cards);
    const canopy = new THREE.Mesh(merged, o.leaf);
    canopy.castShadow = true;
    canopy.receiveShadow = true;
    canopy.name = 'canopy';
    g.add(canopy);
    return g;
  }

  /** Concatenate non-indexed geometries that share the same attribute set. */
  function mergeGeometries(list) {
    let n = 0;
    for (const g of list) n += g.attributes.position.count;
    const pos = new Float32Array(n * 3);
    const nrm = new Float32Array(n * 3);
    const uv = new Float32Array(n * 2);
    let o3 = 0, o2 = 0;
    for (const g of list) {
      pos.set(g.attributes.position.array, o3);
      nrm.set(g.attributes.normal.array, o3);
      uv.set(g.attributes.uv.array, o2);
      o3 += g.attributes.position.array.length;
      o2 += g.attributes.uv.array.length;
      g.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    out.setAttribute('uv1', new THREE.BufferAttribute(uv, 2));
    out.computeBoundingSphere();
    return out;
  }

  /**
   * A conifer: straight leader, whorled branches, needle-spray cards.
   */
  function coniferTree(o) {
    const R = prng(o.seed === undefined ? 21 : o.seed);
    const g = new THREE.Group();
    g.name = o.name || 'conifer';
    const [x0, z0] = o.at;
    const y0 = o.groundY;
    const trunkR = o.trunkR === undefined ? 0.9 : o.trunkR;
    g.add(limb(o.bark, [x0, y0 - 0.6, z0], [x0 + (R() - 0.5) * 1.2, o.height, z0 + (R() - 0.5) * 1.2],
      trunkR * 1.2, trunkR * 0.14, 12, 0.5, R));
    const whorls = o.whorls === undefined ? 9 : o.whorls;
    const parts = [];
    for (let i = 0; i < whorls; i++) {
      const f = i / (whorls - 1);
      const y = o.crownBase + f * (o.height - o.crownBase);
      const rad = (o.spread * 0.5) * (1 - Math.pow(f, 0.85) * 0.88) * (0.82 + 0.34 * R());
      const per = 3 + ((R() * 3) | 0);
      for (let j = 0; j < per; j++) {
        const a = R() * Math.PI * 2;
        const c = [x0 + Math.cos(a) * rad * 0.62, y - rad * 0.10, z0 + Math.sin(a) * rad * 0.62];
        g.add(limb(o.bark, [x0, y + rad * 0.12, z0], c, trunkR * 0.20, trunkR * 0.06, 5, 0.3, R));
        const sub = leafCanopy(o.leaf, {
          center: c,
          radii: [rad * 0.72, rad * 0.30, rad * 0.72],
          count: o.cardsPer === undefined ? 26 : o.cardsPer,
          card: (o.card === undefined ? 4.0 : o.card) * (0.8 + 0.4 * R()),
          shell: 0.35,
          lumps: 2,
          seed: 300 + i * 31 + j,
        });
        parts.push(sub.geometry);
        sub.geometry = null;
      }
    }
    const canopy = new THREE.Mesh(mergeGeometries(parts), o.leaf);
    canopy.castShadow = true; canopy.receiveShadow = true;
    g.add(canopy);
    return g;
  }

  /**
   * A clipped shrub / hedge mass: a solid dark core (so no sky leaks through
   * the middle) wrapped in a shell of small leaf cards.
   *
   * @param {object} o
   * @param {THREE.Material} o.leaf
   * @param {THREE.Material} [o.core]  dark interior; defaults to the leaf mat
   * @param {number[]} o.center [x,y,z] centre of the mass
   * @param {number[]} o.radii  [rx,ry,rz]
   * @param {number} [o.density=2.6] cards per square foot of surface
   * @param {number} [o.card=0.85]
   */
  function shrubMass(o) {
    const g = new THREE.Group();
    g.name = o.name || 'shrub';
    const [rx, ry, rz] = o.radii;
    const pw = o.power === undefined ? 2 : o.power;
    // The opaque interior. Without it a card shell shows sky through its middle
    // and the mass reads as a cloud instead of a plant.
    const core = pw > 2.0001
      ? new THREE.Mesh(roundedBox(rx * 1.7, ry * 1.7, rz * 1.7, Math.min(rx, ry, rz) * 0.55, 2), o.core || o.leaf)
      : new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), o.core || o.leaf);
    if (pw <= 2.0001) core.scale.set(rx * 0.80, ry * 0.80, rz * 0.80);
    core.position.set(o.center[0], o.center[1], o.center[2]);
    core.castShadow = true; core.receiveShadow = true;
    g.add(core);
    const area = 4 * Math.PI * Math.pow((Math.pow(rx * ry, 1.6) + Math.pow(ry * rz, 1.6) + Math.pow(rz * rx, 1.6)) / 3, 1 / 1.6);
    const count = Math.max(40, Math.round(area * (o.density === undefined ? 2.6 : o.density)));
    g.add(leafCanopy(o.leaf, {
      center: o.center,
      radii: [rx, ry, rz],
      count,
      card: o.card === undefined ? 0.85 : o.card,
      shell: 0.92,
      power: pw,
      jitter: o.jitter,
      lumps: o.lumps === undefined ? 6 : o.lumps,
      flatten: o.flatten === undefined ? 0.22 : o.flatten,
      seed: o.seed === undefined ? 55 : o.seed,
    }));
    // A second, inner layer. One shell leaves gaps that show the smooth core
    // sphere, and a smooth sphere peeping out of a shrub is instantly CG.
    g.add(leafCanopy(o.leaf, {
      center: o.center,
      radii: [rx * 0.86, ry * 0.86, rz * 0.86],
      count: Math.round(count * 0.55),
      card: (o.card === undefined ? 0.85 : o.card) * 1.05,
      shell: 0.75,
      power: pw,
      jitter: o.jitter,
      lumps: o.lumps === undefined ? 6 : o.lumps,
      flatten: o.flatten === undefined ? 0.22 : o.flatten,
      seed: (o.seed === undefined ? 55 : o.seed) + 977,
    }));
    return g;
  }

  /* ---------------------------------------------------------------- */
  /* 2.16  exports                                                      */
  /* ---------------------------------------------------------------- */

  const KIT = {
    // primitives & helpers
    roundedBox, box, boxAt, cyl, ball, torus, taperBox, tube,
    sweepProfile, extrudeProfile, sweptMesh, stickingRing, Builder,
    PROFILE, materials: P, uvScaleFor: uvs, group: G,

    plateWithHoles, ellipseRing, cavityBox, basinCavity, basin, flameAlpha,

    // millwork / trim
    baseboard, crownMolding, chairRail, doorCasing, windowCasing,
    shakerDoorPanel, slabDoorPanel, pull,

    // doors & windows
    doorLeaf, interiorDoor, bypassClosetDoors, frontDoor, plantationShutters,
    leverSet, hinge, sashFrame,
    window: windowUnit, windowUnit,
    slidingGlassDoor, frenchDoor, garageDoor, windowWall,

    // casework
    baseCabinet, wallCabinet, tallCabinet, pantry: tallCabinet, kitchenIsland,
    vanity, openShelf, rangeHoodSurround, counterTop, fullHeightSlabBacksplash,

    // appliances
    slideInGasRange, dishwasher, builtInFridge, microwave, wallOven,
    washer, dryer, frontLoadMachine, utilitySink, applianceHandle, knob,

    // plumbing
    undermountSink, farmhouseSink, faucet, toilet, pedestalSink,
    dropInJacuzziTub, alcoveTub, showerPan, framelessGlassShowerDoor,
    cornerGlassShower, showerHead, showerValve, showerNiche, mosaicBand,

    // light fixtures
    recessedTrim, sputnikGlobeChandelier, goldDandelionBurstChandelier,
    pendantBlackShadeBrassChain, vanityBar, flushMount, fluorescentTroffer,
    skylightWell,

    // structure
    straightStair, returnStair, stairRailing, newelPost, turnedOakPost,
    dropBeam, supportColumn, gasFireplace, deckFrame, deckRailing,
    stoneFirePitRing, stackedStonePlanterWall, postAndBeamWall,

    // exterior hardscape
    deckBoards, deckFascia, deckBench, crazyPaving, cobbleEdge,
    polySpansX, pointInPoly,

    // planting
    leafCanopy, deciduousTree, coniferTree, shrubMass, limb, cardsGeometry,
    mergeGeometries,

    // furniture
    sofa, sectional, armchair, coffeeTable, sideTable, diningTable, diningChair,
    bed, nightstand, dresser, tvWallMounted, areaRug, bookshelf, barStool,
    plantPotted, towelBar, artFramed, mirrorRounded, wallMirrorFull,
    gymBench, dumbbellRack, treadmill, foosballTable, shuffleboardTable,
  };

  Object.defineProperty(KIT, 'dispose', {
    value() {
      for (const g of GEO_CACHE.values()) g.dispose();
      GEO_CACHE.clear();
      for (const m of LOCALS.values()) m.dispose();
      LOCALS.clear();
    },
    enumerable: false,
  });
  Object.defineProperty(KIT, '__three', { value: THREE, enumerable: false });

  return Object.freeze(KIT);
}

export default makeKit;
