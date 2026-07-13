// Clear every report day, so you can upload the real three files as a clean Day 1.
//
//   npm run wipe
//
// Why this exists: Day Total SUMS every upload for a date. Three uploads of the same
// book under one day is a recovery figure three times too large, on screen, in front
// of the client. Walk in with one day and one upload.

import fs from 'node:fs';
import path from 'node:path';

const DATA = path.join(process.cwd(), 'src', 'data');
const BATCHES = path.join(DATA, 'batches');

let n = 0;
if (fs.existsSync(BATCHES)) {
  for (const f of fs.readdirSync(BATCHES)) { fs.unlinkSync(path.join(BATCHES, f)); n++; }
}
fs.mkdirSync(BATCHES, { recursive: true });
fs.writeFileSync(path.join(DATA, 'manifest.json'), JSON.stringify({ dates: [], latest: null }));

console.log(`\n  wiped ${n} file(s) — no report days loaded.\n`);
console.log('  Now start the app and upload the three real files as Upload 1:\n');
console.log('    npm run dev\n');
console.log('      CYC 12 PDD1 3rd July File.xlsx              → CYC report (the spine)');
console.log('      Status File 04 July-39_26.xlsx              → Status report (the outcome)');
console.log('      Collections-_July_leads_...csv              → Lead Outcome report\n');
console.log('  Expect: 7,042 accounts · ₹13.12 Cr · 24.9% · AUC 0.753');
console.log('  Expect ONE amber warning — the Excel-corrupted account numbers in the lead');
console.log('  export, recovered from External ID. That warning is a feature. Show it to them.\n');
