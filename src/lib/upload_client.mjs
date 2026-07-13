/* ─────────────────────────────────────────────────────────────────────────────
 * The browser side of the upload.
 *
 * The whole 12.5 MB stays here. What crosses the wire is the JOINED result, gzipped and
 * chunked — about 0.6 MB, comfortably under Vercel's immovable 4.5 MB body cap.
 *
 *   12.5 MB of files  →  parse + join (here)  →  7,042 canonical rows
 *   as JSON                                    =  5.19 MB   ✗ still over the cap
 *   gzipped                                    =  0.57 MB   ✓ 11× smaller
 *   in 2,500-row chunks                        =  3 posts, ~0.2 MB each
 *
 * Every line of parsing and joining below is the SAME code the server used to run —
 * sheet.mjs, merge.mjs, normalize.mjs. Not a browser-flavoured copy of it. A second
 * implementation would drift, and the day it drifted the two would disagree about a
 * bank's numbers and nobody would know which was right.
 * ───────────────────────────────────────────────────────────────────────────── */

import { readSheet, detectSheetKind } from './sheet.mjs';
import { buildCanonicalRows } from './merge.mjs';
import { autoMap } from './normalize.mjs';

const CHUNK_ROWS = 2500;

/** gzip in the browser. CompressionStream is in every current Chrome, Safari and Firefox.
    If it is somehow absent we send plain JSON and let the chunk size carry us. */
async function gzip(text) {
  if (typeof CompressionStream === 'undefined') return { body: text, gzipped: false };
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  const buf = await new Response(stream).arrayBuffer();
  return { body: buf, gzipped: true };
}

async function post(payload, onRetry) {
  const { body, gzipped } = await gzip(JSON.stringify(payload));
  const headers = { 'Content-Type': 'application/octet-stream' };
  if (gzipped) headers['x-gzip'] = '1';

  /* One retry. A single dropped chunk on a hotel wifi would otherwise leave a
     half-written book in the database — which is the failure mode this whole app has
     been built to make impossible. */
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch('/api/ingest/chunk', { method: 'POST', headers, body });
    const j = await res.json().catch(() => ({}));
    if (res.ok) return j;
    if (attempt === 0 && res.status >= 500) { onRetry?.(); continue; }
    throw new Error(j.error || `Upload failed (${res.status})`);
  }
  throw new Error('Upload failed after a retry.');
}

/**
 * Parse the files, join them, and stream the result to the server.
 *
 * @param files      File[] — CYC, status, lead outcome, in any order
 * @param opts       { reportDate, slot, mapping }
 * @param onProgress ({ phase, pct, note }) => void
 */
export async function uploadFiles(files, { reportDate, slot = 1, mapping = null }, onProgress = () => {}) {
  onProgress({ phase: 'reading', pct: 5, note: 'Reading the files…' });

  const sheets = [];
  for (const f of files) {
    if (!f) continue;
    const buf = await f.arrayBuffer();
    const rows = readSheet(buf, f.name);
    sheets.push({ file: f, name: f.name, rows, kind: detectSheetKind(rows[0]) });
    onProgress({ phase: 'reading', pct: 5 + (25 * sheets.length) / files.length, note: `Read ${f.name}` });
  }
  if (!sheets.length) throw new Error('No files to upload.');

  /* CYC is the spine — it decides which accounts exist. Detected, not assumed from the
     order they were dropped in: hand the status file to the CYC slot and you would get a
     book with the wrong denominator, and nothing downstream would notice. */
  const cyc = sheets.find((s) => s.kind === 'cyc');
  const primary = cyc || sheets[0];
  const lookups = sheets.filter((s) => s !== primary);

  onProgress({ phase: 'joining', pct: 35, note: 'Joining on Account No…' });

  const map = mapping || autoMap(sheets.flatMap((s) => s.rows[0]));
  const { rows: canon, stats, warnings } = buildCanonicalRows(
    primary.rows, lookups.map((s) => s.rows), map, lookups.map((s) => s.name),
  );

  const sources = sheets.map((s) => ({
    slot: s === primary ? (cyc ? 'CYC / PDD (primary)' : 'Merged sheet')
      : (s.kind === 'status' ? 'Status' : s.kind === 'leads' ? 'Lead outcome' : 'Additional'),
    name: s.name,
    rows: Math.max(0, s.rows.length - 1),
    detected: s.kind,
  }));

  onProgress({ phase: 'sending', pct: 45, note: `${canon.length.toLocaleString('en-IN')} accounts joined — sending…` });

  const meta = { reportDate, slot, filename: primary.name, sources };
  const { batchId } = await post({ phase: 'begin', ...meta });

  const total = Math.ceil(canon.length / CHUNK_ROWS);
  for (let i = 0; i < total; i++) {
    const part = canon.slice(i * CHUNK_ROWS, (i + 1) * CHUNK_ROWS);
    await post({ phase: 'chunk', batchId, reportDate, rows: part },
      () => onProgress({ phase: 'sending', pct: 45 + (45 * i) / total, note: 'Retrying a chunk…' }));
    onProgress({
      phase: 'sending',
      pct: 45 + (45 * (i + 1)) / total,
      note: `Sent ${Math.min((i + 1) * CHUNK_ROWS, canon.length).toLocaleString('en-IN')} of ${canon.length.toLocaleString('en-IN')}`,
    });
  }

  onProgress({ phase: 'building', pct: 93, note: 'Building the report…' });
  const res = await post({ phase: 'commit', batchId, ...meta });

  onProgress({ phase: 'done', pct: 100, note: 'Done.' });
  return { ...res, stats, warnings, sheets: sources };
}
