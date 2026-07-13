/* ─────────────────────────────────────────────────────────────────────────────
 * npm run push -- <CYC.xlsx> <Status.xlsx> <LeadOutcome.csv> [--date 2026-07-13] [--slot 1]
 *
 * Reads the three files on YOUR machine, joins them, and writes the result straight
 * into Supabase. The deployed app then just reads.
 *
 * WHY THIS EXISTS, INSTEAD OF UPLOADING THROUGH THE WEBSITE
 *
 *   Vercel caps a serverless request body at 4.5 MB. That is a hard platform limit —
 *   not a setting, not a plan upgrade. Your three files are 1.3 + 3.3 + 7.9 = 12.5 MB.
 *   Uploading them to /api/ingest on Vercel does not "run slowly"; it returns 413 and
 *   never reaches your code. There is no amount of tuning that fixes it.
 *
 *   The second problem is that parsing a 177,685-row status workbook inside a lambda
 *   burns memory and clock for no reason. Your laptop does it in 2.5 seconds and has
 *   the files already.
 *
 *   So the heavy lifting happens here, locally, and only the RESULT — canonical rows and
 *   the computed payload — crosses the wire, over a normal Postgres connection with no
 *   body limit at all. The website becomes a pure read surface: fast, and impossible to
 *   break by uploading the wrong thing in front of a client.
 *
 * Requires DATABASE_URL (Supabase → Project Settings → Database → Connection string).
 * Use the DIRECT connection here (port 5432), not the transaction pooler — this does
 * thousands of inserts in one session and wants a real, stable connection.
 * ───────────────────────────────────────────────────────────────────────────── */

import fs from 'node:fs';
import path from 'node:path';
import { readSheet, detectSheetKind } from '../src/lib/sheet.mjs';
import { buildCanonicalRows } from '../src/lib/merge.mjs';
import { autoMap } from '../src/lib/normalize.mjs';
import { hasDb } from '../src/lib/db.mjs';
import { ingestUpload } from '../src/lib/ingest.mjs';

const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const files = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));

const bar = () => console.log('─'.repeat(76));

if (!hasDb()) {
  console.error('\n  DATABASE_URL is not set.\n');
  console.error('  Put it in .env.local (it is gitignored):');
  console.error('    DATABASE_URL=postgresql://postgres:PASSWORD@db.xxxx.supabase.co:5432/postgres\n');
  console.error('  Supabase → Project Settings → Database → Connection string → URI\n');
  process.exit(1);
}

if (files.length < 1) {
  console.error('\n  usage: npm run push -- <CYC.xlsx> <Status.xlsx> <LeadOutcome.csv> [--date YYYY-MM-DD] [--slot 1]\n');
  process.exit(1);
}

const reportDate = flag('date', new Date().toISOString().slice(0, 10));
const slot = Math.max(1, parseInt(flag('slot', '1'), 10) || 1);

console.log('');
bar();
console.log(`  PUSH → Supabase        report date ${reportDate}   ·   upload slot ${slot}`);
bar();

/* Read every file and work out what it is, rather than trusting the order they were
   typed in. Handing the status file to the CYC slot would silently produce a book with
   the wrong denominator, and nothing downstream would notice. */
const sheets = files.map((f) => {
  if (!fs.existsSync(f)) { console.error(`\n  file not found: ${f}\n`); process.exit(1); }
  const rows = readSheet(fs.readFileSync(f), path.basename(f));
  const kind = detectSheetKind(rows[0]);
  const mb = (fs.statSync(f).size / 1048576).toFixed(1);
  console.log(`  ${String(kind).toUpperCase().padEnd(8)} ${path.basename(f).padEnd(48)} ${String(rows.length - 1).padStart(8)} rows  ${mb.padStart(5)} MB`);
  return { name: path.basename(f), rows, kind };
});
bar();

const cyc = sheets.find((s) => s.kind === 'cyc');
const primary = cyc || sheets[0];
const lookups = sheets.filter((s) => s !== primary);

if (!cyc) {
  console.log('  No CYC/PDD file detected — treating the first file as an already-merged export.');
}

const mapping = autoMap(sheets.flatMap((s) => s.rows[0]));
const t0 = Date.now();

let merged;
try {
  merged = buildCanonicalRows(primary.rows, lookups.map((s) => s.rows), mapping, lookups.map((s) => s.name));
} catch (e) {
  console.error(`\n  ✘ ${e.message}\n`);
  process.exit(1);
}

const { rows, stats, warnings } = merged;
console.log(`  joined ${rows.length.toLocaleString('en-IN')} accounts in ${Date.now() - t0} ms`);
for (const c of stats.sheetCoverage || []) {
  console.log(`    ${c.name.padEnd(48)} matched ${c.matched.toLocaleString('en-IN')} of ${c.of.toLocaleString('en-IN')}`);
}
for (const w of warnings) console.log(`\n  ⚠ ${w}`);

const sources = sheets.map((s) => ({
  slot: s === primary ? (cyc ? 'CYC / PDD (primary)' : 'Merged sheet') : (s.kind === 'status' ? 'Status' : 'Lead outcome'),
  name: s.name,
  rows: s.rows.length - 1,
  detected: s.kind,
}));

bar();
console.log('  writing to Supabase…');
const t1 = Date.now();
const res = await ingestUpload(rows, { reportDate, slot, filename: primary.name, uploadTime: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }), sources });
console.log(`  ✔ ${res.rowCount.toLocaleString('en-IN')} rows written · batch ${res.batchId} · ${Date.now() - t1} ms`);
bar();
console.log('  Done. Open the deployed dashboard — it is already showing this.\n');
process.exit(0);
