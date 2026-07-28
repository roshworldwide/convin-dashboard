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
  /* The duration chart must account for every account it is ENTITLED to count.
     Normally that is the whole book. When the status file predated the calls, the
     unmeasured accounts are deliberately excluded (see _outcomeWindow) — so the
     denominator becomes the measurable book, and it must still be exact. A chart
     that quietly drops accounts is the bug this invariant exists to catch; a chart
     that loudly excludes them is the fix. */
  ['call-duration chart accounts for every MEASURABLE account', (p) => {
    const ow = p.agg.outcomeWindow;
    const want = ow?.blindAccounts ? ow.measurableAccounts : p.agg.totals.accounts;
    const sum = p.agg.duration.reduce((a, d) => a + d.n, 0);
    return sum === want ? null : `duration buckets hold ${sum} of ${want}`;
  }],
  /* Keyed on the stage NUMBER, never the display label.
     This check used to look up f['AI Attempted'] while the stage was actually called
     'AI Calls Attempted' — so both sides were undefined, `undefined > undefined` is
     false, and the invariant passed every run without testing anything at all. It sat
     there green for the entire life of the project. A label is a thing a client asks
     you to change on a Friday; it must never be load-bearing. */
  ['funnel never widens (connected <= attempted <= total)', (p) => {
    if (!p.agg.funnel.length) return null;
    const f = Object.fromEntries(p.agg.funnel.map((x) => [x.n, x]));
    const total = f[1], attempted = f[2], connected = f[3];
    if (!total || !attempted || !connected) return 'funnel is missing one of stages 1-3';
    if (attempted.value > total.value) return `attempted ${attempted.value} > total ${total.value}`;
    if (connected.value > attempted.value) return `connected ${connected.value} > attempted ${attempted.value}`;
    return null;
  }],
  ['the journey stages are the ones we think they are', (p) => {
    if (!p.agg.funnel.length) return null;
    const j = p.agg.funnel.filter((x) => x.kind === 'journey').map((x) => x.n);
    return JSON.stringify(j) === '[1,2,3]' ? null
      : `journey stages are ${JSON.stringify(j)}, expected [1,2,3] — a stage changed kind and the widening check now guards the wrong bars`;
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

  /* ── The outcome window ──────────────────────────────────────────────────────
     A status file pulled before the calls finished. The condition that put
     "13+ attempts → 0% resolved" in front of a bank. See _outcomeWindow(). */
  ['states covered never counts the Unspecified bucket', (p) => {
    const named = p.agg.state.filter((s) => s.state !== 'Unspecified').length;
    return p.agg.totals.statesCovered === named ? null
      : `statesCovered ${p.agg.totals.statesCovered} != ${named} named states`;
  }],
  ['a blind window never swallows the whole book', (p) => {
    const ow = p.agg.outcomeWindow;
    if (!ow?.blindAccounts) return null;
    return ow.blindAccounts < p.agg.totals.accounts ? null
      : `every account (${ow.blindAccounts}) declared unmeasured — the status file is broken, not the cohort`;
  }],
  ['blind accounts + measurable accounts = the book', (p) => {
    const ow = p.agg.outcomeWindow;
    if (!ow?.hasCallDates || !ow.blindAccounts) return null;
    const sum = ow.blindAccounts + ow.measurableAccounts;
    return sum === p.agg.totals.accounts ? null : `${sum} != ${p.agg.totals.accounts} accounts`;
  }],
  ['a blind day really did resolve nobody', (p) => {
    const ow = p.agg.outcomeWindow;
    if (!ow?.blind?.length) return null;
    const bad = ow.cohorts.filter((c) => ow.blind.includes(c.date) && c.res > 0);
    return bad.length ? `${bad[0].date} was called blind but resolved ${bad[0].res}` : null;
  }],
  ['blind days are the LAST days, never a hole in the middle', (p) => {
    const ow = p.agg.outcomeWindow;
    if (!ow?.blind?.length) return null;
    const dates = ow.cohorts.map((c) => c.date);
    const tail = dates.slice(dates.length - ow.blind.length);
    return JSON.stringify(tail) === JSON.stringify(ow.blind) ? null
      : `blind ${JSON.stringify(ow.blind)} is not the trailing run of ${JSON.stringify(dates)}`;
  }],
  ['call-behaviour charts never count an unmeasured account', (p) => {
    const ow = p.agg.outcomeWindow;
    if (!ow?.blindAccounts) return null;
    const dialN = p.intel.dial.reduce((a, d) => a + d.n, 0);
    const durN = p.agg.duration.reduce((a, d) => a + d.n, 0);
    if (dialN > ow.measurableAccounts) return `dial charts ${dialN} accounts but only ${ow.measurableAccounts} are measurable`;
    if (durN !== ow.measurableAccounts) return `duration charts ${durN} accounts, expected ${ow.measurableAccounts}`;
    return null;
  }],
  ['no chart prints a resolution rate for a cohort too thin to have one', (p) => {
    const thin = [...p.intel.dial, ...p.agg.duration].filter((d) => d.n > 0 && d.n < 30 && !d.thin);
    return thin.length ? `${thin[0].band || thin[0].bucket} has n=${thin[0].n} but is not flagged thin` : null;
  }],
  /* ── THE AI CALL LOG (payload v9) ────────────────────────────────────────────
     Every check below no-ops when the section is absent — a book uploaded without a
     call log, or any report filed before v9, must aggregate exactly as it always did. */
  ['the call-log section is absent, not empty, when there is no call log', (p) => {
    const c = p.agg.callLog;
    if (!c) return 'agg.callLog is missing entirely — the UI guards on it and would crash';
    if (c.present) return null;
    return (c.byHour?.length || c.byAttempt?.length || c.lines?.length)
      ? 'callLog says present:false but is carrying rows' : null;
  }],
  ['a connect rate is never above 100% (per hour, per attempt, per line)', (p) => {
    const c = p.agg.callLog;
    if (!c?.present) return null;
    const over = [
      ...c.byHour.filter((h) => h.connected > h.attempts).map((h) => `hour ${h.hour}: ${h.connected}/${h.attempts}`),
      ...c.byAttempt.filter((a) => a.connected > a.dialled).map((a) => `attempt ${a.attempt}: ${a.connected}/${a.dialled}`),
      ...c.lines.filter((l) => l.connected > l.attempts).map((l) => `line ${l.line}: ${l.connected}/${l.attempts}`),
    ];
    return over.length ? over.slice(0, 3).join('; ') : null;
  }],
  ['connected calls never exceed dial attempts', (p) => {
    const c = p.agg.callLog;
    if (!c?.present) return null;
    if (c.loggedConnected > c.loggedAttempts) return `${c.loggedConnected} answered of ${c.loggedAttempts} dialled`;
    if (c.rates.attemptNumerator > c.rates.attemptDenominator) return 'attempt % numerator exceeds its denominator';
    if (c.rates.voicemailCalls > c.loggedConnected) return `${c.rates.voicemailCalls} voicemails of ${c.loggedConnected} answered calls`;
    return null;
  }],
  ['the hour and attempt curves never claim more dials than were logged', (p) => {
    const c = p.agg.callLog;
    if (!c?.present) return null;
    const hourN = c.byHour.reduce((a, h) => a + h.attempts, 0);
    const attN = c.byAttempt.reduce((a, x) => a + x.dialled, 0);
    const lineN = c.lines.reduce((a, l) => a + l.attempts, 0);
    if (hourN > c.loggedAttempts) return `hour chart holds ${hourN} dials, only ${c.loggedAttempts} were logged`;
    if (attN > c.loggedAttempts) return `attempt chart holds ${attN} dials, only ${c.loggedAttempts} were logged`;
    if (lineN > c.loggedAttempts) return `line table holds ${lineN} dials, only ${c.loggedAttempts} were logged`;
    return null;
  }],
  ['the attempt-conversion curve accounts for every first payment, exactly once', (p) => {
    const c = p.agg.callLog;
    if (!c?.present) return null;
    const sum = c.byAttempt.reduce((a, x) => a + x.firstPaid, 0);
    if (sum !== c.firstPaidAccounts) return `curve holds ${sum} first payments, ${c.firstPaidAccounts} accounts have one`;
    const last = c.byAttempt[c.byAttempt.length - 1];
    if (c.firstPaidAccounts > 0 && Math.abs(last.cumFirstPaidPct - 100) > 0.001) {
      return `the cumulative share ends at ${last.cumFirstPaidPct.toFixed(2)}%, not 100%`;
    }
    for (let i = 1; i < c.byAttempt.length; i++) {
      if (c.byAttempt[i].cumFirstPaidPct < c.byAttempt[i - 1].cumFirstPaidPct - 1e-9) {
        return `the cumulative curve goes DOWN at attempt ${c.byAttempt[i].attempt}`;
      }
    }
    return null;
  }],
  ['a resolved count on the curve can never exceed the book\'s resolved count', (p) => {
    const c = p.agg.callLog;
    if (!c?.present) return null;
    const res = c.byAttempt.reduce((a, x) => a + x.firstPaidResolved, 0);
    if (res > p.agg.totals.resolved) return `${res} resolved on the curve, but only ${p.agg.totals.resolved} in the book`;
    const bad = c.byAttempt.find((x) => x.firstPaidResolved > x.firstPaid);
    return bad ? `attempt ${bad.attempt}: ${bad.firstPaidResolved} resolved of ${bad.firstPaid} that paid` : null;
  }],
  ['compliance counts can never exceed the book', (p) => {
    const c = p.agg.callLog;
    if (!c?.present) return null;
    const N = p.agg.totals.accounts;
    const over = [
      ['complaints', c.complaints.accounts], ['DNC', c.dnc.accounts],
      ['refused', c.dnc.refusedAccounts], ['promises', c.ptp.accounts],
      ['accounts with a payment disposition', c.paidAccounts],
    ].filter(([, v]) => v > N);
    if (over.length) return `${over[0][0]} = ${over[0][1]} on a book of ${N}`;
    if (c.dnc.redialledAccounts > c.dnc.accounts) return `${c.dnc.redialledAccounts} re-dialled of ${c.dnc.accounts} DNC accounts`;
    if (c.complaints.alsoDnc > c.complaints.accounts) return 'more complaint+DNC accounts than complaint accounts';
    if (c.ptp.resolved > c.ptp.accounts) return 'more promises kept than made';
    return null;
  }],
  ['reached accounts never exceed the book, and human-reached never exceed reached', (p) => {
    const c = p.agg.callLog;
    if (!c?.present) return null;
    const r = c.rates;
    if (r.contactNumerator > r.contactDenominator) return `${r.contactNumerator} reached of ${r.contactDenominator} in the book`;
    if (r.humanReached > r.contactNumerator) return `${r.humanReached} reached by a human, but only ${r.contactNumerator} reached at all`;
    return null;
  }],
  ['the intensity distributions account for every account in the book', (p) => {
    const c = p.agg.callLog;
    if (!c?.present) return null;
    const N = p.agg.totals.accounts;
    const a = c.intensity.distribution.reduce((s, d) => s + d.accounts, 0);
    const b = c.intensity.contactDistribution.reduce((s, d) => s + d.accounts, 0);
    if (a !== N) return `attempt bands hold ${a} accounts, the book has ${N}`;
    if (b !== N) return `contact bands hold ${b} accounts, the book has ${N}`;
    return null;
  }],
  ['the AI-cohort split accounts for every account and every rupee', (p) => {
    const c = p.agg.cohorts;
    if (!c) return 'agg.cohorts is missing — the UI guards on it';
    if (!c.length) return p.agg.totals.accounts === 0 ? null : 'no cohorts on a non-empty book';
    const n = c.reduce((a, x) => a + x.count, 0);
    const rec = c.reduce((a, x) => a + x.recovered, 0);
    if (n !== p.agg.totals.accounts) return `cohorts hold ${n} accounts, the book has ${p.agg.totals.accounts}`;
    return near(rec, p.agg.totals.recovered, 1) ? null
      : `cohorts recovered ${rec.toFixed(0)}, the book recovered ${p.agg.totals.recovered.toFixed(0)}`;
  }],
  /* ── ANONYMISATION ────────────────────────────────────────────────────────────
     The deliverable must not carry a customer name or a phone number ANYWHERE — it
     is printed to PDF and handed out through share links that have no login on them.
     These two checks are the whole guarantee, so they are checked on every book. */
  ['the Top-20 carries a masked reference, never a customer name', (p) => {
    for (const r of p.agg.topOutstanding) {
      if ('name' in r) return 'topOutstanding still has a `name` field — that is the customer';
      if (!r.ref) return 'topOutstanding row has no masked reference';
      if (/\d{7,}/.test(String(r.ref))) return `the "mask" ${r.ref} still holds ${String(r.ref).replace(/\D/g, '').length} digits`;
    }
    return null;
  }],
  ['no phone number or full account number survives anywhere in the payload', (p) => {
    const blob = JSON.stringify(p);
    const mobile = blob.match(/(?<![\d.])[6-9]\d{9}(?![\d.])/g) || [];
    const account = blob.match(/(?<![\d.])\d{15,19}(?![\d.])/g) || [];
    if (mobile.length) return `${mobile.length} mobile-shaped number(s), e.g. ${mobile[0]}`;
    if (account.length) return `${account.length} account-shaped number(s), e.g. ${account[0]}`;
    return null;
  }],

  ['headline resolution is the FULL book, never the measurable subset', (p) => {
    // The blind guard must never quietly restate RBL's own numbers. It trims the
    // behavioural charts and nothing else.
    const ow = p.agg.outcomeWindow;
    if (!ow?.blindAccounts) return null;
    const t = p.agg.totals;
    return near(t.resolutionRatePct, t.accounts ? t.resolved / t.accounts * 100 : 0, 0.001)
      ? null : 'headline resolution rate was computed on a subset of the book';
  }],
];

/* ── The adversarial books. Each is something a bank could really send. ─────── */
const N = (n, f) => Array.from({ length: n }, (_, i) => f(i));

/* ── Rows carrying rolled-up AI CALL LOG data ─────────────────────────────────
   Built the way calllog.mjs builds them, so the mask, the histograms and the three
   legacy call counters can never disagree — which is exactly what the invariants above
   are checking. `connectEvery: 0` means nobody ever picked up. */
const calls = (o = {}) => {
  const {
    attempts = 6, connectEvery = 3, hours = ['10', '14'], lines = ['1111', '2222'],
    firstPaid = 0, dncAt = 0, secs = 60, voicemail = 0, gapAt = 0, ...rest
  } = o;

  let mask = '';
  const hourHist = new Map();
  const lineHist = new Map();
  let placed = 0;
  let connected = 0;
  for (let n = 1; n <= attempts; n++) {
    if (n === gapAt) { mask += '-'; continue; }          // an attempt number that does not exist
    const on = connectEvery > 0 && n % connectEvery === 0;
    mask += on ? '1' : '0';
    placed++; if (on) connected++;
    const h = hours[(n - 1) % hours.length];
    const l = lines[(n - 1) % lines.length];
    for (const [m, k] of [[hourHist, h], [lineHist, l]]) {
      const e = m.get(k) || { attempts: 0, connected: 0 };
      e.attempts++; if (on) e.connected++;
      m.set(k, e);
    }
  }
  const enc = (m) => [...m.entries()].sort().map(([k, v]) => `${k}:${v.attempts}:${v.connected}`).join('|');
  const dialsAfterDnc = dncAt > 0
    ? mask.split('').filter((c, i) => i + 1 > dncAt && c !== '-').length : 0;

  return row({
    ai_attempts: placed,
    ai_connected_calls: connected,
    ai_connected_seconds: connected * secs,
    attempt_mask: mask,
    max_attempt: attempts,
    attempts_by_hour: enc(hourHist),
    outbound_lines: enc(lineHist),
    attempt_first_paid: firstPaid,
    dnc_attempt: dncAt,
    dials_after_dnc: dialsAfterDnc,
    voicemail_calls: Math.min(voicemail, connected),
    voicemail_seconds: Math.min(voicemail, connected) * 12,
    dnc_flag: dncAt > 0,
    ai_agency: 'Convin_NEW',
    ...rest,
  });
};

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
  /* ── Books that exercise the outcome window ─────────────────────────────────
     The real one: a status file pulled on the 6th, calls that ran to the 7th. The
     last day resolves nobody — not because they refused, but because the file was
     already written. This is the 3 July book in miniature. */
  'status file pulled BEFORE the calls finished': N(600, (i) => {
    const lastDay = i >= 500;                       // 100 accounts dialled past the pull
    return row({
      last_call_at: lastDay ? '2026-07-07' : (i % 2 ? '2026-07-05' : '2026-07-06'),
      // Dialled hardest precisely because they never resolved — the whole trap.
      ai_attempts: lastDay ? 15 : 3,
      status: lastDay ? 'Unresolved' : (i % 3 ? 'Unresolved' : 'Resolved'),
    });
  }),
  // A correctly-paired file must NOT trigger the guard. False positives here would
  // hack the behavioural charts down for no reason, every single day.
  'status file pulled AFTER the calls — no blind window': N(600, (i) => row({
    last_call_at: i >= 500 ? '2026-07-07' : (i % 2 ? '2026-07-05' : '2026-07-06'),
    ai_attempts: i >= 500 ? 15 : 3,
    status: i % 3 ? 'Unresolved' : 'Resolved',      // the last day resolves normally
  })),
  // A genuinely bad last day, but too small to distinguish from luck. Say nothing.
  'a tiny zero-resolution final day (below the blind threshold)': N(300, (i) => row({
    last_call_at: i >= 290 ? '2026-07-07' : '2026-07-05',
    status: i >= 290 ? 'Unresolved' : (i % 3 ? 'Unresolved' : 'Resolved'),
  })),
  // Nothing resolved anywhere. That is a broken status file, not a blind cohort —
  // and declaring the entire book unmeasured would erase it.
  'nothing resolved on any day (broken status file)': N(300, (i) => row({
    last_call_at: i % 2 ? '2026-07-05' : '2026-07-06', status: 'Unresolved',
  })),
  // The lead export has no timestamp column at all. The guard must simply not fire.
  'no call dates in the export at all': N(300, (i) => row({
    last_call_at: '', status: i % 3 ? 'Unresolved' : 'Resolved',
  })),

  /* ── Books carrying the AI call log ──────────────────────────────────────── */
  'a realistic call-log book': N(500, (i) => calls({
    attempts: 1 + (i % 18),
    connectEvery: i % 7 === 0 ? 0 : 2 + (i % 3),
    hours: ['08', '11', '14', '17'].slice(0, 1 + (i % 4)),
    firstPaid: i % 3 === 0 ? 1 + (i % 9) : 0,
    dncAt: i % 23 === 0 ? 2 : 0,
    voicemail: i % 4 === 0 ? 1 : 0,
    status: i % 3 ? 'Unresolved' : 'Resolved',
    disp_l2: i % 3 === 0 ? 'Paid' : i % 5 === 0 ? 'Promise to Pay Later' : 'Follow-Up',
    ptp_flag: i % 5 === 0,
    complaint_flag: i % 11 === 0,
    refused_flag: i % 13 === 0,
    last_call_at: '2026-07-16',
  })),
  /* The call log covers only part of the book. The accounts it does not cover were
     never dialled, and the section must count them as such rather than shrink to fit. */
  'a call log that covers only half the book': N(400, (i) => (i % 2
    ? calls({ attempts: 5, connectEvery: 2, firstPaid: i % 6 === 0 ? 3 : 0, status: i % 3 ? 'Unresolved' : 'Resolved', last_call_at: '2026-07-16' })
    : row({ status: i % 3 ? 'Unresolved' : 'Resolved', ai_attempts: 0, ai_connected_calls: 0, ai_connected_seconds: 0 }))),
  /* A Day Total that unions a day filed with the OLD per-account lead export against a
     day filed with the new per-attempt call log. The curves can only be drawn over the
     half that has attempts, and they must say so instead of dividing by the whole book. */
  'a mixed book — half from the old lead export, half from the call log': N(400, (i) => (i % 2
    ? calls({ attempts: 6, connectEvery: 3, status: i % 3 ? 'Unresolved' : 'Resolved' })
    : row({ ai_attempts: 9, ai_connected_calls: 2, ai_connected_seconds: 140, status: i % 3 ? 'Unresolved' : 'Resolved' }))),
  'every DNC account was dialled again afterwards': N(200, (i) => calls({
    attempts: 12, connectEvery: 4, dncAt: 3, status: i % 3 ? 'Unresolved' : 'Resolved', complaint_flag: true,
  })),
  'an account whose attempt numbers have a hole in them': N(200, (i) => calls({
    attempts: 9, connectEvery: 3, gapAt: 5, status: i % 3 ? 'Unresolved' : 'Resolved',
  })),
  'nobody answered a single call in the whole log': N(200, (i) => calls({
    attempts: 14, connectEvery: 0, status: i % 4 ? 'Unresolved' : 'Resolved',
  })),
  'every answered call was voicemail': N(200, (i) => calls({
    attempts: 8, connectEvery: 2, voicemail: 4, status: i % 4 ? 'Unresolved' : 'Resolved',
  })),
  'one account, one dial, one payment': [calls({ attempts: 1, connectEvery: 1, firstPaid: 1, status: 'Resolved' })],
  'two AI cohorts in one book': N(300, (i) => calls({
    attempts: 4 + (i % 5), connectEvery: 2,
    ai_agency: i % 2 ? 'Convin_NEW' : 'Convin_AI_ONLY',
    status: i % 3 ? 'Unresolved' : 'Resolved',
  })),

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
