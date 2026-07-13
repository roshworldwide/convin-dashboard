'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

const ink = (a) => `rgba(var(--ink),${a})`;
const GLASS = { background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', backdropFilter: 'blur(30px) saturate(180%)', WebkitBackdropFilter: 'blur(30px) saturate(180%)', boxShadow: 'var(--glass-shadow)' };
const BTN = { border: 'none', borderRadius: 999, cursor: 'pointer', fontWeight: 600, fontFamily: 'inherit' };
const FIELD = { width: '100%', padding: '15px 22px', fontSize: 15, borderRadius: 999, border: '1px solid ' + ink(.14), background: 'var(--input-bg)', outline: 'none', color: 'var(--text)' };
const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI", Helvetica, Arial, sans-serif';
const fmtInt = (n) => Math.round(n || 0).toLocaleString('en-IN');

const Trash = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
  </svg>
);

export default function Home() {
  const [authed, setAuthed] = useState(null);
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [busy, setBusy] = useState(false);
  const [manifest, setManifest] = useState(null);
  const [confirmDate, setConfirmDate] = useState('');
  const [deleting, setDeleting] = useState('');

  const load = async () => {
    const r = await fetch('/api/data');
    if (r.status !== 200) { setAuthed(false); return; }
    const [man, me] = await Promise.all([r.json(), fetch('/api/me').then((x) => (x.ok ? x.json() : { name: '' }))]);
    setManifest(man); setName(me.name || ''); setAuthed(true);
  };
  useEffect(() => { (async () => { try { await load(); } catch { setAuthed(false); } })(); }, []);

  const login = async (e) => {
    e.preventDefault(); setAuthError(''); setBusy(true);
    try {
      const r = await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
      if (r.ok) await load(); else setAuthError((await r.json()).error || 'Sign in failed');
    } catch { setAuthError('Connection failed'); } finally { setBusy(false); }
  };
  const logout = async () => { try { await fetch('/api/auth'); setAuthed(false); setManifest(null); setName(''); setUsername(''); setPassword(''); } catch {} };

  const removeReport = async (date) => {
    setDeleting(date);
    try {
      await fetch(`/api/report?date=${encodeURIComponent(date)}`, { method: 'DELETE' });
      setConfirmDate('');
      await load();
    } catch {} finally { setDeleting(''); }
  };

  if (authed === null) {
    return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: ink(.5), fontSize: 15, fontFamily: FONT }}>Loading…</div>;
  }

  /* ══════════════════ LOGIN — single screen ══════════════════ */
  if (!authed) return (
    <div style={{ height: '100vh', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'clamp(96px, 12vh, 120px) 24px 40px', color: 'var(--text)', fontFamily: FONT }}>
      <header className="island" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 20px 9px 11px', borderRadius: 999, ...GLASS }}>
        <div style={{ width: 30, height: 30, borderRadius: 999, background: 'linear-gradient(135deg,#0071E3,#5856D6)', boxShadow: '0 2px 10px rgba(0,113,227,.4)', flex: 'none' }} />
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.18 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, letterSpacing: '-.01em', whiteSpace: 'nowrap' }}>Recovery Intelligence</div>
          <div style={{ fontSize: 10.5, color: ink(.5), whiteSpace: 'nowrap' }}>Convin × RBL Bank</div>
        </div>
        <span style={{ width: 1, height: 20, background: ink(.12), flex: 'none' }} />
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: ink(.55), whiteSpace: 'nowrap' }}>
          <span style={{ width: 6, height: 6, borderRadius: 999, background: '#34C759', animation: 'pulseDot 2s ease-in-out infinite' }} />Secure
        </span>
      </header>

      <div style={{ width: '100%', maxWidth: 1140, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(330px, 1fr))', gap: 'clamp(36px, 5vw, 72px)', alignItems: 'center' }}>
        <div style={{ animation: 'fadeUp .8s cubic-bezier(.32,.72,0,1) both' }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: '#0071E3', marginBottom: 20 }}>The open book</div>
          <h1 style={{ fontSize: 'clamp(34px, 4.4vw, 60px)', lineHeight: 1.05, fontWeight: 700, letterSpacing: '-.04em', margin: 0 }}>
            <span style={{ color: ink(.36) }}>The money is still on the table.</span><br />
            <span style={{ background: 'linear-gradient(115deg,#34C759 0%,#0071E3 52%,#5856D6 100%)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>You can&apos;t see it yet.</span>
          </h1>
          <p style={{ fontSize: 'clamp(15.5px, 1.25vw, 18px)', lineHeight: 1.62, color: ink(.6), maxWidth: 520, margin: 'clamp(22px, 3vh, 30px) 0 0' }}>
            Most of the book doesn&apos;t close on the first call. What&apos;s left isn&apos;t a dead list — it&apos;s a
            ranked one. The customers who promised. The ones who stayed on the line for four minutes. The ones
            who claim they&apos;ve already paid. Every day nobody works them, they get colder.
          </p>
        </div>

        <div style={{ ...GLASS, borderRadius: 32, padding: 'clamp(30px, 4vh, 42px) clamp(28px, 3vw, 38px)', animation: 'cardIn .9s cubic-bezier(.32,.72,0,1) both .12s', maxWidth: 430, width: '100%', justifySelf: 'end' }}>
          <h2 style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-.025em', margin: '0 0 6px' }}>Sign in</h2>
          <p style={{ fontSize: 13.5, color: ink(.5), margin: '0 0 26px' }}>Authorised users only.</p>
          <form onSubmit={login} style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
            <input type="text" placeholder="Username" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} style={FIELD} />
            <input type="password" placeholder="Password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} style={FIELD} />
            {authError && <div style={{ fontSize: 13, color: '#FF3B30', fontWeight: 500, padding: '2px 8px' }}>{authError}</div>}
            <button type="submit" disabled={busy} style={{ ...BTN, padding: 16, fontSize: 15, background: busy ? ink(.2) : '#0071E3', color: '#fff', marginTop: 6 }}>
              {busy ? 'Signing in…' : 'Sign In'}
            </button>
          </form>
          <div style={{ fontSize: 11.5, color: ink(.4), textAlign: 'center', marginTop: 22, lineHeight: 1.6 }}>
            Confidential to RBL Bank and Convin.<br />Sessions expire after 7 days.
          </div>
        </div>
      </div>
    </div>
  );

  /* ══════════════════════════ HUB ══════════════════════════ */
  const dates = (manifest && manifest.dates) || [];

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 24px', color: 'var(--text)', fontFamily: FONT }}>
      <div style={{ width: '100%', maxWidth: 1020, animation: 'fadeUp .6s cubic-bezier(.32,.72,0,1) both' }}>

        {/* header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 34, height: 34, borderRadius: 999, background: 'linear-gradient(135deg,#0071E3,#5856D6)', boxShadow: '0 2px 10px rgba(0,113,227,.4)' }} />
            <div>
              <div style={{ fontSize: 15.5, fontWeight: 700, letterSpacing: '-.01em' }}>Recovery Intelligence</div>
              <div style={{ fontSize: 11.5, color: ink(.5) }}>Convin × RBL Bank</div>
            </div>
          </div>
          <button onClick={logout} style={{ ...BTN, padding: '9px 18px', fontSize: 12.5, background: ink(.06), color: '#FF3B30' }}>Logout</button>
        </div>

        {/* greeting + hook */}
        <h1 style={{ fontSize: 'clamp(30px, 3.4vw, 40px)', fontWeight: 700, letterSpacing: '-.03em', margin: '0 0 8px' }}>Hi, {name || 'there'}</h1>
        <p style={{ fontSize: 'clamp(15px, 1.2vw, 17px)', color: ink(.58), margin: '0 0 22px', lineHeight: 1.55, maxWidth: 700 }}>
          The AI has already worked the book. This is where that work becomes something you can put in
          front of a board — and <strong style={{ color: 'var(--text)', fontWeight: 600 }}>defend, line by line</strong>.
        </p>

        {/* two cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
          {/* Upload */}
          <Link href="/upload" style={{ textDecoration: 'none', color: 'inherit' }}>
            <div className="hover-kpi" style={{ ...GLASS, borderRadius: 24, padding: 26, height: '100%' }}>
              <div style={{ width: 46, height: 46, borderRadius: 999, background: 'linear-gradient(135deg,#0071E3,#5856D6)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 22, fontWeight: 300, boxShadow: '0 6px 16px rgba(0,113,227,.3)' }}>↑</div>
              <div style={{ fontSize: 19, fontWeight: 700, letterSpacing: '-.01em', marginTop: 16 }}>Upload a new report</div>
              <div style={{ fontSize: 13.5, color: ink(.55), marginTop: 6, lineHeight: 1.55 }}>
                Two sheets in, one dashboard out. Map the columns once — we handle the lookup, and refuse to guess when Excel breaks an account number.
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#0071E3', marginTop: 16 }}>Upload &amp; build →</div>
            </div>
          </Link>

          {/* Past Reports */}
          <div style={{ ...GLASS, borderRadius: 24, padding: 26 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <div style={{ fontSize: 19, fontWeight: 700, letterSpacing: '-.01em' }}>Past Reports</div>
              {dates.length > 0 && <Link href="/dashboard" style={{ fontSize: 12.5, fontWeight: 600, color: '#0071E3', textDecoration: 'none' }}>Open latest →</Link>}
            </div>
            <div style={{ fontSize: 13, color: ink(.52), margin: '5px 0 14px' }}>
              {dates.length ? `${dates.length} report ${dates.length === 1 ? 'day' : 'days'} · nothing is ever overwritten` : 'No reports yet'}
            </div>

            {dates.length === 0 ? (
              <div style={{ fontSize: 13.5, color: ink(.45), padding: '14px 0' }}>Upload your first CSV to see it here.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {dates.slice(0, 3).map((d) => {
                  const isConfirm = confirmDate === d.date;
                  return (
                    <div key={d.date} className="hover-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '11px 12px 11px 16px', borderRadius: 999, background: ink(.04), border: '1px solid ' + (isConfirm ? 'rgba(255,59,48,.3)' : ink(.06)) }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap' }}>{d.display}</div>
                        <div style={{ fontSize: 11, color: ink(.5), whiteSpace: 'nowrap' }}>
                          {isConfirm ? 'Delete this report permanently?' : `${fmtInt(d.rowCount)} accounts · ${d.uploads.length} upload${d.uploads.length === 1 ? '' : 's'}`}
                        </div>
                      </div>

                      {isConfirm ? (
                        <div style={{ display: 'flex', gap: 6, flex: 'none' }}>
                          <button onClick={() => removeReport(d.date)} disabled={deleting === d.date} style={{ ...BTN, padding: '7px 14px', fontSize: 12, background: '#FF3B30', color: '#fff' }}>
                            {deleting === d.date ? 'Deleting…' : 'Delete'}
                          </button>
                          <button onClick={() => setConfirmDate('')} style={{ ...BTN, padding: '7px 12px', fontSize: 12, background: ink(.08), color: 'var(--text)' }}>Cancel</button>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 'none' }}>
                          <Link href={`/dashboard?date=${d.date}`} style={{ ...BTN, padding: '7px 16px', fontSize: 12, background: '#0071E3', color: '#fff', textDecoration: 'none', display: 'inline-block' }}>Open</Link>
                          <button onClick={() => setConfirmDate(d.date)} title="Delete report" aria-label="Delete report"
                            style={{ ...BTN, width: 30, height: 30, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: ink(.06), color: ink(.45), padding: 0 }}>
                            <Trash />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {dates.length > 0 && (
              <Link href="/reports" style={{ ...BTN, display: 'block', textAlign: 'center', marginTop: 12, padding: '11px 18px', fontSize: 12.5, background: ink(.06), color: 'var(--text)', textDecoration: 'none' }}>
                {dates.length > 3 ? `View all ${dates.length} reports →` : 'View all reports →'}
              </Link>
            )}
          </div>
        </div>

        <div style={{ textAlign: 'center', fontSize: 11.5, color: ink(.38), marginTop: 24 }}>
          Recovered value counts the full outstanding on every resolved account. Confidential to RBL Bank and Convin.
        </div>
      </div>
    </div>
  );
}
