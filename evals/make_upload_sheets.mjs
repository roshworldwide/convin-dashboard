// Build ready-to-upload test sheets for the dashboard.
//
// Produces two things in evals/upload/:
//
//   1. MERGED  — one complete sheet. Upload with mode = "already merged".
//   2. SPLIT   — a status sheet + a portfolio sheet. Upload with mode = "split"
//                to exercise the built-in VLOOKUP. The split is deliberately
//                awkward: Status lives only in sheet 1 and total_outstanding only
//                in sheet 2, so neither sheet can produce a single KPI on its own.
//                If the join silently fails, every number goes to zero — which is
//                exactly the failure we want to be able to see.
//
//   node evals/make_upload_sheets.mjs

import fs from 'node:fs';
import path from 'node:path';
import { parseCsv } from '../src/lib/csv.mjs';

const OUT = path.join(process.cwd(), 'evals', 'upload');
fs.mkdirSync(OUT, { recursive: true });

// Default to the REAL RBL book. These are the sheets you drag in on stage, so they
// must produce the real numbers — ₹6.50 Cr — not a resampled test book.
const SRC = process.argv[2]
  ? path.join(process.cwd(), 'evals', 'reports', process.argv[2])
  : path.join(process.cwd(), 'src', 'data', 'convin_source.csv');
const parsed = parseCsv(fs.readFileSync(SRC, 'utf8'));
const headers = parsed[0];
const rows = parsed.slice(1).filter((r) => r && r.length > 1);

const KEY = 'Account No';

// What the AI campaign knows about the call.
const STATUS_COLS = [
  KEY, 'Status', 'Lead Link', 'Lead State', 'Goal Achieved', 'Qualification Status',
  'CollectionsDisposition_v2 L1', 'CollectionsDisposition_v2 L2',
  'Total AI Call Attempts', 'AI Connected Calls', 'AI Connected Seconds',
  "Lead Entity If payment done return 'Mode of Payment",
  'Lead Entity Paid', 'Lead Entity Promise to Pay', 'Lead Entity Refusal to pay',
];
// What the bank knows about the account. Note: the money lives here.
const PORTFOLIO_COLS = headers.filter((h, i) => !STATUS_COLS.includes(h) && headers.indexOf(h) === i);

const esc = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const project = (cols) => {
  const idx = cols.map((c) => headers.indexOf(c)).filter((i) => i >= 0);
  const used = idx.map((i) => headers[i]);
  const body = rows.map((r) => idx.map((i) => esc(r[i])).join(','));
  return { csv: [used.map(esc).join(','), ...body].join('\n') + '\n', cols: used };
};

// Merged: the whole sheet, unchanged.
const merged = [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n') + '\n';
fs.writeFileSync(path.join(OUT, '1_MERGED_full_sheet.csv'), merged);

// Split: two sheets that must be joined on Account No.
const st = project(STATUS_COLS);
const pf = project([KEY, ...PORTFOLIO_COLS.filter((c) => c !== KEY)]);
fs.writeFileSync(path.join(OUT, '2_SPLIT_status_sheet.csv'), st.csv);
fs.writeFileSync(path.join(OUT, '3_SPLIT_portfolio_sheet.csv'), pf.csv);

const has = (cols, c) => (cols.includes(c) ? 'yes' : 'no ');
console.log(`Source: ${path.basename(SRC)}  (${rows.length} accounts)\n`);
console.log('  FILE                            cols  Status?  total_outstanding?');
console.log('  ' + '-'.repeat(66));
console.log(`  1_MERGED_full_sheet.csv         ${String(headers.length).padStart(4)}   ${has(headers, 'Status')}      ${has(headers, 'total_outstanding')}`);
console.log(`  2_SPLIT_status_sheet.csv        ${String(st.cols.length).padStart(4)}   ${has(st.cols, 'Status')}      ${has(st.cols, 'total_outstanding')}   <- no money here`);
console.log(`  3_SPLIT_portfolio_sheet.csv     ${String(pf.cols.length).padStart(4)}   ${has(pf.cols, 'Status')}      ${has(pf.cols, 'total_outstanding')}   <- no status here`);
console.log(`\n  Neither split sheet can produce a single KPI alone. The join has to work.`);
console.log(`\n-> evals/upload/`);
