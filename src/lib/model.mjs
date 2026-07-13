// ─────────────────────────────────────────────────────────────────────────────
// RoshRegression — Convin's recovery-propensity engine.
//
// A regularised logistic regression, retrained on every report from that report's
// own outcomes (Resolved = 1, Unresolved = 0). It learns which collection signals
// actually move an account to recovery, then scores the open book so RBL knows
// which unresolved accounts to work first.
//
// Why hand-rolled rather than an npm package: it's ~60 lines of standard maths
// (the same objective scikit-learn's LogisticRegression optimises), it adds zero
// dependencies, it runs inside the ingest path, and — crucially for a bank —
// every coefficient is inspectable. No black box, no external API, no API key,
// and no customer data ever leaves the bank's environment.
//
// Features are standardised, fitted by full-batch gradient descent with L2, and
// scored on a deterministic 20% holdout so the reported AUC is out-of-sample.
// ─────────────────────────────────────────────────────────────────────────────

export const MODEL_NAME = 'RoshRegression';
export const MODEL_VERSION = '1.0';

const U = (x) => String(x ?? '').trim().toUpperCase();

/* Feature definitions. Every one is known BEFORE an account resolves, so there
   is no leakage from the outcome we're predicting. */
const FEATURES = [
  ['Connected on a call', (r) => (r.ai_connected_calls > 0 ? 1 : 0)],
  ['Talk time (log seconds)', (r) => Math.log1p(r.ai_connected_seconds)],
  ['Talked 2+ minutes', (r) => (r.ai_connected_seconds >= 120 ? 1 : 0)],
  ['Number of call attempts', (r) => r.ai_attempts],
  ['Promised to pay', (r) => (U(r.promise_flag) === 'YES' ? 1 : 0)],
  ['Claimed already paid', (r) => (U(r.paid_flag) === 'YES' ? 1 : 0)],
  ['Refused to pay', (r) => (r.refusal_flag === 'YES' ? 1 : 0)],
  ['Qualified lead', (r) => (r.qual_status === 'Qualified' ? 1 : 0)],
  ['Disposition: Paid', (r) => (r.disp_l1 === 'Paid' ? 1 : 0)],
  ['Disposition: Callback', (r) => (r.disp_l1 === 'Schedule Callback' ? 1 : 0)],
  ['Disposition: DNC', (r) => (r.disp_l1 === 'DNC' ? 1 : 0)],
  ['Outstanding (log ₹)', (r) => Math.log1p(Math.max(0, r.total_outstanding))],
  ['Months on book', (r) => r.months_on_book],
  ['Holds 2+ accounts', (r) => (r.total_accounts_with_customer > 1 ? 1 : 0)],

];

export const FEATURE_NAMES = FEATURES.map(([n]) => n);
export const featurize = (r) => FEATURES.map(([, f]) => {
  const v = f(r);
  return Number.isFinite(v) ? v : 0;
});

/* ── CATEGORICAL FEATURES, DISCOVERED FROM THE BOOK ───────────────────────────
   RBL's segment and Convin's collection score are categories, and we do not get
   to decide what categories a bank will send us. Hardcoding "Red" and "high" was
   wrong: the moment RBL ships an Amber/Green cycle, or the score says "medium",
   a hardcoded model is blind to the very thing the exec asked us to analyse.

   So the vocabulary is learned from the data. For every distinct value we actually
   see, we create one binary column. Two rules keep it honest:

     · a value on FEWER than `minN` accounts is dropped — a lift computed on eleven
       accounts is noise wearing a number, and it would outrank real signal on the
       card purely because small samples swing wide.

     · a value on EVERY account is dropped — it is a constant, it cannot correlate
       with anything, and its lift is exactly 0.0 by construction. ("Segment = Red"
       is the whole CYC file today. Charting a 0.0-point bar would read to an exec
       as a broken chart rather than an absent signal.)

   The reference category is left out on purpose. With every level present, the
   columns sum to 1 on every row and are perfectly collinear with the intercept,
   which makes the coefficients unstable and meaningless. Dropping the largest
   level makes every other coefficient read as "compared with the typical account".
*/
const CATEGORICALS = [
  { field: 'segment', label: (v) => `RBL segment: ${v}` },
  { field: 'lead_score', label: (v) => `Our score: ${v}` },
];

const title = (v) => String(v).charAt(0).toUpperCase() + String(v).slice(1).toLowerCase();

/** Scan the book, decide which category columns are worth having. */
export function buildCategoricalSpec(rows, minN = 30) {
  const cols = [];
  for (const { field, label } of CATEGORICALS) {
    const counts = new Map();
    for (const r of rows) {
      const v = U(r[field]);
      if (!v || v === 'NA' || v === 'N/A') continue;   // blank is not a category
      counts.set(v, (counts.get(v) || 0) + 1);
    }
    if (counts.size < 2) continue;                     // constant (or empty) — nothing to learn

    // Drop the largest level: it becomes the reference the others are measured against.
    const ordered = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    for (const [value, n] of ordered.slice(1)) {
      if (n < minN || n === rows.length) continue;
      cols.push({ field, value, name: label(title(value)), n });
    }
  }
  return cols;
}

/** One-hot a row against a spec. Same order every time — the spec IS the schema. */
export const encodeCategorical = (r, spec) => spec.map((c) => (U(r[c.field]) === c.value ? 1 : 0));

/** Full feature vector: the fixed 14, then whatever categories this book contains. */
export const featurizeWith = (r, spec) => [...featurize(r), ...encodeCategorical(r, spec)];
export const featureNamesWith = (spec) => [...FEATURE_NAMES, ...spec.map((c) => c.name)];

const sigmoid = (z) => 1 / (1 + Math.exp(-z));

/** Fit logistic regression on standardised features. */
function fit(X, y, { epochs = 400, lr = 0.5, l2 = 1e-3 } = {}) {
  const n = X.length, d = X[0].length;
  const mean = new Array(d).fill(0);
  const std = new Array(d).fill(0);
  for (const r of X) for (let j = 0; j < d; j++) mean[j] += r[j];
  for (let j = 0; j < d; j++) mean[j] /= n;
  for (const r of X) for (let j = 0; j < d; j++) std[j] += (r[j] - mean[j]) ** 2;
  for (let j = 0; j < d; j++) std[j] = Math.sqrt(std[j] / n) || 1;

  const Z = X.map((r) => r.map((v, j) => (v - mean[j]) / std[j]));
  const w = new Array(d).fill(0);
  let b = 0;

  for (let e = 0; e < epochs; e++) {
    const gw = new Array(d).fill(0);
    let gb = 0;
    for (let i = 0; i < n; i++) {
      let z = b;
      for (let j = 0; j < d; j++) z += w[j] * Z[i][j];
      const err = sigmoid(z) - y[i];
      for (let j = 0; j < d; j++) gw[j] += err * Z[i][j];
      gb += err;
    }
    for (let j = 0; j < d; j++) w[j] -= lr * (gw[j] / n + l2 * w[j]);
    b -= lr * (gb / n);
  }
  return { w, b, mean, std };
}

/** Probability of resolution for one raw feature vector. */
export function score(model, x) {
  let z = model.b;
  for (let j = 0; j < x.length; j++) z += model.w[j] * ((x[j] - model.mean[j]) / model.std[j]);
  return sigmoid(z);
}

/** Rank-based AUC (Mann-Whitney U), tie-safe. Null if only one class present. */
function auc(scores, labels) {
  const pairs = scores.map((s, i) => [s, labels[i]]).sort((a, b) => a[0] - b[0]);
  let rankSumPos = 0, nPos = 0, nNeg = 0, i = 0;
  while (i < pairs.length) {
    let j = i;
    while (j < pairs.length && pairs[j][0] === pairs[i][0]) j++;
    const avgRank = (i + 1 + j) / 2;
    for (let k = i; k < j; k++) {
      if (pairs[k][1] === 1) { rankSumPos += avgRank; nPos++; } else nNeg++;
    }
    i = j;
  }
  if (!nPos || !nNeg) return null;
  return (rankSumPos - (nPos * (nPos + 1)) / 2) / (nPos * nNeg);
}

/**
 * Observed lift per binary feature: how often accounts WITH that trait actually
 * resolved, against the batch's own base rate.
 *
 * This — not the regression coefficients — is what the dashboard shows. A logistic
 * coefficient is a CONDITIONAL effect: with correlated inputs (e.g. "claimed paid"
 * and "disposition = Paid" describe the same customers) a coefficient can flip
 * negative even though the trait is strongly positive on its own. Lift is marginal,
 * unambiguous, and an exec can verify it by filtering the account table.
 */
export function computeLifts(X, y, minN = 30, names = FEATURE_NAMES) {
  const n = X.length, d = X[0].length;
  const base = y.reduce((a, b) => a + b, 0) / n;
  const out = [];
  for (let j = 0; j < d; j++) {
    let binary = true;
    for (let i = 0; i < n; i++) { const v = X[i][j]; if (v !== 0 && v !== 1) { binary = false; break; } }
    if (!binary) continue;
    let cnt = 0, res = 0;
    for (let i = 0; i < n; i++) if (X[i][j] === 1) { cnt++; res += y[i]; }
    if (cnt < minN) continue;

    /* A CONSTANT column tells you nothing, and must never reach the dashboard.
       "RBL segment: Red" is 1 on every row of every CYC export we have seen —
       the whole file is the red segment. Its lift is therefore exactly 0.0 by
       construction, and a "+0.0 pts" bar sitting on the RoshRegression card
       reads to an exec as a broken chart, not as an absent signal. Drop it. */
    if (cnt === n) continue;

    const rate = res / cnt;
    out.push({ name: names[j], n: cnt, ratePct: rate * 100, basePct: base * 100, liftPts: (rate - base) * 100 });
  }
  return out.sort((a, b) => Math.abs(b.liftPts) - Math.abs(a.liftPts));
}

/**
 * Fit RoshRegression on the batch. X = feature vectors, y = 1 if resolved.
 * Deterministic 20% holdout (every 5th row) so the AUC is out-of-sample.
 * Returns null when the batch can't support a model (too small / one class only).
 */
export function trainPropensity(X, y, names = FEATURE_NAMES) {
  const n = X.length;
  const pos = y.reduce((a, v) => a + v, 0);
  if (n < 60 || pos < 15 || n - pos < 15) return null;

  const trX = [], trY = [], teX = [], teY = [];
  for (let i = 0; i < n; i++) {
    if (i % 5 === 0) { teX.push(X[i]); teY.push(y[i]); } else { trX.push(X[i]); trY.push(y[i]); }
  }
  const model = fit(trX, trY);
  const testAuc = auc(teX.map((x) => score(model, x)), teY);

  // Standardised coefficients are directly comparable → rank them as "drivers".
  const drivers = model.w
    .map((w, j) => ({ name: names[j], weight: w, effect: w >= 0 ? 'up' : 'down' }))
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));

  return { model, auc: testAuc, drivers, trainedOn: trX.length, testedOn: teX.length };
}
