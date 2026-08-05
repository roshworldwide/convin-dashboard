/* ─────────────────────────────────────────────────────────────────────────────
 * THE DEEP PATH — one string, read everywhere.
 *
 * The whole app is served under this prefix on the public domain, e.g.
 *   https://www.roshworldwide.com/rbl-recovery-x7k29p
 * Nothing sits at the domain root — the bare root 404s, on purpose, so the report
 * is not "published" on the main site.
 *
 * To move or rename it, change THIS ONE STRING. next.config.mjs sets Next's basePath
 * from it, every internal fetch is prefixed with withBase(), and the share links
 * (/r/<token>) are built from it too. Keep the leading slash, no trailing slash.
 *
 * NOTE: with a basePath, Next automatically prefixes <Link>, the router, next/image
 * and _next assets — but NOT raw fetch() calls, window.location assignments, or URLs
 * we build by hand. Those use withBase()/BASE_PATH explicitly.
 * ───────────────────────────────────────────────────────────────────────────── */
export const BASE_PATH = '/rbl-recovery-x7k29p';

/* withBase('/api/data') → '/rbl-recovery-x7k29p/api/data' */
export const withBase = (p = '') => `${BASE_PATH}${String(p).startsWith('/') ? p : '/' + p}`;
