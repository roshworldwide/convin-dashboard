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

  -- ── Rolled up from the AI CALL LOG (payload v9) ────────────────────────────
  -- The call log has one row per call ATTEMPT — 18,883 of them for 1,417 accounts on
  -- the real export. It is NOT stored at that grain. The canonical model of this app is
  -- one row per account, and every guard that makes it trustworthy (the CYC spine, the
  -- Day Total union, "re-uploading the book must not double the money") is keyed on the
  -- account. A second grain would have none of them.
  --
  -- So the attempts are folded onto the account in the browser (src/lib/calllog.mjs) and
  -- land in the columns below. The two histograms are compact text — "08:120:30|09:88:12"
  -- is hour:attempts:connected — so that the hour-of-day and per-attempt curves can be
  -- RE-DERIVED by the Aggregator from whatever set of accounts it is given. That is what
  -- makes them survive the Day Total union instead of doubling with every re-upload.
  ai_agency                     text,      -- which cohort worked it (AI-only vs AI+agency)
  first_call_at                 text,      -- "YYYY-MM-DD" of the first dial
  attempts_by_hour              text,      -- "HH:attempts:connected|…"
  outbound_lines                text,      -- "last4:attempts:connected|…"  (trunk, NOT an agent)
  attempt_mask                  text,      -- per attempt no: '1' answered '0' no answer '-' no such attempt
  max_attempt                   integer,
  attempt_first_paid            integer,   -- attempt no where a Paid disposition first landed, 0 = never
  dnc_attempt                   integer,   -- attempt no where DNC was first logged, 0 = never
  dials_after_dnc               integer,   -- dials placed AFTER that. The compliance number.
  voicemail_calls               integer,   -- answered by a machine: a connect, and not a conversation
  voicemail_seconds             integer,
  complaint_flag                boolean,
  dnc_flag                      boolean,
  refused_flag                  boolean,
  ptp_flag                      boolean,

  batch_id                      text NOT NULL,
  report_date                   date NOT NULL
);

-- Migration for databases created before v6. Safe to re-run.
ALTER TABLE account_rows ADD COLUMN IF NOT EXISTS last_call_at text;

-- Migration for databases created before v9 (the AI call log). Safe to re-run.
ALTER TABLE account_rows ADD COLUMN IF NOT EXISTS ai_agency          text;
ALTER TABLE account_rows ADD COLUMN IF NOT EXISTS first_call_at      text;
ALTER TABLE account_rows ADD COLUMN IF NOT EXISTS attempts_by_hour   text;
ALTER TABLE account_rows ADD COLUMN IF NOT EXISTS outbound_lines     text;
ALTER TABLE account_rows ADD COLUMN IF NOT EXISTS attempt_mask       text;
ALTER TABLE account_rows ADD COLUMN IF NOT EXISTS max_attempt        integer;
ALTER TABLE account_rows ADD COLUMN IF NOT EXISTS attempt_first_paid integer;
ALTER TABLE account_rows ADD COLUMN IF NOT EXISTS dnc_attempt        integer;
ALTER TABLE account_rows ADD COLUMN IF NOT EXISTS dials_after_dnc    integer;
ALTER TABLE account_rows ADD COLUMN IF NOT EXISTS voicemail_calls    integer;
ALTER TABLE account_rows ADD COLUMN IF NOT EXISTS voicemail_seconds  integer;
ALTER TABLE account_rows ADD COLUMN IF NOT EXISTS complaint_flag     boolean;
ALTER TABLE account_rows ADD COLUMN IF NOT EXISTS dnc_flag           boolean;
ALTER TABLE account_rows ADD COLUMN IF NOT EXISTS refused_flag       boolean;
ALTER TABLE account_rows ADD COLUMN IF NOT EXISTS ptp_flag           boolean;

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
