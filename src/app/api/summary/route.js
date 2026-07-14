import { NextResponse } from 'next/server';
import { dateSummary } from '../../../lib/backend.mjs';

export const dynamic = 'force-dynamic';

/* The Summary for ONE report date, assembled from its Days.
   Session only — never served to a share link. */
export async function GET(request) {
  const session = request.cookies.get('auth_session');
  if (!session || session.value !== 'true') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const date = new URL(request.url).searchParams.get('date') || '';
    return NextResponse.json(await dateSummary(date));
  } catch (error) {
    console.error('summary error:', error);
    return NextResponse.json({ error: 'Could not build the summary' }, { status: 500 });
  }
}
