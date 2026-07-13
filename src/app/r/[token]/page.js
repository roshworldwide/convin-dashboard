'use client';

/* ─────────────────────────────────────────────────────────────────────────────
 * /r/<token> — the private share link.
 *
 * No session. No password. No navigation. The token is the credential, and it opens
 * exactly ONE report, read-only, with every customer name masked and the Account
 * Explorer absent entirely.
 *
 * It renders the SAME component as the internal dashboard, deliberately. Building a
 * separate "export view" is how you end up sending an exec a report that quietly
 * disagrees with the one you walked them through — different rounding, a stale chart,
 * a section someone forgot to port. One body, two doors.
 * ───────────────────────────────────────────────────────────────────────────── */
import { use } from 'react';
import Report from '../../dashboard/Report';

export default function SharedReport({ params }) {
  const { token } = use(params);
  return <Report shareToken={token} />;
}
