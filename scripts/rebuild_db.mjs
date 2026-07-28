/* ─────────────────────────────────────────────────────────────────────────────
 * REBUILD, AGAINST POSTGRES.
 *
 * WHY THIS HAD TO EXIST
 * A batch payload is computed ONCE, at upload time, and stored. That is what makes
 * the dashboard instant — and it means a change to the aggregator does not reach a
 * report that is already filed. The report keeps serving the JSON it was born with.
 *
 * `rebuild_local.mjs` fixes that for the JSON-file mode. It did NOT fix it for
 * Postgres — and Postgres is what production runs on. So every payload change meant
 * re-uploading the source files by hand, and until you did, the deployed dashboard
 * showed old field names computed by new code. Exactly that happened: the funnel kept
 * saying "AI Calls Attempted" after the rename had shipped, because the words were
 * frozen in a payload written days earlier.
 *
 * This replays every stored row back through the current Aggregator and rewrites the
 * payload in place. THE SOURCE ROWS ARE NEVER TOUCHED — account_rows is read-only
 * here. Nothing is re-uploaded, nothing is re-joined, and no number changes except
 * the ones the aggregator itself now computes differently.
 *
 *   DATABASE_URL=<direct connection, :5432> npm run rebuild
 *
 * Use the DIRECT connection string, not the pooler — this opens one long session and
 * writes every batch through it.
 * ───────────────────────────────────────────────────────────────────────────── */

import { getPool, listBatches, getPayload, upsertBatch, forEachRowOfDate, DATA_COLS } from '../src/lib/db.mjs';
import { Aggregator } from '../src/lib/aggregate.mjs';
import { PAYLOAD_VERSION } from '../src/lib/payload_version.mjs';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const displayDate = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };

/* The column list is IMPORTED from db.mjs. It used to be a hand-copied third replica,
   with a comment asking whoever edited it to remember two other files — and a rebuild
   that silently drops a column writes a payload WORSE than the stale one it replaced,
   which is the failure this whole script exists to prevent. One list now. */
const COLS = DATA_COLS;

const pool = await getPool();
const batches = await listBatches();
const uploads = batches.filter((b) => b.kind === 'upload');

if (!uploads.length) {
  console.log('No uploads in the database — nothing to rebuild.');
  process.exit(0);
}

console.log(`Rebuilding ${uploads.length} upload${uploads.length > 1 ? 's' : ''} to payload v${PAYLOAD_VERSION}.\n`);

const dates = new Set();
const sourcesByDate = new Map();

for (const b of uploads) {
  const iso = b.report_date;
  dates.add(iso);

  /* Provenance lives in the OLD payload — it describes which files were joined, and
     no amount of re-aggregating the rows can reconstruct it. Carry it forward. */
  const old = await getPayload(b.id);
  const sources = old?.meta?.sources || [];
  if (!sourcesByDate.has(iso)) sourcesByDate.set(iso, []);
  sourcesByDate.get(iso).push(...sources);

  const { rows } = await pool.query(
    `SELECT ${COLS.join(',')} FROM account_rows WHERE batch_id = $1`, [b.id],
  );
  if (!rows.length) {
    console.log(`  ⚠ ${b.id}: no rows in account_rows — LEAVING ITS PAYLOAD ALONE.`);
    console.log('    (Overwriting it with an empty aggregate would turn a stale report into a blank one.)');
    continue;
  }

  const agg = new Aggregator();
  for (const r of rows) agg.add(r);

  // "Upload 1" → "Day 1", same rename as everywhere else.
  const label = String(b.label || '').replace(/^Upload\b/i, 'Day') || 'Day';

  await upsertBatch(
    {
      id: b.id, reportDate: iso, filename: b.filename, rowCount: rows.length,
      kind: 'upload', label, uploadTime: b.upload_time,
    },
    agg.payload(displayDate(iso), sources),
  );

  const renamed = label !== b.label ? `  ("${b.label}" → "${label}")` : '';
  console.log(`  ${b.id}: ${rows.length.toLocaleString('en-IN')} rows${renamed}`);
}

/* ── Day Totals. A UNION of accounts across the day's uploads, never a sum of rows.
      Same rule as every other path — upload the same book twice and the money must
      not double. ── */
for (const iso of [...dates].sort()) {
  const byAccount = new Map();
  await forEachRowOfDate(iso, (r) => {
    const k = String(r.account_no ?? '').trim();
    if (k) byAccount.set(k, r);           // last write wins — the newest upload
  });
  if (!byAccount.size) continue;

  const agg = new Aggregator();
  for (const r of byAccount.values()) agg.add(r);

  await upsertBatch(
    {
      id: `${iso}__daytotal`, reportDate: iso, filename: '', rowCount: byAccount.size,
      kind: 'daytotal', label: 'Day Total', uploadTime: '',
    },
    agg.payload(displayDate(iso), sourcesByDate.get(iso) || []),
  );
  console.log(`✔ ${iso} Day Total: ${byAccount.size.toLocaleString('en-IN')} accounts`);
}

console.log('\nDone. Reload the dashboard — no re-upload, no re-join, and no number changed');
console.log('except the ones the aggregator now computes differently.');
await pool.end();
