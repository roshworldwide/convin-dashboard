import { NextResponse } from 'next/server';
import { manifest } from '../../../lib/backend.mjs';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const session = request.cookies.get('auth_session');
  if (!session || session.value !== 'true') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    return NextResponse.json(await manifest());
  } catch (error) {
    console.error('manifest error:', error);
    return NextResponse.json({ error: 'Server data error' }, { status: 500 });
  }
}
