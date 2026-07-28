/* ─────────────────────────────────────────────────────────────────────────────
 * THE AI CALL LOG — one row per CALL ATTEMPT, rolled up to one row per ACCOUNT.
 *
 * This file replaces the old Lead Outcome export as the source of call activity.
 * The two have completely different shapes and that difference is the whole point:
 *
 *    Lead Outcome (old)   one row per ACCOUNT.  "13 attempts, 4 connected, 6m talk."
 *    AI Call Log  (new)   one row per ATTEMPT.  Attempt 7, 14:22, answered, 58s, Paid.
 *
 * Everything new in this release — hour of day, conversion by attempt number, whether
 * a DNC account was dialled again afterwards — exists only because the second file
 * knows WHEN each dial happened and WHAT it produced. The first one could never say.
 *
 * ── WHY IT IS ROLLED UP HERE, AND NOT STORED AS ATTEMPTS ─────────────────────
 * The canonical model of this app is ONE ROW PER ACCOUNT. Every guard that makes it
 * trustworthy — the CYC spine, the Day Total union, "re-uploading the book must not
 * double the money" — is keyed on the account. Storing 18,883 attempt rows would give
 * us a second grain with none of those guards, and the first time someone summed the
 * wrong one a bank would be shown a number four times too big.
 *
 * So the attempts are folded onto the account here, in the browser, and the Aggregator
 * re-derives every cross-account curve (hour of day, attempt conversion) from the
 * per-account fields. That is what makes those curves survive the Day Total union: they
 * are recomputed from the union's accounts, not carried over from an upload.
 *
 * ── PII ───────────────────────────────────────────────────────────────────────
 * The file carries `Lead Name`, `To Phone Num` and `Lead Link` — a customer's name,
 * their mobile, and a URL that identifies their lead record. NONE of the three is read
 * by this module. Not read, not rolled up, not stored, not displayed. The parser is
 * positional and only ever touches the columns in COL below, so there is no path by
 * which they can reach the payload, the database or the wire.
 *
 * The one phone number that does survive is the OUTBOUND line (`From Phone Num`) —
 * Convin's own dialler trunk, not a customer — and even that is reduced to its last
 * four digits, so what is stored ("6392") is not a phone number by any definition.
 * ───────────────────────────────────────────────────────────────────────────── */

import { dateOnly, normalizeAccount } from './normalize.mjs';

/* The columns this module reads. Anything not on this list is never touched. */
const COL = {
  account: 'External ID',
  attempt: 'Attempt Number',
  placed: 'Call Timestamp',
  answered: 'Call Answered Timestamp',
  seconds: 'Call Duration (Seconds)',
  status: 'Call Status',
  l1: 'Sense Disposition L1',
  l2: 'Sense Disposition L2',
  line: 'From Phone Num',
};

/** Is this parsed sheet the AI call log? Keyed on the three columns that make it what
 *  it is — a per-attempt export. `Attempt Number` in particular exists in no other file
 *  we ingest, so it cannot be confused with the CYC book or the status file. */
export function detectCallLog(headers) {
  const h = new Set((headers || []).map((x) => String(x ?? '').trim().toLowerCase()));
  return h.has('external id') && h.has('attempt number')
    && (h.has('call answered timestamp') || h.has('call timestamp'));
}

/* ── Disposition severity ──────────────────────────────────────────────────────
 *
 * An account is dialled up to 21 times and can pick up five of them, saying something
 * different each time. The rest of the dashboard — the L1 table, the L2 table, the
 * funnel — expects ONE disposition per account, exactly as the old lead export gave it.
 * So we have to choose, and the choice is visible in every one of those charts.
 *
 * "Last one wins" is wrong, and wrong in the direction that flatters nobody: an account
 * that paid on attempt 3 and got a routine follow-up call on attempt 8 would be filed
 * under Follow-Up, and the Paid row would lose it. So the account takes its STRONGEST
 * disposition, ranked below, with the later attempt breaking a tie between equals.
 *
 * A value we have never seen lands mid-table (UNKNOWN_RANK) rather than at either
 * extreme — a new disposition Convin invents next quarter must not silently outrank a
 * payment, nor be buried beneath a voicemail.
 *
 * Note where `Potential Complaint` sits: near the bottom. It is a COMPLIANCE fact, and
 * it is counted in full and separately as complaint_flag — it is simply not the thing to
 * label a collections account with when that account also paid.
 */
const L2_RANK = {
  'On Call Payment Done': 100,
  Paid: 95,
  'Promise to Pay Later': 80,
  "Can't Pay - Request for Payment Plan": 72,
  'Human Callback Requested': 64,
  'Follow-Up': 56,
  "Won't Pay - Wants Statement": 48,
  "Won't Pay - Re-Waiver Required": 47,
  "Won't Pay - Dispute": 46,
  "Won't Pay - Service Issue / Complaints": 45,
  "Can't Pay - Financial Crises": 44,
  "Won't Pay - Intention Issue": 43,
  'Potential Complaint': 30,
  'Excessive Calls Limit': 22,
  'Message to Third Party': 14,
};
const UNKNOWN_RANK = 40;
const rankOf = (l1, l2) => {
  const k = String(l2 ?? '').trim();
  if (k) return L2_RANK[k] ?? UNKNOWN_RANK;
  return String(l1 ?? '').trim() ? UNKNOWN_RANK : -1;
};

/** The two L2 values that mean money moved. */
const PAID_L2 = new Set(['Paid', 'On Call Payment Done']);

/** "2026-07-16 14:37:27" / "2026-07-16T14:37:27Z" -> "14". Anything else -> "". */
const hourOf = (v) => {
  const m = String(v ?? '').match(/[T ](\d{2}):\d{2}/);
  return m ? m[1] : '';
};
/** An outbound trunk reduced to its last four digits. Not a phone number any more. */
const lineTag = (v) => {
  const d = String(v ?? '').replace(/\D/g, '');
  return d ? d.slice(-4) : '';
};
const int = (v) => {
  const n = parseInt(String(v ?? '').trim(), 10);
  return Number.isFinite(n) ? n : 0;
};

/* ── Compact histograms ────────────────────────────────────────────────────────
 * A per-account histogram has to survive a round-trip through Postgres and through the
 * Day Total union, and it has to be small enough that a 100,000-account book does not
 * become a problem. So it is one text column, "key:attempts:connected|key:…", written
 * here and read back by the Aggregator. No JSON, no jsonb, no second table. */
export const encodeHist = (map) => [...map.entries()]
  .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  .map(([k, v]) => `${k}:${v.attempts}:${v.connected}`)
  .join('|');

/** "08:120:30|09:88:12" -> [{ key: '08', attempts: 120, connected: 30 }, …] */
export function decodeHist(s) {
  const out = [];
  for (const part of String(s ?? '').split('|')) {
    if (!part) continue;
    const bits = part.split(':');
    if (bits.length < 3) continue;
    const attempts = Number(bits[1]);
    const connected = Number(bits[2]);
    if (!Number.isFinite(attempts) || !Number.isFinite(connected)) continue;
    out.push({ key: bits[0], attempts, connected });
  }
  return out;
}

/* The attempt mask. Position i-1 describes attempt i:
 *     '1' dialled and answered   ·   '0' dialled, no answer   ·   '-' no such attempt
 *
 * The third state matters. Attempt numbers are dense on 1,416 of the 1,417 accounts in
 * the real export — but not on all of them, and a two-state mask would have to invent
 * an attempt that was never placed in order to keep its indexes lined up. That invented
 * dial would then be counted in the per-attempt connect rate, which is the exact chart
 * it would corrupt. */
const maskOf = (attempts) => {
  const max = attempts.length - 1;
  let s = '';
  for (let i = 1; i <= max; i++) {
    const a = attempts[i];
    s += a === undefined ? '-' : (a.connected ? '1' : '0');
  }
  return s;
};

/**
 * Parse the call log and fold it onto accounts.
 *
 * @param  parsed  array-of-arrays, row 0 = headers (whatever readSheet/parseCsv gives)
 * @return { byAccount: Map<accountKey, rollup>, stats }
 */
export function rollUpCallLog(parsed) {
  if (!parsed || parsed.length < 2) {
    throw new Error('The AI call log has no data rows in it.');
  }
  const header = parsed[0].map((h) => String(h ?? '').trim());
  const at = {};
  for (const [k, name] of Object.entries(COL)) at[k] = header.indexOf(name);
  if (at.account < 0) {
    throw new Error(`The AI call log has no "${COL.account}" column, so its calls cannot be attached to an account.`);
  }
  if (at.attempt < 0) {
    throw new Error(`The AI call log has no "${COL.attempt}" column. Attempt numbers are explicit in this export and are never inferred from row order.`);
  }

  const byAccount = new Map();
  const stats = {
    rows: 0, skippedNoAccount: 0, attempts: 0, connected: 0, voicemail: 0,
    talkSeconds: 0, accounts: 0, maxAttempt: 0, unnumbered: 0, undated: 0, dates: new Set(),
  };
  const cell = (rec, i) => (i >= 0 ? String(rec[i] ?? '').trim() : '');

  for (let i = 1; i < parsed.length; i++) {
    const rec = parsed[i];
    if (!rec || rec.length < 2) continue;

    const key = normalizeAccount(cell(rec, at.account));
    if (!key) { stats.skippedNoAccount++; continue; }
    stats.rows++;

    let a = byAccount.get(key);
    if (!a) {
      a = {
        attempts: 0, connected: 0, voicemailCalls: 0, voicemailSeconds: 0, talkSeconds: 0,
        firstCall: '', lastCall: '',
        hours: new Map(), lines: new Map(),
        byAttempt: [],                 // sparse, indexed by Attempt Number
        maxAttempt: 0,
        firstPaidAttempt: 0, dncAttempt: 0,
        paid: false, ptp: false, refused: false, dnc: false, complaint: false,
        bestRank: -1, bestAttempt: -1, l1: '', l2: '',
      };
      byAccount.set(key, a);
    }

    /* Attempt Number is EXPLICIT in this export. Never recomputed from row order —
       the file is not sorted by account, and a re-derived attempt number would be
       quietly wrong on every chart built from it. */
    const n = int(cell(rec, at.attempt));
    const answeredAt = cell(rec, at.answered);
    const connected = answeredAt !== '';        // the connect definition. Nothing else.
    const secs = connected ? Math.max(0, int(cell(rec, at.seconds))) : 0;
    const status = cell(rec, at.status).toLowerCase();
    const l1 = cell(rec, at.l1);
    const l2 = cell(rec, at.l2);
    const placed = cell(rec, at.placed);
    const day = dateOnly(placed);

    a.attempts++;
    stats.attempts++;
    if (connected) {
      a.connected++; stats.connected++;
      a.talkSeconds += secs; stats.talkSeconds += secs;
      /* A voicemail has an Answered Timestamp, so by the file's own definition it is a
         connect. It is also not a human. Counted here so the report can say both. */
      if (status === 'voicemail') {
        a.voicemailCalls++; a.voicemailSeconds += secs; stats.voicemail++;
      }
    }

    if (day) {
      stats.dates.add(day);
      if (!a.firstCall || day < a.firstCall) a.firstCall = day;
      if (!a.lastCall || day > a.lastCall) a.lastCall = day;
    }

    const hh = hourOf(placed);
    if (hh) {
      let h = a.hours.get(hh);
      if (!h) { h = { attempts: 0, connected: 0 }; a.hours.set(hh, h); }
      h.attempts++; if (connected) h.connected++;
    }

    const ln = lineTag(cell(rec, at.line));
    if (ln) {
      let l = a.lines.get(ln);
      if (!l) { l = { attempts: 0, connected: 0 }; a.lines.set(ln, l); }
      l.attempts++; if (connected) l.connected++;
    }

    if (n > 0) {
      a.byAttempt[n] = { connected, l1, l2 };
      if (n > a.maxAttempt) a.maxAttempt = n;
      if (n > stats.maxAttempt) stats.maxAttempt = n;
    } else {
      /* No attempt number on the row. It still counts as a dial — it happened — but it
         cannot be placed on the attempt-conversion curve, and it is NOT going to be
         given a position inferred from row order. The file is not sorted by account, so
         an inferred attempt number would be a fabrication dressed as a measurement.
         Counted here so the discrepancy has a name instead of being a silent gap. */
      stats.unnumbered++;
    }
    if (!day) stats.undated++;

    /* Flags roll from ANY attempt — including an attempt that was never answered but
       still carries a disposition (four of them do in the real export). A customer who
       said "do not call me" on attempt 6 said it, whatever attempt 14 recorded. */
    if (PAID_L2.has(l2)) {
      a.paid = true;
      if (n > 0 && (a.firstPaidAttempt === 0 || n < a.firstPaidAttempt)) a.firstPaidAttempt = n;
    }
    if (l2 === 'Promise to Pay Later') a.ptp = true;
    if (l2 === 'Potential Complaint') a.complaint = true;
    if (l1 === 'Refused to Pay') a.refused = true;
    if (l1 === 'DNC') {
      a.dnc = true;
      if (n > 0 && (a.dncAttempt === 0 || n < a.dncAttempt)) a.dncAttempt = n;
    }

    const rank = rankOf(l1, l2);
    if (rank > a.bestRank || (rank === a.bestRank && rank >= 0 && n > a.bestAttempt)) {
      a.bestRank = rank; a.bestAttempt = n; a.l1 = l1; a.l2 = l2;
    }
  }

  stats.accounts = byAccount.size;
  stats.dates = [...stats.dates].sort();
  return { byAccount, stats };
}

/** The rollup for one account -> the fields that go on its canonical row. */
export function callFields(a) {
  /* Dials placed AFTER the customer asked not to be called. Attempt number is the
     ordering: on the real export the call timestamps agree with it on all 1,417
     accounts, so the two orderings are the same ordering and the simpler one is safe. */
  let dialsAfterDnc = 0;
  if (a.dncAttempt > 0) {
    for (let i = a.dncAttempt + 1; i <= a.maxAttempt; i++) if (a.byAttempt[i]) dialsAfterDnc++;
  }
  return {
    ai_attempts: a.attempts,
    ai_connected_calls: a.connected,
    ai_connected_seconds: a.talkSeconds,
    disp_l1: a.l1,
    disp_l2: a.l2,
    first_call_at: a.firstCall,
    last_call_at: a.lastCall,
    attempts_by_hour: encodeHist(a.hours),
    outbound_lines: encodeHist(a.lines),
    attempt_mask: maskOf(a.byAttempt),
    max_attempt: a.maxAttempt,
    attempt_first_paid: a.firstPaidAttempt,
    dnc_attempt: a.dncAttempt,
    dials_after_dnc: dialsAfterDnc,
    voicemail_calls: a.voicemailCalls,
    voicemail_seconds: a.voicemailSeconds,
    complaint_flag: a.complaint,
    dnc_flag: a.dnc,
    refused_flag: a.refused,
    ptp_flag: a.ptp,
    /* The three entity flags the rest of the dashboard already runs on. The old lead
       export shipped them as their own columns; this file does not, so they are DERIVED
       from what the customer actually said — and the derivation is stated rather than
       hidden, because a flag whose meaning quietly changed between releases is how a
       chart starts lying without anyone editing it.

       "NO" is only claimed where we actually spoke to the customer. An account nobody
       ever reached did not decline to promise — nothing is known about it, and 'N/A'
       is the only honest value. */
    paid_flag: a.paid ? 'YES' : (a.connected ? 'NO' : 'N/A'),
    promise_flag: a.ptp ? 'YES' : (a.connected ? 'NO' : 'N/A'),
    refusal_flag: a.refused ? 'YES' : (a.connected ? 'NO' : 'N/A'),
  };
}

/** What an account with no row in the call log looks like. Not "unknown" — ZERO.
 *  The CYC book is the spine, so an account absent from the log is an account the AI
 *  never dialled, and that is a fact worth counting, not a gap to hide. */
export function emptyCallFields() {
  return {
    ai_attempts: 0, ai_connected_calls: 0, ai_connected_seconds: 0,
    disp_l1: '', disp_l2: '',
    first_call_at: '', last_call_at: '',
    attempts_by_hour: '', outbound_lines: '', attempt_mask: '',
    max_attempt: 0, attempt_first_paid: 0, dnc_attempt: 0, dials_after_dnc: 0,
    voicemail_calls: 0, voicemail_seconds: 0,
    complaint_flag: false, dnc_flag: false, refused_flag: false, ptp_flag: false,
    paid_flag: 'N/A', promise_flag: 'N/A', refusal_flag: 'N/A',
  };
}

/** Account numbers vary in leading zeros — index on both forms, exactly as merge.mjs
 *  does, so the call log and the portfolio sheet can never disagree about a key. */
const keyForms = (v) => {
  const s = String(v ?? '').trim();
  if (!s) return [];
  const stripped = s.replace(/^0+/, '');
  return stripped && stripped !== s ? [s, stripped] : [s];
};

/**
 * Fold the call log onto canonical rows, in place.
 *
 * The CYC book decides which accounts exist; this only ever fills in what the AI did to
 * them. An account in the log but NOT in the book belongs to a different cycle and is
 * dropped — silently by design, but counted and reported, because "238 accounts we
 * called are not in this book" is a sentence somebody needs to read.
 *
 * @returns { matched, notCalled, notInBook, warnings }
 */
export function applyCallLog(rows, log, { name = 'the AI call log' } = {}) {
  const index = new Map();
  for (const [k, v] of log.byAccount) for (const f of keyForms(k)) if (!index.has(f)) index.set(f, v);

  const usedKeys = new Set();
  let matched = 0;
  let notCalled = 0;

  for (const r of rows) {
    let hit = null;
    for (const f of keyForms(r.account_no)) {
      if (index.has(f)) { hit = index.get(f); break; }
    }
    if (hit) {
      matched++;
      usedKeys.add(hit);
      Object.assign(r, callFields(hit));
    } else {
      notCalled++;
      Object.assign(r, emptyCallFields());
    }
  }

  /* A call log that joined to NOTHING is the wrong file, or two systems numbering
     accounts differently. Both render a beautiful dashboard with no calls behind it —
     0 attempts, 0 connects, every chart at zero — and nothing on the page would say
     why. Same rule, and the same refusal, as an unmatched lookup sheet in merge.mjs. */
  if (rows.length && matched === 0) {
    const theirs = [...log.byAccount.keys()][0] ?? '(none)';
    const ours = rows[0]?.account_no || '?';
    throw new Error(
      `"${name}" did not match a single account in the book, so none of its ${log.stats.attempts.toLocaleString('en-IN')} call attempts were used. `
      + `The book numbers accounts like "${ours}", the call log like "${theirs}". `
      + `Either it is the wrong campaign export, or the two files number accounts differently. `
      + `Uploading it as-is would report a book that was never called.`,
    );
  }

  const notInBook = log.byAccount.size - usedKeys.size;
  const warnings = [];
  if (log.stats.unnumbered) {
    warnings.push(
      `"${name}": ${log.stats.unnumbered.toLocaleString('en-IN')} call attempt${log.stats.unnumbered === 1 ? ' has' : 's have'} no Attempt Number. `
      + `${log.stats.unnumbered === 1 ? 'It is' : 'They are'} counted in the dial totals but left off the conversion-by-attempt curve — `
      + `the file is not sorted by account, so a position inferred from row order would be a guess, not a measurement.`,
    );
  }
  if (log.stats.undated) {
    warnings.push(
      `"${name}": ${log.stats.undated.toLocaleString('en-IN')} call attempt${log.stats.undated === 1 ? ' has' : 's have'} no readable Call Timestamp, `
      + `so ${log.stats.undated === 1 ? 'it is' : 'they are'} absent from the hour-of-day chart. Every other figure still counts ${log.stats.undated === 1 ? 'it' : 'them'}.`,
    );
  }
  if (notCalled) {
    warnings.push(
      `${notCalled.toLocaleString('en-IN')} of ${rows.length.toLocaleString('en-IN')} accounts in the book have no calls in "${name}". `
      + `They are counted in full — the book is RBL's, not ours — and they show as never attempted.`,
    );
  }
  if (notInBook) {
    warnings.push(
      `"${name}" contains ${notInBook.toLocaleString('en-IN')} account${notInBook === 1 ? '' : 's'} that ${notInBook === 1 ? 'is' : 'are'} not in this CYC book `
      + `(a different cycle). ${notInBook === 1 ? 'It was' : 'They were'} dropped: the book decides which accounts exist, and adding accounts the bank did not send us `
      + `would report a campaign larger than the one they asked for.`,
    );
  }
  return { matched, notCalled, notInBook, warnings };
}
