/* Where does this app actually live, as far as the outside world is concerned?
 *
 * The browser cannot answer this. If you are working at http://localhost:3000 behind a
 * tunnel, `window.location.origin` is `http://localhost:3000` — and a link built from it
 * is dead on arrival in someone else's inbox. That is a mistake you make once, an hour
 * before you find out.
 *
 * So the SERVER decides, in this order:
 *
 *   1. PUBLIC_BASE_URL   — you set it explicitly. Always wins.
 *   2. .tunnel-url       — written by `npm run dev` when Cloudflare hands back a URL.
 *   3. the request origin — deployed (Vercel etc), where the origin IS public.
 *
 * Returns { url, source }. `source` matters: if we fell through to a localhost origin,
 * the UI must SAY the link is local-only rather than hand you a URL that quietly fails.
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const TUNNEL_FILE = () => path.join(process.cwd(), '.tunnel-url');
const strip = (u) => String(u || '').trim().replace(/\/+$/, '');

export function publicBaseUrl(request) {
  const explicit = strip(process.env.PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_BASE_URL);
  if (explicit) return { url: explicit, source: 'env' };

  try {
    if (existsSync(TUNNEL_FILE())) {
      const u = strip(readFileSync(TUNNEL_FILE(), 'utf8'));
      if (/^https?:\/\//.test(u)) return { url: u, source: 'tunnel' };
    }
  } catch { /* no tunnel — fall through */ }

  let origin = '';
  try { origin = strip(new URL(request.url).origin); } catch { /* ignore */ }
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?$/i.test(origin);
  return { url: origin, source: isLocal ? 'local' : 'origin' };
}
