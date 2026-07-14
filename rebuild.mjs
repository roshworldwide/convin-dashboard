/* Rebuild every stored report from its saved rows, using the CURRENT aggregator.
 *
 * A payload is computed once, at upload time, and cached — that is what makes the
 * dashboard instant, and it is why a change to the aggregator does not reach a report
 * that is already filed. This replays the stored rows through the new code. The rows
 * themselves are never touched: nothing is re-uploaded and nothing is re-joined.
 *
 * It dispatches on the same switch as the rest of the app — DATABASE_URL present means
 * Postgres, absent means JSON files — and SAYS WHICH IT PICKED. Rebuilding your laptop
 * and then wondering why production still shows the old wording is a genuinely easy
 * mistake to make, and a silent tool would let you make it.
 *
 *   npm run rebuild
 *
 * Against Postgres, use the DIRECT connection string (:5432), not the pooler.
 */
import { readFileSync } from 'node:fs';

/* Read .env.local ourselves. Next loads it for the app, but not for a plain node
   script — and adding a dependency, or a --env-file flag that only exists on newer
   Node, to read one variable would be worse than eight lines. */
for (const file of ['.env.local', '.env']) {
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { continue; }
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    const key = m[1];
    if (process.env[key] !== undefined) continue;       // a real env var always wins
    process.env[key] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

const { hasDb } = await import('./src/lib/db.mjs');

if (hasDb()) {
  const host = (process.env.DATABASE_URL.match(/@([^/:]+)/) || [])[1] || 'postgres';
  console.log(`DATABASE_URL is set → rebuilding POSTGRES (${host}).\n`);
  await import('./scripts/rebuild_db.mjs');
} else {
  console.log('No DATABASE_URL → rebuilding the local JSON files.');
  console.log('(If you meant to rebuild the deployed database, put the DIRECT connection');
  console.log(' string in .env.local first — otherwise production keeps the old payload.)\n');
  await import('./rebuild_local.mjs');
}
