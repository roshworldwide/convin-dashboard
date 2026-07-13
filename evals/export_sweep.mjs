// Export leakage-clean holdout cases for all 10 synthetic reports.
//
// Per report: cut a deterministic 20% holdout FIRST, fit RoshRegression on the
// other 80%, predict the unseen 20%. Ten independent train/test cycles — no
// report's model ever sees its own test rows, and no model sees another day.
//
//   node evals/export_sweep.mjs   ->  evals/sweep/cases_day{N}.jsonl

import fs from 'node:fs';
import path from 'node:path';
import { parseCsv } from '../src/lib/csv.mjs';
import { normalizeMap, autoMap, isResolved } from '../src/lib/normalize.mjs';
import { featurize, trainPropensity, score, MODEL_NAME } from '../src/lib/model.mjs';

const REPORTS = path.join(process.cwd(), 'evals', 'reports');
const OUT = path.join(process.cwd(), 'evals', 'sweep');
fs.mkdirSync(OUT, { recursive: true });

const man = JSON.parse(fs.readFileSync(path.join(REPORTS, 'manifest.json'), 'utf8'));
const inr = (n) => '₹' + Math.round(n).toLocaleString('en-IN');

const caseInput = (r) => [
  `A credit-card collections account at RBL Bank.`,
  `Outstanding: ${inr(r.total_outstanding)}. Minimum due: ${inr(r.minimum_amount_due)}.`,
  `Months on book: ${r.months_on_book}. Accounts held by this customer: ${r.total_accounts_with_customer}.`,
  `AI calling: ${r.ai_attempts} attempt(s), ${r.ai_connected_calls} connected, ${r.ai_connected_seconds}s total talk time.`,
  `Last disposition: ${r.disp_l1 || 'none'}${r.disp_l2 ? ` / ${r.disp_l2}` : ''}. Qualification: ${r.qual_status || 'none'}.`,
  `Customer said they already paid: ${r.paid_flag}. Promised to pay: ${r.promise_flag}. Refused to pay: ${r.refusal_flag}.`,
  ``,
  `Will this account be RECOVERED in this cycle? Answer exactly one word: Resolved or Unresolved.`,
].join('\n');

const L = (b) => (b ? 'Resolved' : 'Unresolved');
const summary = [];

for (const d of man.days) {
  const parsed = parseCsv(fs.readFileSync(path.join(REPORTS, d.file), 'utf8'));
  const headers = parsed[0];
  const mapping = autoMap(headers);
  const rows = parsed.slice(1).filter((r) => r && r.length > 1).map((r) => {
    const rec = {};
    headers.forEach((h, i) => { rec[h] = r[i]; });
    return normalizeMap(rec, mapping);
  });

  const train = [], hold = [];
  rows.forEach((r, i) => (i % 5 === 0 ? hold : train).push(r));
  const fitted = trainPropensity(train.map(featurize), train.map((r) => (isResolved(r) ? 1 : 0)));
  if (!fitted) { console.log(`Day ${d.day}: could not fit — skipped`); continue; }

  const cases = hold.map((r, i) => {
    const x = featurize(r);
    return {
      id: `d${d.day}-${String(i).padStart(4, '0')}`,
      input: caseInput(r),
      reference: isResolved(r) ? 'Resolved' : 'Unresolved',
      preds: {
        roshregression: L(score(fitted.model, x) >= 0.5),
        'rule-promise-to-pay': L(String(r.promise_flag).toUpperCase() === 'YES'),
        'rule-connected-call': L(r.ai_connected_calls > 0),
        'rule-talked-2min': L(r.ai_connected_seconds >= 120),
        'majority-class': 'Unresolved',
      },
      prob: score(fitted.model, x),
    };
  });

  fs.writeFileSync(path.join(OUT, `cases_day${d.day}.jsonl`),
    cases.map((c) => JSON.stringify(c)).join('\n') + '\n');

  summary.push({ day: d.day, iso: d.iso, note: d.note,
    trainedOn: train.length, heldOut: hold.length,
    auc: fitted.auc, weights: fitted.model.w, bias: fitted.model.b });
  console.log(`Day ${String(d.day).padStart(2)}  fit on ${String(train.length).padStart(4)} `
    + `-> ${String(hold.length).padStart(4)} unseen   internal AUC ${fitted.auc.toFixed(3)}`);
}

fs.writeFileSync(path.join(OUT, 'sweep.json'), JSON.stringify({ model: MODEL_NAME, synthetic: true, days: summary }, null, 2));
console.log(`\n${summary.length} reports -> evals/sweep/`);
