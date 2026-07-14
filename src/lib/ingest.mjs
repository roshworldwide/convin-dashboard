// High-level ingestion: normalize + insert rows + compute the batch payload +
// refresh the day-total. Streaming and memory-bounded (chunked inserts).

import { Aggregator } from './aggregate.mjs';
import { insertRows, upsertBatch, deleteBatch, forEachRowOfDate } from './db.mjs';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export function displayDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

// Ingest one upload. `canon` = canonical rows (already merged from the status +
// additional sheets). slot: 1-based upload index for the day.
export async function ingestUpload(canon, { reportDate, slot = 1, filename = '', uploadTime = '', sources = [] }) {
  if (!canon || !canon.length) throw new Error('No data rows found in file.');

  const iso = reportDate;
  const disp = displayDate(iso);
  const batchId = `${iso}__u${slot}`;
  await deleteBatch(batchId);

  const agg = new Aggregator();
  let buf = [];
  let count = 0;
  const CHUNK = 1000;
  for (const row of canon) {
    agg.add(row);
    buf.push(row);
    count++;
    if (buf.length >= CHUNK) { await insertRows(buf, batchId, iso); buf = []; }
  }
  if (buf.length) await insertRows(buf, batchId, iso);

  await upsertBatch({ id: batchId, reportDate: iso, filename, rowCount: count, kind: 'upload', label: `Day ${slot}`, uploadTime }, agg.payload(disp, sources));
  await recomputeDayTotal(iso);
  return { batchId, rowCount: count };
}

// Rebuild the merged Day Total for a date from all its rows.
export async function recomputeDayTotal(iso) {
  const disp = displayDate(iso);
  /* UNION, not sum. The DB holds one row per upload per account, so an account
     re-uploaded three times sits in account_rows three times. Aggregating all of them
     triples the book. Collapse to one row per account first — the query returns rows in
     insert order, so the last write for an account is the newest, and wins. */
  const byAccount = new Map();
  await forEachRowOfDate(iso, (r) => {
    const k = String(r.account_no ?? '').trim();
    if (k) byAccount.set(k, r);
  });
  const agg = new Aggregator();
  for (const r of byAccount.values()) agg.add(r);
  const count = byAccount.size;
  await upsertBatch({ id: `${iso}__daytotal`, reportDate: iso, filename: '', rowCount: count, kind: 'daytotal', label: 'Day Total', uploadTime: '' }, agg.payload(disp));
}
