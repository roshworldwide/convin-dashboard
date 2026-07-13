# Convin × RBL — Recovery Intelligence Dashboard · Run Guide

A self-contained Next.js dashboard (no database) that presents Convin's AI collections
performance for RBL Bank, in the Apple "Titanium" aesthetic. It reads a pre-aggregated
`src/data/data.json` generated from the real collections CSV.

## Run it locally
```bash
cd "RBL Dashboard 2"
npm install
npm run dev
# open http://localhost:3000
```
**Login password:** `rblrecovery2026`
(change via the `DASHBOARD_PASSWORD` environment variable.)

**Flow:** **Sign in** (username + password) → **Home** (`/`) → choose **Upload a new CSV** or
**open a past dashboard** → the **Dashboard** (`/dashboard?date=…`).

**Column mapping.** After you pick a file, the page reads its header row and shows a **Map your
columns** panel — every field the dashboard needs (Account No, Status, Outstanding, bands, region,
AI-call columns, the entity columns…) with the matching header auto-detected. Change anything that
looks wrong; the three required fields are marked and the upload is blocked until they're mapped.
So the dashboard works even if your export renames a column.

**Two modes.** Toggle at the top of the upload form:
- **Status + portfolio** — two (or more) sheets, joined automatically on Account No.
- **Already merged** — you've done the lookup yourself; just drop the one sheet.

**Delete a report.** Each row under *Past Reports* on the home screen has an **Open** button and a
trash button (with a confirm step) that removes that report day entirely.

**Upload — no more VLOOKUP.** The upload page has two sections:
1. **Status sheet** (required) — the Convin export: status, dispositions, AI calls, entities.
2. **Additional sheets** (optional, several allowed) — portfolio/base files with outstanding,
   balance band, region, name, mobile…

They're joined automatically on **Account No**: the status sheet decides which accounts appear, and
the additional sheets fill in whatever it's missing. The result shows how many accounts matched and
how many values were filled. If a sheet contains Excel-corrupted account numbers (`7.4787E+15`), it
**refuses to guess** and tells you to re-export that column as Text.

- Local dev writes batch files (dashboard updates instantly, no DB). Production (`DATABASE_URL`) writes to Postgres.
- Multiple files for one day → Upload # 1, 2, 3 (each becomes a tab).
- **Dark mode** toggle (☾/☀) lives in the island; the choice persists and applies to every page.

## Refresh the data (new CSV)
**Single snapshot:** replace `src/data/convin_source.csv` (same columns as the sample), then:
```bash
python3 generate_convin_data.py
```

**Daily view + same-day tabs (multiple uploads per day):** drop dated CSVs into
`src/data/uploads/` named `upload-YYYY-MM-DD-<slot>.csv` — e.g.
`upload-2026-07-08-1.csv`, `upload-2026-07-08-2.csv`, `upload-2026-07-09-1.csv` — then run
`python3 generate_convin_data.py`. Each file becomes its own **tab** under its date, with a
merged **Day Total** tab, and every date shows up in the **date stepper** at the top of the
dashboard. (When no `uploads/` folder is present, the generator seeds a demo: it splits
`convin_source.csv` into three same-day uploads for 7 July so you can see the tabs.)

The generator writes `src/data/manifest.json` + `src/data/batches/*.json`, uses the Python
standard library only (no pip installs), and pre-computes every aggregate + the intelligence layer per batch.

## What's on the dashboard
- **Date stepper + upload tabs** — browse any report date; each day's uploads appear as tabs (Day Total + Upload 1/2/3…).
- **Hero + KPI row** — Recovered ₹, Recovery Rate, Outstanding Managed, Calls Connected, Connect Rate, Avg Recovery.
- **Executive Intelligence** — auto-written deal case + ROI vs a recovery agency (cost per ₹100, annual saving).
- **Collection Funnel** and **Recoverable Opportunity** (open book split by propensity + action lists).
- **Entity Validation** — Promise-to-Pay / Already-Paid / Refusal matrices (said vs did).
- **Conversation-length insight** (longer calls recover more) + **AI performance**.
- **Disposition → recovery**, **Payment modes**, **Balance bands**, **Regions**, **Top states**, **Dial efficiency**.
- **Top-20 high-outstanding** and a filterable, sortable **Account Explorer** (PII-masked).

Headline (current data): **₹6.50 Cr recovered · 42.8% of outstanding · 836 resolved · ₹8.69 Cr open**.
Recovered value counts an account's full `total_outstanding` when its status is `Resolved`.

## Deploy to Vercel
Push this folder to GitHub and import it in Vercel (framework auto-detected as Next.js).
Set `DASHBOARD_PASSWORD` in Vercel env vars. No database required — `data.json` ships with the app.

## Production data layer (1M rows/day) — Node + Postgres
The app runs **as-is** with zero infra (reads `src/data`). To scale to ~1M rows/day, set
`DATABASE_URL` and it automatically switches to Postgres — raw rows in `account_rows`,
server-side paginated Explorer via `/api/rows`, pre-computed section payloads in `batches`.
Same frontend, same look. Full setup + deploy steps are in **`BACKEND.md`**.

## Notes
- Original reference dashboard preserved at `reference_original_page.js.txt`.
- The unused `/api/status` route and the old `status_data.json` can be deleted if you don't need them.
