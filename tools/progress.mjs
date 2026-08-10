#!/usr/bin/env node
/* =====================================================================
 * tools/progress.mjs — build the live progress dashboard
 * ---------------------------------------------------------------------
 * Reads status.json and writes progress.html at the repo root.  The page
 * is a single self-contained file (no libraries, no network) that:
 *
 *   · groups the judged pieces by level,
 *   · shows the real listing photo and the latest render side by side at
 *     equal height, with a draggable split wipe on click and an A/B flip
 *     on hover,
 *   · shows each round's "biggest remaining gap" as a history strip,
 *   · re-fetches status.json every 5 s and repaints only the cards that
 *     actually changed (so a drag in progress is never blown away),
 *   · falls back to an inlined snapshot when fetch is unavailable, which
 *     is what happens under file://.
 *
 * USAGE
 *   node tools/progress.mjs                       # -> progress.html
 *   node tools/progress.mjs --status foo.json --out /tmp/p.html
 *   node tools/progress.mjs --watch               # rebuild on status change
 * =================================================================== */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

/* ------------------------------------------------------------------ */
/* args                                                                */
/* ------------------------------------------------------------------ */

function parseArgs(argv) {
  const flags = Object.create(null);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    let key = a.slice(2);
    let val;
    const eq = key.indexOf('=');
    if (eq !== -1) {
      val = key.slice(eq + 1);
      key = key.slice(0, eq);
    } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
      val = argv[++i];
    } else {
      val = true;
    }
    flags[key] = val;
  }
  return flags;
}

const FLAGS = parseArgs(process.argv.slice(2));
const STATUS_PATH = path.resolve(
  ROOT,
  FLAGS.status && FLAGS.status !== true ? String(FLAGS.status) : 'status.json'
);
const OUT_PATH = path.resolve(
  ROOT,
  FLAGS.out && FLAGS.out !== true ? String(FLAGS.out) : 'progress.html'
);
/* Where the page will fetch fresh status from, relative to the html file. */
const STATUS_URL = (() => {
  const rel = path.relative(path.dirname(OUT_PATH), STATUS_PATH);
  return rel.split(path.sep).join('/') || 'status.json';
})();

/* ------------------------------------------------------------------ */
/* snapshot                                                            */
/* ------------------------------------------------------------------ */

function loadStatus() {
  const raw = fs.readFileSync(STATUS_PATH, 'utf8');
  const data = JSON.parse(raw);
  if (!data || !Array.isArray(data.pieces)) {
    throw new Error(`${STATUS_PATH} has no "pieces" array`);
  }
  // Re-stat every render so the snapshot's cache-busting stamps are fresh
  // even if the last writer forgot to run `status.mjs touch`.
  for (const p of data.pieces) {
    if (!p.render) continue;
    try {
      p.renderStamp = Math.round(fs.statSync(path.join(ROOT, p.render)).mtimeMs);
    } catch {
      p.renderStamp = 0;
    }
  }
  return data;
}

/** Embed a JS string literal that is safe inside <script>. */
function jsString(str) {
  return JSON.stringify(str)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/* ------------------------------------------------------------------ */
/* CSS                                                                 */
/* ------------------------------------------------------------------ */

const CSS = String.raw`
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0}

:root{
  color-scheme: dark;
  --bg:#0a0c10;
  --bg-glow-a:#16283f;
  --bg-glow-b:#1d1830;
  --panel:#12161c;
  --panel-2:#161b23;
  --panel-3:#1b2129;
  --line:#242c37;
  --line-soft:#1c232c;
  --text:#e9eef6;
  --text-2:#aab6c6;
  --text-3:#75849a;
  --accent:#6ea8fe;
  --shadow:0 1px 2px rgba(0,0,0,.5),0 12px 32px -18px rgba(0,0,0,.9);
  --v-pending:#7c8899;
  --v-picked:#e8a33d;
  --v-unsure:#3fb950;
  --v-fooled:#a371f7;
  --grid-min:520px;
}
`;

const CSS_LIGHT = String.raw`
  color-scheme: light;
  --bg:#f4f6fa;
  --bg-glow-a:#dbe6f7;
  --bg-glow-b:#e6e0f5;
  --panel:#ffffff;
  --panel-2:#f7f9fc;
  --panel-3:#eef2f8;
  --line:#d9e0ea;
  --line-soft:#e6ebf2;
  --text:#101720;
  --text-2:#4a5766;
  --text-3:#75849a;
  --accent:#2f6feb;
  --shadow:0 1px 2px rgba(16,23,32,.06),0 10px 28px -18px rgba(16,23,32,.4);
  --v-pending:#8b96a5;
  --v-picked:#b3730c;
  --v-unsure:#1a7f37;
  --v-fooled:#7b48d3;
`;

const CSS_MAIN = String.raw`
body{
  font:15px/1.5 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,"Helvetica Neue",Arial,sans-serif;
  color:var(--text);
  background:var(--bg);
  overflow-x:hidden;
  -webkit-font-smoothing:antialiased;
}
body::before{
  content:"";position:fixed;inset:0;z-index:-1;pointer-events:none;
  background:
    radial-gradient(1100px 620px at 12% -12%, var(--bg-glow-a) 0%, transparent 62%),
    radial-gradient(900px 560px at 92% 0%, var(--bg-glow-b) 0%, transparent 60%);
  opacity:1;
}
h1,h2,h3{margin:0;font-weight:640;letter-spacing:-.012em}
a{color:var(--accent)}

.wrap{max-width:1680px;margin:0 auto;padding:0 clamp(14px,2.4vw,34px) 72px}

/* ---------- header ---------- */
.top{
  position:sticky;top:0;z-index:40;
  margin:0 calc(-1 * clamp(14px,2.4vw,34px));
  padding:16px clamp(14px,2.4vw,34px) 14px;
  background:color-mix(in srgb, var(--bg) 78%, transparent);
  backdrop-filter:blur(14px) saturate(1.3);
  -webkit-backdrop-filter:blur(14px) saturate(1.3);
  border-bottom:1px solid var(--line-soft);
}
.top-row{display:flex;flex-wrap:wrap;gap:18px 26px;align-items:flex-end;justify-content:space-between}
.brand{min-width:0}
.brand h1{font-size:clamp(19px,2.1vw,25px);display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.brand h1 .addr{
  font-variant-numeric:tabular-nums;
  background:linear-gradient(96deg,var(--text),var(--text-2));
  -webkit-background-clip:text;background-clip:text;color:transparent;
}
.brand .sub{margin-top:5px;color:var(--text-3);font-size:12.5px;letter-spacing:.02em}
.brand .sub b{color:var(--text-2);font-weight:600}

.score{display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.score .big{display:flex;align-items:baseline;gap:7px;line-height:1}
.score .big .n{font-size:clamp(28px,3.6vw,40px);font-weight:700;letter-spacing:-.03em;font-variant-numeric:tabular-nums}
.score .big .d{font-size:15px;color:var(--text-3);font-variant-numeric:tabular-nums}
.score .big .lbl{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--text-3);margin-left:4px}

.meter{width:min(340px,42vw);min-width:190px}
.meter .bar{display:flex;height:9px;border-radius:99px;overflow:hidden;background:var(--panel-3);box-shadow:inset 0 0 0 1px var(--line-soft)}
.meter .bar i{display:block;height:100%;transition:width .5s cubic-bezier(.4,0,.2,1)}
.meter .cap{display:flex;justify-content:space-between;gap:10px;margin-top:6px;font-size:11px;color:var(--text-3)}

.botrow{display:flex;gap:12px 18px;flex-wrap:wrap;align-items:center;justify-content:space-between;margin-top:12px}
.legend{display:flex;gap:7px;flex-wrap:wrap}
.legend .chip{cursor:default}
.legend .chip .ct{opacity:.72;font-variant-numeric:tabular-nums}

.nav{display:flex;gap:6px;flex-wrap:wrap}
.nav a{
  text-decoration:none;font-size:11.5px;color:var(--text-2);
  border:1px solid var(--line);background:var(--panel-2);border-radius:8px;padding:5px 9px;
  display:inline-flex;gap:7px;align-items:center;transition:.16s;white-space:nowrap;
}
.nav a:hover{color:var(--text);border-color:var(--accent);background:var(--panel-3)}
.nav a b{font-weight:600;font-variant-numeric:tabular-nums;color:var(--text-3)}

.tools{display:flex;gap:8px;align-items:center}
.btn{
  appearance:none;border:1px solid var(--line);background:var(--panel-2);color:var(--text-2);
  font:inherit;font-size:12px;line-height:1;padding:8px 11px;border-radius:9px;cursor:pointer;
  display:inline-flex;align-items:center;gap:7px;transition:.16s;white-space:nowrap;
}
.btn:hover{color:var(--text);border-color:var(--accent);background:var(--panel-3)}
.btn .dot{width:7px;height:7px;border-radius:99px;background:var(--v-unsure);box-shadow:0 0 0 3px color-mix(in srgb,var(--v-unsure) 22%,transparent)}
.btn.stale .dot{background:var(--v-picked);box-shadow:0 0 0 3px color-mix(in srgb,var(--v-picked) 22%,transparent)}
.btn.offline .dot{background:var(--v-pending);box-shadow:none}

/* ---------- verdict chips ---------- */
.chip{
  display:inline-flex;align-items:center;gap:6px;
  font-size:11px;font-weight:600;letter-spacing:.03em;
  padding:4px 9px;border-radius:99px;white-space:nowrap;
  border:1px solid color-mix(in srgb, var(--c) 40%, transparent);
  background:color-mix(in srgb, var(--c) 15%, transparent);
  color:color-mix(in srgb, var(--c) 82%, var(--text));
}
.chip::before{content:"";width:6px;height:6px;border-radius:99px;background:var(--c);flex:none}
.chip[data-v="PENDING"]{--c:var(--v-pending)}
.chip[data-v="PICKED_RENDER"]{--c:var(--v-picked)}
.chip[data-v="UNSURE"]{--c:var(--v-unsure)}
.chip[data-v="PICKED_PHOTO_AS_RENDER"]{--c:var(--v-fooled)}

/* ---------- level sections ---------- */
.level{margin-top:38px;scroll-margin-top:132px}
.level-hd{display:flex;align-items:center;gap:14px;margin-bottom:16px}
.level-hd h2{font-size:13px;letter-spacing:.17em;text-transform:uppercase;color:var(--text-2);white-space:nowrap}
.level-hd .rule{flex:1;height:1px;background:linear-gradient(90deg,var(--line),transparent)}
.level-hd .tally{font-size:12px;color:var(--text-3);font-variant-numeric:tabular-nums;white-space:nowrap}
.level-hd .tally b{color:var(--text-2);font-weight:600}

.grid{display:grid;gap:clamp(12px,1.5vw,20px);align-items:start;
  grid-template-columns:repeat(auto-fill,minmax(min(100%,var(--grid-min)),1fr))}

/* ---------- card ---------- */
.card{
  min-width:0;scroll-margin-top:150px;
  background:linear-gradient(180deg,var(--panel-2),var(--panel));
  border:1px solid var(--line);border-radius:15px;overflow:hidden;
  box-shadow:var(--shadow);
  display:flex;flex-direction:column;
  transition:border-color .18s, transform .18s;
}
.card:hover{border-color:color-mix(in srgb,var(--line) 55%, var(--accent));transform:translateY(-1px)}
.card::before{
  content:"";display:block;height:2px;flex:none;
  background:linear-gradient(90deg,var(--c,var(--v-pending)),transparent 78%);
  opacity:.75;
}
.card[data-v="PENDING"]{--c:var(--v-pending)}
.card[data-v="PICKED_RENDER"]{--c:var(--v-picked)}
.card[data-v="UNSURE"]{--c:var(--v-unsure)}
.card[data-v="PICKED_PHOTO_AS_RENDER"]{--c:var(--v-fooled)}

.card-hd{display:flex;align-items:flex-start;gap:10px;padding:13px 14px 11px}
.card-hd .t{min-width:0;flex:1}
.card-hd h3{font-size:15.5px;line-height:1.25;overflow-wrap:anywhere}
.card-hd .meta{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:5px;font-size:11.5px;color:var(--text-3)}
.card-hd .dims{font-variant-numeric:tabular-nums;color:var(--text-2)}
.card-hd .sep{opacity:.45}
.card-hd .badges{display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex:none}
.round{
  font-size:10.5px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;
  color:var(--text-3);background:var(--panel-3);border:1px solid var(--line-soft);
  padding:3px 7px;border-radius:6px;font-variant-numeric:tabular-nums;
}

/* ---------- stage ---------- */
.stage{position:relative;background:#05070a;border-block:1px solid var(--line-soft);user-select:none}
:root[data-theme="light"] .stage{background:#dde3ec}
@media (prefers-color-scheme: light){:root:not([data-theme="dark"]) .stage{background:#dde3ec}}

.pair{display:grid;grid-template-columns:1fr 1fr;gap:1px;cursor:zoom-in}
.pane{position:relative;margin:0;aspect-ratio:3/2;overflow:hidden;background:var(--panel-3)}
.pane img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}
.pane img.flip{opacity:0;transition:opacity .17s ease}
.pane:hover img.flip{opacity:1}
.pane .tag{
  position:absolute;left:7px;top:7px;z-index:3;
  font-size:9.5px;font-weight:700;letter-spacing:.13em;text-transform:uppercase;
  padding:3px 7px;border-radius:5px;color:#fff;
  background:rgba(8,11,16,.66);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.14);
}
.pane .tag .a{display:inline}
.pane .tag .b{display:none;color:#ffd9a0}
.pane:hover .tag .a{display:none}
.pane:hover .tag .b{display:inline}
.pane[data-side="render"] .tag{left:auto;right:7px}
.pane.empty{display:flex;align-items:center;justify-content:center;
  background:repeating-linear-gradient(45deg,var(--panel-2) 0 9px,var(--panel-3) 9px 18px)}
.pane.empty span{font-size:11px;letter-spacing:.11em;text-transform:uppercase;color:var(--text-3);text-align:center;
  padding:9px 14px;border:1px dashed var(--line);border-radius:9px;background:color-mix(in srgb,var(--panel) 70%,transparent)}
.pane.empty img,.pane.empty .tag{display:none}

.split{display:none;position:relative;aspect-ratio:3/2;overflow:hidden;cursor:ew-resize;touch-action:none}
.split img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}
.split .over{clip-path:inset(0 0 0 var(--p,50%))}
.split .bar{position:absolute;top:0;bottom:0;left:var(--p,50%);width:2px;background:rgba(255,255,255,.92);
  box-shadow:0 0 0 1px rgba(0,0,0,.45),0 0 16px rgba(0,0,0,.5);transform:translateX(-1px);z-index:4}
.split .knob{
  position:absolute;top:50%;left:var(--p,50%);transform:translate(-50%,-50%);z-index:5;
  width:34px;height:34px;border-radius:99px;background:rgba(255,255,255,.94);
  box-shadow:0 2px 10px rgba(0,0,0,.55);
  display:flex;align-items:center;justify-content:center;gap:3px;color:#0d1116;font-size:11px;
}
.split .knob::before{content:"◀"}.split .knob::after{content:"▶"}
.split .lbl{
  position:absolute;bottom:8px;z-index:4;font-size:9.5px;font-weight:700;letter-spacing:.13em;
  text-transform:uppercase;color:#fff;padding:3px 7px;border-radius:5px;background:rgba(8,11,16,.66);
  backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);box-shadow:inset 0 0 0 1px rgba(255,255,255,.14);
}
.split .lbl.l{left:8px}.split .lbl.r{right:8px}
.stage.compare .pair{display:none}
.stage.compare .split{display:block}

.hint{
  position:absolute;left:50%;bottom:8px;transform:translateX(-50%);z-index:6;
  font-size:10px;letter-spacing:.09em;text-transform:uppercase;color:rgba(255,255,255,.82);
  background:rgba(8,11,16,.6);border-radius:6px;padding:3px 9px;pointer-events:none;
  opacity:0;transition:opacity .18s;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.12);
}
.stage:hover .hint{opacity:1}
.stage.compare:hover .hint{opacity:0}
.exit{
  position:absolute;right:7px;top:7px;z-index:7;display:none;
  width:24px;height:24px;border-radius:7px;align-items:center;justify-content:center;
  border:0;cursor:pointer;color:#fff;background:rgba(8,11,16,.66);font-size:13px;line-height:1;
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.16);
}
.stage.compare .exit{display:flex}

/* ---------- gap + history ---------- */
.body{padding:12px 14px 13px;display:flex;flex-direction:column;gap:11px;flex:1}
.gap{
  margin:0;position:relative;padding:9px 11px 9px 13px;border-radius:9px;
  background:color-mix(in srgb,var(--c,var(--v-pending)) 8%, var(--panel-3));
  border:1px solid color-mix(in srgb,var(--c,var(--v-pending)) 22%, transparent);
  font-size:13.2px;line-height:1.5;color:var(--text);
}
.gap::before{content:"";position:absolute;left:0;top:8px;bottom:8px;width:2px;border-radius:2px;background:var(--c,var(--v-pending));opacity:.75}
.gap .k{display:block;font-size:9.5px;letter-spacing:.13em;text-transform:uppercase;color:var(--text-3);margin-bottom:4px;font-weight:700}
.gap.none{color:var(--text-3);font-style:italic;background:var(--panel-3);border-style:dashed}

.hist{display:flex;flex-direction:column;gap:6px}
.hist .k{font-size:9.5px;letter-spacing:.13em;text-transform:uppercase;color:var(--text-3);font-weight:700;
  display:flex;align-items:center;gap:8px}
.hist .k .rule{flex:1;height:1px;background:var(--line-soft)}
.hist .wrapstrip{position:relative;min-width:0}
.hist .wrapstrip::after{content:"";position:absolute;right:0;top:0;bottom:6px;width:34px;pointer-events:none;
  background:linear-gradient(90deg,transparent,var(--panel))}
.hist .strip{display:flex;gap:8px;overflow-x:auto;padding-bottom:4px;scrollbar-width:thin;scroll-snap-type:x proximity}
.hist .strip::-webkit-scrollbar{height:6px}
.hist .strip::-webkit-scrollbar-thumb{background:var(--line);border-radius:99px}
.hist .it{
  flex:0 0 208px;scroll-snap-align:start;min-width:0;
  background:var(--panel-3);border:1px solid var(--line-soft);border-radius:9px;padding:7px 9px;
}
.hist .it .rh{display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:4px}
.hist .it .r{font-size:9.5px;font-weight:700;letter-spacing:.09em;color:var(--text-3);font-variant-numeric:tabular-nums}
.hist .it .v{width:7px;height:7px;border-radius:99px;background:var(--hc,var(--v-pending));flex:none}
.hist .it p{margin:0;font-size:11.6px;line-height:1.45;color:var(--text-2);
  display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}
.hist .none{font-size:11.5px;color:var(--text-3);font-style:italic}

.notes{display:flex;flex-wrap:wrap;gap:6px}
.notes .n{font-size:11px;color:var(--text-2);background:var(--panel-3);border:1px solid var(--line-soft);
  border-radius:7px;padding:4px 8px;max-width:100%;overflow-wrap:anywhere}
.notes .n b{color:var(--text-3);font-weight:700;font-size:9.5px;letter-spacing:.08em;margin-right:5px}

.photos{font-size:11px;color:var(--text-3);display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.photos b{color:var(--text-2);font-weight:600;font-variant-numeric:tabular-nums}

footer.foot{margin-top:46px;padding-top:16px;border-top:1px solid var(--line-soft);
  font-size:11.5px;color:var(--text-3);display:flex;flex-wrap:wrap;gap:10px 20px;justify-content:space-between}
code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px;
  background:var(--panel-3);border:1px solid var(--line-soft);border-radius:5px;padding:1px 5px}

@media (max-width:560px){
  :root{--grid-min:280px}
  .pair{grid-template-columns:1fr}
  .top-row{gap:12px}
  .meter{width:100%}
}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
`;

/* ------------------------------------------------------------------ */
/* client script                                                       */
/* ------------------------------------------------------------------ */

const CLIENT_JS = String.raw`
(function () {
  'use strict';

  var LEVELS = [
    { id: 'exterior', name: 'Exterior' },
    { id: 'first',    name: 'First Floor' },
    { id: 'second',   name: 'Second Floor' },
    { id: 'basement', name: 'Basement' }
  ];
  var VERDICTS = [
    { id: 'PICKED_PHOTO_AS_RENDER', label: 'Fooled the critic', short: 'Fooled',  pass: true  },
    { id: 'UNSURE',                 label: 'Critic unsure',     short: 'Unsure',  pass: true  },
    { id: 'PICKED_RENDER',          label: 'Spotted — rework',  short: 'Spotted', pass: false },
    { id: 'PENDING',                label: 'Not yet judged',    short: 'Pending', pass: false }
  ];
  var VMAP = {}; VERDICTS.forEach(function (v) { VMAP[v.id] = v; });
  var VVAR = {
    PENDING: 'var(--v-pending)', PICKED_RENDER: 'var(--v-picked)',
    UNSURE: 'var(--v-unsure)', PICKED_PHOTO_AS_RENDER: 'var(--v-fooled)'
  };

  /* ---------- tiny DOM helper ---------- */
  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === 'text') el.textContent = v;
      else if (k === 'class') el.className = v;
      else if (k === 'style') el.setAttribute('style', v);
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    if (kids) for (var i = 0; i < kids.length; i++) {
      var c = kids[i];
      if (c === null || c === undefined || c === false) continue;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return el;
  }
  function bust(url, stamp) {
    if (!url) return '';
    return url + (url.indexOf('?') === -1 ? '?' : '&') + 't=' + (stamp || 0);
  }
  function ago(iso) {
    var t = Date.parse(iso);
    if (!isFinite(t)) return String(iso || 'unknown');
    var s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 45) return 'just now';
    if (s < 90) return 'a minute ago';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    if (s < 5400) return 'an hour ago';
    if (s < 86400) return Math.round(s / 3600) + ' hours ago';
    if (s < 172800) return 'yesterday';
    return Math.round(s / 86400) + ' days ago';
  }
  function isPass(v) { return !!(VMAP[v] && VMAP[v].pass); }
  function fileOf(p) { return String(p || '').split('/').pop(); }

  /* ---------- theme ---------- */
  var THEMES = ['auto', 'dark', 'light'];
  var THEME_ICON = { auto: 'auto', dark: 'dark', light: 'light' };
  function applyTheme(t) {
    var r = document.documentElement;
    if (t === 'auto') r.removeAttribute('data-theme'); else r.setAttribute('data-theme', t);
    var b = document.getElementById('themeBtn');
    if (b) b.textContent = 'theme: ' + THEME_ICON[t];
  }
  var theme = 'auto';
  try { theme = localStorage.getItem('cl-progress-theme') || 'auto'; } catch (e) {}
  if (THEMES.indexOf(theme) === -1) theme = 'auto';

  /* ---------- state ---------- */
  var state = { data: null, live: false, fails: 0, cards: {} };

  /* =================================================================
   * card
   * ================================================================= */

  function stage(p) {
    var photo = bust(p.photo, 0);
    var hasRender = !!p.render && (p.renderStamp || 0) > 0;
    var render = hasRender ? bust(p.render, p.renderStamp) : '';

    var st = h('div', { class: 'stage' });

    /* -- side by side, with hover A/B flip -- */
    var panePhoto = h('figure', { class: 'pane', 'data-side': 'photo' }, [
      h('img', { src: photo, alt: p.title + ' — listing photo', loading: 'lazy', decoding: 'async' }),
      hasRender ? h('img', { class: 'flip', src: render, alt: '', loading: 'lazy', decoding: 'async' }) : null,
      h('span', { class: 'tag' }, [
        h('span', { class: 'a', text: 'Photo' }),
        h('span', { class: 'b', text: hasRender ? 'Render ⇄' : 'Photo' })
      ])
    ]);

    var paneRender;
    if (hasRender) {
      paneRender = h('figure', { class: 'pane', 'data-side': 'render' }, [
        h('img', { src: render, alt: p.title + ' — latest render', loading: 'lazy', decoding: 'async',
          onerror: function () { paneRender.className = 'pane empty'; } }),
        h('img', { class: 'flip', src: photo, alt: '', loading: 'lazy', decoding: 'async' }),
        h('span', { class: 'tag' }, [
          h('span', { class: 'a', text: 'Render' }),
          h('span', { class: 'b', text: 'Photo ⇄' })
        ])
      ]);
    } else {
      paneRender = h('figure', { class: 'pane empty', 'data-side': 'render' }, [
        h('span', { text: 'no render yet' })
      ]);
    }

    var pair = h('div', { class: 'pair' }, [panePhoto, paneRender]);
    st.appendChild(pair);

    /* -- split wipe -- */
    if (hasRender) {
      var over = h('img', { class: 'over', src: render, alt: '', loading: 'lazy', decoding: 'async' });
      var bar = h('i', { class: 'bar' });
      var knob = h('i', { class: 'knob' });
      var split = h('div', { class: 'split', style: '--p:50%', tabindex: '0',
                             role: 'slider', 'aria-label': 'photo / render wipe',
                             'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '50' }, [
        h('img', { src: photo, alt: '', loading: 'lazy', decoding: 'async' }),
        over, bar, knob,
        h('span', { class: 'lbl l', text: 'Photo' }),
        h('span', { class: 'lbl r', text: 'Render' })
      ]);

      var pct = 50, dragging = false;
      function setP(v) {
        pct = Math.max(0, Math.min(100, v));
        split.style.setProperty('--p', pct.toFixed(2) + '%');
        split.setAttribute('aria-valuenow', Math.round(pct));
      }
      function fromEvent(e) {
        var r = split.getBoundingClientRect();
        if (!r.width) return;
        setP(((e.clientX - r.left) / r.width) * 100);
      }
      split.addEventListener('pointerdown', function (e) {
        dragging = true;
        try { split.setPointerCapture(e.pointerId); } catch (err) {}
        fromEvent(e); e.preventDefault();
      });
      split.addEventListener('pointermove', function (e) { if (dragging) fromEvent(e); });
      function stop(e) {
        if (!dragging) return;
        dragging = false;
        try { split.releasePointerCapture(e.pointerId); } catch (err) {}
      }
      split.addEventListener('pointerup', stop);
      split.addEventListener('pointercancel', stop);
      split.addEventListener('keydown', function (e) {
        var d = e.shiftKey ? 10 : 2;
        if (e.key === 'ArrowLeft') { setP(pct - d); e.preventDefault(); }
        else if (e.key === 'ArrowRight') { setP(pct + d); e.preventDefault(); }
        else if (e.key === 'Home') { setP(0); e.preventDefault(); }
        else if (e.key === 'End') { setP(100); e.preventDefault(); }
        else if (e.key === 'Escape') { leave(); }
      });
      st.appendChild(split);

      var exit = h('button', { class: 'exit', type: 'button', title: 'exit compare',
                               'aria-label': 'exit compare', text: '✕' });
      st.appendChild(exit);

      function enter() { st.classList.add('compare'); setP(50); split.focus({ preventScroll: true }); }
      function leave() { st.classList.remove('compare'); }
      exit.addEventListener('click', function (e) { e.stopPropagation(); leave(); });
      pair.addEventListener('click', enter);

      st.appendChild(h('span', { class: 'hint', text: 'click to wipe' }));
    } else {
      st.appendChild(h('span', { class: 'hint', text: 'awaiting first render' }));
    }
    return st;
  }

  function card(p) {
    var v = VMAP[p.verdict] || VMAP.PENDING;
    var hist = (p.history || []).slice().sort(function (a, b) { return (a.round || 0) - (b.round || 0); });
    var notes = p.notes || [];
    var nPhotos = (p.allPhotos || []).length;

    var el = h('article', { class: 'card', 'data-v': p.verdict || 'PENDING', id: 'piece-' + p.id }, [
      h('header', { class: 'card-hd' }, [
        h('div', { class: 't' }, [
          h('h3', { text: p.title || p.id }),
          h('div', { class: 'meta' }, [
            p.dims ? h('span', { class: 'dims', text: p.dims }) : null,
            p.dims ? h('span', { class: 'sep', text: '·' }) : null,
            h('span', { text: p.id }),
            typeof p.confidence === 'number' ? h('span', { class: 'sep', text: '·' }) : null,
            typeof p.confidence === 'number'
              ? h('span', { text: 'confidence ' + Math.round(p.confidence * 100) + '%' }) : null
          ])
        ]),
        h('div', { class: 'badges' }, [
          h('span', { class: 'chip', 'data-v': p.verdict || 'PENDING', text: v.short, title: v.label }),
          h('span', { class: 'round', text: 'Round ' + (p.round || 0) })
        ])
      ]),
      stage(p),
      h('div', { class: 'body' }, [
        (p.gap && String(p.gap).trim())
          ? h('blockquote', { class: 'gap' }, [
              h('span', { class: 'k', text: 'Biggest remaining gap · round ' + (p.round || 0) }),
              document.createTextNode('“' + String(p.gap).trim() + '”')
            ])
          : h('blockquote', { class: 'gap none' }, [
              h('span', { class: 'k', text: 'Biggest remaining gap' }),
              document.createTextNode(
                (p.round || 0) === 0 ? 'Not yet judged — no critique on record.'
                                     : 'No gap recorded for this round.')
            ]),
        h('div', { class: 'hist' }, [
          h('div', { class: 'k' }, [
            document.createTextNode('History'), h('i', { class: 'rule' }),
            h('span', { text: hist.length + (hist.length === 1 ? ' round' : ' rounds') })
          ]),
          hist.length
            ? h('div', { class: 'wrapstrip' }, [h('div', { class: 'strip' }, hist.map(function (x) {
                return h('div', { class: 'it', style: '--hc:' + (VVAR[x.verdict] || VVAR.PENDING) }, [
                  h('div', { class: 'rh' }, [
                    h('span', { class: 'r', text: 'ROUND ' + (x.round || 0) }),
                    h('i', { class: 'v', title: (VMAP[x.verdict] || VMAP.PENDING).label })
                  ]),
                  h('p', { text: x.gap || '—', title: x.gap || '' })
                ]);
              }))])
            : h('div', { class: 'none', text: 'No earlier rounds yet.' })
        ]),
        notes.length
          ? h('div', { class: 'notes' }, notes.slice(-4).map(function (n) {
              return h('span', { class: 'n' }, [
                h('b', { text: 'R' + (n.round || 0) }), document.createTextNode(n.text || '')
              ]);
            }))
          : null,
        h('div', { class: 'photos' }, [
          h('b', { text: String(nPhotos) }),
          document.createTextNode(nPhotos === 1 ? 'listing photo · hero ' : 'listing photos · hero '),
          h('code', { text: fileOf(p.photo) })
        ])
      ])
    ]);
    return el;
  }

  /* signature of everything that affects a card's DOM */
  function sig(p) {
    return JSON.stringify([p.id, p.title, p.dims, p.round, p.verdict, p.confidence, p.gap,
                           p.photo, p.render, p.renderStamp,
                           (p.allPhotos || []).length, p.history, p.notes]);
  }

  /* =================================================================
   * header + sections
   * ================================================================= */

  function paintHeader(d) {
    var pieces = d.pieces || [];
    var counts = {}; VERDICTS.forEach(function (v) { counts[v.id] = 0; });
    pieces.forEach(function (p) {
      var k = counts.hasOwnProperty(p.verdict) ? p.verdict : 'PENDING';
      counts[k]++;
    });
    var pass = pieces.filter(function (p) { return isPass(p.verdict); }).length;
    var total = pieces.length || 1;

    document.getElementById('scoreN').textContent = String(pass);
    document.getElementById('scoreD').textContent = '/ ' + pieces.length;

    var bar = document.getElementById('bar');
    bar.textContent = '';
    VERDICTS.forEach(function (v) {
      if (!counts[v.id]) return;
      bar.appendChild(h('i', {
        title: counts[v.id] + ' · ' + v.label,
        style: 'width:' + ((counts[v.id] / total) * 100).toFixed(3) + '%;background:' + VVAR[v.id]
      }));
    });
    document.getElementById('barPct').textContent =
      Math.round((pass / total) * 100) + '% photoreal-passing';
    document.getElementById('barRem').textContent = (pieces.length - pass) + ' to go';

    var leg = document.getElementById('legend');
    leg.textContent = '';
    VERDICTS.forEach(function (v) {
      leg.appendChild(h('span', { class: 'chip', 'data-v': v.id }, [
        document.createTextNode(v.label), h('span', { class: 'ct', text: String(counts[v.id]) })
      ]));
    });

    document.getElementById('updated').textContent = ago(d.updated);
    document.getElementById('updated').title = String(d.updated || '');
  }

  function paintPieces(d) {
    var root = document.getElementById('levels');
    var pieces = d.pieces || [];
    var byLevel = {};
    pieces.forEach(function (p) {
      var lv = byLevel[p.level] ? p.level : (LEVELS.some(function (l) { return l.id === p.level; }) ? p.level : 'other');
      (byLevel[lv] = byLevel[lv] || []).push(p);
    });
    var order = LEVELS.slice();
    Object.keys(byLevel).forEach(function (k) {
      if (!order.some(function (l) { return l.id === k; })) order.push({ id: k, name: k });
    });

    var layout = order.filter(function (l) { return byLevel[l.id]; })
      .map(function (l) { return l.id + ':' + byLevel[l.id].map(function (p) { return p.id; }).join(','); })
      .join('|');

    if (root.dataset.layout !== layout) {
      root.textContent = '';
      state.cards = {};
      order.forEach(function (l) {
        var list = byLevel[l.id];
        if (!list) return;
        var grid = h('div', { class: 'grid', id: 'grid-' + l.id });
        root.appendChild(h('section', { class: 'level', id: 'level-' + l.id }, [
          h('div', { class: 'level-hd' }, [
            h('h2', { text: l.name }), h('i', { class: 'rule' }),
            h('span', { class: 'tally', id: 'tally-' + l.id })
          ]),
          grid
        ]));
      });
      root.dataset.layout = layout;
    }

    var nav = document.getElementById('nav');
    nav.textContent = '';
    order.forEach(function (l) {
      var list = byLevel[l.id];
      if (!list) return;
      var grid = document.getElementById('grid-' + l.id);
      list.forEach(function (p, i) {
        var s = sig(p);
        var prev = state.cards[p.id];
        if (prev && prev.sig === s && prev.el.parentNode === grid) return;
        var el = card(p);
        if (prev && prev.el.parentNode === grid) grid.replaceChild(el, prev.el);
        else if (grid.children[i]) grid.insertBefore(el, grid.children[i]);
        else grid.appendChild(el);
        state.cards[p.id] = { sig: s, el: el };
      });
      var pass = list.filter(function (p) { return isPass(p.verdict); }).length;
      nav.appendChild(h('a', { href: '#level-' + l.id, title: l.name + ': ' + pass + ' of ' + list.length + ' passing' }, [
        document.createTextNode(l.name), h('b', { text: pass + '/' + list.length })
      ]));
      var t = document.getElementById('tally-' + l.id);
      t.textContent = '';
      t.appendChild(h('b', { text: pass + '/' + list.length }));
      t.appendChild(document.createTextNode(' passing'));
    });
  }

  function paint(d) {
    state.data = d;
    paintHeader(d);
    paintPieces(d);
  }

  /* =================================================================
   * live refresh
   * ================================================================= */

  function setLive(mode) {
    var b = document.getElementById('liveBtn');
    b.className = 'btn ' + mode;
    b.lastChild.textContent =
      mode === 'live' ? 'live' : mode === 'stale' ? 'retrying' : 'snapshot';
    b.title = mode === 'offline'
      ? 'status.json could not be fetched (file:// blocks it) — showing the snapshot baked in at build time'
      : 'polling ' + STATUS_URL + ' every 5 s';
  }

  function poll() {
    fetch(STATUS_URL + '?ts=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (d) {
        if (!d || !Array.isArray(d.pieces)) throw new Error('bad payload');
        state.fails = 0; state.live = true; setLive('live');
        if (JSON.stringify(d) !== JSON.stringify(state.data)) paint(d);
        else document.getElementById('updated').textContent = ago(d.updated);
      })
      .catch(function () {
        state.fails++;
        setLive(state.fails >= 3 ? 'offline' : 'stale');
        if (state.data) document.getElementById('updated').textContent = ago(state.data.updated);
      })
      .then(function () {
        setTimeout(poll, state.fails >= 3 ? 30000 : 5000);
      });
  }

  /* =================================================================
   * boot
   * ================================================================= */

  applyTheme(theme);
  document.getElementById('themeBtn').addEventListener('click', function () {
    theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
    try { localStorage.setItem('cl-progress-theme', theme); } catch (e) {}
    applyTheme(theme);
  });

  paint(SNAPSHOT);
  setLive('stale');
  poll();
  setInterval(function () {
    if (state.data) document.getElementById('updated').textContent = ago(state.data.updated);
  }, 20000);
})();
`;

/* ------------------------------------------------------------------ */
/* page                                                                */
/* ------------------------------------------------------------------ */

function buildHtml(status) {
  const snapshotJson = JSON.stringify(status);
  const generated = new Date().toISOString();
  const css = [
    CSS,
    `:root[data-theme="light"]{${CSS_LIGHT}}`,
    `@media (prefers-color-scheme: light){:root:not([data-theme="dark"]){${CSS_LIGHT}}}`,
    CSS_MAIN,
  ].join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark light">
<title>1430 Country Ln — Walkthrough Progress</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%230a0c10'/%3E%3Cpath d='M6 15 16 7l10 8v10H6z' fill='none' stroke='%236ea8fe' stroke-width='2.2' stroke-linejoin='round'/%3E%3C/svg%3E">
<style>
${css}
</style>
</head>
<body>
<div class="wrap">

  <header class="top">
    <div class="top-row">
      <div class="brand">
        <h1><span class="addr">1430 Country Ln</span> <span style="color:var(--text-3);font-weight:400">Walkthrough Progress</span></h1>
        <div class="sub">Three.js reconstruction judged blind against <b>47</b> professional listing photographs &middot; last update <span id="updated">—</span></div>
      </div>

      <div class="score">
        <div class="big">
          <span class="n" id="scoreN">0</span>
          <span class="d" id="scoreD">/ 0</span>
          <span class="lbl">pieces passing</span>
        </div>
        <div class="meter">
          <div class="bar" id="bar"></div>
          <div class="cap"><span id="barPct">—</span><span id="barRem">—</span></div>
        </div>
        <div class="tools">
          <button class="btn stale" id="liveBtn" type="button"><i class="dot"></i><span>connecting</span></button>
          <button class="btn" id="themeBtn" type="button" title="cycle theme">auto</button>
        </div>
      </div>
    </div>
    <div class="botrow">
      <div class="legend" id="legend"></div>
      <nav class="nav" id="nav" aria-label="jump to level"></nav>
    </div>
  </header>

  <main id="levels"></main>

  <footer class="foot">
    <span>Generated by <code>tools/progress.mjs</code> at ${generated} — do not edit by hand.</span>
    <span>Mutate state with <code>node tools/status.mjs set &lt;id&gt; --round N --verdict V --gap "…" --render path</code></span>
  </footer>
</div>

<script>
var STATUS_URL = ${jsString(STATUS_URL)};
var SNAPSHOT = JSON.parse(${jsString(snapshotJson)});
</script>
<script>
${CLIENT_JS}
</script>
</body>
</html>
`;
}

/* ------------------------------------------------------------------ */
/* main                                                                */
/* ------------------------------------------------------------------ */

function build() {
  const status = loadStatus();
  const html = buildHtml(status);
  fs.writeFileSync(OUT_PATH, html);
  if (FLAGS.quiet !== true) {
    const pass = status.pieces.filter(
      (p) => p.verdict === 'UNSURE' || p.verdict === 'PICKED_PHOTO_AS_RENDER'
    ).length;
    process.stdout.write(
      `progress: wrote ${path.relative(ROOT, OUT_PATH) || OUT_PATH} ` +
        `(${status.pieces.length} pieces, ${pass} passing, ` +
        `${(html.length / 1024).toFixed(0)} kB)\n`
    );
  }
}

build();

if (FLAGS.watch === true) {
  let timer = null;
  fs.watch(path.dirname(STATUS_PATH), (_e, name) => {
    if (name && name !== path.basename(STATUS_PATH)) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        build();
      } catch (err) {
        process.stderr.write(`progress: rebuild failed — ${err.message}\n`);
      }
    }, 120);
  });
  process.stdout.write('progress: watching status.json (ctrl-c to stop)\n');
}
