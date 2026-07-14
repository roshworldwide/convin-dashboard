/* ─────────────────────────────────────────────────────────────────────────────
 * DO THE REPORT DATES SHARE ACCOUNTS?
 *
 * Everything about how the Campaign Summary should behave hangs on one fact, and it
 * is a fact about the data, not a matter of opinion:
 *
 *   Same accounts across dates   → one book, re-read. Outstanding must NEVER grow.
 *   Different accounts           → different cycles, different customers. Outstanding
 *                                  legitimately differs, and the two must not be mixed.
 *
 * You cannot tell by looking at the totals. 3 July shows 7,042 accounts and 5 July
 * shows 4,622 — that is consistent with a partial re-pull of the same cycle AND with a
 * completely different cycle. The only way to know is to compare the account numbers.
 *
 *   npm run overlap
 * ───────────────────────────────────────────────────────────────────────────── */

import { readFileSync } from 'node:fs';

for (const file of ['.env.local', '.env']) {
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { continue; }
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

const { manifest } = await import('../src/lib/backend.mjs');
const { hasDb } = await import('../src/lib/db.mjs');

const cr = (x) => `₹${(x / 1e7).toFixed(2)} Cr`;
const int = (n) => Number(n || 0).toLocaleString('en-IN');

async function accountsOf(iso) {
  if (hasDb()) {
    const { getPool } = await import('../src/lib/db.mjs');
    const pool = await getPool();
    const { rows } = await pool.query(
      `SELECT DISTINCT account_no, total_outstanding FROM account_rows WHERE report_date = $1`, [iso],
    );
    return rows;
  }
  const { readdir, readFile } = await import('node:fs/promises');
  const path = await import('node:path');
  const dir = path.join(process.cwd(), 'src', 'data', 'batches');
  const files = (await readdir(dir)).filter((f) => f.startsWith(`${iso}__u`) && f.endsWith('.canon.json'));
  const seen = new Map();
  for (const f of files) {
    for (const r of JSON.parse(await readFile(path.join(dir, f), 'utf8'))) {
      seen.set(String(r.account_no), r);
    }
  }
  return [...seen.values()];
}

const man = await manifest();
const dates = [...(man.dates || [])].sort((a, b) => (a.date < b.date ? -1 : 1));

console.log(`\nStorage: ${hasDb() ? 'POSTGRES' : 'local JSON files'}`);
console.log(`${dates.length} report date${dates.length === 1 ? '' : 's'}\n`);
if (!dates.length) process.exit(0);

const sets = [];
for (const d of dates) {
  const rows = await accountsOf(d.date);
  const set = new Set(rows.map((r) => String(r.account_no).trim()));
  const out = rows.reduce((a, r) => a + Number(r.total_outstanding || 0), 0);
  sets.push({ date: d.date, display: d.display, set, out });
  console.log(`  ${d.display.padEnd(16)} ${int(set.size).padStart(7)} accounts   ${cr(out).padStart(11)}`);
}

if (sets.length < 2) {
  console.log('\nOnly one report date — nothing to compare. Outstanding cannot add up.\n');
  process.exit(0);
}

console.log('\nDo they share accounts?\n');
let anyDisjoint = false;
for (let i = 0; i < sets.length - 1; i++) {
  const a = sets[i], b = sets[i + 1];
  let shared = 0;
  for (const k of b.set) if (a.set.has(k)) shared++;
  const pct = b.set.size ? (shared / b.set.size) * 100 : 0;
  const verdict = pct >= 95 ? 'SAME BOOK — re-read'
    : pct <= 5 ? 'DIFFERENT BOOK — new customers'
      : 'PARTIAL OVERLAP — look closely';
  if (pct <= 5) anyDisjoint = true;
  console.log(`  ${a.display} → ${b.display}`);
  console.log(`    ${int(shared)} of ${b.display}'s ${int(b.set.size)} accounts also appear in ${a.display}  (${pct.toFixed(1)}%)  ${verdict}\n`);
}

const union = new Set();
for (const s of sets) for (const k of s.set) union.add(k);
const latest = sets[sets.length - 1];

console.log('WHAT THIS MEANS FOR THE SUMMARY HEADLINE\n');
console.log(`  union of every date : ${int(union.size)} accounts`);
console.log(`  latest book only    : ${int(latest.set.size)} accounts   ${cr(latest.out)}`);
if (union.size > latest.set.size) {
  console.log(`\n  ${int(union.size - latest.set.size)} accounts appear on an earlier date but NOT in the latest book.`);
  console.log('  The Summary reports the LATEST book, and shows these separately rather than');
  console.log('  adding them in — outstanding is a stock, and stocks are never summed over time.');
} else {
  console.log('\n  Every account in the union is in the latest book. Nothing can add up.');
}
if (anyDisjoint) {
  console.log('\n  ⚠ At least one pair shares almost no accounts — these are genuinely different');
  console.log('    cycles. Their outstanding must never be added together.');
}
console.log();
process.exit(0);
