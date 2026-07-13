import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Who's signed in — used for the "Hi, {name}" greeting.
export async function GET(request) {
  const session = request.cookies.get('auth_session');
  if (!session || session.value !== 'true') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const raw = request.cookies.get('auth_user');
  let name = '';
  try { name = raw ? decodeURIComponent(raw.value) : ''; } catch { name = ''; }
  return NextResponse.json({ name: name || 'there' });
}
