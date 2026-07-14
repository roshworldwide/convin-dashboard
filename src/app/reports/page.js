'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

const ink = (a) => `rgba(var(--ink),${a})`;

/* Text vs hairlines — the full reasoning is in dashboard/Report.jsx.
   ink() paints dividers and fills, and stays faint on purpose.
   txt() paints WORDS. The text alphas here had drifted to roughly 2.5:1 contrast on
   white — below the 4.5:1 WCAG AA needs for body text, and unreadable on a projector
   or a printout. txt() floors them without flattening the hierarchy. */
const TEXT_FLOOR = 0.66;
const textAlpha = (a) => {
  if (a >= 0.92) return 1;
  const t = Math.min(1, Math.max(0, (a - 0.2) / (0.92 - 0.2)));
  return +(TEXT_FLOOR + t * (1 - TEXT_FLOOR)).toFixed(3);
};
const txt = (a) => `rgba(var(--ink),${textAlpha(a)})`;
const GLASS = { background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', backdropFilter: 'blur(30px) saturate(180%)', WebkitBackdropFilter: 'blur(30px) saturate(180%)', boxShadow: 'var(--glass-shadow)' };
const BTN = { border: 'none', borderRadius: 999, cursor: 'pointer', fontWeight: 600, fontFamily: 'inherit' };
const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI", Helvetica, Arial, sans-serif';
const fmtInt = (n) => Math.round(n || 0).toLocaleString('en-IN');

const Trash = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
  </svg>
);

export default function Reports() {
  const [authed, setAuthed] = useState(null);
  const [manifest, setManifest] = useState(null);
  const [q, setQ] = useState('');
  const [confirmDate, setConfirmDate] = useState('');
  const [deleting, setDeleting] = useState('');

  const load = async () => {
    const r = await fetch('/api/data');
    if (r.status !== 200) { setAuthed(false); return; }
    setManifest(await r.json()); setAuthed(true);
  };
  useEffect(() => { (async () => { try { await load(); } catch { setAuthed(false); } })(); }, []);

  const removeReport = async (date) => {
    setDeleting(date);
    try { await fetch(`/api/report?date=${encodeURIComponent(date)}`, { method: 'DELETE' }); setConfirmDate(''); await load(); }
    catch {} finally { setDeleting(''); }
  };

  const shell = (c) => (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px 24px', color: 'var(--text)', fontFamily: FONT }}>{c}</div>
  );
  if (authed === null) return shell(<div style={{ color: txt(.5), fontSize: 15 }}>Loading…</div>);
  if (!authed) return shell(
    <div style={{ ...GLASS, borderRadius: 28, padding: 32, textAlign: 'center' }}>
      <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Please sign in first</div>
      <Link href="/" style={{ ...BTN, display: 'inline-block', padding: '11px 22px', background: '#0071E3', color: '#fff', textDecoration: 'none', fontSize: 14 }}>Go to sign in</Link>
    </div>
  );

  const all = (manifest && manifest.dates) || [];
  const dates = q.trim()
    ? all.filter((d) => (d.display + ' ' + d.date).toLowerCase().includes(q.trim().toLowerCase()))
    : all;

  return shell(
    <div style={{ width: '100%', maxWidth: 760, animation: 'fadeUp .6s cubic-bezier(.32,.72,0,1) both' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.13em', color: '#0071E3', textTransform: 'uppercase' }}>Archive</div>
          <h1 style={{ fontSize: 32, fontWeight: 700, letterSpacing: '-.03em', margin: '6px 0 4px' }}>All reports</h1>
          <div style={{ fontSize: 13.5, color: txt(.55) }}>
            {all.length ? `${all.length} report ${all.length === 1 ? 'day' : 'days'} · every upload kept, nothing overwritten` : 'No reports yet'}
          </div>
        </div>
        <Link href="/" style={{ fontSize: 13, fontWeight: 600, color: '#0071E3', textDecoration: 'none', paddingTop: 6, whiteSpace: 'nowrap' }}>← Home</Link>
      </div>

      <div style={{ ...GLASS, borderRadius: 26, padding: 24 }}>
        {all.length > 4 && (
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by date…"
            style={{ width: '100%', padding: '11px 18px', fontSize: 13.5, borderRadius: 999, border: '1px solid ' + ink(.14), background: 'var(--input-bg)', outline: 'none', color: 'var(--text)', marginBottom: 14 }} />
        )}

        {dates.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '30px 0' }}>
            <div style={{ fontSize: 14, color: txt(.5), marginBottom: 16 }}>{all.length ? 'No report matches that date.' : 'Upload your first CSV to see it here.'}</div>
            {!all.length && <Link href="/upload" style={{ ...BTN, display: 'inline-block', padding: '11px 22px', fontSize: 14, background: '#0071E3', color: '#fff', textDecoration: 'none' }}>Upload a report</Link>}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {dates.map((d, i) => {
              const isConfirm = confirmDate === d.date;
              return (
                <div key={d.date} className="hover-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '13px 13px 13px 18px', borderRadius: 999, background: ink(.04), border: '1px solid ' + (isConfirm ? 'rgba(255,59,48,.3)' : ink(.06)) }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: txt(.3), width: 22, flex: 'none', fontVariantNumeric: 'tabular-nums' }}>{String(i + 1).padStart(2, '0')}</div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14.5, fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {d.display}
                        {i === 0 && !q && <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: '#34C759', background: 'rgba(52,199,89,.12)', padding: '3px 8px', borderRadius: 999 }}>Latest</span>}
                      </div>
                      <div style={{ fontSize: 11.5, color: txt(.5), whiteSpace: 'nowrap' }}>
                        {isConfirm ? 'Delete this report permanently?' : `${fmtInt(d.rowCount)} accounts · ${d.uploads.length} upload${d.uploads.length === 1 ? '' : 's'}`}
                      </div>
                    </div>
                  </div>

                  {isConfirm ? (
                    <div style={{ display: 'flex', gap: 6, flex: 'none' }}>
                      <button onClick={() => removeReport(d.date)} disabled={deleting === d.date} style={{ ...BTN, padding: '8px 16px', fontSize: 12, background: '#FF3B30', color: '#fff' }}>
                        {deleting === d.date ? 'Deleting…' : 'Delete'}
                      </button>
                      <button onClick={() => setConfirmDate('')} style={{ ...BTN, padding: '8px 14px', fontSize: 12, background: ink(.08), color: 'var(--text)' }}>Cancel</button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, flex: 'none' }}>
                      <Link href={`/dashboard?date=${d.date}`} style={{ ...BTN, padding: '8px 18px', fontSize: 12.5, background: '#0071E3', color: '#fff', textDecoration: 'none', display: 'inline-block' }}>Open</Link>
                      <button onClick={() => setConfirmDate(d.date)} title="Delete report" aria-label="Delete report"
                        style={{ ...BTN, width: 32, height: 32, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: ink(.06), color: txt(.45), padding: 0 }}>
                        <Trash />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ textAlign: 'center', fontSize: 11.5, color: txt(.38), marginTop: 22 }}>
        Deleting a report removes every upload for that day and its Day Total. This cannot be undone.
      </div>
    </div>
  );
}
