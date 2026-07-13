import { NextResponse } from 'next/server';
import { hasDb, deleteDate } from '../../../lib/db.mjs';
import { deleteLocalDate } from '../../../lib/ingest_local.mjs';

export const dynamic = 'force-dynamic';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Delete a whole report day (every upload for that date + its day total).
export async function DELETE(request) {
  const session = request.cookies.get('auth_session');
  if (!session || session.value !== 'true') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const date = new URL(request.url).searchParams.get('date') || '';
  if (!DATE_RE.test(date)) return NextResponse.json({ error: 'Bad date' }, { status: 400 });
  try {
    const res = hasDb() ? await deleteDate(date) : await deleteLocalDate(date);
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    console.error('delete report error', e);
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
