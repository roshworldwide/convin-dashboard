// RoshRegression — honest evaluation harness.
//
// Run this before any client meeting where someone might ask "how good is it?".
// It reports 5-fold cross-validated AUC (not one lucky split), strips the
// outcome-echoing features to show what the model can genuinely PREDICT, compares
// against single-signal baselines, and — the number that actually matters to a
// bank — measures how much of the recoverable money the ranking concentrates.
//
//   node eval_model.mjs [batchFile]      (or: npm run eval)

import fs from 'node:fs';
import path from 'node:path';
import { featurize, FEATURE_NAMES, trainPropensity, score, MODEL_NAME, MODEL_VERSION } from './src/lib/model.mjs';
import { isResolved } from './src/lib/normalize.mjs';

const BATCHES = path.join(process.cwd(), 'src', 'data', 'batches');
const arg = process.argv[2];
const file = arg || fs.readdirSync(BATCHES).filter((f) => f.endsWith('.canon.json')).sort().pop();
const rows = JSON.parse(fs.readFileSync(path.join(BATCHES, path.basename(file)), 'utf8'));
const y = rows.map((r) => (isResolved(r) ? 1 : 0));
const base = y.reduce((a, b) => a + b, 0) / y.length;

/* Rank-based AUC (Mann-Whitney U), tie-safe. */
const auc = (s, l) => {
  const p = s.map((v, i) => [v, l[i]]).sort((a, b) => a[0] - b[0]);
  let rs = 0, np = 0, nn = 0, i = 0;
  while (i < p.length) {
    let j = i;
    while (j < p.length && p[j][0] === p[i][0]) j++;
    const r = (i + 1 + j) / 2;
    for (let k = i; k < j; k++) { if (p[k][1] === 1) { rs += r; np++; } else nn++; }
    i = j;
  }
  return (rs - (np * (np + 1)) / 2) / (np * nn);
};

/* K-fold CV — a single holdout can flatter or punish by ±0.05 on a book this size. */
function cv(featFn, folds = 5) {
  const X = rows.map(featFn);
  const aucs = [];
  for (let f = 0; f < folds; f++) {
    const trX = [], trY = [], teX = [], teY = [];
    for (let i = 0; i < X.length; i++) {
      if (i % folds === f) { teX.push(X[i]); teY.push(y[i]); } else { trX.push(X[i]); trY.push(y[i]); }
    }
    const m = trainPropensity(trX, trY);
    if (!m) continue;
    aucs.push(auc(teX.map((x) => score(m.model, x)), teY));
  }
  const mean = aucs.reduce((a, b) => a + b, 0) / aucs.length;
  const sd = Math.sqrt(aucs.reduce((a, b) => a + (b - mean) ** 2, 0) / aucs.length);
  return { mean, sd, aucs };
}

console.log(`\n${MODEL_NAME} v${MODEL_VERSION} — evaluation on ${path.basename(file)}`);
console.log(`${rows.length} accounts · base recovery rate ${(base * 100).toFixed(1)}%\n`);

const full = cv(featurize);
console.log('FULL MODEL (all 14 features)');
console.log(`  AUC ${full.mean.toFixed(3)} ± ${full.sd.toFixed(3)}   folds: ${full.aucs.map((a) => a.toFixed(3)).join(', ')}\n`);

/* "Claimed already paid" and "Disposition: Paid" partly RESTATE the outcome rather
   than predict it. Dropping them shows what the model knows from behaviour alone. */
const ECHO = ['Claimed already paid', 'Disposition: Paid'];
const keep = FEATURE_NAMES.map((n, i) => [n, i]).filter(([n]) => !ECHO.includes(n)).map(([, i]) => i);
const honest = cv((r) => { const f = featurize(r); return keep.map((i) => f[i]); });
console.log(`ACTIONABLE MODEL (drop ${ECHO.map((e) => `"${e}"`).join(' + ')} — they echo the outcome)`);
console.log(`  AUC ${honest.mean.toFixed(3)} ± ${honest.sd.toFixed(3)}   ← genuine prediction, defensible under scrutiny\n`);

console.log('SINGLE-SIGNAL BASELINES (what one variable alone buys you)');
for (const [name, fn] of [
  ['Connected on a call', (r) => (r.ai_connected_calls > 0 ? 1 : 0)],
  ['Talk time (seconds)', (r) => r.ai_connected_seconds],
  ['Call attempts', (r) => r.ai_attempts],
  ['Outstanding (₹)', (r) => -r.total_outstanding],
]) console.log(`  ${name.padEnd(22)} AUC ${auc(rows.map(fn), y).toFixed(3)}`);
console.log('  Random guessing        AUC 0.500\n');

const X = rows.map(featurize);
const m = trainPropensity(X, y);
const scored = rows.map((r, i) => ({ p: score(m.model, X[i]), res: y[i] })).sort((a, b) => b.p - a.p);
const totalRes = y.reduce((a, b) => a + b, 0);
console.log('RANKING VALUE — work the book top-down by score instead of at random:');
for (const dec of [10, 20, 30, 50]) {
  const n = Math.round(rows.length * dec / 100);
  const caught = scored.slice(0, n).reduce((a, b) => a + b.res, 0);
  console.log(`  Top ${String(dec).padStart(2)}% of accounts → ${(caught / totalRes * 100).toFixed(1)}% of all recoveries  (${(caught / totalRes / (dec / 100)).toFixed(2)}× lift)`);
}
console.log();
