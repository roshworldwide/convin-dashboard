// Single-pass aggregator: feed it canonical rows, get the {meta, agg, intel}
// payload the dashboard renders. O(rows) memory-light — safe for 1M+ rows.
// Mirrors generate_convin_data.py exactly (Resolved => full outstanding recovered).

import { BAND_ORDER, isResolved } from './normalize.mjs';
import { decodeHist } from './calllog.mjs';
import { PAYLOAD_VERSION } from './payload_version.mjs';
import {
  featurize, trainPropensity, score, computeLifts,
  buildCategoricalSpec, encodeCategorical, featureNamesWith,
  MODEL_NAME, MODEL_VERSION,
} from './model.mjs';

const DUR_ORDER = ['Not connected', '<30s', '30–60s', '1–2 min', '2–5 min', '>5 min'];
const ATT_ORDER = ['1–3', '4–6', '7–9', '10–12', '13+'];

/* An entire day's worth of calls in which NOT ONE account resolved — while the days
   before it resolved normally — is not a result. It is a day whose outcome had not
   been written yet when the status file was pulled. BLIND_MIN is the smallest cohort
   we will call blind on that basis; below it, a genuine run of bad luck is plausible
   and we say nothing. Above it, zero is not luck. (On the 3 July book: 740 accounts,
   0 resolved, against 18–40% on every other day.) */
const BLIND_MIN = 25;
/* Below this, a resolution percentage on a call-behaviour chart is noise. Charted
   as a raw count instead of a rate — the same rule the L2 table already uses. */
const CELL_MIN = 30;
const dayOf = (r) => String(r.last_call_at || '').slice(0, 10);
/* Subtract the blind days from a bucket's counters. */
const netOf = (tot, byDate, blind, fields) => {
  const o = {};
  for (const f of fields) o[f] = tot[f] || 0;
  for (const d of blind) {
    const c = byDate?.get(d);
    if (!c) continue;
    for (const f of fields) o[f] -= c[f] || 0;
  }
  return o;
};
/* A by-date sub-counter, lazily created. */
const bump = (parent, date, fields) => {
  if (!date) return null;
  if (!parent.byDate) parent.byDate = new Map();
  let c = parent.byDate.get(date);
  if (!c) { c = {}; for (const f of fields) c[f] = 0; parent.byDate.set(date, c); }
  return c;
};
const durBucket = (s) => (s <= 0 ? 'Not connected' : s < 30 ? '<30s' : s < 60 ? '30–60s' : s < 120 ? '1–2 min' : s < 300 ? '2–5 min' : '>5 min');
const attBand = (a) => (a <= 3 ? '1–3' : a <= 6 ? '4–6' : a <= 9 ? '7–9' : a <= 12 ? '10–12' : '13+');
const U = (x) => String(x ?? '').trim().toUpperCase();

/* Attempt intensity across the book. Deliberately NOT attBand() above: that one has no
   zero bucket (attBand(0) returns "1–3"), which is harmless where it is used — the dial
   efficiency chart only ever sees dialled accounts — and completely wrong here, where
   the whole point is that the CYC book contains accounts the AI never rang. */
const INTENSITY_ORDER = ['Never dialled', '1–3', '4–6', '7–9', '10–12', '13+'];
const intensityBand = (a) => (a <= 0 ? 'Never dialled' : attBand(a));
/* Connected-call intensity. "Reached once" is its own bucket because reaching a customer
   at all is the step that moves the outcome — lumping it with 2–3 hides that. */
const CONTACT_ORDER = ['Never reached', '1', '2–3', '4–6', '7+'];
const contactBand = (c) => (c <= 0 ? 'Never reached' : c === 1 ? '1' : c <= 3 ? '2–3' : c <= 6 ? '4–6' : '7+');

/** An account number, reduced to something that identifies a ROW without identifying a
 *  PERSON. Six of nineteen digits, and no name anywhere near it. This is what the Top-20
 *  table prints: the collections team can match it against their own list, and a leaked
 *  screenshot tells a stranger nothing. */
const maskAccount = (a) => {
  const d = String(a ?? '').replace(/\D/g, '');
  return d ? `•••• ${d.slice(-6)}` : '—';
};
const cr = (x) => (Math.abs(x) >= 1e7 ? `₹${(x / 1e7).toFixed(2)} Cr` : Math.abs(x) >= 1e5 ? `₹${(x / 1e5).toFixed(2)} L` : `₹${Math.round(x).toLocaleString('en-IN')}`);

/* Business inputs that CANNOT be derived from a collections CSV — they come from
   RBL's commercials. They are configurable and every figure built on them is
   tagged as an assumption in the UI, never presented as measured fact. */
// NOTE: Convin's own cost is deliberately NEVER computed, stored or served — this
// dashboard is shown to the client, and our margin is not their business.
const cfg = (k, d) => { const v = Number(process.env[k]); return Number.isFinite(v) && v > 0 ? v : d; };
const AGENCY_PCT = cfg('AGENCY_COMMISSION_PCT', 12);
const CYCLES_PER_YEAR = cfg('CYCLES_PER_YEAR', 12);
const CYCLE_DECAY = cfg('CYCLE_DECAY', 0.85);

/* Tier cut-offs are DERIVED from the batch's own base resolution rate — an open
   account is "High" if the model thinks it is at least as likely to recover as a
   typical account in this book. No magic numbers. */
const tierCuts = (baseRate) => ({ high: baseRate, medium: baseRate / 2 });

// The payload's schema version lives in its own module so the client bundle can read
// it without importing the aggregator (and the model) — see payload_version.mjs.
export { PAYLOAD_VERSION };

export class Aggregator {
  constructor() {
    this.N = 0; this.res = 0;
    this.sumOut = 0; this.sumMinDue = 0; this.recovered = 0;
    this.attempts = 0; this.connected = 0; this.secs = 0;
    this.entity = { promise: {}, paid: {}, refusal: {} };
    this.disp = new Map(); this.dispL2 = new Map(); this.band = new Map(); this.region = new Map(); this.state = new Map();
    this.dur = new Map(); this.pm = new Map(); this.durL2 = new Map();
    this.fAttempted = 0; this.fConnected = 0; this.fQualified = 0; this.fPromise = 0; this.fPaid = 0;
    this.fPtpLater = 0; this.fPaidL2 = 0;
    // …and how many of each stage actually RESOLVED. A funnel that only shows counts
    // tells you where accounts went; a funnel that shows resolution tells you whether
    // going there was worth anything.
    this.rAttempted = 0; this.rConnected = 0; this.rQualified = 0; this.rPtpLater = 0; this.rPaidL2 = 0;
    this.top = [];
    this.openOut = 0;
    this.oppPromise = { count: 0, amount: 0 }; this.oppEngaged = { count: 0, amount: 0 }; this.oppClaimed = { count: 0, amount: 0 };
    this.tiers = { High: { count: 0, amount: 0 }, Medium: { count: 0, amount: 0 }, Low: { count: 0, amount: 0 } };
    this.dirtyAttempts = 0;   // rows claiming connected calls with zero attempts
    this.paidYes = 0; this.paidYesRes = 0; this.saidNoRes = 0; this.promisedOpen = 0;
    this.dial = new Map();
    /* Accounts grouped by the DATE OF THEIR LAST CALL. This is the whole apparatus for
       catching a status file that was pulled before the calls finished — see
       _outcomeWindow() below. Bounded by the number of days in a campaign, so it costs
       nothing. Every call-behaviour chart also keeps its own by-date breakdown, so the
       blind days can be subtracted at payload time without a second pass over rows. */
    this.lastCall = new Map();
    // model training set (features + outcome) and the open book we'll score
    this.X = []; this.Y = [];
    this.openX = []; this.openAmt = [];
    /* The categorical columns (RBL segment, our collection score) cannot be encoded
       row-by-row: we do not know the vocabulary until the whole book has streamed
       past. So we keep the raw values — two short strings per account — and one-hot
       them at payload() time, once we know which categories the book actually has.
       Cheap: at a million rows this is a few tens of MB, and it is the only way the
       model can adapt to categories the bank invents next quarter. */
    this.cats = []; this.openCats = [];
    // Segment breakdown for the dashboard — the exec asked to SEE this, not just
    // have the model use it.
    this.seg = new Map();

    /* ── FROM THE AI CALL LOG ───────────────────────────────────────────────────
     * Every counter below is rolled from PER-ACCOUNT fields, never from attempt rows.
     * That is what makes the curves survive the Day Total union: re-uploading the same
     * book replaces the account, so its hours and its attempts are counted once, and
     * the hour-of-day and attempt-conversion curves come out identical. Had these been
     * pre-computed at upload time and merged, two uploads of one book would have
     * doubled every dial on the chart while the money stayed correct — a chart
     * disagreeing with the headline beside it, which is the worst kind of wrong.        */
    this.logged = 0;             // accounts with at least one attempt in the call log
    /* Dials and answers belonging to accounts that carry call-log data, as distinct from
       this.attempts / this.connected, which are the WHOLE book. They differ in exactly one
       situation and it is a real one: a Day Total that unions a day uploaded with the old
       per-account lead export against a day uploaded with the per-attempt call log. The
       hour and attempt curves can only be drawn over the accounts that have attempts, so
       the section reports its own denominator rather than borrowing the book's. */
    this.logAttempts = 0; this.logConnected = 0;
    this.hour = new Map();       // 'HH'   -> { attempts, connected }
    this.line = new Map();       // last-4 -> { attempts, connected }
    this.attN = new Map();       // attempt no -> { attempts, connected, firstPaid, firstPaidResolved }
    this.maxAttemptSeen = 0;
    this.vmCalls = 0; this.vmSecs = 0; this.humanReached = 0;
    this.ptpAcc = 0; this.ptpRes = 0; this.ptpOut = 0; this.ptpRec = 0;
    this.cmpAcc = 0; this.cmpRes = 0; this.cmpOut = 0;
    this.dncAcc = 0; this.dncRes = 0; this.dncRedial = 0; this.dncRedialDials = 0;
    this.dncMaxAfter = 0; this.dncCmp = 0;
    this.refAcc = 0; this.refRes = 0;
    this.paidAcc = 0; this.paidRes = 0; this.firstPaidKnown = 0;
    this.intensity = new Map();  // attempts band  -> { accounts, resolved }
    this.contact = new Map();    // connects band  -> { accounts, resolved }
    // AI-only vs AI+agency. One value in every book we have seen; wired anyway.
    this.agency = new Map();
  }

  _em(kind, key, resolved) {
    const m = this.entity[kind];
    if (!m[key]) m[key] = { resolved: 0, unresolved: 0 };
    m[key][resolved ? 'resolved' : 'unresolved']++;
  }
  _geo(map, k, r, o, resolved) {
    // A blank region used to make the account vanish from the geography charts, so
    // they silently failed to add up to the book. Bucket it honestly instead.
    if (!k) k = 'Unspecified';
    let e = map.get(k);
    if (!e) { e = { count: 0, outstanding: 0, recovered: 0, resolved: 0, unresolved: 0, minDue: 0, attempts: 0, connected: 0 }; map.set(k, e); }
    e.count++; e.outstanding += o; e.minDue += r.minimum_amount_due; e.attempts += r.ai_attempts; e.connected += r.ai_connected_calls;
    if (resolved) { e.resolved++; e.recovered += o; } else e.unresolved++;
  }
  /* Top-20 by exposure. NO CUSTOMER NAME — not here, not in the payload, not in the
     printed PDF, not in a share link. It used to carry r.customer_name, which meant the
     one table an exec is most likely to screenshot was also the only place in the
     deliverable holding a bank's customers by name. The masked account reference does
     the job it was actually there for: the collections team can look it up in their own
     system, and nobody else can look up anybody. */
  _pushTop(r, o) {
    const t = this.top;
    if (t.length >= 20 && o <= t[t.length - 1].o) return;
    const item = { o, ref: maskAccount(r.account_no), state: r.primary_state || '—', connected: r.ai_connected_calls, ptp: U(r.promise_flag) === 'YES', status: r.status };
    let i = t.length; while (i > 0 && t[i - 1].o < o) i--;
    t.splice(i, 0, item); if (t.length > 20) t.length = 20;
  }

  /* ── The call log, folded in ───────────────────────────────────────────────────
     Reads ONLY the per-account fields written by calllog.mjs. A row from a book
     uploaded before the call log existed has none of them, and every read below
     defaults to zero — so an old report aggregates exactly as it always did and the
     new section simply reports itself absent. */
  _callLog(r, o, resolved) {
    const maxAttempt = Number(r.max_attempt) || 0;
    if (maxAttempt <= 0 && !String(r.attempt_mask || '')) return;
    this.logged++;
    this.logAttempts += Number(r.ai_attempts) || 0;
    this.logConnected += Number(r.ai_connected_calls) || 0;
    if (maxAttempt > this.maxAttemptSeen) this.maxAttemptSeen = maxAttempt;

    for (const h of decodeHist(r.attempts_by_hour)) {
      let e = this.hour.get(h.key);
      if (!e) { e = { attempts: 0, connected: 0 }; this.hour.set(h.key, e); }
      e.attempts += h.attempts; e.connected += h.connected;
    }
    for (const l of decodeHist(r.outbound_lines)) {
      let e = this.line.get(l.key);
      if (!e) { e = { attempts: 0, connected: 0 }; this.line.set(l.key, e); }
      e.attempts += l.attempts; e.connected += l.connected;
    }

    /* The attempt mask. '-' means that attempt number does not exist for this account,
       and skipping it is the whole reason the mask has three states — counting a dial
       that was never placed would inflate exactly the denominator this curve is made of. */
    const mask = String(r.attempt_mask || '');
    for (let i = 0; i < mask.length; i++) {
      const c = mask[i];
      if (c !== '0' && c !== '1') continue;
      const e = this._att(i + 1);
      e.attempts++; if (c === '1') e.connected++;
    }

    const fp = Number(r.attempt_first_paid) || 0;
    if (fp > 0) {
      const e = this._att(fp);
      e.firstPaid++; if (resolved) e.firstPaidResolved++;
      this.firstPaidKnown++;
    }

    const vm = Number(r.voicemail_calls) || 0;
    this.vmCalls += vm;
    this.vmSecs += Number(r.voicemail_seconds) || 0;
    // Reached by a PERSON, not by an answering machine. A voicemail has an answered
    // timestamp, so it is a connect by the file's own definition — and it is not a
    // conversation, and the report says both rather than picking one.
    if ((Number(r.ai_connected_calls) || 0) > vm) this.humanReached++;

    if (r.ptp_flag) { this.ptpAcc++; this.ptpOut += o; if (resolved) { this.ptpRes++; this.ptpRec += o; } }
    if (r.complaint_flag) { this.cmpAcc++; this.cmpOut += o; if (resolved) this.cmpRes++; }
    if (r.refused_flag) { this.refAcc++; if (resolved) this.refRes++; }
    if (r.dnc_flag) {
      this.dncAcc++; if (resolved) this.dncRes++;
      if (r.complaint_flag) this.dncCmp++;
      const after = Number(r.dials_after_dnc) || 0;
      if (after > 0) { this.dncRedial++; this.dncRedialDials += after; if (after > this.dncMaxAfter) this.dncMaxAfter = after; }
    }
    if (fp > 0 || U(r.paid_flag) === 'YES') { this.paidAcc++; if (resolved) this.paidRes++; }
  }

  _att(n) {
    let e = this.attN.get(n);
    if (!e) { e = { attempts: 0, connected: 0, firstPaid: 0, firstPaidResolved: 0 }; this.attN.set(n, e); }
    return e;
  }
  add(r) {
    const o = r.total_outstanding, resolved = isResolved(r);

    // model data: every row trains, every open row gets scored later
    const f = featurize(r);
    const cat = { segment: r.segment, lead_score: r.lead_score };
    this.X.push(f); this.Y.push(resolved ? 1 : 0); this.cats.push(cat);
    if (!resolved) { this.openX.push(f); this.openAmt.push(o); this.openCats.push(cat); }

    // Segment breakdown (RBL's own risk grade) — shown on the dashboard.
    const sk = r.segment || 'Unspecified';
    let sv = this.seg.get(sk);
    if (!sv) { sv = { count: 0, resolved: 0, unresolved: 0, outstanding: 0, recovered: 0 }; this.seg.set(sk, sv); }
    sv.count++; sv.outstanding += o;
    if (resolved) { sv.resolved++; sv.recovered += o; } else sv.unresolved++;
    this.N++; this.sumOut += o; this.sumMinDue += r.minimum_amount_due;
    this.attempts += r.ai_attempts; this.connected += r.ai_connected_calls; this.secs += r.ai_connected_seconds;
    if (resolved) { this.res++; this.recovered += o; }

    this._em('promise', r.promise_flag, resolved);
    this._em('paid', r.paid_flag, resolved);
    this._em('refusal', r.refusal_flag, resolved);

    const dn = r.disp_l1 || '(Not contacted)';
    let dd = this.disp.get(dn); if (!dd) { dd = { total: 0, resolved: 0, unresolved: 0, outstanding: 0, recovered: 0 }; this.disp.set(dn, dd); }
    dd.total++; dd.outstanding += o; if (resolved) { dd.resolved++; dd.recovered += o; } else dd.unresolved++;

    /* Disposition L2 — the same shape as L1, because it answers a different question.
       L1 says the agent logged a "Paid"; L2 says the customer claimed the payment was
       already made, or promised one for later, or disputed the charge. Those three sit
       inside one L1 bucket and recover at wildly different rates, and that difference is
       invisible until you split it. */
    const dn2 = r.disp_l2 || '(Not contacted)';
    let d2 = this.dispL2.get(dn2); if (!d2) { d2 = { total: 0, resolved: 0, unresolved: 0, outstanding: 0, recovered: 0 }; this.dispL2.set(dn2, d2); }
    d2.total++; d2.outstanding += o; if (resolved) { d2.resolved++; d2.recovered += o; } else d2.unresolved++;

    const bk = r.curr_bal_band || 'Unspecified';
    let bb = this.band.get(bk); if (!bb) { bb = { count: 0, resolved: 0, unresolved: 0, outstanding: 0, recovered: 0 }; this.band.set(bk, bb); }
    bb.count++; bb.outstanding += o; if (resolved) { bb.resolved++; bb.recovered += o; } else bb.unresolved++;

    this._geo(this.region, r.region, r, o, resolved);
    this._geo(this.state, r.primary_state, r, o, resolved);

    /* The account's cohort: the day the AI last spoke to it. */
    const day = dayOf(r);
    if (day) {
      let lc = this.lastCall.get(day);
      if (!lc) { lc = { n: 0, res: 0, attempts: 0, connected: 0, outstanding: 0 }; this.lastCall.set(day, lc); }
      lc.n++; lc.attempts += r.ai_attempts; lc.connected += r.ai_connected_calls; lc.outstanding += o;
      if (resolved) lc.res++;
    }

    const db = durBucket(r.ai_connected_seconds);
    let du = this.dur.get(db); if (!du) { du = { n: 0, res: 0, ptp: 0, paid: 0, ref: 0 }; this.dur.set(db, du); }
    du.n++; if (resolved) du.res++; if (U(r.promise_flag) === 'YES') du.ptp++; if (U(r.paid_flag) === 'YES') du.paid++; if (r.refusal_flag === 'YES') du.ref++;
    const duD = bump(du, day, ['n', 'res']);
    if (duD) { duD.n++; if (resolved) duD.res++; }

    /* Duration × Disposition L2. L1 says "Paid"; L2 says WHY, and the two tell very
       different stories about talk time. "Promise to Pay Later" holds the longest
       conversations in the book and resolves worst — a fact that is invisible at L1,
       because L1 lumps it in with everything else the agent scheduled. */
    const l2 = r.disp_l2 || '(No disposition)';
    let dl = this.durL2.get(l2);
    if (!dl) { dl = { n: 0, res: 0, secs: 0, recovered: 0, buckets: new Map() }; this.durL2.set(l2, dl); }
    dl.n++; dl.secs += r.ai_connected_seconds;
    if (resolved) { dl.res++; dl.recovered += o; }
    const dlD = bump(dl, day, ['n', 'res', 'secs', 'recovered']);
    if (dlD) { dlD.n++; dlD.secs += r.ai_connected_seconds; if (resolved) { dlD.res++; dlD.recovered += o; } }
    let bb2 = dl.buckets.get(db);
    if (!bb2) { bb2 = { n: 0, res: 0 }; dl.buckets.set(db, bb2); }
    bb2.n++; if (resolved) bb2.res++;
    const bb2D = bump(bb2, day, ['n', 'res']);
    if (bb2D) { bb2D.n++; if (resolved) bb2D.res++; }

    if (resolved && r.payment_mode && r.payment_mode !== 'NA') {
      let p = this.pm.get(r.payment_mode); if (!p) { p = { payments: 0, amount: 0 }; this.pm.set(r.payment_mode, p); }
      p.payments++; p.amount += o;
    }

    // "Attempted" must mean "we tried to reach this account". Real exports contain rows
    // with connected calls but a zero attempt count; counting only ai_attempts made the
    // funnel WIDEN at the connected stage, which is nonsense on a funnel chart.
    if (r.ai_attempts > 0 || r.ai_connected_calls > 0) { this.fAttempted++; if (resolved) this.rAttempted++; }
    if (r.ai_connected_calls > 0) { this.fConnected++; if (resolved) this.rConnected++; }
    if (r.ai_attempts <= 0 && r.ai_connected_calls > 0) this.dirtyAttempts++;
    if (r.qual_status === 'Qualified') { this.fQualified++; if (resolved) this.rQualified++; }
    if (U(r.promise_flag) === 'YES') this.fPromise++;
    if (U(r.paid_flag) === 'YES') { this.fPaid++; this.paidYes++; if (resolved) this.paidYesRes++; }

    /* Funnel stages 5 and 6 come from Disposition L2 — the AI's own read of what the
       customer actually said, not an entity flag. "Promise to Pay Later" and "Paid" are
       literal L2 values, and they are MUTUALLY EXCLUSIVE (a row has one L2). So they do
       not nest: Paid (1,363) is far larger than Promise to Pay Later (367), and drawing
       them as a narrowing funnel would be a lie. The UI renders them as parallel
       outcomes with a visual break, and each carries its own resolved count — which is
       where the whole story is:

         Promise to Pay Later → 105 of 367 actually resolved  (28.6%)
         Paid                 → 651 of 1,363 actually resolved (47.8%)                */
    if (r.disp_l2 === 'Promise to Pay Later') { this.fPtpLater++; if (resolved) this.rPtpLater++; }
    if (r.disp_l2 === 'Paid') { this.fPaidL2++; if (resolved) this.rPaidL2++; }

    this._pushTop(r, o);

    const ab = attBand(r.ai_attempts);
    let da = this.dial.get(ab); if (!da) { da = { n: 0, connect: 0, resolved: 0 }; this.dial.set(ab, da); }
    da.n++; if (r.ai_connected_calls > 0) da.connect++; if (resolved) da.resolved++;
    const daD = bump(da, day, ['n', 'connect', 'resolved']);
    if (daD) { daD.n++; if (r.ai_connected_calls > 0) daD.connect++; if (resolved) daD.resolved++; }

    if (!resolved) {
      this.openOut += o;
      if (U(r.promise_flag) === 'YES') { this.oppPromise.count++; this.oppPromise.amount += o; this.promisedOpen++; }
      if (r.ai_connected_seconds >= 120) { this.oppEngaged.count++; this.oppEngaged.amount += o; }
      if (U(r.paid_flag) === 'YES') { this.oppClaimed.count++; this.oppClaimed.amount += o; }
    } else if (U(r.paid_flag) === 'NO') this.saidNoRes++;

    /* Attempt & contact intensity, over the WHOLE book — including the accounts that
       were never dialled. Those are the ones a per-lead figure exists to keep honest;
       drop them and "avg 13 attempts per account" quietly becomes "per account we
       happened to ring". */
    const ib = intensityBand(r.ai_attempts);
    let iv = this.intensity.get(ib);
    if (!iv) { iv = { accounts: 0, resolved: 0, attempts: 0 }; this.intensity.set(ib, iv); }
    iv.accounts++; iv.attempts += r.ai_attempts; if (resolved) iv.resolved++;

    const cb = contactBand(r.ai_connected_calls);
    let cv = this.contact.get(cb);
    if (!cv) { cv = { accounts: 0, resolved: 0 }; this.contact.set(cb, cv); }
    cv.accounts++; if (resolved) cv.resolved++;

    // Which cohort worked it (AI-only vs AI + agency). Same shape as the segment map,
    // so the UI can degrade to "one cohort" using the same branch.
    const ak = String(r.ai_agency || '').trim() || 'Unspecified';
    let av = this.agency.get(ak);
    if (!av) { av = { count: 0, resolved: 0, unresolved: 0, outstanding: 0, recovered: 0, attempts: 0, connected: 0 }; this.agency.set(ak, av); }
    av.count++; av.outstanding += o; av.attempts += r.ai_attempts; av.connected += r.ai_connected_calls;
    if (resolved) { av.resolved++; av.recovered += o; } else av.unresolved++;

    this._callLog(r, o, resolved);
  }

  /* ── OUTCOME WINDOW ────────────────────────────────────────────────────────────
   *
   * Did the status file get pulled BEFORE the calls finished?
   *
   * The outcome is a snapshot. The calls are a process that runs for days. Pair a
   * Monday snapshot with a campaign that ran to Thursday and every account still
   * being dialled on Tuesday, Wednesday and Thursday comes back "Unresolved" — not
   * because the customer refused, but because nobody had looked yet. The account is
   * not a failure. It is unmeasured.
   *
   * This is invisible in every headline. It surfaces only where a chart plots
   * resolution against something that correlates with WHEN the account was called —
   * and dial attempts correlate with it almost perfectly, because the dialler stops
   * calling an account once it resolves. So the accounts dialled most are exactly the
   * accounts whose outcome is missing, and the chart draws a clean line to zero.
   *
   * On the 3 July book: 740 accounts, 12,130 dials (30% of the campaign), 1,449
   * connected calls — reading exactly 0.0% resolved, against 18–40% on every other
   * day. The report showed "13+ attempts → 0% resolved" to a bank. That number was
   * arithmetically correct and completely false.
   *
   * The test is simple and needs no knowledge of when the file was pulled: walk back
   * from the last day of calling and mark the trailing run of days on which NOT ONE
   * account resolved. Zero out of 740 is not a bad day. It is a day nobody scored.  */
  _outcomeWindow() {
    const days = [...this.lastCall.keys()].sort();
    if (!days.length) return { hasCallDates: false, blind: [], blindAccounts: 0 };

    const cohorts = days.map((d) => {
      const c = this.lastCall.get(d);
      return { date: d, ...c, resolutionPct: c.n ? c.res / c.n * 100 : 0 };
    });

    const blind = [];
    for (let i = cohorts.length - 1; i >= 0; i--) {
      const c = cohorts[i];
      if (c.res === 0 && c.n >= BLIND_MIN) blind.unshift(c.date); else break;
    }

    /* If EVERY day is blind, nothing resolved anywhere and the status file is simply
       wrong or empty. That is a different failure with a different fix, and quietly
       excluding the entire book to "handle" it would be the worst thing we could do.
       Report it as no blind window and let the zero resolution rate speak. */
    if (blind.length === cohorts.length) {
      return { hasCallDates: true, cohorts, blind: [], blindAccounts: 0, allZero: true };
    }

    const b = new Set(blind);
    const hit = cohorts.filter((c) => b.has(c.date));
    const sum = (f) => hit.reduce((a, c) => a + c[f], 0);
    return {
      hasCallDates: true,
      cohorts,
      blind,
      firstBlindDate: blind[0] || null,
      lastCallDate: days[days.length - 1],
      // The last day on which the outcome file could still see a resolution — i.e.
      // the newest day that is NOT blind. This is our best evidence of when the
      // status file was actually pulled, and it is what the user must beat.
      outcomeSeenTo: blind.length ? cohorts[cohorts.length - blind.length - 1].date : days[days.length - 1],
      blindAccounts: sum('n'),
      blindAttempts: sum('attempts'),
      blindConnected: sum('connected'),
      blindOutstanding: sum('outstanding'),
      measurableAccounts: this.N - sum('n'),
      attemptSharePct: this.attempts ? sum('attempts') / this.attempts * 100 : 0,
    };
  }

  /* ── WHAT THE CALL LOG CANNOT TELL US ─────────────────────────────────────────
   *
   * Shipped IN the payload rather than written into the JSX, because a placeholder that
   * lives in a component is a placeholder somebody deletes in a hurry and replaces with
   * a plausible-looking chart. These four were asked for. None of them is in either
   * file. Saying so, on the page, with the reason, is the deliverable — an empty space
   * where a metric was expected reads as an oversight, and an invented one is worse
   * than both.                                                                       */
  static NOT_MEASURED = [
    {
      key: 'tonality',
      label: 'Tonality / sentiment',
      why: 'The call log has no tone or sentiment column. "Sense Disposition Reason" is a free-text sentence the model wrote about the call, not a score, and scoring it here would be us grading our own conversations with a number we invented.',
      need: 'A per-call sentiment or tone score from the speech pipeline.',
    },
    {
      key: 'cash',
      label: 'Cash actually collected (₹ paid)',
      why: 'Neither file carries an amount paid. Both carry OUTSTANDING. Every "recovered" figure on this report is the full outstanding of an account RBL\'s status file marked Resolved — the standard measure, and not the same thing as cash received in the period.',
      need: 'A payment/receipt feed with an amount and a value date.',
    },
    {
      key: 'agent',
      label: 'Per-agent / per-bot performance',
      why: 'There is no agent identifier. The only per-call handle is the outbound line it was dialled from, and a line is a trunk, not an agent — an account is rung from a dozen different ones. The outbound-line table is labelled as exactly that, and must not be read as "Agent A beat Agent B".',
      need: 'An agent_id or bot_version on the call attempt.',
    },
    {
      key: 'wpc',
      label: 'Wrong-party contact',
      why: 'No WPC flag exists in the export. It could be guessed at from dispositions like "Message to Third Party", but a compliance number that was inferred is a compliance number that will be wrong in front of a regulator.',
      need: 'An explicit right-party / wrong-party outcome on the attempt.',
    },
  ];

  /* Everything the AI call log makes possible, computed from the PER-ACCOUNT fields so
     the whole section re-derives correctly on the Day Total union. */
  _callSection(N, resolved, baseRatePct) {
    const blank = {
      present: false, accounts: 0, byHour: [], bestHours: [], byAttempt: [],
      lines: [], notMeasured: Aggregator.NOT_MEASURED,
    };
    if (!this.logged) return blank;

    /* Hour of day. An hour with a handful of dials in it has a connect rate that is
       noise, and noise sorted descending looks exactly like the best hour of the day —
       so a thin hour is charted but never crowned. */
    const hourAttempts = [...this.hour.values()].reduce((a, h) => a + h.attempts, 0);
    const HOUR_MIN = Math.max(50, Math.round(hourAttempts * 0.02));
    const byHour = [...this.hour.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([hour, h]) => ({
        hour,
        attempts: h.attempts,
        connected: h.connected,
        connectPct: h.attempts ? h.connected / h.attempts * 100 : 0,
        sharePct: hourAttempts ? h.attempts / hourAttempts * 100 : 0,
        thin: h.attempts > 0 && h.attempts < HOUR_MIN,
      }));
    const bestHours = byHour.filter((h) => !h.thin)
      .slice().sort((a, b) => b.connectPct - a.connectPct).slice(0, 3);

    /* Conversion by attempt number. OBSERVED, and labelled as such everywhere it is
       shown. The dialler stops ringing an account once it resolves, so a late attempt
       exists only for accounts that had not paid by then: attempts and outcome are not
       independent, and the falling curve is partly the selection, not the fatigue. We
       describe the shape. We do not claim an optimal cut-off, because this data cannot
       identify one — the same discipline the outcome-window guard already applies. */
    const attNums = [...this.attN.keys()].sort((a, b) => a - b);
    let cum = 0;
    const byAttempt = attNums.map((n) => {
      const e = this.attN.get(n);
      cum += e.firstPaid;
      return {
        attempt: n,
        dialled: e.attempts,
        connected: e.connected,
        connectPct: e.attempts ? e.connected / e.attempts * 100 : 0,
        firstPaid: e.firstPaid,
        firstPaidResolved: e.firstPaidResolved,
        firstPaidPct: e.attempts ? e.firstPaid / e.attempts * 100 : 0,
        cumFirstPaid: cum,
        cumFirstPaidPct: this.firstPaidKnown ? cum / this.firstPaidKnown * 100 : 0,
        thin: e.attempts > 0 && e.attempts < CELL_MIN,
      };
    });
    // Where the curve stops paying for itself: the first attempt by which 90% of all
    // first-payments had already landed. A description of the observed shape, nothing more.
    const flattensAt = byAttempt.find((a) => a.cumFirstPaidPct >= 90)?.attempt ?? null;
    const paidBeyondFlatten = flattensAt === null ? 0
      : byAttempt.filter((a) => a.attempt > flattensAt).reduce((s, a) => s + a.firstPaid, 0);
    const dialsBeyondFlatten = flattensAt === null ? 0
      : byAttempt.filter((a) => a.attempt > flattensAt).reduce((s, a) => s + a.dialled, 0);

    const dialled = this.fAttempted;
    const reached = this.fConnected;
    const humanConnected = Math.max(0, this.connected - this.vmCalls);

    return {
      present: true,
      accounts: this.logged,
      neverDialled: N - dialled,
      /* The curves' own denominator. Equal to intensity.attempts on any book uploaded
         with a call log; smaller only where a Day Total mixes a call-log day with an
         older lead-export day, and then the difference is stated rather than papered over. */
      loggedAttempts: this.logAttempts,
      loggedConnected: this.logConnected,
      attemptsWithoutLog: Math.max(0, this.attempts - this.logAttempts),

      byHour,
      bestHours,

      byAttempt,
      flattensAt,
      paidBeyondFlatten,
      dialsBeyondFlatten,
      firstPaidAccounts: this.firstPaidKnown,
      paidAccounts: this.paidAcc,
      paidResolved: this.paidRes,
      maxAttempt: this.maxAttemptSeen,

      /* 3 — intensity. Both denominators, both named, because "13 attempts per account"
         and "11 attempts per account in the book" are different claims. */
      intensity: {
        book: N,
        dialledAccounts: dialled,
        attempts: this.attempts,
        connected: this.connected,
        avgAttemptsPerBookAccount: N ? this.attempts / N : 0,
        avgAttemptsPerDialled: dialled ? this.attempts / dialled : 0,
        avgConnectedPerBookAccount: N ? this.connected / N : 0,
        avgConnectedPerDialled: dialled ? this.connected / dialled : 0,
        dialsPerConnectedCall: this.connected ? this.attempts / this.connected : 0,
        dialsPerReachedAccount: reached ? this.attempts / reached : 0,
        distribution: INTENSITY_ORDER.filter((b) => this.intensity.get(b)).map((b) => {
          const d = this.intensity.get(b);
          return {
            band: b, accounts: d.accounts, attempts: d.attempts, resolved: d.resolved,
            sharePct: N ? d.accounts / N * 100 : 0,
            resolutionPct: d.accounts ? d.resolved / d.accounts * 100 : 0,
            thin: d.accounts > 0 && d.accounts < CELL_MIN,
          };
        }),
        contactDistribution: CONTACT_ORDER.filter((b) => this.contact.get(b)).map((b) => {
          const d = this.contact.get(b);
          return {
            band: b, accounts: d.accounts, resolved: d.resolved,
            sharePct: N ? d.accounts / N * 100 : 0,
            resolutionPct: d.accounts ? d.resolved / d.accounts * 100 : 0,
            thin: d.accounts > 0 && d.accounts < CELL_MIN,
          };
        }),
      },

      /* 4 — the two rates that both get called "contact rate". Kept side by side with
         their denominators spelled out, exactly as aiReach already does for the older
         pair, because quoting one as the other in front of a bank is not a rounding
         error. */
      rates: {
        attemptPct: this.attempts ? this.connected / this.attempts * 100 : 0,   // per DIAL
        attemptNumerator: this.connected,
        attemptDenominator: this.attempts,
        contactPct: N ? reached / N * 100 : 0,                                   // per LEAD
        contactNumerator: reached,
        contactDenominator: N,
        // …and the same per-lead figure once the answering machines are taken out.
        humanContactPct: N ? this.humanReached / N * 100 : 0,
        humanReached: this.humanReached,
        voicemailCalls: this.vmCalls,
        voicemailPctOfConnected: this.connected ? this.vmCalls / this.connected * 100 : 0,
        humanConnected,
        voicemailMinutes: this.vmSecs / 60,
        talkMinutes: this.secs / 60,
        humanTalkMinutes: Math.max(0, this.secs - this.vmSecs) / 60,
      },

      /* 5 — promise to pay: how many we generated, and how many the BANK later resolved.
         The conversion number comes from the status file. It always does. */
      ptp: {
        accounts: this.ptpAcc,
        resolved: this.ptpRes,
        resolutionPct: this.ptpAcc ? this.ptpRes / this.ptpAcc * 100 : 0,
        outstanding: this.ptpOut,
        recovered: this.ptpRec,
        recoveryPct: this.ptpOut ? this.ptpRec / this.ptpOut * 100 : 0,
        openAmount: this.ptpOut - this.ptpRec,
        sharePct: N ? this.ptpAcc / N * 100 : 0,
        shareOfReachedPct: reached ? this.ptpAcc / reached * 100 : 0,
        baseResolutionPct: baseRatePct,
        liftPts: this.ptpAcc ? (this.ptpRes / this.ptpAcc * 100) - baseRatePct : 0,
        thin: this.ptpAcc > 0 && this.ptpAcc < CELL_MIN,
      },

      /* 6 — complaints. A compliance figure, so it is a COUNT first and a rate second,
         and its denominator is the book the bank gave us. */
      complaints: {
        accounts: this.cmpAcc,
        ratePct: N ? this.cmpAcc / N * 100 : 0,
        ofReachedPct: reached ? this.cmpAcc / reached * 100 : 0,
        resolved: this.cmpRes,
        resolutionPct: this.cmpAcc ? this.cmpRes / this.cmpAcc * 100 : 0,
        outstanding: this.cmpOut,
        alsoDnc: this.dncCmp,
      },

      /* 7 — DNC, and the check that matters: did we ring them again afterwards?
         Not "how many said do not call" — anyone can count that. The number a
         compliance officer asks for is how many we called AFTER they said it. */
      dnc: {
        accounts: this.dncAcc,
        ratePct: N ? this.dncAcc / N * 100 : 0,
        resolved: this.dncRes,
        redialledAccounts: this.dncRedial,
        redialledPct: this.dncAcc ? this.dncRedial / this.dncAcc * 100 : 0,
        redialledDials: this.dncRedialDials,
        maxDialsAfter: this.dncMaxAfter,
        alsoComplaint: this.dncCmp,
        refusedAccounts: this.refAcc,
        refusedResolved: this.refRes,
      },

      /* The outbound trunks. NOT agents — see NOT_MEASURED.agent. Last four digits only:
         these are Convin's own lines, and even so a full phone number has no business in
         a document that gets forwarded. */
      lines: [...this.line.entries()]
        .map(([line, v]) => ({
          line, attempts: v.attempts, connected: v.connected,
          connectPct: v.attempts ? v.connected / v.attempts * 100 : 0,
          sharePct: this.attempts ? v.attempts / this.attempts * 100 : 0,
        }))
        .sort((a, b) => b.attempts - a.attempts),

      notMeasured: Aggregator.NOT_MEASURED,
    };
  }

  payload(reportDateDisplay, sources = null) {
    const N = this.N, resolved = this.res, unres = N - resolved;
    /* Computed FIRST: three charts below refuse to be drawn over unmeasured accounts. */
    const outcomeWindow = this._outcomeWindow();
    const BLIND = outcomeWindow.blind || [];
    const totals = {
      accounts: N, resolved, unresolved: unres, sumOut: this.sumOut, recovered: this.recovered,
      outstandingPending: this.sumOut - this.recovered,
      recoveryRatePct: this.sumOut ? this.recovered / this.sumOut * 100 : 0,
      resolutionRatePct: N ? resolved / N * 100 : 0,
      sumMinDue: this.sumMinDue, avgOutstanding: N ? this.sumOut / N : 0,
      avgRecoveryPerResolved: resolved ? this.recovered / resolved : 0,
      /* "States covered". The card used to render state.length, and _geo() files every
         account with a blank state under "Unspecified" — so the blank bucket was being
         counted as a state. On the 3 July book, 10 accounts carry no state and the card
         proudly read 21. There are 20. A bank will check that one. */
      statesCovered: [...this.state.keys()].filter((s) => s !== 'Unspecified').length,
      statesUnspecified: this.state.get('Unspecified')?.count || 0,
    };
    const ai = {
      attempts: this.attempts, connected: this.connected, notConnected: this.attempts - this.connected,
      // Denominator guards against a dirty export where connected > attempts, which
      // would otherwise report a >100% connect rate (or 0% while showing connections).
      connectRatePct: Math.max(this.attempts, this.connected)
        ? this.connected / Math.max(this.attempts, this.connected) * 100 : 0,
      talkMinutes: this.secs / 60,
      avgAttempts: N ? this.attempts / N : 0, avgConnectedSec: this.connected ? this.secs / this.connected : 0,
    };

    /* ── AI REACH: connection rate at the LEAD level ──────────────────────────────
       Two completely different numbers get called "connection rate", and saying the
       wrong one to a bank is the kind of mistake you do not recover from:

         CALL-level  = connected CALLS ÷ call ATTEMPTS.  How well the dialler performs.
                       One customer who never picks up drags this down forty times.
         LEAD-level  = customers REACHED ÷ customers in the book. How much of RBL's
                       book we actually got a human voice on. This is the one an exec
                       means, and the one this block computes.

       They are not interchangeable and they are not close. Both are shown, each with
       its own denominator spelled out, so nobody can quote one as the other.

       The last two figures are the point of the whole exercise: an account we reached
       resolves at a completely different rate from one we never got hold of. */
    const leadsConnected = this.fConnected;
    const leadsNotConnected = N - this.fConnected;
    const resolvedConnected = this.rConnected;
    const resolvedNotConnected = resolved - this.rConnected;
    const aiReach = {
      totalLeads: N,
      leadsAttempted: this.fAttempted,
      leadsConnected,
      leadsNotConnected,
      // The headline: of every lead RBL gave us, how many did we get a human voice on?
      connectionRatePct: N ? leadsConnected / N * 100 : 0,
      // Of the ones we actually dialled (in case some were never attempted at all).
      connectionRateOfAttemptedPct: this.fAttempted ? leadsConnected / this.fAttempted * 100 : 0,
      neverAttempted: N - this.fAttempted,

      // Call-level, kept beside it so the two can never be confused.
      callAttempts: this.attempts,
      callsConnected: this.connected,
      callConnectRatePct: ai.connectRatePct,
      avgAttemptsPerLead: N ? this.attempts / N : 0,
      avgAttemptsToConnect: leadsConnected ? this.attempts / leadsConnected : 0,

      // What reaching a customer was actually worth.
      resolvedConnected,
      resolvedNotConnected,
      resolutionConnectedPct: leadsConnected ? resolvedConnected / leadsConnected * 100 : 0,
      resolutionNotConnectedPct: leadsNotConnected ? resolvedNotConnected / leadsNotConnected * 100 : 0,
    };
    const dispositionL2 = [...this.dispL2.entries()]
      .map(([name, v]) => ({
        name, ...v,
        resolutionPct: v.total ? v.resolved / v.total * 100 : 0,
        recoveryPct: v.outstanding ? v.recovered / v.outstanding * 100 : 0,
      }))
      .sort((a, b) => b.recovered - a.recovered);

    const disposition = [...this.disp.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.recovered - a.recovered);
    /* Balance bands. THIS USED TO SILENTLY LOSE ACCOUNTS: the chart was built by
       looping over our hardcoded BAND_ORDER, so any band RBL happens to label
       differently ("5-20K", a renamed segment, a blank) was dropped on the floor —
       the chart simply didn't add up to the book, and nothing said so. Now we emit
       every band we actually saw, ordered by BAND_ORDER first and anything new after. */
    const seenBands = [...this.band.keys()];
    const bandOrder = [
      ...BAND_ORDER.filter((b) => this.band.has(b)),
      ...seenBands.filter((b) => !BAND_ORDER.includes(b)).sort(),
    ];
    const band = {};
    for (const b of bandOrder) {
      const d = this.band.get(b);
      band[b] = { ...d, resolutionPct: d.count ? d.resolved / d.count * 100 : 0 };
    }
    const unknownBands = seenBands.filter((b) => !BAND_ORDER.includes(b));

    /* RBL's own segment breakdown. The exec asked to SEE this, not just have the
       model consume it. Sorted by size, resolution rate computed per segment. */
    const segments = [...this.seg.entries()]
      .map(([name, v]) => ({
        name, ...v,
        resolutionPct: v.count ? v.resolved / v.count * 100 : 0,
        recoveryPct: v.outstanding ? v.recovered / v.outstanding * 100 : 0,
      }))
      .sort((a, b) => b.count - a.count);
    const geoOut = (map) => { const o = {}; for (const [k, e] of map) o[k] = { ...e, resolutionPct: e.count ? e.resolved / e.count * 100 : 0, connectPct: e.attempts ? e.connected / e.attempts * 100 : 0 }; return o; };
    const region = geoOut(this.region);
    const state = Object.entries(geoOut(this.state)).map(([s, v]) => ({ state: s, ...v })).sort((a, b) => b.outstanding - a.outstanding);
    /* ── Duration, dial efficiency, duration×L2 ────────────────────────────────────
       These three plot resolution AGAINST CALL BEHAVIOUR, which is precisely where an
       unmeasured cohort does its damage (see _outcomeWindow). An account whose outcome
       had not been recorded yet contributes a guaranteed zero, and it contributes it
       to the buckets it was dialled hardest into. Left in, it does not add noise — it
       adds bias, all in one direction, to the exact cells an exec reads causally.

       So when a blind window exists, these charts are computed over the MEASURABLE
       accounts only, and say so. Every other chart — the book, the money, the bands,
       the regions, the dispositions — stays on the full book, because those are RBL's
       own figures as RBL reported them and it is not our place to restate them. */
    const duration = DUR_ORDER.filter((b) => this.dur.get(b)).map((b) => {
      const d = this.dur.get(b);
      const m = netOf(d, d.byDate, BLIND, ['n', 'res', 'ptp', 'paid', 'ref']);
      return {
        bucket: b, n: m.n, nAll: d.n, excluded: d.n - m.n,
        thin: m.n > 0 && m.n < CELL_MIN,
        resolutionPct: m.n ? m.res / m.n * 100 : 0,
        ptpPct: m.n ? m.ptp / m.n * 100 : 0,
        paidPct: m.n ? m.paid / m.n * 100 : 0,
        refusalPct: m.n ? m.ref / m.n * 100 : 0,
      };
    }).filter((d) => d.n > 0);
    /* Duration × Disposition L2 cross-tab. Only dispositions with enough accounts to
       mean anything: a 100% resolution rate on 2 accounts is not an insight, it is a
       rounding error, and putting it top of a chart would get us laughed at. */
    const L2_MIN = 20;
    const durL2Net = [...this.durL2.entries()]
      .map(([name, v]) => [name, v, netOf(v, v.byDate, BLIND, ['n', 'res', 'secs', 'recovered'])]);
    const durationByL2 = durL2Net
      .filter(([, , m]) => m.n >= L2_MIN)
      .map(([name, v, m]) => ({
        name,
        n: m.n,
        nAll: v.n,
        excluded: v.n - m.n,
        resolutionPct: m.n ? m.res / m.n * 100 : 0,
        avgSeconds: m.n ? m.secs / m.n : 0,
        recovered: m.recovered,
        buckets: DUR_ORDER.map((b) => {
          const d = v.buckets.get(b);
          if (!d) return { bucket: b, n: 0, resolutionPct: null };
          const c = netOf(d, d.byDate, BLIND, ['n', 'res']);
          return { bucket: b, n: c.n, resolutionPct: c.n ? c.res / c.n * 100 : null };
        }),
      }))
      .sort((a, b) => b.n - a.n);
    // Everything we filtered out, counted honestly rather than silently dropped.
    const l2BelowThreshold = durL2Net.filter(([, , m]) => m.n < L2_MIN).reduce((a, [, , m]) => a + m.n, 0);

    const paymentModes = [...this.pm.entries()].map(([mode, v]) => ({ mode, ...v })).sort((a, b) => b.amount - a.amount);
    /* The Complete Collection Funnel.
       `kind` splits it in two, because the second half is not a funnel:
         journey  — each stage is a strict SUBSET of the one above it. It narrows.
         outcome  — mutually-exclusive L2 dispositions. They do NOT nest, and Paid is
                    four times the size of Promise to Pay Later. Drawing these as one
                    continuous narrowing funnel would be a lie an analyst spots in
                    ten seconds. The UI breaks them apart and says so. */
    const stage = (n, label, value, res, kind, note) => ({
      n, stage: label, value, resolved: res,
      pctOfBook: N ? value / N * 100 : 0,
      resolutionPct: value ? res / value * 100 : 0,
      kind, note,
    });
    const funnel = [
      stage(1, 'Total Accounts', N, resolved, 'journey', 'Every account in RBL\'s CYC book'),
      /* "Leads", not "Calls" — because these are ACCOUNT counts (7,042 and 3,429), not
         call counts (39,905 and 6,710). The old labels said Calls while the bars showed
         leads, which invited an exec to read the funnel as a dialler report. */
      stage(2, 'Total Leads Attempted', this.fAttempted, this.rAttempted, 'journey', 'The AI dialled these'),
      /* "Connected" is the call log's own definition: the attempt has an Answered
         Timestamp. On the real export 29.8% of those answers are VOICEMAIL — a machine
         picked up, which is a connect and is not a conversation. The note used to read
         "a human actually picked up", and with a per-attempt file in hand that is now a
         claim we can check and it is not quite true. The human-only figure is on the
         contact-rate card; this stage stays on the file's definition so it agrees with
         every other connect number on the page. */
      stage(3, 'Total Leads Connected', this.fConnected, this.rConnected, 'journey', 'The call was answered — includes voicemail; see the contact-rate card for the human-only split'),
      stage(4, 'Promise to Pay Later', this.fPtpLater, this.rPtpLater, 'outcome', 'Disposition L2 — the customer committed to pay later'),
      stage(5, 'Paid', this.fPaidL2, this.rPaidL2, 'outcome', 'Disposition L2 — the customer said the payment was made'),
      stage(6, 'Resolved Customers', resolved, resolved, 'outcome', 'RBL\'s own status file — the only outcome we did not write'),
    ];
    /* `ref` — a masked account, never a name. See _pushTop(). */
    const topOutstanding = this.top.map((t) => ({ ref: t.ref, outstanding: t.o, state: t.state, connected: t.connected, ptp: t.ptp, status: t.status }));

    /* ── Fit RoshRegression on THIS batch's own outcomes ────────────────────── */
    const baseRate = N ? resolved / N : 0;
    const cuts = tierCuts(baseRate);

    /* Everything the per-attempt call log unlocks. Computed here, from per-account
       fields, so it re-derives on the Day Total union rather than being carried over. */
    const callLog = this._callSection(N, resolved, baseRate * 100);

    /* AI-only vs AI + agency. Identical shape to `segments`, so the UI can share the
       "one cohort — nothing to compare" branch rather than grow a second one. */
    const cohorts = [...this.agency.entries()]
      .map(([name, v]) => ({
        name, ...v,
        resolutionPct: v.count ? v.resolved / v.count * 100 : 0,
        recoveryPct: v.outstanding ? v.recovered / v.outstanding * 100 : 0,
        connectPct: v.attempts ? v.connected / v.attempts * 100 : 0,
        avgAttempts: v.count ? v.attempts / v.count : 0,
      }))
      .sort((a, b) => b.count - a.count);

    /* The categorical vocabulary is discovered HERE, not hardcoded — we only know
       which segments and scores a book contains once the whole book has gone past.
       A constant column (today: segment = Red on every row) yields no columns at
       all, so the model neither learns from it nor pretends to. */
    const spec = buildCategoricalSpec(this.cats);
    const XF = spec.length ? this.X.map((x, i) => [...x, ...encodeCategorical(this.cats[i], spec)]) : this.X;
    const openXF = spec.length ? this.openX.map((x, i) => [...x, ...encodeCategorical(this.openCats[i], spec)]) : this.openX;
    const featNames = featureNamesWith(spec);

    const fitted = trainPropensity(XF, this.Y, featNames);
    if (fitted) {
      for (let i = 0; i < openXF.length; i++) {
        const p = score(fitted.model, openXF[i]);
        const tier = p >= cuts.high ? 'High' : p >= cuts.medium ? 'Medium' : 'Low';
        this.tiers[tier].count++;
        this.tiers[tier].amount += this.openAmt[i];
      }
    }
    // Shown on the dashboard: observed lift (marginal, verifiable), not the
    // regression's conditional coefficients — see computeLifts() for why.
    const lifts = XF.length ? computeLifts(XF, this.Y, 30, featNames).slice(0, 6) : [];
    const model = fitted
      ? {
        name: MODEL_NAME,
        version: MODEL_VERSION,
        trained: true,
        auc: fitted.auc,
        trainedOn: fitted.trainedOn,
        testedOn: fitted.testedOn,
        lifts,
        // What the model discovered in THIS book, beyond its fixed 14 inputs.
        features: featNames.length,
        discovered: spec.map((c) => ({ field: c.field, value: c.value, name: c.name, n: c.n })),
        thresholds: { high: cuts.high, medium: cuts.medium, baseRate },
        method: `${MODEL_NAME} v${MODEL_VERSION} — a regularised logistic regression refitted on this report, with 20% of accounts held back to measure the AUC out-of-sample. Tier cut-offs come from this book's own base recovery rate, not a preset.`,
      }
      : {
        name: MODEL_NAME,
        version: MODEL_VERSION,
        trained: false,
        auc: null,
        lifts,
        method: `Not enough resolved/unresolved accounts in this report for ${MODEL_NAME} to fit.`,
      };

    /* ── Value framing for RBL. Convin's own cost is never computed or sent. ── */
    const agencyCost = this.recovered * AGENCY_PCT / 100;
    const roi = {
      agencyPct: AGENCY_PCT,
      agencyCostInr: agencyCost,          // what a recovery agency would bill RBL for this result
      projectedAnnualRecovery: this.recovered * CYCLES_PER_YEAR * CYCLE_DECAY,
      assumptions: { agencyPct: AGENCY_PCT, cyclesPerYear: CYCLES_PER_YEAR, cycleDecay: CYCLE_DECAY },
    };
    /* `ranked` is the honest flag. When RoshRegression cannot fit — too few accounts,
       or every account in the book landed on the same outcome — the tiers stayed at
       zero and the dashboard cheerfully rendered "High ₹0 · Medium ₹0 · Low ₹0" next
       to a multi-crore open book. It looked like the model had ranked the book and
       found nothing worth calling. It hadn't run at all. The UI now says so. */
    const opportunity = { openOutstanding: this.openOut, ranked: !!fitted, tiers: this.tiers, lists: [
      { label: 'Promised to pay — still open', note: 'Broken-promise follow-ups', ...this.oppPromise },
      { label: 'Engaged ≥2 min — not closed', note: 'Highest propensity', ...this.oppEngaged },
      { label: 'Claimed paid — unresolved', note: 'Reconciliation / verification', ...this.oppClaimed },
    ] };
    const entityTruth = { alreadyPaidReliabilityPct: this.paidYes ? this.paidYesRes / this.paidYes * 100 : 0, saidNoButResolved: this.saidNoRes, promisedButOpen: this.promisedOpen };
    /* Dial efficiency. THE chart the blind window destroys — see _outcomeWindow().
       Netting the unmeasured days out is not a cosmetic fix: on the 3 July book the
       "13+ attempts" band drops from 732 accounts to 6, which is the honest answer.
       We cannot say anything about heavily-dialled accounts from a status file that
       predates the dialling, and a bar that says so is worth more than a bar that
       says 0%. `thin` tells the UI to print the count instead of a percentage. */
    const dial = ATT_ORDER.filter((b) => this.dial.get(b)).map((b) => {
      const d = this.dial.get(b);
      const m = netOf(d, d.byDate, BLIND, ['n', 'connect', 'resolved']);
      return {
        band: b, n: m.n, nAll: d.n, excluded: d.n - m.n,
        thin: m.n > 0 && m.n < CELL_MIN,
        connectPct: m.n ? m.connect / m.n * 100 : 0,
        resolutionPct: m.n ? m.resolved / m.n * 100 : 0,
      };
    }).filter((d) => d.n > 0);
    /* ── The narrative. Derived from the model's own findings, never asserted. ───
       This paragraph used to hardcode its claims ("longer conversations convert far
       better", "promised to pay — a clear next-cycle target") and merely slot the
       numbers in. On a book where those things are NOT true, the dashboard confidently
       said something false — and worse, it contradicted the model card directly below
       it, which was calling promises a trap. A client reading both would catch us.
       So every claim below is now conditional on the measured lift.               */
    const liftOf = (name) => {
      const l = model.lifts.find((x) => x.name === name);
      return l ? l.liftPts : null;
    };
    const MATERIAL = 5;   // below ~5 points a "signal" is not worth a sentence

    // "past two minutes" must mean past two minutes — not the max of any bucket.
    const longBuckets = duration.filter((d) => d.bucket === '2–5 min' || d.bucket === '>5 min');
    const longN = longBuckets.reduce((a, d) => a + d.n, 0);
    const longRes = longN ? longBuckets.reduce((a, d) => a + d.resolutionPct * d.n, 0) / longN : 0;
    const baseRatePct = baseRate * 100;

    // Three tiers, because "conversation length is doing the work" is a big claim and
    // a 6-point gap does not earn it. The adjective has to be sized to the evidence.
    const STRONG = 12;
    const talkLift = liftOf('Talked 2+ minutes');
    const talkSentence = talkLift === null || longN === 0 ? ''
      : talkLift >= STRONG
        ? ` Conversation length is doing the work: accounts talked past two minutes resolved ${longRes.toFixed(0)}% of the time, against ${baseRatePct.toFixed(0)}% for the book.`
        : talkLift >= MATERIAL
          ? ` Longer conversations help, modestly: ${longRes.toFixed(0)}% past two minutes against ${baseRatePct.toFixed(0)}% for the book.`
          : talkLift <= -MATERIAL
            ? ` Notably, longer conversations did NOT convert on this book (${longRes.toFixed(0)}% past two minutes, below the ${baseRatePct.toFixed(0)}% book average) — worth investigating.`
            : ` Conversation length made little difference on this book (${longRes.toFixed(0)}% past two minutes vs ${baseRatePct.toFixed(0)}% overall).`;

    // The promise book: a target only if promises actually predict payment HERE.
    const promiseLift = liftOf('Promised to pay');
    const promiseSentence = this.oppPromise.amount <= 0 || promiseLift === null ? ''
      : promiseLift <= -MATERIAL
        ? ` ${cr(this.oppPromise.amount)} sits with customers who promised to pay — but on this book a promise is a *worse* signal than silence (${(baseRatePct + promiseLift).toFixed(0)}% resolved vs ${baseRatePct.toFixed(0)}% overall), so it should not be worked first.`
        : promiseLift >= MATERIAL
          ? ` ${cr(this.oppPromise.amount)} sits with customers who promised to pay, and on this book that promise holds (${(baseRatePct + promiseLift).toFixed(0)}% resolved vs ${baseRatePct.toFixed(0)}% overall) — work it first.`
          : ` ${cr(this.oppPromise.amount)} sits with customers who promised to pay, though a promise carries little signal on this book.`;

    const engagedSentence = this.oppEngaged.amount > 0
      ? ` ${cr(this.oppEngaged.amount)} sits with accounts the AI genuinely engaged.` : '';

    const dealCase =
      `Convin's AI worked ${N.toLocaleString('en-IN')} RBL accounts carrying ${cr(this.sumOut)} in outstanding and recovered ${cr(this.recovered)} — ${totals.recoveryRatePct.toFixed(1)}% of the book — by resolving ${resolved.toLocaleString('en-IN')} accounts. `
      + `It placed ${this.attempts.toLocaleString('en-IN')} calls, and its 'already-paid' read matched the true outcome ${entityTruth.alreadyPaidReliabilityPct.toFixed(0)}% of the time.`
      + talkSentence
      + ` ${cr(this.openOut)} remains open.`
      + promiseSentence
      + engagedSentence
      + (model.trained ? ` ${model.name} has ranked every open account by how likely it is to pay.` : '')
      + ` A recovery agency would have billed roughly ${cr(agencyCost)} in commission for the same result.`;

    return {
      version: PAYLOAD_VERSION,
      /* `sources` — WHICH FILES PRODUCED THESE NUMBERS.
         The resolution rate is not a property of the book; it is a property of the book
         AND the status file it was scored against. The same 3 July CYC book scored against
         a 4 July status file resolves 1,751 accounts (₹13.12 Cr); against a 7 July status
         file it resolves 4,206 (₹31.93 Cr). Both are correct. They are 19 crore apart.

         The ingest route already knew every filename — and threw all but the primary away.
         So the report carried a headline number with no way, from the report itself, to say
         which file made it. Six weeks later nobody can reconstruct it, and if the bank
         re-runs it against a different status pull and gets a different answer, that is a
         very bad meeting. The filenames ship with the payload now, and print on the cover. */
      /* cycFile is deliberately its OWN meta field rather than something the UI digs
         out of `sources` — because sanitizeForShare() blanks `sources` before a report
         goes to RBL, and the CYC filename is the one piece of provenance that is meant
         to survive that. It is the bank's own file name; naming it is what lets anyone
         reading the report tie a number back to an exact book. */
      meta: {
        reportDate: reportDateDisplay,
        accounts: N,
        source: 'Convin AI Collections — RBL Bank',
        cycFile: (sources || []).find((s) => s.detected === 'cyc')?.name
          || (sources || []).find((s) => /primary/i.test(s.slot || ''))?.name || '',
        sources: sources || [],
      },
      agg: { totals, ai, aiReach, entity: this.entity, disposition, dispositionL2, band, bandOrder, segments, cohorts, region, state, duration, durationOrder: DUR_ORDER, durationByL2, l2BelowThreshold, l2Min: L2_MIN, paymentModes, funnel, topOutstanding, outcomeWindow, callLog },
      // Data-quality notes surfaced to the UI rather than swallowed. A bank would
      // rather be told its export is odd than see a chart quietly disagree with itself.
      quality: {
        unknownBands,
        dirtyAttemptRows: this.dirtyAttempts,
        modelFitted: !!fitted,
      },
      intel: { dealCase, roi, opportunity, entityTruth, dial, model },
    };
  }
}
