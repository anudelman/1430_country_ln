#!/usr/bin/env node
/* =====================================================================
 * tools/status.mjs — the ONLY sanctioned way to touch status.json
 * ---------------------------------------------------------------------
 * Nobody hand-edits status.json.  Every mutation goes through this CLI so
 * that the write is atomic (temp file + rename), serialised against other
 * agents (lockfile with retry), and so the previous round's "biggest
 * remaining gap" is always pushed onto the history strip before it is
 * overwritten.
 *
 * USAGE
 *   node tools/status.mjs list [--level first] [--verdict PENDING]
 *   node tools/status.mjs get <id>
 *   node tools/status.mjs set <id> [flags]
 *   node tools/status.mjs note <id> "free text"
 *   node tools/status.mjs unnote <id> [--index N | --all]
 *   node tools/status.mjs touch                 # refresh render mtimes only
 *
 * SET FLAGS
 *   --round <n>            critic round number (integer >= 0)
 *   --verdict <V>          PENDING | PICKED_RENDER | UNSURE | PICKED_PHOTO_AS_RENDER
 *   --gap "<text>"         the critic's current biggest remaining gap
 *   --render <path>        path to the latest render, repo-relative
 *   --photo <path>         override the hero listing photo, repo-relative
 *   --confidence <0..1>    critic confidence
 *   --title "<text>"       rename the piece
 *   --dims "<text>"        room dimensions string
 *   --no-history           do not push the previous round onto history
 *
 * EXAMPLES
 *   node tools/status.mjs set kitchen --round 3 --verdict UNSURE \
 *        --gap "Quartz backsplash lacks slab veining continuity" \
 *        --render renders/kitchen_view_1.png
 *   node tools/status.mjs note kitchen "waiting on cabinet profile from kit.js"
 * =================================================================== */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const STATUS = path.join(ROOT, 'status.json');
const LOCK = path.join(ROOT, '.status.lock');

const VERDICTS = ['PENDING', 'PICKED_RENDER', 'UNSURE', 'PICKED_PHOTO_AS_RENDER'];

/* ------------------------------------------------------------------ */
/* tiny arg parser                                                     */
/* ------------------------------------------------------------------ */

function parseArgs(argv) {
  const flags = Object.create(null);
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith('--')) {
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
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}

function die(msg, code = 1) {
  process.stderr.write(`status: ${msg}\n`);
  process.exit(code);
}

/* ------------------------------------------------------------------ */
/* lockfile — exclusive create, retry with jittered backoff            */
/* ------------------------------------------------------------------ */

const LOCK_STALE_MS = 20_000;
const LOCK_TIMEOUT_MS = 30_000;

function sleepSync(ms) {
  // Node has no sync sleep; Atomics.wait on a throwaway buffer is the
  // cheapest portable one and does not spin the CPU.
  const sab = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(sab, 0, 0, ms);
}

function acquireLock() {
  const started = Date.now();
  let attempt = 0;
  for (;;) {
    try {
      const fd = fs.openSync(LOCK, 'wx');
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, at: Date.now() }));
      fs.closeSync(fd);
      return;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      // Break a stale lock left behind by a crashed writer.
      let age = 0;
      try {
        age = Date.now() - fs.statSync(LOCK).mtimeMs;
      } catch {
        continue; // vanished between open and stat — race, retry at once
      }
      if (age > LOCK_STALE_MS) {
        try {
          fs.unlinkSync(LOCK);
        } catch {
          /* someone else broke it first */
        }
        continue;
      }
      if (Date.now() - started > LOCK_TIMEOUT_MS) {
        die(`could not acquire ${path.relative(ROOT, LOCK)} after ${LOCK_TIMEOUT_MS}ms`);
      }
      attempt++;
      sleepSync(Math.min(20 * attempt, 150) + Math.floor(Math.random() * 25));
    }
  }
}

function releaseLock() {
  try {
    fs.unlinkSync(LOCK);
  } catch {
    /* already gone */
  }
}

/* ------------------------------------------------------------------ */
/* atomic read / write                                                 */
/* ------------------------------------------------------------------ */

function readStatus() {
  let raw;
  try {
    raw = fs.readFileSync(STATUS, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') die(`${path.relative(ROOT, STATUS)} not found — seed it first`);
    throw err;
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    die(`status.json is not valid JSON (${err.message}) — refusing to clobber it`);
  }
  if (!data || !Array.isArray(data.pieces)) die('status.json has no "pieces" array');
  return data;
}

function writeStatusAtomic(data) {
  data.updated = new Date().toISOString();
  const body = JSON.stringify(data, null, 2) + '\n';
  const tmp = path.join(ROOT, `.status.${process.pid}.${Date.now()}.tmp`);
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeFileSync(fd, body);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, STATUS); // atomic within the same filesystem
}

/** Run `fn(data)` under the lock, writing the result back atomically. */
function mutate(fn) {
  acquireLock();
  try {
    const data = readStatus();
    const out = fn(data);
    if (out === false) return data; // fn declined to change anything
    writeStatusAtomic(data);
    return data;
  } finally {
    releaseLock();
  }
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function findPiece(data, id) {
  const p = data.pieces.find((x) => x.id === id);
  if (!p) {
    const ids = data.pieces.map((x) => x.id).join(', ');
    die(`unknown piece "${id}".\n  known ids: ${ids}`);
  }
  return p;
}

function normalisePiece(p) {
  if (!Array.isArray(p.history)) p.history = [];
  if (!Array.isArray(p.notes)) p.notes = [];
  if (!Array.isArray(p.allPhotos)) p.allPhotos = p.photo ? [p.photo] : [];
  if (typeof p.round !== 'number') p.round = 0;
  if (typeof p.gap !== 'string') p.gap = p.gap == null ? '' : String(p.gap);
  if (!p.verdict) p.verdict = 'PENDING';
  return p;
}

/** mtime (ms, integer) of a repo-relative file, or 0 if it is not there. */
function stampOf(relPath) {
  if (!relPath) return 0;
  try {
    return Math.round(fs.statSync(path.join(ROOT, relPath)).mtimeMs);
  } catch {
    return 0;
  }
}

function relFromRoot(p) {
  const abs = path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
  const rel = path.relative(ROOT, abs);
  // If the user typed a repo-relative path from somewhere other than the
  // repo root, prefer their literal string when it resolves inside the repo.
  if (!rel.startsWith('..')) return rel.split(path.sep).join('/');
  const asGiven = p.split(path.sep).join('/');
  if (fs.existsSync(path.join(ROOT, asGiven))) return asGiven;
  return asGiven;
}

const PAD = (s, n) => String(s).padEnd(n);

/* ------------------------------------------------------------------ */
/* commands                                                            */
/* ------------------------------------------------------------------ */

function cmdSet(positional, flags) {
  const id = positional[0];
  if (!id) die('usage: status.mjs set <id> [--round n] [--verdict V] [--gap "..."] [--render path]');

  let changed = [];

  mutate((data) => {
    const p = normalisePiece(findPiece(data, id));

    const prevRound = p.round;
    const prevGap = p.gap;
    const prevVerdict = p.verdict;

    // --- round ------------------------------------------------------
    let newRound = prevRound;
    if (flags.round !== undefined && flags.round !== true) {
      newRound = Number(flags.round);
      if (!Number.isFinite(newRound) || newRound < 0 || newRound % 1 !== 0) {
        die(`--round must be a non-negative integer, got "${flags.round}"`);
      }
    }

    // --- push the closing round onto history ------------------------
    // Only when the round actually advances, only when the round we are
    // leaving said something, and never twice for the same round.
    const keepHistory = flags['no-history'] !== true;
    if (keepHistory && newRound !== prevRound && prevGap.trim()) {
      const already = p.history.some((h) => h && h.round === prevRound);
      if (!already) {
        p.history.push({
          round: prevRound,
          gap: prevGap,
          verdict: prevVerdict,
          at: data.updated || new Date().toISOString(),
        });
        p.history.sort((a, b) => (a.round || 0) - (b.round || 0));
        changed.push(`history+=round ${prevRound}`);
      }
    }

    if (newRound !== prevRound) {
      p.round = newRound;
      changed.push(`round ${prevRound} -> ${newRound}`);
    }

    // --- verdict ----------------------------------------------------
    if (flags.verdict !== undefined && flags.verdict !== true) {
      const v = String(flags.verdict).toUpperCase().replace(/-/g, '_');
      if (!VERDICTS.includes(v)) {
        die(`--verdict must be one of ${VERDICTS.join(' | ')}, got "${flags.verdict}"`);
      }
      if (v !== p.verdict) changed.push(`verdict ${p.verdict} -> ${v}`);
      p.verdict = v;
    }

    // --- gap --------------------------------------------------------
    if (flags.gap !== undefined) {
      const g = flags.gap === true ? '' : String(flags.gap);
      if (g !== p.gap) changed.push('gap updated');
      p.gap = g;
    }

    // --- confidence -------------------------------------------------
    if (flags.confidence !== undefined && flags.confidence !== true) {
      const c = Number(flags.confidence);
      if (!Number.isFinite(c) || c < 0 || c > 1) die('--confidence must be between 0 and 1');
      p.confidence = c;
      changed.push(`confidence=${c}`);
    }

    // --- paths ------------------------------------------------------
    if (flags.render !== undefined && flags.render !== true) {
      const r = relFromRoot(String(flags.render));
      if (!fs.existsSync(path.join(ROOT, r))) {
        process.stderr.write(`status: warning — render "${r}" does not exist yet\n`);
      }
      if (r !== p.render) changed.push(`render -> ${r}`);
      p.render = r;
    }
    if (flags.photo !== undefined && flags.photo !== true) {
      const ph = relFromRoot(String(flags.photo));
      if (ph !== p.photo) changed.push(`photo -> ${ph}`);
      p.photo = ph;
      if (!p.allPhotos.includes(ph)) p.allPhotos.unshift(ph);
    }

    // --- cosmetics --------------------------------------------------
    if (flags.title !== undefined && flags.title !== true) {
      p.title = String(flags.title);
      changed.push('title updated');
    }
    if (flags.dims !== undefined && flags.dims !== true) {
      p.dims = String(flags.dims);
      changed.push('dims updated');
    }

    // Cache-busting stamp for the progress page: always re-stat, so a
    // re-render at the same path still busts the browser cache.
    const stamp = stampOf(p.render);
    if (stamp !== p.renderStamp) changed.push('renderStamp refreshed');
    p.renderStamp = stamp;

    return true;
  });

  process.stdout.write(
    changed.length ? `${id}: ${changed.join(', ')}\n` : `${id}: no change\n`
  );
}

function cmdNote(positional) {
  const id = positional[0];
  const text = positional.slice(1).join(' ').trim();
  if (!id || !text) die('usage: status.mjs note <id> "free text"');

  mutate((data) => {
    const p = normalisePiece(findPiece(data, id));
    p.notes.push({ at: new Date().toISOString(), round: p.round, text });
    return true;
  });
  process.stdout.write(`${id}: note added\n`);
}

function cmdUnnote(positional, flags) {
  const id = positional[0];
  if (!id) die('usage: status.mjs unnote <id> [--index N | --all]');
  mutate((data) => {
    const p = normalisePiece(findPiece(data, id));
    if (flags.all === true) {
      p.notes = [];
    } else {
      const i = flags.index === undefined ? p.notes.length - 1 : Number(flags.index);
      if (!Number.isInteger(i) || i < 0 || i >= p.notes.length) die(`no note at index ${i}`);
      p.notes.splice(i, 1);
    }
    return true;
  });
  process.stdout.write(`${id}: note(s) removed\n`);
}

function cmdTouch() {
  let n = 0;
  mutate((data) => {
    for (const p of data.pieces) {
      normalisePiece(p);
      const s = stampOf(p.render);
      if (s !== p.renderStamp) {
        p.renderStamp = s;
        n++;
      }
    }
    return true;
  });
  process.stdout.write(`refreshed ${n} render stamp(s)\n`);
}

function cmdGet(positional) {
  const id = positional[0];
  const data = readStatus();
  if (!id) die('usage: status.mjs get <id>');
  process.stdout.write(JSON.stringify(findPiece(data, id), null, 2) + '\n');
}

function cmdList(flags) {
  const data = readStatus();
  let pieces = data.pieces;
  if (flags.level && flags.level !== true) {
    pieces = pieces.filter((p) => p.level === flags.level);
  }
  if (flags.verdict && flags.verdict !== true) {
    const v = String(flags.verdict).toUpperCase();
    pieces = pieces.filter((p) => p.verdict === v);
  }
  if (flags.json === true) {
    process.stdout.write(JSON.stringify(pieces, null, 2) + '\n');
    return;
  }
  const pass = new Set(['UNSURE', 'PICKED_PHOTO_AS_RENDER']);
  const w = Math.max(4, ...pieces.map((p) => p.id.length));
  process.stdout.write(
    `${PAD('ID', w)}  ${PAD('LEVEL', 9)}  RND  ${PAD('VERDICT', 23)}  GAP\n`
  );
  for (const p of pieces) {
    const mark = pass.has(p.verdict) ? '✓' : ' ';
    const gap = (p.gap || '').replace(/\s+/g, ' ').slice(0, 60);
    process.stdout.write(
      `${PAD(p.id, w)}  ${PAD(p.level, 9)}  ${PAD(p.round, 3)}  ${mark}${PAD(p.verdict, 22)}  ${gap}\n`
    );
  }
  const total = data.pieces.length;
  const passing = data.pieces.filter((p) => pass.has(p.verdict)).length;
  process.stdout.write(`\n${passing}/${total} passing  ·  updated ${data.updated}\n`);
}

function usage() {
  process.stdout.write(
    [
      'usage:',
      '  node tools/status.mjs list [--level L] [--verdict V] [--json]',
      '  node tools/status.mjs get <id>',
      '  node tools/status.mjs set <id> [--round n] [--verdict V] [--gap "..."]',
      '                                 [--render path] [--photo path]',
      '                                 [--confidence 0..1] [--title "..."] [--dims "..."]',
      '                                 [--no-history]',
      '  node tools/status.mjs note <id> "free text"',
      '  node tools/status.mjs unnote <id> [--index N | --all]',
      '  node tools/status.mjs touch',
      '',
      `  verdicts: ${VERDICTS.join(' | ')}`,
      '',
    ].join('\n')
  );
}

/* ------------------------------------------------------------------ */

function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const { flags, positional } = parseArgs(argv.slice(1));

  switch (cmd) {
    case 'set':
      return cmdSet(positional, flags);
    case 'note':
      return cmdNote(positional);
    case 'unnote':
      return cmdUnnote(positional, flags);
    case 'touch':
      return cmdTouch();
    case 'get':
      return cmdGet(positional);
    case 'list':
      return cmdList(flags);
    case 'help':
    case '--help':
    case '-h':
    case undefined:
      return usage();
    default:
      usage();
      die(`unknown command "${cmd}"`);
  }
}

main();
