// Generate 10 SYNTHETIC report CSVs for validating RoshRegression across days.
//
// ─────────────────────────────────────────────────────────────────────────────
// THESE ARE SYNTHETIC. Never cite a number derived from them to RBL as if it
// were a real recovery result. They exist to answer one question only:
//
//     "Does RoshRegression's edge hold up day after day, or did we get lucky
//      on one report?"
// ─────────────────────────────────────────────────────────────────────────────
//
// Method. Each day is a bootstrap resample of the REAL 1,908-account book, so
// every row is a real account with its real outcome — the feature/outcome
// relationship is never fabricated. What varies between days is the *mix*:
//
//   - campaign intensity  — how many accounts the AI actually reached
//   - book size           — 1,400 to 2,400 accounts
//   - segment skew        — some days lean toward high-balance, aged accounts
//
// That reproduces the way a real collections book drifts week to week (a bad
// dialling day, a fresh delinquency cohort) without inventing a relationship
// that isn't in the data. If the model's edge survives that, it's robust.
//
//   node evals/generate_reports.mjs

import fs from 'node:fs';
import path from 'node:path';
import { parseCsv } from '../src/lib/csv.mjs';

const SRC = path.join(process.cwd(), 'src', 'data', 'convin_source.csv');
const OUT = path.join(process.cwd(), 'evals', 'reports');
fs.mkdirSync(OUT, { recursive: true });

const parsed = parseCsv(fs.readFileSync(SRC, 'utf8'));   // [headerRow, ...dataRows]
const headers = parsed[0];
const raw = parsed.slice(1).filter((r) => r && r.length > 1);
const H = (name) => headers.indexOf(name);

const iConn = H('AI Connected Calls');
const iSec = H('AI Connected Seconds');
const iOut = H('total_outstanding');
const iMob = H('Months on Book');
const iStatus = H('Status');

const num = (v) => { const n = parseFloat(String(v ?? '').replace(/[, ₹]/g, '')); return Number.isFinite(n) ? n : 0; };

/* Deterministic PRNG — mulberry32. A naive LCG overflows JS's 53-bit integer
   precision and degenerates into a short cycle; Math.imul keeps it in 32-bit space. */
let seed = 20260711 >>> 0;
const rnd = () => {
  seed = (seed + 0x6D2B79F5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/* Ten days of plausible operating conditions. `reach` scales how many CONNECTED
   accounts survive the resample (a bad dialling day drops them); `heavy` skews
   toward large, aged balances. Written out explicitly so the sweep is auditable. */
const DAYS = [
  { day: 1, n: 1900, reach: 1.00, heavy: 0.0, note: 'baseline — mirrors the real book' },
  { day: 2, n: 2100, reach: 1.05, heavy: 0.0, note: 'strong dialling day' },
  { day: 3, n: 1650, reach: 0.80, heavy: 0.0, note: 'poor connectivity' },
  { day: 4, n: 2400, reach: 0.95, heavy: 0.3, note: 'large book, high-balance skew' },
  { day: 5, n: 1400, reach: 1.10, heavy: 0.0, note: 'small, well-worked book' },
  { day: 6, n: 1950, reach: 0.65, heavy: 0.0, note: 'bad day — half the book never picked up' },
  { day: 7, n: 2000, reach: 1.00, heavy: 0.5, note: 'aged delinquency cohort' },
  { day: 8, n: 1750, reach: 0.90, heavy: 0.2, note: 'mixed' },
  { day: 9, n: 2200, reach: 1.08, heavy: 0.0, note: 'high-intensity campaign' },
  { day: 10, n: 1600, reach: 0.75, heavy: 0.4, note: 'hard book, weak reach' },
];

const esc = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const manifest = [];
for (const d of DAYS) {
  const rows = [];
  let guard = 0;
  while (rows.length < d.n && guard < d.n * 60) {
    guard++;
    const r = raw[Math.floor(rnd() * raw.length)];
    if (!r) continue;

    // Campaign intensity: on a weak-reach day, connected accounts are less likely
    // to appear (the AI simply didn't get through to them).
    const connected = num(r[iConn]) > 0;
    if (connected && d.reach < 1 && rnd() > d.reach) continue;
    if (!connected && d.reach > 1 && rnd() > 2 - d.reach) continue;

    // Segment skew toward big, aged balances.
    if (d.heavy > 0) {
      const big = num(r[iOut]) > 80000 || num(r[iMob]) > 60;
      if (!big && rnd() < d.heavy) continue;
    }
    rows.push(r);
  }

  // Re-key account numbers so each day is a distinct book (as text, never sci-notation).
  const out = rows.map((r, i) => {
    const c = r.slice();
    c[H('Account No')] = `9${String(d.day).padStart(2, '0')}${String(i).padStart(13, '0')}`;
    return c;
  });

  const csv = [headers.map(esc).join(','), ...out.map((r) => r.map(esc).join(','))].join('\n');
  const iso = `2026-08-${String(d.day).padStart(2, '0')}`;
  const file = path.join(OUT, `report_${iso}.csv`);
  fs.writeFileSync(file, csv + '\n');

  const res = out.filter((r) => String(r[iStatus]).trim() === 'Resolved').length;
  const conn = out.filter((r) => num(r[iConn]) > 0).length;
  manifest.push({ day: d.day, iso, file: path.basename(file), rows: out.length,
    resolvedPct: res / out.length * 100, connectedPct: conn / out.length * 100, note: d.note });
  console.log(`Day ${String(d.day).padStart(2)}  ${iso}  ${String(out.length).padStart(5)} rows  `
    + `resolved ${(res / out.length * 100).toFixed(1).padStart(5)}%  `
    + `connected ${(conn / out.length * 100).toFixed(1).padStart(5)}%   ${d.note}`);
}

fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({ synthetic: true, source: 'bootstrap resample of the real 1,908-account book', days: manifest }, null, 2));
console.log(`\n10 synthetic reports -> evals/reports/   (upload any of these through the dashboard)`);
