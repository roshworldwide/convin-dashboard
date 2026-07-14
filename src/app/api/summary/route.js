import { NextResponse } from 'next/server';
import { campaignSummary } from '../../../lib/backend.mjs';

export const dynamic = 'force-dynamic';

/* The campaign summary spans EVERY report date, so it is never served to a share link.
   A shared report is scoped to one batch on purpose: the holder cannot navigate to
   another date, and they must not be handed a roll-up of every date either. Session
   only — same rule as the Account Explorer. */
export async function GET(request) {
  const session = request.cookies.get('auth_session');
  if (!session || session.value !== 'true') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    return NextResponse.json(await campaignSummary());
  } catch (error) {
    console.error('summary error:', error);
    return NextResponse.json({ error: 'Could not build the summary' }, { status: 500 });
  }
}
