import { NextResponse } from 'next/server';
import { hasDb } from '../../../lib/db.mjs';
import { readSheet, detectSheetKind } from '../../../lib/sheet.mjs';
import { buildCanonicalRows } from '../../../lib/merge.mjs';
import { ingestUpload } from '../../../lib/ingest.mjs';
import { ingestLocalUpload } from '../../../lib/ingest_local.mjs';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // seconds (Vercel). Use the CLI for very large files.

/* The real upload is THREE files, and the CYC file is the spine.
 *
 *   cyc     (.xlsx)  PRIMARY. RBL's portfolio / PDD file — the book the bank HANDED US
 *                    to work. It decides which accounts exist in this report. Carries the
 *                    money, the balance band, the region, months on book, the agency.
 *
 *   status  (.xlsx)  LOOKUP. RBL's outcome file — account_no -> Resolved / Unresolved.
 *   leads   (.csv)   LOOKUP. Convin's campaign export — who we called, how long we talked,
 *                    what they said.
 *
 * Why CYC is primary and not the lead file: the lead export only contains the accounts we
 * managed to create leads for. If we made it the spine, every account the AI never reached
 * would silently vanish from the book — and our connect rate and recovery rate would both
 * be flattered by the accounts we quietly dropped. Anchoring on the bank's own portfolio
 * means the denominator is THEIR number, not ours.
 *
 * And the outcome comes from the bank's file, never from ours. We do not label our own
 * results and we cannot mark our own homework.
 *
 * Legacy single-sheet uploads (an already-merged export) still work: send it as `file`
 * or `leads` with no other sheets, exactly as before.
 */
async function readPart(part) {
  if (!part || typeof part === 'string') return null;
  const buf = Buffer.from(await part.arrayBuffer());
  const rows = readSheet(buf, part.name || '');
  return { name: part.name || 'sheet', rows, kind: detectSheetKind(rows[0]) };
}

/* Vercel caps a serverless request body at 4.5 MB. It is a platform limit — not a
   setting, not a plan tier. The real three-file upload is 12.5 MB, so on Vercel this
   route CANNOT receive it: the platform rejects the request before any of this code
   runs, and the browser shows a bare "413" or, worse, a generic network error.

   A user staring at that has no way to know the difference between "the file is too
   big for this platform" and "the app is broken" — and if they are standing in front of
   a client, they will assume the second. So we detect the situation up front and say
   exactly what is happening and exactly what to do instead. */
const VERCEL_BODY_LIMIT = 4.5 * 1024 * 1024;

export async function POST(request) {
  const session = request.cookies.get('auth_session');
  if (!session || session.value !== 'true') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const onVercel = !!process.env.VERCEL;
  const declared = Number(request.headers.get('content-length') || 0);
  if (onVercel && declared > VERCEL_BODY_LIMIT) {
    return NextResponse.json({
      error:
        `These files total ${(declared / 1048576).toFixed(1)} MB. The hosting platform refuses any upload over 4.5 MB — `
        + `that is a hard limit of serverless functions, not a setting we can raise.\n\n`
        + `Push them from your machine instead. It is one command, it is faster, and it writes to the same database:\n\n`
        + `    npm run push -- "CYC.xlsx" "Status.xlsx" "LeadOutcome.csv" --date ${new Date().toISOString().slice(0, 10)}\n\n`
        + `The dashboard will show it immediately — no redeploy needed.`,
      tooLarge: true,
    }, { status: 413 });
  }

  try {
    const form = await request.formData();

    const cycPart = form.get('cyc');
    const statusPart = form.get('status');
    const leadsPart = form.get('leads') || form.get('file');
    const legacyExtras = form.getAll('extra').filter((f) => f && typeof f !== 'string');

    // CYC is the spine. Fall back to the lead sheet only for a legacy merged upload.
    const primaryPart = (cycPart && typeof cycPart !== 'string') ? cycPart : leadsPart;
    if (!primaryPart || typeof primaryPart === 'string') {
      return NextResponse.json(
        { error: 'Add the CYC / PDD file — it is the book RBL gave us to work, and it decides which accounts are in this report.' },
        { status: 400 },
      );
    }
    const usingCycSpine = primaryPart === cycPart;

    const primary = await readPart(primaryPart);
    const extras = [];
    const extraNames = [];
    const sheetInfo = [{
      slot: usingCycSpine ? 'CYC / PDD (primary)' : 'Merged sheet',
      name: primary.name, rows: Math.max(0, primary.rows.length - 1), detected: primary.kind,
    }];

    const lookups = usingCycSpine
      ? [['Status', statusPart], ['Lead outcome', leadsPart]]
      : [['Status', statusPart]];
    for (const [slotName, part] of lookups) {
      const s = await readPart(part);
      if (!s) continue;
      extras.push(s.rows);
      extraNames.push(s.name);
      sheetInfo.push({ slot: slotName, name: s.name, rows: Math.max(0, s.rows.length - 1), detected: s.kind });
    }
    for (const f of legacyExtras) {
      const s = await readPart(f);
      if (!s) continue;
      extras.push(s.rows);
      extraNames.push(s.name);
      sheetInfo.push({ slot: 'Additional', name: s.name, rows: Math.max(0, s.rows.length - 1), detected: s.kind });
    }

    const reportDate = (form.get('report_date') || '').toString() || new Date().toISOString().slice(0, 10);
    const slot = Math.max(1, parseInt((form.get('slot') || '1').toString(), 10) || 1);
    const uploadTime = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

    // Optional explicit column mapping from the UI (overrides the auto-detected aliases).
    let mapping = null;
    const rawMap = form.get('mapping');
    if (rawMap) { try { mapping = JSON.parse(rawMap.toString()); } catch { mapping = null; } }

    // The built-in VLOOKUP: join every sheet on Account No, fill the gaps.
    // extraNames is passed so a sheet that joins to nothing is named in the error —
    // "Lead Outcome ... did not match a single account" is actionable; "additional
    // sheet 2" is not.
    const { rows, stats, warnings } = buildCanonicalRows(primary.rows, extras, mapping, extraNames);

    // sheetInfo already knows every file the user dropped in. It used to be returned to
    // the browser and then forgotten. Persist it — it is the report's provenance.
    const opts = { reportDate, slot, filename: primary.name, uploadTime, sources: sheetInfo };
    const res = hasDb() ? await ingestUpload(rows, opts) : await ingestLocalUpload(rows, opts);

    return NextResponse.json({ ok: true, reportDate, ...res, stats, warnings, sheets: sheetInfo });
  } catch (e) {
    console.error('ingest error', e);
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
