-- Postgres schema for the Convin × RBL Recovery Intelligence backend (Node + Postgres).
-- Works on Supabase / Neon / any Postgres. Handles ~1M rows/day comfortably.

-- ── Raw normalized rows (backs the server-side paginated Account Explorer) ────
CREATE TABLE IF NOT EXISTS account_rows (
  id                            bigserial PRIMARY KEY,
  account_no                    text,
  customer_name                 text,
  status                        text,
  goal_achieved                 text,
  qual_status                   text,
  disp_l1                       text,
  disp_l2                       text,
  ai_attempts                   integer,
  ai_connected_calls            integer,
  ai_connected_seconds          integer,
  minimum_amount_due            double precision,
  total_outstanding             double precision,
  total_accounts_with_customer  integer,
  months_on_book                integer,
  curr_bal_band                 text,
  region                        text,
  primary_state                 text,
  primary_city                  text,
  mobile                        text,
  model_logic                   text,
  paid_flag                     text,
  promise_flag                  text,
  refusal_flag                  text,
  refusal_reason                text,
  payment_mode                  text,
  lead_link                     text,
  segment                       text,
  lead_score                    text,
  -- Calendar date of the LAST call placed to this account ("YYYY-MM-DD").
  -- Not for charting. It is how the aggregator detects that the status file was
  -- pulled BEFORE the calls finished — see ALIASES.last_call_at in normalize.mjs.
  last_call_at                  text,
  batch_id                      text NOT NULL,
  report_date                   date NOT NULL
);

-- Migration for databases created before v6. Safe to re-run.
ALTER TABLE account_rows ADD COLUMN IF NOT EXISTS last_call_at text;

-- Indexes for fast per-batch paging, filtering and sorting.
CREATE INDEX IF NOT EXISTS idx_ar_batch            ON account_rows (batch_id);
CREATE INDEX IF NOT EXISTS idx_ar_date             ON account_rows (report_date);
CREATE INDEX IF NOT EXISTS idx_ar_batch_out        ON account_rows (batch_id, total_outstanding DESC);
CREATE INDEX IF NOT EXISTS idx_ar_batch_status     ON account_rows (batch_id, status);
CREATE INDEX IF NOT EXISTS idx_ar_batch_region     ON account_rows (batch_id, region);
CREATE INDEX IF NOT EXISTS idx_ar_batch_band       ON account_rows (batch_id, curr_bal_band);
CREATE INDEX IF NOT EXISTS idx_ar_batch_disp       ON account_rows (batch_id, disp_l1);
-- For search on name / account / mobile (trigram). pg_trgm ships with Postgres.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_ar_name_trgm        ON account_rows USING gin (customer_name gin_trgm_ops);

-- ── Per-batch computed payload (the small agg+intel JSON the dashboard reads) ─
CREATE TABLE IF NOT EXISTS batches (
  id           text PRIMARY KEY,          -- 2026-07-07__u1 | 2026-07-07__daytotal
  report_date  date NOT NULL,
  uploaded_at  timestamptz NOT NULL DEFAULT now(),
  filename     text,
  row_count    bigint,
  kind         text NOT NULL,             -- 'upload' | 'daytotal'
  label        text,
  upload_time  text,
  payload      jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_batches_date ON batches (report_date, uploaded_at);

-- Tabs used to read "Upload 1 / Upload 2". They are days, and they are now labelled
-- as such. Batches filed before the rename keep the old label unless we rewrite it.
-- Idempotent: the WHERE clause makes a second run a no-op.
UPDATE batches SET label = 'Day ' || substring(label from 8)
 WHERE label LIKE 'Upload %';

-- NOTE (scale): at high retention you can convert account_rows to a
-- range-partitioned table on report_date (one partition/day or /month) and drop
-- old partitions cheaply. The app code is unchanged — only the DDL differs.

-- ── Share links: a private, revocable, expiring URL to ONE report ─────────────
-- The token IS the credential. Scoped to a single batch: the holder cannot navigate
-- to another date, cannot upload, and cannot open the Account Explorer. The payload
-- served through it is stripped of customer names, so a leaked link is an
-- embarrassment rather than a personal-data breach.
CREATE TABLE IF NOT EXISTS share_links (
  token           text PRIMARY KEY,        -- 32 random bytes, base64url
  batch_id        text NOT NULL,
  report_date     date NOT NULL,
  label           text,                    -- who it was issued to (watermarked on the page)
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz,             -- NULL = never expires; revoke is then the only control
  revoked         boolean NOT NULL DEFAULT false,
  views           integer NOT NULL DEFAULT 0,
  last_viewed_at  timestamptz
);
CREATE INDEX IF NOT EXISTS idx_share_batch ON share_links (batch_id);

-- What the link grants access to.
--   'batch' — ONE report (the original behaviour)
--   'date'  — every report filed under report_date: Day Total, Day 1, Day 2 …
--
-- Defaults to 'batch' ON PURPOSE. Links already issued were cut under the old promise
-- of "one report and nothing else"; widening them retroactively, in a migration, with
-- no way for the issuer to know, would be handing a recipient access they were never
-- granted. Old links stay narrow. New links are 'date'.
ALTER TABLE share_links ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'batch';
