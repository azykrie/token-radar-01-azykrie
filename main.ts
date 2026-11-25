// Token Radar (radar-2): a pre-token protocol launch radar, one sealed snapshot in, one ranked board out.
//
// The program reads the sealed snapshot from --input <snapshot.json|directory> (default /input),
// scores every protocol with the radar-2 model in lib/model.ts, writes the ranked board to /output/board.json,
// writes /output/data.js (the dashboard's data), copies this repository's dashboard/ and screenshots/ to /output,
// and last writes /output/dossier.json, the summary the judge reads, with the vendored make.fun library.
// The dashboard is a static page, no framework and no network: dashboard/index.html, app.css and app.js read /output/data.js.
// Before the dossier is written it reads back its own output and checks it the way the gate will; after
// writing the dossier it rebuilds one from /output and refuses to finish unless the bytes are identical.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's caps (reference/gate.json): text_max_bytes shapes the dossier's bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const REQUIRED_SHOTS = ['1-board.png', '2-detail.png', '3-filtered.png'];

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const fail = (message: string): never => {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(1);
};

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) fail(`no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input`);
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) fail(`the model wrote a board the gate refuses: ${issue}`);

// The spread is only meaningful once board exists and has passed the gate's shape checks.
const topRow = board[0]!;
const bottomRow = board[board.length - 1]!;

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) fail(`no ${from} to copy`);
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const dashboard = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
if (dashboard.length < 3) fail(`dashboard/ holds ${dashboard.length} file${dashboard.length === 1 ? '' : 's'}: the judge reads the page's source`);
const dashBytes = dashboard.reduce((n, name) => n + statSync(join(out, 'dashboard', name)).size, 0);
if (dashBytes > TEXT_MAX_BYTES) {
  fail(`dashboard/ source totals ${dashBytes} bytes, over the ${TEXT_MAX_BYTES} the dossier text can show whole: cut the page's source`);
}
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) fail(`screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view`);
for (const name of REQUIRED_SHOTS) {
  if (!shots.includes(name)) fail(`screenshots/ is missing ${name}, one of the three required views`);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) fail(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
}

/** Why one screenshot is not a whole 1440x900 PNG or JPEG under the caps, or null: header and trailer parsed directly. */
function imageIssue(path: string, name: string): string | null {
  const buf = readFileSync(path);
  if (buf.length > SCREENSHOT_CAPS.max_bytes) return `${buf.length} bytes, over the ${SCREENSHOT_CAPS.max_bytes}-byte cap`;
  const png = buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a;
  if (png) {
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    if (buf.subarray(buf.length - 8, buf.length - 4).toString('latin1') !== 'IEND') return `${name} is a PNG with no IEND trailer, so it is cut short`;
    return width === 1440 && height === 900 ? null : `${name} is ${width}x${height}, not 1440x900`;
  }
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    if (!(buf[buf.length - 2] === 0xff && buf[buf.length - 1] === 0xd9)) return `${name} is a JPEG with no FFD9 trailer, so it is cut short`;
    for (let i = 2; i + 9 < buf.length; ) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1]!;
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const height = buf.readUInt16BE(i + 5);
        const width = buf.readUInt16BE(i + 7);
        return width === 1440 && height === 900 ? null : `${name} is ${width}x${height}, not 1440x900`;
      }
      i += 2 + buf.readUInt16BE(i + 2);
    }
    return `${name} is a JPEG with no SOF marker`;
  }
  return `${name} is neither a PNG nor a JPEG`;
}

/** Read back what this run wrote and check it the way the gate will: the last net before the dossier. */
function localSelfCheck(outDir: string): void {
  type Row = { rank: number; slug: string; implied_value_usd: number; farm_steps: string[] };
  const rows = (JSON.parse(readFileSync(join(outDir, 'board.json'), 'utf8')) as { rows: Row[] }).rows;
  const covered = new Set(rows.map((r) => r.slug));
  if (covered.size !== rows.length) fail(`self-check: board.json ranks ${rows.length - covered.size} duplicate slug${rows.length - covered.size === 1 ? '' : 's'}`);
  const missing = snapshot.watchlist.filter((s) => !covered.has(s));
  if (missing.length > 0) fail(`self-check: board.json covers ${snapshot.watchlist.length - missing.length}/${snapshot.watchlist.length} watchlist slugs; missing ${missing.slice(0, 5).join(', ')}`);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    if (r.rank !== i + 1) fail(`self-check: board.json row ${i + 1} carries rank ${r.rank}`);
    if (i > 0 && r.implied_value_usd > rows[i - 1]!.implied_value_usd) fail(`self-check: board.json row ${i + 1} outranks row ${i} on implied value`);
    const steps = r.farm_steps;
    if (!Array.isArray(steps) || steps.length < 3 || steps.length > 12) fail(`self-check: ${r.slug} has ${Array.isArray(steps) ? steps.length : 0} farm steps`);
    if (steps.some((s) => typeof s !== 'string' || s.trim().length < 20 || s.trim().length > 600)) fail(`self-check: ${r.slug} has a farm step outside 20..600 trimmed characters`);
  }
  const win: { RADAR?: { rows?: unknown } } = {};
  new Function('window', readFileSync(join(outDir, 'data.js'), 'utf8'))(win);
  const exposedRows: unknown = win.RADAR === undefined ? undefined : win.RADAR.rows;
  if (!Array.isArray(exposedRows)) fail('self-check: data.js exposes no rows to the page');
  if (JSON.stringify(exposedRows) !== JSON.stringify(rows)) fail('self-check: data.js rows differ from board.json');
  for (const name of REQUIRED_SHOTS) {
    const path = join(outDir, 'screenshots', name);
    if (!existsSync(path)) fail(`self-check: screenshots/${name} is missing`);
    const issue = imageIssue(path, name);
    if (issue !== null) fail(`self-check: screenshots/${name}: ${issue}`);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
localSelfCheck(out);
const dossier = buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: DASHBOARD_CAPS });
writeFileSync(join(out, 'dossier.json'), dossier);
const again = buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: DASHBOARD_CAPS });
if (!Buffer.from(again).equals(Buffer.from(dossier))) fail('the dossier rebuilt from /output differs from the one written');

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: ${board.length} rows ranked: top $${topRow.implied_value_usd} (${topRow.slug}), bottom $${bottomRow.implied_value_usd} (${bottomRow.slug})\n` +
    `token radar: read-back self-check passed (watchlist coverage, ranks, farm steps, data.js rows, 3 whole 1440x900 images)\n` +
    `token radar: wrote ${join(out, 'board.json')} (${statSync(join(out, 'board.json')).size} bytes), ${join(out, 'data.js')} (${statSync(join(out, 'data.js')).size} bytes),\n` +
    `token radar:   ${join(out, 'dashboard')} (${dashboard.length} files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')} (${statSync(join(out, 'dossier.json')).size} bytes)\n`,
);
