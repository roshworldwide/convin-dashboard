// Canonical normalization for the Convin collections data.
// Works on a RECORD MAP (raw header -> value) so a row can be assembled from
// several sheets (status sheet + portfolio/base sheet) before normalizing.

export const BAND_ORDER = ['<20K', '20-30K', '30-50K', '50-70K', '70-100K', '100-200K', '>200K'];

export const num = (x) => {
  const n = parseFloat(String(x ?? '').replace(/[, ₹]/g, '').trim());
  return Number.isFinite(n) ? n : 0;
};
const U = (x) => String(x ?? '').trim().toUpperCase();

/** A timestamp -> the calendar date it fell on, as "YYYY-MM-DD". Nothing else.
 *  We only ever compare call dates to each other and group by them, so the clock
 *  time is noise, and parsing it would drag timezones into a question that does not
 *  have one. Accepts "2026-07-07 18:59:09", "2026-07-07T18:59:09Z", "07/07/2026",
 *  and a real Date (SheetJS hands those back for date-typed cells). */
export const dateOnly = (v) => {
  if (v instanceof Date && !Number.isNaN(v.valueOf())) {
    const p = (n) => String(n).padStart(2, '0');
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  const s = String(v ?? '').trim();
  if (!s) return '';
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);            // 2026-07-07 …
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);  // 07/07/2026 (D/M/Y)
  if (dmy) return `${dmy[3]}-${String(dmy[2]).padStart(2, '0')}-${String(dmy[1]).padStart(2, '0')}`;
  return '';                                                   // unparseable -> absent, never a guess
};

export const bandNorm = (b) => String(b ?? '').trim().toUpperCase().replace(/\s/g, '');

/* Column headers arrive with punctuation and casing we cannot predict — a CYC export
   heads its key "Account No#", a status file heads it "account_no", another "ACCOUNT NO".
   Canonicalise to bare lowercase alphanumerics so an alias matches its column regardless
   of decoration. Without this, a header that is off by a single "#" is treated as a
   different column entirely — the CYC key goes unread and the whole file joins to nothing. */
export const canonHeader = (h) => String(h ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
export const entityNorm = (v) => {
  const s = String(v ?? '').trim();
  if (s === '') return 'Blank';
  if (s.toUpperCase() === 'NA') return 'N/A';
  if (s.toUpperCase() === 'YES') return 'YES';
  if (s.toUpperCase() === 'NO') return 'NO';
  return s;
};
export const refusalBucket = (v) => {
  const s = String(v ?? '').trim();
  if (s === '') return 'Blank';
  if (s.toUpperCase() === 'NA') return 'N/A';
  if (s.toUpperCase() === 'NO') return 'NO';
  return 'YES';
};
export const payBucket = (v) => {
  const s = String(v ?? '').trim().toLowerCase();
  if (s === '' || s === 'na') return null;
  if (s.includes('phonepe')) return 'PhonePe';
  if (s.includes('gpay') || s.includes('google') || s.includes('g pay')) return 'Google Pay';
  if (s.includes('paytm')) return 'Paytm';
  if (s.includes('rbl')) return 'RBL App';
  if (s.includes('upi')) return 'UPI';
  if (s.includes('neft') || s.includes('imps') || s.includes('net') || s.includes('online') || s.includes('netbank')) return 'Net/Online';
  if (s.includes('credit card') || s.includes('debit') || s.includes('card')) return 'Card';
  if (s.includes('app')) return 'RBL App';
  if (s.includes('phone') || s.includes('call')) return 'Net/Online';
  return 'Other';
};

/* Canonical key -> accepted raw header names, in priority order.
   This is what lets the status sheet and the base/portfolio sheet each supply
   whichever columns they have — the merge fills the gaps automatically. */
export const ALIASES = {
  // The three real files each spell the key differently:
  //   lead outcome -> "account_number"   ·   CYC/PDD -> "Account No"   ·   status -> "account_no"
  //
  // "External ID" is last on purpose — it is the LIFEBOAT, not the front door.
  // Convin's lead export carries the account number twice, and one copy is ruined:
  //
  //   account_number : 7.47678E+15                    ← Excel ate it
  //   External ID    : 0007476780006975616_03072026#  ← survived
  //
  // Excel coerces a bare 19-digit string to a float and writes it back in scientific
  // notation, keeping six significant figures. On the real July export that collapsed
  // 7,042 distinct accounts onto 964 strings — the account numbers are not hidden,
  // they are destroyed. External ID escaped only because the "_03072026#" suffix made
  // it non-numeric, so Excel left it alone. accountKey() below reaches for it when the
  // primary key is corrupt.
  account_no: ['account_number', 'Account No', 'Account Number', 'account_no', 'Acct No', 'ACCOUNT NO', 'External ID'],
  customer_name: ['Customer Name', 'CUSTOMER NAME', 'Full Name', 'Name'],
  // The OUTCOME comes from RBL's status file, in lower case, and from nowhere else.
  // Convin's own export does not contain it — by design. We do not label our own results.
  status: ['status', 'Status', 'Lead Status'],
  goal_achieved: ['Goal Achieved'],
  qual_status: ['Qualification Status'],
  disp_l1: ['CollectionsDisposition_v2 L1', 'Disposition L1'],
  disp_l2: ['CollectionsDisposition_v2 L2', 'Disposition L2'],
  ai_attempts: ['Total AI Call Attempts', 'AI Call Attempts'],
  ai_connected_calls: ['AI Connected Calls'],
  ai_connected_seconds: ['AI Connected Seconds'],
  // Deliberately NOT ingested: any AI/call cost column. This dashboard is shown to
  // the client — Convin's cost is not captured, stored, or served anywhere.
  minimum_amount_due: ['minimum_amount_due', 'Minimum Amount Due', 'Min Amount Due'],
  total_outstanding: ['total_outstanding', 'Total Outstanding', 'Current Balance'],
  total_accounts_with_customer: ['Total Accounts with customer', 'Total Accounts with Customer'],
  months_on_book: ['Months on Book', 'MOB'],
  curr_bal_band: ['Curr Bal Band', 'Balance Band'],
  region: ['Region'],
  primary_state: ['Primary State', 'pm_state', 'State'],
  primary_city: ['Primary City', 'pm_city', 'City'],
  mobile: ['Mobile Number -1', 'Mobile Number', 'Mobile', 'Phone'],
  model_logic: ['As Per New Logic M2', 'As Per New Logic'],
  paid_flag: ['Lead Entity Paid'],
  promise_flag: ['Lead Entity Promise to Pay'],
  refusal_flag: ['Lead Entity Refusal to pay', 'Lead Entity Refusal to Pay'],
  payment_mode_raw: ["Lead Entity If payment done return 'Mode of Payment", 'Mode of Payment', 'Last payment mode'],
  lead_link: ['Lead Link'],

  /* WHEN the AI last spoke to this account. Ingested for exactly one reason, and it
     is not a chart.

     The outcome comes from RBL's status file, which is a SNAPSHOT — pulled on some
     date. The calls run over several days. If the snapshot is older than the calls,
     then for every account still being dialled after the pull, the status file
     records an outcome that had not happened yet. Those accounts come back
     "Unresolved" not because they refused to pay, but because nobody had looked.

     On the 3 July book this was 740 accounts — 12,130 dials, 30% of the campaign —
     all reading exactly 0.0% resolved. It is invisible in every headline figure and
     it makes "13+ attempts → 0% resolved" appear on a chart shown to the bank.

     Without this column the app cannot see it. With it, outcomeWindow() in
     aggregate.mjs catches it before the report is built. */
  last_call_at: ['Last Call Timestamp', 'Last Call Time', 'Last Call Date', 'Last Interaction Time'],

  // ── From the CYC / PDD file ────────────────────────────────────────────────
  // RBL's own risk segment (Red / Amber / Green). The bank's view of the account,
  // formed before we ever dialled it — which makes it the one signal on this list
  // that is genuinely independent of anything Convin did.
  segment: ['Segment', 'SEGMENT', 'Portfolio(PDD)'],

  /* WHO worked the account. On the CYC exports we have seen this is a single value
     ("Convin_NEW") — the whole book is one cohort — so the comparison it exists for
     cannot be drawn yet. It is ingested anyway, because the day RBL sends a book that
     splits AI-only accounts from AI+agency accounts, the comparison has to appear on
     its own rather than wait for a release. Degrades to "one cohort" exactly the way
     the Segment breakdown already does. */
  ai_agency: ['AI Agency', 'AI_Agency', 'Agency'],

  // ── From the Lead Outcome file ─────────────────────────────────────────────
  // Convin's own collection score for the lead.
  lead_score: ['Lead Metric Collection Score', 'Lead Metric Collection Store', 'Collection Score'],
};

export const CRITICAL = ['account_no', 'status', 'total_outstanding'];

/* Human labels for the column-mapping UI. */
export const FIELD_LABELS = {
  account_no: 'Account No', status: 'Status', total_outstanding: 'Total Outstanding',
  customer_name: 'Customer Name', minimum_amount_due: 'Minimum Due', curr_bal_band: 'Balance Band',
  region: 'Region', primary_state: 'State', primary_city: 'City', mobile: 'Mobile',
  months_on_book: 'Months on Book', total_accounts_with_customer: 'Accounts with Customer',
  model_logic: 'Model / Strategy', ai_attempts: 'AI Call Attempts', ai_connected_calls: 'AI Connected Calls',
  ai_connected_seconds: 'AI Connected Seconds',
  disp_l1: 'Disposition L1', disp_l2: 'Disposition L2',
  qual_status: 'Qualification Status', goal_achieved: 'Goal Achieved', paid_flag: 'Entity · Already Paid',
  promise_flag: 'Entity · Promise to Pay', refusal_flag: 'Entity · Refusal to Pay',
  payment_mode_raw: 'Mode of Payment', lead_link: 'Lead Link',
  segment: 'Segment (RBL)', lead_score: 'Lead Collection Score',
  last_call_at: 'Last Call Timestamp', ai_agency: 'AI Agency',
};

/* Ordered groups for the column-mapping UI.
 *
 * Note this list controls what the user SEES, not what gets ingested — `autoMap()`
 * walks ALIASES, so a field left out here would still be detected and still fed to
 * the model. Worth knowing before anyone edits this: taking "Promised to pay" or
 * "Claimed already paid" out of the DATA (not just this panel) would gut the model —
 * they are the −18.3 pt and +46.3 pt signals on the RoshRegression card.
 */
export const FIELD_GROUPS = [
  { title: 'Required', keys: ['account_no', 'status', 'total_outstanding'] },
  { title: 'Money & customer', keys: ['customer_name', 'minimum_amount_due', 'curr_bal_band', 'months_on_book', 'total_accounts_with_customer', 'segment', 'ai_agency'] },
  { title: 'Geography', keys: ['region', 'primary_state', 'primary_city', 'mobile'] },
  { title: 'AI calling', keys: ['ai_attempts', 'ai_connected_calls', 'ai_connected_seconds', 'last_call_at', 'lead_score'] },
  { title: 'Outcomes & entities', keys: ['disp_l1', 'disp_l2', 'qual_status', 'goal_achieved', 'paid_flag', 'promise_flag', 'refusal_flag', 'payment_mode_raw'] },
  { title: 'Other', keys: ['model_logic', 'lead_link'] },
];

/* ── The account key ────────────────────────────────────────────────────────────
   Every join in this app hangs off one string. Get it wrong and you attach the wrong
   customer's ₹80,000 balance; get it empty and the account silently becomes worth ₹0.
   So the account number gets its own resolver rather than going through getField().  */

/** An account number Excel has rewritten as a float ("7.47678E+15").
    Excel coerces a long digit string to a double and prints ~6 significant figures,
    so MANY distinct accounts collapse onto ONE value. The digits are not hidden —
    they are destroyed. You cannot invert this; you can only find the number
    somewhere else, or refuse. */
const SCI = /^\d+(\.\d+)?[eE][+-]?\d+$/;
export const isCorruptAccount = (v) => SCI.test(String(v ?? '').trim());

/**
 * Pull the account number out of whatever wrapper a source system put it in.
 *
 *   "0007476780006975616"            -> "0007476780006975616"   (already clean)
 *   "0007476780006975616_03072026#"  -> "0007476780006975616"   (Convin's composite key)
 *   "0007476780006975616 | BATCH-9"  -> "0007476780006975616"
 *   "0005369-077354-021471"          -> "0005369077354021471"   (grouped for humans)
 *   "7.47678E+15"                    -> "7.47678E+15"           (left corrupt ON PURPOSE)
 *
 * The composite rule is "take the longest run of digits". An account number is always
 * the longest number in a composite key — a date stamp, batch number or checksum
 * suffix is shorter by construction. Leading zeros are preserved, because they are
 * part of the identifier.
 *
 * A scientific-notation value is deliberately NOT cleaned. Stripping its dot and plus
 * would launder "7.47678E+15" into a plausible-looking "747678E15" and we would lose
 * the only evidence that this row's key is unusable.
 */
export function normalizeAccount(v) {
  const s = String(v ?? '').trim();
  if (!s) return '';

  // Grouped or spaced digits are still just digits: "0005369-077354" -> "0005369077354".
  const bare = s.replace(/[\s -]/g, '');
  if (/^\d+$/.test(bare)) return bare;

  if (SCI.test(s)) return s;                       // corrupt — keep it recognisable

  // Composite / delimited key of any shape: take the longest digit run.
  const runs = s.match(/\d{8,}/g);
  if (runs && runs.length) return runs.reduce((a, b) => (b.length > a.length ? b : a));

  return s;                                        // not account-shaped; caller decides
}

/**
 * Is `candidate` CONSISTENT with the account Excel crushed into `corrupt`?
 *
 * Re-run Excel's own rounding on the candidate and see whether it lands back on the
 * mangled string. This is a column-selection guard, and it is worth being exact about
 * what it does and does not establish:
 *
 *   IT DOES rule out every value in the row that is not the account. The mobile number,
 *   the outstanding balance, the lead ID, a timestamp — none of them round-trip. That
 *   is the failure mode that would actually hurt us: adopting some other long number
 *   from the row and joining half the book to the wrong customers.
 *
 *   IT DOES NOT reconstruct lost digits, and it cannot. Both ...975616 and ...975617
 *   round to "7.47678E+15"; six significant figures are six significant figures. So
 *   this is not a proof of uniqueness across the universe of numbers.
 *
 * That is fine, because we are not reconstructing anything. The candidate is taken from
 * the SAME ROW — the same customer's record — so it is already that customer's account
 * by construction. The round-trip only confirms we reached for the right column. The
 * digits come from the file; the arithmetic just stops us picking up the wrong ones.
 */
export function decodesTo(candidate, corrupt) {
  const m = String(corrupt ?? '').trim().match(/^(\d)(?:\.(\d+))?[eE]\+?(\d+)$/);
  if (!m) return false;
  const decimals = (m[2] || '').length;
  const digits = String(candidate ?? '').replace(/\D/g, '');
  if (!digits) return false;
  const n = Number(digits);
  if (!Number.isFinite(n) || n === 0) return false;
  return n.toExponential(decimals).toUpperCase() === String(corrupt).trim().toUpperCase();
}

/**
 * Resolve a record's account number, preferring any column that is not corrupt — and
 * PROVING the substitution when the mapped column is.
 *
 * The naive version — "take the first alias that has a value" — is what let Convin's
 * July lead export in: `account_number` was present on every row, so it won, and every
 * row carried a key Excel had destroyed. It matched nothing, and the dashboard rendered
 * beautifully with no data behind it.
 *
 * Three passes, each stricter than the last:
 *   1. a known alias that is clean            → use it
 *   2. the mapped column is corrupt, but a known alias is clean AND round-trips to it
 *   3. no known alias survives → scan EVERY column in the row for a value that
 *      round-trips. This is what makes it future-proof: the survivor does not have to
 *      be called "External ID", or be a column we have ever seen before.
 *
 * Returns { key, from, recovered, corrupt } so the caller can TELL the user. Silently
 * repairing a bank's identifiers and saying nothing is how you lose their trust for good.
 */
export function accountKey(rec, mapping) {
  /* Resolve the mapping + aliases to this record's ACTUAL column names, tolerant of
     header decoration (canonHeader): "Account No#", "Account No.", "ACCOUNT_NO" all
     resolve to the same column. `names` therefore holds real columns of `rec`. */
  const canonIdx = new Map();
  for (const col of Object.keys(rec)) { const k = canonHeader(col); if (k && !canonIdx.has(k)) canonIdx.set(k, col); }
  const names = [];
  const add = (name) => { const col = name != null && canonIdx.get(canonHeader(name)); if (col && !names.includes(col)) names.push(col); };
  if (mapping && mapping.account_no) add(mapping.account_no);
  for (const n of ALIASES.account_no) add(n);

  let corrupt = '';
  let corruptCol = '';
  const cleanFromAlias = [];

  for (const n of names) {
    const raw = rec[n];
    if (raw === undefined || raw === null || String(raw).trim() === '') continue;
    const v = normalizeAccount(raw);
    if (!v) continue;
    if (isCorruptAccount(v)) { if (!corrupt) { corrupt = v; corruptCol = n; } continue; }
    cleanFromAlias.push({ v, n });
  }

  // 1. Nothing was corrupt — the ordinary, happy case.
  if (!corrupt) {
    const first = cleanFromAlias[0];
    return first
      ? { key: first.v, from: first.n, recovered: false, verified: true, corrupt: false }
      : { key: '', from: '', recovered: false, verified: true, corrupt: false };
  }

  // 2. The mapped column is wrecked. Best case: a known account column that also
  //    round-trips to the wreckage — clean AND confirmed.
  for (const { v, n } of cleanFromAlias) {
    if (decodesTo(v, corrupt)) return { key: v, from: n, recovered: true, verified: true, corrupt: false };
  }

  // 3. Widen the search to columns we have never heard of. Here the round-trip is
  //    MANDATORY. Without it we would happily adopt the mobile number, the lead ID or
  //    the outstanding balance — any long digit string in the row — and join half the
  //    book to the wrong customers. An unknown column has to earn it.
  for (const [col, raw] of Object.entries(rec)) {
    if (names.includes(col)) continue;
    const v = normalizeAccount(raw);
    if (!v || isCorruptAccount(v) || !/^\d{8,}$/.test(v)) continue;
    if (decodesTo(v, corrupt)) return { key: v, from: col, recovered: true, verified: true, corrupt: false };
  }

  /* 4. Nothing round-trips, but a column we KNOW to be an account column is clean.
     Take it — a known alias is an account number by definition, and refusing here
     would throw away a perfectly good file just because the wrecked column happened
     to be derived from something else. This is the only unproven step, and it is safe
     for a structural reason: if the value is wrong it belongs to a different ID space
     entirely, so it will match nothing, and the zero-match guard downstream stops the
     upload anyway. A wrong join needs a COLLISION, and different ID spaces don't collide. */
  if (cleanFromAlias.length) {
    const { v, n } = cleanFromAlias[0];
    return { key: v, from: n, recovered: true, verified: false, corrupt: false };
  }

  /* Nothing in this row can prove what the account was. There is no honest answer:
     the digits are gone. Report it, join nothing, and let the row be counted as
     unmatched rather than attach it to the wrong customer. */
  return { key: corrupt, from: corruptCol, recovered: false, verified: false, corrupt: true };
}

/** First non-empty value: an explicit mapping wins, else the known aliases. */
export function getField(rec, key, mapping) {
  if (key === 'account_no') return accountKey(rec, mapping).key;
  if (mapping && mapping[key]) {
    const v = rec[mapping[key]];
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  const names = ALIASES[key] || [];
  for (const n of names) {
    const v = rec[n];
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return '';
}

/** Auto-detect a mapping from a list of raw headers (used by the mapping UI). */
export function autoMap(headers) {
  /* Match aliases to headers on their CANONICAL form (canonHeader), so a column called
     "Account No#" is auto-detected against the "Account No" alias. Return the ORIGINAL
     header string, so the mapping names the column exactly as the file spells it. */
  const canon = new Map();
  for (const h of headers) { const k = canonHeader(h); if (k && !canon.has(k)) canon.set(k, String(h ?? '').trim()); }
  const out = {};
  for (const key of Object.keys(ALIASES)) {
    for (const alias of (ALIASES[key] || [])) {
      const hit = canon.get(canonHeader(alias));
      if (hit) { out[key] = hit; break; }
    }
  }
  return out;
}

/** Which critical fields are missing from a merged record's available headers. */
export function missingCritical(rec, mapping) {
  return CRITICAL.filter((k) => String(getField(rec, k, mapping)).trim() === '');
}

/* Kept beside normalizeMap rather than imported from calllog.mjs, because calllog.mjs
   imports from here and a cycle between the two would be a genuinely nasty thing to
   debug. emptyCallFields() there returns these plus the legacy fields it overrides. */
const CALL_DEFAULTS = {
  first_call_at: '',
  attempts_by_hour: '',
  outbound_lines: '',
  attempt_mask: '',
  max_attempt: 0,
  attempt_first_paid: 0,
  dnc_attempt: 0,
  dials_after_dnc: 0,
  voicemail_calls: 0,
  voicemail_seconds: 0,
  complaint_flag: false,
  dnc_flag: false,
  refused_flag: false,
  ptp_flag: false,
};

/** Merged record map -> canonical row. */
export function normalizeMap(rec, mapping) {
  const g = (k) => getField(rec, k, mapping);
  const refusalRaw = String(g('refusal_flag')).trim();
  return {
    account_no: String(g('account_no')).trim(),
    customer_name: String(g('customer_name')).trim() || '—',
    status: String(g('status')).trim(),
    goal_achieved: String(g('goal_achieved')).trim(),
    qual_status: String(g('qual_status')).trim(),
    disp_l1: String(g('disp_l1')).trim(),
    disp_l2: String(g('disp_l2')).trim(),
    ai_attempts: Math.round(num(g('ai_attempts'))),
    ai_connected_calls: Math.round(num(g('ai_connected_calls'))),
    ai_connected_seconds: Math.round(num(g('ai_connected_seconds'))),
    minimum_amount_due: num(g('minimum_amount_due')),
    total_outstanding: num(g('total_outstanding')),
    total_accounts_with_customer: Math.round(num(g('total_accounts_with_customer'))),
    months_on_book: Math.round(num(g('months_on_book'))),
    curr_bal_band: bandNorm(g('curr_bal_band')),
    region: String(g('region')).trim(),
    primary_state: String(g('primary_state')).trim(),
    primary_city: String(g('primary_city')).trim(),
    mobile: String(g('mobile')).trim(),
    model_logic: String(g('model_logic')).trim(),
    paid_flag: entityNorm(g('paid_flag')),
    promise_flag: entityNorm(g('promise_flag')),
    refusal_flag: refusalBucket(refusalRaw),
    refusal_reason: refusalRaw && U(refusalRaw) !== 'NA' ? refusalRaw : '',
    payment_mode: payBucket(g('payment_mode_raw')) || 'NA',
    lead_link: String(g('lead_link')).trim(),
    // Date only. See ALIASES.last_call_at — this is what lets the aggregator notice
    // that the outcome file was pulled before the calls finished.
    last_call_at: dateOnly(g('last_call_at')),
    // RBL's segment for the account. NOTE: in the CYC/PDD exports we have seen, this
    // is "Red" on every single row — the whole file IS the red segment. It is kept
    // because other cycles may vary, but do not expect it to predict anything here.
    segment: String(g('segment')).trim(),
    // Convin's collection score. This is a LABEL, not a number — the real export
    // contains "low" / "high" / blank. Running num() over it silently turned "low"
    // into 0 and threw the signal away.
    lead_score: String(g('lead_score')).trim(),
    // Which cohort worked this account (AI-only vs AI + agency). See ALIASES.ai_agency.
    ai_agency: String(g('ai_agency')).trim(),

    /* ── Rolled up from the AI CALL LOG ──────────────────────────────────────
       Defaults only. The call log has one row per ATTEMPT, so it cannot be merged by
       getField() like every other column — it is folded onto the account in
       calllog.mjs and written over these. They are declared HERE so that the canonical
       row has ONE shape whether or not a call log was uploaded: the database columns,
       the Day Total union and the Aggregator all read the same fields either way, and
       a book uploaded without a call log reads zero rather than undefined. */
    ...CALL_DEFAULTS,
  };
}

export const isResolved = (r) => r.status === 'Resolved';
