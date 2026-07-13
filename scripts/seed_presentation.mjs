// Reset the app to a clean presentation state.
//
//   npm run demo:real
//
// Wipes every report day (all the test uploads accumulated during development) and
// seeds ONE day from the real RBL export: 1,908 accounts, ₹6.50 Cr, 43.8%.
//
// Why this matters in the room: Day Total SUMS every upload for a date. If two
// uploads of the same book are sitting under one day, your recovery figure doubles
// on screen in front of the client. Walk in with one day and one upload.

import fs from 'node:fs';
import path from 'node:path';
import { parseCsv } from '../src/lib/csv.mjs';
import { buildCanonicalRows } from '../src/lib/merge.mjs';
import { autoMap } from '../src/lib/normalize.mjs';
import { ingestLocalUpload } from '../src/lib/ingest_local.mjs';
import { Aggregator } from '../src/lib/aggregate.mjs';

const DATA = path.join(process.cwd(), 'src', 'data');
const BATCHES = path.join(DATA, 'batches');
const SRC = path.join(DATA, 'convin_source.csv');

if (!fs.existsSync(SRC)) {
  console.error('\nsrc/data/convin_source.csv not found — that is the real RBL export.');
  console.error('It is gitignored by design. Copy it back in from wherever you keep it.\n');
  process.exit(1);
}

// Wipe every batch and the manifest.
if (fs.existsSync(BATCHES)) for (const f of fs.readdirSync(BATCHES)) fs.unlinkSync(path.join(BATCHES, f));
fs.mkdirSync(BATCHES, { recursive: true });
fs.writeFileSync(path.join(DATA, 'manifest.json'), JSON.stringify({ dates: [], latest: null }));
console.log('\n  wiped every previous report day');

const parsed = parseCsv(fs.readFileSync(SRC, 'utf8'));
const { rows, warnings } = buildCanonicalRows(parsed, [], autoMap(parsed[0]));

const REPORT_DATE = process.argv[2] || '2026-07-08';
await ingestLocalUpload(rows, {
  reportDate: REPORT_DATE, slot: 1, filename: 'RBL_collections_export.csv', uploadTime: '09:15',
});

const a = new Aggregator();
for (const r of rows) a.add(r);
const p = a.payload(REPORT_DATE);
const t = p.agg.totals;
const promise = p.intel.model.lifts.find((l) => l.name === 'Promised to pay');

console.log(`  seeded ${REPORT_DATE} — one day, one upload\n`);
console.log('  THE NUMBERS YOU WILL BE STANDING BEHIND');
console.log(`    accounts            ${t.accounts.toLocaleString('en-IN')}`);
console.log(`    recovered           ₹${(t.recovered / 1e7).toFixed(2)} Cr   (${t.recoveryRatePct.toFixed(1)}% of the book by value)`);
console.log(`    resolution rate     ${t.resolutionRatePct.toFixed(1)}%`);
console.log(`    still open          ₹${(p.intel.opportunity.openOutstanding / 1e7).toFixed(2)} Cr`);
console.log(`    agency equivalent   ₹${(p.intel.roi.agencyCostInr / 1e5).toFixed(2)} L`);
console.log(`    ${p.intel.model.name}      AUC ${p.intel.model.auc.toFixed(3)}`);
console.log(`    promise-to-pay      ${promise.liftPts.toFixed(1)} pts  <- the finding`);
if (warnings.length) { console.log('\n  warnings the dashboard will show:'); warnings.forEach((w) => console.log(`    ! ${w.slice(0, 90)}`)); }
console.log('\n  npm run dev  →  one clean report day. Nothing to explain away.\n');
