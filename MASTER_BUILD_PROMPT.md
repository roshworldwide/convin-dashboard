# MASTER BUILD PROMPT — RBL × Convin AI Collections Intelligence Dashboard

> **How to use:** open a fresh Claude Code session in an empty folder, keep the file
> `Final RBL Dashboard Data - DASHBOARD DATA.csv` in that folder, and paste **everything below the
> line** as your first message. Claude Code will plan, scaffold, build, test, and deploy. Build
> incrementally (it will create its own todo list); review after each phase.

---

You are a principal full-stack engineer + product designer. Build a **production-grade, exec-facing
"AI Collections Intelligence Dashboard"** for **Convin** (an AI voice-agent company) to present to
**RBL Bank**. Convin's AI agents call RBL credit-card customers who are behind on payments and drive
recovery. **Business goal of this dashboard: impress RBL so strongly that they sign Convin to an annual
contract.** It must be beautiful, cinematic, buttery-smooth (target 120fps), and genuinely intelligent —
not just a report, but a decisioning tool.

Work in phases with a todo list. After each phase, run the tests/acceptance checks for that phase before
moving on. Do not fabricate data or metrics; where a metric needs data we don't have, show a clear
"unlocks when X is added" placeholder. Keep the ONE business rule below correct everywhere.

═══════════════════════════════════════════════════════════════════════════════
## 1. THE WINNING NARRATIVE
═══════════════════════════════════════════════════════════════════════════════
Audience: RBL executives + Convin executives. The dashboard tells one story in layers:
(1) how much money Convin's AI recovered, (2) proof the AI's conversations *caused* recovery,
(3) validation of what customers *said* vs what they *did*, and (4) intelligence on what to do next and
what it's worth — the ROI + opportunity that justifies an annual deal.

═══════════════════════════════════════════════════════════════════════════════
## 2. THE DATA
═══════════════════════════════════════════════════════════════════════════════
Source: daily CSV uploads (up to 3× per day), each retained as a dated snapshot. Production must handle
**millions of rows/day**. Seed sample: `Final RBL Dashboard Data - DASHBOARD DATA.csv` (1,908 rows).

Raw columns (verbatim, messy — a normalization layer is mandatory):
`Account No, Status, Lead Link, Lead State, Goal Achieved, Qualification Status,
CollectionsDisposition_v2 L1, CollectionsDisposition_v2 L2, Total AI Call Attempts, AI Connected Calls,
AI Connected Seconds, due_date, minimum_amount_due, Segment, total_outstanding,
Lead Entity If payment done return 'Mode of Payment, Lead Entity Paid, Lead Entity Promise to Pay,
Lead Entity Refusal to pay, Total Accounts with customer, Total Amount Due, Minimum Amount Due,
Months on Book, Curr Bal Band, Segment, Title, Customer Name, Primary City, Primary State,
Mobile Number -1, Region, As Per New Logic M2`

Data quirks to handle at ingestion:
- **Duplicate headers**: "Segment" appears twice; "Minimum Amount Due" & "minimum_amount_due" both exist.
  Resolve by column position → canonical keys.
- **Casing** in balance bands: `30-50k` vs `70-100K` → normalize.
- **Money as strings** with commas → numeric; empty → null (never 0).
- **72 messy payment-mode variants** (UPI, PhonePe, "online", "App", "credit app"…) → clean buckets.
- **Entity fields** carry YES/NO/blank/NA and (for refusal) rich sub-reasons.
- `Segment` is constant ("Red"); `due_date` is constant in the sample — tolerate low-cardinality columns.

Validated headline numbers (use as acceptance targets on the seed CSV):
- Total outstanding **₹15.18 Cr**; **Recovered ₹6.50 Cr = 42.8%**; Resolved **836/1908 = 43.8%**.
- Attempts **18,603** → connected **3,144** = **16.9%**; avg **9.8** attempts/customer; avg connected **59s**.
- Avg recovery/resolved customer **₹77,704**.
- Open (unresolved) outstanding **₹8.69 Cr**; of which promised-to-pay-still-open **₹1.14 Cr (169)**,
  engaged ≥2min-not-closed **₹1.90 Cr (230)**, claimed-paid-but-unresolved **₹0.28 Cr (39)**.
- Duration→resolution: not-connected 27% → <30s 39% → 30–60s 42% → 1–2m 54% → 2–5m **61%** → >5m 61%.
- PTP conversion (PTP=YES & Resolved ÷ PTP=YES) **25.6%**; Already-Paid entity reliability ≈ **90%**.

═══════════════════════════════════════════════════════════════════════════════
## 3. NON-NEGOTIABLE BUSINESS RULES
═══════════════════════════════════════════════════════════════════════════════
1. **Recovery rule (central):** if `Status = Resolved`, count the account's **entire `total_outstanding`
   as recovered**, regardless of any paid amount. `Recovered = Σ total_outstanding WHERE status='Resolved'`.
   The same definition powers per-disposition, per-state, per-band, per-mode recovery. Put it in ONE
   shared server util reused everywhere; unit-test it.
2. Resolution Rate = Resolved ÷ Total. Recovery % = Recovered ÷ Σ total_outstanding.
3. Connection Rate = AI Connected Calls ÷ AI Call Attempts.
4. Entity fields normalize to **YES / NO / Blank / N/A** (refusal keeps sub-reasons too).
5. INR formatting with lakh/crore abbreviation everywhere (₹6.50 Cr, ₹79.5 K).

═══════════════════════════════════════════════════════════════════════════════
## 4. TECH STACK & REPOSITORY
═══════════════════════════════════════════════════════════════════════════════
Monorepo `rbl-convin-dashboard` (pnpm workspaces), pushed to GitHub:
- `/apps/web` — **Next.js 14 (App Router) + TypeScript + Tailwind + Framer Motion + TanStack
  Table/Virtual + ECharts (echarts-for-react)**. Deploys to **Vercel**. Holds the UI + read-only
  aggregate API route handlers.
- `/services/ingester` — **Go 1.22** service (chi router): authenticated CSV upload, streaming parse,
  normalization, bulk load into ClickHouse, batch registry in Postgres. Deploys to **Fly.io/Railway**.
- `/packages/shared` — canonical schema, raw→canonical map, enums/orders, entity normalization, payment
  buckets, INR formatters, shared TS types (Go mirrors this — keep in sync + tests both sides).
- `/db` — Postgres migrations (auth/users/upload_batch) + ClickHouse DDL (account_snapshot,
  batch_aggregate MVs, column_profile, top_outstanding, propensity inputs).
- `/docs` — architecture notes + a DEMO.md exec walkthrough.
Tooling: ESLint/Prettier, Docker Compose (Postgres + ClickHouse) for local dev, `.env.example`
(POSTGRES_URL, CLICKHOUSE_URL/USER/PASS, INGESTER_URL, NEXTAUTH_SECRET, ALLOWED_EMAILS, ROI assumptions),
GitHub Actions (lint+build web; build+test Go), root README with one-command run + deploy.

**Datastores:** ClickHouse (columnar OLAP) for all analytics/aggregates/column-profiles at scale;
Postgres (Neon/Supabase) for auth + upload/batch metadata.

═══════════════════════════════════════════════════════════════════════════════
## 5. ARCHITECTURE & DATA FLOW
═══════════════════════════════════════════════════════════════════════════════
Upload CSV → Go ingester streams + normalizes (bounded memory) → bulk insert into ClickHouse
`account_snapshot` tagged with `batch_id` + `report_date` → ClickHouse materialized views refresh
`batch_aggregate`, `column_profile`, `top_outstanding` → Next.js API route handlers read ONLY
pre-computed aggregates (raw rows only for the paginated account table) → browser renders aggregates +
one virtualized page. The browser NEVER receives millions of raw rows.

═══════════════════════════════════════════════════════════════════════════════
## 6. DATA MODEL — DAILY SNAPSHOTS + SAME-DAY TABS
═══════════════════════════════════════════════════════════════════════════════
- `upload_batch` (Postgres): `batch_id, report_date, uploaded_at, filename, row_count, status,
  uploaded_by, error_text`. `report_date` defaults to upload date, editable at upload.
- `account_snapshot` (ClickHouse): all canonical fields + `refusal_reason` + `batch_id` + `report_date`.
  `MergeTree PARTITION BY report_date ORDER BY (report_date, batch_id, account_no)`.
- Materialized views compute every section's aggregates per `(batch_id, report_date)`.

**Navigation features (must-have):**
- **Daily view:** an Apple-style calendar/date navigator; dates with data are selectable; prev/next day
  + "Latest"; selected date in URL (`?date=YYYY-MM-DD`).
- **Same-day tabs:** if N CSVs were uploaded that day, show **N tabs** (labeled "Upload N · h:mm A" +
  row count, ordered by `uploaded_at`) plus a leading **"Day Total"** tab that merges the day. Selecting a
  tab sets `?batch_id=` and every section refetches. Crossfade transitions. State fully shareable via URL.

═══════════════════════════════════════════════════════════════════════════════
## 7. CANONICAL SCHEMA & NORMALIZATION (in /packages/shared, mirrored in Go)
═══════════════════════════════════════════════════════════════════════════════
Canonical fields: `account_no, status(Resolved|Unresolved), lead_state, goal_achieved(Yes|No|Blank),
qual_status(Qualified|In Progress|Not Qualified|Blank), disp_l1, disp_l2, ai_attempts:int,
ai_connected_calls:int, ai_connected_seconds:int, due_date, minimum_amount_due:num, total_outstanding:num,
total_amount_due:num, total_accounts_with_customer:int, months_on_book:int,
curr_bal_band(20-30K|30-50K|50-70K|70-100K|100-200K|>200K), region, primary_state, primary_city, title,
customer_name, mobile, model_logic, paid_flag(YES|NO|Blank|NA), promise_flag(YES|NO|Blank|NA),
refusal_flag(YES|NO|Blank|NA), refusal_reason, payment_mode(UPI|PhonePe|Google Pay|Paytm|RBL App|
Net/Online|Card|Other|NA), lead_link`.
Rules: dedupe headers by position; band casing → enum + fixed order; money → float/null; payment_mode
keyword-bucketed; entity fields → YES/NO/Blank/NA (+ refusal_reason); NA/blank → null ("not yet worked");
missing critical headers (account_no/status/total_outstanding) → reject upload with a clear message;
unknown headers stored + flagged. Export INR formatters. Unit-test normalizer + formatters vs the sample.

═══════════════════════════════════════════════════════════════════════════════
## 8. DASHBOARD — SECTIONS (implement ALL; each maps to a precomputed aggregate + API + Titanium UI)
═══════════════════════════════════════════════════════════════════════════════
**Top KPI cards (always visible):** Resolution Rate %, AI Connection Rate %, PTP Conversion Rate %,
Already-Paid Validation Rate %, Refusal-to-Payment Rate %, Avg Outstanding/Customer, Avg Min Due,
Avg AI Connected Duration, Avg Attempts/Customer, Avg Recovery/Resolved. Plus hero money tiles:
Outstanding Managed, **Recovered ₹** (largest, accent), Recovery %, Accounts Resolved, Talk-Minutes.
All animate with spring count-ups and show a delta vs the previous batch.

1. **Overall Portfolio Summary** — Total Accounts, Outstanding, Min Due, AI Attempts, Connected, Connect %.
2. **Resolution Summary** — Resolved/Unresolved, Resolution %, Recovered ₹, Outstanding Pending.
3. **Promise-to-Pay Validation** — matrix `promise_flag` (YES/NO/Blank/NA) × Resolved/Unresolved, totals + % heat.
4. **Already-Paid Validation** — matrix `paid_flag` × status (highlight ≈90% reliability).
5. **Refusal-to-Pay Validation** — matrix `refusal_flag` × status, with expandable `refusal_reason`.
6. **AI Calling Performance** — Attempts, Connected, Not-Connected, Connect %, Avg Duration,
   Avg Attempts/Customer; compare Connected/Not-Connected × Resolved/Unresolved.
7. **Goal Achievement** — `goal_achieved` × status + Recovery ₹ & Outstanding ₹ per group.
8. **Qualification Status** — `qual_status` × status.
9. **Collection Disposition** — per `disp_l1` (expand `disp_l2`): Total, Resolved, Unresolved,
   Outstanding ₹, **Recovery ₹**; sort by recovery.
10. **Balance Band Performance** — per `curr_bal_band` (fixed order): Accounts, Resolved, Unresolved,
    Resolution %, Outstanding ₹.
11. **State-wise Performance** — India **choropleth map** (toggle Recovered/Outstanding/Resolution%/Connect%)
    + table (Accounts, Outstanding, Min Due, Resolved, Unresolved, Resolution %, Connect %).
12. **Region-wise Performance** — same per `region`, rendered **dynamically** from data (North/West/East
    now; South/Central auto-appear when present).
13. **Multiple-Account Analysis** — `total_accounts_with_customer` buckets 1/2/3+ vs Resolution Rate,
    Outstanding, PTP Rate.
14. **Conversation Duration Analysis** — `ai_connected_seconds` buckets <30s/30–60s/1–2m/2–5m/>5m →
    Resolution %, PTP %, Already-Paid %, Refusal %. Headline the rising-resolution insight.
15. **Outstanding vs Recovery** — Resolved Customers, Recovered ₹, Avg Recovery, Outstanding Pending, Recovery %.
16. **Mode of Payment** — per `payment_mode`: #Payments, Amount Collected (Resolved rule).
17. **Top-20 High Outstanding** — Customer, Outstanding, State, AI Connected, PTP, Status (+ PII mask toggle).
18. **Complete Collection Funnel** — Total Accounts → AI Attempted → AI Connected → Qualified →
    Promise-to-Pay → Already-Paid Claimed → Actual Payments → Resolved; label each stage's unit
    (calls vs accounts); highlight biggest drop-off.
19. **Data Profiler** — per CSV column: type, fill %, unique count; categorical → top values w/ mini-bars;
    numeric → min/max/mean/median/p25/p75/sum + histogram; flags for sparse/constant.
20. **Account Explorer** — virtualized, server-paginated (keyset) table over all rows; columns incl.
    status pill, disp, region/state, band, outstanding, recovered (=outstanding if Resolved else 0),
    attempts, connected, payment_mode, link to Convin lead; search (name/account/mobile), filters, sort,
    PII mask, CSV export.
21. **Trends Over Time** — Recovered ₹, Recovery %, Resolution %, Connect %, Calls across snapshots;
    range picker + per-upload/per-day granularity; momentum highlighting.

**High-impact comparison callouts** (surface as `<InsightCallout>` across sections): PTP→resolution,
Already-Paid→resolution, Refusal→resolution, Connected vs Not→resolution, Disposition→resolution,
Band→resolution, State/Region→recovery, Duration→payment, Qualification→resolution, Goal→payment.

═══════════════════════════════════════════════════════════════════════════════
## 9. COLLECTIONS INTELLIGENCE LAYER  ← the annual-deal layer, build this fully
═══════════════════════════════════════════════════════════════════════════════
Every number explainable; every assumption configurable (settings popover + env defaults). Modules:

**9.1 Executive Deal Case (auto-narrative).** Server-side deterministic plain-English paragraph from the
batch aggregates: recovered ₹ + rate, entity reliability, recoverable opportunity, ROI headline. Render as
a hero callout at the very top. Structure so an optional LLM polish can be swapped in later.

**9.2 Recovery ROI & Savings.** `AI_cost = connected_minutes × ₹/min (default ₹5, configurable) + optional
platform_fee`. Benchmark against a recovery-agency commission (default **12%** of recovered, configurable).
Show: cost per ₹100 recovered, ₹ saved vs agency, and an **annualized projection**. On the seed data this
is ~₹0.02 per ₹100 vs ~₹78 L agency cost — make the contrast unmissable but honest/configurable.

**9.3 Propensity-to-Recover (explainable scorecard).** For every **open** account output a **0–100 score**
+ High/Med/Low tier. Method: compute empirical resolution rates conditioned on each driver
(`ai_connected_calls>0`, duration bucket, `promise_flag`, `disp_l1`, `qual_status`, `curr_bal_band`,
`months_on_book`) from resolved history, then combine (evidence-weight / naive-Bayes style) into a per-
account score. **Return the contributing factors per account** (banks need auditability — no black box).
UI: ranked table of open accounts by propensity × outstanding, factor breakdown on row-expand.

**9.4 Recoverable Opportunity ("money on the table").** Open outstanding split by propensity tier + three
export-ready action lists with ₹ + count: Promised-to-Pay-still-open (~₹1.14 Cr / 169),
Engaged ≥2min-not-closed (~₹1.90 Cr / 230), Claimed-paid-but-unresolved (~₹0.28 Cr / 39). Framing:
"renew Convin → we target ₹X of this next cycle."

**9.5 Dial-Efficiency Optimization.** Connect % + resolution % by attempt band; recommend a max-attempt
policy + escalation (settlement/field visit) for the hard core still open past ~10 attempts. Show the
**survivorship caveat** in the UI (resolved accounts stop being dialed) — frame as segmentation, not causation.

**9.6 Conversation-Length Optimization.** Reuse duration analysis to headline the **2–5 min sweet spot**
(27%→61%) as a prescriptive "target talk-time" for the AI.

**9.7 Entity-Truth Intelligence.** AI entity-detection reliability + auto target lists:
"said not-paid but recovered" (~84) and "promised but still open" (~169).

**9.8 Forecast & Momentum.** Run-rate projection across snapshots (daily/weekly/quarterly trajectory) +
day-over-day momentum alerts ("recovery +12% vs yesterday, led by North"). Degrade gracefully to one snapshot.

**Do NOT fabricate best-time-to-call** (needs per-call timestamps, absent here) — show a locked
"unlocks when call-time data is added" placeholder.

═══════════════════════════════════════════════════════════════════════════════
## 10. DESIGN SYSTEM — APPLE "TITANIUM" (pure Apple aesthetic, no company logos)
═══════════════════════════════════════════════════════════════════════════════
- **Palette (light + dark):** Natural Titanium base `#8E8B82`, warm surface `#F5F4F1`; White/Silver
  Titanium surfaces; Black Titanium text `#1D1D1F`; ONE accent (Blue/Desert Titanium, ~`#4A6D8C`/`#B8A28E`)
  for highlights & positive deltas. Semantic green/amber/red used sparingly for status only.
- **Type:** SF Pro (fallback Inter). Large, tight-tracked display numerals for hero/KPIs.
- **Surfaces:** frosted glass (`backdrop-blur`), soft layered shadows, generous whitespace, 16–24px radii.
- **Motion (target 120fps):** animate **transform/opacity only** (never layout), spring easings, number
  count-ups, animated funnels & chart transitions, `will-change`, `content-visibility:auto` for offscreen
  sections, virtualization for long lists, route-level code splitting. Respect `prefers-reduced-motion`.
- Ship a `/kitchen-sink` page showing every component in light + dark. Flawless on boardroom 4K + laptop;
  graceful tablet layout.

═══════════════════════════════════════════════════════════════════════════════
## 11. AUTH, SECURITY, PII
═══════════════════════════════════════════════════════════════════════════════
NextAuth email-allowlist (`ALLOWED_EMAILS`); gate the whole app; clean Titanium sign-in. Upload endpoint
authenticated + rate-limited; server-side schema validation before any write. PII (mobile, name) visible
only to authorized users, with a **privacy-mask toggle** for screen-sharing. No secrets in the client.

═══════════════════════════════════════════════════════════════════════════════
## 12. PERFORMANCE & SCALE
═══════════════════════════════════════════════════════════════════════════════
Millions of rows/day: Go streams + bulk-inserts; ClickHouse MVs precompute; API returns tiny JSON;
account table uses server-side keyset pagination + virtualization. Dashboard Lighthouse performance ≥ 95.
Aggregate endpoints respond fast under load (cache per batch). Index/order keys on
`report_date, batch_id, account_no, status, region, curr_bal_band, disp_l1`.

═══════════════════════════════════════════════════════════════════════════════
## 13. DEPLOYMENT (GitHub-driven)
═══════════════════════════════════════════════════════════════════════════════
GitHub → **Vercel** (`/apps/web`) + **Fly.io/Railway** (`/services/ingester`) + **Neon/Supabase**
(Postgres) + **ClickHouse Cloud**. Provide Dockerfile + fly.toml for the Go service, wire env vars, run
migrations, `db/seed` the sample CSV as a batch dated today, and document a one-command deploy in README.

═══════════════════════════════════════════════════════════════════════════════
## 14. ACCEPTANCE CRITERIA (write tests; must pass on the seed CSV)
═══════════════════════════════════════════════════════════════════════════════
- Ingesting the seed CSV yields: Recovered ≈ **₹6.50 Cr**, Recovery % ≈ **42.8%**, Resolution ≈ **43.8%**,
  Connect ≈ **16.9%**, avg recovery/resolved ≈ **₹77.7K**, PTP conversion ≈ **25.6%**.
- Open outstanding ≈ **₹8.69 Cr**; opportunity lists ≈ ₹1.14 Cr / ₹1.90 Cr / ₹0.28 Cr.
- Duration→resolution curve is monotonic-ish up to the 2–5m bucket (~61%).
- Normalizer collapses the 72 payment variants into the clean bucket set; duplicate headers resolved.
- Recovery rule is defined once and reused; changing it changes all sections consistently.
- Date navigator + same-day tabs work; uploading a 2nd CSV for a date creates a 2nd tab; "Day Total" merges.
- Propensity scores are explainable (factors returned) and only computed for open accounts.
- 120fps feel: no layout-thrash animations; virtualized table stays smooth at 100k+ seeded rows.

═══════════════════════════════════════════════════════════════════════════════
## 15. BUILD ORDER
═══════════════════════════════════════════════════════════════════════════════
1) Scaffold monorepo + tooling + Docker Compose. 2) Shared canonical schema + normalization + tests.
3) DB schemas (Postgres + ClickHouse MVs for all sections + intel inputs). 4) Go ingester + tests + seed.
5) Aggregation API (all endpoints; Resolved rule util). 6) Design system + app shell + kitchen-sink.
7) Date navigator + same-day tabs. 8) Top KPI cards + Executive hero. 9) Entity-validation matrices.
10) AI performance + goal + qualification. 11) Disposition + balance band. 12) State + region maps.
13) Multiple-account + conversation-duration. 14) Recovery + payment mode + top-20. 15) Funnel.
16) Account explorer. 17) Data profiler. 18) Trends. 19) **Collections Intelligence layer (§9)**.
20) Auth + upload page. 21) Polish + performance pass + deploy + DEMO.md.

Confirm the plan as a todo list, then start at step 1. Ask me only if a decision is truly blocking;
otherwise choose sensible, production-grade defaults and proceed.
