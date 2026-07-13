import { NextResponse } from 'next/server';
import { resolveShare, sanitizeForShare } from '../../../../lib/share.mjs';
import { batchPayload } from "../../../../lib/backend.mjs";

export const dynamic = 'force-dynamic';

/* PUBLIC. No cookie, no password — the token is the credential.
 *
 * Three things this route does that matter:
 *
 *   1. It sanitises on READ, every time, rather than at creation. Sanitising once at
 *      creation means the day someone adds a PII field to the payload, every link ever
 *      issued starts leaking it, silently and retroactively. The guard has to travel
 *      with the data.
 *
 *   2. It returns an identical 404 for a bad token, an expired token and a revoked
 *      token. Distinguishing them tells an attacker which tokens exist.
 *
 *   3. It serves ONE batch — the one the link was cut for. There is no parameter here
 *      the holder can change to see a different date.
 */
export async function GET(request, { params }) {
  const { token } = await params;
  const share = await resolveShare(token);
  if (!share) {
    return NextResponse.json({ error: 'This link is not valid, or it has expired.' }, { status: 404 });
  }
  const payload = await batchPayload(share.batchId);
  if (!payload) {
    return NextResponse.json({ error: 'The report behind this link no longer exists.' }, { status: 404 });
  }
  const res = NextResponse.json({
    ok: true,
    label: share.label,
    expiresAt: share.expiresAt,
    payload: sanitizeForShare(payload),
  });
  // A shared report is a snapshot of a moment. Do not let a proxy cache it and serve
  // it to someone after the link has been revoked.
  res.headers.set('Cache-Control', 'private, no-store');
  res.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return res;
}
