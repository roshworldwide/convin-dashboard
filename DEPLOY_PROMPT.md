# Paste this into Claude Code

Copy everything between the lines below into Claude Code, running in
`/Users/rosh/Personal/Projects/RBL Dashboard 2`.

---

Deploy this app to **Vercel + Supabase**. It is a Next.js 16 (App Router, JavaScript — not
TypeScript) collections dashboard for RBL Bank, built by Convin. It is already written,
tested and committed. **Your job is deployment only — do not refactor, do not "improve" the
code, do not fix things that are not broken.** Read this whole brief before you touch
anything.

## The current state

- Local repo: `/Users/rosh/Personal/Projects/RBL Dashboard 2`
- Commit `1f5453f` exists on branch `main`, 101 files, remote already configured as
  `https://github.com/roshworldwide/convin-dashboard.git`. It has **not been pushed yet.**
- `npm run test:all` → **286 checks, 0 failures.** This must still be true at the end.
- `npm run build` passes.

## How the app decides where its data lives

One environment variable, and everything hangs off it:

- **`DATABASE_URL` absent** → the app reads and writes JSON files under `src/data/`.
  This is local dev mode.
- **`DATABASE_URL` present** → Postgres. Every route switches automatically via `hasDb()`
  in `src/lib/db.mjs`. Nothing touches the filesystem.

On Vercel the filesystem is read-only, so `DATABASE_URL` is **not optional**. Without it
the deployed app looks for files that do not exist and shows an empty dashboard **with no
error** — which is the single most likely way this deployment fails silently. Verify it.

---

## Things that will bite you. Read these before doing anything.

### 1. Supabase gives you TWO connection strings. They are not interchangeable.

| | port | use it for | what happens if you get it wrong |
|---|---|---|---|
| **Direct** | `5432` | `npm run push` from the Mac | fine |
| **Transaction pooler** | `6543` | **Vercel** | serverless opens and drops connections on every request. With the direct URL you exhaust Postgres' connection limit within minutes and the app starts throwing `too many connections` under any real use. |

Use the **pooler** on Vercel. Use **direct** locally. This is the most common way to take
this app down.

### 2. Vercel's 4.5 MB request body cap is ALREADY SOLVED. Do not "fix" it.

The real upload is three files totalling 12.5 MB. Vercel refuses any serverless request
body over 4.5 MB — a hard platform limit, not a setting.

This is already handled: `src/lib/upload_client.mjs` parses and joins the files **in the
browser** (same `sheet.mjs` / `merge.mjs` / `normalize.mjs` modules the server uses — not a
copy), gzips the joined rows and posts them in 2,500-row chunks to `/api/ingest/chunk`.
12.5 MB of workbooks become **0.57 MB on the wire**, largest single body 0.20 MB.

`/api/ingest/chunk` is **stateless by design**: on Vercel, chunk 1 and chunk 2 can land on
different machines, so every chunk is written straight through to Postgres and `commit`
reads it all back. **Do not add in-memory buffering between chunks.** It would work
perfectly on a laptop and lose rows in production, intermittently.

### 3. Auth fails closed in production. This is deliberate.

`src/app/api/auth/route.js` refuses **every** login with a 503 if `DASHBOARD_PASSWORD` is
unset and `NODE_ENV === 'production'`. There is no fallback, because a fallback in a public
repo *is* the password. Set the env var or nobody gets in, including you.

### 4. `src/data/validation.json` must stay committed.

`.gitignore` excludes `/src/data/*` but re-admits this one file. The `/api/validation` route
imports it at build time. If it goes missing the **Vercel build fails**. It contains
aggregate model statistics only — no customer data. Leave it alone.

### 5. Never commit customer data.

`.gitignore` excludes `/src/data/*`, every `.csv` and every `.xlsx`. The real book is 7,042
RBL cardholders — names, mobile numbers, 19-digit account numbers. **Run `npm run check:pii`
before every commit.** It greps the staged tree and fails if it finds any. It currently
prints CLEAN. Keep it that way.

---

## What to do

### Step 1 — Push to GitHub

The commit and remote are ready. Push it.

```bash
git push -u origin main
```

If it asks for credentials, stop and tell me — do not try to work around it.

Then **tell me to make the repo private on github.com.** Nothing in it is secret, but
there is no reason to hand a bank's internal tooling to the internet.

### Step 2 — Supabase

I will create the project myself. **Ask me for:**

1. The **direct** connection string (port `5432`)
2. The **transaction pooler** connection string (port `6543`)

Both are at: Supabase → Project Settings → Database → Connection string → URI.
Region should be **Mumbai (ap-south-1)**.

Then apply the schema. Use `psql` with the **direct** string:

```bash
psql "<DIRECT_URL>" -f db/postgres/schema.sql
```

If `psql` is not installed: `brew install libpq && brew link --force libpq`.

Then **verify** the tables exist — do not assume:

```bash
psql "<DIRECT_URL>" -c "\dt"
```

You must see: `account_rows`, `batches`, `share_links`. If `share_links` is missing, share
links will 500 at runtime and the failure will look like an app bug.

### Step 3 — Local `.env.local`

```bash
echo 'DATABASE_URL=<DIRECT_URL>' > .env.local
```

`.env*` is gitignored. **Confirm it with `git status` — do not take my word for it.**

### Step 4 — Vercel

Use the Vercel CLI (`npx vercel`). I will complete any browser login prompts.

Import/link the project, then set these for **Production, Preview and Development**:

| name | value |
|---|---|
| `DATABASE_URL` | the **POOLER** string (port `6543`) — not the direct one |
| `DASHBOARD_PASSWORD` | **ask me for it.** Do not invent one, do not use `rblrecovery2026`. |
| `PUBLIC_BASE_URL` | the deployed origin, e.g. `https://convin-dashboard.vercel.app` — set this *after* the first deploy, when you know the URL |

Then deploy to production.

### Step 5 — Load the data

Ask me for the paths to the three files. They are on my Mac. Then, using `.env.local`
(the **direct** connection):

```bash
npm run push -- "<CYC>.xlsx" "<STATUS>.xlsx" "<LEADS>.csv" --date 2026-07-13
```

It auto-detects which file is which — it does not trust the order. Expect roughly:

```
  CYC      ...            7042 rows
  STATUS   ...          177685 rows
  LEADS    ...            7915 rows
  joined 7,042 accounts in ~2,500 ms
  ✔ 7,042 rows written · batch 2026-07-13__u1
```

**If the join reports anything other than 7,042/7,042 on both lookup sheets, stop and tell
me.** Do not proceed with a half-joined book.

No redeploy is needed — the app reads Postgres on every request.

---

## Step 6 — Verify it actually works. Do not skip this.

A deploy that builds is not a deploy that works. Check each of these and report the result:

1. **The dashboard loads and is not empty.** Open the deployed URL, sign in with
   `DASHBOARD_PASSWORD`. It must show **7,042 accounts**. An empty dashboard means
   `DATABASE_URL` did not reach the runtime.

2. **The numbers are right.** The Day Total must read:
   - **7,042 accounts**
   - **₹54.98 Cr** total outstanding
   - **₹13.12 Cr** recovered · **24.9%** resolution
     *(these depend on which status file I give you — if they differ, tell me the numbers
     you see rather than assuming you broke something)*

3. **Auth fails closed.** Temporarily unset `DASHBOARD_PASSWORD` in Vercel, redeploy, and
   confirm login returns **503**, not a successful login. Then put it back. If it lets you
   in, that is a security hole and I need to know immediately.

4. **The web upload works on Vercel.** Go to `/upload`, drop the three real files in
   (12.5 MB total), and confirm it completes. Watch the network tab: you should see
   several small POSTs to `/api/ingest/chunk`, none over ~0.5 MB. **If you see a 413, the
   client-side path is not being used and something is badly wrong.**

5. **A share link works end to end.** On the dashboard, click **Share**, enter a name,
   choose **Never**, and copy the link. Open it in a **private/incognito window** (no
   session cookie). Confirm:
   - it loads the full report **without any login**
   - real customer names are visible in Top-20 (masking was deliberately removed)
   - there is **no Account Explorer**, no date navigator, no upload button
   - the recipient's name is printed at the foot of the page

6. **Revoke works.**
   ```bash
   curl -X DELETE "https://<app>/api/share?token=<token>" -b "auth_session=true"
   ```
   The link must then show *"This link is no longer available."*

7. **`npm run test:all` still passes — 286 checks, 0 failures.**

---

## Report back with

- The live URL
- Whether all 7 verification steps passed, individually
- Anything you changed in the code and why (I expect: nothing)

## If something fails

| symptom | almost certainly |
|---|---|
| dashboard empty, no error | `DATABASE_URL` not set on Vercel, or set for the wrong environment |
| every login 503 | `DASHBOARD_PASSWORD` not set — this is correct behaviour, set it |
| `too many connections` | you used the **direct** URL on Vercel instead of the **pooler** |
| 413 on upload | the browser is posting raw files — the client-side path in `upload_client.mjs` is not running |
| share link 500s | `share_links` table was never created — re-run `schema.sql` |
| build fails on `validation.json` | it got excluded from the commit — it must be tracked |

**Do not paper over any of these by changing application code. Every one of them is a
configuration problem, and fixing it in code will hide the real fault.**
