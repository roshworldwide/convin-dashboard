import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';

const COOKIE = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/' };
const WEEK = 60 * 60 * 24 * 7;

// Turn "rosh.p" / "rosh_patel" / "rosh patel" into "Rosh Patel" for the greeting.
function pretty(name) {
  return String(name || '')
    .replace(/[._-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
    .slice(0, 40);
}

/* Constant-time compare. A plain `!==` on a secret leaks its length and, over enough
   requests, its contents through timing. This is a bank's data behind one password. */
function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? ''), 'utf8');
  const y = Buffer.from(String(b ?? ''), 'utf8');
  if (x.length !== y.length) {
    // Still burn the comparison so the failure path costs the same as the success path.
    timingSafeEqual(x, x);
    return false;
  }
  return timingSafeEqual(x, y);
}

export async function POST(request) {
  try {
    const { username, password } = await request.json();

    /* THE PASSWORD MUST NOT HAVE A FALLBACK IN PRODUCTION.
       It used to read `process.env.DASHBOARD_PASSWORD || 'rblrecovery2026'`. That is fine
       on a laptop and catastrophic on the public internet: the moment this repo is on
       GitHub, the fallback IS the password, in plain text, for anyone who reads the file —
       and behind it sit 7,042 RBL cardholders' names, mobile numbers and balances.

       So in production there is no default. If DASHBOARD_PASSWORD is not set, the app
       refuses every login rather than quietly falling back to a public string. Failing
       closed on a missing secret is the only safe direction to fail. */
    const configured = process.env.DASHBOARD_PASSWORD;
    const isProd = process.env.NODE_ENV === 'production';

    if (isProd && !configured) {
      console.error('DASHBOARD_PASSWORD is not set — refusing all logins.');
      return NextResponse.json(
        { success: false, error: 'This deployment is not configured. DASHBOARD_PASSWORD is missing.' },
        { status: 503 },
      );
    }
    const targetPassword = configured || 'rblrecovery2026';   // local dev only
    const allowedUser = process.env.DASHBOARD_USER; // optional: lock to one username

    if (!username || !String(username).trim()) {
      return NextResponse.json({ success: false, error: 'Enter your username' }, { status: 400 });
    }
    if (allowedUser && String(username).trim().toLowerCase() !== allowedUser.toLowerCase()) {
      return NextResponse.json({ success: false, error: 'Incorrect username or password' }, { status: 401 });
    }
    if (!safeEqual(password, targetPassword)) {
      return NextResponse.json({ success: false, error: 'Incorrect username or password' }, { status: 401 });
    }

    const name = pretty(username);
    const res = NextResponse.json({ success: true, name });
    res.cookies.set('auth_session', 'true', { ...COOKIE, maxAge: WEEK });
    res.cookies.set('auth_user', encodeURIComponent(name), { ...COOKIE, maxAge: WEEK });
    return res;
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
  }
}

// Logout
export async function GET() {
  const res = NextResponse.json({ success: true });
  res.cookies.set('auth_session', '', { ...COOKIE, maxAge: -1 });
  res.cookies.set('auth_user', '', { ...COOKIE, maxAge: -1 });
  return res;
}
