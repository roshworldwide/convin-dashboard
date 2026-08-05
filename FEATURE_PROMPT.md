# Paste this into Claude Code

Run Claude Code in `/Users/rosh/Personal/Projects/RBL Dashboard 2` and paste everything
below the line.

Before you start: put the three demo files somewhere the tool can read them and tell it
the paths. They are:
- `CYC 22 PDD+4 convi.xlsx` (the book — 1,179 accounts)
- `Status File 19 July'26.xlsx` (the outcome — 591k-row RBL master)
- `ai_call_detail_c6bf48cc-…_20260728_112833.csv` (**the new AI Call Log — 18,883 call attempts**)

---

You are extending an existing, working Next.js 16 collections-analytics dashboard
(Convin × RBL Bank). **It is already deployed and correct. Do not refactor it, do not
"improve" working code, do not touch the guards described below.** You are adding one new
data source and the analytics it unlocks.

## The single biggest change

**The old "Lead Outcome" CSV is being replaced by an AI Call Log CSV.** The old file had
ONE row per account (totals). The new file has **ONE row per call attempt**. Everything
new comes from that shape.

The three files going forward are: **CYC book · Status file · AI Call Log.**

## What must not break (read this first)

This codebase's whole reason to exist is that it refuses to show a plausible-looking
wrong number. Preserve every one of these — there are tests for them (`npm run test:all`):

1. **CYC is the spine.** It decides which accounts exist. The report covers every CYC
   account including ones never called. The denominator is the bank's, not ours.
2. **The outcome (Resolved/Unresolved) comes ONLY from the status file.** Never infer
   resolution from the call log's dispositions. We do not mark our own homework.
3. **Day Total and the Summary are a UNION of accounts, never a sum of rows.** Re-uploading
   the same book must not double the money. The Summary is per report date, built from its
   Days; the headline is the Day Total. (See `src/lib/summary.mjs`, `backend.mjs`.)
4. **The browser parses and joins; only joined rows cross the wire, gzipped and chunked**
   (Vercel caps a request body at 4.5 MB). The call log is 9 MB — it MUST be parsed and
   rolled up in the browser, exactly like `upload_client.mjs` does today. Do not post the
   raw call log to a serverless route; it will 413.
5. **Excel destroys 19-digit account numbers** into `7.47678E+15`. The account key is
   recovered from a suffix-bearing column and proved by re-running Excel's rounding. The
   call log's join key is the **`External ID`** column (e.g. `0007477770006276734_16072026`)
   — same pattern as the old leads file. Reuse `accountKey()` / `normalize.mjs`; do not
   write a second key parser.
6. **`no-undef` is on and 500+ invariant checks pass.** Keep them passing. Bump
   `PAYLOAD_VERSION` when you add fields to the payload (there is a stale-report banner
   that depends on it).

## The AI Call Log — verified schema

CSV, one row per call attempt. Real columns (some are blank on unanswered calls):

| column | meaning | notes |
|---|---|---|
| `External ID` | account key + date suffix | **the join key** — `\d{6,}` prefix, like the old leads file |
| `Attempt Number` | 1, 2, 3… | explicit — do NOT recompute from row order |
| `Call Timestamp` | when the attempt was placed | `YYYY-MM-DD HH:MM:SS` — the time is real, use it |
| `Call Answered Timestamp` | present ⇒ **connected** | blank ⇒ not connected. This is the connect definition |
| `Call Duration (Seconds)` | talk time | blank on unanswered |
| `Call Status` | `no_answer` / `completed` / `voicemail` / `queued` | |
| `Sense Disposition L1` | Paid / Schedule Callback / DNC / Refused to Pay / … | blank on unanswered |
| `Sense Disposition L2` | Paid / Promise to Pay Later / Potential Complaint / Won't Pay / On Call Payment Done / … | |
| `Telephony Disposition` | User disconnected / Call ended by voicebot … | |
| `Call Disconnected By` | System / Customer / AI Assistant | |
| `From Phone Num` | 40 distinct outbound lines | weak proxy for bot — see "do not build" |
| `Lead Name`, `To Phone Num` | **PII — never store or display** | drop at parse time |

On the sample: 18,883 attempts across 1,417 accounts (avg 13, max 21). 28% of attempts
connected. All 1,179 CYC accounts are present in the log; 238 log accounts are NOT in the
CYC (a different cycle — the spine correctly drops them).

## Architecture (do it this way)

Do **not** store 18,883 attempt rows in Postgres. Keep the existing canonical model:
**one row per account.** In the browser, while parsing the call log, roll the attempts up
onto each account's canonical row, adding fields such as:

- `attempts_total`, `attempts_connected` (has Answered Timestamp), `attempts_by_hour`
  (small histogram or list of hours), `talk_seconds_total`
- `attempt_of_first_paid` (attempt number where L2 first = Paid/On Call Payment Done, else
  null), `max_attempt`
- flags rolled from any attempt: `complaint_flag` (L2 = Potential Complaint),
  `dnc_flag` (L1 = DNC), `refused_flag`, `ptp_flag` (L2 = Promise to Pay Later)
- the account's final/most-severe L1 & L2 (keep the existing disposition fields working)

Then extend the **`Aggregator`** (`src/lib/aggregate.mjs`) to roll those per-account fields
into new payload sections. This keeps ONE aggregation path and the union/Day-Total logic
for free. Anything that is a pure cross-account curve (attempt-conversion, hour-of-day)
is computed in the Aggregator from the per-account fields — so it re-derives correctly on
the Day Total union.

## Features to build (all proven feasible on the real file)

Add each as a new dashboard section (match the existing card style, `txt()` for text,
print-friendly). Add each figure to the payload and bump `PAYLOAD_VERSION`.

1. **Time-of-calling performance.** Calls and connect-rate by hour of day (data spans
   08:00–18:00). Best-performing calling windows. From `Call Timestamp`.
2. **Incremental conversion by attempt number.** For attempt N: connect rate, and the
   share of accounts whose first Paid disposition landed on attempt N. Show the curve and
   where it flattens. From `Attempt Number` + per-attempt L2.
   - **Label it "observed", not "optimal".** The dialer stops once an account resolves, so
     attempts and outcome are not independent. Describe the curve; do not claim a causal
     optimal. (Same discipline as the existing outcome-window handling.)
3. **Attempt intensity / Contact intensity.** Avg attempts per account, avg connected
   calls per account, dials-per-connect. Distribution across the book.
4. **Attempt % / Contact %.** Connected ÷ attempts (per-dial), and reached-accounts ÷
   book (per-lead). Keep both, clearly labelled — the codebase already distinguishes them.
5. **PTP generation & conversion.** Count of Promise-to-Pay-Later (443 on sample), and of
   those, how many the status file later resolved.
6. **Complaint metric.** Count and rate of accounts with a Potential Complaint disposition.
   New section — this is a compliance-relevant number RBL asked for.
7. **DNC / compliance.** Count of DNC dispositions; whether DNC accounts were dialled again
   afterwards (a real compliance check — use `Attempt Number` + timestamp ordering).
8. **AI-Only vs AI+Agency split.** The CYC file has an **`AI Agency`** column. On this
   sample it is a single value (`Convin_NEW`), so the split renders as "one cohort" for now
   — but wire it so that the moment a book contains two values, the comparison appears
   automatically (mirror how the existing Segment comparison degrades to one segment).
9. **Anonymisation.** This deliverable must contain **no customer names or phone numbers**
   anywhere — not even in Top-20. Replace names with a masked account id. Confirm
   `npm run check:pii` stays CLEAN.

## Do NOT build these (the data is not there — say so, don't fake it)

- **Tonality** — there is no tone/sentiment column in the call log. `Sense Disposition
  Reason` is free text, not a score. Leave a clearly-labelled placeholder; do not invent it.
- **Actual money collected (₹ paid)** — neither file carries a paid amount, only
  outstanding. Keep the existing "recovered = full outstanding on resolved" and its
  footnote; do not imply it is cash collected.
- **Named bot/agent-level performance** — `From Phone Num` (40 lines) is a weak proxy, not
  an agent identity. You may show per-line stats labelled "outbound line", but do not
  present it as "Agent X". Flag that a real `agent_id` is needed.
- **Wrong-party-contact** — no dedicated WPC flag exists. Do not derive one.

## When done

- `npm run test:all` passes (extend it — add invariants for the new sections, e.g. connect
  rate ≤ 100%, attempts_connected ≤ attempts_total, the attempt-conversion curve sums to
  the resolved count, complaint/DNC counts ≤ book).
- `npm run build` passes locally.
- Upload the three real demo files through `/upload` on `npm run dev` and confirm the new
  sections render with real numbers, and that the network tab shows small chunked POSTs
  (no 413).
- `npm run check:pii` prints CLEAN.
- Report what you changed, what you bumped `PAYLOAD_VERSION` to, and confirm the four
  "do not build" items were left as labelled placeholders.

## Files you will likely touch

`src/lib/sheet.mjs` (detect the call log), `src/lib/normalize.mjs` (aliases; reuse the key
parser), `src/lib/merge.mjs` or a new `callog.mjs` (attempt roll-up), `src/lib/aggregate.mjs`
(new sections), `src/lib/upload_client.mjs` (parse the call log in-browser),
`src/app/dashboard/Report.jsx` (render), `db/postgres/schema.sql` (only if you add
per-account columns), `evals/stress_*.mjs` (tests), `src/lib/payload_version.mjs` (bump).
