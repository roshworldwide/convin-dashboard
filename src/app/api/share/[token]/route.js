import { NextResponse } from 'next/server';
import { resolveShare, sanitizeForShare } from '../../../../lib/share.mjs';
import { batchPayload, manifest } from '../../../../lib/backend.mjs';

export const dynamic = 'force-dynamic';

/* PUBLIC. No cookie, no password — the token is the credential.
 *
 * Four things this route does that matter:
 *
 *   1. It sanitises on READ, every time, rather than at creation. Sanitising once at
 *      creation means the day someone adds a PII field to the payload, every link ever
 *      issued starts leaking it, silently and retroactively. The guard has to travel
 *      with the data.
 *
 *   2. It returns an identical 404 for a bad token, an expired token, a revoked token,
 *      AND a batch id outside the link's scope. Distinguishing them tells an attacker
 *      which tokens and which reports exist.
 *
 *   3. THE ALLOWED TAB LIST IS BUILT SERVER-SIDE, from the report_date stored ON THE
 *      LINK. The client tells us which tab it WANTS; it does not tell us which tabs it
 *      MAY HAVE. Those are different sentences, and the difference is the entire feature:
 *      if `allowed` were ever derived from the request, the holder of any link would
 *      change one query parameter and read every date in the book.
 *
 *   4. A link cut before date-scoping existed stays 'batch' — one report, exactly as
 *      promised when it was issued. Widening an already-issued link in a migration, with
 *      no way for the issuer to know, would hand a recipient access they never granted.
 */
export async function GET(request, { params }) {
  const { token } = await params;
  const share = await resolveShare(token);

  /* ONE reply for every kind of "no" — bad token, expired, revoked, out of scope. The
     response must never let someone probe for what exists. */
  const deny = () => NextResponse.json(
    { error: 'This link is not valid, or it has expired.' }, { status: 404 },
  );

  if (!share) return deny();

  const wanted = new URL(request.url).searchParams.get('batch');
  let batchId = share.batchId;
  let tabs = [];
  let display = '';

  if (share.scope === 'date') {
    const man = await manifest();
    const day = (man.dates || []).find((d) => d.date === share.reportDate);
    if (!day) return deny();

    display = day.display;

    /* Day Total first, then Day 1, Day 2… The same tabs the internal dashboard shows for
       this date, minus the date navigator — which is precisely what keeps the link
       scoped to one date. */
    tabs = [
      { id: day.dayTotal, label: 'Day Total', meta: `${Number(day.rowCount || 0).toLocaleString('en-IN')} accounts` },
      ...(day.uploads || []).map((u) => ({
        id: u.id,
        label: String(u.label || '').replace(/^Upload\b/i, 'Day') || 'Day',
        meta: u.time || '',
      })),
    ];

    const allowed = new Set(tabs.map((t) => t.id));

    /* THE CHECK. `allowed` came from the link's own report_date. `wanted` came from the
       recipient. A batch id we did not offer is treated exactly like a bad token. */
    if (wanted) {
      if (!allowed.has(wanted)) return deny();
      batchId = wanted;
    } else if (!allowed.has(batchId)) {
      batchId = day.dayTotal;      // the link's stored batch is gone; open on the total
    }
  } else if (wanted && wanted !== share.batchId) {
    // A legacy batch-scoped link grants ONE report. It cannot be talked into another.
    return deny();
  }

  const payload = await batchPayload(batchId);
  if (!payload) {
    return NextResponse.json({ error: 'The report behind this link no longer exists.' }, { status: 404 });
  }

  const res = NextResponse.json({
    ok: true,
    label: share.label,
    expiresAt: share.expiresAt,
    scope: share.scope,
    date: share.reportDate,
    display,
    tabs,                // [] on a legacy batch link — the UI then renders no tab bar
    batchId,
    payload: sanitizeForShare(payload),
  });
  // A shared report is a snapshot of a moment. Do not let a proxy cache it and serve it
  // to someone after the link has been revoked.
  res.headers.set('Cache-Control', 'private, no-store');
  res.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return res;
}
