# RBL × Convin Dashboard — Claude Code Build-Prompt Pack (v2, full KPI spec)

**How to use:** paste into Claude Code **in order**, one at a time; review between prompts.
Keep the sample CSV (`Final RBL Dashboard Data - DASHBOARD DATA.csv`) and `RBL_Dashboard_Plan.md`
in the repo. Every "section" prompt implements the matching numbered section from the plan (§7).

Stack: **Next.js + TS + Tailwind + Framer Motion + TanStack Virtual + ECharts** (Vercel) ·
**Go** ingester (Fly.io/Railway) · **ClickHouse** analytics · **Postgres** metadata/auth · **GitHub** CI.
Global rule enforced everywhere: **Recovered = Σ total_outstanding WHERE status='Resolved'.**

---

## PROMPT 0 — Context & monorepo scaffold

```
Build a production, exec-facing "RBL × Convin AI Collections Intelligence Dashboard" that proves how
much credit-card outstanding Convin's AI voice agents recover for RBL Bank. Audience: RBL + Convin
execs. Look: cinematic, Apple "Titanium" palette, 120fps. Data = daily CSV uploads (up to 3×/day),
each retained as a dated snapshot. Core theme: validate what customers SAID on the AI call vs what they
actually DID (Resolved/Unresolved).

Create GitHub monorepo `rbl-convin-dashboard`:
  /apps/web (Next.js 14 App Router + TS + Tailwind + Framer Motion + TanStack Table/Virtual +
    echarts-for-react) → Vercel
  /services/ingester (Go 1.22: auth CSV upload → streaming parse → normalize → bulk load ClickHouse →
    batch registry in Postgres) → Fly.io
  /packages/shared (canonical schema, raw→canonical map, enums, INR formatters, shared TS types)
  /db (Postgres migrations + ClickHouse DDL)
  /docs (copy RBL_Dashboard_Plan.md here)
Set up pnpm workspaces, ESLint/Prettier, .env.example (POSTGRES_URL, CLICKHOUSE_URL, CLICKHOUSE_USER/PASS,
INGESTER_URL, NEXTAUTH_SECRET, ALLOWED_EMAILS), Docker Compose (Postgres+ClickHouse), root README,
GitHub Actions (lint+build web, build+test Go). Scaffold only — `pnpm dev` and `go run` boot cleanly.
```

---

## PROMPT 1 — Canonical schema & normalization (single source of truth)

```
In /packages/shared define the CANONICAL SCHEMA + normalization for the collections CSV.

Canonical fields: account_no, status(Resolved|Unresolved), lead_state, goal_achieved(Yes|No|Blank),
qual_status(Qualified|In Progress|Not Qualified|Blank), disp_l1, disp_l2, ai_attempts:int,
ai_connected_calls:int, ai_connected_seconds:int, due_date, minimum_amount_due:num,
total_outstanding:num, total_amount_due:num, total_accounts_with_customer:int, months_on_book:int,
curr_bal_band(20-30K|30-50K|50-70K|70-100K|100-200K|>200K), region, primary_state, primary_city,
title, customer_name, mobile, model_logic, paid_flag, promise_flag, refusal_flag,
payment_mode(UPI|PhonePe|Google Pay|Paytm|RBL App|Net/Online|Card|Other|NA), lead_link.

Normalization rules:
  1. Raw→canonical header map; handle DUPLICATE headers ("Segment"×2, "Minimum Amount Due" &
     "minimum_amount_due") by position.
  2. Balance band → canonical enum + fixed display order.
  3. Money: strip commas → float; empty → null (never 0).
  4. payment_mode: bucket 72 raw variants (case-insensitive keyword match) into the enum.
  5. ENTITY fields (paid_flag, promise_flag, refusal_flag): normalize to YES|NO|Blank|N/A.
     refusal_flag ALSO keeps its raw sub-reason (Can't Pay–Financial, Won't Pay–Intention, etc.)
     in a parallel field refusal_reason.
  6. NA/blank → null, classified "not yet worked".
  7. Header validation: missing account_no|status|total_outstanding → reject upload with clear error.

Export TS types, the map, enums/orders, and INR formatters (6.5e6→"₹65.0 L", 6.5e7→"₹6.50 Cr").
Unit-test the normalizer + formatters against the sample CSV.
```

---

## PROMPT 2 — Database schemas + all aggregates

```
Implement /db.

POSTGRES: users(id,email UNIQUE,name,role,created_at);
  upload_batch(batch_id UUID pk, report_date DATE, uploaded_at TIMESTAMPTZ, filename, row_count,
  status, uploaded_by, error_text). Index (report_date),(uploaded_at).

CLICKHOUSE:
  account_snapshot: all canonical fields + refusal_reason + batch_id + report_date.
    MergeTree PARTITION BY report_date ORDER BY (report_date,batch_id,account_no).
  batch_aggregate — Materialized Views per (batch_id,report_date) computing EVERY plan section:
    • portfolio: count, sum(total_outstanding), sum(minimum_amount_due), ai_attempts,
      ai_connected_calls, connection_rate
    • resolution: resolved/unresolved counts, resolution_rate,
      recovered = sumIf(total_outstanding,status='Resolved'), outstanding_pending
    • ENTITY MATRICES: for paid_flag, promise_flag, refusal_flag →
      count grouped by (response ∈ YES/NO/Blank/NA) × (status) [+ refusal_reason rollup]
    • ai_perf: not_connected, avg_connected_seconds, avg_attempts_per_customer,
      connected/not-connected × resolved/unresolved
    • goal: goal_achieved × status with recovered & outstanding
    • qualification: qual_status × status
    • disposition: per disp_l1 (and disp_l2): total, resolved, unresolved, outstanding, recovered
    • balance_band: per curr_bal_band: accounts, resolved, unresolved, resolution_rate, outstanding
    • state: per primary_state: accounts, outstanding, min_due, resolved, unresolved, resolution_rate,
      connection_rate
    • region: same per region (dynamic set)
    • multi_account: bucket total_accounts_with_customer ∈ {1,2,3+} × resolution_rate, outstanding, ptp_rate
    • duration: bucket ai_connected_seconds ∈ {<30,30-60,60-120,120-300,>300} × resolution%, ptp%,
      paid%, refusal%
    • recovery: resolved_customers, recovered, avg_recovery, outstanding_pending, recovery_pct
    • payment_mode: per mode → num_payments (count resolved w/ that mode), amount_collected
      (sumIf total_outstanding, status='Resolved')
    • kpi_cards: resolution_rate, connection_rate, ptp_conversion_rate, already_paid_validation_rate,
      refusal_to_payment_rate, avg_outstanding, avg_min_due, avg_connected_duration,
      avg_attempts, avg_recovery_per_resolved
    • funnel: total_accounts, accounts_attempted, accounts_connected, qualified, promise_to_pay,
      already_paid_claimed, actual_payments, resolved
  top_outstanding: top 20 by total_outstanding per batch (name, outstanding, state, connected, ptp, status).
  column_profile: per (batch_id,column): dtype, fill_pct, unique_count, top_values[(v,c)],
    numeric stats (min,max,mean,median,p25,p75,sum,histogram).

Idempotent migrations + `db/seed` that ingests the sample CSV as one batch dated today.
```

---

## PROMPT 3 — Go ingestion service

```
Build /services/ingester (Go 1.22, chi).
POST /upload (auth): multipart file=<csv>, report_date?=YYYY-MM-DD →
  stream-parse (encoding/csv, bounded memory) → apply the shared normalization (port to Go, keep in
  sync, incl. entity YES/NO/Blank/NA + refusal_reason + payment buckets) → validate headers (422 on
  missing critical) → create upload_batch (report_date default today) → bulk insert account_snapshot
  (50k/flush) → refresh column_profile + top_outstanding for the batch → return
  {batch_id, report_date, row_count, warnings[]}.
GET /health. Roll back batch rows + mark failed on error. Structured logging. Tests: normalizer +
integration test ingesting the sample CSV asserting recovered = sumIf(total_outstanding,'Resolved')
and resolution_rate ≈ 43.8%. Dockerfile + fly.toml.
```

---

## PROMPT 4 — Aggregation API (reads aggregates only)

```
In /apps/web add typed route handlers reading ONLY batch_aggregate / column_profile / top_outstanding
(raw rows only for the account table). All take ?batch_id= (day-total = merge that day's batches):
  /api/dates · /api/day?date= · /api/kpis · /api/portfolio · /api/resolution ·
  /api/entity?type=paid|promise|refusal · /api/ai-performance · /api/goal · /api/qualification ·
  /api/disposition · /api/balance-band · /api/state · /api/region · /api/multi-account ·
  /api/duration · /api/recovery · /api/payment-mode · /api/top-outstanding ·
  /api/funnel · /api/accounts?page=&q=&filters… · /api/columns · /api/trends?from=&to=
Centralize the Resolved-recovery rule in ONE server util. Cache responses. Tests assert the sample
batch: recovered ≈ ₹6.50 Cr, recovery% ≈ 42.8%, PTP conversion ≈ 25.6%, avg recovery/resolved ≈ ₹77.7K.
```

---

## PROMPT 5 — Apple Titanium design system & app shell

```
Build tokens + shell before charts. Tailwind theme + CSS vars (light+dark): Natural Titanium base
#8E8B82 / surface #F5F4F1, White/Silver surfaces, Black Titanium text #1D1D1F, one accent for
highlights/positive deltas. SF Pro (fallback Inter), large tight-tracked display numerals, frosted-glass
cards (backdrop-blur), soft depth, 16–24px radii, generous whitespace.
Components: <GlassCard>, <StatCounter> (spring count-up), <MatrixTable> (for entity validation),
<SectionHeader>, <Segmented> tabs, <InsightCallout>, <Skeleton>, <ThemeToggle>, <AppShell> (top bar with
date-navigator + upload slots; reveal-on-scroll content). Motion: transform/opacity only (120fps), springs,
will-change, content-visibility offscreen, respect prefers-reduced-motion. Ship a /kitchen-sink page.
```

---

## PROMPT 6 — Date navigator + same-day upload tabs (features 1 & 2)

```
DATE NAVIGATOR: Apple-style calendar in the top bar; dates with data (/api/dates) selectable; prev/next
day arrows; "Latest" shortcut; selected date in URL (?date=YYYY-MM-DD).
SAME-DAY TABS: for the date, /api/day → one tab per CSV (ordered by uploaded_at, label "Upload N · h:mm A"
+ row count) plus a first "Day Total" tab. Selecting sets ?batch_id= and every section refetches.
Crossfade between tabs (opacity/transform). Empty state for dates with no data. Fully shareable via URL.
```

---

## PROMPT 7 — Top KPI cards + Executive Hero (plan §6)

```
Row of hero money tiles (<StatCounter>): Outstanding Managed, RECOVERED (largest, accent), Recovery %,
Accounts Resolved (n/total), Talk-Minutes. Below: the KPI-card strip from /api/kpis — Resolution Rate,
AI Connection Rate, PTP Conversion Rate, Already-Paid Validation Rate, Refusal-to-Payment Rate,
Avg Outstanding/Customer, Avg Min Due, Avg AI Connected Duration, Avg Attempts/Customer,
Avg Recovery/Resolved. Count-up on load/tab-change, INR lakh/crore, delta vs previous batch (green up).
Cinematic staggered entrance, light+dark. This is the 5-second wow.
```

---

## PROMPT 8 — Entity Validation matrices (plan §7.3–7.5, the differentiator)

```
Build the "said vs did" Entity Validation section from /api/entity. Three <MatrixTable> cards —
Promise-to-Pay (promise_flag), Already-Paid (paid_flag), Refusal-to-Pay (refusal_flag) — each a
YES/NO/Blank/N-A × Resolved/Unresolved matrix with row/col totals and cell % shading (Titanium accent
heat). Under each, <InsightCallout>s: "promised & paid", "promised but didn't", "refused but later paid",
"AI couldn't detect a response". For Refusal, add an expandable sub-reason breakdown (refusal_reason).
Add a highlight stat: Already-Paid reliability (Paid=YES resolved ÷ all Paid=YES). Animate cells in.
```

---

## PROMPT 9 — AI Performance + Goal Achievement + Qualification (plan §7.6–7.8)

```
AI CALLING PERFORMANCE (/api/ai-performance): Attempts, Connected, Not-Connected, Connection Rate,
Avg Connected Duration, Avg Attempts/Customer; grouped bars comparing Connected/Not-Connected ×
Resolved/Unresolved with an insight ("connected accounts resolve at X% vs Y%").
GOAL ACHIEVEMENT (/api/goal): Achieved vs Not × Resolved/Unresolved, plus Recovery ₹ and Outstanding ₹ per group.
QUALIFICATION (/api/qualification): Qualified / In Progress / Not Qualified × Resolved/Unresolved.
ECharts stacked/grouped bars, animated transitions, Titanium styling, one insight callout each.
```

---

## PROMPT 10 — Collection Disposition + Balance Band (plan §7.9–7.10)

```
DISPOSITION ANALYSIS (/api/disposition): table+chart of every disp_l1 (expand to disp_l2) with Total,
Resolved, Unresolved, Outstanding ₹, Recovery ₹; sort by recovery; highlight highest-recovery dispositions.
BALANCE BAND PERFORMANCE (/api/balance-band): per curr_bal_band (fixed order) Accounts, Resolved,
Unresolved, Resolution %, Outstanding ₹; bar + resolution-rate line; insight on whether small/large
balances repay more. Cross-filter on click. Animated, Titanium.
```

---

## PROMPT 11 — State + Region performance (plan §7.11–7.12)

```
STATE-WISE (/api/state): India choropleth (ECharts map of India) coloured by a toggle
(Recovered / Outstanding / Resolution % / AI Connection %); tooltip shows Accounts, Outstanding, Min Due,
Resolved, Unresolved, Resolution %, Connection %; companion sortable table.
REGION-WISE (/api/region): same metrics per region, regions rendered DYNAMICALLY from data
(North/West/East now; South/Central auto-appear later). Click state/region to cross-filter. 120fps.
```

---

## PROMPT 12 — Multiple-Account + Conversation Duration (plan §7.13–7.14)

```
MULTIPLE-ACCOUNT (/api/multi-account): buckets 1 / 2 / 3+ (total_accounts_with_customer) vs Resolution
Rate, Outstanding ₹, PTP Rate — grouped bars + insight.
CONVERSATION DURATION (/api/duration): buckets <30s / 30–60s / 1–2m / 2–5m / >5m (ai_connected_seconds),
each showing Resolution %, PTP %, Already-Paid %, Refusal % — a multi-series bar/line with the headline
insight "longer AI conversations convert more" (sample: 27%→61%). This is a hero insight — style it prominently.
```

---

## PROMPT 13 — Recovery + Payment Mode + Top-20 (plan §7.15–7.17)

```
OUTSTANDING vs RECOVERY (/api/recovery): Resolved Customers, Recovered ₹, Avg Recovery, Outstanding
Pending, Recovery % — big tiles + a recovered-vs-pending split bar.
MODE OF PAYMENT (/api/payment-mode): UPI/PhonePe/Google Pay/Net Banking/Debit/Credit/Others → Number of
Payments + Amount Collected (Resolved rule); donut + bar.
TOP-20 HIGH OUTSTANDING (/api/top-outstanding): ranked cards/table — Customer Name, Outstanding ₹, State,
AI Connected, PTP, Status; privacy-mask toggle. Titanium styling, animated.
```

---

## PROMPT 14 — Complete Collection Funnel (plan §7.18)

```
Build the funnel from /api/funnel: Total Accounts → AI Attempted → AI Connected → Qualified →
Promise-to-Pay → Already-Paid Claimed → Actual Payments → Resolved. Animated ECharts funnel; each stage
shows count, % of total, and stage-to-stage conversion; LABEL the unit per stage (accounts vs calls).
Highlight the biggest drop-off with an insight callout ("bottleneck: X→Y"). GPU-smooth.
```

---

## PROMPT 15 — Account Explorer (virtualized table)

```
Fast table over /api/accounts using TanStack Table + Virtual with SERVER-SIDE keyset pagination (smooth
at millions of rows). Columns: account_no, customer_name, status pill, disp_l1/l2, region/state,
curr_bal_band, total_outstanding ₹, recovered ₹ (=outstanding if Resolved else 0), ai_attempts,
connected, payment_mode, link to Convin lead (lead_link, new tab). Debounced search (name/account/mobile),
column filters (status, region, band, disposition, entity flags), sortable, sticky header, privacy-mask
toggle, export current view to CSV. Titanium styling, subtle row motion.
```

---

## PROMPT 16 — Data Profiler (feature 4, plan §7.19)

```
Build the Data Profiler from /api/columns. For EVERY CSV column a frosted-glass card: name, detected
type, fill %, unique count; CATEGORICAL → top values with count + % mini-bars; NUMERIC → min/max/mean/
median/p25/p75/sum + histogram sparkline; a completeness meter; flags for sparse (<20%) or constant
(1 unique). Responsive grid, column search, sort by fill%/uniqueness/name. Renders the sample's ~31
columns correctly. Animate cards on scroll (opacity/transform).
```

---

## PROMPT 17 — Trends Over Time

```
Build Trends from /api/trends (one point per batch/date): line/area for Recovered ₹, Recovery %,
Resolution %, Connection %, Calls Made across a date range (default 30 days); range picker + granularity
toggle (per-upload vs per-day rollup); momentum highlighting (delta vs prior period, accent colour).
Smooth ECharts transitions, Titanium styling.
```

---

## PROMPT 18 — Collections Intelligence Layer (the annual-deal layer)

```
Build the Intelligence section — the layer that turns reporting into decisioning. Add ClickHouse
aggregates + /api endpoints + Titanium UI for:
  1. EXECUTIVE DEAL CASE: a server-side, deterministic plain-English narrative from the batch aggregates
     (recovered, entity reliability, recoverable opportunity, ROI). Render at the top as a hero callout.
     (Structure it so an optional LLM polish can be swapped in later.)
  2. RECOVERY ROI & SAVINGS (/api/roi): AI cost = connected-minutes × configurable ₹/min (+ optional
     platform fee) vs recovery-agency commission benchmark (configurable %, default 12%). Show cost per
     ₹100 recovered, ₹ saved vs agency, and an annualized projection. Expose the assumptions in a small
     settings popover.
  3. PROPENSITY-TO-RECOVER (/api/propensity): for every OPEN (Unresolved) account compute a 0–100 score +
     High/Med/Low tier from EMPIRICAL resolution rates conditioned on drivers (connected, duration bucket,
     promise_flag, disp_l1, qual_status, curr_bal_band, months_on_book) — an explainable weighted
     scorecard (naive-Bayes / evidence-weight style), NOT a black box. Return per-account contributing
     factors. UI: ranked table of open accounts by propensity × outstanding, with a factor breakdown on
     row expand.
  4. RECOVERABLE OPPORTUNITY (/api/opportunity): open outstanding by propensity tier + three action
     lists — Promised-to-Pay still open, Engaged ≥2min not closed, Claimed-paid-but-unresolved — each with
     ₹ total, count, and export.
  5. DIAL EFFICIENCY (/api/dial-efficiency): connect% + resolution% by attempt band; recommend a
     max-attempt policy + escalation for the hard core. Note the survivorship caveat in the UI.
  6. CONVERSATION-LENGTH OPTIMIZATION: reuse /api/duration to headline the 2–5min sweet spot as a
     prescriptive "target talk-time" callout.
  7. ENTITY-TRUTH INTELLIGENCE (/api/entity-truth): AI detection reliability + auto lists ("said not paid
     but recovered", "promised but still open").
  8. FORECAST & MOMENTUM (/api/forecast): run-rate projection across snapshots + day-over-day momentum
     alerts; degrade gracefully to one snapshot.
Keep every number explainable and every assumption configurable. Best-time-to-call: render a locked
"unlocks when per-call timestamps are added" placeholder (not in current data — do NOT fabricate).
Titanium styling, animated, insight-callout components.
```

---

## PROMPT 19 — Auth + Upload page

```
NextAuth email-allowlist (ALLOWED_EMAILS; magic-link or credentials); gate the whole app; clean Titanium
sign-in. /upload page (auth): drag-drop CSV, optional report-date (default today) → POST to Go ingester →
progress → success summary (batch_id, rows, warnings) + "View dashboard" deep-link to that date+batch;
show ingester validation errors clearly; table of recent uploads (upload_batch) with status + row counts.
```

---

## PROMPT 20 — Ship: polish, performance, deploy

```
Final pass: verify 120fps (transform/opacity-only, virtualization, content-visibility, memoization);
Lighthouse ≥95 perf on the dashboard; flawless on boardroom 4K + laptop, graceful tablet; a11y (focus,
prefers-reduced-motion, contrast both themes); empty/error/loading states + skeletons everywhere.
Deploy GitHub → Vercel (apps/web) + Fly.io (services/ingester) + Neon/Supabase (Postgres) + ClickHouse
Cloud; wire env, run migrations, seed sample batch; document one-command deploy in README. Write
docs/DEMO.md: an RBL walkthrough — hero/KPIs → entity validation → AI performance → duration insight →
disposition/band → geography → recovery/payments → funnel → profiler → trends.
```

---

### Adding features later
Each new feature follows the pattern: extend the ClickHouse aggregate → add an /api endpoint → add a
Titanium section/prompt. The canonical schema, normalization, entity YES/NO/Blank/NA mapping, and the
Resolved-recovery rule stay fixed, so additions slot in without rework.
