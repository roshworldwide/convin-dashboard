/* ─────────────────────────────────────────────────────────────────────────────
 * THE AI CALL LOG — adversarial tests for the roll-up itself.
 *
 * stress_test.mjs asserts invariants over the PAYLOAD. This one attacks the layer
 * underneath it: turning 18,883 rows of call attempts into 1,417 accounts without
 * losing a dial, inventing one, or letting a customer's name out of the file.
 *
 * The failure modes it exists to catch, in order of how badly they would hurt:
 *
 *   1. PII escaping.        The file carries names, mobiles and lead links. If any of
 *                           them reaches a canonical row they reach the database, the
 *                           printed PDF and a share link with no login on it.
 *   2. A silent zero join.  Wrong export, or two systems numbering accounts differently.
 *                           Every call chart reads zero and the page looks perfect.
 *   3. Inferred attempts.   Attempt Number is explicit in this file. Re-deriving it from
 *                           row order is a fabrication — the file is not sorted by
 *                           account — and it would look completely plausible.
 *   4. Doubling on re-upload. The whole product rests on "upload the same book twice and
 *                           nothing moves". That has to hold for the new curves too.
 *
 *   node evals/stress_calllog.mjs
 * ───────────────────────────────────────────────────────────────────────────── */

import { parseCsv } from '../src/lib/csv.mjs';
import { rollUpCallLog, applyCallLog, callFields, emptyCallFields, encodeHist, decodeHist } from '../src/lib/calllog.mjs';
import { detectSheetKind } from '../src/lib/sheet.mjs';
import { unionByAccount } from '../src/lib/dayunion.mjs';
import { Aggregator } from '../src/lib/aggregate.mjs';
import { normalizeMap } from '../src/lib/normalize.mjs';

let checks = 0; let fails = 0;
const ok = (label, cond, detail = '') => {
  checks++;
  if (cond) { console.log(`  ✔ ${label}`); return true; }
  fails++; console.log(`  ✘ ${label}${detail ? `\n      -> ${detail}` : ''}`); return false;
};
const eq = (label, got, want) => ok(label, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);

/* ── A call log, built exactly like the real one ─────────────────────────────── */
const HEADER = ['To Phone Num', 'Call Attempt ID', 'Call Direction', 'From Phone Num', 'Campaign Name',
  'Campaign ID', 'Campaign Start Date', 'External ID', 'Lead ID', 'Lead Name', 'Lead Link',
  'Lead Creation Timestamp', 'Call Status', 'Telephony Disposition', 'Sense Disposition L1',
  'Sense Disposition L2', 'Sense Disposition L3', 'Sense Disposition Reason', 'Call Timestamp',
  'Call Answered Timestamp', 'Call End Timestamp', 'Call Duration (Seconds)', 'Call Pulse Unit',
  'Call Pulse Count', 'Attempt Number', 'Disconnect Reason Key', 'Call Disconnected By',
  'DND Identifier', 'Tool Executions', 'Tool Execution Success', 'Tool Execution Failures'];

/* Deliberately real-looking PII, so a leak is unmistakable when it happens. */
const NAME = 'Gaurav Mishra';
const CUST_MOBILE = '+919407020825';
const LEAD_LINK = 'https://activate.convin.ai/tenant/rblbank/campaigns/abc/leads/def';

const attempt = (o = {}) => {
  const {
    account = '0007477770006276734_16072026', n = 1, at = '2026-07-16 10:37:27',
    answered = '', secs = '', status = 'no_answer', l1 = '', l2 = '',
    line = '+918064061392', reason = '',
  } = o;
  const r = new Array(HEADER.length).fill('');
  const set = (h, v) => { r[HEADER.indexOf(h)] = v; };
  set('To Phone Num', CUST_MOBILE);
  set('From Phone Num', line);
  set('External ID', account);
  set('Lead Name', NAME);
  set('Lead Link', LEAD_LINK);
  set('Call Status', status);
  set('Sense Disposition L1', l1);
  set('Sense Disposition L2', l2);
  set('Sense Disposition Reason', reason);
  set('Call Timestamp', at);
  set('Call Answered Timestamp', answered);
  set('Call Duration (Seconds)', String(secs));
  set('Attempt Number', String(n));
  set('Call Direction', 'Outbound');
  return r;
};
const sheet = (rows) => [HEADER, ...rows];
const A1 = '0007477770006276734_16072026';
const A2 = '0007474600001364594_16072026';

/* A canonical row for the book side of the join. */
const book = (acct, o = {}) => normalizeMap({
  'Account No': acct, status: o.status || 'Unresolved', total_outstanding: o.out ?? 50000,
  'Curr Bal Band': '30-50K', Region: 'South', 'Primary State': 'Karnataka',
  'Customer Name': 'BOOK CUSTOMER', 'Mobile Number -1': '9812345678', 'AI Agency': o.agency || 'Convin_NEW',
}, null);

console.log('\n══ DETECTION ══\n');
eq('the call log is detected by its own columns', detectSheetKind(HEADER), 'calllog');
ok('a CYC book is NOT mistaken for a call log',
  detectSheetKind(['Account No', 'Bill Cycle', 'Curr Bal Band', 'Segment']) === 'cyc');
ok('a status file is NOT mistaken for a call log',
  detectSheetKind(['account_no', 'status']) === 'status');
ok('the OLD lead export still detects as leads (it is not gone, just superseded)',
  detectSheetKind(['account_number', 'Total AI Call Attempts', 'External ID']) === 'leads');

console.log('\n══ PII NEVER LEAVES THE FILE ══\n');
{
  const log = rollUpCallLog(sheet([
    attempt({ n: 1 }), attempt({ n: 2, answered: '2026-07-16 12:53:39', secs: 58, status: 'completed', l1: 'Paid', l2: 'Paid' }),
  ]));
  const fields = callFields([...log.byAccount.values()][0]);
  const blob = JSON.stringify([...log.byAccount.values()]) + JSON.stringify(fields);
  ok('the customer name is nowhere in the roll-up', !blob.includes(NAME), blob.slice(0, 200));
  ok('the customer mobile is nowhere in the roll-up', !blob.includes('9407020825'));
  ok('the lead link is nowhere in the roll-up', !blob.includes('activate.convin.ai'));
  ok('no 10-digit mobile-shaped number survives at all', !/(?<![\d.])[6-9]\d{9}(?![\d.])/.test(blob), blob.slice(0, 200));
  ok('the OUTBOUND line survives only as its last four digits', fields.outbound_lines === '1392:2:1', fields.outbound_lines);
  ok('  …and that is not a phone number by any definition', !/\d{7,}/.test(fields.outbound_lines.split('|')[0].split(':')[0]));
}

console.log('\n══ THE CONNECT DEFINITION ══\n');
{
  const log = rollUpCallLog(sheet([
    attempt({ n: 1, status: 'no_answer' }),
    attempt({ n: 2, status: 'completed', answered: '2026-07-16 11:00:00', secs: 90 }),
    attempt({ n: 3, status: 'voicemail', answered: '2026-07-16 12:00:00', secs: 12 }),
    attempt({ n: 4, status: 'completed', secs: 40 }),          // "completed" but NEVER answered
  ]));
  const f = callFields(log.byAccount.get('0007477770006276734'));
  eq('an Answered Timestamp is the ONLY thing that makes a connect', f.ai_connected_calls, 2);
  eq('  a "completed" call with no answer is not one', f.ai_attempts, 4);
  eq('voicemail counts as a connect — the file says so', f.voicemail_calls, 1);
  eq('  …and is reported separately so it is never read as a conversation', f.voicemail_seconds, 12);
  eq('talk time comes only from answered calls', f.ai_connected_seconds, 102);
  eq('the mask records answer-or-not per attempt', f.attempt_mask, '0110');
}

console.log('\n══ ATTEMPT NUMBER IS READ, NEVER INFERRED ══\n');
{
  /* The real file is not sorted by account: two accounts interleave, and one of them
     appears in DESCENDING attempt order. Anything derived from row position is wrong. */
  const log = rollUpCallLog(sheet([
    attempt({ account: A2, n: 3, answered: '2026-07-16 09:00:00', secs: 10 }),
    attempt({ account: A1, n: 1 }),
    attempt({ account: A2, n: 1 }),
    attempt({ account: A1, n: 3, answered: '2026-07-16 10:00:00', secs: 10 }),
    attempt({ account: A2, n: 2 }),
    attempt({ account: A1, n: 2 }),
  ]));
  const f1 = callFields(log.byAccount.get('0007477770006276734'));
  const f2 = callFields(log.byAccount.get('0007474600001364594'));
  eq('interleaved accounts are separated correctly', log.byAccount.size, 2);
  eq('the mask follows Attempt Number, not row order (A1)', f1.attempt_mask, '001');
  eq('the mask follows Attempt Number, not row order (A2)', f2.attempt_mask, '001');
  eq('max attempt is the column value', f1.max_attempt, 3);
}
{
  // A missing attempt number: counted as a dial, kept OFF the curve, and reported.
  const log = rollUpCallLog(sheet([
    attempt({ n: 1 }), attempt({ n: 0 }), attempt({ n: 2 }),
  ]));
  const f = callFields(log.byAccount.get('0007477770006276734'));
  eq('a dial with no attempt number still counts as a dial', f.ai_attempts, 3);
  eq('  …but is left off the attempt curve rather than guessed at', f.attempt_mask, '00');
  eq('  …and is counted so the gap has a name', log.stats.unnumbered, 1);
}
{
  // A hole in the numbering. Real: one of the 1,417 accounts has one.
  const log = rollUpCallLog(sheet([attempt({ n: 1 }), attempt({ n: 2 }), attempt({ n: 4 })]));
  const f = callFields(log.byAccount.get('0007477770006276734'));
  eq('an attempt that does not exist is marked absent, not fabricated', f.attempt_mask, '00-0');
  eq('  the mask still spans to the highest real attempt', f.max_attempt, 4);
}

console.log('\n══ THE ACCOUNT\'S DISPOSITION — STRONGEST, NOT LAST ══\n');
{
  const log = rollUpCallLog(sheet([
    attempt({ n: 1, answered: '2026-07-16 09:00:00', secs: 40, status: 'completed', l1: 'Schedule Callback', l2: 'Follow-Up' }),
    attempt({ n: 2, answered: '2026-07-16 10:00:00', secs: 60, status: 'completed', l1: 'Paid', l2: 'Paid' }),
    attempt({ n: 3, answered: '2026-07-16 11:00:00', secs: 20, status: 'completed', l1: 'Schedule Callback', l2: 'Follow-Up' }),
  ]));
  const f = callFields(log.byAccount.get('0007477770006276734'));
  eq('a payment is not buried by a later routine call', [f.disp_l1, f.disp_l2], ['Paid', 'Paid']);
  eq('  the attempt the payment landed on is recorded', f.attempt_first_paid, 2);
  eq('  and the derived entity flag agrees', f.paid_flag, 'YES');
}
{
  const log = rollUpCallLog(sheet([
    attempt({ n: 1, answered: '2026-07-16 09:00:00', secs: 40, status: 'completed', l1: 'Paid', l2: 'Paid' }),
    attempt({ n: 2, answered: '2026-07-16 10:00:00', secs: 60, status: 'completed', l1: 'Paid', l2: 'On Call Payment Done' }),
  ]));
  const f = callFields(log.byAccount.get('0007477770006276734'));
  eq('the FIRST payment attempt wins, not the strongest wording', f.attempt_first_paid, 1);
  eq('  "On Call Payment Done" outranks a claimed earlier payment for the label', f.disp_l2, 'On Call Payment Done');
}
{
  const log = rollUpCallLog(sheet([
    attempt({ n: 1, answered: '2026-07-16 09:00:00', secs: 40, status: 'completed', l1: 'DNC', l2: 'Potential Complaint' }),
    attempt({ n: 2, answered: '2026-07-16 10:00:00', secs: 60, status: 'completed', l1: 'Paid', l2: 'Paid' }),
  ]));
  const f = callFields(log.byAccount.get('0007477770006276734'));
  eq('an account that complained AND paid is labelled Paid…', f.disp_l2, 'Paid');
  eq('  …and the complaint is still counted in full', f.complaint_flag, true);
  eq('  …as is the DNC', f.dnc_flag, true);
}
{
  const log = rollUpCallLog(sheet([attempt({ n: 1 }), attempt({ n: 2 })]));
  const f = callFields(log.byAccount.get('0007477770006276734'));
  eq('an account nobody reached has no disposition', [f.disp_l1, f.disp_l2], ['', '']);
  eq('  and "did not promise" is NOT claimed of someone we never spoke to', f.promise_flag, 'N/A');
  eq('  nor "did not say they had paid"', f.paid_flag, 'N/A');
}
{
  const log = rollUpCallLog(sheet([
    attempt({ n: 1, answered: '2026-07-16 09:00:00', secs: 40, status: 'completed', l1: 'Schedule Callback', l2: 'Follow-Up' }),
  ]));
  const f = callFields(log.byAccount.get('0007477770006276734'));
  eq('a customer we DID reach who made no promise is a real "NO"', f.promise_flag, 'NO');
}
{
  // A disposition we have never seen must not outrank a payment, nor vanish beneath one.
  const log = rollUpCallLog(sheet([
    attempt({ n: 1, answered: '2026-07-16 09:00:00', secs: 40, status: 'completed', l1: 'Paid', l2: 'Paid' }),
    attempt({ n: 2, answered: '2026-07-16 10:00:00', secs: 60, status: 'completed', l1: 'Brand New L1', l2: 'Invented Next Quarter' }),
  ]));
  const f = callFields(log.byAccount.get('0007477770006276734'));
  eq('a disposition invented next quarter does not outrank a payment', f.disp_l2, 'Paid');
}

console.log('\n══ DNC — WERE THEY CALLED AGAIN? ══\n');
{
  const rows = [];
  for (let n = 1; n <= 10; n++) {
    rows.push(attempt({ n, ...(n === 3 ? { answered: '2026-07-16 09:00:00', secs: 30, status: 'completed', l1: 'DNC', l2: 'Potential Complaint' } : {}) }));
  }
  const f = callFields(rollUpCallLog(sheet(rows)).byAccount.get('0007477770006276734'));
  eq('the DNC attempt number is recorded', f.dnc_attempt, 3);
  eq('every dial placed AFTER it is counted', f.dials_after_dnc, 7);
}
{
  const rows = [attempt({ n: 1 }), attempt({ n: 2 }),
    attempt({ n: 3, answered: '2026-07-16 09:00:00', secs: 30, status: 'completed', l1: 'DNC', l2: 'Excessive Calls Limit' })];
  const f = callFields(rollUpCallLog(sheet(rows)).byAccount.get('0007477770006276734'));
  eq('a DNC on the last attempt means nobody was called again', f.dials_after_dnc, 0);
  eq('  and it is still flagged', f.dnc_flag, true);
}
{
  const rows = [
    attempt({ n: 1, answered: '2026-07-16 09:00:00', secs: 30, status: 'completed', l1: 'DNC', l2: 'Potential Complaint' }),
    attempt({ n: 2, answered: '2026-07-16 10:00:00', secs: 30, status: 'completed', l1: 'DNC', l2: 'Potential Complaint' }),
    attempt({ n: 3 }),
  ];
  const f = callFields(rollUpCallLog(sheet(rows)).byAccount.get('0007477770006276734'));
  eq('the EARLIEST DNC is the one that counts, not the latest', f.dnc_attempt, 1);
  eq('  so the redial count is the honest (larger) one', f.dials_after_dnc, 2);
}

console.log('\n══ THE JOIN ══\n');
{
  const log = rollUpCallLog(sheet([
    attempt({ account: A1, n: 1, answered: '2026-07-16 09:00:00', secs: 30, status: 'completed', l1: 'Paid', l2: 'Paid' }),
    attempt({ account: A2, n: 1 }),
  ]));
  const rows = [book('0007477770006276734'), book('0009999999999999999')];
  const res = applyCallLog(rows, log, { name: 'log.csv' });
  eq('the composite External ID joins to the plain account number', res.matched, 1);
  eq('an account the AI never rang gets ZERO, never undefined', rows[1].ai_attempts, 0);
  ok('  …and every new field is present on it', Object.keys(emptyCallFields()).every((k) => rows[1][k] !== undefined));
  eq('accounts in the log but not in the book are dropped, and counted', res.notInBook, 1);
  eq('accounts in the book but not in the log are counted too', res.notCalled, 1);
  ok('both facts are said out loud', res.warnings.length === 2, JSON.stringify(res.warnings));
}
{
  // Leading zeros: the book and the dialler disagree, as they routinely do.
  const log = rollUpCallLog(sheet([attempt({ account: '7477770006276734_16072026', n: 1 })]));
  const rows = [book('0007477770006276734')];
  const res = applyCallLog(rows, log, { name: 'log.csv' });
  eq('leading zeros do not break the join', res.matched, 1);
}
{
  // THE SILENT FAILURE. Wrong export, or two ID spaces. Every chart would read zero
  // and the page would look immaculate.
  const log = rollUpCallLog(sheet([attempt({ account: '1234567890123456_16072026', n: 1 })]));
  let threw = '';
  try { applyCallLog([book('0007477770006276734')], log, { name: 'wrong-campaign.csv' }); }
  catch (e) { threw = e.message; }
  ok('a call log that matches NOTHING stops the upload', !!threw, 'it was accepted silently');
  ok('  …and the message names the file and shows both key formats',
    threw.includes('wrong-campaign.csv') && threw.includes('0007477770006276734'), threw);
}
{
  let threw = '';
  try { rollUpCallLog([['Account No', 'Status'], ['A1', 'Resolved']]); } catch (e) { threw = e.message; }
  ok('a file with no External ID column is refused, not half-parsed', threw.includes('External ID'), threw);
  threw = '';
  try { rollUpCallLog([['External ID', 'Call Timestamp'], ['A1', '2026-07-16 10:00:00']]); } catch (e) { threw = e.message; }
  ok('a file with no Attempt Number column is refused', threw.includes('Attempt Number'), threw);
}

console.log('\n══ CSV EDGE CASES ══\n');
{
  // The disposition reason is free text written by a model. It contains commas, and it
  // will eventually contain quotes.
  const reason = 'The customer says, "I already paid, on Tuesday", and asks for a receipt';
  const line = HEADER.map((h) => (h === 'External ID' ? A1 : h === 'Attempt Number' ? '1'
    : h === 'Sense Disposition Reason' ? `"${reason.replace(/"/g, '""')}"`
      : h === 'Call Timestamp' ? '2026-07-16 10:00:00' : '')).join(',');
  const parsed = parseCsv(`${HEADER.join(',')}\n${line}`);
  const log = rollUpCallLog(parsed);
  eq('commas and quotes inside the free-text reason do not shift the columns', log.stats.attempts, 1);
  eq('  the account still resolves', [...log.byAccount.keys()], ['0007477770006276734']);
}
{
  const log = rollUpCallLog(sheet([
    attempt({ n: 1, at: '' }), attempt({ n: 2, at: '2026-07-16 14:00:00' }),
  ]));
  const f = callFields(log.byAccount.get('0007477770006276734'));
  eq('a dial with no timestamp is still a dial', f.ai_attempts, 2);
  eq('  …it is simply absent from the hour chart', f.attempts_by_hour, '14:1:0');
  eq('  …and the gap is counted', log.stats.undated, 1);
  eq('the call dates are the ones we can actually read', f.last_call_at, '2026-07-16');
}
{
  eq('a histogram round-trips', decodeHist(encodeHist(new Map([['08', { attempts: 3, connected: 1 }]]))),
    [{ key: '08', attempts: 3, connected: 1 }]);
  eq('an empty histogram decodes to nothing, not to a zero row', decodeHist(''), []);
  eq('garbage decodes to nothing rather than to NaN', decodeHist('rubbish|8:x:y'), []);
}

console.log('\n══ RE-UPLOADING THE SAME BOOK MUST NOT MOVE A SINGLE CURVE ══\n');
{
  /* The guarantee the whole product rests on, extended to the new sections. Two uploads
     of one book: the Day Total unions them, and every call figure must be identical to
     a single upload. If the curves were carried over from the uploads instead of
     re-derived from the union's accounts, they would double here — and the money beside
     them would not, which is the worst way for a page to be wrong. */
  const mkUpload = () => {
    const log = rollUpCallLog(sheet([
      attempt({ account: A1, n: 1, at: '2026-07-16 10:00:00' }),
      attempt({ account: A1, n: 2, at: '2026-07-16 14:00:00', answered: '2026-07-16 14:00:20', secs: 45, status: 'completed', l1: 'Paid', l2: 'Paid' }),
      attempt({ account: A2, n: 1, at: '2026-07-16 10:30:00' }),
      attempt({ account: A2, n: 2, at: '2026-07-16 15:00:00', answered: '2026-07-16 15:00:10', secs: 30, status: 'completed', l1: 'Schedule Callback', l2: 'Promise to Pay Later' }),
    ]));
    const rows = [book('0007477770006276734', { status: 'Resolved' }), book('0007474600001364594')];
    applyCallLog(rows, log, { name: 'log.csv' });
    return rows;
  };
  const pay = (rows) => { const a = new Aggregator(); for (const r of rows) a.add(r); return a.payload('x'); };

  const once = pay(mkUpload());
  const twice = pay(unionByAccount([mkUpload(), mkUpload()]).rows);

  const shape = (p) => JSON.stringify({
    accounts: p.agg.totals.accounts,
    recovered: p.agg.totals.recovered,
    attempts: p.agg.callLog.intensity.attempts,
    byHour: p.agg.callLog.byHour,
    byAttempt: p.agg.callLog.byAttempt,
    lines: p.agg.callLog.lines,
    ptp: p.agg.callLog.ptp,
    rates: p.agg.callLog.rates,
  });
  ok('uploading the same book twice changes nothing — money, dials, hours or curves', shape(once) === shape(twice),
    `once: ${shape(once).slice(0, 240)}\n      twice: ${shape(twice).slice(0, 240)}`);
  eq('  the naive answer would have been double (so this test is worth something)',
    once.agg.callLog.intensity.attempts * 2, 8);
  eq('  the union really did see both uploads', once.agg.totals.accounts, 2);
}

console.log('\n══ THE PAYLOAD THE CURVES PRODUCE ══\n');
{
  const rows = [];
  const logRows = [];
  for (let i = 0; i < 60; i++) {
    const acct = `000747777000627${String(6000 + i)}_16072026`;
    for (let n = 1; n <= 1 + (i % 5); n++) {
      const answered = n % 2 === 0;
      logRows.push(attempt({
        account: acct, n, at: `2026-07-16 ${String(9 + (n % 8)).padStart(2, '0')}:15:00`,
        ...(answered ? { answered: `2026-07-16 ${String(9 + (n % 8)).padStart(2, '0')}:15:20`, secs: 40, status: 'completed', l1: 'Paid', l2: 'Paid' } : {}),
      }));
    }
    rows.push(book(`000747777000627${String(6000 + i)}`, { status: i % 3 ? 'Unresolved' : 'Resolved' }));
  }
  applyCallLog(rows, rollUpCallLog(sheet(logRows)), { name: 'log.csv' });
  const a = new Aggregator(); for (const r of rows) a.add(r);
  const C = a.payload('x').agg.callLog;

  ok('the section reports itself present', C.present);
  eq('the hour curve accounts for every dial', C.byHour.reduce((s, h) => s + h.attempts, 0), C.loggedAttempts);
  eq('the attempt curve accounts for every dial', C.byAttempt.reduce((s, x) => s + x.dialled, 0), C.loggedAttempts);
  eq('the line table accounts for every dial', C.lines.reduce((s, l) => s + l.attempts, 0), C.loggedAttempts);
  eq('every first payment appears on the curve exactly once',
    C.byAttempt.reduce((s, x) => s + x.firstPaid, 0), C.firstPaidAccounts);
  ok('the cumulative share ends at exactly 100%',
    Math.abs(C.byAttempt[C.byAttempt.length - 1].cumFirstPaidPct - 100) < 1e-9);
  ok('attempt 1 is dialled at least as often as attempt 2 (the dialler only ever stops)',
    C.byAttempt[0].dialled >= C.byAttempt[1].dialled);
  ok('the four un-measurable figures are declared, not omitted', (C.notMeasured || []).length === 4,
    JSON.stringify((C.notMeasured || []).map((x) => x.key)));
  eq('  by name', (C.notMeasured || []).map((x) => x.key), ['tonality', 'cash', 'agent', 'wpc']);
}

console.log(`\n${'─'.repeat(72)}`);
console.log(`${checks} checks · ${fails} failure(s)\n`);
if (fails) process.exitCode = 1;
