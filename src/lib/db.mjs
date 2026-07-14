// Postgres access layer. `pg` is imported lazily so the app still builds/runs in
// zero-infra local mode (no DATABASE_URL, no pg installed).

let _pool = null;

export function hasDb() {
  return !!process.env.DATABASE_URL;
}

export async function getPool() {
  if (_pool) return _pool;
  const { default: pg } = await import('pg');
  _pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false },
    max: 8,
  });
  return _pool;
}

const COLS = [
  'account_no', 'customer_name', 'status', 'goal_achieved', 'qual_status', 'disp_l1', 'disp_l2',
  'ai_attempts', 'ai_connected_calls', 'ai_connected_seconds', 'minimum_amount_due', 'total_outstanding',
  'total_accounts_with_customer', 'months_on_book', 'curr_bal_band', 'region', 'primary_state',
  'primary_city', 'mobile', 'model_logic', 'paid_flag', 'promise_flag', 'refusal_flag',
  'refusal_reason', 'payment_mode', 'lead_link', 'segment', 'lead_score', 'last_call_at',
  'batch_id', 'report_date',
];

// Bulk insert canonical rows for a batch (batched multi-row INSERT, ~1000/stmt).
export async function insertRows(rows, batchId, reportDate) {
  const pool = await getPool();
  const client = await pool.connect();
  try {
    const CHUNK = 1000;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK);
      const values = [];
      const params = [];
      slice.forEach((r, j) => {
        const base = j * COLS.length;
        const ph = COLS.map((_, k) => `$${base + k + 1}`);
        values.push(`(${ph.join(',')})`);
        params.push(
          r.account_no, r.customer_name, r.status, r.goal_achieved, r.qual_status, r.disp_l1, r.disp_l2,
          r.ai_attempts, r.ai_connected_calls, r.ai_connected_seconds, r.minimum_amount_due, r.total_outstanding,
          r.total_accounts_with_customer, r.months_on_book, r.curr_bal_band, r.region, r.primary_state,
          r.primary_city, r.mobile, r.model_logic, r.paid_flag, r.promise_flag, r.refusal_flag,
          r.refusal_reason, r.payment_mode, r.lead_link, r.segment, r.lead_score,
          r.last_call_at || null, batchId, reportDate,
        );
      });
      await client.query(`INSERT INTO account_rows (${COLS.join(',')}) VALUES ${values.join(',')}`, params);
    }
  } finally {
    client.release();
  }
}

export async function deleteBatch(batchId) {
  const pool = await getPool();
  await pool.query('DELETE FROM account_rows WHERE batch_id = $1', [batchId]);
  await pool.query('DELETE FROM batches WHERE id = $1', [batchId]);
}

/** Delete an entire report day. */
export async function deleteDate(iso) {
  const pool = await getPool();
  await pool.query('DELETE FROM account_rows WHERE report_date = $1', [iso]);
  await pool.query('DELETE FROM batches WHERE report_date = $1', [iso]);
  return { deleted: iso };
}

export async function upsertBatch(meta, payload) {
  const pool = await getPool();
  await pool.query(
    `INSERT INTO batches (id, report_date, uploaded_at, filename, row_count, kind, label, upload_time, payload)
     VALUES ($1,$2,now(),$3,$4,$5,$6,$7,$8)
     ON CONFLICT (id) DO UPDATE SET uploaded_at=now(), row_count=EXCLUDED.row_count,
       filename=EXCLUDED.filename, kind=EXCLUDED.kind, label=EXCLUDED.label,
       upload_time=EXCLUDED.upload_time, payload=EXCLUDED.payload`,
    [meta.id, meta.reportDate, meta.filename || '', meta.rowCount || 0, meta.kind, meta.label || '', meta.uploadTime || '', JSON.stringify(payload)],
  );
}

export async function listBatches() {
  const pool = await getPool();
  const { rows } = await pool.query(
    `SELECT id, to_char(report_date,'YYYY-MM-DD') AS report_date, uploaded_at, filename,
            row_count, kind, label, upload_time
     FROM batches ORDER BY report_date DESC, uploaded_at ASC`,
  );
  return rows;
}

export async function getPayload(id) {
  const pool = await getPool();
  const { rows } = await pool.query('SELECT payload FROM batches WHERE id = $1', [id]);
  return rows[0] ? rows[0].payload : null;
}

// Stream all rows for a report_date through a callback (for Day Total recompute).
export async function forEachRowOfDate(reportDate, onRow) {
  const pool = await getPool();
  const dataCols = COLS.slice(0, COLS.length - 2); // everything except batch_id / report_date
  const { rows } = await pool.query(`SELECT ${dataCols.join(',')} FROM account_rows WHERE report_date = $1`, [reportDate]);
  for (const r of rows) onRow(r);
}

// Must stay in lockstep with the local sort in backend.mjs — if the two paths order
// rows differently, the same report shows a different table depending on whether
// DATABASE_URL happens to be set. Text columns sort as text; numbers as numbers.
const SORT_SQL = {
  Outstanding: 'total_outstanding',
  Recovered: "(CASE WHEN status='Resolved' THEN total_outstanding ELSE 0 END)",
  Attempts: 'ai_attempts',
  Connected: 'ai_connected_calls',
  Status: 'status',
  Disposition: 'disp_l1',
  Region: 'region',
  Band: 'curr_bal_band',
  'Customer Name': 'customer_name',
  'Account No': 'account_no',
};

// Server-side paginated rows for the Account Explorer.
export async function queryRows({ id, reportDate, page = 0, size = 15, q = '', status = 'All', region = 'All', band = 'All', disp = 'All', sort = 'Outstanding', dir = 'desc' }) {
  const pool = await getPool();
  const where = [];
  const params = [];
  const add = (clause, val) => { params.push(val); where.push(clause.replace('?', `$${params.length}`)); };

  if (id && id.endsWith('__daytotal')) add('report_date = ?', reportDate);
  else add('batch_id = ?', id);
  if (status !== 'All') add('status = ?', status);
  if (region !== 'All') add('region = ?', region);
  if (band !== 'All') add('curr_bal_band = ?', band);
  if (disp !== 'All') add('disp_l1 = ?', disp);
  if (q && q.trim()) { const like = `%${q.trim()}%`; params.push(like, like, like); where.push(`(customer_name ILIKE $${params.length - 2} OR account_no ILIKE $${params.length - 1} OR mobile ILIKE $${params.length})`); }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const orderCol = SORT_SQL[sort] || SORT_SQL.Outstanding;
  const orderSql = `ORDER BY ${orderCol} ${dir === 'asc' ? 'ASC' : 'DESC'}`;

  const totalRes = await pool.query(`SELECT count(*)::bigint AS c FROM account_rows ${whereSql}`, params);
  const total = Number(totalRes.rows[0].c);

  const lim = Math.min(100, Math.max(1, size));
  const off = Math.max(0, page) * lim;
  const dataRes = await pool.query(
    `SELECT account_no, customer_name, status, disp_l1, region, primary_state, curr_bal_band,
            total_outstanding, ai_attempts, ai_connected_calls, payment_mode, promise_flag, mobile, lead_link
     FROM account_rows ${whereSql} ${orderSql} LIMIT ${lim} OFFSET ${off}`,
    params,
  );
  const rows = dataRes.rows.map((r) => [
    r.account_no, r.customer_name, r.status, r.disp_l1 || '—', r.region || '—', r.primary_state || '—',
    r.curr_bal_band, r.total_outstanding, r.status === 'Resolved' ? r.total_outstanding : 0,
    r.ai_attempts, r.ai_connected_calls, r.payment_mode || '—', r.promise_flag === 'YES' ? 'Yes' : '—',
    r.mobile || '—', r.lead_link || '',
  ]);
  return { total, rows };
}

export async function distinctFilters(id, reportDate) {
  const pool = await getPool();
  const scope = id && id.endsWith('__daytotal') ? ['report_date = $1', reportDate] : ['batch_id = $1', id];
  const one = async (col) => (await pool.query(`SELECT DISTINCT ${col} v FROM account_rows WHERE ${scope[0]} AND ${col} <> '' ORDER BY v`, [scope[1]])).rows.map((r) => r.v);
  return { Status: await one('status'), Region: await one('region'), Band: await one('curr_bal_band'), Disposition: await one('disp_l1') };
}
