/* Adversarial tests for the CAMPAIGN SUMMARY.
 *
 * There is exactly one way this feature can badly hurt us, and it is not a crash.
 *
 * Every report date is a re-pull of the SAME book — one CYC file, joined against a
 * status file pulled a day later each time. So if the summary SUMS the days instead of
 * UNIONING them, it reports the money once per date. On a five-day campaign that is 5×
 * the recovery, on a ₹55 Cr book. The number is arithmetically defensible, visually
 * plausible, renders beautifully, and is the one an exec repeats out loud in front of
 * the client.
 *
 * That bug already shipped once, at the day level: three uploads of a ₹13 Cr book
 * produced a ₹65 Cr "Day Total". These tests exist so it cannot happen again a level up.
 *
 *   node evals/stress_summary.mjs
 */

import { Aggregator } from '../src/lib/aggregate.mjs';
import { buildSummary, buildFindings, buildActions } from '../src/lib/summary.mjs';

const CYC = [{ slot: 'CYC / PDD (primary)', name: 'CYC 12.xlsx', detected: 'cyc' }];
const OTHER = [{ slot: 'CYC / PDD (primary)', name: 'CYC 13.xlsx', detected: 'cyc' }];

const row = (id, resolved, o = {}) => ({
  account_no: id, customer_name: 'C' + id, status: resolved ? 'Resolved' : 'Unresolved',
  goal_achieved: '', qual_status: '', disp_l1: '', disp_l2: '',
  ai_attempts: 4, ai_connected_calls: 1, ai_connected_seconds: 120,
  minimum_amount_due: 1000, total_outstanding: 100000,
  total_accounts_with_customer: 1, months_on_book: 12, curr_bal_band: '100-200K',
  region: 'West', primary_state: 'MH', primary_city: 'X', mobile: '', model_logic: '',
  paid_flag: 'NA', promise_flag: 'NA', refusal_flag: 'NA', refusal_reason: '',
  payment_mode: 'NA', lead_link: '', segment: 'Red', lead_score: 'high',
  last_call_at: '2026-07-04', ...o,
});

const pay = (rows, display, sources) => {
  const a = new Aggregator();
  for (const r of rows) a.add(r);
  return a.payload(display, sources);
};

/** Union exactly as backend.mjs does: oldest → newest, newest wins. */
const union = (books) => {
  const m = new Map();
  for (const rows of books) for (const r of rows) m.set(r.account_no, r);
  return [...m.values()];
};

let checks = 0, failures = 0;
const ok = (label, cond, detail = '') => {
  checks++;
  if (cond) { console.log(`✔ ${label}`); return; }
  failures++;
  console.log(`✘ ${label}\n    ${detail}`);
};

/* ── 1. THE BIG ONE. One report date, the SAME 1,000-account book, read on 3 Days
       against progressively later status files. 100 -> 250 -> 600 accounts resolve.
       The book is Rs 10 Cr. ── */
{
  const book = (n) => Array.from({ length: 1000 }, (_, i) => row('A' + i, i < n));
  const books = [book(100), book(250), book(600)];
  const days = books.map((rows, i) => ({
    id: `2026-07-03__u${i + 1}`, label: `Day ${i + 1}`, payload: pay(rows, `Day ${i + 1}`, CYC),
  }));
  // The Day Total: the union of the Days, newest status winning. Never their sum.
  const campaign = pay(union(books), '3 July 2026', CYC);
  const s = buildSummary({ campaign, days, date: '2026-07-03', display: '3 July 2026' });
  const t = s.campaign.agg.totals;

  const naive = s.trend.reduce((a, d) => a + d.recovered, 0);

  ok('the Day Total never multiplies the accounts', t.accounts === 1000,
    `got ${t.accounts}, expected 1,000 (summing the 3 Days would give 3,000)`);
  ok('the Day Total never multiplies the money', t.recovered === 600 * 100000,
    `got Rs ${(t.recovered / 1e7).toFixed(2)} Cr, expected Rs 6.00 Cr (the naive sum gives Rs ${(naive / 1e7).toFixed(2)} Cr)`);
  ok('outstanding is the book, once', t.sumOut === 1000 * 100000,
    `got Rs ${(t.sumOut / 1e7).toFixed(2)} Cr, expected Rs 10.00 Cr`);
  ok('recovered can never exceed the book', t.recovered <= t.sumOut,
    `recovered ${t.recovered} > outstanding ${t.sumOut}`);
  ok('resolved can never exceed the accounts', t.resolved <= t.accounts,
    `resolved ${t.resolved} > accounts ${t.accounts}`);
  ok('the naive sum WOULD have been wrong (so this test is worth something)', naive > t.recovered,
    'the sum and the Day Total agree, so this book does not exercise the bug');
  ok('the trend is one row per Day, in order',
    s.trend.length === 3 && s.trend[0].label === 'Day 1' && s.trend[2].label === 'Day 3',
    `trend = ${JSON.stringify(s.trend.map((d) => d.label))}`);
  ok('movement is measured Day 1 -> Day 3', s.movement && s.movement.resolved === 500,
    `movement.resolved = ${s.movement?.resolved}, expected 500 (600 - 100)`);
  ok('movement is labelled by Day, not by date',
    s.movement?.from === 'Day 1' && s.movement?.to === 'Day 3',
    `movement = ${JSON.stringify(s.movement)}`);
  ok('the summary is scoped to the date it was asked for', s.date === '2026-07-03',
    `date = ${s.date}`);
  ok('every Day sees the same accounts (they are the same book)',
    s.trend.every((d) => d.accounts === 1000),
    `accounts per Day = ${JSON.stringify(s.trend.map((d) => d.accounts))}`);
  ok('recovery climbs across the Days', s.trend[0].recovered < s.trend[1].recovered && s.trend[1].recovered < s.trend[2].recovered,
    `recovered per Day = ${JSON.stringify(s.trend.map((d) => d.recovered))}`);
}

/* ── 2. A single Day. No movement can be claimed from one reading. ── */
{
  const book = Array.from({ length: 500 }, (_, i) => row('A' + i, i < 120));
  const days = [{ id: '2026-07-03__u1', label: 'Day 1', payload: pay(book, 'Day 1', CYC) }];
  const s = buildSummary({ campaign: pay(book, '3 July 2026', CYC), days, date: '2026-07-03', display: '3 July 2026' });
  ok('one Day claims no movement', s.movement === null, `movement = ${JSON.stringify(s.movement)}`);
  ok('one Day still reports the book', s.campaign.agg.totals.accounts === 500,
    `accounts = ${s.campaign.agg.totals.accounts}`);
}

/* ── 3. Degenerate books. None of these should throw, and none should lie. ── */
{
  ok('an empty campaign does not crash', (() => {
    try { buildSummary({ campaign: pay([], 'x', CYC), days: [] }); return true; } catch { return false; }
  })(), 'buildSummary threw on an empty book');

  const none = Array.from({ length: 200 }, (_, i) => row('A' + i, false));
  const s = buildSummary({ campaign: pay(none, 'x', CYC), days: [{ id: 'x__u1', label: 'Day 1', payload: pay(none, 'x', CYC) }] });
  ok('a book where nobody resolved reports ₹0, not NaN',
    s.campaign.agg.totals.recovered === 0 && Number.isFinite(s.campaign.agg.totals.resolutionRatePct),
    `recovered=${s.campaign.agg.totals.recovered} rate=${s.campaign.agg.totals.resolutionRatePct}`);
  ok('a single Day claims no movement', s.movement === null,
    'movement was reported from one Day — there is nothing to compare it to');

  const all = Array.from({ length: 200 }, (_, i) => row('A' + i, true));
  const s2 = buildSummary({ campaign: pay(all, 'x', CYC), days: [{ id: 'x__u1', label: 'Day 1', payload: pay(all, 'x', CYC) }] });
  ok('a fully-resolved book leaves an empty work queue, not a negative one',
    s2.openAccounts === 0 && s2.openAmount === 0 && s2.actions.every((a) => a.count > 0),
    `open=${s2.openAccounts} amount=${s2.openAmount}`);
}

/* ── 4. The findings must FOLLOW the data, not assert a story. On a book where
       promises convert, the summary must say so — the same code that calls them a trap
       elsewhere. A narrative that always says the same thing is decoration. ── */
{
  const trap = Array.from({ length: 400 }, (_, i) => {
    const promised = i % 2 === 0;
    return row('A' + i, promised ? i % 10 === 0 : i % 2 === 1, { disp_l2: promised ? 'Promise to Pay Later' : '' });
  });
  const good = Array.from({ length: 400 }, (_, i) => {
    const promised = i % 2 === 0;
    return row('A' + i, promised ? true : i % 5 === 0, { disp_l2: promised ? 'Promise to Pay Later' : '' });
  });
  const fTrap = buildFindings(pay(trap, 'x', CYC));
  const fGood = buildFindings(pay(good, 'x', CYC));
  const pTrap = fTrap.find((f) => f.label.includes('promise') || f.label.includes('Promise'));
  const pGood = fGood.find((f) => f.label.includes('promise') || f.label.includes('Promise'));

  ok('on a book where promises FAIL, the summary calls it a trap',
    pTrap && pTrap.kind === 'bad', `got ${JSON.stringify(pTrap)}`);
  ok('on a book where promises CONVERT, the same code says so',
    pGood && pGood.kind === 'good', `got ${JSON.stringify(pGood)}`);
}

/* ── 5. The work queue must never invent money it cannot point at. ── */
{
  const rows = Array.from({ length: 500 }, (_, i) => row('A' + i, i < 200, {
    promise_flag: i % 4 === 0 ? 'YES' : 'NA',
    paid_flag: i % 7 === 0 ? 'YES' : 'NA',
    ai_connected_seconds: i % 3 === 0 ? 300 : 10,
  }));
  const p = pay(rows, 'x', CYC);
  const { actions, openAmount, openAccounts } = buildActions(p);
  ok('every action bucket has both a count and an amount',
    actions.every((a) => a.count > 0 && Number.isFinite(a.amount)),
    JSON.stringify(actions));
  ok('the open book matches the totals it came from',
    openAccounts === p.agg.totals.unresolved && Math.abs(openAmount - p.agg.totals.outstandingPending) < 1,
    `open ${openAccounts}/${openAmount} vs totals ${p.agg.totals.unresolved}/${p.agg.totals.outstandingPending}`);
  ok('actions are ranked by value, largest first',
    actions.every((a, i) => i === 0 || actions[i - 1].amount >= a.amount),
    JSON.stringify(actions.map((a) => a.amount)));
}

console.log(`\n${'─'.repeat(72)}`);
console.log(`${checks} checks · ${failures} failure(s)`);
if (failures) process.exitCode = 1;
