/* ─────────────────────────────────────────────────────────────────────────────
 * npm run dev — the app AND its public tunnel, in one terminal.
 *
 * Two processes used to mean two terminals, and two terminals means one of them is
 * eventually not running when you click Share. Then the link you paste into an email
 * says `localhost:3000`, and the exec on the other end sees nothing at all — which you
 * find out about roughly an hour after you sent it.
 *
 * So this starts both, waits for Cloudflare to hand back a public HTTPS URL, and writes
 * that URL to `.tunnel-url` where the server can read it. The Share button then builds
 * every link from the PUBLIC origin, no matter which door you happened to open the app
 * through — localhost or the tunnel. One terminal, one button, a link that works.
 *
 * If cloudflared isn't installed, this degrades honestly: the app still runs, and the
 * Share dialog tells you the link is local-only and how to fix it. It does not pretend.
 * ───────────────────────────────────────────────────────────────────────────── */
import { spawn } from 'node:child_process';
import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import path from 'node:path';

const URL_FILE = path.join(process.cwd(), '.tunnel-url');
const PORT = process.env.PORT || '3000';

// Never inherit a stale URL from a previous run — a dead tunnel's address is worse than
// no address, because it looks like it should work.
if (existsSync(URL_FILE)) unlinkSync(URL_FILE);

const bar = (c = '─') => console.log(c.repeat(76));
const children = [];

/* ── 1. Next ──────────────────────────────────────────────────────────────── */
const next = spawn('npx', ['next', 'dev', '--port', PORT], { stdio: 'inherit', shell: false });
children.push(next);
next.on('exit', (code) => { shutdown(); process.exit(code ?? 0); });

/* ── 2. Cloudflare tunnel ─────────────────────────────────────────────────── */
let announced = false;

const cf = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${PORT}`], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
children.push(cf);

cf.on('error', (e) => {
  if (e.code !== 'ENOENT') return;
  setTimeout(() => {
    console.log('');
    bar('═');
    console.log('  NO PUBLIC LINK — cloudflared is not installed');
    bar();
    console.log('  The app is running, and Share links will work on THIS machine only.');
    console.log('  To share with someone else, install it once (free, no account):');
    console.log('');
    console.log('      brew install cloudflared');
    console.log('');
    console.log('  Then restart: npm run dev');
    bar('═');
    console.log('');
  }, 2500);
});

const watch = (buf) => {
  const m = buf.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (!m || announced) return;
  announced = true;
  const url = m[0];
  writeFileSync(URL_FILE, url);

  // Let Next finish its own boot noise before we shout.
  setTimeout(() => {
    console.log('');
    bar('═');
    console.log('  PUBLIC LINK IS LIVE');
    bar();
    console.log(`  ${url}`);
    console.log('');
    console.log('  Work at http://localhost:' + PORT + ' as usual — the Share button now hands');
    console.log('  you links on the public address automatically. Copy, send, done.');
    console.log('');
    console.log('  Everything dies when you Ctrl-C. That is the point.');
    bar('═');
    console.log('');
  }, 1200);
};
cf.stdout.on('data', watch);
cf.stderr.on('data', watch);   // cloudflared prints the URL to stderr

/* ── Clean up. A tunnel left running after the app is gone is a URL pointing at
      nothing, and — worse — a port on your laptop still open to the internet. ── */
function shutdown() {
  try { if (existsSync(URL_FILE)) unlinkSync(URL_FILE); } catch {}
  for (const c of children) { try { c.kill(); } catch {} }
}
process.on('SIGINT', () => { shutdown(); process.exit(0); });
process.on('SIGTERM', () => { shutdown(); process.exit(0); });
process.on('exit', shutdown);
