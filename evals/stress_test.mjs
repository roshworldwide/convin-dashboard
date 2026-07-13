// Adversarial stress test for the aggregation layer.
//
// The dashboard is shown to a bank. A single number that is silently wrong — a
// chart that doesn't sum to the account count, a rate that says 0% when it should
// say nothing at all — is worse than a crash, because nobody notices until the
// client does.
//
// So this doesn't check "does it run". It asserts INVARIANTS: statements that must
// be true of every possible payload, and then tries to break them with books a real
// bank could plausibly send us.
//
//   node evals/stress_test.mjs

import fs from 'node:fs';
import path from 'node:path';
import { Aggregator } from '../src/lib/aggregate.mjs';

/* ── A minimal well-formed canonical row; each case mutates what it needs. ───── */
const row = (o = {}) => ({
  account_no: 'A1', customer_name: 'TEST', status: 'Unresolved', goal_achieved: '',
  qual_status: '', disp_l1: '', disp_l2: '',
  ai_attempts: 3, ai_connected_calls: 1, ai_connected_seconds: 90,
  minimum_amount_due: 5000, total_outstanding: 50000,
  total_accounts_with_customer: 1, months_on_book: 24, curr_bal_band: '30-50K',
  region: 'South', primary_state: 'Karnataka', primary_city: 'Bengaluru',
  mobile: '9000000000', model_logic: 'Model 1',
  paid_flag: 'N/A', promise_flag: 'N/A', refusal_flag: 'N/A', refusal_reason: '',
  payment_mode: 'NA', lead_link: '', ...o,
});

/* ── Invariants. Each returns null if OK, or a description of the violation. ─── */
const num = (x) => typeof x === 'number';

function findBadNumbers(obj, trail = '') {
  const bad = [];
  const walk = (v, p) => {
    if (num(v)) { if (!Number.isFinite(v)) bad.push(`${p} = ${v}`); return; }
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${p}[${i}]`)); return; }
    if (v && typeof v === 'object') { for (const k of Object.keys(v)) walk(v[k], p ? `${p}.${k}` : k); }
  };
  walk(obj, trail);
  return bad;
}

const near = (a, b, eps = 0.51) => Math.abs(a - b) <= eps;

const INVARIANTS = [
  ['no NaN / Infinity anywhere in the payload', (p) => {
    const bad = findBadNumbers(p);
    return bad.length ? `${bad.length} non-finite value(s): ${bad.slice(0, 4).join(', ')}` : null;
  }],
  ['accounts = resolved + unresolved', (p) => {
    const t = p.agg.totals;
    return t.accounts === t.resolved + t.unresolved ? null
      : `${t.accounts} != ${t.resolved} + ${t.unresolved}`;
  }],
  ['recovered + still-open = total outstanding  (the money must balance)', (p) => {
    const t = p.agg.totals;
    return near(t.recovered + p.intel.opportunity.openOutstanding, t.sumOut, 1)
      ? null : `recovered ${t.recovered} + open ${p.intel.opportunity.openOutstanding} != sumOut ${t.sumOut}`;
  }],
  ['every percentage is within 0-100', (p) => {
    const bad = [];
    const walk = (v, path) => {
      if (num(v) && /Pct$/.test(path.split('.').pop() || '')) {
        if (v < -0.001 || v > 100.001) bad.push(`${path} = ${v.toFixed(1)}`);
      } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
      else if (v && typeof v === 'object') for (const k of Object.keys(v)) walk(v[k], `${path}.${k}`);
    };
    walk(p, '');
    return bad.length ? bad.slice(0, 3).join(', ') : null;
  }],
  ['balance-band chart accounts for every account', (p) => {
    const sum = Object.values(p.agg.band).reduce((a, b) => a + b.count, 0);
    return sum === p.agg.totals.accounts ? null
      : `bands hold ${sum} accounts but the book has ${p.agg.totals.accounts} — ${p.agg.totals.accounts - sum} silently vanished`;
  }],
  ['disposition chart accounts for every account', (p) => {
    const sum = p.agg.disposition.reduce((a, d) => a + d.total, 0);
    return sum === p.agg.totals.accounts ? null : `dispositions hold ${sum} of ${p.agg.totals.accounts}`;
  }],
  ['call-duration chart accounts for every account', (p) => {
    const sum = p.agg.duration.reduce((a, d) => a + d.n, 0);
    return sum === p.agg.totals.accounts ? null : `duration buckets hold ${sum} of ${p.agg.totals.accounts}`;
  }],
  ['funnel never widens (connected <= attempted <= total)', (p) => {
    const f = Object.fromEntries(p.agg.funnel.map((x) => [x.stage, x.value]));
    if (f['AI Attempted'] > f['Total Accounts']) return `attempted ${f['AI Attempted']} > total ${f['Total Accounts']}`;
    if (f['AI Connected'] > f['AI Attempted']) return `connected ${f['AI Connected']} > attempted ${f['AI Attempted']}`;
    return null;
  }],
  ['propensity tiers cover the whole open book — or admit they are not ranked', (p) => {
    const opp = p.intel.opportunity;
    const t = opp.tiers;
    const cnt = t.High.count + t.Medium.count + t.Low.count;
    const amt = t.High.amount + t.Medium.amount + t.Low.amount;
    const openN = p.agg.totals.unresolved;

    // If the model could not fit, the ONLY acceptable behaviour is to say so.
    // Rendering ₹0 in every tier next to a live open book is a lie by omission.
    if (!opp.ranked) {
      return cnt === 0 ? null : `not ranked, yet tiers hold ${cnt} accounts`;
    }
    if (openN === 0) return cnt === 0 ? null : `no open accounts but tiers hold ${cnt}`;
    if (cnt !== openN) return `tiers hold ${cnt} accounts but ${openN} are open — missing ${openN - cnt}`;
    return near(amt, opp.openOutstanding, 1) ? null
      : `tier amounts sum to ${amt.toFixed(0)} but the open book is ${opp.openOutstanding.toFixed(0)}`;
  }],
  ['an unranked book must not be presented as ranked', (p) => {
    const opp = p.intel.opportunity;
    if (opp.ranked) return null;
    if (opp.openOutstanding > 0 && p.intel.model.trained) return 'model says trained but book is unranked';
    return null;
  }],
  ['payment-mode amounts never exceed what was recovered', (p) => {
    const sum = p.agg.paymentModes.reduce((a, m) => a + m.amount, 0);
    return sum <= p.agg.totals.recovered + 1 ? null
      : `payment modes total ${sum.toFixed(0)} > recovered ${p.agg.totals.recovered.toFixed(0)}`;
  }],
  ['top-outstanding list is sorted, high to low', (p) => {
    const t = p.agg.topOutstanding;
    for (let i = 1; i < t.length; i++) if (t[i].outstanding > t[i - 1].outstanding) return `row ${i} breaks the sort`;
    return null;
  }],
  ['lift base rate matches the reported resolution rate', (p) => {
    const l = p.intel.model.lifts[0];
    if (!l) return null;
    return near(l.basePct, p.agg.totals.resolutionRatePct, 0.01) ? null
      : `lift base ${l.basePct.toFixed(2)}% != resolution ${p.agg.totals.resolutionRatePct.toFixed(2)}%`;
  }],
  ['narrative never contradicts the model', (p) => {
    const promise = p.intel.model.lifts.find((l) => l.name === 'Promised to pay');
    if (!promise) return null;
    const s = p.intel.dealCase;
    const saysWorkFirst = /promise[^.]*work it first/i.test(s);
    const saysDontWork = /should not be worked first/i.test(s);
    if (promise.liftPts <= -5 && saysWorkFirst) return 'model says promises are a trap but the narrative says work them first';
    if (promise.liftPts >= 5 && saysDontWork) return 'model says promises are good but the narrative says do not work them';
    return null;
  }],
];

/* ── The adversarial books. Each is something a bank could really send. ─────── */
const N = (n, f) => Array.from({ length: n }, (_, i) => f(i));

const CASES = {
  'empty book (0 rows)': [],
  'single account': [row()],
  '59 accounts — just under the model minimum': N(59, (i) => row({ status: i % 2 ? 'Resolved' : 'Unresolved' })),
  'every account resolved': N(200, () => row({ status: 'Resolved', paid_flag: 'YES', payment_mode: 'UPI' })),
  'no account resolved': N(200, () => row({ status: 'Unresolved' })),
  'zero outstanding on every account': N(200, (i) => row({ total_outstanding: 0, minimum_amount_due: 0, status: i % 3 ? 'Unresolved' : 'Resolved' })),
  'a credit balance (negative outstanding)': N(200, (i) => row({ total_outstanding: i === 0 ? -25000 : 40000, status: i % 3 ? 'Unresolved' : 'Resolved' })),
  'nobody ever picked up': N(200, (i) => row({ ai_attempts: 8, ai_connected_calls: 0, ai_connected_seconds: 0, status: i % 4 ? 'Unresolved' : 'Resolved' })),
  'no calls were ever placed': N(200, (i) => row({ ai_attempts: 0, ai_connected_calls: 0, ai_connected_seconds: 0, status: i % 4 ? 'Unresolved' : 'Resolved' })),
  'a balance band we have never seen': N(200, (i) => row({ curr_bal_band: '5-20K', status: i % 3 ? 'Unresolved' : 'Resolved' })),
  'blank region and state': N(200, (i) => row({ region: '', primary_state: '', status: i % 3 ? 'Unresolved' : 'Resolved' })),
  'connected calls but zero talk time': N(200, (i) => row({ ai_connected_calls: 2, ai_connected_seconds: 0, status: i % 3 ? 'Unresolved' : 'Resolved' })),
  'connected without ever being attempted (dirty export)': N(200, (i) => row({ ai_attempts: 0, ai_connected_calls: 2, status: i % 3 ? 'Unresolved' : 'Resolved' })),
  'one whale holding 90% of the book': N(200, (i) => row({ total_outstanding: i === 0 ? 5e8 : 30000, status: i % 3 ? 'Unresolved' : 'Resolved' })),
  'realistic book — promises are a trap': N(400, (i) => {
    const promised = i % 3 === 0;
    const resolved = promised ? i % 9 === 0 : i % 2 === 0;
    return row({ status: resolved ? 'Resolved' : 'Unresolved', promise_flag: promised ? 'YES' : 'NO', ai_connected_seconds: i % 5 === 0 ? 300 : 20 });
  }),
  'realistic book — promises are good': N(400, (i) => {
    const promised = i % 3 === 0;
    const resolved = promised ? i % 4 !== 0 : i % 5 === 0;
    return row({ status: resolved ? 'Resolved' : 'Unresolved', promise_flag: promised ? 'YES' : 'NO', ai_connected_seconds: i % 5 === 0 ? 300 : 20 });
  }),
};

/* ── Run ─────────────────────────────────────────────────────────────────────── */
let failures = 0, checks = 0;
const report = [];

for (const [name, rows] of Object.entries(CASES)) {
  let p, crash = null;
  try {
    const a = new Aggregator();
    for (const r of rows) a.add(r);
    p = a.payload('1 January 2026');
  } catch (e) { crash = e.message; }

  if (crash) {
    failures++;
    report.push({ case: name, invariant: 'must not crash', detail: crash });
    console.log(`✘ ${name}\n    CRASH: ${crash}`);
    continue;
  }

  const violations = [];
  for (const [label, check] of INVARIANTS) {
    checks++;
    let v = null;
    try { v = check(p); } catch (e) { v = `check threw: ${e.message}`; }
    if (v) { violations.push([label, v]); failures++; report.push({ case: name, invariant: label, detail: v }); }
  }

  if (violations.length === 0) {
    console.log(`✔ ${name}  (${rows.length} rows)`);
  } else {
    console.log(`✘ ${name}  (${rows.length} rows)`);
    for (const [label, v] of violations) console.log(`    ${label}\n      -> ${v}`);
  }
}

console.log(`\n${'─'.repeat(72)}`);
console.log(`${Object.keys(CASES).length} books · ${checks} invariant checks · ${failures} violation(s)`);
fs.writeFileSync(path.join(process.cwd(), 'evals', 'stress_report.json'), JSON.stringify(report, null, 2));
if (failures) { console.log(`\nSee evals/stress_report.json`); process.exitCode = 1; }
