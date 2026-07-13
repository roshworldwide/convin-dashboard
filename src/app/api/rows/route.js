import { NextResponse } from 'next/server';
import { rows } from '../../../lib/backend.mjs';

export const dynamic = 'force-dynamic';

const ID_RE = /^\d{4}-\d{2}-\d{2}__(daytotal|u\d+)$/;

export async function GET(request) {
  const session = request.cookies.get('auth_session');
  if (!session || session.value !== 'true') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const sp = new URL(request.url).searchParams;
  const id = sp.get('id') || '';
  if (!ID_RE.test(id)) return NextResponse.json({ error: 'Bad batch id' }, { status: 400 });
  try {
    const out = await rows({
      id,
      page: sp.get('page') || 0,
      size: sp.get('size') || 15,
      q: sp.get('q') || '',
      status: sp.get('status') || 'All',
      region: sp.get('region') || 'All',
      band: sp.get('band') || 'All',
      disp: sp.get('disp') || 'All',
      sort: sp.get('sort') || 'Outstanding',
      dir: sp.get('dir') || 'desc',
    });
    return NextResponse.json(out);
  } catch (error) {
    console.error('rows error:', error);
    return NextResponse.json({ error: 'Rows error' }, { status: 500 });
  }
}
