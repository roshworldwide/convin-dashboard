/* ─────────────────────────────────────────────────────────────────────────────
 * SHARE LINKS — a private, revocable, expiring URL to one report.
 *
 * The alternative is emailing a PDF, and a PDF of this report is worse in every way
 * that matters:
 *
 *   · it CONTAINS RBL's customers. The Top-20 table is real names. Once it is in an
 *     inbox it is forwarded, archived, and out of your control forever. You cannot
 *     un-send it and you cannot tell who has it.
 *   · it is stale the moment a rupee is recovered.
 *   · it is 12 MB in an email.
 *
 * A link fixes all three, and it can do the one thing a PDF fundamentally cannot: it can
 * be TAKEN BACK.
 *
 * Design, and why:
 *
 *   TOKEN      32 random bytes, base64url. The token IS the credential; there is no
 *              password on a share link, because a password you email alongside the
 *              link is not a second factor, it is theatre.
 *
 *   NOT MASKED The shared report carries real customer names, by decision. It is RBL's
 *              own data going to RBL and to Convin — the two parties who already hold it.
 *              The consequence is that the URL is now genuinely sensitive: anyone holding
 *              it sees the names, and there is no login in front of them.
 *
 *   REVOCABLE  Which makes THIS the control that matters. One flag and the link dies
 *              instantly — precisely the thing a PDF can never do. Expiry is optional
 *              (0 days = never); revocation is not optional, it is the whole safety net.
 *
 *   SCOPED     To ONE REPORT DATE. The holder sees every report filed under that date
 *              — Day Total, Day 1, Day 2 — and nothing else. They cannot navigate to
 *              another date, cannot upload, cannot open the Account Explorer, cannot
 *              log in.
 *
 *              The tab list is built SERVER-SIDE from the date the link was cut for.
 *              The client sends a batch id; the server checks it against that list and
 *              404s otherwise. If the allowed set were ever taken from the request, the
 *              holder would change one query parameter and read every date in the book.
 *              That is the whole security model of this feature, in one sentence.
 *
 *   AUDITED    View count and last-viewed timestamp. When RBL asks "who saw this",
 *              you have an answer.
 *
 *   WATERMARK  Each link is labelled with its recipient, and their name is printed on
 *              the page. A screenshot that leaks is traceable to the person it was
 *              issued to. Deterrence is cheap; make it.
 * ───────────────────────────────────────────────────────────────────────────── */

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { hasDb, getPool } from './db.mjs';

const DATA = () => path.join(process.cwd(), 'src', 'data');
const FILE = () => path.join(DATA(), 'shares.json');

export const newToken = () => randomBytes(32).toString('base64url');

/**
 * The shared payload.
 *
 * NOT MASKED, by decision. This is RBL's own data going to RBL and to Convin — the two
 * parties who already hold it. Masking a bank's customer names back to the bank is
 * theatre, and it makes the Top-20 table useless to the people who need to act on it.
 *
 * What that decision buys, and what it costs, stated plainly so nobody is surprised
 * later:
 *
 *   · the link carries REAL customer names. Anyone who holds the URL sees them. There is
 *     no login. Forward it outside RBL/Convin and that is a personal-data disclosure.
 *   · so the link stays REVOCABLE, and every view is counted and timestamped, and the
 *     recipient's name is printed on the page. Those are now the only controls, which
 *     means they matter more, not less.
 *
 * The Account Explorer — mobile numbers and 19-digit account numbers — is still not part
 * of a shared report. It is an interactive tool, not a document, and it is excluded from
 * the printed PDF for the same reason. Say the word and it goes in.
 */
export function sanitizeForShare(payload) {
  const p = JSON.parse(JSON.stringify(payload));

  /* The full source list (status file, lead export, row counts) is internal — it is
     Convin's working detail, not the recipient's. But meta.cycFile stays: it names
     RBL's OWN book, and a report a bank cannot tie back to an exact file is a report
     a bank cannot check. Kept on purpose, not overlooked. */
  if (p.meta) p.meta.sources = [];

  delete p.rows;
  p.shared = true;
  return p;
}

/* ── Storage. Postgres when deployed; a JSON file locally, same as everything else. ── */

async function readLocal() {
  try { return JSON.parse(await readFile(FILE(), 'utf8')); } catch { return []; }
}
async function writeLocal(list) {
  await mkdir(DATA(), { recursive: true });
  await writeFile(FILE(), JSON.stringify(list, null, 2));
}

/**
 * @param days  0 = never expires. The link lives until you revoke it.
 *
 * A permanent link is a permanent hole in the fence, and I would rather it were not the
 * default — but a report an exec cannot open next month is a report they stop opening.
 * So it is allowed, and revocation is the control that replaces it. Use it.
 */
export async function createShare({ batchId, reportDate, label, days = 0, scope = 'date' }) {
  const sc = scope === 'batch' ? 'batch' : 'date';
  const token = newToken();
  const now = new Date();
  const n = Number(days) || 0;
  const expiresAt = n > 0 ? new Date(now.getTime() + n * 86400_000) : null;
  const row = {
    token,
    batch_id: batchId,        // the tab the link OPENS on; not the limit of what it grants
    report_date: reportDate,
    scope: sc,
    label: String(label || '').slice(0, 80),
    created_at: now.toISOString(),
    expires_at: expiresAt ? expiresAt.toISOString() : null,
    revoked: false,
    views: 0,
    last_viewed_at: null,
  };

  if (hasDb()) {
    const pool = await getPool();
    await pool.query(
      `INSERT INTO share_links (token, batch_id, report_date, label, expires_at, scope)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [token, batchId, reportDate, row.label, expiresAt, sc],
    );
  } else {
    const list = await readLocal();
    list.unshift(row);
    await writeLocal(list);
  }
  return row;
}

/**
 * Resolve a token. Returns null for anything that is not a live, unexpired,
 * unrevoked link — and returns null for ALL of those reasons identically, so the
 * response cannot be used to distinguish "wrong token" from "expired token" from
 * "revoked token". A 404 tells an attacker nothing.
 */
export async function resolveShare(token) {
  const t = String(token || '');
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(t)) return null;   // cheap shape check first

  if (hasDb()) {
    const pool = await getPool();
    const { rows } = await pool.query(
      `SELECT token, batch_id, to_char(report_date,'YYYY-MM-DD') AS report_date,
              label, expires_at, revoked, scope
       FROM share_links WHERE token = $1`, [t],
    );
    const r = rows[0];
    if (!r || r.revoked) return null;
    if (r.expires_at && new Date(r.expires_at) < new Date()) return null;   // null = never expires
    // Fire-and-forget audit. A failure to write the counter must never block a view.
    pool.query('UPDATE share_links SET views = views + 1, last_viewed_at = now() WHERE token = $1', [t])
      .catch(() => {});
    return { token: r.token, batchId: r.batch_id, reportDate: r.report_date, label: r.label, expiresAt: r.expires_at, scope: r.scope || 'batch' };
  }

  const list = await readLocal();
  const r = list.find((x) => constantTimeEq(x.token, t));
  if (!r || r.revoked) return null;
  if (r.expires_at && new Date(r.expires_at) < new Date()) return null;   // null = never expires
  r.views = (r.views || 0) + 1;
  r.last_viewed_at = new Date().toISOString();
  await writeLocal(list);
  // Links written before scope existed are 'batch' — they were issued under a narrower
  // promise and must not silently widen.
  return { token: r.token, batchId: r.batch_id, reportDate: r.report_date, label: r.label, expiresAt: r.expires_at, scope: r.scope || 'batch' };
}

export async function listShares() {
  if (hasDb()) {
    const pool = await getPool();
    const { rows } = await pool.query(
      `SELECT token, batch_id, to_char(report_date,'YYYY-MM-DD') AS report_date, label,
              created_at, expires_at, revoked, views, last_viewed_at, scope
       FROM share_links ORDER BY created_at DESC LIMIT 100`,
    );
    return rows.map((r) => ({ ...r, batchId: r.batch_id, reportDate: r.report_date, scope: r.scope || 'batch' }));
  }
  return readLocal();
}

export async function revokeShare(token) {
  if (hasDb()) {
    const pool = await getPool();
    await pool.query('UPDATE share_links SET revoked = true WHERE token = $1', [String(token)]);
    return true;
  }
  const list = await readLocal();
  const r = list.find((x) => x.token === token);
  if (r) { r.revoked = true; await writeLocal(list); }
  return !!r;
}

/* String compare that does not leak the token through timing. Overkill for a 32-byte
   random value, and free. */
function constantTimeEq(a, b) {
  const x = Buffer.from(String(a), 'utf8');
  const y = Buffer.from(String(b), 'utf8');
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}
