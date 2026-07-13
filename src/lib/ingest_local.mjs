// Zero-infra ingestion: writes batch files under src/data so `npm run dev` shows
// the dashboard immediately after an upload — no database required. (On Vercel the
// filesystem is read-only, so production uses the Postgres path instead.)

import { readFile, writeFile, readdir, mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { isResolved } from './normalize.mjs';
import { Aggregator } from './aggregate.mjs';
import { unionByAccount } from './dayunion.mjs';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const displayDate = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };
const DATA = () => path.join(process.cwd(), 'src', 'data');
const BATCHES = () => path.join(DATA(), 'batches');
const r2 = (n) => Math.round(n * 100) / 100;

function displayRow(r) {
  const o = r.total_outstanding;
  return [r.account_no, r.customer_name, r.status, r.disp_l1 || '—', r.region || '—', r.primary_state || '—',
    r.curr_bal_band, r2(o), isResolved(r) ? r2(o) : 0, r.ai_attempts, r.ai_connected_calls,
    r.payment_mode || '—', r.promise_flag === 'YES' ? 'Yes' : '—', r.mobile || '—', r.lead_link || ''];
}
const writeJson = (p, obj) => writeFile(p, JSON.stringify(obj), 'utf8');
async function readJsonSafe(p, fb) { try { return JSON.parse(await readFile(p, 'utf8')); } catch { return fb; } }

/** Delete an entire report day (all uploads + day total) and drop it from the manifest. */
export async function deleteLocalDate(iso) {
  const files = await readdir(BATCHES()).catch(() => []);
  for (const f of files) {
    if (f.startsWith(`${iso}__`)) await unlink(path.join(BATCHES(), f)).catch(() => {});
  }
  const manPath = path.join(DATA(), 'manifest.json');
  const man = await readJsonSafe(manPath, { dates: [], latest: null });
  man.dates = man.dates.filter((d) => d.date !== iso);
  man.latest = man.dates[0] ? man.dates[0].date : null;
  await writeJson(manPath, man);
  return { deleted: iso };
}

// `canon` = canonical rows (already merged from the status + additional sheets).
export async function ingestLocalUpload(canon, { reportDate, slot = 1, filename = '', uploadTime = '', sources = [] }) {
  if (!canon || !canon.length) throw new Error('No data rows found in file.');
  await mkdir(BATCHES(), { recursive: true });

  const iso = reportDate;
  const disp = displayDate(iso);

  const bid = `${iso}__u${slot}`;
  const agg = new Aggregator();
  for (const r of canon) agg.add(r);
  await writeJson(path.join(BATCHES(), `${bid}.json`), agg.payload(disp, sources));
  await writeJson(path.join(BATCHES(), `${bid}.rows.json`), canon.map(displayRow));
  await writeJson(path.join(BATCHES(), `${bid}.canon.json`), canon);
  await writeJson(path.join(BATCHES(), `${bid}.sources.json`), sources);

  /* Recompute Day Total from every upload's canon file for this date — as a UNION of
     accounts, not a concatenation of rows. Uploading the same book twice must not
     double the money. See dayunion.mjs. */
  const files = (await readdir(BATCHES())).filter((f) => f.startsWith(`${iso}__u`) && f.endsWith('.canon.json')).sort();
  const chunks = [];
  for (const f of files) chunks.push(await readJsonSafe(path.join(BATCHES(), f), []));
  const union = unionByAccount(chunks);

  const dayAgg = new Aggregator();
  for (const rr of union.rows) dayAgg.add(rr);
  const dayRows = union.rows.map(displayRow);
  const count = union.rows.length;

  /* The Day Total's sources are every file that fed it — in upload order, so the LAST
     status file listed is the one whose outcomes won. That ordering is the whole point. */
  const daySources = [];
  for (const f of files) {
    const su = await readJsonSafe(path.join(BATCHES(), f.replace('.canon.json', '.sources.json')), []);
    for (const x of su) daySources.push({ ...x, upload: f.replace(`${iso}__`, '').replace('.canon.json', '') });
  }
  const dt = `${iso}__daytotal`;
  await writeJson(path.join(BATCHES(), `${dt}.json`), dayAgg.payload(disp, daySources));
  await writeJson(path.join(BATCHES(), `${dt}.rows.json`), dayRows);

  // Update the manifest.
  const manPath = path.join(DATA(), 'manifest.json');
  const man = await readJsonSafe(manPath, { dates: [], latest: null });
  let d = man.dates.find((x) => x.date === iso);
  if (!d) { d = { date: iso, display: disp, dayTotal: dt, uploads: [], rowCount: 0 }; man.dates.push(d); }
  d.display = disp; d.dayTotal = dt; d.rowCount = count;
  const entry = { id: bid, label: `Upload ${slot}`, time: uploadTime, filename, rowCount: canon.length, sources };
  const ei = d.uploads.findIndex((u) => u.id === bid);
  if (ei >= 0) d.uploads[ei] = entry; else d.uploads.push(entry);
  d.uploads.sort((a, b) => a.id.localeCompare(b.id));
  man.dates.sort((a, b) => (a.date < b.date ? 1 : -1));
  man.latest = man.dates[0] ? man.dates[0].date : null;
  await writeJson(manPath, man);

  return { batchId: bid, rowCount: canon.length, reportDate: iso };
}
