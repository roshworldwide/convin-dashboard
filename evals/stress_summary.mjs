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

/* ── 1. THE BIG ONE. The same 1,000-account book, re-pulled on three dates.
       100 → 250 → 600 accounts resolve. The book is ₹10 Cr. ── */
{
  const book = (n) => Array.from({ length: 1000 }, (_, i) => row('A' + i, i < n));
  const books = [book(100), book(250), book(600)];
  const days = books.map((rows, i) => ({
    date: `2026-07-0${4 + i}`, display: `${4 + i} July 2026`, payload: pay(rows, `${4 + i} July 2026`, CYC),
  }));
  // Same book three times: the union and the latest book are the same 1,000 accounts.
  const campaign = pay(union(books), 'campaign', CYC);
  const s = buildSummary({ campaign, days });
  const t = s.campaign.agg.totals;

  const naive = s.trend.reduce((a, d) => a + d.recovered, 0);

  ok('re-reading one book never multiplies the accounts', t.accounts === 1000,
    `got ${t.accounts}, expected 1,000 (a sum across the 3 dates would give 3,000)`);
  ok('re-reading one book never multiplies the money', t.recovered === 600 * 100000,
    `got ₹${(t.recovered / 1e7).toFixed(2)} Cr, expected ₹6.00 Cr (the naive sum gives ₹${(naive / 1e7).toFixed(2)} Cr)`);
  ok('recovered can never exceed the book', t.recovered <= t.sumOut,
    `recovered ${t.recovered} > outstanding ${t.sumOut}`);
  ok('resolved can never exceed the accounts', t.resolved <= t.accounts,
    `resolved ${t.resolved} > accounts ${t.accounts}`);
  ok('the naive sum WOULD have been wrong (so this test is worth something)', naive > t.recovered,
    'the sum and the union agree, so this book does not actually exercise the bug');
  ok('movement is measured first→last', s.movement && s.movement.resolved === 500,
    `movement.resolved = ${s.movement?.resolved}, expected 500 (600 − 100)`);
  ok('the trend keeps one row per date, oldest first',
    s.trend.length === 3 && s.trend[0].date < s.trend[2].date,
    `trend = ${JSON.stringify(s.trend.map((d) => d.date))}`);
}

/* ── 2. A genuinely NEW cycle. Its accounts must NOT be added to the headline.
       Outstanding is a STOCK — the debt on the book right now. Adding last cycle's
       outstanding to this cycle's makes the total grow every time RBL sends a new
       book, which is the number an exec would call wrong on sight. The previous cycle
       is reported as CARRY-OVER, beside the headline, never inside it. ── */
{
  const july = Array.from({ length: 500 }, (_, i) => row('J' + i, i < 100));      // ₹5 Cr book
  const august = Array.from({ length: 400 }, (_, i) => row('G' + i, i < 50));     // ₹4 Cr book
  const days = [
    { date: '2026-07-04', display: '4 July 2026', payload: pay(july, '4 July 2026', CYC) },
    { date: '2026-08-04', display: '4 August 2026', payload: pay(august, '4 August 2026', OTHER) },
  ];

  // Exactly what backend.mjs now does: the headline is the LATEST book.
  const campaign = pay(august, '4 August 2026', OTHER);
  const carry = {
    accounts: july.length,
    outstanding: july.reduce((a, r) => a + r.total_outstanding, 0),
    recovered: july.filter((r) => r.status === 'Resolved').reduce((a, r) => a + r.total_outstanding, 0),
    dates: [{ date: '2026-07-04', display: '4 July 2026', accounts: july.length }],
  };
  const s = buildSummary({ campaign, days, carry });
  const t = s.campaign.agg.totals;

  ok('a new cycle does NOT inflate the headline account count', t.accounts === 400,
    `got ${t.accounts}, expected 400 (the current book). A union would have said 900.`);
  ok('a new cycle does NOT inflate total outstanding', t.sumOut === 400 * 100000,
    `got ₹${(t.sumOut / 1e7).toFixed(2)} Cr, expected ₹4.00 Cr. A union would have said ₹9.00 Cr.`);
  ok('the headline never exceeds the latest book', t.sumOut <= 400 * 100000,
    'outstanding grew beyond the current book — a stock was summed across time');
  ok('the previous cycle is REPORTED, not discarded', s.carry?.accounts === 500,
    `carry = ${JSON.stringify(s.carry)}`);
  ok('the previous cycle keeps its own outstanding', s.carry?.outstanding === 500 * 100000,
    `carry.outstanding = ${s.carry?.outstanding}`);
  ok('no movement is claimed across two different books', s.movement === null,
    'movement was reported between two different CYC files — that is not progress, it is a different book');
  ok('the trend marks the new book rather than inventing a delta',
    s.trend[1].sameBook === false && !s.trend[1].recoveredDelta,
    `trend[1] = ${JSON.stringify(s.trend[1])}`);
}

/* ── 2b. The SAME book re-read must produce NO carry-over at all. If it did, we would
       be double-reporting the very accounts the union exists to deduplicate. ── */
{
  const book = (n) => Array.from({ length: 1000 }, (_, i) => row('A' + i, i < n));
  const days = [4, 5, 8].map((d, i) => ({
    date: `2026-07-0${d}`, display: `${d} July 2026`,
    payload: pay(book([100, 250, 600][i]), `${d} July 2026`, CYC),
  }));
  const s = buildSummary({ campaign: pay(book(600), '8 July 2026', CYC), days, carry: null });
  ok('re-reading the same book produces no carry-over', s.carry === null, `carry = ${JSON.stringify(s.carry)}`);
  ok('re-reading the same book leaves outstanding unchanged',
    s.campaign.agg.totals.sumOut === 1000 * 100000,
    `got ₹${(s.campaign.agg.totals.sumOut / 1e7).toFixed(2)} Cr, expected ₹10.00 Cr`);
}

/* ── 3. Degenerate books. None of these should throw, and none should lie. ── */
{
  ok('an empty campaign does not crash', (() => {
    try { buildSummary({ campaign: pay([], 'x', CYC), days: [] }); return true; } catch { return false; }
  })(), 'buildSummary threw on an empty book');

  const none = Array.from({ length: 200 }, (_, i) => row('A' + i, false));
  const s = buildSummary({ campaign: pay(none, 'x', CYC), days: [{ date: '2026-07-04', display: 'x', payload: pay(none, 'x', CYC) }] });
  ok('a book where nobody resolved reports ₹0, not NaN',
    s.campaign.agg.totals.recovered === 0 && Number.isFinite(s.campaign.agg.totals.resolutionRatePct),
    `recovered=${s.campaign.agg.totals.recovered} rate=${s.campaign.agg.totals.resolutionRatePct}`);
  ok('a single report date claims no movement', s.movement === null,
    'movement was reported from one date — there is nothing to compare it to');

  const all = Array.from({ length: 200 }, (_, i) => row('A' + i, true));
  const s2 = buildSummary({ campaign: pay(all, 'x', CYC), days: [{ date: '2026-07-04', display: 'x', payload: pay(all, 'x', CYC) }] });
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
