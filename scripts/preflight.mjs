// Pre-flight check. Run this the morning of the meeting.
//
//   npm run preflight
//
// It walks the exact path you will walk on stage — login, upload the two split
// sheets, read the payload, page the explorer — and asserts that every number the
// dashboard puts on screen is present and sane. It is the difference between finding
// a problem at 8am and finding it in front of the COO.

import fs from 'node:fs';
import path from 'node:path';
import { parseCsv } from '../src/lib/csv.mjs';
import { buildCanonicalRows } from '../src/lib/merge.mjs';
import { autoMap, isResolved } from '../src/lib/normalize.mjs';
import { Aggregator } from '../src/lib/aggregate.mjs';

let fails = 0;
const ok = (m) => console.log(`  ✔ ${m}`);
const no = (m) => { fails++; console.log(`  ✘ ${m}`); };
const need = (cond, good, bad) => (cond ? ok(good) : no(bad));

const R = process.cwd();
const has = (p) => fs.existsSync(path.join(R, p));

console.log('\n═══ 1. FILES YOU NEED ON STAGE ═══');
const SRC = 'src/data/convin_source.csv';
need(has(SRC), 'the real RBL export is present', `${SRC} MISSING — you have nothing to present`);
for (const f of ['evals/upload/2_SPLIT_status_sheet.csv', 'evals/upload/3_SPLIT_portfolio_sheet.csv']) {
  need(has(f), `${path.basename(f)} ready to drag in`, `${f} missing — regenerate: node evals/make_upload_sheets.mjs`);
}
need(has('evals/upload/4_SYNTHETIC_10k_inverted_book.csv'), '10k scale-test file ready (if they ask about volume)',
  '10k file missing — node evals/synth_book.mjs 10000');
need(has('src/data/validation.json'), 'model credentials present (the 10/10 strip)',
  'validation.json missing — the credential strip will be blank. Run: npm run eval:sweep');

console.log('\n═══ 2. API ROUTES THE DASHBOARD CALLS ═══');
for (const r of ['auth', 'me', 'data', 'batch', 'rows', 'ingest', 'validation', 'report']) {
  need(has(`src/app/api/${r}/route.js`), `/api/${r}`, `/api/${r} MISSING — the page will fail`);
}

console.log('\n═══ 3. THE LIVE UPLOAD (exactly what you do on stage) ═══');
// BEAT 1 — the split upload MUST refuse. That refusal is your opening moment.
try {
  const st = parseCsv(fs.readFileSync(path.join(R, 'evals/upload/2_SPLIT_status_sheet.csv'), 'utf8'));
  const pf = parseCsv(fs.readFileSync(path.join(R, 'evals/upload/3_SPLIT_portfolio_sheet.csv'), 'utf8'));
  buildCanonicalRows(st, [pf], autoMap(st[0]));
  no('the split upload LOADED — it was supposed to refuse. Your opening beat is gone.');
} catch (e) {
  need(/stopped|understated/i.test(e.message) && /7\.4787E|total_outstanding/.test(e.message),
    'BEAT 1: the split upload refuses, and names the 190 corrupted rows',
    `it refuses, but with the wrong message: ${e.message.slice(0, 80)}`);
}
// BEAT 2 — the merged sheet loads and gives you the real number.
try {
  const m = parseCsv(fs.readFileSync(path.join(R, 'evals/upload/1_MERGED_full_sheet.csv'), 'utf8'));
  const { rows, warnings } = buildCanonicalRows(m, [], autoMap(m[0]));
  const a = new Aggregator();
  for (const r of rows) a.add(r);
  const pl = a.payload('demo');
  need(Math.abs(pl.agg.totals.recovered / 1e7 - 6.50) < 0.01,
    `BEAT 2: the merged sheet loads — ₹${(pl.agg.totals.recovered / 1e7).toFixed(2)} Cr on screen`,
    `merged sheet gives ₹${(pl.agg.totals.recovered / 1e7).toFixed(2)} Cr, expected ₹6.50 Cr`);
  need(warnings.some((w) => /corrupt/i.test(w)),
    'the amber data-quality banner will show the 190 corrupted rows',
    'the corruption warning is missing — you lose the credibility moment');
} catch (e) {
  no(`THE MERGED UPLOAD WOULD FAIL: ${e.message}`);
}

console.log('\n═══ 4. THE REAL BOOK — the numbers you will say out loud ═══');
try {
  const p = parseCsv(fs.readFileSync(path.join(R, SRC), 'utf8'));
  const { rows } = buildCanonicalRows(p, [], autoMap(p[0]));
  const a = new Aggregator();
  for (const r of rows) a.add(r);
  const pl = a.payload('8 July 2026');
  const t = pl.agg.totals, I = pl.intel;
  const M = I.model;

  need(t.accounts === 1908, `1,908 accounts`, `account count is ${t.accounts}, expected 1,908`);
  need(Math.abs(t.recovered / 1e7 - 6.50) < 0.01, `₹${(t.recovered / 1e7).toFixed(2)} Cr recovered`, `recovered is ₹${(t.recovered / 1e7).toFixed(2)} Cr, expected ₹6.50 Cr`);
  need(Math.abs(t.resolutionRatePct - 43.8) < 0.1, `${t.resolutionRatePct.toFixed(1)}% resolution`, `resolution is ${t.resolutionRatePct.toFixed(1)}%, expected 43.8%`);
  need(M.trained, `${M.name} fitted — AUC ${M.auc ? M.auc.toFixed(3) : 'n/a'}`, 'THE MODEL DID NOT FIT — the whole section will be missing');
  need(I.opportunity.ranked, `open book ranked: ₹${(I.opportunity.openOutstanding / 1e7).toFixed(2)} Cr across ${['High', 'Medium', 'Low'].map((k) => I.opportunity.tiers[k].count).reduce((x, y) => x + y, 0)} accounts`, 'the open book is NOT ranked — the tier boxes will say so');

  const promise = M.lifts.find((l) => l.name === 'Promised to pay');
  need(promise && promise.liftPts < -10,
    `THE FINDING IS THERE: promise-to-pay ${promise ? promise.liftPts.toFixed(1) : '?'} pts`,
    'THE FINDING IS NOT IN THE TOP LIFTS — your whole demo is built on it');

  // The live proof you will run in the Account Explorer.
  const promised = rows.filter((r) => String(r.promise_flag).toUpperCase() === 'YES');
  const pRes = promised.filter(isResolved).length;
  ok(`live proof reproduces: ${promised.length} promised, ${pRes} paid = ${(pRes / promised.length * 100).toFixed(1)}% vs ${t.resolutionRatePct.toFixed(1)}% book`);

  // Narrative must not contradict the model.
  const s = I.dealCase;
  need(!(promise.liftPts < 0 && /work it first/i.test(s)),
    'the narrative agrees with the model', 'THE NARRATIVE CONTRADICTS THE MODEL — an analyst will catch this');
} catch (e) {
  no(`could not read the real book: ${e.message}`);
}

console.log('\n═══ 5. THE DEMO FOOTGUN ═══');
try {
  const man = JSON.parse(fs.readFileSync(path.join(R, 'src/data/manifest.json'), 'utf8'));
  const multi = man.dates.filter((d) => d.uploads.length > 1);
  need(man.dates.length === 1,
    `one report day in the app — nothing to explain away`,
    `${man.dates.length} report days are loaded (${man.dates.map((d) => d.date).join(', ')}). Run: npm run demo:real`);
  need(multi.length === 0,
    'no day has multiple uploads',
    `${multi.map((d) => d.date).join(', ')} has multiple uploads — DAY TOTAL WILL DOUBLE YOUR RECOVERY FIGURE ON SCREEN. Run: npm run demo:real`);
} catch {
  no('manifest.json unreadable — run: npm run demo:real');
}

/* ═══ 6. IS THE BOOK THAT IS ACTUALLY LOADED ALIVE? ═══
   Sections 1-4 check the SOURCE csv. This checks what the app will actually SERVE.
   A book can be perfectly valid — every account present, every rupee correct — and
   still be useless on stage, because the calling data never joined. That book renders
   a flawless dashboard with an empty funnel and a coin-flip model, and you would not
   know until an exec asked why nobody was called. Read the served payload and refuse
   to say READY if the AI never dialled or the model never learned. */
console.log('\n═══ 6. IS THE LOADED BOOK ALIVE? ═══');
try {
  const man = JSON.parse(fs.readFileSync(path.join(R, 'src/data/manifest.json'), 'utf8'));
  // `latest` is a DATE ("2026-07-13"), not a batch id — the served batch is that
  // date's Day Total. Reading man.latest as an id looks for a file that never exists.
  const day = man.dates?.find((d) => d.date === man.latest) || man.dates?.[0];
  const id = day?.dayTotal || day?.uploads?.[0]?.id;
  const P = JSON.parse(fs.readFileSync(path.join(R, 'src/data/batches', `${id}.json`), 'utf8'));
  const M = P.intel.model;
  const conn = P.agg.funnel.find((f) => f.stage === 'AI Connected')?.value ?? 0;

  need(conn > 0,
    `the AI actually dialled: ${conn.toLocaleString('en-IN')} connected calls in the loaded book`,
    'THE LOADED BOOK HAS ZERO CONNECTED CALLS. The funnel, dispositions and the entire '
    + 'model will be empty on screen. The lead-outcome export did not join — check its Account No column.');

  need(M.auc === null || M.auc === undefined || M.auc > 0.60,
    `${M.name} learned something real: AUC ${M.auc ? M.auc.toFixed(3) : 'n/a'}`,
    `AUC IS ${M.auc?.toFixed(3)} — that is a coin flip. The model has no signal to learn from, `
    + 'which almost always means the calling data failed to join. Do not present this.');

  need((M.lifts || []).length >= 3,
    `${M.lifts.length} drivers on the RoshRegression card`,
    `only ${(M.lifts || []).length} driver(s) survived — the model's headline chart will be nearly empty`);
} catch (e) {
  no(`could not read the loaded book: ${e.message}`);
}

console.log(`\n${'─'.repeat(70)}`);
if (fails) {
  console.log(`${fails} problem(s). Fix before you open the laptop.\n`);
  process.exitCode = 1;
} else {
  console.log('READY. One clean day, real numbers, the finding is there.\n');
  console.log('  npm run dev   →   password: rblrecovery2026   →   Wi-Fi OFF\n');
}
