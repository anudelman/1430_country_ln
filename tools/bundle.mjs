#!/usr/bin/env node
/**
 * tools/bundle.mjs — inline the whole walkthrough into ONE self-contained file.
 *
 *   node tools/bundle.mjs                       -> dist/walkthrough.html
 *   node tools/bundle.mjs --out dist/x.html
 *   node tools/bundle.mjs --min                 (use three.module.min.js)
 *   node tools/bundle.mjs --no-verify           (skip the file:// smoke test)
 *
 * The output opens from a `file://` URL with no server, no import map and no
 * network of any kind — which is exactly why CONVENTIONS §4 forbids binary
 * assets and CDN URLs.
 *
 * ---------------------------------------------------------------------------
 * HOW IT WORKS (and why this approach instead of a "real" bundler)
 * ---------------------------------------------------------------------------
 * Rewriting ES modules into a registry needs a full JS parser. We do not need
 * one, because we never touch the module *semantics* — only the specifier
 * STRINGS. So:
 *
 *   1. Walk the module graph from app/index.html, resolving specifiers through
 *      the page's own import map ('three' -> node_modules/three/build/...).
 *      A tiny lexer (strings, template literals, comments and regex literals
 *      are all skipped) finds every `from '...'`, `import '...'` and
 *      `import('...')`.
 *   2. Topologically sort the graph (dependencies first). A cycle is a hard
 *      error with the cycle printed — the layered architecture in CONVENTIONS
 *      §4 does not have one, and a cycle would be a design bug worth knowing
 *      about.
 *   3. Replace each specifier with a unique placeholder token, base64 the
 *      source, and emit all of them into one classic <script>.
 *   4. At load time the page walks the list in dependency order, substitutes
 *      the already-created blob: URLs for the placeholders, and makes a blob
 *      for each module. Then it dynamically imports the entry.
 *
 * Base64 (not raw string literals) because module sources contain `</script>`,
 * `<!--`, backslashes and non-ASCII; base64 cannot break out of the tag.
 *
 * Specifiers that do not resolve to a file (app/src/core/registry.js before it
 * is written, say) are left untouched on purpose: main.js imports those inside
 * try/catch, so the bundle degrades exactly like the dev page.
 *
 * app/cameras.json is inlined as `window.__CAMERAS__` because a file:// page
 * cannot fetch it.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

/* ------------------------------------------------------------------- args */

const argv = process.argv.slice(2);
const optOf = (name, dflt = null) => {
  const i = argv.indexOf('--' + name);
  if (i === -1) return dflt;
  const v = argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
};
const OUT = path.resolve(ROOT, String(optOf('out', 'dist/walkthrough.html')));
const ENTRY_HTML = path.resolve(ROOT, String(optOf('html', 'app/index.html')));
const USE_MIN = argv.indexOf('--min') !== -1;
const VERIFY = argv.indexOf('--no-verify') === -1;
const QUIET = argv.indexOf('--quiet') !== -1;

const log = (...a) => {
  if (!QUIET) console.log(...a);
};

const TOKEN = (i) => `__CLBUNDLE_MOD_${i}__`;

/* ==================================================================== */
/* 1. The specifier lexer                                               */
/* ==================================================================== */

const IDENT = /[A-Za-z0-9_$]/;
/** Tokens after which a `/` starts a regex literal rather than division. */
const REGEX_PREV = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
  'case', 'do', 'else', 'yield', 'await', 'throw',
]);

/**
 * Find every module specifier string in `src`.
 * @returns {{start:number, end:number, spec:string, kind:'from'|'import'|'dynamic'}[]}
 */
export function scanSpecifiers(src) {
  const out = [];
  const n = src.length;
  let i = 0;
  let lastSignificant = ''; // last non-space token or char, for regex detection

  const skipSpace = (j) => {
    for (;;) {
      while (j < n && /\s/.test(src[j])) j++;
      if (src[j] === '/' && src[j + 1] === '/') {
        while (j < n && src[j] !== '\n') j++;
        continue;
      }
      if (src[j] === '/' && src[j + 1] === '*') {
        j += 2;
        while (j < n && !(src[j] === '*' && src[j + 1] === '/')) j++;
        j += 2;
        continue;
      }
      return j;
    }
  };

  const readString = (j) => {
    const q = src[j];
    let k = j + 1;
    while (k < n) {
      if (src[k] === '\\') { k += 2; continue; }
      if (src[k] === q) return { end: k + 1, value: src.slice(j + 1, k) };
      if (src[k] === '\n') return null; // unterminated — bail out safely
      k++;
    }
    return null;
  };

  while (i < n) {
    const c = src[i];

    if (c === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'") {
      const s = readString(i);
      i = s ? s.end : i + 1;
      lastSignificant = 'str';
      continue;
    }
    if (c === '`') {
      // Template literal, including nested ${ ... } which may contain strings.
      let k = i + 1;
      let depth = 0;
      while (k < n) {
        if (src[k] === '\\') { k += 2; continue; }
        if (depth === 0 && src[k] === '`') { k++; break; }
        if (depth === 0 && src[k] === '$' && src[k + 1] === '{') { depth++; k += 2; continue; }
        if (depth > 0) {
          if (src[k] === '{') depth++;
          else if (src[k] === '}') depth--;
          else if (src[k] === '"' || src[k] === "'" || src[k] === '`') {
            const s = readString(k);
            k = s ? s.end : k + 1;
            continue;
          }
        }
        k++;
      }
      i = k;
      lastSignificant = 'str';
      continue;
    }
    if (c === '/') {
      // regex literal or division?
      const isRegex =
        lastSignificant === '' ||
        REGEX_PREV.has(lastSignificant) ||
        '(,=:[!&|?{};+-*%~^<>'.includes(lastSignificant);
      if (isRegex) {
        let k = i + 1;
        let inClass = false;
        while (k < n) {
          if (src[k] === '\\') { k += 2; continue; }
          if (src[k] === '[') inClass = true;
          else if (src[k] === ']') inClass = false;
          else if (src[k] === '/' && !inClass) { k++; break; }
          else if (src[k] === '\n') break;
          k++;
        }
        while (k < n && IDENT.test(src[k])) k++; // flags
        i = k;
        lastSignificant = 'regex';
        continue;
      }
      i++;
      lastSignificant = '/';
      continue;
    }

    if (IDENT.test(c)) {
      let k = i;
      while (k < n && IDENT.test(src[k])) k++;
      const word = src.slice(i, k);
      const prev = i > 0 ? src[i - 1] : '';

      if ((word === 'from' || word === 'import') && prev !== '.' && !IDENT.test(prev)) {
        let j = skipSpace(k);
        if (word === 'import' && src[j] === '.') {
          // import.meta — not a specifier
          i = k;
          lastSignificant = word;
          continue;
        }
        let dynamic = false;
        if (word === 'import' && src[j] === '(') {
          dynamic = true;
          j = skipSpace(j + 1);
        }
        if (src[j] === '"' || src[j] === "'") {
          const s = readString(j);
          if (s) {
            out.push({
              start: j,
              end: s.end,
              spec: s.value,
              kind: dynamic ? 'dynamic' : word === 'from' ? 'from' : 'import',
            });
            i = s.end;
            lastSignificant = 'str';
            continue;
          }
        }
      }
      i = k;
      lastSignificant = word;
      continue;
    }

    if (!/\s/.test(c)) lastSignificant = c;
    i++;
  }

  return out;
}

/* ==================================================================== */
/* 2. Specifier resolution (the page's own import map)                  */
/* ==================================================================== */

function readImportMap(html) {
  const m = html.match(/<script[^>]*type=["']importmap["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!m) return { imports: {} };
  try {
    return JSON.parse(m[1]);
  } catch (err) {
    throw new Error('app/index.html has an unparseable import map: ' + ((err && err.message) || err));
  }
}

const EXTS = ['', '.js', '.mjs', '/index.js'];

function existingFile(p) {
  for (const e of EXTS) {
    const c = p + e;
    try {
      if (fs.statSync(c).isFile()) return c;
    } catch { /* keep looking */ }
  }
  return null;
}

function applyMin(file) {
  if (!file || !USE_MIN) return file;
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  if (rel === 'node_modules/three/build/three.module.js') {
    const alt = path.join(ROOT, 'node_modules/three/build/three.module.min.js');
    if (fs.existsSync(alt)) return alt;
  }
  return file;
}

/**
 * @param {string} spec     the specifier as written
 * @param {string} fromFile absolute path of the importing file
 * @param {object} imports  the import map's `imports` object
 * @returns {string|null}   absolute file path, or null when unresolvable
 */
function resolveSpecifier(spec, fromFile, imports) {
  if (/^(https?:|data:|blob:|node:)/i.test(spec)) return null;

  if (spec.startsWith('./') || spec.startsWith('../')) {
    return applyMin(existingFile(path.resolve(path.dirname(fromFile), spec)));
  }
  if (spec.startsWith('/')) {
    return applyMin(existingFile(path.join(ROOT, spec)));
  }

  // Bare specifier: exact key wins, then the longest matching prefix key.
  if (Object.prototype.hasOwnProperty.call(imports, spec)) {
    return resolveSpecifier(imports[spec], path.join(ROOT, 'index.html'), {});
  }
  let best = null;
  for (const key of Object.keys(imports)) {
    if (key.endsWith('/') && spec.startsWith(key)) {
      if (!best || key.length > best.length) best = key;
    }
  }
  if (best) {
    const mapped = imports[best] + spec.slice(best.length);
    return resolveSpecifier(mapped, path.join(ROOT, 'index.html'), {});
  }
  return null;
}

/* ==================================================================== */
/* 3. Graph walk + topological sort                                     */
/* ==================================================================== */

class Graph {
  constructor(imports) {
    this.imports = imports;
    this.byPath = new Map();   // abs path -> node
    this.nodes = [];           // insertion order
    this.external = new Set(); // specifiers we deliberately left alone
  }

  /** Register a synthetic module (an inline <script type="module">). */
  addInline(source, baseFile, name) {
    const node = { id: this.nodes.length, file: baseFile, name, source, deps: [], inline: true };
    this.nodes.push(node);
    this.link(node);
    return node;
  }

  addFile(file) {
    const abs = path.resolve(file);
    if (this.byPath.has(abs)) return this.byPath.get(abs);
    const source = fs.readFileSync(abs, 'utf8');
    const node = { id: this.nodes.length, file: abs, name: path.relative(ROOT, abs), source, deps: [], inline: false };
    this.nodes.push(node);
    this.byPath.set(abs, node);
    this.link(node);
    return node;
  }

  link(node) {
    if (node.source.includes('__CLBUNDLE_MOD_')) {
      throw new Error(`${node.name} already contains the bundler's placeholder token`);
    }
    const found = scanSpecifiers(node.source);
    for (const ref of found) {
      const resolved = resolveSpecifier(ref.spec, node.file, this.imports);
      if (!resolved) {
        this.external.add(`${ref.spec}  (from ${node.name})`);
        node.deps.push({ ...ref, target: null });
        continue;
      }
      const dep = this.addFile(resolved);
      node.deps.push({ ...ref, target: dep.id });
    }
  }

  /** Dependencies-first order. Throws on a cycle, naming the whole loop. */
  topoOrder() {
    const WHITE = 0, GREY = 1, BLACK = 2;
    const color = new Array(this.nodes.length).fill(WHITE);
    const order = [];
    const stack = [];

    const visit = (id) => {
      if (color[id] === BLACK) return;
      if (color[id] === GREY) {
        const at = stack.indexOf(id);
        const loop = stack.slice(at).concat(id).map((k) => this.nodes[k].name);
        throw new Error('import cycle:\n  ' + loop.join('\n  -> '));
      }
      color[id] = GREY;
      stack.push(id);
      for (const d of this.nodes[id].deps) {
        if (d.target !== null) visit(d.target);
      }
      stack.pop();
      color[id] = BLACK;
      order.push(id);
    };

    for (let i = 0; i < this.nodes.length; i++) visit(i);
    return order;
  }
}

/** Replace resolved specifier strings with placeholder tokens. */
function tokenize(node) {
  let out = '';
  let cursor = 0;
  for (const d of node.deps) {
    if (d.target === null) continue; // leave external specifiers verbatim
    out += node.source.slice(cursor, d.start);
    out += JSON.stringify(TOKEN(d.target));
    cursor = d.end;
  }
  out += node.source.slice(cursor);
  return out;
}

/* ==================================================================== */
/* 4. HTML surgery                                                      */
/* ==================================================================== */

function build() {
  const html = fs.readFileSync(ENTRY_HTML, 'utf8');
  const map = readImportMap(html);
  const graph = new Graph(map.imports || {});

  let body = html.replace(/<script[^>]*type=["']importmap["'][^>]*>[\s\S]*?<\/script>\s*/i, '');

  // Every module <script> in the page becomes a graph node, in document order.
  const entries = [];
  const SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  body = body.replace(SCRIPT_RE, (whole, attrs, inner) => {
    if (!/type\s*=\s*["']module["']/i.test(attrs)) return whole;
    const srcAttr = attrs.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
    if (srcAttr) {
      const file = resolveSpecifier(srcAttr[1], ENTRY_HTML, graph.imports);
      if (!file) throw new Error(`index.html: cannot resolve <script src="${srcAttr[1]}">`);
      entries.push(graph.addFile(file).id);
    } else {
      entries.push(graph.addInline(inner, ENTRY_HTML, '<inline module>').id);
    }
    return '';
  });

  const order = graph.topoOrder();

  // Payload, in dependency order.
  const payload = order.map((id) => {
    const node = graph.nodes[id];
    const code = tokenize(node);
    return {
      i: id,
      n: node.name,
      d: node.deps.filter((x) => x.target !== null).map((x) => x.target),
      b: Buffer.from(code, 'utf8').toString('base64'),
    };
  });
  // Deduplicate dependency ids per module (the token replace is global anyway).
  for (const p of payload) p.d = Array.from(new Set(p.d));

  const cameras = (() => {
    const f = path.join(ROOT, 'app', 'cameras.json');
    if (!fs.existsSync(f)) return {};
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  })();

  const boot = `
<script>
/* Generated by tools/bundle.mjs — do not edit. */
window.__CAMERAS__ = ${JSON.stringify(cameras)};
window.__BUNDLED__ = true;
(function () {
  var MODULES = ${JSON.stringify(payload)};
  var ENTRIES = ${JSON.stringify(entries)};
  var dec = new TextDecoder('utf-8');
  function decode(b64) {
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return dec.decode(bytes);
  }
  var urls = {};
  function fail(err) {
    window.__BOOT_ERROR__ = (err && (err.stack || err.message)) || String(err);
    window.__STATUS__ = 'error';
    var o = document.getElementById('overlay');
    var s = document.getElementById('status');
    if (o) { o.classList.remove('hidden'); o.classList.add('error'); }
    if (s) s.textContent = window.__BOOT_ERROR__;
    if (window.console) console.error('[bundle]', err);
  }
  try {
    for (var m = 0; m < MODULES.length; m++) {
      var mod = MODULES[m];
      var code = decode(mod.b);
      for (var k = 0; k < mod.d.length; k++) {
        var dep = mod.d[k];
        code = code.split('__CLBUNDLE_MOD_' + dep + '__').join(urls[dep]);
      }
      urls[mod.i] = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    }
    window.__CLBUNDLE__ = { urls: urls, modules: MODULES.map(function (x) { return x.n; }) };
    (function next(i) {
      if (i >= ENTRIES.length) return;
      import(urls[ENTRIES[i]]).then(function () { next(i + 1); }, fail);
    })(0);
  } catch (err) {
    fail(err);
  }
})();
</script>
`;

  const outHtml = body.replace(/<\/body>/i, boot + '</body>');
  if (outHtml === body) throw new Error('index.html has no </body> to inject into');

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, outHtml);

  return { graph, order, payload, entries, bytes: Buffer.byteLength(outHtml) };
}

/* ==================================================================== */
/* 5. Verify from a real file:// URL                                    */
/* ==================================================================== */

async function verify() {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({
    args: [
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--hide-scrollbars',
    ],
  });
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  const errs = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errs.push('[console] ' + m.text());
  });
  page.on('pageerror', (e) => errs.push('[pageerror] ' + ((e && (e.stack || e.message)) || e)));
  page.on('requestfailed', (r) => {
    // A bundled page must never touch the network. Anything here is a bug,
    // except the deliberately-absent optional modules.
    errs.push('[request] ' + r.url().slice(0, 160));
  });

  const url = pathToFileURL(OUT).href;
  let result;
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 240000 });
    await page.waitForFunction(
      () => window.__READY__ === true || !!window.__BOOT_ERROR__,
      null,
      { timeout: 240000 }
    );
    result = await page.evaluate(() => {
      const out = {
        ready: window.__READY__ === true,
        error: window.__BOOT_ERROR__ || null,
        warnings: (window.__WARNINGS__ || []).slice(),
        modules: (window.__CLBUNDLE__ && window.__CLBUNDLE__.modules.length) || 0,
        presets: window.__APP__ ? window.__APP__.presetIds().length : 0,
      };
      const cv = document.querySelector('canvas');
      if (!cv) return Object.assign(out, { blank: true, reason: 'no canvas' });
      // Non-blank test: sample a grid and measure luminance spread.
      const s = document.createElement('canvas');
      s.width = 160;
      s.height = 110;
      const g = s.getContext('2d', { willReadFrequently: true });
      g.drawImage(cv, 0, 0, s.width, s.height);
      const px = g.getImageData(0, 0, s.width, s.height).data;
      let min = 255, max = 0, sum = 0, n = 0;
      for (let i = 0; i < px.length; i += 4) {
        const l = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
        if (l < min) min = l;
        if (l > max) max = l;
        sum += l;
        n++;
      }
      out.canvas = { w: cv.width, h: cv.height, minL: Math.round(min), maxL: Math.round(max), meanL: +(sum / n).toFixed(1) };
      out.blank = max - min < 6;
      return out;
    });
  } finally {
    await browser.close();
  }

  // Only file:// reads of the bundle itself are acceptable.
  const netErrs = errs.filter((e) => !e.startsWith('[request] file:'));
  return { result, errs: netErrs, url };
}

/* ==================================================================== */
/* main                                                                 */
/* ==================================================================== */

const t0 = Date.now();
const built = build();

log(`bundled ${built.payload.length} modules -> ${path.relative(ROOT, OUT)} (${(built.bytes / 1048576).toFixed(2)} MB)`);
if (built.graph.external.size) {
  log('  left as unresolved (guarded by try/catch at runtime):');
  for (const e of built.graph.external) log('    ' + e);
}

if (!VERIFY) {
  log(`done in ${Date.now() - t0} ms (not verified)`);
  process.exit(0);
}

const { result, errs, url } = await verify();
log(`  verified from ${url}`);
log('  ' + JSON.stringify(result));
for (const e of errs) log('  ' + e);

if (!result.ready) {
  console.error('BUNDLE FAILED: window.__READY__ never became true');
  if (result.error) console.error(result.error);
  process.exit(1);
}
if (result.blank) {
  console.error('BUNDLE FAILED: the canvas is blank (' + JSON.stringify(result.canvas) + ')');
  process.exit(1);
}
log(`done in ${Date.now() - t0} ms`);
