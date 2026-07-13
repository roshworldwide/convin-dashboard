// Apply the Postgres schema. Usage: DATABASE_URL=... node migrate.mjs
import { readFileSync } from 'node:fs';
import path from 'node:path';

if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is not set.'); process.exit(1); }
const { default: pg } = await import('pg');
const sql = readFileSync(path.join(process.cwd(), 'db', 'postgres', 'schema.sql'), 'utf8');
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false },
});
await pool.query(sql);
console.log('✔ Schema applied.');
await pool.end();
