/* ─────────────────────────────────────────────────────────────────────────────
 * BUILD ONE REPORT PDF PER PDD BOOK — unattended.
 *
 *   node --env-file=.env.local scripts/build_book_reports.mjs
 *
 * For every book folder under the data root it: pushes each Day into the dashboard,
 * mints a public share link, renders that link to PDF with headless Chrome, then
 * deletes the report again and moves on. You end up with one PDF per book.
 *
 * WHY IT REUSES A SINGLE SCRATCH DATE
 * A report is keyed by date alone — there is no name field. 24 of the 28 books share a
 * load date with another book, so filing them under their real dates would have them
 * overwrite each other. Instead every book is built on ONE scratch date, exported, and
 * torn down before the next one starts. Nothing else in the database is touched: the
 * script refuses to run if the scratch date already holds a report it did not create.
 *
 * WHY THE CALL LOG IS HANDLED SEPARATELY
 * It has one row per call ATTEMPT; the join produces one row per ACCOUNT. Passing it in
 * as an ordinary lookup collapses ~68,000 attempts into ~6,000 first-attempts and lands
 * every AI figure on zero — while accounts, outstanding and recovered all still look
 * correct, so nothing announces the loss. It is rolled up and folded on after the join.
 *
 * FLAGS
 *   --root <dir>     data root            (default ~/Business/Convin/RBL PDD August Folder)
 *   --out <dir>      where PDFs go        (default <root>/_Reports)
 *   --date <iso>     scratch date         (default 2026-08-27)
 *   --only <name>    just this one book   (substring match, repeatable)
 *   --base <url>     deployed origin      (default https://convin-dashboard.vercel.app)
 *   --incomplete     include books with missing files (skipped by default)
 *   --keep           leave the last report in place instead of deleting it
 *   --dry-run        list the plan, touch nothing
 * ───────────────────────────────────────────────────────────────────────────── */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { readSheet, detectSheetKind } from '../src/lib/sheet.mjs';
import { buildCanonicalRows } from '../src/lib/merge.mjs';
import { autoMap } from '../src/lib/normalize.mjs';
import { rollUpCallLog, applyCallLog } from '../src/lib/calllog.mjs';
import { hasDb, deleteDate, listBatches } from '../src/lib/db.mjs';
import { ingestUpload } from '../src/lib/ingest.mjs';
import { createShare } from '../src/lib/share.mjs';
import { BASE_PATH } from '../src/lib/basepath.mjs';

/* ── args ── */
const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt;
};
const has = (name) => argv.includes(`--${name}`);
const onlys = argv.reduce((acc, a, i) => (a === '--only' && argv[i + 1] ? [...acc, argv[i + 1]] : acc), []);

const ROOT = flag('root', path.join(os.homedir(), 'Business/Convin/RBL PDD August Folder'));
const OUT = flag('out', path.join(ROOT, '_Reports'));
const SCRATCH = flag('date', '2026-08-27');
const BASE = flag('base', 'https://convin-dashboard.vercel.app').replace(/\/+$/, '');
const DRY = has('dry-run');

const line = (c = '─') => console.log(c.repeat(78));
const fmt = (n) => Number(n).toLocaleString('en-IN');

/* ── find Chrome ── */
function findChrome() {
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

/* ── discover the books ── */
function discover() {
  if (!fs.existsSync(ROOT)) { console.error(`\n  data root not found: ${ROOT}\n`); process.exit(1); }
  const books = [];
  for (const name of fs.readdirSync(ROOT).sort()) {
    const dir = path.join(ROOT, name);
    if (!fs.statSync(dir).isDirectory() || name.startsWith('_') || name.startsWith('.')) continue;
    const days = fs.readdirSync(dir).filter((d) => /^Day \d+/.test(d))
      .sort((a, b) => +a.match(/\d+/)[0] - +b.match(/\d+/)[0]);
    if (!days.length) continue;
    const slots = days.map((d) => {
      const p = path.join(dir, d);
      const fs3 = fs.readdirSync(p).filter((f) => /^[123] - /.test(f)).sort();
      return { day: +d.match(/\d+/)[0], dir: p, label: d, files: fs3.map((f) => path.join(p, f)), n: fs3.length };
    });
    const complete = slots.every((s) => s.n === 3);
    books.push({ name, dir, slots, complete });
  }
  return books;
}

/* ── join one Day exactly as the browser does ── */
function joinDay(files) {
  const sheets = files.map((f) => {
    const rows = readSheet(fs.readFileSync(f), path.basename(f));
    return { name: path.basename(f), rows, kind: detectSheetKind(rows[0]) };
  });
  const cyc = sheets.find((s) => s.kind === 'cyc');
  const primary = cyc || sheets[0];
  const callSheets = sheets.filter((s) => s.kind === 'calllog');
  const lookups = sheets.filter((s) => s !== primary && s.kind !== 'calllog');
  const mapping = autoMap(sheets.filter((s) => s.kind !== 'calllog').flatMap((s) => s.rows[0]));
  const { rows, warnings } = buildCanonicalRows(
    primary.rows, lookups.map((s) => s.rows), mapping, lookups.map((s) => s.name),
  );
  let calls = 0;
  for (const s of callSheets) { const log = rollUpCallLog(s.rows); applyCallLog(rows, log, { name: s.name }); calls += log.stats.attempts; }
  const sources = sheets.map((s) => ({
    slot: s === primary ? 'CYC / PDD (primary)' : (s.kind === 'status' ? 'Status' : 'Lead outcome'),
    name: s.name, rows: s.rows.length - 1, detected: s.kind,
  }));
  return { rows, warnings, calls, primaryName: primary.name, sources };
}

/* ── render a URL to PDF ── */
function toPdf(chrome, url, out) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rbl-pdf-'));
  try {
    execFileSync(chrome, [
      '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
      `--user-data-dir=${profile}`,
      '--no-pdf-header-footer', '--virtual-time-budget=45000',
      `--print-to-pdf=${out}`, url,
    ], { stdio: 'pipe', timeout: 180000 });
  } finally { fs.rmSync(profile, { recursive: true, force: true }); }
  if (!fs.existsSync(out) || fs.statSync(out).size < 20000) throw new Error('Chrome produced no usable PDF');
  return fs.statSync(out).size;
}

/* ── main ── */
line('═');
console.log('  BUILD BOOK REPORTS');
line('═');

if (!DRY && !hasDb()) {
  console.error('\n  DATABASE_URL is not set. Run with:\n    node --env-file=.env.local scripts/build_book_reports.mjs\n');
  process.exit(1);
}
const chrome = findChrome();
if (!DRY && !chrome) {
  console.error('\n  Could not find Chrome. Install Google Chrome, or pass --dry-run to see the plan.\n');
  process.exit(1);
}

let books = discover();
if (onlys.length) books = books.filter((b) => onlys.some((o) => b.name.toLowerCase().includes(o.toLowerCase())));
const skipped = books.filter((b) => !b.complete && !has('incomplete'));
if (!has('incomplete')) books = books.filter((b) => b.complete);

console.log(`  data root   ${ROOT}`);
console.log(`  output      ${OUT}`);
console.log(`  scratch     ${SCRATCH}   (each report is built here, exported, then deleted)`);
console.log(`  chrome      ${chrome || '(dry run)'}`);
console.log(`  books       ${books.length} to build${skipped.length ? `, ${skipped.length} skipped for missing files` : ''}`);
line();
for (const b of books) console.log(`    ${b.name.padEnd(26)} ${b.slots.length} day(s)`);
for (const b of skipped) console.log(`    ${b.name.padEnd(26)} SKIPPED — ${b.slots.filter((s) => s.n < 3).map((s) => s.label).join(', ')} incomplete`);
line();

if (DRY) { console.log('\n  --dry-run: nothing was touched.\n'); process.exit(0); }
if (!books.length) { console.log('\n  Nothing to do.\n'); process.exit(0); }

/* Refuse to clobber a real report that happens to live on the scratch date. */
const existing = (await listBatches()).filter((b) => String(b.report_date).slice(0, 10) === SCRATCH);
if (existing.length) {
  console.error(`\n  ✘ ${SCRATCH} already holds ${existing.length} batch(es).`);
  console.error('    Pick a free date with --date, or delete that report first. Refusing to overwrite.\n');
  process.exit(1);
}

fs.mkdirSync(OUT, { recursive: true });
const done = []; const failed = [];

for (const [i, book] of books.entries()) {
  const t0 = Date.now();
  console.log(`\n[${i + 1}/${books.length}]  ${book.name}`);
  try {
    await deleteDate(SCRATCH);                                  // always start clean
    let rows = 0; let calls = 0;
    for (const s of book.slots) {
      const j = joinDay(s.files);
      await ingestUpload(j.rows, {
        reportDate: SCRATCH, slot: s.day, filename: j.primaryName,
        uploadTime: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
        sources: j.sources,
      });
      rows = j.rows.length; calls += j.calls;
      process.stdout.write(`    Day ${s.day}: ${fmt(j.rows.length)} accounts · ${fmt(j.calls)} attempts\n`);
      for (const w of j.warnings) console.log(`      ⚠ ${w}`);
    }
    const share = await createShare({
      batchId: `${SCRATCH}__daytotal`, reportDate: SCRATCH, label: book.name, days: 0,
    });
    const url = `${BASE}${BASE_PATH}/r/${share.token}`;
    const out = path.join(OUT, `${book.name.replace(/[/\\:]/g, '-')}.pdf`);
    const size = toPdf(chrome, url, out);
    console.log(`    ✔ ${path.basename(out)}  ${(size / 1048576).toFixed(2)} MB  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    done.push({ book: book.name, rows, calls, out });
  } catch (e) {
    console.log(`    ✘ ${e.message}`);
    failed.push({ book: book.name, why: e.message });
  }
}

if (!has('keep')) await deleteDate(SCRATCH);

line('═');
console.log(`  ${done.length} report(s) built · ${failed.length} failed`);
line();
for (const d of done) console.log(`    ${d.book.padEnd(26)} ${fmt(d.rows).padStart(8)} accounts  ${fmt(d.calls).padStart(9)} attempts`);
for (const f of failed) console.log(`    ${f.book.padEnd(26)} FAILED — ${f.why}`);
line();
console.log(`  PDFs: ${OUT}\n`);
process.exit(failed.length ? 1 : 0);
