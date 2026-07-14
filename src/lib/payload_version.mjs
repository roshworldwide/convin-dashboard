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
 */
export const PAYLOAD_VERSION = 6;
