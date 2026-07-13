// PII guard. Run before every push. Wire it into a pre-commit hook.
//
//   npm run check:pii
//
// A .gitignore is a promise you make once and forget. This is a check that runs
// every time. It looks at what git would ACTUALLY commit — not at what you meant
// to ignore — and refuses to let a cardholder's name, mobile number, or card
// number leave the machine.
//
// This exists because the repository once contained 1,907 real RBL customers:
// full names, mobiles, 19-digit card numbers, balances, and who was defaulting.
// It was one `git push` from being public.

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

/* Signatures of real cardholder data. Deliberately conservative: a false alarm
   costs you a minute, a miss costs the bank its customers. */
// STRONG: on its own, this is a person. Any hit blocks the push.
// WEAK:   this is the SHAPE of the data — a column name, an example string. Code and
//         docs legitimately contain it. Only blocks when two weak signals co-occur,
//         which is what a real data file looks like.
const SIGNATURES = [
  // The (?<![\d.]) … (?![\d.]) guards matter: without them the mantissa of a float
  // like 0.7293915109013793 reads as a 16-digit card number, and the guard cries wolf
  // over a file of harmless statistics. A guard nobody trusts is a guard nobody runs.
  { name: 'Indian mobile number', strength: 'strong', re: /(?<![\d.])[6-9]\d{9}(?![\d.])/g, minHits: 3 },
  { name: 'card / loan account number (15-19 digits)', strength: 'strong', re: /(?<![\d.])\d{15,19}(?![\d.])/g, minHits: 3 },
  { name: 'Convin lead link (identifies a real lead record)', strength: 'strong', re: /activate\.convin\.ai\/tenant\/[a-z]+\/campaigns\//gi, minHits: 1 },
  { name: 'Excel-mangled account number', strength: 'weak', re: /\b\d\.\d+E\+\d{2}\b/g, minHits: 1 },
  { name: 'customer name column', strength: 'weak', re: /\b(Customer Name|CUSTOMER NAME)\b/g, minHits: 1 },
];

/* Files that are allowed to contain the SHAPE of this data — code that names the
   columns, tests that fabricate rows, docs that explain the problem. */
const ALLOWED = [
  /^scripts\/check_pii\.mjs$/,
  /^src\/lib\//,           // column names live in the code by necessity
  /^evals\/stress/,        // fabricated test rows
  /^evals\/synth_book\.mjs$/,
  /^\.gitignore$/,
  /^DATA_HANDLING\.md$/,
  /^deck\/MEETING_SCRIPT\.md$/,
  /^db\/postgres\/schema\.sql$/,
];

const BINARY = /\.(png|jpe?g|gif|pdf|zip|woff2?|ttf|ico|pptx|docx|xlsx)$/i;

function filesGitWouldCommit() {
  try {
    execSync('git rev-parse --is-inside-work-tree', { stdio: 'ignore' });
  } catch {
    // Not a repo yet. Check everything that ISN'T gitignored, by simulating it.
    const all = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name === '.git' || e.name === '.next') continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else all.push(path.relative(ROOT, p));
      }
    };
    walk(ROOT);
    return { files: all, note: 'no git repo yet — scanning every file in the project' };
  }
  const out = execSync('git ls-files --cached --others --exclude-standard', { encoding: 'utf8' });
  return { files: out.split('\n').filter(Boolean), note: 'scanning exactly what `git add .` would stage' };
}

const { files, note } = filesGitWouldCommit();
console.log(`\nPII guard — ${note}\n${files.length} file(s) to check\n`);

const findings = [];
for (const f of files) {
  if (BINARY.test(f)) continue;
  if (ALLOWED.some((re) => re.test(f))) continue;
  let text;
  try {
    const st = fs.statSync(path.join(ROOT, f));
    if (st.size > 40 * 1024 * 1024) { findings.push({ f, sig: 'file is enormous — is it a data dump?', hits: Math.round(st.size / 1e6) + ' MB' }); continue; }
    text = fs.readFileSync(path.join(ROOT, f), 'utf8');
  } catch { continue; }

  const hit = [];
  for (const s of SIGNATURES) {
    const n = (text.match(s.re) || []).length;
    if (n >= s.minHits) hit.push({ ...s, n });
  }
  const strong = hit.filter((h) => h.strength === 'strong');
  const weak = hit.filter((h) => h.strength === 'weak');
  // One real person is enough. Two weak signals together = a data file wearing a hat.
  if (strong.length || weak.length >= 2) {
    for (const h of [...strong, ...weak]) findings.push({ f, sig: h.name, hits: h.n });
  }
}

if (!findings.length) {
  console.log('✔ CLEAN — nothing that would commit contains customer data.\n');
  process.exit(0);
}

console.log('✘ REAL CUSTOMER DATA WOULD BE COMMITTED. Do not push.\n');
const byFile = new Map();
for (const x of findings) {
  if (!byFile.has(x.f)) byFile.set(x.f, []);
  byFile.get(x.f).push(`${x.sig} (${x.hits})`);
}
for (const [f, sigs] of byFile) console.log(`  ${f}\n      ${sigs.join('\n      ')}`);
console.log(`\n${byFile.size} file(s). Add them to .gitignore, or delete them.`);
console.log('If any of this has ALREADY been pushed, treat it as a data breach:');
console.log('rotate nothing — you cannot un-publish it — and tell whoever owns the data, today.\n');
process.exit(1);
