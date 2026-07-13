import { NextResponse } from 'next/server';
import { createShare, listShares, revokeShare } from '../../../lib/share.mjs';
import { publicBaseUrl } from '../../../lib/publicurl.mjs';

export const dynamic = 'force-dynamic';

const authed = (req) => req.cookies.get('auth_session')?.value === 'true';

// Create a link. Requires a logged-in session — issuing a share is a privileged act.
export async function POST(request) {
  if (!authed(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { batchId, reportDate, label, days } = await request.json();
    if (!batchId || !reportDate) {
      return NextResponse.json({ error: 'batchId and reportDate are required' }, { status: 400 });
    }
    // 0 = never expires (revoke is then the only control). Anything else is capped at a
    // year — a "10,000 day" link typed into a form is a mistake, not an intention.
    const d = Math.min(365, Math.max(0, Number(days) || 0));
    const row = await createShare({ batchId, reportDate, label, days: d });

    /* Build the absolute URL HERE, on the server. The browser cannot: behind a tunnel its
       origin is localhost, and a localhost link in an exec's inbox is a link to nothing.
       `source` travels with it so the UI can be honest when the link is local-only. */
    const base = publicBaseUrl(request);
    return NextResponse.json({
      ok: true,
      token: row.token,
      url: `${base.url}/r/${row.token}`,
      source: base.source,            // 'env' | 'tunnel' | 'origin' | 'local'
      expiresAt: row.expires_at,
      label: row.label,
    });
  } catch (e) {
    console.error('share create', e);
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}

export async function GET(request) {
  if (!authed(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ shares: await listShares() });
}

export async function DELETE(request) {
  if (!authed(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const token = new URL(request.url).searchParams.get('token');
  if (!token) return NextResponse.json({ error: 'token required' }, { status: 400 });
  await revokeShare(token);
  return NextResponse.json({ ok: true, revoked: token });
}
