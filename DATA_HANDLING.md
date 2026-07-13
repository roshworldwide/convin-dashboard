# Data handling

## What is in this project

The dashboard processes **RBL Bank cardholder records**. A single row contains a
customer's full name, mobile number, 19-digit card account number, city, outstanding
balance, and whether they are in default.

That is personal financial data about real people. Under India's DPDP Act it is
sensitive, it belongs to RBL and to the individuals it describes, and it does not
belong on GitHub, on Vercel, in a Slack thread, or in an email attachment.

**None of it is required to run this app.** `npm run demo` generates a synthetic book
with invented people, and the dashboard behaves identically.

## The rules

**Real data never leaves the machine that produced it.** `.gitignore` excludes the
source CSV, every batch file derived from it, the eval reports, and the two old HTML
prototypes that had cardholder rows baked into the markup. Nothing in `src/data/`
is committed except `validation.json`, which is aggregate statistics only.

**Run the guard before every push.**

```bash
npm run check:pii
```

It inspects exactly what `git add .` would stage — not what you *meant* to ignore —
and fails if it finds a mobile number, a card number, or a Convin lead link. A
`.gitignore` is a promise you make once and forget; this is a check that runs every
time. Wire it into a pre-commit hook:

```bash
echo 'npm run check:pii || exit 1' > .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
```

**Deploying to Vercel does not make it safe.** A private repo is still a copy of a
bank's customer data on a third party's servers, made without the bank's authorisation.
If production needs real data, it goes into a database RBL has approved, reached over
a connection RBL has approved — never into the repository.

**Synthetic figures are not real figures.** Anything produced by `evals/synth_book.mjs`
or `npm run demo` describes people who do not exist. Never quote a rupee number from
it to anyone, internally or externally.

## If real data has already been pushed

Treat it as a breach, and act the same day.

You cannot un-publish it. Deleting the file and force-pushing does not help — the blob
survives in the reflog, in forks, in clones, and in GitHub's cache. Rewriting history
with `git filter-repo` is necessary but not sufficient.

1. Make the repository private immediately, or delete it.
2. Tell whoever owns the data — Convin, and through Convin, RBL. Today, not next week.
   The disclosure is survivable. The cover-up is not.
3. Purge the history (`git filter-repo --path <file> --invert-paths`), then rotate any
   credential that was ever in the repo.

## What is safe to share

- The code. All of it.
- `src/data/validation.json` — the model's measured scores, no accounts, no people.
- `evals/upload/4_SYNTHETIC_10k_inverted_book.csv` — 10,000 invented customers.
- The deck and the meeting script — aggregate figures only, no individuals.
