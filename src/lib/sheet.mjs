// One reader for every file RBL and Convin actually send.
//
// The real upload is three files and two of them are .xlsx:
//
//   1. LEAD OUTCOME  (.csv)   Convin's campaign export. Who we called, how long we
//                             talked, what they said. THE PRIMARY — it decides which
//                             accounts exist in this report.
//   2. CYC / PDD     (.xlsx)  RBL's portfolio file. Balance, band, region, months on
//                             book, agency, decile. The money and the demographics.
//   3. STATUS        (.xlsx)  RBL's outcome file. account_no -> Resolved / Unresolved.
//
// The third one matters more than it looks. The OUTCOME — the label the entire model
// is trained on — comes from the bank, in the bank's own file. Convin does not decide
// who was recovered and cannot mark its own homework. Keep it that way.

import * as XLSX from 'xlsx';
import { parseCsv } from './csv.mjs';

/** Buffer/string + filename -> array of rows (row 0 = headers), same shape as parseCsv. */
export function readSheet(buf, filename = '') {
  const isExcel = /\.xlsx?$/i.test(filename)
    // .xlsx is a ZIP: bytes 'P','K'. Trust the magic number over the extension.
    || (buf?.length > 1 && buf[0] === 0x50 && buf[1] === 0x4B);

  if (!isExcel) {
    const text = typeof buf === 'string' ? buf : Buffer.from(buf).toString('utf8');
    return parseCsv(text);
  }

  const wb = XLSX.read(buf, { type: 'buffer', cellDates: false, raw: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error(`"${filename}" has no sheets in it.`);

  // header:1 gives array-of-arrays. defval:'' keeps blank cells as columns rather than
  // collapsing them, so a row never silently shifts left.
  // raw:false renders everything as the displayed string — critical for account numbers,
  // which Excel stores as floats and would otherwise arrive as 7.4787e+15.
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false, blankrows: false });
  return rows.map((r) => r.map((c) => (c === null || c === undefined ? '' : String(c))));
}

/** What kind of file is this? Used to label the upload slots and to sanity-check them. */
export function detectSheetKind(headers) {
  const h = new Set((headers || []).map((x) => String(x ?? '').trim().toLowerCase()));
  const hasAll = (...ks) => ks.every((k) => h.has(k));

  // Status file: two columns, and one of them is the outcome. Distinctive.
  if (h.has('status') && (h.has('account_no') || h.has('account no')) && h.size <= 4) return 'status';
  // Lead outcome: only Convin's export has the AI call telemetry.
  if (hasAll('total ai call attempts') || h.has('ai connected seconds')) return 'leads';
  // CYC / PDD: the bank's portfolio.
  if (h.has('bill cycle') || h.has('curr bal band') || h.has('portfolio(pdd)')) return 'cyc';
  return 'unknown';
}
