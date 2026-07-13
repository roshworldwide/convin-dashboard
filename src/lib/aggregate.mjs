// Single-pass aggregator: feed it canonical rows, get the {meta, agg, intel}
// payload the dashboard renders. O(rows) memory-light — safe for 1M+ rows.
// Mirrors generate_convin_data.py exactly (Resolved => full outstanding recovered).

import { BAND_ORDER, isResolved } from './normalize.mjs';
import { PAYLOAD_VERSION } from './payload_version.mjs';
import {
  featurize, trainPropensity, score, computeLifts,
  buildCategoricalSpec, encodeCategorical, featureNamesWith,
  MODEL_NAME, MODEL_VERSION,
} from './model.mjs';

const DUR_ORDER = ['Not connected', '<30s', '30–60s', '1–2 min', '2–5 min', '>5 min'];
const ATT_ORDER = ['1–3', '4–6', '7–9', '10–12', '13+'];
const durBucket = (s) => (s <= 0 ? 'Not connected' : s < 30 ? '<30s' : s < 60 ? '30–60s' : s < 120 ? '1–2 min' : s < 300 ? '2–5 min' : '>5 min');
const attBand = (a) => (a <= 3 ? '1–3' : a <= 6 ? '4–6' : a <= 9 ? '7–9' : a <= 12 ? '10–12' : '13+');
const U = (x) => String(x ?? '').trim().toUpperCase();
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
  _pushTop(r, o) {
    const t = this.top;
    if (t.length >= 20 && o <= t[t.length - 1].o) return;
    const item = { o, name: r.customer_name, state: r.primary_state || '—', connected: r.ai_connected_calls, ptp: U(r.promise_flag) === 'YES', status: r.status };
    let i = t.length; while (i > 0 && t[i - 1].o < o) i--;
    t.splice(i, 0, item); if (t.length > 20) t.length = 20;
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

    const db = durBucket(r.ai_connected_seconds);
    let du = this.dur.get(db); if (!du) { du = { n: 0, res: 0, ptp: 0, paid: 0, ref: 0 }; this.dur.set(db, du); }
    du.n++; if (resolved) du.res++; if (U(r.promise_flag) === 'YES') du.ptp++; if (U(r.paid_flag) === 'YES') du.paid++; if (r.refusal_flag === 'YES') du.ref++;

    /* Duration × Disposition L2. L1 says "Paid"; L2 says WHY, and the two tell very
       different stories about talk time. "Promise to Pay Later" holds the longest
       conversations in the book and resolves worst — a fact that is invisible at L1,
       because L1 lumps it in with everything else the agent scheduled. */
    const l2 = r.disp_l2 || '(No disposition)';
    let dl = this.durL2.get(l2);
    if (!dl) { dl = { n: 0, res: 0, secs: 0, recovered: 0, buckets: new Map() }; this.durL2.set(l2, dl); }
    dl.n++; dl.secs += r.ai_connected_seconds;
    if (resolved) { dl.res++; dl.recovered += o; }
    let bb2 = dl.buckets.get(db);
    if (!bb2) { bb2 = { n: 0, res: 0 }; dl.buckets.set(db, bb2); }
    bb2.n++; if (resolved) bb2.res++;

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

    if (!resolved) {
      this.openOut += o;
      if (U(r.promise_flag) === 'YES') { this.oppPromise.count++; this.oppPromise.amount += o; this.promisedOpen++; }
      if (r.ai_connected_seconds >= 120) { this.oppEngaged.count++; this.oppEngaged.amount += o; }
      if (U(r.paid_flag) === 'YES') { this.oppClaimed.count++; this.oppClaimed.amount += o; }
    } else if (U(r.paid_flag) === 'NO') this.saidNoRes++;
  }

  payload(reportDateDisplay, sources = null) {
    const N = this.N, resolved = this.res, unres = N - resolved;
    const totals = {
      accounts: N, resolved, unresolved: unres, sumOut: this.sumOut, recovered: this.recovered,
      outstandingPending: this.sumOut - this.recovered,
      recoveryRatePct: this.sumOut ? this.recovered / this.sumOut * 100 : 0,
      resolutionRatePct: N ? resolved / N * 100 : 0,
      sumMinDue: this.sumMinDue, avgOutstanding: N ? this.sumOut / N : 0,
      avgRecoveryPerResolved: resolved ? this.recovered / resolved : 0,
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
    const duration = DUR_ORDER.filter((b) => this.dur.get(b)).map((b) => { const d = this.dur.get(b); return { bucket: b, n: d.n, resolutionPct: d.res / d.n * 100, ptpPct: d.ptp / d.n * 100, paidPct: d.paid / d.n * 100, refusalPct: d.ref / d.n * 100 }; });
    /* Duration × Disposition L2 cross-tab. Only dispositions with enough accounts to
       mean anything: a 100% resolution rate on 2 accounts is not an insight, it is a
       rounding error, and putting it top of a chart would get us laughed at. */
    const L2_MIN = 20;
    const durationByL2 = [...this.durL2.entries()]
      .filter(([, v]) => v.n >= L2_MIN)
      .map(([name, v]) => ({
        name,
        n: v.n,
        resolutionPct: v.n ? v.res / v.n * 100 : 0,
        avgSeconds: v.n ? v.secs / v.n : 0,
        recovered: v.recovered,
        buckets: DUR_ORDER.map((b) => {
          const d = v.buckets.get(b);
          return { bucket: b, n: d ? d.n : 0, resolutionPct: d && d.n ? d.res / d.n * 100 : null };
        }),
      }))
      .sort((a, b) => b.n - a.n);
    // Everything we filtered out, counted honestly rather than silently dropped.
    const l2BelowThreshold = [...this.durL2.values()].filter((v) => v.n < L2_MIN).reduce((a, v) => a + v.n, 0);

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
      stage(2, 'AI Calls Attempted', this.fAttempted, this.rAttempted, 'journey', 'The AI dialled these'),
      stage(3, 'AI Calls Connected', this.fConnected, this.rConnected, 'journey', 'A human actually picked up'),
      stage(4, 'Promise to Pay Later', this.fPtpLater, this.rPtpLater, 'outcome', 'Disposition L2 — the customer committed to pay later'),
      stage(5, 'Paid', this.fPaidL2, this.rPaidL2, 'outcome', 'Disposition L2 — the customer said the payment was made'),
      stage(6, 'Resolved Customers', resolved, resolved, 'outcome', 'RBL\'s own status file — the only outcome we did not write'),
    ];
    const topOutstanding = this.top.map((t) => ({ name: t.name, outstanding: t.o, state: t.state, connected: t.connected, ptp: t.ptp, status: t.status }));

    /* ── Fit RoshRegression on THIS batch's own outcomes ────────────────────── */
    const baseRate = N ? resolved / N : 0;
    const cuts = tierCuts(baseRate);

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
    const dial = ATT_ORDER.filter((b) => this.dial.get(b)).map((b) => { const d = this.dial.get(b); return { band: b, n: d.n, connectPct: d.connect / d.n * 100, resolutionPct: d.resolved / d.n * 100 }; });
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
      meta: { reportDate: reportDateDisplay, accounts: N, source: 'Convin AI Collections — RBL Bank', sources: sources || [] },
      agg: { totals, ai, aiReach, entity: this.entity, disposition, dispositionL2, band, bandOrder, segments, region, state, duration, durationOrder: DUR_ORDER, durationByL2, l2BelowThreshold, l2Min: L2_MIN, paymentModes, funnel, topOutstanding },
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
