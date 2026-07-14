// Read facade used by the API routes. Uses Postgres when DATABASE_URL is set,
// otherwise falls back to the zero-infra local JSON files (demo mode).

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { hasDb, listBatches, getPayload, queryRows, distinctFilters } from './db.mjs';
import { displayDate } from './ingest.mjs';

export const ROWS_HEADER = ['Account No', 'Customer Name', 'Status', 'Disposition', 'Region', 'State', 'Band', 'Outstanding', 'Recovered', 'Attempts', 'Connected', 'PaymentMode', 'PTP', 'Mobile', 'LeadLink'];
const DATA = () => path.join(process.cwd(), 'src', 'data');
const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'));

export function mode() { return hasDb() ? 'db' : 'local'; }

/* ── manifest (dates -> uploads + day total) ── */
export async function manifest() {
  if (!hasDb()) return readJson(path.join(DATA(), 'manifest.json'));
  const rows = await listBatches();
  const byDate = new Map();
  for (const b of rows) {
    if (!byDate.has(b.report_date)) byDate.set(b.report_date, { date: b.report_date, display: displayDate(b.report_date), dayTotal: null, uploads: [], rowCount: 0 });
    const d = byDate.get(b.report_date);
    if (b.kind === 'daytotal') { d.dayTotal = b.id; d.rowCount = Number(b.row_count); }
    else d.uploads.push({ id: b.id, label: b.label, time: b.upload_time, filename: b.filename, rowCount: Number(b.row_count) });
  }
  const dates = [...byDate.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
  return { dates, latest: dates[0] ? dates[0].date : null };
}

/* ── one batch payload (agg + intel, no rows) ── */
export async function batchPayload(id) {
  if (!hasDb()) return readJson(path.join(DATA(), 'batches', `${id}.json`));
  return getPayload(id);
}

/* ── paginated explorer rows ── */
export async function rows(params) {
  const { id, page = 0, size = 15, q = '', status = 'All', region = 'All', band = 'All', disp = 'All', sort = 'Outstanding', dir = 'desc' } = params;
  if (hasDb()) {
    const reportDate = id.split('__')[0];
    const { total, rows: r } = await queryRows({ id, reportDate, page: +page, size: +size, q, status, region, band, disp, sort, dir });
    const filters = await distinctFilters(id, reportDate);
    return pack(r, total, +page, +size, filters);
  }
  // local: read the batch rows file and page in-process
  let all;
  try { all = await readJson(path.join(DATA(), 'batches', `${id}.rows.json`)); }
  catch { all = []; }
  // Numeric columns sort numerically; text columns sort as text. Running parseFloat
  // over a text column returns NaN, and a NaN comparator makes Array.sort return an
  // arbitrary order — an analyst clicking "Status" would get a scrambled table.
  const NUMERIC = { Outstanding: 7, Recovered: 8, Attempts: 9, Connected: 10 };
  const TEXT = { Status: 2, Disposition: 3, Region: 4, Band: 6, 'Customer Name': 1, 'Account No': 0 };
  const qq = q.trim().toLowerCase();
  let filtered = all.filter((row) => {
    if (status !== 'All' && row[2] !== status) return false;
    if (region !== 'All' && row[4] !== region) return false;
    if (band !== 'All' && row[6] !== band) return false;
    if (disp !== 'All' && row[3] !== disp) return false;
    if (qq) { const hay = `${row[0]} ${row[1]} ${row[13]}`.toLowerCase(); if (!hay.includes(qq)) return false; }
    return true;
  });
  const d = dir === 'asc' ? 1 : -1;
  if (TEXT[sort] !== undefined) {
    const si = TEXT[sort];
    filtered = filtered.slice().sort((a, b) => String(a[si] ?? '').localeCompare(String(b[si] ?? '')) * d);
  } else {
    const si = NUMERIC[sort] ?? NUMERIC.Outstanding;
    filtered = filtered.slice().sort((a, b) => {
      const x = Number(a[si]); const y = Number(b[si]);
      return ((Number.isFinite(x) ? x : 0) - (Number.isFinite(y) ? y : 0)) * d;
    });
  }
  const total = filtered.length;
  const lim = Math.min(100, Math.max(1, +size));
  // A negative page must return nothing. Array.slice(-15, 0) reads from the END of
  // the table and would quietly serve the wrong rows.
  const pg = Math.max(0, Math.floor(+page) || 0);
  const pageRows = filtered.slice(pg * lim, (pg + 1) * lim);
  const uniq = (i) => Array.from(new Set(all.map((r) => r[i]).filter(Boolean))).sort();
  const filters = { Status: uniq(2), Region: uniq(4), Band: uniq(6), Disposition: uniq(3) };
  return pack(pageRows, total, pg, lim, filters);
}

function pack(rowsArr, total, page, size, filters) {
  return { header: ROWS_HEADER, rows: rowsArr, total, page, totalPages: Math.max(1, Math.ceil(total / size)), filters };
}

