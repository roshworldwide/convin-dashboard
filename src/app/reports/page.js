'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { C, T, NUM, Card, Overline, Capsule, Chip, fmtInt } from '../aurum';

/* ═══════════════════════════════════════════════════════════════════════════════
 * THE ARCHIVE.
 *
 * A list screen, so it is grouped fills on a quiet canvas with no accent at all —
 * hierarchy carried purely by type weight and position. Nothing on this page is the
 * most important thing in the product, so nothing on it wears metal.
 * ═══════════════════════════════════════════════════════════════════════════════ */

const Trash = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
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

  const all = (manifest && manifest.dates) || [];
  const dates = q.trim()
    ? all.filter((d) => `${d.display} ${d.date}`.toLowerCase().includes(q.trim().toLowerCase()))
    : all;

  return shell(
    <div className="u-rise" style={{ width: '100%', maxWidth: 760 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20, marginBottom: 28 }}>
        <div>
          <Overline style={{ marginBottom: 10 }}>Archive</Overline>
          <h1 style={{ ...T.title1, color: C.primary, margin: '0 0 6px' }}>All reports</h1>
          <div style={{ ...T.subhead, color: C.tertiary }}>
            {all.length
              ? `${all.length} report ${all.length === 1 ? 'date' : 'dates'} · every upload kept, nothing overwritten`
              : 'No reports yet'}
          </div>
        </div>
        <Link href="/" style={{ ...T.footnote, fontWeight: 600, color: C.secondary, textDecoration: 'none', paddingTop: 6, whiteSpace: 'nowrap' }}>← Home</Link>
      </div>

      <Card className="u-squircle-xl" pad={24}>
        {all.length > 4 && (
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by date"
            style={{
              width: '100%', height: 44, padding: '0 20px', ...T.callout,
              borderRadius: 'var(--radius-capsule)', border: `1px solid ${C.rim}`,
              background: C.quiet, color: C.primary, outline: 'none', marginBottom: 16,
            }}
          />
        )}

        {dates.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '36px 0' }}>
            <div style={{ ...T.subhead, color: C.tertiary, marginBottom: 20 }}>
              {all.length ? 'No report matches that date.' : 'Nothing here yet. Your first book takes about a minute.'}
            </div>
            {!all.length && <Capsule as={Link} href="/upload" variant="metal" size="m">Upload a report</Capsule>}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {dates.map((d, i) => {
              const isConfirm = confirmDate === d.date;
              return (
                <div key={d.date} className="hover-row" style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14,
                  padding: '12px 12px 12px 18px',
                  borderRadius: 'var(--radius-capsule)',
                  background: C.quiet,
                  border: `1px solid ${isConfirm ? C.bad(0.32) : 'transparent'}`,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16, minWidth: 0 }}>
                    <div style={{ ...T.micro, ...NUM, color: C.secondary, width: 22, flex: 'none' }}>
                      {String(i + 1).padStart(2, '0')}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, ...T.subhead, fontWeight: 600, color: C.primary, whiteSpace: 'nowrap' }}>
                        {d.display}
                        {i === 0 && !q && <Chip selected>Latest</Chip>}
                      </div>
                      <div style={{ ...T.caption, color: isConfirm ? C.abort : C.secondary, whiteSpace: 'nowrap' }}>
                        {isConfirm
                          ? `Delete ${fmtInt(d.rowCount)} accounts and ${d.uploads.length} upload${d.uploads.length === 1 ? '' : 's'}. This cannot be undone.`
                          : `${fmtInt(d.rowCount)} accounts · ${d.uploads.length} upload${d.uploads.length === 1 ? '' : 's'}`}
                      </div>
                    </div>
                  </div>

                  {isConfirm ? (
                    /* 24 pt between the safe action and the irreversible one, safe on
                       the left. Neither wears metal — metal is for what you want, not
                       for what you cannot undo. */
                    <div style={{ display: 'flex', gap: 24, flex: 'none', alignItems: 'center' }}>
                      <Capsule variant="plain" size="xs" onClick={() => setConfirmDate('')}>Keep</Capsule>
                      <Capsule variant="destruct" size="xs" onClick={() => removeReport(d.date)} disabled={deleting === d.date}>
                        {deleting === d.date ? 'Deleting' : 'Delete'}
                      </Capsule>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 'none' }}>
                      <Capsule as={Link} href={`/dashboard?date=${d.date}`} variant="glass" size="xs">Open</Capsule>
                      <Capsule variant="plain" size="xs" onClick={() => setConfirmDate(d.date)} title="Delete report" aria-label={`Delete the report for ${d.display}`}
                        style={{ width: 28, minWidth: 28, padding: 0, color: C.quaternary }}>
                        <Trash />
                      </Capsule>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <div style={{ ...T.caption, color: C.tertiary, textAlign: 'center', marginTop: 24, lineHeight: 1.7 }}>
        Deleting a report removes every upload for that date and its Day Total. This cannot be undone.
      </div>
    </div>
  );
}
