import { NextResponse } from 'next/server';
import { batchPayload } from '../../../lib/backend.mjs';

export const dynamic = 'force-dynamic';

const ID_RE = /^\d{4}-\d{2}-\d{2}__(daytotal|u\d+)$/;

export async function GET(request) {
  const session = request.cookies.get('auth_session');
  if (!session || session.value !== 'true') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id') || '';
  if (!ID_RE.test(id)) return NextResponse.json({ error: 'Bad batch id' }, { status: 400 });
  try {
    const payload = await batchPayload(id);
    if (!payload) return NextResponse.json({ error: 'Batch not found' }, { status: 404 });
    return NextResponse.json(payload);
  } catch (error) {
    console.error('batch error:', id, error);
    return NextResponse.json({ error: 'Batch error' }, { status: 500 });
  }
}
