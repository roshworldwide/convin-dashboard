// Synthesize a brand-new 10,000-account book — with a DIFFERENT internal structure.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS EXISTS, AND WHAT IT DOES *NOT* PROVE
//
// These accounts are invented. The outcome for each one is drawn from a latent
// propensity function that I wrote by hand. So RoshRegression "working" on this
// file proves NOTHING about whether it works on real collections data — it would
// only be recovering coefficients I planted. Never cite a number from this book.
//
// What it DOES test, and what nothing else we have can test:
//
//   1. SCALE      — 10,000 rows through parse -> merge -> fit -> score -> render.
//   2. ADAPTATION — the ground truth here is deliberately INVERTED against the
//                   real RBL book. Here, a promise to pay is a GENUINELY GOOD
//                   signal, long calls barely matter, and aged accounts collapse.
//                   If RoshRegression is honestly refitting per book, it must
//                   discover that and show "Promised to pay" as POSITIVE.
//                   If the −18pt finding is secretly hardcoded anywhere, this
//                   file will expose it immediately.
//
// That second test is the point. This is an adversarial file, not a demo file.
// ─────────────────────────────────────────────────────────────────────────────
//
//   node evals/synth_book.mjs [rows]

import fs from 'node:fs';
import path from 'node:path';

const N = Number(process.argv[2]) || 10000;
const OUT = path.join(process.cwd(), 'evals', 'upload');
fs.mkdirSync(OUT, { recursive: true });

/* Deterministic PRNG — mulberry32.
   NOT a naive LCG: `seed * 1103515245` blows past JS's 53-bit integer precision,
   which silently degenerates the sequence into a short cycle and produces
   thousands of duplicate rows. Math.imul keeps every step in true 32-bit space. */
let s = 987654321 >>> 0;
const rnd = () => {
  s = (s + 0x6D2B79F5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (a) => a[Math.floor(rnd() * a.length)];
const gauss = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

/* A different geography from the RBL book — a southern/western-weighted portfolio. */
const GEO = [
  ['South', 'Karnataka', 'Bengaluru'], ['South', 'Karnataka', 'Mysuru'],
  ['South', 'Tamil Nadu', 'Chennai'], ['South', 'Tamil Nadu', 'Coimbatore'],
  ['South', 'Telangana', 'Hyderabad'], ['South', 'Kerala', 'Kochi'],
  ['West', 'Maharashtra', 'Pune'], ['West', 'Maharashtra', 'Nagpur'],
  ['West', 'Gujarat', 'Ahmedabad'], ['West', 'Gujarat', 'Surat'],
  ['North', 'Rajasthan', 'Jaipur'], ['North', 'Punjab', 'Ludhiana'],
  ['North', 'Haryana', 'Gurugram'], ['East', 'Odisha', 'Bhubaneswar'],
];
const FIRST = ['ARJUN', 'MEERA', 'ROHAN', 'KAVYA', 'ADITYA', 'SNEHA', 'VIKRAM', 'ANANYA', 'KARTHIK', 'DIVYA', 'RAHUL', 'PRIYA', 'NIKHIL', 'ISHA', 'SIDDHARTH', 'NEHA', 'VARUN', 'POOJA', 'ANIRUDH', 'RIYA', 'MANOJ', 'SWATI', 'GAUTAM', 'LAKSHMI'];
const LAST = ['IYER', 'REDDY', 'NAIR', 'PATIL', 'DESAI', 'SHETTY', 'RAO', 'MENON', 'JOSHI', 'KULKARNI', 'PILLAI', 'BHAT', 'GOWDA', 'SHARMA', 'MEHTA', 'CHAUHAN'];
const SEG = ['Red', 'Amber', 'Green'];

const band = (o) => (o < 30000 ? '20-30k' : o < 50000 ? '30-50k' : o < 70000 ? '50-70k' : o < 100000 ? '70-100k' : o < 200000 ? '100-200k' : '>200k');
const sig = (z) => 1 / (1 + Math.exp(-z));

/* ── TWO GROUND TRUTHS. Pick one with --mode.  ─────────────────────────────────

   --mode inverted   (default)  An ADVERSARIAL book. Promise-to-pay is deliberately
                                POSITIVE, talk time nearly irrelevant. Nothing here
                                matches the real finding — that is the point. If the
                                dashboard reports a positive promise lift on this file,
                                the model is genuinely refitting rather than replaying
                                a conclusion baked into the code. A test, not a demo.

   --mode realistic             A SHAREABLE book. Same shape as RBL's real portfolio —
                                promise-to-pay is a trap, long conversations convert —
                                but every person in it is invented. This is the one you
                                put behind a public link. It tells the true story with
                                nobody's cardholder in it.

   Neither describes real people. Never quote a rupee figure from either.       */
const MODE = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'inverted';

const INVERTED = (r) => sig(
  -0.35
  + 1.55 * (r.promise === 'YES' ? 1 : 0)      // ← inverted: promises are GOOD here
  + 0.10 * Math.log1p(r.secs) / 5             // ← talk time barely matters
  - 0.030 * r.mob                             // ← aged debt collapses
  + 0.45 * (r.out > 100000 ? 1 : 0)           // ← big balances resolve better
  + 1.30 * (r.paid === 'YES' ? 1 : 0)
  - 1.60 * (r.refusal === 'YES' ? 1 : 0)
  + 0.25 * (r.conn > 0 ? 1 : 0)
  + 0.35 * gauss() * 0.5,                     // irreducible noise — no model can beat this
);

/* Mirrors the structure RoshRegression actually found in RBL's book:
     claimed already paid  +46 pts      promised to pay   −18 pts
     talked 2+ minutes     +17 pts      refused to pay    strongly negative
   The magnitudes will not match to the decimal — they shouldn't, this is a
   different book — but the SHAPE, and therefore the story, is the same. */
const REALISTIC = (r) => sig(
  -0.30
  - 1.70 * (r.promise === 'YES' ? 1 : 0)      // ← a promise is worse than silence
  + 0.85 * (r.secs >= 120 ? 1 : 0)            // ← the two-minute conversation converts
  + 0.20 * Math.log1p(r.secs) / 3
  + 2.30 * (r.paid === 'YES' ? 1 : 0)         // ← "I already paid" is usually true
  - 2.40 * (r.refusal === 'YES' ? 1 : 0)
  + 0.35 * (r.conn > 0 ? 1 : 0)
  - 0.004 * r.mob
  + 0.22 * gauss() * 0.5,                     // less noise → AUC lands near the real 0.744
);

const propensity = MODE === 'realistic' ? REALISTIC : INVERTED;

const rows = [];
for (let i = 0; i < N; i++) {
  const [region, state, city] = pick(GEO);
  const mob = Math.round(clamp(6 + Math.abs(gauss()) * 34, 1, 140));
  const out = Math.round(clamp(20000 + Math.abs(gauss()) * 62000, 20000, 600000));
  const minDue = Math.round(out * (0.05 + rnd() * 0.05) * 100) / 100;

  const attempts = Math.round(clamp(1 + Math.abs(gauss()) * 5, 1, 14));
  const reached = rnd() < 0.58;
  const conn = reached ? Math.round(clamp(1 + Math.abs(gauss()) * 2.5, 1, 12)) : 0;
  const secs = conn ? Math.round(clamp(Math.abs(gauss()) * 220, 3, 1200)) : 0;

  const r = { mob, out, secs, conn, promise: 'N/A', paid: 'N/A', refusal: 'N/A' };
  if (conn > 0) {
    const roll = rnd();
    if (roll < 0.22) r.promise = 'YES';
    else if (roll < 0.34) r.paid = 'YES';
    else if (roll < 0.44) r.refusal = 'YES';
    else { r.promise = 'NO'; }
  }

  const resolved = rnd() < propensity(r);

  let l1 = '', l2 = '', qual = '', goal = '', mode = '';
  if (conn === 0) { /* never reached — everything blank, as in the real export */ }
  else if (r.paid === 'YES') { l1 = 'Paid'; l2 = 'Paid'; qual = 'Qualified'; goal = 'Yes'; mode = pick(['PhonePe', 'Google Pay', 'Paytm', 'UPI', 'RBL App']); }
  else if (r.refusal === 'YES') { l1 = 'Refused to Pay'; l2 = "Won't Pay - Dispute"; qual = 'In Progress'; }
  else if (r.promise === 'YES') { l1 = 'Schedule Callback'; l2 = 'Promise to Pay Later'; qual = 'Qualified'; }
  else if (rnd() < 0.18) { l1 = 'DNC'; l2 = 'Potential Complaint'; qual = 'In Progress'; }
  else { l1 = 'Schedule Callback'; l2 = pick(['Follow-Up', 'Message to Third Party']); qual = rnd() < 0.5 ? 'Qualified' : 'In Progress'; }
  if (resolved && r.paid !== 'YES') { mode = pick(['PhonePe', 'Google Pay', 'UPI', 'Net/Online', 'RBL App']); }

  const seg = pick(SEG);
  const acct = '00074' + String(80000000000000 + i * 7919).slice(0, 14);
  rows.push([
    acct,
    resolved ? 'Resolved' : 'Unresolved',
    `https://activate.convin.ai/tenant/rblbank/campaigns/8f2a-synthetic/leads/${i}`,
    'active', goal, qual, l1, l2,
    attempts, conn, secs,
    '12 August 2026', minDue, seg, out,
    mode, r.paid, r.promise, r.refusal,
    rnd() < 0.22 ? 2 : 1,
    out, minDue, mob, band(out), seg,
    pick(['MR', 'MS', 'MRS']),
    `${pick(FIRST)} ${pick(LAST)}`,
    city, state,
    '9' + String(Math.floor(rnd() * 900000000) + 100000000),
    region,
    pick(['Model 1', 'Model 2', 'Others']),
  ]);
}

// .trim() matters: the source CSV has CRLF endings, so the header line carries a
// stray \r that would ride along into the last column name and break header matching.
const HEADERS = fs.readFileSync(path.join(process.cwd(), 'src', 'data', 'convin_source.csv'), 'utf8')
  .split('\n')[0].trim();
const esc = (v) => { const t = String(v ?? ''); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
const file = path.join(OUT, MODE === 'realistic' ? '5_SHAREABLE_demo_book.csv' : '4_SYNTHETIC_10k_inverted_book.csv');
fs.writeFileSync(file, [HEADERS, ...rows.map((r) => r.map(esc).join(','))].join('\n') + '\n');

const res = rows.filter((r) => r[1] === 'Resolved').length;
const promisedRes = rows.filter((r) => r[17] === 'YES' && r[1] === 'Resolved').length;
const promised = rows.filter((r) => r[17] === 'YES').length;
const baseRate = res / rows.length * 100;
const promiseRate = promised ? promisedRes / promised * 100 : 0;

console.log(`Wrote ${rows.length.toLocaleString('en-IN')} synthetic accounts -> evals/upload/${path.basename(file)}\n`);
console.log(`  base recovery rate      : ${baseRate.toFixed(1)}%`);
console.log(`  promised to pay         : ${promised} accounts, ${promiseRate.toFixed(1)}% resolved`);
console.log(`  => planted promise lift : ${(promiseRate - baseRate >= 0 ? '+' : '')}${(promiseRate - baseRate).toFixed(1)} pts  (POSITIVE — the opposite of the real book)\n`);
console.log(`  The real RBL book has promise at −18.3 pts. If RoshRegression reports`);
console.log(`  a POSITIVE lift on this file, it is genuinely refitting per book.`);
