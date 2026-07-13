# Deploy — Vercel + Supabase

The shape of it:

```
   YOUR MAC                          SUPABASE                    VERCEL
   ────────                          ────────                    ──────
   3 files (12.5 MB)                 Postgres                    Next.js app
        │                            account_rows                dashboard
        │  npm run push  ──────────► batches      ◄───────────── (read only)
        │  parse + join locally                                       │
        └─ nothing uploaded to the web                                │
                                                          RBL + Convin view this
```

**The app on the web never ingests. It only reads.** That is deliberate, and the reason
is on the next line.

---

## Read this before you start

### Vercel will not accept your upload. Ever.

Vercel caps a serverless request body at **4.5 MB**. It is a platform limit — not a
setting, not a plan tier, not something a timeout fixes. Your three files:

| file | size |
|---|---|
| CYC 12 PDD1 3rd July File.xlsx | 1.3 MB |
| Status File 04 July.xlsx | 3.3 MB |
| Collections-July leads.csv | 7.9 MB |
| **total** | **12.5 MB** |

Posting that to `/api/ingest` on Vercel returns **413 before your code runs**. So the
three files are parsed and joined **on your machine** and only the result crosses the
wire, over a normal Postgres connection with no body limit:

```bash
npm run push -- "CYC 12 PDD1.xlsx" "Status File.xlsx" "Leads.csv" --date 2026-07-13
```

The website is a pure read surface. Fast, and impossible to break by uploading the
wrong thing in front of a client. (The web upload page still works locally, and on
Vercel it now returns a message telling you to use `push` instead of a bare 413.)

### The password has no fallback in production

It used to be `process.env.DASHBOARD_PASSWORD || 'rblrecovery2026'`. On GitHub, that
fallback **is** the password — in plain text, behind which sit 7,042 RBL cardholders'
names, mobile numbers and balances. It now **fails closed**: if `DASHBOARD_PASSWORD` is
not set on Vercel, every login is refused. Set it, or nobody gets in — including you.

### Customer data never touches the repo

`.gitignore` excludes `/src/data/*`, every `.csv` and every `.xlsx`. The real book lives
in Postgres (access-controlled) and on your Mac. **Run `npm run check:pii` before your
first push** — it greps the staged tree for names, mobiles and 15–19 digit account
numbers and fails the commit if it finds any.

---

## 1 · Supabase

1. **supabase.com** → New project. Pick a region near RBL — **Mumbai (ap-south-1)**.
   Save the database password; you cannot see it again.

2. **SQL Editor** → paste the whole of `db/postgres/schema.sql` → Run.
   It creates `account_rows`, `batches`, the indexes and the `pg_trgm` extension.

3. **Project Settings → Database → Connection string.** You need **two** of them, and
   they are not interchangeable:

   | which | use it for | why |
   |---|---|---|
   | **Direct** (port `5432`) | `npm run push` on your Mac | thousands of inserts in one session; wants a real, stable connection |
   | **Transaction pooler** (port `6543`) | Vercel | serverless opens and drops connections constantly; without the pooler you exhaust Postgres' connection limit in minutes |

   Using the direct URL on Vercel is the single most common way to take this down under
   load. Use the pooler there.

---

## 2 · GitHub

```bash
cd "RBL Dashboard 2"

rm -rf .git                 # start clean — old history may hold customer rows
git init
git add -A

npm run check:pii           # MUST print CLEAN. If it doesn't, stop and fix it.

git commit -m "Recovery Intelligence dashboard"
git branch -M main
git remote add origin git@github.com:<you>/rbl-recovery-intelligence.git
git push -u origin main
```

Make the repo **private**. Nothing in it is secret, but there is no reason to hand a
bank's internal tooling to the internet.

---

## 3 · Vercel

1. **vercel.com** → Add New → Project → import the GitHub repo. Next.js is detected;
   leave the build settings alone.

2. **Environment Variables** — set these for *Production, Preview and Development*:

   | name | value |
   |---|---|
   | `DATABASE_URL` | the Supabase **transaction pooler** URI (port `6543`) |
   | `DASHBOARD_PASSWORD` | a real password. Not `rblrecovery2026`. |
   | `DASHBOARD_USER` | *(optional)* lock login to one username |

   `DATABASE_URL` is what flips the app from local-file mode to Postgres. Without it,
   the deployed app looks for `src/data/` on a read-only filesystem and shows nothing.

3. Deploy.

---

## 4 · Load the data

```bash
# .env.local on your Mac — gitignored
echo 'DATABASE_URL=postgresql://postgres:PW@db.xxxx.supabase.co:5432/postgres' > .env.local

npm run push -- \
  "CYC 12 PDD1 3rd July File.xlsx" \
  "Status File 04 July-39_26.xlsx" \
  "Collections-_July_leads_20260713.csv" \
  --date 2026-07-13
```

It auto-detects which file is which (it does not trust the order you typed them in —
handing the status file to the CYC slot would silently produce a book with the wrong
denominator and nothing downstream would notice). Expect:

```
  CYC      CYC 12 PDD1 3rd July File.xlsx        7042 rows    1.3 MB
  STATUS   Status File 04 July-39_26.xlsx      177685 rows    3.3 MB
  LEADS    Collections-_July_leads.csv           7915 rows    7.9 MB
  joined 7,042 accounts in 2,554 ms
  ✔ 7,042 rows written · batch 2026-07-13__u1
```

Refresh the deployed dashboard. It's there. **No redeploy is needed to load new data** —
the app reads the database on every request.

---

## Sharing it

The URL plus the password is the whole of it. `vercel.app` is fine for a demo; for RBL,
add a custom domain in Vercel → Settings → Domains.

One upload per report date. Upload the same book twice and the Day Total counts each
account once (newest upload wins), so the money will not inflate — but there is no
reason to make it work harder than it has to.

---

## When something is wrong

| symptom | cause |
|---|---|
| Dashboard is empty, no error | `DATABASE_URL` not set on Vercel → app is in local-file mode, looking for files that aren't there |
| Every login refused, 503 | `DASHBOARD_PASSWORD` not set. This is deliberate — it fails closed. |
| 413 / "too large" on upload | Expected on Vercel. Use `npm run push`. |
| `too many connections` | You used the **direct** URL on Vercel instead of the **pooler**. |
| Build fails on `validation.json` | It's the one file re-admitted from `/src/data/` — check it's committed. |

Local development is unchanged: no `DATABASE_URL`, no Supabase, files on disk.
`npm run dev`.
