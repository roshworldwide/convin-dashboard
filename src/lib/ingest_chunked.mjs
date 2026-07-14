/* ─────────────────────────────────────────────────────────────────────────────
 * CHUNKED INGEST — how the 12.5 MB gets in.
 *
 * THE PROBLEM
 * Vercel refuses any serverless request body over 4.5 MB. Hard platform limit — not a
 * setting, not a plan tier. The three real files are 12.5 MB, so posting them to the
 * server returns 413 before a line of our code runs.
 *
 * THE INSIGHT
 * The server does not need the FILES. It needs the JOINED ROWS. And everything required
 * to produce them — SheetJS, the merge, the normaliser — is plain JavaScript that runs
 * perfectly well in a browser. So the browser does the work it was always capable of:
 *
 *      12.5 MB of files   →  parse + join in the browser  →  7,042 canonical rows
 *      7,042 rows as JSON                                  =  5.19 MB   (still too big)
 *      …gzipped                                            =  0.57 MB   (11× smaller)
 *      …and chunked at 2,500 rows                          =  3 requests, ~0.2 MB each
 *
 * The 12.5 MB never leaves the browser. The wire carries a twentieth of it. And the
 * server never spends a second of lambda time parsing a 177,685-row workbook.
 *
 * WHY CHUNKS AND NOT ONE COMPRESSED POST
 * 0.57 MB would fit today. It would not fit for a 100,000-account book, and it would
 * fail at exactly the moment the book got big enough to matter. Chunking removes the
 * ceiling entirely.
 *
 * WHY THIS IS STATELESS
 * On Vercel, chunk 1 and chunk 2 can land on two different machines. Accumulating rows
 * in memory between requests would work perfectly on a laptop and lose data in
 * production, intermittently, which is the worst way for anything to break. So every
 * chunk is written straight through to durable storage, and `commit` reads it all back.
 * ───────────────────────────────────────────────────────────────────────────── */

import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { hasDb, insertRows, deleteBatch, upsertBatch, forEachRowOfDate } from './db.mjs';
import { Aggregator } from './aggregate.mjs';
import { unionByAccount } from './dayunion.mjs';
import { isResolved } from './normalize.mjs';

const DATA = () => path.join(process.cwd(), 'src', 'data');
const BATCHES = () => path.join(DATA(), 'batches');

const displayDate = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
};

// Same shape the Account Explorer expects. Kept in lockstep with backend.mjs.
const displayRow = (r) => [
  r.account_no, r.customer_name, r.status, r.disp_l1 || '—', r.region || '—', r.primary_state || '—',
  r.curr_bal_band, r.total_outstanding, isResolved(r) ? r.total_outstanding : 0,
  r.ai_attempts, r.ai_connected_calls, r.payment_mode || '—', r.promise_flag === 'YES' ? 'Yes' : '—',
  r.mobile || '—', r.lead_link || '',
];

const readJson = async (p, d) => { try { return JSON.parse(await readFile(p, 'utf8')); } catch { return d; } };
const writeJson = (p, o) => writeFile(p, JSON.stringify(o));

/** Wipe anything already filed under this batch. A re-upload REPLACES, it never appends —
    appending would silently double the book, which is the exact bug we spent a day killing. */
export async function beginBatch({ reportDate, slot }) {
  const batchId = `${reportDate}__u${slot}`;
  if (hasDb()) {
    await deleteBatch(batchId);
  } else {
    await mkdir(BATCHES(), { recursive: true });
    for (const suffix of ['.json', '.rows.json', '.canon.json', '.sources.json']) {
      try { await unlink(path.join(BATCHES(), batchId + suffix)); } catch { /* wasn't there */ }
    }
  }
  return batchId;
}

/** Append one chunk. Straight through to storage — never held in memory between requests. */
export async function appendChunk({ batchId, reportDate, rows }) {
  if (!rows || !rows.length) return 0;
  if (hasDb()) {
    await insertRows(rows, batchId, reportDate);
  } else {
    const f = path.join(BATCHES(), `${batchId}.canon.json`);
    const existing = await readJson(f, []);
    existing.push(...rows);
    await writeJson(f, existing);
  }
  return rows.length;
}

/** All chunks are in. Aggregate, write the payload, rebuild the Day Total. */
export async function commitBatch({ batchId, reportDate, slot, filename, uploadTime, sources }) {
  const disp = displayDate(reportDate);

  /* Read the rows back from storage rather than trusting anything the client kept. The
     client and the database disagreeing about what was uploaded is a class of bug that
     does not announce itself. */
  const canon = [];
  if (hasDb()) {
    await forEachRowOfBatch(batchId, (r) => canon.push(r));
  } else {
    canon.push(...await readJson(path.join(BATCHES(), `${batchId}.canon.json`), []));
  }
  if (!canon.length) throw new Error('No rows were received. The upload did not complete.');

  const agg = new Aggregator();
  for (const r of canon) agg.add(r);
  const payload = agg.payload(disp, sources || []);

  if (hasDb()) {
    await upsertBatch(
      { id: batchId, reportDate, filename, rowCount: canon.length, kind: 'upload', label: `Upload ${slot}`, uploadTime },
      payload,
    );
    await recomputeDayTotalDb(reportDate);
  } else {
    await writeJson(path.join(BATCHES(), `${batchId}.json`), payload);
    await writeJson(path.join(BATCHES(), `${batchId}.rows.json`), canon.map(displayRow));
    await writeJson(path.join(BATCHES(), `${batchId}.sources.json`), sources || []);
    await recomputeDayTotalLocal(reportDate, disp, { batchId, slot, filename, uploadTime, rowCount: canon.length });
  }

  return { batchId, rowCount: canon.length };
}

/* ── Day Total: a UNION of accounts, never a sum of rows. Same rule everywhere. ── */

async function recomputeDayTotalDb(reportDate) {
  const byAccount = new Map();
  await forEachRowOfDate(reportDate, (r) => {
    const k = String(r.account_no ?? '').trim();
    if (k) byAccount.set(k, r);          // last write wins — the newest upload
  });
  const agg = new Aggregator();
  for (const r of byAccount.values()) agg.add(r);
  await upsertBatch(
    { id: `${reportDate}__daytotal`, reportDate, filename: '', rowCount: byAccount.size, kind: 'daytotal', label: 'Day Total', uploadTime: '' },
    agg.payload(displayDate(reportDate)),
  );
}

async function recomputeDayTotalLocal(iso, disp, entry) {
  const { readdir } = await import('node:fs/promises');
  const files = (await readdir(BATCHES())).filter((f) => f.startsWith(`${iso}__u`) && f.endsWith('.canon.json')).sort();

  const chunks = [];
  const daySources = [];
  for (const f of files) {
    chunks.push(await readJson(path.join(BATCHES(), f), []));
    const su = await readJson(path.join(BATCHES(), f.replace('.canon.json', '.sources.json')), []);
    for (const x of su) daySources.push({ ...x, upload: f.replace(`${iso}__`, '').replace('.canon.json', '') });
  }
  const union = unionByAccount(chunks);

  const dayAgg = new Aggregator();
  for (const r of union.rows) dayAgg.add(r);
  const dt = `${iso}__daytotal`;
  await writeJson(path.join(BATCHES(), `${dt}.json`), dayAgg.payload(disp, daySources));
  await writeJson(path.join(BATCHES(), `${dt}.rows.json`), union.rows.map(displayRow));

  // Manifest. The tab label and the cards must never disagree about the account count.
  const manPath = path.join(DATA(), 'manifest.json');
  const man = await readJson(manPath, { dates: [], latest: null });
  let d = man.dates.find((x) => x.date === iso);
  if (!d) { d = { date: iso, display: disp, dayTotal: dt, uploads: [], rowCount: 0 }; man.dates.push(d); }
  d.display = disp; d.dayTotal = dt; d.rowCount = union.rows.length;

  const u = { id: entry.batchId, label: `Upload ${entry.slot}`, time: entry.uploadTime, filename: entry.filename, rowCount: entry.rowCount };
  const i = d.uploads.findIndex((x) => x.id === entry.batchId);
  if (i >= 0) d.uploads[i] = u; else d.uploads.push(u);
  d.uploads.sort((a, b) => a.id.localeCompare(b.id));

  man.dates.sort((a, b) => (a.date < b.date ? 1 : -1));
  man.latest = man.dates[0]?.date || null;
  await writeJson(manPath, man);
}

/* Rows for ONE batch. db.mjs has forEachRowOfDate; this is its per-batch twin. */
async function forEachRowOfBatch(batchId, onRow) {
  const { getPool } = await import('./db.mjs');
  const pool = await getPool();
  const cols = [
    'account_no', 'customer_name', 'status', 'goal_achieved', 'qual_status', 'disp_l1', 'disp_l2',
    'ai_attempts', 'ai_connected_calls', 'ai_connected_seconds', 'minimum_amount_due', 'total_outstanding',
    'total_accounts_with_customer', 'months_on_book', 'curr_bal_band', 'region', 'primary_state',
    'primary_city', 'mobile', 'model_logic', 'paid_flag', 'promise_flag', 'refusal_flag',
    'refusal_reason', 'payment_mode', 'lead_link', 'segment', 'lead_score', 'last_call_at',
  ];
  const { rows } = await pool.query(`SELECT ${cols.join(',')} FROM account_rows WHERE batch_id = $1`, [batchId]);
  for (const r of rows) onRow(r);
}
