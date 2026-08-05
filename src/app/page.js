'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { withBase } from '../lib/basepath.mjs';
import {
  C, T, Card, Glass, Overline, Capsule, Field, SignalDot, Hairline,
  fmtInt,
} from './aurum';

/* ═══════════════════════════════════════════════════════════════════════════════
 * SIGN IN · and the hub.
 *
 * Two screens, one grammar. The sign-in is the first frame of the product and the
 * only one where the metal appears at Colossus scale — after this the budget is
 * spent and the interface is titanium the rest of the way down.
 * ═══════════════════════════════════════════════════════════════════════════════ */

const Trash = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
  </svg>
);

/** The identity lockup. Metal on obsidian is the primary; it is the one metal object
 *  on the screen, so nothing else here may wear it. */
function Lockup({ compact = false }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{
        width: compact ? 30 : 34, height: compact ? 30 : 34,
        borderRadius: 'calc(var(--radius-sm) * 1.08)',
        background: 'var(--metal-aurum)',
        boxShadow: 'var(--e2)',
        flex: 'none',
      }} />
      <div style={{ lineHeight: 1.2 }}>
        <div style={{ ...T.subhead, fontWeight: 600, color: C.primary, whiteSpace: 'nowrap' }}>Recovery Intelligence</div>
        <div style={{ ...T.caption, color: C.tertiary, whiteSpace: 'nowrap' }}>Convin × RBL Bank</div>
      </div>
    </div>
  );
}

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
    const r = await fetch(withBase('/api/data'));
    if (r.status !== 200) { setAuthed(false); return; }
    const [man, me] = await Promise.all([r.json(), fetch(withBase('/api/me')).then((x) => (x.ok ? x.json() : { name: '' }))]);
    setManifest(man); setName(me.name || ''); setAuthed(true);
  };
  useEffect(() => { (async () => { try { await load(); } catch { setAuthed(false); } })(); }, []);

  const login = async (e) => {
    e.preventDefault(); setAuthError(''); setBusy(true);
    try {
      const r = await fetch(withBase('/api/auth'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
      if (r.ok) await load(); else setAuthError((await r.json()).error || 'That username and password do not match.');
    } catch { setAuthError('The server did not answer. Check the connection and try again.'); } finally { setBusy(false); }
  };
  const logout = async () => { try { await fetch(withBase('/api/auth')); setAuthed(false); setManifest(null); setName(''); setUsername(''); setPassword(''); } catch {} };

  const removeReport = async (date) => {
    setDeleting(date);
    try {
      await fetch(withBase(`/api/report?date=${encodeURIComponent(date)}`), { method: 'DELETE' });
      setConfirmDate('');
      await load();
    } catch {} finally { setDeleting(''); }
  };

  if (authed === null) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.tertiary, ...T.callout }}>
        Loading
      </div>
    );
  }

  /* ══════════════════════ SIGN IN ══════════════════════ */
  if (!authed) return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 'clamp(96px, 12vh, 120px) 24px 48px', position: 'relative', zIndex: 1,
    }}>
      <Glass className="island" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '9px 20px 9px 10px' }}>
        <Lockup compact />
        <span style={{ width: 1, height: 20, background: C.hairline, flex: 'none' }} />
        {/* Signal carries a word as well as a hue — never colour alone. */}
        <span style={{ display: 'flex', alignItems: 'center', gap: 7, ...T.caption, color: C.tertiary, whiteSpace: 'nowrap' }}>
          <SignalDot tone={C.nominal} size={6} pulse />Secure
        </span>
      </Glass>

      <div style={{
        width: '100%', maxWidth: 1140,
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
        gap: 'clamp(40px, 5vw, 72px)', alignItems: 'center',
      }}>
        <div className="u-rise">
          <Overline style={{ marginBottom: 20 }}>The open book</Overline>
          {/* THE HEADLINE IS NOT METAL, and that was a decision, not an omission.
              It was — and it looked superb — but it put three metal objects on one
              screen: the mark, the headline and the Sign-in capsule. AURUM's own
              application sheet shows the pattern this screen should follow: the MARK
              wears the metal, the PRIMARY ACTION wears the metal, and the title is
              plain titanium. Two metal objects, both of them things you can point at.
              A headline in metal makes a third, and the third one costs the first two
              half their value. */}
          <h1 style={{ margin: 0, maxWidth: 640 }}>
            <span style={{ ...T.display1, color: C.quaternary, display: 'block' }}>The money is still</span>
            <span style={{ ...T.display1, color: C.primary, display: 'block' }}>on the table.</span>
          </h1>
          <p style={{ ...T.body, color: C.secondary, maxWidth: 520, margin: '28px 0 0' }}>
            Most of the book does not close on the first call. What is left is not a dead list — it is a ranked
            one. The customers who promised. The ones who stayed on the line for 4 minutes. The ones who say
            they have already paid. Every day nobody works them, they get colder.
          </p>
        </div>

        <Card
          className="u-squircle-xl"
          style={{ padding: 'clamp(32px, 4vh, 40px)', maxWidth: 430, width: '100%', justifySelf: 'end', animation: 'cardIn var(--dur-enter) var(--ease-enter) both .12s' }}
          elevation={3}
        >
          <div style={{ ...T.title2, color: C.primary, marginBottom: 6 }}>Sign in</div>
          <div style={{ ...T.subhead, color: C.tertiary, marginBottom: 28 }}>Authorised users only.</div>

          <form onSubmit={login} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label="Username" type="text" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
            <Field label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />

            {/* Never apologise, never blame. Name the state and the cause. */}
            {authError && (
              <div role="alert" style={{ display: 'flex', gap: 9, alignItems: 'flex-start', ...T.footnote, color: C.abort, padding: '2px 4px' }}>
                <SignalDot tone={C.abort} size={6} style={{ marginTop: 6 }} />
                <span>{authError}</span>
              </div>
            )}

            <Capsule type="submit" variant="metal" size="l" full disabled={busy} style={{ marginTop: 8 }}>
              {busy ? 'Signing in' : 'Sign in'}
            </Capsule>
          </form>

          <Hairline style={{ margin: '26px 0 16px' }} />
          <div style={{ ...T.caption, color: C.tertiary, textAlign: 'center', lineHeight: 1.7 }}>
            Confidential to RBL Bank and Convin.<br />Sessions expire after 7 days.
          </div>
        </Card>
      </div>
    </div>
  );

  /* ══════════════════════ HUB ══════════════════════ */
  const dates = (manifest && manifest.dates) || [];

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px 24px', position: 'relative', zIndex: 1 }}>
      <div className="u-rise" style={{ width: '100%', maxWidth: 1020 }}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 32 }}>
          <Lockup />
          <Capsule variant="plain" size="s" onClick={logout} style={{ color: C.tertiary }}>Log out</Capsule>
        </div>

        <h1 style={{ ...T.title1, color: C.primary, margin: '0 0 10px' }}>Hi, {name || 'there'}</h1>
        <p style={{ ...T.body, color: C.secondary, margin: '0 0 32px', maxWidth: 680 }}>
          The AI has already worked the book. This is where that work becomes something you can put in front of
          a board — and <strong style={{ color: C.primary, fontWeight: 600 }}>defend, line by line</strong>.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, alignItems: 'stretch' }}>

          {/* Upload — the primary action, and the only Aurum on this screen. */}
          <Link href="/upload" style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
            <Card style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
              <div className="u-squircle-sm" style={{
                width: 44, height: 44, background: C.accentFill, color: C.onAccent,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                ...T.title3, fontWeight: 400, boxShadow: 'var(--e2)',
              }}>↑</div>
              <div style={{ ...T.title3, color: C.primary, marginTop: 20 }}>Upload a new report</div>
              <div style={{ ...T.subhead, color: C.tertiary, marginTop: 8, lineHeight: 1.6, flex: 1 }}>
                Three files in, one dashboard out. We do the lookup, roll up 18,883 call attempts onto the book,
                and refuse to guess when Excel has broken an account number.
              </div>
              <div style={{ ...T.footnote, fontWeight: 600, color: C.secondary, marginTop: 20 }}>Upload and build →</div>
            </Card>
          </Link>

          {/* Archive */}
          <Card style={{ height: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ ...T.title3, color: C.primary }}>Past reports</div>
              {dates.length > 0 && (
                <Link href="/dashboard" style={{ ...T.footnote, fontWeight: 600, color: C.secondary, textDecoration: 'none', whiteSpace: 'nowrap' }}>
                  Open latest →
                </Link>
              )}
            </div>
            <div style={{ ...T.caption, color: C.tertiary, margin: '6px 0 18px' }}>
              {dates.length
                ? `${dates.length} report ${dates.length === 1 ? 'date' : 'dates'} · nothing is ever overwritten`
                : 'No reports yet'}
            </div>

            {dates.length === 0 ? (
              <div style={{ ...T.subhead, color: C.tertiary, padding: '16px 0' }}>
                Upload your first book to see it here.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {dates.slice(0, 3).map((d) => {
                  const isConfirm = confirmDate === d.date;
                  return (
                    <div key={d.date} className="hover-row" style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                      padding: '10px 10px 10px 18px',
                      borderRadius: 'var(--radius-capsule)',
                      background: C.quiet,
                      border: `1px solid ${isConfirm ? C.bad(0.32) : 'transparent'}`,
                    }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ ...T.subhead, fontWeight: 600, color: C.primary, whiteSpace: 'nowrap' }}>{d.display}</div>
                        <div style={{ ...T.caption, color: isConfirm ? C.abort : C.secondary, whiteSpace: 'nowrap' }}>
                          {isConfirm
                            ? `Delete ${fmtInt(d.rowCount)} accounts and ${d.uploads.length} upload${d.uploads.length === 1 ? '' : 's'}. This cannot be undone.`
                            : `${fmtInt(d.rowCount)} accounts · ${d.uploads.length} upload${d.uploads.length === 1 ? '' : 's'}`}
                        </div>
                      </div>

                      {isConfirm ? (
                        /* Destructive sits ≥ 24 pt from the safe action, and the safe
                           action is on the left. Neither wears metal. */
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

            {dates.length > 0 && (
              <Capsule as={Link} href="/reports" variant="plain" size="s" full style={{ marginTop: 14, color: C.secondary }}>
                {dates.length > 3 ? `View all ${dates.length} reports →` : 'View all reports →'}
              </Capsule>
            )}
          </Card>
        </div>

        <div style={{ ...T.caption, color: C.tertiary, textAlign: 'center', marginTop: 32, lineHeight: 1.7 }}>
          Recovered value counts the full outstanding on every resolved account.
          Confidential to RBL Bank and Convin.
        </div>
      </div>
    </div>
  );
}
