'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { parseCsvLine } from '../../lib/csv.mjs';
import { autoMap, FIELD_GROUPS, FIELD_LABELS } from '../../lib/normalize.mjs';
import { uploadFiles } from '../../lib/upload_client.mjs';
import { C, T, NUM, Card, Overline, Capsule, Track, SignalDot, Hairline, fmtInt } from '../aurum';

/* ═══════════════════════════════════════════════════════════════════════════════
 * UPLOAD.
 *
 * The one screen where the user hands over a bank's book, so it says out loud what
 * happens to it: the files are parsed and joined in this browser and only the result
 * is sent. Nothing on this page is decorative.
 * ═══════════════════════════════════════════════════════════════════════════════ */

const today = () => new Date().toISOString().slice(0, 10);
const REQUIRED = ['account_no', 'status', 'total_outstanding'];
const isExcel = (f) => /\.xlsx?$/i.test(f?.name || '');

/** Read just the header row. CSV: slice the first 256 KB — never load the whole file
 *  (the AI call log is 9 MB). Excel: SheetJS needs the workbook, but the status file
 *  is 591k rows, so we only ever pull row 1 back out of it. */
async function readHeaders(file) {
  if (isExcel(file)) {
    const XLSX = await import('xlsx');
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', raw: false, sheetRows: 1 });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) return [];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
    return (rows[0] || []).map((h) => String(h ?? '').trim()).filter(Boolean);
  }
  const chunk = await file.slice(0, 262144).text();
  const first = chunk.split(/\r\n|\n|\r/)[0].replace(/^﻿/, '');
  return parseCsvLine(first).map((h) => String(h).trim()).filter(Boolean);
}

/** A drop target. A squircle, because it holds content rather than being touched as
 *  a control — and a dashed rim, because an empty container has to read as a place
 *  something goes rather than as a card that failed to load. */
function Drop({ index, title, hint, files, onPick }) {
  const [drag, setDrag] = useState(false);
  const filled = files.length > 0;
  return (
    <label
      className="u-squircle"
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); onPick(Array.from(e.dataTransfer.files)); }}
      style={{
        display: 'block', padding: '18px 20px', cursor: 'pointer',
        border: `1px ${filled ? 'solid' : 'dashed'} ${drag ? C.accent : filled ? C.rim : C.hairline}`,
        background: drag ? C.gold(0.06) : filled ? C.quiet : 'transparent',
        transition: 'background-color var(--dur-medium) var(--ease-glide), border-color var(--dur-medium) var(--ease-glide)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div className="u-squircle-sm" style={{
          width: 36, height: 36, flex: 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          ...T.footnote, ...NUM, fontWeight: 600,
          background: filled ? C.accentFill : C.quiet,
          color: filled ? C.onAccent : C.secondary,
        }}>
          {filled ? '✓' : index}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ ...T.subhead, fontWeight: 600, color: C.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
          <div style={{ ...T.caption, color: C.tertiary, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {filled ? files.map((f) => f.name).join(', ') : hint}
          </div>
        </div>
      </div>
      <input type="file" accept=".csv,.xlsx,.xls,text/csv" onChange={(e) => onPick(Array.from(e.target.files))} style={{ display: 'none' }} />
    </label>
  );
}

export default function Upload() {
  const [authed, setAuthed] = useState(null);
  const [name, setName] = useState('');
  const [mode, setMode] = useState('split');
  const [statusFiles, setStatusFiles] = useState([]);
  const [cycFiles, setCycFiles] = useState([]);
  const [outcomeFiles, setOutcomeFiles] = useState([]);
  const [extraFiles, setExtraFiles] = useState([]);
  const [headers, setHeaders] = useState([]);
  const [mapping, setMapping] = useState({});
  const [showAll, setShowAll] = useState(false);
  const [reportDate, setReportDate] = useState(today());
  const [slot, setSlot] = useState(1);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/me');
        if (r.status === 200) { const j = await r.json(); setName(j.name); setAuthed(true); } else setAuthed(false);
      } catch { setAuthed(false); }
    })();
  }, []);

  const refreshHeaders = useCallback(async (sFiles, eFiles) => {
    const all = [...sFiles, ...eFiles];
    if (!all.length) { setHeaders([]); setMapping({}); return; }
    const lists = await Promise.all(all.map(readHeaders));
    const union = Array.from(new Set(lists.flat()));
    setHeaders(union);
    setMapping(autoMap(union));
  }, []);

  const others = useCallback((m = mode) => (m === 'merged' ? [] : [...cycFiles, ...outcomeFiles, ...extraFiles]),
    [mode, cycFiles, outcomeFiles, extraFiles]);

  const pickStatus = (fs) => {
    if (!fs.length) return;
    const next = [fs[0]];
    setStatusFiles(next); setResult(null); setError('');
    const m = fs[0].name.match(/(\d{4}-\d{2}-\d{2})/);
    if (m) setReportDate(m[1]);
    refreshHeaders(next, others());
  };
  const pickCyc = (fs) => {
    const next = fs.slice(0, 1);
    setCycFiles(next); setResult(null); setError('');
    refreshHeaders(statusFiles, [...next, ...outcomeFiles, ...extraFiles]);
  };
  const pickOutcome = (fs) => {
    const next = fs.slice(0, 1);
    setOutcomeFiles(next); setResult(null); setError('');
    refreshHeaders(statusFiles, [...cycFiles, ...next, ...extraFiles]);
  };
  const switchMode = (m) => {
    setMode(m); setResult(null); setError('');
    if (m === 'merged') { setCycFiles([]); setOutcomeFiles([]); setExtraFiles([]); refreshHeaders(statusFiles, []); }
    else refreshHeaders(statusFiles, others(m));
  };

  const missingRequired = REQUIRED.filter((k) => !mapping[k]);
  const mappedCount = Object.values(mapping).filter(Boolean).length;

  const submit = async (e) => {
    e.preventDefault(); setError(''); setResult(null);
    if (mode === 'split' && !cycFiles.length) { setError('Add the CYC / PDD file. It is the book RBL gave us, and it decides which accounts are in this report.'); return; }
    if (mode === 'merged' && !statusFiles.length) { setError('Choose a sheet first.'); return; }
    if (mode === 'merged' && missingRequired.length) {
      setError(`Map the required columns: ${missingRequired.map((k) => FIELD_LABELS[k]).join(', ')}.`);
      return;
    }
    setBusy(true);
    setProgress({ pct: 0, note: 'Starting' });
    try {
      /* THE FILES NEVER LEAVE THIS BROWSER. They are parsed and joined here, and only
         the RESULT is sent — gzipped, in chunks. 21 MB of workbooks become ~0.13 MB on
         the wire, which is what makes this work on Vercel at all: the platform refuses
         any request body over 4.5 MB, full stop. */
      const files = mode === 'split'
        ? [cycFiles[0], outcomeFiles[0], statusFiles[0], ...extraFiles]
        : [statusFiles[0]];

      const j = await uploadFiles(
        files.filter(Boolean),
        { reportDate, slot, mapping: mode === 'merged' ? mapping : null },
        (p) => setProgress({ pct: p.pct, note: p.note }),
      );
      setResult(j);
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const shell = (c) => (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px 24px', position: 'relative', zIndex: 1 }}>{c}</div>
  );
  if (authed === null) return shell(<div style={{ ...T.callout, color: C.tertiary }}>Loading</div>);
  if (!authed) return shell(
    <Card className="u-squircle-xl" style={{ padding: 36, textAlign: 'center', maxWidth: 400 }} elevation={3}>
      <div style={{ ...T.title3, color: C.primary, marginBottom: 8 }}>Sign in first</div>
      <div style={{ ...T.subhead, color: C.tertiary, marginBottom: 24 }}>This page needs a session.</div>
      <Capsule as={Link} href="/" variant="metal" size="m">Go to sign in</Capsule>
    </Card>
  );

  const groups = showAll ? FIELD_GROUPS : FIELD_GROUPS.slice(0, 1);
  const fieldStyle = {
    width: '100%', height: 44, padding: '0 20px', ...T.callout,
    borderRadius: 'var(--radius-capsule)', border: `1px solid ${C.rim}`,
    background: C.quiet, color: C.primary, outline: 'none',
  };

  return shell(
    <div className="u-rise" style={{ width: '100%', maxWidth: 680 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20, marginBottom: 28 }}>
        <div>
          <Overline style={{ marginBottom: 10 }}>New report</Overline>
          <h1 style={{ ...T.title1, color: C.primary, margin: '0 0 6px' }}>Upload a report</h1>
          <div style={{ ...T.subhead, color: C.tertiary }}>
            {name ? `Hi, ${name} — drop` : 'Drop'} your sheets. We do the lookup, you keep your evening.
          </div>
        </div>
        <Link href="/" style={{ ...T.footnote, fontWeight: 600, color: C.secondary, textDecoration: 'none', paddingTop: 6, whiteSpace: 'nowrap' }}>← Home</Link>
      </div>

      <Card className="u-squircle-xl" pad={26} as="form" onSubmit={submit}>
        {/* Segmented: two options, both visible, both short. The selected pill
            translates on the Glide curve — it never fades. */}
        <div style={{ display: 'inline-flex', gap: 4, padding: 4, borderRadius: 'var(--radius-capsule)', background: C.quiet, marginBottom: 22 }}>
          {[['split', 'Three files'], ['merged', 'Already merged']].map(([m, label]) => (
            <Capsule key={m} type="button" onClick={() => switchMode(m)}
              variant={mode === m ? 'solid' : 'plain'} size="xs" style={{ padding: '0 16px', height: 32 }}>
              {label}
            </Capsule>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {mode === 'split' ? (
            <>
              {/* CYC first, and deliberately. It is the book the bank handed us, so it
                  sets the denominator. Anchoring on the call log instead would quietly
                  drop every account the AI never reached — and flatter our own numbers. */}
              <Drop index="1" title={cycFiles.length ? cycFiles[0].name : 'CYC / PDD file'}
                hint="RBL — the book they gave us. Outstanding, band, region, months on book. Sets which accounts are in this report."
                files={cycFiles} onPick={pickCyc} />
              <Drop index="2" title={outcomeFiles.length ? outcomeFiles[0].name : 'Status file'}
                hint="RBL — who actually paid. The outcome comes from the bank, never from us."
                files={outcomeFiles} onPick={pickOutcome} />
              <Drop index="3" title={statusFiles.length ? statusFiles[0].name : 'AI call log'}
                hint="Convin — one row per call attempt: when it was placed, whether it was answered, what the customer said."
                files={statusFiles} onPick={pickStatus} />
            </>
          ) : (
            <Drop index="1" title={statusFiles.length ? statusFiles[0].name : 'Merged sheet'}
              hint="One sheet that already has everything, because you did the lookup."
              files={statusFiles} onPick={pickStatus} />
          )}
        </div>

        {/* The two sentences on this page RBL's risk team will actually care about. */}
        {mode === 'split' && (
          <div style={{ ...T.caption, color: C.tertiary, lineHeight: 1.7, marginTop: 14 }}>
            Joined on Account No — no VLOOKUP, no manual step. The report covers{' '}
            <strong style={{ color: C.secondary, fontWeight: 600 }}>every account in RBL&rsquo;s book</strong>, including the
            ones the AI never reached, so the denominator is theirs and not ours. And the{' '}
            <strong style={{ color: C.secondary, fontWeight: 600 }}>outcome is taken from RBL&rsquo;s own status file</strong>,
            never from Convin&rsquo;s export. We do not label our own results.
          </div>
        )}

        {/* ── Column mapping ── */}
        {headers.length > 0 && (
          <div className="u-squircle" style={{ marginTop: 22, padding: 20, background: C.quiet }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
              <div style={{ ...T.headline, color: C.primary }}>Map your columns</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, ...T.caption, fontWeight: 600, color: missingRequired.length ? C.abort : C.nominal }}>
                <SignalDot tone={missingRequired.length ? C.abort : C.nominal} size={6} />
                {missingRequired.length ? `${missingRequired.length} required missing` : `${mappedCount} of ${headers.length} matched`}
              </div>
            </div>
            <div style={{ ...T.caption, color: C.tertiary, marginBottom: 18, lineHeight: 1.6 }}>
              Auto-detected from your headers. Change any that look wrong — every metric on the dashboard is built from them.
            </div>

            {groups.map((g) => (
              <div key={g.title} style={{ marginBottom: 16 }}>
                <Overline style={{ marginBottom: 10 }}>{g.title}</Overline>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 8 }}>
                  {g.keys.map((k) => {
                    const req = REQUIRED.includes(k);
                    const ok = !!mapping[k];
                    return (
                      <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <SignalDot tone={ok ? C.nominal : req ? C.abort : C.quaternary} size={6} />
                        <div style={{ ...T.caption, color: C.secondary, width: 132, flex: 'none' }}>
                          {FIELD_LABELS[k]}{req && <span style={{ color: C.abort }}> *</span>}
                        </div>
                        <select value={mapping[k] || ''} onChange={(e) => setMapping({ ...mapping, [k]: e.target.value })}
                          style={{ ...fieldStyle, height: 36, padding: '0 32px 0 16px', ...T.caption }}>
                          <option value="">— not in sheet —</option>
                          {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                        </select>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}

            <Capsule type="button" variant="plain" size="xs" onClick={() => setShowAll(!showAll)}>
              {showAll ? 'Show only required' : `Show all ${FIELD_GROUPS.reduce((n, g) => n + g.keys.length, 0)} fields`}
            </Capsule>
          </div>
        )}

        {/* ── Date + day ── */}
        <div style={{ display: 'flex', gap: 12, marginTop: 22 }}>
          <div style={{ flex: 2 }}>
            <Overline style={{ marginBottom: 8 }}>Report date</Overline>
            <input type="date" value={reportDate} onChange={(e) => setReportDate(e.target.value)} style={fieldStyle} />
          </div>
          <div style={{ flex: 1 }}>
            <Overline style={{ marginBottom: 8 }}>Day</Overline>
            <input type="number" min={1} value={slot} onChange={(e) => setSlot(e.target.value)} style={{ ...fieldStyle, ...NUM }} />
          </div>
        </div>
        <div style={{ ...T.caption, color: C.tertiary, marginTop: 10, lineHeight: 1.6 }}>
          Becomes the tab label — <b style={{ color: C.secondary }}>Day 1</b>, <b style={{ color: C.secondary }}>Day 2</b>.
          Re-uploading the same number <b style={{ color: C.secondary }}>replaces</b> that day; it never adds to it.
        </div>

        {error && (
          <div className="u-squircle-sm" role="alert" style={{
            marginTop: 20, padding: '14px 16px',
            background: C.bad(0.08), border: `1px solid ${C.bad(0.26)}`,
            display: 'flex', gap: 11, alignItems: 'flex-start',
          }}>
            <SignalDot tone={C.abort} size={6} style={{ marginTop: 7 }} />
            <div style={{ ...T.footnote, color: C.primary, lineHeight: 1.65 }}>{error}</div>
          </div>
        )}

        {result ? (
          <div className="u-squircle" style={{ marginTop: 20, padding: 20, background: C.good(0.07), border: `1px solid ${C.good(0.24)}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, ...T.headline, color: C.nominal }}>
              <SignalDot tone={C.nominal} size={7} />Built from {fmtInt(result.rowCount)} accounts
            </div>

            {result.stats && result.stats.extraSheets > 0 && (
              <div style={{ ...T.caption, color: C.secondary, marginTop: 10 }}>
                Joined {fmtInt(result.stats.matched)} accounts across {result.stats.extraSheets} sheet
                {result.stats.extraSheets === 1 ? '' : 's'} · {fmtInt(result.stats.filledCells)} values filled in
              </div>
            )}

            {/* The call log is the one file whose join you cannot eyeball afterwards —
                the dashboard would render perfectly with every call chart at zero. Say
                what landed, while the person who chose the file is still looking. */}
            {result.callStats && (
              <div style={{ ...T.caption, color: C.secondary, marginTop: 6, ...NUM }}>
                AI call log · {fmtInt(result.callStats.attempts)} attempts across {fmtInt(result.callStats.logAccounts)} accounts
                {' '}({fmtInt(result.callStats.connected)} answered, of which {fmtInt(result.callStats.voicemail)} voicemail)
                {' '}· rolled onto {fmtInt(result.callStats.matched)} accounts in the book
                {result.callStats.dates?.length ? ` · ${result.callStats.dates[0]} → ${result.callStats.dates[result.callStats.dates.length - 1]}` : ''}
              </div>
            )}

            {(result.warnings || []).map((w, i) => (
              <div key={i} className="u-squircle-sm" style={{
                marginTop: 10, padding: '11px 13px',
                background: C.warn(0.10), border: `1px solid ${C.warn(0.26)}`,
                display: 'flex', gap: 10, alignItems: 'flex-start',
              }}>
                <SignalDot tone={C.caution} size={6} style={{ marginTop: 6 }} />
                <div style={{ ...T.caption, color: C.secondary, lineHeight: 1.65 }}>{w}</div>
              </div>
            ))}

            <Hairline style={{ margin: '16px 0 14px' }} />
            <div style={{ ...T.caption, ...NUM, color: C.tertiary, marginBottom: 16 }}>
              Batch {result.batchId} · {result.reportDate}
            </div>
            <Capsule as={Link} href={`/dashboard?date=${result.reportDate}`} variant="metal" size="m">
              View dashboard →
            </Capsule>
          </div>
        ) : (
          <Capsule type="submit" variant="metal" size="l" full disabled={busy} style={{ marginTop: 22 }}>
            {busy ? (progress ? progress.note : 'Working') : 'Upload and build'}
          </Capsule>
        )}

        {/* Determinate whenever a number exists — an indeterminate spinner is a
            confession. The bar is scrubbed by real progress, never by a timer. */}
        {busy && progress && (
          <div style={{ marginTop: 14 }}>
            <Track pctv={progress.pct} tone={C.accentFill} height={6} />
            <div style={{ ...T.caption, color: C.tertiary, marginTop: 9, textAlign: 'center' }}>
              Files are parsed and joined in your browser. Only the result is sent.
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
