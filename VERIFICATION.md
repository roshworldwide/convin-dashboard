# Data Verification — Day 1 (3 July book)

**Report verified:** `Recovery Intelligence — Convin × RBL Bank.pdf` (10 pages)
**Verified against:** the three raw source files, independently
**Date of verification:** 14 July 2026

## Method

Every figure was rebuilt from the raw files in **Python** (`openpyxl`, `csv`) — deliberately
*not* using the application's own parsing, joining or aggregation code. Verifying `merge.mjs`
with `merge.mjs` is circular: it would reproduce that code's bugs and call them agreement.
The rebuild is an independent second implementation, and it either agrees with the report or
it doesn't.

**Sources**

| file | rows | role |
|---|---|---|
| `CYC 12 PDD1 3rd July File.xlsx` | 7,042 | the spine — RBL's book |
| `Status File 04 July-39_26.xlsx` | 177,685 | the outcome — Resolved / Unresolved |
| `Collections-_July_leads_20260713_110225.csv` | 7,915 | Convin's export — calls, dispositions |

## Result

**189 individual figures checked across all 10 pages. 187 reconcile exactly. 2 do not.**

### The join is sound

- CYC: 7,042 rows, 7,042 distinct accounts, all 19-digit, **zero duplicates**.
- Status: all 7,042 CYC accounts present. **Zero accounts carry conflicting statuses.**
- Leads: 7,915 rows, all distinct — **no account has more than one lead row**, so there is no
  ambiguity about how multiple leads were collapsed. None were.
- **873 leads are not in RBL's book at all.** Convin called accounts outside the CYC file. The
  spine correctly excludes them, and the denominator stays RBL's.
- The Excel corruption is real and correctly handled: 7,042 of 7,915 `account_number` values
  arrived as `7.47678E+15`. All 7,042 were recovered from `External ID`.

### Figures that reconcile exactly

Total outstanding **₹54,97,79,424.31**. Recovered **₹13,11,59,463.95**. 1,751 resolved (24.9%),
5,291 open, ₹41.86 Cr still open, ₹5.72 Cr minimum due, ₹78,071 average outstanding, ₹74,905
average recovery per resolved account.

39,905 attempts · 6,710 connected · 33,195 not connected · 16.8% connect rate · 7,278
talk-minutes · 3,429 leads reached (48.7%) · 3,613 never reached · 5.7 attempts per lead ·
11.6 dials to reach one lead · reached resolve at 35.3% (1,212/3,429) vs 14.9% (539/3,613).

All 6 balance bands (count, outstanding, resolved, recovered, pending, recovery %). All 3
regions. All 5 L1 dispositions. All 8 charted L2 dispositions, plus the footnote — 67 accounts
across 10 unlisted values, ₹29.46 L. All 6 funnel stages. All 6 duration buckets. Top-20 by
exposure. Recoverable Opportunity: ₹2.41 Cr / 344 promised, ₹6.02 Cr / 804 engaged ≥2 min,
₹4.52 Cr / 628 claimed-paid.

Two points where the **app is right and a naive check is wrong**, worth knowing before anyone
"corrects" them:

1. The CYC file contains **mixed casing** in `Curr Bal Band` — both `30-50K` and `30-50k`. The
   app case-folds. A case-sensitive check splits the book into 10 bands instead of 6.
2. Recoverable Opportunity uses the **lead entity flags** (`Lead Entity Promise to Pay`,
   `Lead Entity Paid`), not the L2 disposition. These genuinely differ (344 vs 262 promised;
   628 vs 712 claimed-paid) and the flags are the right choice.

---

## Defect 1 — "21 states covered" — FIXED

The card read **21**. There are **20** states. Ten accounts have a blank `Primary State`, and
`_geo()` files those under an `Unspecified` bucket so the geography charts still add up to the
book — but the card was rendering `state.length`, which counted that bucket as a state.

**Fixed.** `totals.statesCovered` now excludes `Unspecified`, and `totals.statesUnspecified`
carries the 10 accounts so they are still visible rather than swept away. Applied by
`npm run rebuild` — no re-upload needed.

---

## Defect 2 — the outcome file was older than the calls — FIXED (guard added)

The chart reads: **"13+ attempts · n=732 · 0% resolved."**

That figure is computed correctly. It is also structurally meaningless, and it is the single
most dangerous line in the report.

**726 of those 732 accounts had their last call on 7 July.** And every account whose last call
was 7 July is Unresolved — 740 accounts, no exceptions:

| last call | accounts | resolved |
|---|---|---|
| 4 July | 2,433 | 37.4% |
| 5 July | 3,266 | 18.3% |
| 6 July | 603 | 40.1% |
| **7 July** | **740** | **0.0%** |

A clean 0.0% across 740 accounts is not a behavioural result. **The dialer stops calling an
account once it resolves.** So "still being dialled on the final day" and "not resolved" are
the same fact wearing two hats. The chart plots resolution against a proxy for resolution — it
is circular. The artifact runs the other way too: *"1 attempt → 73.6% resolved"*, because an
account that paid immediately was called once and dropped off the list.

**The exposure.** Those 740 accounts absorbed **12,130 dials — 30% of the entire campaign** —
1,449 connected calls and 1,128 talk-minutes, against ₹5.74 Cr of outstanding. An RBL exec
reads that row as *"you spent a third of your dials and recovered nothing."* That is not what
happened. It is what the chart says.

### Root cause — and it settles the open question about which status file to use

Outcomes are being measured with the **04 July** status file, while the leads export contains
calls running through **07 July**.

**You cannot measure the result of a 7-July call with a 4-July outcome file.** Three of the
four campaign days happen *after* the outcome was recorded. The 04 July status file is the
wrong pairing for this leads export.

This is why the 07 July status file produced 4,206 resolved / 59.7% rather than 1,751 / 24.9%.
That is not optimism — it is the calls being given time to land.

### What was done about it

The real fix is to pair the outcome file with the period the calls actually cover. But the app
could not previously *see* this condition at all, so it would have recurred silently every day.
It now detects it.

**`last_call_at`** (the day of the account's last call) is now ingested, stored and carried
end-to-end. **`_outcomeWindow()`** in `aggregate.mjs` groups accounts by that day and walks back
from the last day of calling, marking the trailing run of days on which *not one* account
resolved. Zero out of 740 is not a bad day — it is a day nobody scored. (A cohort below 25
accounts is never called blind: a genuine run of bad luck is plausible at that size.)

When a blind window is found:

- A **red banner** appears on the dashboard and in the PDF, naming the affected accounts, dials
  and outstanding, and saying plainly what to do: *re-run with a status file pulled after
  7 July.*
- **Conversation Duration**, **Dial Efficiency** and **Duration × L2** — the three charts that
  plot resolution against call behaviour, and the only ones this bias can reach — are computed
  over the **measurable** accounts and say so. `13+ attempts` drops from 732 accounts to 6 and
  is labelled *"too few to rate"*, which is the truth.
- **Every other figure is untouched.** The book, the money, the bands, the regions, the
  dispositions, the funnel are RBL's own numbers as RBL reported them, and it is not our place
  to restate them. The banner says the headline resolution rate is a **floor**, not the result.

Verified against the raw files: the app now reports exactly the 740 accounts, 12,130 dials
(30.4% of the campaign), 1,449 connected calls and ₹5.74 Cr that the independent Python rebuild
found — and the `0% resolved` row is gone.

Worth knowing: netting out the unmeasured accounts makes the duration story **stronger**, not
weaker. The odd dip at `>5 min` (35.2%) was itself the artifact — it is really **43.7%**, and
resolution now climbs cleanly with talk time.

**Still to do:** the guard reads `last_call_at`, which only exists on a **fresh upload** —
reports already in the database were stored before the column existed. Re-upload the three files
to activate it. (`npm run rebuild` applies the states fix, but cannot invent a column that was
never saved. It degrades safely: no dates, no banner, no false positives.)

**And the substantive one: re-run this report against the 07 July status file.** The guard makes
the problem impossible to miss. It does not make the 04 July pairing correct.

---

## Presentation note — four values for "not contacted"

The report prints four different numbers for the same intuitive concept, on four pages:

| page | value | definition |
|---|---|---|
| Funnel / AI Calling | 3,613 | zero connected calls |
| Disposition L1 | 3,614 | blank L1 disposition |
| Disposition L2 | 3,615 | blank L2 disposition |
| Duration analysis | 3,620 | zero talk-seconds |

Each is individually correct under its own definition. The gaps are real: 7 accounts connected
with zero recorded duration, 2 connected with no L2 disposition. But a sharp reader will spot
the inconsistency, and *"they are four different definitions"* is a weak answer under pressure.

**Recommend harmonising on one definition** — zero connected calls (3,613) — and stating it once.
