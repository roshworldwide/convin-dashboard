/* ── PAYLOAD SCHEMA VERSION ────────────────────────────────────────────────────
 *
 * Lives in its own file on purpose. The dashboard is a CLIENT component, and importing
 * this from aggregate.mjs would drag the whole aggregator — and RoshRegression with it —
 * into the browser bundle, for the sake of one integer. It also reads process.env at
 * module load, which has no business running in a browser.
 *
 * WHY IT EXISTS
 * The dashboard renders a payload computed at UPLOAD time and cached to disk; it does
 * not recompute on page load. That is what makes it instant, and it is also a trap: add
 * a field to the payload, and every report already saved lacks it, so every card guarded
 * on that field silently vanishes. No error, no warning, no clue — the only symptom is
 * "I can't see that card". Two whole sections disappeared exactly this way.
 *
 * Bump this on any change to the shape of agg/intel. The dashboard compares it against
 * the version baked into the stored payload and shows a banner if they differ, so a
 * stale report announces itself rather than quietly dropping a section in front of a
 * client. `npm run rebuild` regenerates every stored report from its saved canonical
 * rows — no re-upload, no number changes.
 *
 * v2  segment breakdown + dynamic categorical features
 * v3  duration x disposition L2
 * v4  aiReach (lead-level connection), dispositionL2, 6-stage funnel
 * v5  meta.sources — WHICH FILES produced these numbers (see aggregate.mjs)
 * v6  outcomeWindow — did the status file predate the calls? (see aggregate.mjs)
 *     + totals.statesCovered excludes the "Unspecified" bucket
 * v7  meta.cycFile — the CYC book each report was computed from, printed on the
 *     cover and SURVIVES sanitizeForShare (unlike meta.sources, which does not)
 * v8  funnel stages 2 and 3 renamed "Total Leads Attempted" / "Total Leads
 *     Connected" — they count ACCOUNTS, not calls, and the old labels said calls
 * v9  THE AI CALL LOG. The old Lead Outcome export (one row per account) is
 *     replaced by a per-ATTEMPT export, and everything that needs an attempt to
 *     exist arrives with it:
 *       agg.callLog   hour-of-day, conversion by attempt number, attempt/contact
 *                     intensity, the two contact rates, PTP generation and its
 *                     conversion, complaints, DNC + the "did we call them again"
 *                     compliance check, outbound lines, and notMeasured — the four
 *                     figures that were asked for and are not in the data
 *       agg.cohorts   AI-only vs AI+agency (one cohort today, wired for two)
 *       agg.topOutstanding[].ref replaces .name — NO customer name is in the
 *                     payload any more, so none can reach a PDF or a share link
 */
export const PAYLOAD_VERSION = 9;
