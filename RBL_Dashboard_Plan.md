# RBL × Convin — AI Collections Performance Dashboard
### Master Plan & Architecture (v2 — aligned to "RBL DASHBOARD PLAN" KPI spec)

> **Goal:** A cinematic, Apple-grade **collections-intelligence** dashboard that proves to RBL Bank
> how much credit-card outstanding Convin's AI voice agents recover — persuasive enough to win and
> retain RBL. Audience: RBL + Convin execs. Data: daily CSV uploads (up to 3×/day), production-scale.

> **The differentiating idea (from the spec):** *validate what customers **said** on the AI call
> against what they **actually did**.* Promise-to-Pay / Already-Paid / Refusal entities detected by the
> AI, cross-tabbed against Resolved vs Unresolved. This turns an operational report into intelligence.

---

## 1. Locked Decisions

| Decision | Choice |
|---|---|
| Data mode | **Live from day 1** via daily CSV uploads (up to 3×/day), each retained as a dated snapshot |
| Planning output | This plan + a copy-paste **Claude Code build-prompt pack** |
| Audience / tone | RBL + Convin execs — **story-first, cinematic**, credible |
| Branding | **Pure Apple Titanium** aesthetic (no company logos) |
| Frontend | **Next.js (App Router) + TypeScript + Tailwind + Framer Motion + TanStack Table/Virtual + ECharts** → Vercel |
| Ingestion/analytics backend | **Go** service (streaming CSV parse + normalization + bulk load) → Fly.io / Railway |
| Analytics store | **ClickHouse** (columnar OLAP) for aggregates + per-column stats at scale |
| App/metadata store | **Postgres** (Neon/Supabase): auth, users, upload/batch registry |
| Deploy / CI | **GitHub** → Vercel (frontend) + Fly.io/Railway (Go service) |

---

## 2. Headline Numbers (validated against the sample, 1,908 accounts)

- **₹15.18 Cr** total outstanding · **₹6.50 Cr recovered** (Resolved rule) = **42.8% by value**
- **836 resolved (43.8%)** · **18,603** attempts → **3,144** connected (**16.9%**) · avg 9.8 attempts/cust
- **Avg recovery per resolved customer: ₹77,704** · avg AI connected duration **59 s**
- **Duration → resolution:** not-connected 27% → <30s 39% → 1–2m 54% → 2–5m **61%**
- **Already-Paid entity reliability:** "Paid=YES" → 357 Resolved vs 39 Unresolved (~90% matched)

---

## 3. Core Business Rules

1. **Recovery rule (critical):** if `Status = Resolved`, the account's **entire `total_outstanding`
   is counted as recovered**, regardless of any "paid" amount. `Recovered = Σ total_outstanding
   WHERE Status='Resolved'`. Same definition powers per-disposition / per-state / per-mode recovery.
2. **Resolution Rate** = Resolved ÷ Total accounts. **Recovery %** = Recovered ÷ Σ total_outstanding.
3. **Connection Rate** = AI Connected Calls ÷ AI Call Attempts.
4. **Entity response normalization:** each `Lead Entity …` field maps to **YES / NO / Blank / N/A**
   (plus richer sub-reasons for Refusal — see §7.5).
5. INR formatting with lakh/crore abbreviation (₹6.50 Cr, ₹79.5 K).

---

## 4. Data Model — Daily Snapshots + Same-Day Tabs

- **Feature A — Daily view:** browse the dashboard for any past date via a calendar/date navigator.
- **Feature B — Same-day tabs:** N CSVs uploaded on one day → **N tabs** (one dashboard each) + a
  **"Day Total"** combined tab.

**Entities**
- `upload_batch` (Postgres): `batch_id, report_date, uploaded_at, filename, row_count, status, uploaded_by`.
- `account_snapshot` (ClickHouse): normalized rows tagged `batch_id`+`report_date`; PARTITION BY
  `report_date`, ORDER BY `(report_date, batch_id, account_no)`.
- `batch_aggregate` (ClickHouse MVs): every KPI/section in §6–§7 pre-computed per batch.
- `column_profile` (ClickHouse): per-column stats per batch (§7.19).

Trends read one aggregate row per batch/date — cheap across years of history.

---

## 5. Normalization Layer (in the Go ingester)

Cleans the raw CSV so every upload renders perfectly:
- **Duplicate headers** ("Segment" ×2; "Minimum Amount Due" & "minimum_amount_due") resolved by position → canonical keys.
- **Balance-band casing** (`30-50k` vs `70-100K`) → canonical enum + fixed order.
- **Money strings** with commas → numeric; empty → null (never 0).
- **Payment modes** — 72 raw variants → clean buckets (UPI, PhonePe, Google Pay, Paytm, RBL App, Net/Online, Card, Other).
- **Entity fields** → YES/NO/Blank/N/A (Refusal keeps sub-reasons).
- **NA/blank** → null, surfaced as "not yet worked", never distorting averages.
- **Schema-drift guard:** validate headers each upload; missing critical columns reject with a clear error.

---

## 6. Top KPI Cards (always visible)

From the spec's "Additional KPIs": Resolution Rate % · AI Connection Rate % · PTP Conversion Rate % ·
"Already Paid" Validation Rate % · Refusal-to-Payment Conversion Rate % · Avg Outstanding/Customer ·
Avg Minimum Due · Avg AI Connected Duration · Avg AI Attempts/Customer · Avg Recovery/Resolved Customer.
Plus the hero money tiles: Outstanding Managed, **Recovered ₹**, Recovery %, Accounts Resolved, Talk-Minutes.

---

## 7. Full Section Spec (18 sections, mapped to CSV → canonical field)

**Portfolio & Resolution**
1. **Overall Portfolio Summary** — Total Accounts, Total Outstanding (`total_outstanding`), Total Min Due
   (`minimum_amount_due`), AI Attempts (`ai_attempts`), Connected (`ai_connected_calls`), Connection Rate %.
2. **Resolution Summary** — Resolved / Unresolved (`status`), Resolution Rate %, **Recovered** (Resolved rule),
   Outstanding Pending.

**Entity Validation — "said vs did" (the differentiator)**
3. **Promise-to-Pay Validation** (`promise_flag`) — matrix YES/NO/Blank/N/A × Resolved/Unresolved.
4. **Already-Paid Validation** (`paid_flag`) — same matrix. (Sample: Paid=YES → 357 Resolved / 39 Unresolved.)
5. **Refusal-to-Pay Validation** (`refusal_flag`) — same matrix, keeping sub-reasons (Can't Pay–Financial,
   Won't Pay–Intention, etc.); highlights "refused but later paid".

**AI Performance & Objectives**
6. **AI Calling Performance** — Attempts, Connected, Not-Connected, Connection Rate, Avg Duration
   (`ai_connected_seconds`), Avg Attempts/Customer; compare Connected/Not-Connected × Resolved/Unresolved.
7. **Goal Achievement** (`goal_achieved`) — Achieved vs Not, against Resolved/Unresolved, with Recovery & Outstanding ₹.
8. **Qualification Status** (`qual_status`) — Qualified / In Progress / Not Qualified × Resolved/Unresolved.

**Collection Journey**
9. **Collection Disposition Analysis** (`disp_l1`/`disp_l2`) — for every disposition: Total, Resolved,
   Unresolved, Outstanding ₹, **Recovery ₹**. Identifies highest-recovery responses.
10. **Balance Band Performance** (`curr_bal_band`) — per band: Accounts, Resolved, Unresolved, Resolution %, Outstanding ₹.

**Geographic**
11. **State-wise Performance** (`primary_state`) — per state: Accounts, Outstanding, Min Due, Resolved,
    Unresolved, Resolution %, AI Connection %. India choropleth heat-map.
12. **Region-wise Performance** (`region`) — same, per region (render whatever regions exist; see §9 nuance).

**Relationship & Conversation Quality**
13. **Multiple-Account Analysis** (`total_accounts_with_customer`) — 1 / 2 / 3+ accounts vs Resolution Rate,
    Outstanding, PTP Rate.
14. **Conversation Duration Analysis** (`ai_connected_seconds`) — buckets <30s / 30–60s / 1–2m / 2–5m / >5m →
    Resolution %, PTP %, Already-Paid %, Refusal %. (Proven: resolution rises with duration.)

**Recovery & Payments**
15. **Outstanding vs Recovery** — Resolved Customers, Recovered ₹, Avg Recovery, Outstanding Pending, Recovery %.
16. **Mode of Payment** (`payment_mode`) — UPI/PhonePe/GPay/Net Banking/Debit/Credit/Others → #Payments, Amount Collected.
17. **High Outstanding Accounts (Top 20)** — Customer Name, Outstanding, State, AI Connected, PTP, Status.

**Funnel**
18. **Complete Collection Funnel** — Total Accounts → AI Attempted → AI Connected → Qualified → Promise-to-Pay →
    Already-Paid Claimed → Actual Payments → Resolved; shows drop-off/bottlenecks.

**19. Data Profiler** (requested feature 4) — per-column: type, fill %, unique count, top values + freq
(categorical), min/max/mean/median/p25/p75/sum/histogram (numeric).

**20. Account Explorer** — virtualized, searchable, filterable table over all rows; link per row to the Convin lead.

**21. Trends Over Time** — recovery ₹, recovery %, resolution %, connection %, calls, across snapshots.

---

## 7A. Collections Intelligence Layer — *the annual-deal layer*

Descriptive charts win a pilot; **intelligence wins the annual contract**. This layer shifts the
dashboard from "what happened" to "what to do next and what it's worth." All figures below are
validated on the sample and are **configurable** where assumptions are involved.

1. **Executive Deal Case (auto-narrative).** A plain-English, exec-ready paragraph generated server-side
   from the day's aggregates: money recovered, entity reliability, the recoverable opportunity, and the
   ROI headline. The hook a CxO reads first. (Templated & deterministic; optional LLM polish.)

2. **Recovery ROI & Savings.** AI cost = connected-minutes × configurable ₹/min (+ optional platform
   fee) vs a **recovery-agency commission benchmark** (configurable %, default 12%). Sample: ~₹15K of AI
   talk-time recovered ₹6.50 Cr → **≈₹0.02 per ₹100 recovered**; agency at 12% ≈ **₹78 L** — a savings
   story that annualizes. Show cost-per-₹100, ₹ saved vs agency, and an annual projection.

3. **Propensity-to-Recover scoring (explainable).** For every **open** account, a 0–100 score + High/Med/Low
   tier, built from **empirical resolution rates conditioned on observed drivers** (connected?, duration
   bucket, PTP entity, disposition, qualification, balance band, months-on-book). Fully transparent —
   each score shows its contributing factors (banks require auditability; no black box). Ranked table of
   open accounts by propensity × balance.

4. **Recoverable Opportunity ("money on the table").** Open outstanding **₹8.69 Cr** split by propensity
   tier, plus ready-to-work priority lists:
   • **Promised-to-Pay, still open — ₹1.14 Cr (169)** → broken-promise follow-ups.
   • **Engaged ≥2 min, not closed — ₹1.90 Cr (230)** → highest propensity.
   • **Claimed paid, unresolved — ₹0.28 Cr (39)** → reconciliation/verification list for RBL.
   Framing: "renew Convin and we target ₹X of this next cycle."

5. **Dial-Efficiency Optimization.** Connect/resolution by attempt band (sample: accounts closing early
   resolve ~96%; the hard core still open past 10+ attempts resolves ~34%). Recommends a max-attempt
   policy + escalation (settlement offer / field visit) for the hard core. *(Framed as segmentation with
   the survivorship caveat, not naïve causation.)*

6. **Conversation-Length Optimization.** The 2–5 min sweet spot (resolution 27% → **61%**) → a target
   talk-time the AI should aim for; feeds script/coaching guidance.

7. **Entity-Truth Intelligence.** Reliability of AI entity detection (Already-Paid ≈90% match) plus
   actionable outliers: **said "not paid" but recovered (84)** and **promised but still open (169)** →
   auto-generated target lists.

8. **Forecast & Momentum.** Run-rate projection across snapshots (daily/weekly/quarterly recovery
   trajectory) and day-over-day momentum alerts (e.g., "recovery +12% vs yesterday, led by North").
   Degrades gracefully to a single snapshot until history accrues.

> Data honesty: **best-time-to-call** needs per-call timestamps (not in the current CSV) — shown as a
> "unlocks when call-time data is added" placeholder rather than fabricated.

---

## 8. High-Impact Comparisons (cross-cutting, surfaced as insight callouts)

PTP → Actual Resolution · Already-Paid Claim → Actual Resolution · Refusal → Actual Resolution ·
AI Connected vs Not-Connected → Resolution Rate · Disposition → Resolution Rate · Balance Band →
Resolution Rate · State/Region → Resolution & Recovery · Conversation Duration → Payment Success ·
Qualification → Resolution · Goal Achieved → Actual Payment.

---

## 9. Data Nuances (handle explicitly)

- **Region:** sample has only North/West/East; spec lists N/S/E/W/Central. Render regions **dynamically**
  from the data so South/Central appear automatically when present.
- **Funnel units:** "AI Attempted/Connected" are call counts; other stages are account counts. Show each
  stage with its unit labelled; base account-level drop-off on accounts with ≥1 attempt / ≥1 connect.
- **Refusal entity** has richer sub-reasons than YES/NO — keep them in §7.5, roll up to YES/NO/Blank/N/A for the matrix.
- **Recovered amount** everywhere = Resolved rule (never the raw paid figure), for consistency across all sections.

---

## 10. Apple Titanium Design System

Palette: Natural Titanium base `#8E8B82` / surface `#F5F4F1`, White/Silver surfaces, Black Titanium text
`#1D1D1F`, one accent (Blue/Desert Titanium) for highlights & positive deltas; light + dark. SF Pro
(fallback Inter), large tight-tracked display numerals. Frosted-glass cards (`backdrop-blur`), soft depth,
generous whitespace, 16–24px radii. Motion (120fps): transform/opacity only, spring easings, count-ups,
animated funnels/charts, `content-visibility` offscreen, virtualized lists, respect `prefers-reduced-motion`.

---

## 11. Performance, Security, Deployment

- Browser gets only pre-computed aggregates + one virtualized table page (server-side keyset pagination).
- Go ingester streams CSV (bounded memory) → bulk insert ClickHouse; MVs keep aggregates + profiles current.
- Email-allowlist auth (NextAuth); authenticated, rate-limited upload; PII masking toggle for screen-shares.
- **GitHub** → **Vercel** (web) + **Fly.io/Railway** (Go) + **Neon/Supabase** (Postgres) + **ClickHouse Cloud**.

---

## 12. Build Order (mirrors the prompt pack)

Scaffold → design system/shell → DB schemas → Go ingester + normalization → aggregation API (all sections,
Resolved rule) → date navigator + same-day tabs → top KPI cards + exec hero → entity-validation matrices →
AI performance + goal + qualification → disposition + balance band → state + region maps → relationship +
conversation-duration → recovery + payment mode + top-20 → funnel → account explorer → data profiler →
trends → auth + upload → deploy.

*Companion: `RBL_Dashboard_Build_Prompts.md` — the copy-paste prompts for Claude Code.*
