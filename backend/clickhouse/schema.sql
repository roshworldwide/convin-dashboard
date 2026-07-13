-- ClickHouse schema for the Convin × RBL Recovery Intelligence backend.
-- Two tables: raw normalized rows (for the paginated Account Explorer) and
-- one computed payload per batch (the small agg+intel JSON the frontend reads).

CREATE DATABASE IF NOT EXISTS rbl;

-- ── Raw normalized rows ──────────────────────────────────────────────────────
-- One row per account per uploaded batch. Partitioned by report_date so a day's
-- data is pruned cheaply; ordered for fast per-batch / per-date scans + paging.
CREATE TABLE IF NOT EXISTS rbl.account_rows
(
    account_no                   String,
    customer_name                String,
    status                       LowCardinality(String),
    goal_achieved                LowCardinality(String),
    qual_status                  LowCardinality(String),
    disp_l1                      LowCardinality(String),
    disp_l2                      String,
    ai_attempts                  UInt32,
    ai_connected_calls           UInt32,
    ai_connected_seconds         UInt32,
    minimum_amount_due           Float64,
    total_outstanding            Float64,
    total_accounts_with_customer UInt16,
    months_on_book               UInt16,
    curr_bal_band                LowCardinality(String),
    region                       LowCardinality(String),
    primary_state                LowCardinality(String),
    primary_city                 String,
    mobile                       String,
    model_logic                  LowCardinality(String),
    paid_flag                    LowCardinality(String),
    promise_flag                 LowCardinality(String),
    refusal_flag                 LowCardinality(String),
    refusal_reason               String,
    payment_mode                 LowCardinality(String),
    lead_link                    String,
    batch_id                     String,
    report_date                  Date
)
ENGINE = MergeTree
PARTITION BY report_date
ORDER BY (report_date, batch_id, account_no);

-- ── Per-batch computed payload ───────────────────────────────────────────────
-- `payload` is the exact {meta, agg, intel} JSON the dashboard renders. One row
-- per upload, plus one merged "daytotal" row per date. ReplacingMergeTree lets
-- the ingester overwrite the daytotal as new uploads land the same day.
CREATE TABLE IF NOT EXISTS rbl.batches
(
    id           String,                 -- e.g. 2026-07-07__u1 | 2026-07-07__daytotal
    report_date  Date,
    uploaded_at  DateTime,
    filename     String,
    row_count    UInt64,
    kind         LowCardinality(String), -- 'upload' | 'daytotal'
    label        String,                 -- e.g. 'Upload 1'
    upload_time  String,                 -- e.g. '09:12 AM'
    payload      String                  -- {meta, agg, intel} JSON
)
ENGINE = ReplacingMergeTree(uploaded_at)
ORDER BY (id);
