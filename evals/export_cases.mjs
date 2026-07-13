// Export a leakage-clean holdout set for the `holdout` eval framework.
//
// RoshRegression is normally REFITTED on the batch it scores — which is correct in
// production (each report is its own book) but would be contamination in an eval.
// So here we cut a deterministic 20% holdout FIRST, fit only on the other 80%, and
// emit predictions for accounts the model has never seen.
//
// Emits evals/cases.jsonl — one row per held-out account:
//   { id, input, reference, preds: { <target>: "Resolved" | "Unresolved" }, prob }
//
//   node evals/export_cases.mjs [batchFile]

import fs from 'node:fs';
import path from 'node:path';
import { featurize, trainPropensity, score, MODEL_NAME, MODEL_VERSION } from '../src/lib/model.mjs';
import { isResolved } from '../src/lib/normalize.mjs';

const BATCHES = path.join(process.cwd(), 'src', 'data', 'batches');
const file = process.argv[2]
  || fs.readdirSync(BATCHES).filter((f) => f.endsWith('.canon.json')).sort().pop();
const rows = JSON.parse(fs.readFileSync(path.join(BATCHES, path.basename(file)), 'utf8'));

/* ── Deterministic split. Every 5th account is held out and NEVER trained on. ── */
const train = [], hold = [];
rows.forEach((r, i) => (i % 5 === 0 ? hold : train).push(r));

const trX = train.map(featurize);
const trY = train.map((r) => (isResolved(r) ? 1 : 0));
const fitted = trainPropensity(trX, trY);
if (!fitted) throw new Error('Not enough data to fit RoshRegression on the train split.');

/* ── The prompt. Written so a human, a rule, or an LLM could all answer it — which
      means the same eval file can later pit RoshRegression against Claude. ────── */
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

/* ── The systems under evaluation. ───────────────────────────────────────────────
   The point of a baseline is not to be stupid — it's to be what the client does
   TODAY. "Chase whoever promised to pay" is the incumbent collections playbook,
   so that is the number RoshRegression has to beat to be worth buying.          */
const L = (b) => (b ? 'Resolved' : 'Unresolved');
const TARGETS = {
  [`${MODEL_NAME.toLowerCase()}`]: (r, x) => L(score(fitted.model, x) >= 0.5),
  'rule-promise-to-pay': (r) => L(String(r.promise_flag).toUpperCase() === 'YES'),
  'rule-connected-call': (r) => L(r.ai_connected_calls > 0),
  'rule-talked-2min': (r) => L(r.ai_connected_seconds >= 120),
  'majority-class': () => 'Unresolved',
};

const out = hold.map((r, i) => {
  const x = featurize(r);
  const preds = {};
  for (const [name, fn] of Object.entries(TARGETS)) preds[name] = fn(r, x);
  return {
    id: `acct-${String(i).padStart(4, '0')}`,
    input: caseInput(r),
    reference: isResolved(r) ? 'Resolved' : 'Unresolved',
    preds,
    prob: score(fitted.model, x),
  };
});

const dir = path.join(process.cwd(), 'evals');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'cases.jsonl'), out.map((o) => JSON.stringify(o)).join('\n') + '\n');
fs.writeFileSync(path.join(dir, 'model_card.json'), JSON.stringify({
  model: MODEL_NAME,
  version: MODEL_VERSION,
  batch: path.basename(file),
  trainedOn: train.length,
  heldOut: hold.length,
  weights: fitted.model.w,          // fingerprint material: any refit changes the run hash
  bias: fitted.model.b,
}, null, 2));

const posRate = out.filter((o) => o.reference === 'Resolved').length / out.length;
console.log(`${MODEL_NAME} v${MODEL_VERSION} — fit on ${train.length}, holding out ${hold.length} unseen accounts`);
console.log(`Holdout base rate: ${(posRate * 100).toFixed(1)}% resolved`);
console.log(`Targets: ${Object.keys(TARGETS).join(', ')}`);
console.log(`→ evals/cases.jsonl`);
