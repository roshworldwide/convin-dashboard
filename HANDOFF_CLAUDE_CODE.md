# Handoff — build one report PDF per PDD book

Paste the **Task** section below into Claude Code, running from this repo directory.
Everything above it is context you may want to skim first.

---

## Setup (once)

```bash
cd "/Users/rosh/Personal/Projects/RBL Dashboard 2"
git push origin main          # ships three fixes that are committed but not deployed
claude                        # start Claude Code here
```

The `git push` is not optional. It carries a fix for `npm run push` silently
zeroing **all** AI telemetry. Any pipeline built on the unfixed script produces
reports showing a campaign that made zero calls, while accounts, outstanding and
recovered all still look correct — so nothing announces the loss.

---

## What already exists

- **`scripts/build_book_reports.mjs`** (`npm run reports`) — builds one PDF per book,
  unattended. Written and dry-run tested, but **never run against the real database**,
  because the machine it was written on could not reach Supabase. Treat the first run
  as the real test.
- **Data root:** `/Users/rosh/Business/Convin/RBL PDD August Folder`
  28 book folders → `Day N - <date>` → three numbered files:
  `1 - AI Call Log.csv`, `2 - <book>.xlsx`, `3 - Prex Status <date>.xlsx`
- **`.env.local`** holds `DATABASE_URL` (Supabase). The script needs it:
  `node --env-file=.env.local`, which `npm run reports` already does.

## Traps already hit — do not rediscover these

1. **The AI call log is not a lookup sheet.** One row per *attempt*; the join is one row
   per *account*. Passing it to `buildCanonicalRows` as an ordinary lookup collapses
   ~68,000 attempts into ~6,000 first-attempts and lands every AI figure on zero. It must
   be `rollUpCallLog()` then `applyCallLog()` **after** the join. Already fixed in
   `push.mjs` and in the new script — don't "simplify" it back.
2. **Reports are keyed by date alone.** There is no report-name field, and 24 of the 28
   books share a load date. That's why the script builds every book on one scratch date
   (27 Aug), exports, then deletes before the next. It refuses to start if that date
   already holds a report.
3. **A silently-failing export looks like a slow one.** Convin's report queue accepts a
   job, shows "Started", then never completes. Re-fire rather than wait.
4. **Don't infer "no data" from a failed export.** Two exports failed in a row on the
   9 Aug load and the pattern suggested calling had stopped. It hadn't — the retry
   returned 8,250 and 9,044 rows of real calling.

## Acceptance numbers

25 books should build. Each report's account count must match its book exactly:

| Book | Days | Accounts | | Book | Days | Accounts |
|---|---|---|---|---|---|---|
| 12 PDD+1 Convin | 5 | 5,958 | | 17 PDD+1 Convin | 5 | 1,141 |
| 12 PDD+2 | 4 | 1,899 | | 17 PDD+1 DG Convin | 5 | 387 |
| 12 PDD+4 | 3 | 2,133 | | 17 PDD+2 Convin | 4 | 474 |
| 12 PDD+4 Les 20K | 3 | 754 | | 17 PDD+4 Convin | 3 | 537 |
| 14 PDD+1 Les 20K | 5 | 1,087 | | 17 PDD+4 DG Convin | 3 | 209 |
| 14 PDD+1 convin | 5 | 2,866 | | 18 PDD+1 Convin | 5 | 1,112 |
| 14 PDD+2 | 4 | 1,153 | | 18 PDD+1 DG Convin | 5 | 418 |
| 14 PDD+4 Convin | 3 | 1,446 | | 18 PDD+2 Convin | 4 | 375 |
| 14 PDD+4 DG Convin | 3 | 540 | | 18 PDD+4 Convin | 3 | 596 |
| 15 PDD+1 Les 20K | 5 | 618 | | 18 PDD+4 DG Convin | 3 | 213 |
| 15 PDD+1Updated | 5 | 1,643 | | 20 PDD+1 Convin | 5 | 1,489 |
| 15 PDD+4 Convin | 3 | 801 | | 20 PDD+2 Convin | 4 | 1,106 |
| 15 PDD+4 DG Convin | 3 | 293 | | | | |

**Three books are expected to be skipped** — `20 PDD+4 Convin`, `22 PDD+2 Convin`,
`22 PDD+1 Convin`. Each is missing `Prex Status 16 Aug`, which does not exist in the
Status Files folder (days run 3–15, then 17, 18). Find that one file and all three
complete.

`22 PDD+1 Convin` additionally has **no call activity at all** — the book reached S3 on
13 Aug but was never dialled. See the READ ME inside its folder. A zero-call report for
that book is correct, not a bug.

---

## Task

> Build one report PDF per PDD book, using `npm run reports` in this repo.
>
> Start with a single book to prove the pipeline:
>
> ```
> npm run reports -- --only "12 PDD+1"
> ```
>
> Then check the PDF it wrote to `~/Business/Convin/RBL PDD August Folder/_Reports/`:
> - it opens and is more than one page
> - the account count reads **5,958**
> - the AI-calling section is **not** zero — if attempts, connected calls and
>   dispositions are all zero, stop and investigate; that is the known failure mode
>
> If it looks right, run the rest:
>
> ```
> npm run reports
> ```
>
> Expect 25 built and 3 skipped. Verify each PDF's account count against the table in
> `HANDOFF_CLAUDE_CODE.md`. If a book fails, read the error, fix the cause, and re-run
> just that book with `--only`; do not skip it silently and do not paper over a failure
> by assuming the data is empty.
>
> Report at the end: which books built, which failed and why, and any report whose
> numbers disagree with the acceptance table.
