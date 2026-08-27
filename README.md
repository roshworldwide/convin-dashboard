# Recovery Intelligence — Convin × RBL Bank

A collections analytics dashboard. Three files in, one report out: what the AI recovered,
where, and — the part that matters — **which signals actually predict a customer paying**,
learned from the bank's own outcomes rather than asserted.

> **No customer data is in this repository.** Not one name, mobile number or account
> number. `.gitignore` excludes `/src/data/*`, every `.csv` and every `.xlsx`; the real
> book lives in Postgres or on the machine that produced it. `npm run check:pii` fails a
> commit that would break that.

---

## Run it

```bash
npm install
npm run dev            # app + a free public tunnel, one terminal
```

Open `http://localhost:3000` and upload three files:

| slot | file | role |
|---|---|---|
| **CYC / PDD** | `.xlsx` | **the spine** — RBL's own book. It decides which accounts exist. |
| **Status** | `.xlsx` | **the outcome** — Resolved / Unresolved, from the bank |
| **Lead outcome** | `.csv` | Convin's export — calls, dispositions, talk time |

Joined on Account No. No VLOOKUP, no manual step.

**Two rules the whole thing hangs on.** The report covers *every* account in RBL's book —
including the ones the AI never reached — so the denominator is the bank's, not ours. And
the outcome comes from RBL's status file and nowhere else; Convin's export does not contain
it, by design. **We do not mark our own homework.**

---

## What it does that a spreadsheet doesn't

**It refuses to be wrong quietly.** Most of this codebase is not charts — it is the
machinery that stops a plausible-looking number from reaching a client:

- A lookup sheet that matches **zero** accounts is blocked, not ignored. The real lead
  export did exactly this, and the naive join reported *"7,042 matched, 0 unmatched"* while
  attaching nothing at all.
- Excel silently destroys 19-digit account numbers into `7.47678E+15` — 7,042 accounts
  collapsed onto 964 strings. The app detects it, recovers the true number from another
  column in the same row, **proves** the recovery by re-running Excel's own rounding, and
  tells you it did.
- **A status file older than the calls is caught.** The outcome is a snapshot; the calls run for
  days. Pair a Monday snapshot with a campaign that ran to Thursday and every account still being
  dialled comes back "Unresolved" — not because the customer refused, but because nobody had
  looked yet. Nothing about it looks broken: every total is correct, every chart renders, and the
  dial-efficiency chart draws a clean line to **0% resolved** on the accounts you called hardest.
  It happened on the real book — 740 accounts, 12,130 dials, 30% of the campaign. The app now
  detects it, says so in red, and refuses to draw the behavioural charts over accounts whose
  outcome nobody has recorded.
- A partial join is refused outright. Half a book counted at ₹0 is worse than no report.
- Day Total is a **union of accounts**, not a sum of rows — upload the same book twice and
  the money does not double. The **Campaign Summary** applies the same rule across report
  dates: every date is a re-pull of the same book against a later status file, so summing
  five days would report five times the money. Union, never sum.
- A stale cached report announces itself instead of silently dropping the sections it
  doesn't have.

**502 invariant checks** guard this: `npm run test:all`.

## RoshRegression

A regularised logistic regression, retrained on every report from that report's own
outcomes. ~60 lines of standard maths, zero dependencies, no external API, and no data
leaves the bank's environment. Every coefficient is inspectable.

It reports **observed lift** — marginal, and verifiable by filtering the account table —
rather than regression coefficients, which flip sign under collinearity and cannot be
checked by the person you are showing them to.

Trained and scored on every upload. Not currently rendered in the UI.

---

## Deploy

| | |
|---|---|
| **`SHARE.md`** | Vercel + Supabase (free, always on) · private share links · the tunnel |
| **`DEPLOY.md`** | full deployment checklist |
| **`DATA_HANDLING.md`** | what personal data exists, and where it lives |

The browser parses and joins the files locally and sends only the joined rows, gzipped and
chunked: **12.5 MB of workbooks → 0.57 MB on the wire.** That is what makes the upload work
on Vercel at all, which refuses any request body over 4.5 MB.

### Environment

| | |
|---|---|
| `DATABASE_URL` | Postgres. Absent → the app runs on local JSON files. |
| `DASHBOARD_PASSWORD` | **required in production.** The app fails closed without it. |
| `PUBLIC_BASE_URL` | the public origin, used to build share links |

---

## Scripts

```bash
npm run dev          # app + tunnel, one terminal
npm run test:all     # 502 invariant checks
npm run check:pii    # refuses to let customer data reach a commit
npm run push         # parse 3 files locally → straight into Postgres
npm run reports      # one PDF per PDD book, unattended (see scripts/build_book_reports.mjs)
npm run rebuild      # regenerate stored reports after an aggregator change (Postgres or local)
npm run diagnose     # "why won't my files join?"
```
