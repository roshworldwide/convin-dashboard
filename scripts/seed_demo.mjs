// Seed the app with a SYNTHETIC book so it runs on a fresh clone.
//
//   npm run demo
//
// The real RBL export never leaves the machine that produced it — it is gitignored,
// and so is everything derived from it. Anyone who clones this repo (a colleague, a
// CI runner, Vercel) gets invented people instead: made-up names, made-up mobiles,
// made-up account numbers. The dashboard looks and behaves identically.
//
// Nothing generated here is real. Never quote a rupee figure from it.

import fs from 'node:fs';
import path from 'node:path';
import { parseCsv } from '../src/lib/csv.mjs';
import { buildCanonicalRows } from '../src/lib/merge.mjs';
import { autoMap } from '../src/lib/normalize.mjs';
import { ingestLocalUpload } from '../src/lib/ingest_local.mjs';

const SRC = path.join(process.cwd(), 'evals', 'upload', '4_SYNTHETIC_10k_inverted_book.csv');
if (!fs.existsSync(SRC)) {
  console.error('Synthetic book not found. Run:  node evals/synth_book.mjs 2000');
  process.exit(1);
}

const parsed = parseCsv(fs.readFileSync(SRC, 'utf8'));
const { rows, warnings } = buildCanonicalRows(parsed, [], autoMap(parsed[0]));

// Three report days, so the date stepper and the same-day upload tabs have something
// to show — each a different slice, so the numbers differ day to day.
const today = new Date();
const iso = (d) => d.toISOString().slice(0, 10);
const days = [2, 1, 0].map((back) => {
  const d = new Date(today); d.setDate(d.getDate() - back); return iso(d);
});

const slice = (n, of) => rows.filter((_, i) => i % of === n);

for (let i = 0; i < days.length; i++) {
  const day = days[i];
  const batch = slice(i, days.length);
  await ingestLocalUpload(batch, {
    reportDate: day, slot: 1, filename: 'demo_book.csv', uploadTime: '09:15',
  });
  console.log(`  ${day}  ${batch.length.toLocaleString('en-IN')} synthetic accounts`);
}

if (warnings.length) warnings.forEach((w) => console.log(`  ! ${w}`));
console.log(`\n✔ Seeded ${days.length} demo days with invented customers.`);
console.log('  npm run dev   →  log in with any username');
console.log('\n  These people do not exist. Do not cite any figure from this data.\n');
