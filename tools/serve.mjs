#!/usr/bin/env node
/**
 * tools/serve.mjs — the dependency-free static dev server for 1430 Country Ln.
 *
 *   node tools/serve.mjs            # http://127.0.0.1:8173
 *   node tools/serve.mjs 9000       # explicit port
 *   node tools/serve.mjs --port 0   # ephemeral port (prints the real one)
 *   node tools/serve.mjs --open app/index.html
 *
 * Serves the WHOLE repository root, which is what makes the import map in
 * app/index.html work:  "three" -> /node_modules/three/build/three.module.js.
 * There is no build step and no dependency: node:http only.
 *
 * Everything is served with `Cache-Control: no-store`. The screenshot harness
 * runs this hundreds of times against files that change between runs; a cached
 * module is a silently wrong render.
 *
 * Programmatic use (tools/shoot.mjs, tools/bundle.mjs):
 *
 *   import { startServer } from './serve.mjs';
 *   const srv = await startServer({ port: 0 });
 *   srv.url;            // http://127.0.0.1:41235
 *   await srv.close();
 */

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

export const DEFAULT_PORT = 8173;

/* ======================================================================== */
/* MIME                                                                      */
/* ======================================================================== */

export const MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.glsl': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
});

export function mimeFor(file) {
  return MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

/* ======================================================================== */
/* Path resolution                                                           */
/* ======================================================================== */

/**
 * Map a request URL to an absolute path inside ROOT, or null when the request
 * escapes the root (`..`, absolute paths, encoded traversal, symlink games).
 */
export function resolveRequestPath(urlPath, root = ROOT) {
  let pathname;
  try {
    pathname = decodeURIComponent(String(urlPath).split('?')[0].split('#')[0]);
  } catch {
    return null; // malformed percent-encoding
  }
  if (pathname.indexOf('\0') !== -1) return null;
  // Normalise to a repo-relative path and refuse anything that climbs out.
  const rel = path.normalize(pathname).replace(/^([/\\])+/, '');
  if (rel === '..' || rel.startsWith('..' + path.sep)) return null;
  const abs = path.resolve(root, rel);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (abs !== root && !abs.startsWith(rootWithSep)) return null;
  return abs;
}

const NO_CACHE = Object.freeze({
  'cache-control': 'no-store, no-cache, must-revalidate, max-age=0',
  pragma: 'no-cache',
  expires: '0',
});

function head(extra) {
  return Object.assign({}, NO_CACHE, extra);
}

async function statOrNull(p) {
  try {
    return await fsp.stat(p);
  } catch {
    return null;
  }
}

/* ======================================================================== */
/* Directory index (handy in dev, never used by the harness)                 */
/* ======================================================================== */

async function directoryListing(abs, urlPath) {
  const entries = await fsp.readdir(abs, { withFileTypes: true });
  entries.sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1));
  const base = urlPath.endsWith('/') ? urlPath : urlPath + '/';
  const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const rows = entries
    .filter((e) => e.name !== '.git')
    .map((e) => {
      const name = e.name + (e.isDirectory() ? '/' : '');
      return `<li><a href="${esc(base + encodeURIComponent(e.name) + (e.isDirectory() ? '/' : ''))}">${esc(name)}</a></li>`;
    })
    .join('\n');
  return `<!doctype html><meta charset="utf-8"><title>${esc(base)}</title>
<style>body{font:14px/1.6 ui-monospace,Menlo,Consolas,monospace;margin:2rem;background:#14161a;color:#d8dbe0}
a{color:#7fb8ff;text-decoration:none}a:hover{text-decoration:underline}ul{list-style:none;padding:0}</style>
<h1>${esc(base)}</h1><ul>${base === '/' ? '' : '<li><a href="../">../</a></li>'}${rows}</ul>`;
}

/* ======================================================================== */
/* Request handler                                                           */
/* ======================================================================== */

export function createRequestHandler({ root = ROOT, quiet = true, index = 'index.html' } = {}) {
  return async function handle(req, res) {
    const started = Date.now();
    const urlPath = (req.url || '/').split('?')[0];

    const send = (code, body, headers) => {
      res.writeHead(code, head(headers));
      if (req.method === 'HEAD') res.end();
      else res.end(body);
      if (!quiet) {
        process.stdout.write(`${code} ${req.method} ${req.url} ${Date.now() - started}ms\n`);
      }
    };

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      send(405, 'method not allowed', { 'content-type': 'text/plain; charset=utf-8', allow: 'GET, HEAD' });
      return;
    }

    const abs = resolveRequestPath(urlPath, root);
    if (!abs) {
      send(403, 'forbidden', { 'content-type': 'text/plain; charset=utf-8' });
      return;
    }

    let st = await statOrNull(abs);

    // Directory: redirect to a trailing slash, then try index.html, then list.
    if (st && st.isDirectory()) {
      if (!urlPath.endsWith('/')) {
        res.writeHead(301, head({ location: urlPath + '/' }));
        res.end();
        return;
      }
      const idx = path.join(abs, index);
      const idxSt = await statOrNull(idx);
      if (idxSt && idxSt.isFile()) {
        await sendFile(req, res, idx, idxSt, quiet, started);
        return;
      }
      try {
        send(200, await directoryListing(abs, urlPath), { 'content-type': MIME['.html'] });
      } catch (e) {
        send(500, String((e && e.message) || e), { 'content-type': 'text/plain; charset=utf-8' });
      }
      return;
    }

    if (!st) {
      send(404, `404 not found: ${urlPath}`, { 'content-type': 'text/plain; charset=utf-8' });
      return;
    }

    await sendFile(req, res, abs, st, quiet, started);
  };
}

function sendFile(req, res, abs, st, quiet, started) {
  return new Promise((resolve) => {
    const headers = head({
      'content-type': mimeFor(abs),
      'content-length': String(st.size),
      'last-modified': st.mtime.toUTCString(),
      'access-control-allow-origin': '*',
    });
    res.writeHead(200, headers);
    if (req.method === 'HEAD') {
      res.end();
      if (!quiet) process.stdout.write(`200 HEAD ${req.url} ${Date.now() - started}ms\n`);
      resolve();
      return;
    }
    const stream = fs.createReadStream(abs);
    stream.on('error', (err) => {
      // Headers are already out; the only honest thing left is to cut the wire.
      res.destroy(err);
      resolve();
    });
    stream.on('close', () => {
      if (!quiet) process.stdout.write(`200 GET ${req.url} ${st.size}b ${Date.now() - started}ms\n`);
      resolve();
    });
    stream.pipe(res);
  });
}

/* ======================================================================== */
/* Server lifecycle                                                          */
/* ======================================================================== */

/**
 * Start the static server.
 *
 * @param {object} [o]
 * @param {number} [o.port=8173]  0 picks an ephemeral port
 * @param {string} [o.host='127.0.0.1']
 * @param {string} [o.root]       defaults to the repo root
 * @param {boolean}[o.quiet=true] log every request when false
 * @returns {Promise<{server: import('node:http').Server, port: number,
 *                    host: string, url: string, root: string, close: () => Promise<void>}>}
 */
export async function startServer({ port = DEFAULT_PORT, host = '127.0.0.1', root = ROOT, quiet = true } = {}) {
  const handler = createRequestHandler({ root, quiet });
  const server = http.createServer((req, res) => {
    handler(req, res).catch((err) => {
      try {
        res.writeHead(500, head({ 'content-type': 'text/plain; charset=utf-8' }));
        res.end(String((err && err.stack) || err));
      } catch {
        /* response already destroyed */
      }
    });
  });
  // Long-lived module loads over software GL can idle; don't guillotine them.
  server.keepAliveTimeout = 120000;
  server.headersTimeout = 125000;
  server.requestTimeout = 0;

  await new Promise((resolve, reject) => {
    const onError = (err) => {
      server.removeListener('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.removeListener('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });

  const actual = server.address().port;
  const sockets = new Set();
  server.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });

  return {
    server,
    port: actual,
    host,
    root,
    url: `http://${host}:${actual}`,
    async close() {
      for (const s of sockets) s.destroy();
      sockets.clear();
      await new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

/* ======================================================================== */
/* CLI                                                                       */
/* ======================================================================== */

function parseCliPort(argv) {
  const i = argv.indexOf('--port');
  if (i !== -1 && argv[i + 1] !== undefined) return Number(argv[i + 1]);
  const bare = argv.find((a) => /^\d+$/.test(a));
  if (bare !== undefined) return Number(bare);
  if (process.env.PORT) return Number(process.env.PORT);
  return DEFAULT_PORT;
}

const isMain = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(path.resolve(entry)).href;
  } catch {
    return false;
  }
})();

if (isMain) {
  const argv = process.argv.slice(2);
  const port = parseCliPort(argv);
  const quiet = argv.indexOf('--verbose') === -1 && argv.indexOf('-v') === -1;
  const host = (() => {
    const i = argv.indexOf('--host');
    return i !== -1 && argv[i + 1] ? argv[i + 1] : '127.0.0.1';
  })();

  const srv = await startServer({ port, host, quiet });
  console.log(`serving ${srv.root}`);
  console.log(`  ${srv.url}/app/index.html`);
  console.log(`  ${srv.url}/         (directory index)`);
  if (!quiet) console.log('  request logging ON');

  const bye = async () => {
    await srv.close();
    process.exit(0);
  };
  process.on('SIGINT', bye);
  process.on('SIGTERM', bye);
}
