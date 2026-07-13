'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { parseCsvLine } from '../../lib/csv.mjs';
import { autoMap, FIELD_GROUPS, FIELD_LABELS } from '../../lib/normalize.mjs';
import { uploadFiles } from '../../lib/upload_client.mjs';

const ink = (a) => `rgba(var(--ink),${a})`;
const GLASS = { background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', backdropFilter: 'blur(30px) saturate(180%)', WebkitBackdropFilter: 'blur(30px) saturate(180%)', boxShadow: 'var(--glass-shadow)' };
const BTN = { border: 'none', borderRadius: 999, cursor: 'pointer', fontWeight: 600, fontFamily: 'inherit' };
const SELECT = { width: '100%', padding: '9px 30px 9px 14px', fontSize: 12.5, borderRadius: 999, border: '1px solid ' + ink(.14), background: 'var(--input-bg)', outline: 'none', color: 'var(--text)' };
const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI", Helvetica, Arial, sans-serif';
const today = () => new Date().toISOString().slice(0, 10);
const fmtInt = (n) => Math.round(n || 0).toLocaleString('en-IN');
const REQUIRED = ['account_no', 'status', 'total_outstanding'];

const isExcel = (f) => /\.xlsx?$/i.test(f?.name || '');

/** Read just the header row. CSV: slice the first 256KB — never load the whole file.
 *  Excel: SheetJS needs the workbook, but the Status file is 177k rows, so we only
 *  ever pull row 1 back out of it. */
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

function Drop({ title, hint, files, onPick, multiple, accent }) {
  const [drag, setDrag] = useState(false);
  return (
    <label
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); onPick(Array.from(e.dataTransfer.files)); }}
      style={{ display: 'block', padding: '20px', borderRadius: 20, border: `2px dashed ${drag ? '#0071E3' : ink(.16)}`, background: drag ? 'rgba(0,113,227,.06)' : ink(.03), cursor: 'pointer', transition: 'border-color .2s, background .2s' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ width: 38, height: 38, borderRadius: 999, background: accent, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 300, flex: 'none' }}>↑</div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
          <div style={{ fontSize: 11.5, color: ink(.5), marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {files.length ? files.map((f) => f.name).join(', ') : hint}
          </div>
        </div>
      </div>
      <input type="file" accept=".csv,.xlsx,.xls,text/csv" multiple={multiple} onChange={(e) => onPick(Array.from(e.target.files))} style={{ display: 'none' }} />
    </label>
  );
}

export default function Upload() {
  const [authed, setAuthed] = useState(null);
  const [name, setName] = useState('');
  // The real upload is three files. `leads` is primary — it decides which accounts
  // are in this report. `cyc` brings the money and the demographics. `status` brings
  // the OUTCOME, and it comes from RBL, not from us.
  const [mode, setMode] = useState('split'); // 'split' = 3 files · 'merged' = one sheet
  const [statusFiles, setStatusFiles] = useState([]);   // slot 1: lead outcome (primary)
  const [cycFiles, setCycFiles] = useState([]);         // slot 2: CYC / PDD
  const [outcomeFiles, setOutcomeFiles] = useState([]); // slot 3: status
  const [extraFiles, setExtraFiles] = useState([]);     // legacy: any other sheet
  const [headers, setHeaders] = useState([]);
  const [mapping, setMapping] = useState({});
  const [showAll, setShowAll] = useState(false);
  const [reportDate, setReportDate] = useState(today());
  const [slot, setSlot] = useState(1);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/me');
        if (r.status === 200) { const j = await r.json(); setName(j.name); setAuthed(true); } else setAuthed(false);
      } catch { setAuthed(false); }
    })();
  }, []);

  /* Re-read headers + auto-map whenever the file selection changes. */
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
  const pickExtra = (fs) => {
    setExtraFiles(fs); setResult(null); setError('');
    refreshHeaders(statusFiles, [...cycFiles, ...outcomeFiles, ...fs]);
  };
  const switchMode = (m) => {
    setMode(m); setResult(null); setError('');
    if (m === 'merged') { setCycFiles([]); setOutcomeFiles([]); setExtraFiles([]); refreshHeaders(statusFiles, []); }
    else refreshHeaders(statusFiles, others(m));
  };

  const missingRequired = REQUIRED.filter((k) => !mapping[k]);
  const mappedCount = Object.values(mapping).filter(Boolean).length;

  const [progress, setProgress] = useState(null);

  const submit = async (e) => {
    e.preventDefault(); setError(''); setResult(null);
    if (mode === 'split' && !cycFiles.length) { setError('Add the CYC / PDD file — it is the book RBL gave us, and it sets which accounts are in this report.'); return; }
    if (mode === 'merged' && !statusFiles.length) { setError('Choose a sheet first.'); return; }
    // In three-file mode the outcome lives in RBL's status file, so we cannot demand it
    // be mapped from the primary sheet. The server validates every row after the join.
    if (mode === 'merged' && missingRequired.length) {
      setError(`Map the required columns: ${missingRequired.map((k) => FIELD_LABELS[k]).join(', ')}.`);
      return;
    }
    setBusy(true);
    setProgress({ pct: 0, note: 'Starting…' });
    try {
      /* THE FILES NEVER LEAVE THIS BROWSER.
         They are parsed and joined here, and only the RESULT is sent — gzipped, in chunks.
         12.5 MB of workbooks become ~0.6 MB on the wire, which is what makes this work on
         Vercel at all: the platform refuses any request body over 4.5 MB, full stop.

         It is also simply faster. The server no longer re-parses a 177,685-row workbook it
         was handed; your laptop, which already has the file open, does it once. */
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
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 24px', color: 'var(--text)', fontFamily: FONT }}>{c}</div>
  );
  if (authed === null) return shell(<div style={{ color: ink(.5), fontSize: 15 }}>Loading…</div>);
  if (!authed) return shell(
    <div style={{ ...GLASS, borderRadius: 28, padding: 32, textAlign: 'center' }}>
      <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Please sign in first</div>
      <Link href="/" style={{ ...BTN, display: 'inline-block', padding: '11px 22px', background: '#0071E3', color: '#fff', textDecoration: 'none', fontSize: 14 }}>Go to sign in</Link>
    </div>
  );

  const groups = showAll ? FIELD_GROUPS : FIELD_GROUPS.slice(0, 1);

  return shell(
    <div style={{ width: '100%', maxWidth: 680 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 18 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.13em', color: '#0071E3', textTransform: 'uppercase' }}>New report</div>
          <h1 style={{ fontSize: 32, fontWeight: 700, letterSpacing: '-.03em', margin: '6px 0 4px' }}>Upload a new report</h1>
          <div style={{ fontSize: 13.5, color: ink(.55) }}>
            {name ? `Hi, ${name} — ` : ''}drop your sheets. We do the lookup, you keep your evening.
          </div>
        </div>
        <Link href="/" style={{ fontSize: 13, fontWeight: 600, color: '#0071E3', textDecoration: 'none', paddingTop: 6, whiteSpace: 'nowrap' }}>← Home</Link>
      </div>

      <form onSubmit={submit} style={{ ...GLASS, borderRadius: 26, padding: 26 }}>
        {/* mode */}
        <div style={{ display: 'inline-flex', gap: 4, padding: 4, borderRadius: 999, background: ink(.05), border: '1px solid ' + ink(.06), marginBottom: 18 }}>
          {[['split', 'Three files'], ['merged', 'Already merged']].map(([m, label]) => (
            <button key={m} type="button" onClick={() => switchMode(m)} className="pill"
              style={{ padding: '8px 16px', fontSize: 12.5, fontWeight: 600, background: mode === m ? '#0071E3' : 'transparent', color: mode === m ? '#fff' : ink(.6) }}>
              {label}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {mode === 'split' ? (
            <>
              {/* CYC first, and deliberately. It is the book the bank handed us, so it sets
                  the denominator. Anchoring on the lead file instead would quietly drop every
                  account the AI never reached — and flatter our own connect and recovery rates. */}
              <Drop
                title={cycFiles.length ? cycFiles[0].name : '1 · CYC / PDD file'}
                hint="RBL — the book they gave us. Outstanding, band, region, months on book. Sets which accounts are in this report."
                files={cycFiles} onPick={pickCyc} accent="linear-gradient(135deg,#0071E3,#5856D6)" />
              <Drop
                title={outcomeFiles.length ? outcomeFiles[0].name : '2 · Status file'}
                hint="RBL — who actually paid. The outcome comes from the bank, never from us."
                files={outcomeFiles} onPick={pickOutcome} accent="linear-gradient(135deg,#AF52DE,#FF2D55)" />
              <Drop
                title={statusFiles.length ? statusFiles[0].name : '3 · Lead Outcome report'}
                hint="Convin — who we called, how long we talked, what they said. Looked up onto the book."
                files={statusFiles} onPick={pickStatus} accent="linear-gradient(135deg,#34C759,#30B0C7)" />
            </>
          ) : (
            <Drop
              title={statusFiles.length ? statusFiles[0].name : 'Drop your merged sheet'}
              hint="One sheet that already has everything (you did the lookup)"
              files={statusFiles} onPick={pickStatus} accent="linear-gradient(135deg,#0071E3,#5856D6)" />
          )}
        </div>

        {/* The two sentences on this page that RBL's risk team will actually care about. */}
        {mode === 'split' && (
          <div style={{ marginTop: 12, fontSize: 11.5, color: ink(.45), lineHeight: 1.55 }}>
            Joined on Account No — no VLOOKUP, no manual step. The report covers
            <strong style={{ color: ink(.62), fontWeight: 600 }}> every account in RBL&apos;s book</strong>, including
            the ones the AI never reached, so the denominator is theirs and not ours. And the
            <strong style={{ color: ink(.62), fontWeight: 600 }}> outcome is taken from RBL&apos;s own status file</strong>,
            never from Convin&apos;s export. We do not label our own results.
          </div>
        )}

        {/* ── column mapping ── */}
        {headers.length > 0 && (
          <div style={{ marginTop: 20, padding: 18, borderRadius: 20, background: ink(.03), border: '1px solid ' + ink(.07) }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <div style={{ fontSize: 14.5, fontWeight: 700 }}>Map your columns</div>
              <div style={{ fontSize: 11.5, color: missingRequired.length ? '#FF3B30' : '#34C759', fontWeight: 600 }}>
                {missingRequired.length ? `${missingRequired.length} required missing` : `${mappedCount} of ${headers.length} columns matched`}
              </div>
            </div>
            <div style={{ fontSize: 12, color: ink(.5), marginBottom: 14, lineHeight: 1.5 }}>
              We auto-detected these from your headers. Change any that look wrong — every metric on the dashboard is built from them.
            </div>

            {groups.map((g) => (
              <div key={g.title} style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: ink(.42), marginBottom: 8 }}>{g.title}</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 8 }}>
                  {g.keys.map((k) => {
                    const req = REQUIRED.includes(k);
                    const ok = !!mapping[k];
                    return (
                      <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ width: 6, height: 6, borderRadius: 999, flex: 'none', background: ok ? '#34C759' : (req ? '#FF3B30' : ink(.2)) }} />
                        <div style={{ fontSize: 12.5, color: ink(.72), width: 132, flex: 'none' }}>
                          {FIELD_LABELS[k]}{req && <span style={{ color: '#FF3B30' }}> *</span>}
                        </div>
                        <select value={mapping[k] || ''} onChange={(e) => setMapping({ ...mapping, [k]: e.target.value })} style={SELECT}>
                          <option value="">— not in sheet —</option>
                          {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                        </select>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}

            <button type="button" onClick={() => setShowAll(!showAll)} style={{ ...BTN, padding: '8px 16px', fontSize: 12, background: ink(.06), color: 'var(--text)' }}>
              {showAll ? 'Show only required' : `Show all ${FIELD_GROUPS.reduce((n, g) => n + g.keys.length, 0)} fields`}
            </button>
          </div>
        )}

        {/* date + slot */}
        <div style={{ display: 'flex', gap: 12, marginTop: 18 }}>
          <div style={{ flex: 2 }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: ink(.5), marginBottom: 6 }}>Report date</div>
            <input type="date" value={reportDate} onChange={(e) => setReportDate(e.target.value)}
              style={{ width: '100%', padding: '11px 16px', fontSize: 13.5, borderRadius: 999, border: '1px solid ' + ink(.14), background: 'var(--input-bg)', outline: 'none', color: 'var(--text)' }} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: ink(.5), marginBottom: 6 }}>Upload #</div>
            <input type="number" min={1} value={slot} onChange={(e) => setSlot(e.target.value)}
              style={{ width: '100%', padding: '11px 16px', fontSize: 13.5, borderRadius: 999, border: '1px solid ' + ink(.14), background: 'var(--input-bg)', outline: 'none', color: 'var(--text)' }} />
          </div>
        </div>
        <div style={{ fontSize: 11.5, color: ink(.45), marginTop: 8 }}>Use 1 for the day&apos;s first file; 2, 3… for more of the same day (each becomes a tab).</div>

        {error && <div style={{ marginTop: 16, padding: '12px 16px', borderRadius: 16, background: 'rgba(255,59,48,.1)', color: '#FF3B30', fontSize: 13, fontWeight: 500 }}>{error}</div>}

        {result ? (
          <div style={{ marginTop: 16, padding: '18px 20px', borderRadius: 20, background: 'rgba(52,199,89,.1)', border: '1px solid rgba(52,199,89,.3)' }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#34C759' }}>✓ Built from {fmtInt(result.rowCount)} accounts</div>
            {result.stats && result.stats.extraSheets > 0 && (
              <div style={{ fontSize: 12.5, color: ink(.6), marginTop: 6 }}>
                Auto-joined {fmtInt(result.stats.matched)} accounts across {result.stats.extraSheets} sheet{result.stats.extraSheets === 1 ? '' : 's'} · {fmtInt(result.stats.filledCells)} values filled in
              </div>
            )}
            {(result.warnings || []).map((w, i) => (
              <div key={i} style={{ marginTop: 10, padding: '10px 12px', borderRadius: 12, background: 'rgba(255,149,0,.12)', color: '#b7791f', fontSize: 12, lineHeight: 1.5 }}>⚠ {w}</div>
            ))}
            <div style={{ fontSize: 12, color: ink(.5), margin: '10px 0 14px' }}>Batch {result.batchId} · {result.reportDate}</div>
            <Link href={`/dashboard?date=${result.reportDate}`} style={{ ...BTN, display: 'inline-block', padding: '11px 22px', fontSize: 14, background: '#0071E3', color: '#fff', textDecoration: 'none' }}>View dashboard →</Link>
          </div>
        ) : (
          <button type="submit" disabled={busy} style={{ ...BTN, width: '100%', marginTop: 18, padding: 15, fontSize: 15, background: busy ? ink(.2) : '#0071E3', color: '#fff', cursor: busy ? 'default' : 'pointer' }}>
            {busy ? (progress ? progress.note : 'Working…') : 'Upload & build dashboard'}
          </button>
        )}

        {/* Progress. Parsing a 177,685-row workbook in a browser takes a couple of
            seconds, and a button that says nothing for a couple of seconds is a button an
            exec clicks again. Show the work. */}
        {busy && progress && (
          <div style={{ marginTop: 12 }}>
            <div style={{ height: 6, borderRadius: 999, background: ink(.08), overflow: 'hidden' }}>
              <div style={{
                width: `${Math.max(3, progress.pct)}%`, height: '100%', borderRadius: 999,
                background: 'linear-gradient(90deg,#0071E3,#5AC8FA)', transition: 'width .4s ease',
              }} />
            </div>
            <div style={{ fontSize: 11.5, color: ink(.45), marginTop: 7, textAlign: 'center' }}>
              Files are parsed and joined in your browser — only the result is sent.
            </div>
          </div>
        )}
      </form>
    </div>
  );
}
