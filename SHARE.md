# The free, always-on setup

**Vercel + Supabase. Both free. The link works when your Mac is off.**

```
   YOUR MAC                    SUPABASE (free)           VERCEL (free)
   ────────                    ───────────────           ─────────────
   3 files (12.5 MB)           Postgres                  the app
        │                      · account_rows            · dashboard
        │  npm run push  ────► · batches         ◄────── · /r/<token>
        │  (once per report)   · share_links             · always on
        │                                                      │
   close the laptop ─────────────────────────────────────► link still works
```

You push data once per report. Everything else runs without you.

---

## Why not just tunnel from your Mac?

Because **`npm run dev` IS the web server.** Ctrl+C stops it, and a link pointing at a
stopped server is dead — the token is perfectly valid and perfectly useless. Same when
you close the laptop. No tunnel, no nginx, no token setting changes that: a pipe to a
sleeping Mac carries nothing.

If the link has to work when your machine is off, **the app has to run somewhere else.**
That is the whole of it.

(The tunnel is still there — `npm run dev` brings it up — and it's perfect for a live
demo where you're sitting in front of the laptop anyway.)

---

## Setup — about 15 minutes, once

### 1 · Supabase (free)

1. **supabase.com** → New project → region **Mumbai (ap-south-1)**. Save the DB password.
2. **SQL Editor** → paste all of `db/postgres/schema.sql` → Run.
   Creates `account_rows`, `batches`, **`share_links`**, indexes.
3. **Settings → Database → Connection string.** Take **two**:

| | for | why |
|---|---|---|
| **Direct** (`:5432`) | `npm run push` from your Mac | thousands of inserts in one session |
| **Transaction pooler** (`:6543`) | **Vercel** | serverless opens/drops connections constantly — the direct URL exhausts Postgres in minutes |

### 2 · GitHub

```bash
rm -rf .git && git init && git add -A
npm run check:pii          # MUST print CLEAN — it greps for names, mobiles, card numbers
git commit -m "Recovery Intelligence"
git remote add origin git@github.com:<you>/rbl-recovery.git
git push -u origin main
```

Private repo. `.gitignore` already excludes `/src/data/*`, every `.csv`, every `.xlsx`.

### 3 · Vercel (free)

Import the repo. Set three env vars (Production **and** Preview):

| | |
|---|---|
| `DATABASE_URL` | Supabase **transaction pooler** URI (`:6543`) |
| `DASHBOARD_PASSWORD` | a real password — **not** `rblrecovery2026` |
| `DASHBOARD_USER` | *(optional)* lock login to one username |

Deploy.

### 4 · Load the report

```bash
echo 'DATABASE_URL=postgresql://postgres:PW@db.xxxx.supabase.co:5432/postgres' > .env.local

npm run push -- "CYC.xlsx" "Status.xlsx" "Leads.csv" --date 2026-07-13
```

Parsed and joined on your Mac; only the result crosses the wire. **No redeploy needed** —
the app reads the database on every request.

> **Why not upload through the website?** Vercel caps a serverless request body at
> **4.5 MB**. Hard platform limit. Your three files are 12.5 MB — the upload returns 413
> before your code runs. `push` sidesteps it entirely and is faster anyway.

---

## Sharing

Open the deployed dashboard → **Share** → type who it's for → pick **Never** →
**the link is on your clipboard.**

```
https://rbl-recovery.vercel.app/r/UGy-cE7VWkKqNEmC...
```

Send it. They click it. No login, no password, no account. Your laptop can be at the
bottom of a lake.

### What they see

**The full report. Real customer names. Nothing masked.** It is RBL's own data going to
RBL and to Convin — the two parties who already hold it.

The Account Explorer (mobile numbers, 19-digit account numbers) is **not** in a shared
report — it's an interactive tool, not a document, and it's excluded from the printed PDF
for the same reason. Say the word and it goes in.

### What that means, plainly

The URL is now **genuinely sensitive**. Anyone holding it sees real customer names, and
there is no login in front of them. Forward it outside RBL/Convin and that is a
personal-data disclosure.

So **revocation is the only control you have left**, which makes it the one that matters:

```bash
curl -X DELETE "https://rbl-recovery.vercel.app/api/share?token=<token>" \
     -b "auth_session=true"
```

Instant. The next click gets *"This link is no longer available"* — and nothing about
**why**, so it can't be used to probe for valid tokens.

Every link also counts its views, timestamps the last one, and prints the recipient's
name at the foot of the report. A screenshot that leaks is traceable to the person you
gave it to.

**Revoke them when they've done their job.**

---

## Free hosting, honestly ranked

| | free? | up when your Mac is off? | notes |
|---|---|---|---|
| **Vercel + Supabase** | ✅ | ✅ | *this.* Instant. Data via `npm run push`. |
| **Cloudflare tunnel** | ✅ | ❌ | already built in (`npm run dev`) — great for a live demo |
| **Render free** | ✅ | ⚠️ sleeps 15 min, **~50 s cold start** | a COO clicking a link and staring at a spinner for a minute is a bad look |
| **Oracle Cloud Always Free** | ✅ | ✅ | a real VPS, free forever (4 ARM cores). nginx + PM2, no upload cap — but the signup is painful and ARM capacity is often unavailable |
| **Fly.io** | small allowance | ✅ | needs a card on file |
| **VPS + nginx** | ~$5/mo | ✅ | not free. Best long-term, and closest to Convin's own servers. |

**One caveat you should know before a bank's name is on it:** Vercel's free Hobby plan is
licensed for **non-commercial** use. A client deliverable is commercial — technically that's
Pro, $20/mo. Nobody will chase you over a demo or an internal review, but you should hear
it from me rather than from Convin's legal team.

If that matters, **Cloudflare Pages** allows commercial use on its free tier — it needs a
different build adapter, so tell me and I'll wire it up.

---

## Local dev is unchanged

No `DATABASE_URL`, no Supabase, files on disk, tunnel for live demos:

```bash
npm run dev          # app + free tunnel, one terminal
npm run dev:next     # just the app
```
