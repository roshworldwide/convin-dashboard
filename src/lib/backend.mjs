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

/* ── THE CAMPAIGN SUMMARY ───────────────────────────────────────────────────────
 *
 * Every report date is a re-pull of the SAME book: one CYC file, joined against a
 * status file pulled on a later and later day. The accounts do not change. The
 * outcomes do.
 *
 * So the campaign total is NOT the sum of the days. Add "recovered" across five report
 * dates and you report five times the money — arithmetically defensible, visually
 * plausible, and utterly false. It is the number an exec repeats out loud, which makes
 * it the worst possible place for that bug. It already shipped once at the day level:
 * three uploads of a ₹13 Cr book produced a ₹65 Cr "Day Total".
 *
 * Same rule as Day Total, one level up:
 *
 *     the campaign is the UNION of accounts across every date, NEWEST DATE WINS.
 *
 * Union, not sum. Re-pull the same book ten times and the money does not move. Send a
 * genuinely new cycle and its accounts are added, because they are new accounts. Both
 * are correct and neither needs a special case.
 *
 * Computed on request rather than stored: it spans every date, so any upload
 * invalidates it, and a cached campaign roll-up that silently went stale would be
 * exactly the class of bug this app exists to refuse.
 * ─────────────────────────────────────────────────────────────────────────────── */
export async function campaignSummary() {
  const { Aggregator } = await import('./aggregate.mjs');
  const { buildSummary } = await import('./summary.mjs');

  const man = await manifest();
  const dates = [...(man.dates || [])].sort((a, b) => (a.date < b.date ? -1 : 1)); // OLDEST first

  if (!dates.length) return { version: 1, days: 0, trend: [], campaign: null, findings: [], actions: [] };

  // Each day's stored Day Total — cheap, already computed, drives the trend line.
  const days = [];
  for (const d of dates) {
    const payload = await batchPayload(d.dayTotal);
    if (payload) days.push({ date: d.date, display: d.display, payload });
  }

  /* The union. Iterating OLDEST → NEWEST and letting later writes overwrite means the
     newest status for an account is the one that survives — which is the whole point:
     an account resolved on the 8th must not still read Unresolved because the 4th said
     so. */
  const byAccount = new Map();
  for (const d of dates) {
    for (const r of await rowsOfDate(d.date)) {
      const k = String(r.account_no ?? '').trim();
      if (k) byAccount.set(k, r);
    }
  }

  if (!byAccount.size) {
    return { version: 1, days: days.length, trend: [], campaign: null, findings: [], actions: [] };
  }

  const agg = new Aggregator();
  for (const r of byAccount.values()) agg.add(r);
  const campaign = agg.payload(dates.length === 1 ? dates[0].display : `${dates[0].display} — ${dates[dates.length - 1].display}`);

  return buildSummary({ campaign, days });
}

/** Canonical rows for one report date. Postgres or the local files — same shape out. */
async function rowsOfDate(iso) {
  if (hasDb()) {
    const { forEachRowOfDate } = await import('./db.mjs');
    const out = [];
    await forEachRowOfDate(iso, (r) => out.push(r));
    return out;
  }
  const { readdir } = await import('node:fs/promises');
  const dir = path.join(DATA(), 'batches');
  let files = [];
  try {
    files = (await readdir(dir)).filter((f) => f.startsWith(`${iso}__u`) && f.endsWith('.canon.json')).sort();
  } catch { return []; }
  const out = [];
  for (const f of files) {
    try { out.push(...await readJson(path.join(dir, f))); } catch { /* a half-written upload; skip it */ }
  }
  return out;
}
