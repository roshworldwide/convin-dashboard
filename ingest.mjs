// Ingest sheets into Postgres (the built-in VLOOKUP runs automatically).
//   DATABASE_URL=... node ingest.mjs <status.csv> [extra1.csv extra2.csv …] [--date=YYYY-MM-DD] [--slot=N]
//
// The FIRST file is the status sheet (it decides which accounts exist).
// Any additional files are looked up by Account No to fill in missing columns
// (outstanding, band, region, name, mobile …) — no manual Excel lookup needed.
// For very large files: node --max-old-space-size=4096 ingest.mjs …
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { parseCsv } from './src/lib/csv.mjs';
import { buildCanonicalRows } from './src/lib/merge.mjs';
import { ingestUpload } from './src/lib/ingest.mjs';

const args = process.argv.slice(2);
const files = args.filter((a) => !a.startsWith('--'));
const flag = (name) => { const a = args.find((x) => x.startsWith(`--${name}=`)); return a ? a.split('=')[1] : ''; };

if (!files.length) {
  console.error('Usage: node ingest.mjs <status.csv> [extra.csv …] [--date=YYYY-MM-DD] [--slot=N]');
  process.exit(1);
}
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is not set.'); process.exit(1); }

const [statusFile, ...extraFiles] = files;
const m = basename(statusFile).match(/(\d{4}-\d{2}-\d{2})/);
const reportDate = flag('date') || (m && m[1]) || new Date().toISOString().slice(0, 10);
const slot = Math.max(1, parseInt(flag('slot') || '1', 10) || 1);

const statusParsed = parseCsv(readFileSync(statusFile, 'utf8'));
const extraParsed = extraFiles.map((f) => parseCsv(readFileSync(f, 'utf8')));

const { rows, stats } = buildCanonicalRows(statusParsed, extraParsed);
console.log(`  merged: ${stats.primaryRows} status rows · ${stats.extraSheets} extra sheet(s) · ${stats.matched} matched · ${stats.filledCells} cells filled`);

const res = await ingestUpload(rows, { reportDate, slot, filename: basename(statusFile), uploadTime: '' });
console.log(`✔ Ingested ${res.rowCount} rows → batch ${res.batchId} (report date ${reportDate})`);
process.exit(0);
