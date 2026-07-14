'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { PAYLOAD_VERSION } from '@/lib/payload_version.mjs';

/* ============================ palette & formatters ============================ */
const C = {
  blue: '#0071E3', green: '#34C759', orange: '#FF9500', red: '#FF3B30',
  purple: '#AF52DE', indigo: '#5856D6', teal: '#30B0C7', pink: '#FF2D55', cyan: '#5AC8FA',
};
/* RBL grades accounts by colour. Paint the bars in the bank's own colours — an exec
   should not have to read a legend to find their red book on our chart. Anything the
   bank invents that isn't a colour falls through to the default palette. */
/* The funnel's internal coordinate width. The SVG scales to its container, so this is
   just the aspect ratio — a wider number means a shallower, more elegant taper. */
const FW = 560;
/* Horizontal gutter inside the funnel's viewBox. The stage labels sit OUTSIDE the vessel
   — resolution rate to the left of each band, drop-off to the right — and a band at 100%
   of the book spans the full width, so those labels land at negative x and at x > FW. If
   the viewBox does not reserve room for them they overflow the SVG and land on whatever
   is next to it. They did: the "-3,613 / 51% lost" callout was printing straight through
   the stage ledger. */
const FUNNEL_PAD = 84;
const SEG_COLOR = { red: '#FF3B30', amber: '#FF9500', green: '#34C759', yellow: '#FFCC00', blue: '#0071E3' };
/* ── ink() vs txt() ────────────────────────────────────────────────────────────
 *
 * ink(a) is the raw colour. It is used for TWO completely different jobs, and that is
 * why the labels became unreadable:
 *
 *   hairlines, dividers, fills   →  alpha .03 – .22   (must stay faint)
 *   TEXT                         →  alpha .35 – .92   (must be legible)
 *
 * The text end had drifted far too light. Seventy-odd labels sat at .4 – .5, which on
 * white renders around #A8A8A9 — a contrast ratio of roughly 2.5:1, against the 4.5:1
 * that WCAG AA requires for body text. Fine on a Retina display in a dark room;
 * genuinely unreadable on a projector, on a printout, or to anyone over forty. This is
 * going in front of a bank's exec committee.
 *
 * So text gets its own function, which remaps the alpha onto a legible range while
 * preserving the ORDER — a caption is still quieter than a heading, it is simply no
 * longer invisible:
 *
 *      txt(.40)  →  .75   (#555 on white, 7.4:1 — was 2.5:1)
 *      txt(.45)  →  .78
 *      txt(.50)  →  .80
 *      txt(.72)  →  .91
 *
 * Nothing below TEXT_FLOOR is reachable, so no label can ever go faint again — the
 * floor is enforced here, once, rather than trusted to 130 call sites.
 *
 * A note on "Black Titanium": it is a physical iPhone finish, not a UI colour. As hex
 * it is ~#3C3C3D, which is LIGHTER than the #1D1D1F below — using it for text would
 * reduce contrast, which is the opposite of the goal. The base stays Apple's true
 * label black; --ink in globals.css is the one knob if that ever needs revisiting.
 * ───────────────────────────────────────────────────────────────────────────── */
const TEXT_FLOOR = 0.66;                       // ≈ 5.6:1 on white — WCAG AA for body text
const textAlpha = (a) => {
  if (a >= 0.92) return 1;
  const t = Math.min(1, Math.max(0, (a - 0.2) / (0.92 - 0.2)));
  return +(TEXT_FLOOR + t * (1 - TEXT_FLOOR)).toFixed(3);
};
/** Hairlines, dividers, fills. Unchanged — darkening these would wreck the design. */
const ink = (a) => `rgba(var(--ink,29,29,31),${a})`;
/** TEXT. Same colour, legible alpha. Use this anywhere a human has to read words. */
const txt = (a) => `rgba(var(--ink,29,29,31),${textAlpha(a)})`;

/* Duration × L2 heat table. */
const mmss = (s) => {
  const t = Math.round(s || 0);
  return t < 60 ? `${t}s` : `${Math.floor(t / 60)}m ${String(t % 60).padStart(2, '0')}s`;
};
/* Heat intensity, floored so a low-but-real rate is still legible rather than white,
   and capped so nothing is a solid slab of colour with unreadable text on top. */
const heatAlpha = (p) => {
  const a = 0.16 + Math.min(1, Math.max(0, (p || 0) / 100)) * 0.44;
  return Math.round(a * 255).toString(16).padStart(2, '0');
};
const l2Th = (align, w) => ({
  padding: '9px 10px', textAlign: align, width: w, fontSize: 11,
  fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em',
  color: txt(.45), whiteSpace: 'nowrap',
});
const arrowBtn = (disabled) => ({ border: 'none', background: disabled ? 'transparent' : ink(.05), color: disabled ? ink(.2) : 'var(--text,#1D1D1F)', cursor: disabled ? 'default' : 'pointer', width: 30, height: 30, borderRadius: '50%', fontSize: 18, lineHeight: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' });

// Theme tokens live in globals.css (:root / html.dark). The toggle below just
// flips the class on <html>, so every page + the body theme together.

const fmtCr = (n) => {
  const s = n < 0 ? '-' : ''; const a = Math.abs(n || 0);
  if (a >= 1e7) return s + '₹' + (a / 1e7).toFixed(2) + ' Cr';
  if (a >= 1e5) return s + '₹' + (a / 1e5).toFixed(2) + ' L';
  if (a >= 1e3) return s + '₹' + (a / 1e3).toFixed(1) + 'K';
  return s + '₹' + Math.round(a);
};
const fmtINR = (n) => '₹' + Math.round(n || 0).toLocaleString('en-IN');
const fmtInt = (n) => Math.round(n || 0).toLocaleString('en-IN');
const pct = (n, d = 1) => (n || 0).toFixed(d) + '%';
/** "2026-07-07" -> "7 July". Dates only ever come from dateOnly() in normalize.mjs,
    so they are always YYYY-MM-DD — parsed by hand rather than via new Date(), which
    would read them as UTC and print the wrong day west of Greenwich. */
/** Tab label for one upload. These are stored in the manifest, and every report filed
    before this rename still says "Upload 1". `npm run rebuild` migrates them properly,
    but the UI must not depend on that having been run — a report whose tab says
    "Upload 3" while the upload screen says "Day 3" is the kind of small inconsistency
    that makes someone distrust the big numbers. So we rename on read as well. */
const dayLabel = (u) => String(u?.label || '').replace(/^Upload\b/i, 'Day') || 'Day';

/* The Summary tab is not a batch. It spans every report date, so it has no batch id —
   this sentinel stands in for one, and can never collide with a real id (those are all
   "YYYY-MM-DD__…"). */
const SUMMARY_ID = '__summary';
const fmtDay = (iso) => {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso || '—';
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
};

/* ============================ shared styles ============================ */
const GLASS = {
  background: 'var(--glass-bg, linear-gradient(180deg, rgba(255,255,255,.82), rgba(255,255,255,.5)))',
  border: '1px solid var(--glass-border, rgba(255,255,255,.9))',
  backdropFilter: 'blur(36px) saturate(180%)',
  WebkitBackdropFilter: 'blur(36px) saturate(180%)',
  boxShadow: 'var(--glass-shadow, 0 1px 0 rgba(255,255,255,.9) inset, 0 20px 40px -22px rgba(29,29,31,.16))',
};

/* ============================ small components ============================ */
function Card({ span = 12, children, style = {}, className = '' }) {
  // `card` is what the print stylesheet keys off to stop a chart being sliced
  // in half across a page break.
  return (
    <div className={`hover-kpi card ${className}`.trim()} style={{ gridColumn: `span ${span}`, ...GLASS, borderRadius: 24, padding: 26, ...style }}>
      {children}
    </div>
  );
}
function Title({ t, s }) {
  return (
    <>
      <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text,#1D1D1F)' }}>{t}</div>
      {s && <div style={{ fontSize: 12.5, color: txt(.48), marginTop: 2, marginBottom: 18 }}>{s}</div>}
    </>
  );
}
function Bar({ label, right, pctv, color, sub }) {
  return (
    <div style={{ marginBottom: 13 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}>
        <span style={{ color: txt(.68) }}>{label}</span>
        <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: 'var(--text,#1D1D1F)' }}>{right}</span>
      </div>
      <div style={{ height: 10, borderRadius: 6, background: ink(.07), overflow: 'hidden' }}>
        <div style={{ height: '100%', borderRadius: 6, width: `${Math.max(1.5, pctv)}%`, background: color, transition: 'width 1.1s cubic-bezier(.32,.72,0,1)' }} />
      </div>
      {sub && <div style={{ fontSize: 11.5, color: txt(.42), marginTop: 4 }}>{sub}</div>}
    </div>
  );
}


/* ═══════════════ MANAGE LINKS ═══════════════
   Every live link is a door into a bank's customer list with no lock on it. This is the
   only place those doors can be shut, so it has to answer, at a glance, the questions you
   would actually ask before shutting one:

     · who did I give it to?
     · has anybody actually opened it? when?
     · which report does it point at?

   A revoked link stays on the list, greyed. Vanishing it would leave you wondering whether
   you revoked it or imagined it. */
function ManageLinks({ links, busy, revoking, copiedToken, onRevoke, onCopy, onRefresh, onClose }) {
  const fmtWhen = (iso) => {
    if (!iso) return null;
    const d = new Date(iso);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
      + ' · ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  };

  if (busy && !links) {
    return <div style={{ padding: '30px 0', textAlign: 'center', fontSize: 13.5, color: txt(.5) }}>Loading links…</div>;
  }

  const live = (links || []).filter((l) => !l.revoked);
  const dead = (links || []).filter((l) => l.revoked);

  if (!links || !links.length) {
    return (
      <>
        <div style={{ padding: '34px 0', textAlign: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: txt(.7), marginBottom: 6 }}>No links yet</div>
          <div style={{ fontSize: 13, color: txt(.45), lineHeight: 1.6 }}>
            Create one on the <b>New link</b> tab. Anything you issue will appear here, and this
            is where you take it back.
          </div>
        </div>
        <button onClick={onClose} style={{
          width: '100%', padding: '11px 18px', borderRadius: 999, border: 'none', cursor: 'pointer',
          background: ink(.07), color: 'var(--text)', fontSize: 13.5, fontWeight: 600,
        }}>Close</button>
      </>
    );
  }

  const row = (l) => {
    const expired = l.expires_at && new Date(l.expires_at) < new Date();
    const dead_ = l.revoked || expired;
    const views = Number(l.views || 0);
    return (
      <div key={l.token} style={{
        padding: '13px 14px', borderRadius: 14, marginBottom: 8,
        background: dead_ ? 'transparent' : ink(.03),
        border: `1px solid ${dead_ ? ink(.06) : ink(.08)}`,
        opacity: dead_ ? 0.55 : 1,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: txt(.9), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {l.label || <span style={{ color: txt(.45), fontWeight: 500 }}>(no recipient named)</span>}
              {l.revoked && <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: '#C9302C' }}>REVOKED</span>}
              {!l.revoked && expired && <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: '#b7791f' }}>EXPIRED</span>}
            </div>
            <div style={{ fontSize: 11.5, color: txt(.45), marginTop: 3 }}>
              {l.report_date || l.reportDate}
              {' · '}
              {/* The number that decides whether revoking costs anyone anything. */}
              {views === 0
                ? <span style={{ color: txt(.4) }}>never opened</span>
                : <b style={{ color: '#248A3D' }}>{views} view{views === 1 ? '' : 's'}</b>}
              {l.last_viewed_at && <> · last {fmtWhen(l.last_viewed_at)}</>}
              {!l.expires_at && !l.revoked && <> · no expiry</>}
            </div>
          </div>

          {!dead_ && (
            <div style={{ display: 'flex', gap: 6, flex: 'none' }}>
              <button onClick={() => onCopy(l.token)} style={{
                padding: '7px 13px', borderRadius: 999, border: 'none', cursor: 'pointer',
                background: copiedToken === l.token ? 'rgba(52,199,89,.16)' : ink(.07),
                color: copiedToken === l.token ? '#248A3D' : 'var(--text)',
                fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
              }}>{copiedToken === l.token ? 'Copied ✓' : 'Copy'}</button>

              <button onClick={() => onRevoke(l.token, l.label)} disabled={revoking === l.token} style={{
                padding: '7px 13px', borderRadius: 999, border: 'none',
                cursor: revoking === l.token ? 'default' : 'pointer',
                background: 'rgba(255,59,48,.1)', color: '#FF3B30',
                fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
                opacity: revoking === l.token ? 0.5 : 1,
              }}>{revoking === l.token ? 'Revoking…' : 'Revoke'}</button>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      <div style={{ maxHeight: 320, overflowY: 'auto', margin: '0 -4px', padding: '0 4px' }}>
        {live.map(row)}
        {dead.length > 0 && (
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: txt(.35), margin: '14px 0 8px' }}>
            Revoked &amp; expired
          </div>
        )}
        {dead.map(row)}
      </div>

      <div style={{ fontSize: 11.5, color: txt(.42), marginTop: 12, lineHeight: 1.6 }}>
        Revoking is immediate and permanent. Anyone holding the link — including in an email
        already sent — will see &ldquo;This link is no longer available&rdquo;.
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
        <button onClick={onRefresh} disabled={busy} style={{
          padding: '11px 18px', borderRadius: 999, border: 'none', cursor: 'pointer',
          background: ink(.07), color: 'var(--text)', fontSize: 13.5, fontWeight: 600,
        }}>{busy ? 'Refreshing…' : 'Refresh'}</button>
        <button onClick={onClose} style={{
          flex: 1, padding: '11px 18px', borderRadius: 999, border: 'none', cursor: 'pointer',
          background: '#0071E3', color: '#fff', fontSize: 13.5, fontWeight: 600,
        }}>Done</button>
      </div>
    </>
  );
}

/* ═══════════════════════════ CAMPAIGN SUMMARY ═══════════════════════════
 *
 * Every report date, in one view: where the campaign stands, what is working, and what
 * to work next.
 *
 * THE ONE THING TO KNOW BEFORE CHANGING ANYTHING HERE.
 * The headline is a UNION of accounts across every date — not a sum of the days. Each
 * report date is a re-pull of the SAME book (one CYC file, a later status file), so
 * adding "recovered" across five dates reports five times the money. It is
 * arithmetically defensible, visually plausible, and completely false, and it is the
 * number an exec repeats out loud. The union happens in backend.mjs; everything here
 * just renders it. Do not "helpfully" total the trend column.
 * ══════════════════════════════════════════════════════════════════════════ */
function SummaryView({ s }) {
  if (!s) {
    return (
      <div style={{ padding: '80px 0', textAlign: 'center', color: txt(.45), fontSize: 14 }}>
        Building the campaign summary…
      </div>
    );
  }
  if (s.error || !s.campaign) {
    return (
      <div style={{ padding: '60px 0', textAlign: 'center', color: txt(.5), fontSize: 14 }}>
        {s.error || 'No reports have been uploaded for this date, so there is nothing to summarise.'}
      </div>
    );
  }

  const A = s.campaign.agg;
  const t = A.totals;
  const m = s.movement;
  const multi = s.trend.length > 1;

  const head = [
    { l: 'Recovered Amount', v: fmtCr(t.recovered), s: `${pct(t.recoveryRatePct, 1)} of outstanding`, c: C.green },
    { l: 'Accounts Resolved', v: fmtInt(t.resolved), s: `${pct(t.resolutionRatePct, 1)} of ${fmtInt(t.accounts)}`, c: C.blue },
    { l: 'Outstanding Amount', v: fmtCr(t.sumOut), s: `${fmtInt(t.accounts)} accounts`, c: C.indigo },
    { l: 'Still Open', v: fmtCr(t.outstandingPending), s: `${fmtInt(t.unresolved)} accounts`, c: C.orange },
  ];

  return (
    <div style={{ paddingTop: 8 }}>
      {/* ── Hero ── */}
      <div style={{ padding: '44px 0 30px' }}>
        <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.12em', color: C.blue, textTransform: 'uppercase', marginBottom: 14 }}>
          Summary &nbsp;·&nbsp; {s.display || s.date}
        </div>
        <h1 className="print-solid-text" style={{ fontSize: 48, lineHeight: 1.06, fontWeight: 700, letterSpacing: '-.03em', margin: '0 0 16px', maxWidth: 900, background: 'linear-gradient(120deg,#34C759 0%,#0071E3 55%,#5856D6 100%)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>
          {fmtCr(t.recovered)} recovered{multi ? ` across ${s.trend.length} days` : ''}.
        </h1>
        <p style={{ fontSize: 17, lineHeight: 1.55, color: txt(.6), maxWidth: 760, margin: 0 }}>
          {fmtInt(t.accounts)} accounts holding {fmtCr(t.sumOut)} — {fmtInt(t.resolved)} resolved ({pct(t.resolutionRatePct)}),
          {' '}{fmtCr(t.outstandingPending)} still open across {fmtInt(t.unresolved)} accounts.
          {multi && (
            <>
              {' '}This is the <b>Day Total</b> for {s.display} — every Day below reads the <b>same book</b> against a
              later status file, so the accounts never change and the money is counted <b>once</b>.
            </>
          )}
        </p>
      </div>

      {/* ── Carry-over ──────────────────────────────────────────────────────────
          Accounts worked on an earlier date that are NOT in the current book — the
          previous cycle, if a new one has started.

          Shown BESIDE the headline, never inside it. Folding these into "total
          outstanding" would make the number grow every time a new cycle arrives, which
          is exactly the thing an exec would (rightly) call wrong: outstanding means
          "what is on the book", and the book is the current one.

          Zero when every date is a re-read of the same cycle — which is the normal
          case, and then this does not render at all. */}
      {s.carry && (
        <Card span={12} style={{ marginBottom: 16 }}>
          <Title
            t="Earlier cycles — not in the current book"
            s="Worked on a previous report date, and deliberately NOT added to the totals above"
          />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 28, alignItems: 'baseline', marginTop: 2 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: txt(.45), marginBottom: 5 }}>Accounts</div>
              <div style={{ fontSize: 22, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtInt(s.carry.accounts)}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: txt(.45), marginBottom: 5 }}>Their outstanding</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: C.orange, fontVariantNumeric: 'tabular-nums' }}>{fmtCr(s.carry.outstanding)}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: txt(.45), marginBottom: 5 }}>Recovered from them</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: C.green, fontVariantNumeric: 'tabular-nums' }}>{fmtCr(s.carry.recovered)}</div>
            </div>
          </div>
          <div style={{ fontSize: 12, color: txt(.5), lineHeight: 1.6, marginTop: 14 }}>
            These accounts appear on {s.carry.dates.map((d) => d.display).join(', ')} but not in the current book.
            They are <b>not</b> included in the totals above — outstanding is what is on the book today, and adding a
            previous cycle to it would inflate the figure every time RBL sends a new one.
          </div>
        </Card>
      )}

      {/* ── Headline ──────────────────────────────────────────────────────────────
          A PLAIN div, not <Card>. Card sets `gridColumn: span 12`, which overrode the
          4-column grid and made every card full width — four stacked banners instead of
          a row. Same markup as the KPI row on the report page, so the two pages look
          like one product rather than two. */}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${head.length},1fr)`, gap: 16, marginBottom: 16 }}>
        {head.map((k, i) => (
          <div className="hover-kpi" key={i} style={{ ...GLASS, borderRadius: 22, padding: '22px 20px', animation: 'fadeUp .7s cubic-bezier(.32,.72,0,1) both' }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: k.c, marginBottom: 14, boxShadow: `0 0 12px ${k.c}` }} />
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: txt(.5), marginBottom: 8 }}>{k.l}</div>
            <div style={{ fontSize: 27, fontWeight: 700, letterSpacing: '-.02em', fontVariantNumeric: 'tabular-nums', marginBottom: 6 }}>{k.v}</div>
            <div style={{ fontSize: 12.5, color: txt(.48) }}>{k.s}</div>
          </div>
        ))}
      </div>

      {/* ── Movement. Only shown when there is more than one read of the SAME book —
             otherwise "recovery went up ₹20 Cr" would be measuring a different book. ── */}
      {m && (
        <Card span={12} style={{ marginBottom: 16 }}>
          <Title t="Movement" s={`How the book changed between ${m.from} and ${m.to}`} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 20, marginTop: 4 }}>
            {[
              { l: 'Recovered', v: `${m.recovered >= 0 ? '+' : '−'}${fmtCr(Math.abs(m.recovered))}`, c: m.recovered >= 0 ? C.green : '#C9302C' },
              { l: 'Accounts resolved', v: `${m.resolved >= 0 ? '+' : '−'}${fmtInt(Math.abs(m.resolved))}`, c: m.resolved >= 0 ? C.green : '#C9302C' },
              { l: 'Resolution rate', v: `${m.resolutionPts >= 0 ? '+' : '−'}${Math.abs(m.resolutionPts).toFixed(1)} pts`, c: m.resolutionPts >= 0 ? C.green : '#C9302C' },
            ].map((x, i) => (
              <div key={i}>
                <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: txt(.45), marginBottom: 6 }}>{x.l}</div>
                <div style={{ fontSize: 26, fontWeight: 700, color: x.c, fontVariantNumeric: 'tabular-nums' }}>{x.v}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ── The trend. One row per report date. ── */}
      {multi && (
        <Card span={12} className="print-breakable" style={{ marginBottom: 16 }}>
          <Title t="Every day, in order" s="Each Day re-reads the same book against a later status file — this is progress, not new money" />
          <div className="table-scroll" style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  {['Day', 'Accounts', 'Outstanding', 'Recovered', 'Resolved', 'Resolution', 'Change'].map((h, i) => (
                    <th key={h} style={{ textAlign: i ? 'right' : 'left', padding: '9px 12px', fontSize: 10.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: txt(.45), borderBottom: `1px solid ${ink(.1)}`, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {s.trend.map((d, i) => (
                  <tr key={d.id}>
                    <td style={{ padding: '11px 12px', borderBottom: `1px solid ${ink(.06)}`, fontWeight: 600 }}>{d.label}</td>
                    <td style={{ padding: '11px 12px', borderBottom: `1px solid ${ink(.06)}`, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtInt(d.accounts)}</td>
                    <td style={{ padding: '11px 12px', borderBottom: `1px solid ${ink(.06)}`, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtCr(d.outstanding)}</td>
                    <td style={{ padding: '11px 12px', borderBottom: `1px solid ${ink(.06)}`, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: C.green }}>{fmtCr(d.recovered)}</td>
                    <td style={{ padding: '11px 12px', borderBottom: `1px solid ${ink(.06)}`, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtInt(d.resolved)}</td>
                    <td style={{ padding: '11px 12px', borderBottom: `1px solid ${ink(.06)}`, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{pct(d.resolutionPct, 1)}</td>
                    <td style={{ padding: '11px 12px', borderBottom: `1px solid ${ink(.06)}`, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: d.recoveredDelta > 0 ? C.green : ink(.35) }}>
                      {i === 0 ? '—' : d.sameBook === false ? 'different book' : d.recoveredDelta ? `+${fmtCr(d.recoveredDelta)}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 11.5, color: txt(.42), marginTop: 10, lineHeight: 1.6 }}>
            <b>These rows do not add up, and must not be added up.</b> Every Day re-reads the <b>same</b> accounts
            against a later status file — a customer who paid on the 4th is still resolved on the 8th. The headline
            above is the <b>Day Total</b>: each account counted once, at its most recent outcome. Adding the Days
            together would report the money {s.trend.length} times over.
          </div>
        </Card>
      )}

      {/* ── What's working, what isn't ── */}
      {s.findings?.length > 0 && (
        <Card span={12} className="print-breakable" style={{ marginBottom: 16 }}>
          <Title t="What's working, and what isn't" s="Every line below is computed from the book — none of it is asserted" />
          <div style={{ display: 'grid', gap: 10, marginTop: 4 }}>
            {s.findings.map((f, i) => (
              <div key={i} style={{
                display: 'flex', gap: 14, alignItems: 'flex-start', padding: '13px 16px', borderRadius: 12,
                background: f.kind === 'good' ? 'rgba(52,199,89,.07)' : 'rgba(255,149,0,.07)',
                border: `1px solid ${f.kind === 'good' ? 'rgba(52,199,89,.22)' : 'rgba(255,149,0,.22)'}`,
              }}>
                <div style={{ flex: 'none', width: 74, fontSize: 16, fontWeight: 700, color: f.kind === 'good' ? '#248A3D' : '#B7791F', fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>
                  {f.value}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 3 }}>{f.label}</div>
                  <div style={{ fontSize: 12.5, color: txt(.62), lineHeight: 1.6 }}>{f.detail}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ── The work queue ── */}
      <Card span={12} className="print-breakable" style={{ marginBottom: 16 }}>
        <Title t="What to work next" s="The open book, ranked by what it is worth — a queue, not an observation" />
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, margin: '2px 0 18px' }}>
          <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: '-.02em', color: C.orange, fontVariantNumeric: 'tabular-nums' }}>
            {fmtCr(s.openAmount)}
          </div>
          <div style={{ fontSize: 13.5, color: txt(.55) }}>still outstanding across {fmtInt(s.openAccounts)} open accounts</div>
        </div>
        {s.actions.map((a, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '13px 0', borderTop: `1px solid ${ink(.08)}` }}>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>{a.label}</div>
              <div style={{ fontSize: 12, color: txt(.45), marginTop: 2 }}>{a.note} · {fmtInt(a.count)} accounts</div>
            </div>
            <div style={{ fontSize: 17, fontWeight: 700, color: C.indigo, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{fmtCr(a.amount)}</div>
          </div>
        ))}
        {!s.actions.length && (
          <div style={{ fontSize: 13, color: txt(.45), paddingTop: 8 }}>Nothing left in the open book to prioritise.</div>
        )}
      </Card>

      <div style={{ textAlign: 'center', fontSize: 12, color: txt(.4), marginTop: 40, lineHeight: 1.7 }}>
        Convin × RBL Bank · Summary · {s.display} · {s.trend.length} day{s.trend.length === 1 ? '' : 's'} ·
        {' '}Each account counted once, at its most recent outcome.
      </div>
    </div>
  );
}

/* ============================ report ============================
   One component, two doors.

     shareToken = null   →  the internal dashboard. Session cookie, date navigator,
                            upload tabs, Account Explorer, print button.

     shareToken = "..."  →  a PRIVATE SHARE LINK. No cookie, no login, no navigation
                            off this one report. Names in the Top-20 arrive already
                            masked from the server, and the Account Explorer is not
                            rendered — so the holder of the link cannot reach a single
                            customer's name, mobile or account number.

   The two doors share the same body on purpose. A separate "export" template is how
   you end up with a shared report that quietly disagrees with the one you rehearsed. */
export default function Report({ shareToken = null }) {
  const [share, setShare] = useState(null);          // { label, expiresAt } when shared
  const [shareErr, setShareErr] = useState(null);
  const [authed, setAuthed] = useState(null);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [manifest, setManifest] = useState(null);
  const [dateIdx, setDateIdx] = useState(0);
  const [batchId, setBatchId] = useState(null);
  const [switching, setSwitching] = useState(false);
  const [shareTabs, setShareTabs] = useState([]);
  const [summary, setSummary] = useState(null);   // { date, data } for the selected report date
  const [theme, setTheme] = useState('light');
  const [name, setName] = useState('');

  // explorer
  const [q, setQ] = useState('');
  const [fStatus, setFStatus] = useState('All');
  const [fRegion, setFRegion] = useState('All');
  const [fBand, setFBand] = useState('All');
  const [fDisp, setFDisp] = useState('All');
  const [sortKey, setSortKey] = useState('Outstanding');
  const [sortDir, setSortDir] = useState('desc');
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 15;

  const bootShare = async () => {
    const res = await fetch(`/api/share/${shareToken}`);
    if (res.status !== 200) {
      const j = await res.json().catch(() => ({}));
      setShareErr(j.error || 'This link is not valid, or it has expired.');
      setLoading(false);
      return;
    }
    const j = await res.json();
    setShare({ label: j.label, expiresAt: j.expiresAt, display: j.display, date: j.date });
    /* The tabs come from the SERVER, built from the date this link was cut for. The
       client never decides what it is allowed to see — it renders what it was given, and
       every tab click is re-checked server-side. A legacy batch-scoped link sends [] and
       simply gets no tab bar. */
    setShareTabs(Array.isArray(j.tabs) ? j.tabs : []);
    setBatchId(j.batchId || null);
    setData(j.payload);
    setAuthed(true);
    setLoading(false);
  };

  /* Switch tabs inside a shared link. Goes back through the token — there is no session
     here, and /api/batch would (correctly) refuse. The server re-validates the batch id
     against the link's date on every single request; it does not trust that we only ask
     for tabs it previously offered us. */
  const selectShareBatch = async (id) => {
    if (id === batchId) return;
    setSwitching(true);
    try {
      const r = await fetch(`/api/share/${shareToken}?batch=${encodeURIComponent(id)}`);
      if (!r.ok) return;                      // out of scope, revoked, gone — say nothing
      const j = await r.json();
      setData(j.payload); setBatchId(j.batchId);
    } catch { /* leave the current report on screen */ } finally { setSwitching(false); }
  };

  const boot = async () => {
    const res = await fetch('/api/data');
    if (res.status !== 200) { setAuthed(false); return; }
    const man = await res.json();
    if (!man.dates || !man.dates.length) { setManifest(man); setAuthed(true); return; }
    let idx = 0, bid;
    try {
      const sp = new URLSearchParams(window.location.search);
      const qDate = sp.get('date');
      const qBatch = sp.get('batch_id');
      if (qDate) { const i = man.dates.findIndex((d) => d.date === qDate); if (i >= 0) idx = i; }
      if (qBatch) bid = qBatch;
    } catch {}
    if (!bid) bid = man.dates[idx].dayTotal;
    const payload = await fetch(`/api/batch?id=${encodeURIComponent(bid)}`).then((r) => r.json());
    const me = await fetch('/api/me').then((r) => (r.ok ? r.json() : { name: '' })).catch(() => ({ name: '' }));
    setName(me.name || '');
    // Measured, never claimed. If no sweep has been run, the section stays hidden.
    setManifest(man); setDateIdx(idx); setBatchId(bid); setData(payload); setAuthed(true);
  };

  useEffect(() => {
    (async () => {
      try {
        if (shareToken) await bootShare();
        else await boot();
      } catch {
        if (shareToken) setShareErr('This link could not be opened.');
        else setAuthed(false);
      } finally { setLoading(false); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shareToken]);

  // Pick up the theme already applied by the pre-paint script in layout.js.
  useEffect(() => {
    let s; try { s = localStorage.getItem('cvtheme'); } catch {}
    const isDark = s === 'dark' || document.documentElement.classList.contains('dark');
    if (!isDark) return;
    const id = requestAnimationFrame(() => setTheme('dark'));
    return () => cancelAnimationFrame(id);
  }, []);

  // Dark mode = a class on <html>, so the body background themes too.
  useEffect(() => {
    const el = document.documentElement;
    if (theme === 'dark') el.classList.add('dark'); else el.classList.remove('dark');
    try { localStorage.setItem('cvtheme', theme); } catch {}
  }, [theme]);

  /* The campaign summary is a TAB, but it is not a batch — it spans every date, so it
     has no batch id and cannot come from /api/batch. It gets its own fetch and its own
     sentinel id, and `data` (the currently-selected report) is deliberately left alone
     underneath it, so switching back to a day costs nothing. */
  const selectBatch = async (id) => {
    if (id === batchId) return;
    setSwitching(true);
    try {
      if (id === SUMMARY_ID) {
        setBatchId(id);
        await loadSummary(manifest?.dates?.[dateIdx]?.date);
        return;
      }
      const p = await fetch(`/api/batch?id=${encodeURIComponent(id)}`).then((r) => r.json());
      setData(p); setBatchId(id); setPage(0);
    } catch {
      if (id === SUMMARY_ID) setSummary({ error: 'Could not build the summary.' });
    } finally { setSwitching(false); }
  };

  /* The Summary is scoped to ONE report date, and is rebuilt whenever the date changes.
     Cached per date, so flicking between dates is instant after the first look. */
  const loadSummary = async (iso) => {
    if (!iso) return;
    if (summary && summary.date === iso && !summary.error) return;
    try {
      const j = await fetch(`/api/summary?date=${encodeURIComponent(iso)}`).then((r) => r.json());
      setSummary(j.error ? { error: j.error } : j);
    } catch {
      setSummary({ error: 'Could not build the summary.' });
    }
  };
  const gotoDate = async (idx) => {
    if (!manifest || idx < 0 || idx >= manifest.dates.length) return;
    setDateIdx(idx);
    /* If the Summary is open, keep it open — just re-scope it to the new date. Bouncing
       the user back to Day Total every time they change date would be maddening. */
    if (batchId === SUMMARY_ID) {
      setSwitching(true);
      try { await loadSummary(manifest.dates[idx].date); } finally { setSwitching(false); }
      return;
    }
    selectBatch(manifest.dates[idx].dayTotal);
  };

  const logout = async () => { try { await fetch('/api/auth'); window.location.href = '/'; } catch {} };

  /* Print / save as PDF.
     DARK MODE is the one thing that quietly ruins a printed dashboard, and you don't
     find out until you're holding the paper: printing a dark theme gives you a black
     A4 page, or — worse — the browser strips the background and you get white-on-white
     text. So we flip to light for the print and flip back on afterprint, leaving what
     the user sees on screen untouched. */
  /* ── Create a private link to THIS report ──────────────────────────────────────
     One click: a 32-byte token, scoped to this batch, expiring in 7 days. What the
     recipient gets is the same report you are looking at, read-only, with every customer
     name masked and the Account Explorer absent entirely.

     Why this instead of emailing a PDF: a PDF of this report CONTAINS RBL's customers
     (the Top-20 table is real names), it is stale the moment a rupee moves, and once it
     is in an inbox it is forwarded, archived and beyond your reach forever. A link can
     be revoked. A PDF cannot be un-sent.

     The URL is built on the SERVER, not here. Behind a tunnel the browser's origin is
     localhost, and a localhost link in an exec's inbox is a link to nothing. */
  const [shareOpen, setShareOpen] = useState(false);
  const [shareWho, setShareWho] = useState('');
  const [shareDays, setShareDays] = useState(0);      // 0 = never expires
  const [shareBusy, setShareBusy] = useState(false);
  const [shareRes, setShareRes] = useState(null);     // { url, source, expiresAt }
  const [shareErrMsg, setShareErrMsg] = useState('');
  const [copied, setCopied] = useState(false);

  /* ── The link manager ─────────────────────────────────────────────────────────
     Revocation is the ONLY control on these links. They carry real customer names and
     have no login in front of them, and (by choice) most of them never expire. A safety
     net you can only reach by hand-crafting a curl command with a token you have to dig
     out of an old email is not a safety net — it is a story you tell yourself about one.

     So it lives one click from the Share button, and it shows you what you'd actually
     need to decide: who it went to, whether anyone opened it, and when. */
  const [shareTab, setShareTab] = useState('new');    // 'new' | 'manage'
  const [links, setLinks] = useState(null);           // null = not loaded yet
  const [linksBusy, setLinksBusy] = useState(false);
  const [revoking, setRevoking] = useState('');
  const [copiedToken, setCopiedToken] = useState('');

  const loadLinks = async () => {
    setLinksBusy(true);
    try {
      const res = await fetch('/api/share');
      const j = await res.json();
      setLinks(Array.isArray(j.shares) ? j.shares : []);
    } catch {
      setLinks([]);
    } finally {
      setLinksBusy(false);
    }
  };

  const doRevoke = async (token, label) => {
    /* Confirm, and say the consequence out loud. "Are you sure?" is a speed bump; naming
       the person whose access you are about to cut is a decision. */
    const who = label ? `the link issued to "${label}"` : 'this link';
    if (!window.confirm(`Revoke ${who}?\n\nIt stops working immediately. Anyone holding it — including in an email already sent — will see "This link is no longer available". This cannot be undone; you would have to issue a new one.`)) return;
    setRevoking(token);
    try {
      const res = await fetch(`/api/share?token=${encodeURIComponent(token)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Revoke failed');
      // Reflect it locally rather than refetching — instant, and it cannot show a stale row.
      setLinks((prev) => (prev || []).map((l) => (l.token === token ? { ...l, revoked: true } : l)));
    } catch (e) {
      window.alert(`Could not revoke the link.\n\n${e.message}`);
    } finally {
      setRevoking('');
    }
  };

  const copyLink = async (token) => {
    const base = (process.env.NEXT_PUBLIC_BASE_URL || '').replace(/\/+$/, '') || window.location.origin;
    try {
      await navigator.clipboard.writeText(`${base}/r/${token}`);
      setCopiedToken(token);
      setTimeout(() => setCopiedToken(''), 2000);
    } catch { /* clipboard blocked */ }
  };

  const openShare = () => {
    setShareRes(null); setShareErrMsg(''); setCopied(false);
    setShareWho(''); setShareDays(0); setShareTab('new'); setLinks(null); setShareOpen(true);
  };

  const makeShare = async () => {
    if (!batchId || !manifest) return;
    /* A share link is scoped to ONE batch — that is the whole security model: the holder
       cannot navigate to another date. The campaign summary is every date at once, so it
       is not shareable by construction. /api/summary refuses a share token for the same
       reason; this stops the link being created in the first place. */
    if (batchId === SUMMARY_ID) {
      setShareErrMsg('The campaign summary spans every report date, so it cannot be shared as a link. Pick a specific report first — a share link is deliberately scoped to one.');
      return;
    }
    setShareBusy(true); setShareErrMsg('');
    try {
      const res = await fetch('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batchId,
          reportDate: manifest.dates[dateIdx].date,
          label: shareWho.trim(),
          days: shareDays,
        }),
      });
      const j = await res.json();
      if (!res.ok || !j.url) throw new Error(j.error || 'Could not create the link.');
      setShareRes(j);
      try { await navigator.clipboard.writeText(j.url); setCopied(true); } catch { /* user can copy manually */ }
    } catch (e) {
      setShareErrMsg(e.message);
    } finally {
      setShareBusy(false);
    }
  };

  const copyShare = async () => {
    if (!shareRes) return;
    try { await navigator.clipboard.writeText(shareRes.url); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {}
  };

  const printReport = () => {
    const wasDark = document.documentElement.classList.contains('dark');
    if (wasDark) document.documentElement.classList.remove('dark');

    const restore = () => {
      if (wasDark) document.documentElement.classList.add('dark');
      window.removeEventListener('afterprint', restore);
    };
    window.addEventListener('afterprint', restore);

    // One frame so React has actually painted before the print dialog snapshots.
    requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
  };

  // ── Account Explorer: server-side paginated rows (scales to millions) ──
  const [ex, setEx] = useState({ header: [], rows: [], total: 0, totalPages: 1, filters: {} });
  const [exLoading, setExLoading] = useState(false);
  const IDX = { Account: 0, Name: 1, Status: 2, Disposition: 3, Region: 4, State: 5, Band: 6, Outstanding: 7, Recovered: 8, Attempts: 9, Connected: 10, PaymentMode: 11, PTP: 12, Mobile: 13, Lead: 14 };
  useEffect(() => {
    /* HARD STOP. /api/rows serves customer names, mobile numbers and account numbers.
       A share link has no business anywhere near it, and the guard lives here — at the
       fetch — not only in the JSX that hides the table. Hiding a component does not stop
       its effect from firing. */
    if (shareToken) return;
    if (!authed || !batchId) return;
    /* The Account Explorer pages one BATCH. "__summary" is not a batch — it spans every
       date — so asking /api/rows for it would 500 on every keystroke in the filter box. */
    if (batchId === SUMMARY_ID) return;
    let active = true;
    const p = new URLSearchParams({ id: batchId, page: String(page), size: String(PAGE_SIZE), q, status: fStatus, region: fRegion, band: fBand, disp: fDisp, sort: sortKey, dir: sortDir });
    const run = () => {
      setExLoading(true);
      fetch(`/api/rows?${p.toString()}`)
        .then((r) => r.json())
        .then((j) => { if (active && j && j.rows) setEx(j); })
        .catch(() => {})
        .finally(() => { if (active) setExLoading(false); });
    };
    const timer = setTimeout(run, q ? 300 : 0);
    return () => { active = false; clearTimeout(timer); };
  }, [authed, batchId, page, q, fStatus, fRegion, fBand, fDisp, sortKey, sortDir]);

  const totalPages = ex.totalPages || 1;
  const cur = page;
  const pageRows = ex.rows;

  /* ---------- loading / auth ---------- */
  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 46, height: 46, border: '3px solid rgba(0,113,227,.15)', borderTopColor: '#0071E3', borderRadius: 999, animation: 'spin 1s linear infinite', margin: '0 auto 16px' }} />
          <div style={{ fontSize: 15, fontWeight: 500, color: txt(.6) }}>Loading Recovery Intelligence…</div>
        </div>
      </div>
    );
  }
  /* A dead share link. Deliberately says nothing about WHY — expired, revoked and
     never-existed all look identical, so the page cannot be used to probe for valid
     tokens. And no "sign in" button: the recipient has no account and never will. */
  if (shareToken && (shareErr || !data)) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, color: 'var(--text)' }}>
        <div style={{ ...GLASS, borderRadius: 28, padding: '38px 42px', textAlign: 'center', maxWidth: 460 }}>
          <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>This link is no longer available</div>
          <div style={{ fontSize: 13.5, color: txt(.55), lineHeight: 1.6 }}>
            {shareErr || 'It may have expired or been withdrawn. Ask whoever sent it for a fresh link.'}
          </div>
        </div>
      </div>
    );
  }

  if (!authed) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, color: 'var(--text)' }}>
        <div style={{ ...GLASS, borderRadius: 28, padding: 34, textAlign: 'center' }}>
          <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 6 }}>Session expired</div>
          <div style={{ fontSize: 13.5, color: txt(.55), marginBottom: 20 }}>Please sign in to view the dashboard.</div>
          <Link href="/" style={{ display: 'inline-block', padding: '12px 24px', fontSize: 14, fontWeight: 600, borderRadius: 999, background: '#0071E3', color: '#fff', textDecoration: 'none' }}>Go to sign in</Link>
        </div>
      </div>
    );
  }

  const A = data.agg, I = data.intel, t = A.totals;
  /* The blind window, if the status file predated the calls. Absent on v5 and older
     payloads — those simply never looked, which is what `npm run rebuild` is for. */
  const OW = A.outcomeWindow;
  const isSummary = batchId === SUMMARY_ID;
  const kpis = [
    { label: 'Recovered Amount', value: fmtCr(t.recovered), sub: `${pct(t.recoveryRatePct)} of outstanding`, color: C.green },
    { label: 'Resolution Rate', value: pct(t.resolutionRatePct), sub: `${fmtInt(t.resolved)} of ${fmtInt(t.accounts)} accounts`, color: C.blue },
    { label: 'Outstanding Amount', value: fmtCr(t.sumOut), sub: `${fmtInt(t.accounts)} accounts`, color: C.indigo },
    { label: 'AI Calls Connected', value: fmtInt(A.ai.connected), sub: `of ${fmtInt(A.ai.attempts)} attempts`, color: C.purple },
    { label: 'Avg Recovery Amount', value: fmtINR(t.avgRecoveryPerResolved), sub: 'per resolved account', color: C.pink },
  ];

  const dispMax = Math.max(...A.disposition.map((d) => d.recovered), 1);
  const bandMax = Math.max(...A.bandOrder.map((b) => A.band[b]?.outstanding || 0), 1);

  /* RBL's own segment. Payloads written before this shipped have no `segments` key,
     so default it — an older report must still open, not crash the page. */
  const segments = A.segments || [];
  const segMax = Math.max(...segments.map((s) => s.outstanding || 0), 1);
  /* NOTE: the dashboard no longer reads `data.intel.model` anywhere. The model still
     trains on every upload and still ships in the payload and the database — it is
     simply not rendered. Bringing the UI back is a rendering change, not a rebuild. */

  /* Duration × Disposition L2. Older payloads predate this, so default it — a report
     saved last week must still open. The "(No disposition)" row is dropped from the
     table: those accounts were never connected, so they have no L2 to analyse, and a
     692-account row of zeros at the top would bury the six rows that matter. */
  const durL2 = (A.durationByL2 || []).filter((d) => d.name !== '(No disposition)');
  // The single longest-talking disposition — the line the deck is built on.
  const l2Longest = durL2.length
    ? durL2.reduce((a, b) => (b.avgSeconds > a.avgSeconds ? b : a))
    : null;

  /* The two funnel stages the whole pitch turns on. Looked up by name rather than by
     index so that re-ordering the funnel can never silently point this callout at the
     wrong stage. Older payloads have no `kind`, so guard everything. */
  const ptpStage = (A.funnel || []).find((f) => f.stage === 'Promise to Pay Later');
  const paidStage = (A.funnel || []).find((f) => f.stage === 'Paid');

  /* Outstanding vs Recovery, by balance band. Recovery RATE by band is the question an
     exec actually has: "are we only winning the small ones?" */
  const ovr = A.bandOrder.map((b) => {
    const d = A.band[b] || {};
    return {
      band: b,
      outstanding: d.outstanding || 0,
      recovered: d.recovered || 0,
      pending: (d.outstanding || 0) - (d.recovered || 0),
      recoveryPct: d.outstanding ? (d.recovered || 0) / d.outstanding * 100 : 0,
      count: d.count || 0,
    };
  });
  const ovrMax = Math.max(...ovr.map((r) => r.outstanding), 1);

  /* Collection Disposition Analysis — L2.
     Only dispositions with a real sample get charted. On the live book there are L2
     values sitting on ONE account; sorted by resolution rate they'd top the table at
     100%, which is a single customer, not a finding. They're rolled into a footnote
     instead of dropped, so the accounts still add up. */
  const L2_MIN_N = 20;
  const allL2 = A.dispositionL2 || [];
  const dispL2 = allL2.filter((d) => d.total >= L2_MIN_N);
  const dispL2Small = allL2.filter((d) => d.total < L2_MIN_N).reduce(
    (acc, d) => ({ count: acc.count + d.total, recovered: acc.recovered + d.recovered, kinds: acc.kinds + 1 }),
    { count: 0, recovered: 0, kinds: 0 },
  );
  const dispL2Max = Math.max(...dispL2.map((d) => d.recovered), 1);
  const dispL2Ptp = dispL2.find((d) => d.name === 'Promise to Pay Later');
  const dispL2Paid = dispL2.find((d) => d.name === 'Paid');

  /* AI reach (lead-level connection). Optional-chained because a report saved before
     this shipped has no `aiReach`, and an old cache must never crash the page. */
  const R = A.aiReach || null;

  /* ── FUNNEL GEOMETRY ──────────────────────────────────────────────────────────
     Every width on this chart is proportional to the stage's share of the book. There
     is no minimum width, no "make the last one visible" fudge, no log scale. If a stage
     is 5.2% of the book its shape is 5.2% as wide as the mouth, and it looks tiny —
     because it IS tiny, and that is the finding.

     The journey stages taper into a neck. The outcomes fan out from it as parallel
     channels, because they do not nest (Paid, 1,363, is nearly four times Promise to Pay
     Later, 367 — a continuing taper would have to widen, which is either broken-looking
     or dishonest). Everything is computed here so the JSX stays declarative. */
  const funnelGeom = (() => {
    const stages = A.funnel || [];
    if (!stages.length) return null;
    const journey = stages.filter((f) => f.kind === 'journey');
    const outcomes = stages.filter((f) => f.kind === 'outcome');
    if (!journey.length) return null;

    const BAND = 64;          // height of one journey band
    const NECK_GAP = 40;      // breathing room between the vessel and its outcomes
    const OUT_TOP = 46;       // where the outcome channels begin (leaves room for labels)
    const OUT_H = 48;         // outcome block height
    const mid = FW / 2;
    const widthOf = (v) => (stages[0].value ? (v / stages[0].value) * FW : 0);

    // Trapezoids, butted edge to edge so the vessel reads as one continuous body.
    const jg = journey.map((f, i) => {
      const next = journey[i + 1];
      const wTop = widthOf(f.value);
      const wBot = widthOf(next ? next.value : f.value);
      const y0 = i * BAND;
      const y1 = y0 + BAND;
      const x0 = mid - wTop / 2, x1 = mid + wTop / 2;
      const b0 = mid - wBot / 2, b1 = mid + wBot / 2;
      const drop = next ? f.value - next.value : 0;
      return {
        stage: f,
        path: `M ${x0} ${y0} L ${x1} ${y0} L ${b1} ${y1} L ${b0} ${y1} Z`,
        x0, x1, y0, y1, yMid: y0 + BAND / 2,
        drop,
        dropPct: f.value ? (drop / f.value) * 100 : 0,
      };
    });

    const neckY = journey.length * BAND;
    const neckW = widthOf(journey[journey.length - 1].value);
    const outY = neckY + NECK_GAP + OUT_TOP;

    /* Outcome channels. Width is share-of-book, exactly like the vessel — so "Paid" is
       visibly four times "Promise to Pay Later" and nobody has to be told. They are
       centred as a group under the neck, with a fixed gutter. */
    const GUT = 30;
    /* A floor of 66px. "Promise to Pay Later" is 5.2% of the book, which at true scale is
       a 29px sliver — too narrow to hold even its own number. The floor keeps it legible;
       the "% of book" printed under every channel keeps it honest, so nobody reads the
       clamped width as the real proportion. */
    const outW = outcomes.map((f) => Math.max(66, widthOf(f.value)));
    const totalW = outW.reduce((s, w) => s + w, 0) + GUT * (outcomes.length - 1);
    let cursor = mid - totalW / 2;
    const og = outcomes.map((f, i) => {
      const w = outW[i];
      const x = cursor;
      cursor += w + GUT;
      const cx = x + w / 2;
      // A curve from the neck down into the channel — liquid leaving the vessel.
      const link = `M ${mid} ${neckY} C ${mid} ${neckY + NECK_GAP * 0.7}, ${cx} ${outY - NECK_GAP * 0.7}, ${cx} ${outY}`;
      // Two lines max, broken at a word boundary near the middle.
      const words = f.stage.toUpperCase().split(' ');
      const label = words.length <= 2
        ? [words.join(' ')]
        : [words.slice(0, Math.ceil(words.length / 2)).join(' '), words.slice(Math.ceil(words.length / 2)).join(' ')];
      return { stage: f, x, y: outY, w, h: OUT_H, link, label, good: f.resolutionPct >= t.resolutionRatePct };
    });

    return {
      journey: jg,
      outcomes: og,
      neck: { x0: mid - neckW / 2, x1: mid + neckW / 2, y: neckY },
      height: outY + OUT_H + 44,
    };
  })();

  const regionOrder = Object.keys(A.region).sort((a, b) => A.region[b].outstanding - A.region[a].outstanding);
  const regionMax = Math.max(...regionOrder.map((r) => A.region[r].outstanding), 1);
  const stateTop = A.state.slice(0, 8);
  const stateMax = stateTop.length ? stateTop[0].outstanding : 1;
  const durColor = (p) => p >= 55 ? C.green : p >= 45 ? '#8BC34A' : p >= 38 ? C.orange : C.red;

  return (
    <div style={{ minHeight: '100vh', color: 'var(--text)', paddingBottom: 90 }}>

      {/* ═════════════════ SHARE PANEL ═════════════════
          The whole point of this thing is that it is faster and safer than attaching a
          PDF to an email. If it takes more than ten seconds it will not get used, and if
          it ever hands you a link that does not work you will stop trusting it. So: one
          field, one button, the URL already on your clipboard.

          The one piece of honesty that matters is `source`. If the server had no public
          address to build the link from, the URL points at localhost and is useless to
          anyone else on earth — and it LOOKS completely fine. That case gets a red
          warning, not a green tick. */}
      {shareOpen && !shareToken && (
        <div className="no-print" onClick={() => setShareOpen(false)} style={{
          position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,.42)',
          backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            ...GLASS, borderRadius: 26, padding: '28px 30px', width: 'min(560px, 100%)',
            animation: 'fadeUp .35s cubic-bezier(.32,.72,0,1) both',
          }}>
            <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-.015em', marginBottom: 14 }}>
              Share this report
            </div>

            {/* Two tabs. "Manage" is not an afterthought — revocation is the only control
                these links have, so it lives one click away, not in a curl command. */}
            <div style={{ display: 'flex', gap: 6, padding: 4, borderRadius: 12, background: ink(.05), marginBottom: 18 }}>
              {[
                { id: 'new', label: 'New link' },
                { id: 'manage', label: 'Manage links' },
              ].map((tb) => (
                <button key={tb.id} onClick={() => { setShareTab(tb.id); if (tb.id === 'manage' && links === null) loadLinks(); }}
                  style={{
                    flex: 1, padding: '9px 12px', borderRadius: 9, border: 'none', cursor: 'pointer',
                    fontSize: 13, fontWeight: 600,
                    background: shareTab === tb.id ? 'var(--card, #fff)' : 'transparent',
                    color: shareTab === tb.id ? 'var(--text)' : ink(.5),
                    boxShadow: shareTab === tb.id ? '0 1px 3px rgba(0,0,0,.08)' : 'none',
                  }}>
                  {tb.label}
                  {tb.id === 'manage' && links && links.filter((l) => !l.revoked).length > 0 && (
                    <span style={{
                      marginLeft: 7, fontSize: 11, fontWeight: 700, padding: '1px 7px', borderRadius: 999,
                      background: 'rgba(52,199,89,.16)', color: '#248A3D',
                    }}>{links.filter((l) => !l.revoked).length}</span>
                  )}
                </button>
              ))}
            </div>

            {shareTab === 'manage' ? (
              <ManageLinks
                links={links}
                busy={linksBusy}
                revoking={revoking}
                copiedToken={copiedToken}
                onRevoke={doRevoke}
                onCopy={copyLink}
                onRefresh={loadLinks}
                onClose={() => setShareOpen(false)}
              />
            ) : !shareRes ? (
              <>
                {/* Say exactly what the link grants. A recipient who discovers extra tabs
                    you did not know you sent is a conversation you do not want to have. */}
                <div style={{ fontSize: 13, color: txt(.55), lineHeight: 1.6, marginBottom: 18 }}>
                  A private, read-only link to <b style={{ color: txt(.8) }}>{data.meta.reportDate}</b> — the whole date:{' '}
                  <b style={{ color: txt(.8) }}>Day Total and every Day</b> filed under it. No login, no password —
                  whoever holds the URL can open it, and it shows the full report with{' '}
                  <b style={{ color: txt(.8) }}>real customer names</b>. They cannot reach any other date, upload, or
                  open the Account Explorer. Revoke it the moment it has done its job.
                </div>
                <label style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: txt(.45) }}>
                  Who is it for?
                </label>
                <input
                  autoFocus
                  value={shareWho}
                  onChange={(e) => setShareWho(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !shareBusy) makeShare(); }}
                  placeholder="e.g. Convin COO, or RBL Collections Head"
                  style={{
                    width: '100%', marginTop: 8, padding: '12px 14px', borderRadius: 12, fontSize: 14,
                    border: `1px solid ${ink(.12)}`, background: ink(.03), color: 'var(--text)', outline: 'none',
                  }}
                />
                <div style={{ fontSize: 11.5, color: txt(.42), marginTop: 7, lineHeight: 1.5 }}>
                  Printed at the foot of the report, so a screenshot that leaks is traceable to them.
                </div>

                <div style={{ marginTop: 18 }}>
                  <label style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: txt(.45) }}>
                    Expires
                  </label>
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    {[
                      { d: 0, l: 'Never' },
                      { d: 7, l: '7 days' },
                      { d: 30, l: '30 days' },
                      { d: 90, l: '90 days' },
                    ].map((o) => (
                      <button key={o.d} onClick={() => setShareDays(o.d)} style={{
                        flex: 1, padding: '9px 6px', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 600,
                        border: `1px solid ${shareDays === o.d ? '#0071E3' : ink(.12)}`,
                        background: shareDays === o.d ? 'rgba(0,113,227,.1)' : 'transparent',
                        color: shareDays === o.d ? '#0071E3' : ink(.6),
                      }}>{o.l}</button>
                    ))}
                  </div>
                  {shareDays === 0 && (
                    <div style={{ fontSize: 11.5, color: txt(.42), marginTop: 7, lineHeight: 1.5 }}>
                      {/* A permanent link is a permanent hole in the fence. It is allowed —
                          an exec who cannot open the report next month stops opening it —
                          but revocation is now the ONLY control, so it has to be said. */}
                      Works until you revoke it. Since it carries real customer names, revoke it when it is done.
                    </div>
                  )}
                </div>

                {shareErrMsg && (
                  <div style={{ marginTop: 14, fontSize: 13, color: '#C9302C' }}>{shareErrMsg}</div>
                )}

                <div style={{ display: 'flex', gap: 10, marginTop: 22 }}>
                  <button onClick={makeShare} disabled={shareBusy} style={{
                    flex: 1, padding: '12px 18px', borderRadius: 999, border: 'none', cursor: shareBusy ? 'default' : 'pointer',
                    background: '#0071E3', color: '#fff', fontSize: 14, fontWeight: 600, opacity: shareBusy ? 0.6 : 1,
                  }}>
                    {shareBusy ? 'Creating…' : 'Create link'}
                  </button>
                  <button onClick={() => setShareOpen(false)} style={{
                    padding: '12px 18px', borderRadius: 999, border: 'none', cursor: 'pointer',
                    background: ink(.07), color: 'var(--text)', fontSize: 14, fontWeight: 600,
                  }}>
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                {/* THE LINK IS LOCALHOST. It looks fine. It works on your machine. It is
                    completely useless to anyone else, and you will not find that out until
                    an hour after you send it. Say so, loudly. */}
                {shareRes.source === 'local' && (
                  <div style={{
                    marginBottom: 16, padding: '13px 15px', borderRadius: 14,
                    border: '1px solid rgba(255,59,48,.35)', background: 'rgba(255,59,48,.07)',
                  }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#C9302C', marginBottom: 4 }}>
                      This link only works on this Mac
                    </div>
                    <div style={{ fontSize: 12.5, color: txt(.72), lineHeight: 1.6 }}>
                      There is no public address to build it from, so it points at <code>localhost</code>. Send it and
                      they will see nothing. Stop <code>npm run dev</code> and start it again — it brings up a free
                      Cloudflare tunnel and the next link will be public. (Needs <code>brew install cloudflared</code>, once.)
                    </div>
                  </div>
                )}

                <div style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '13px 15px', borderRadius: 14,
                  background: ink(.04), border: `1px solid ${ink(.09)}`,
                }}>
                  <code style={{
                    flex: 1, fontSize: 12.5, color: txt(.85), wordBreak: 'break-all', lineHeight: 1.5,
                  }}>{shareRes.url}</code>
                  <button onClick={copyShare} style={{
                    flex: 'none', padding: '9px 16px', borderRadius: 999, border: 'none', cursor: 'pointer',
                    background: copied ? 'rgba(52,199,89,.16)' : '#0071E3',
                    color: copied ? '#248A3D' : '#fff', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap',
                  }}>
                    {copied ? 'Copied ✓' : 'Copy'}
                  </button>
                </div>

                <div style={{ fontSize: 12.5, color: txt(.5), marginTop: 14, lineHeight: 1.65 }}>
                  {shareRes.expiresAt ? (
                    <>Expires <b style={{ color: txt(.75) }}>
                      {new Date(shareRes.expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}
                    </b></>
                  ) : (
                    <><b style={{ color: txt(.75) }}>No expiry</b> — works until revoked</>
                  )}
                  {shareRes.label ? <> · issued to <b style={{ color: txt(.75) }}>{shareRes.label}</b></> : null}
                  {shareRes.source === 'tunnel' && (
                    <div style={{ marginTop: 8, color: '#b7791f' }}>
                      {/* The single most important sentence in this dialog. The link has no
                          expiry — but the SERVER behind it does, and it is his laptop. */}
                      This address is a tunnel to <b>this Mac</b>. It stops working the moment you
                      quit <code>npm run dev</code> or close the laptop — no matter what the expiry says.
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
                  <button onClick={() => setShareRes(null)} style={{
                    padding: '11px 18px', borderRadius: 999, border: 'none', cursor: 'pointer',
                    background: ink(.07), color: 'var(--text)', fontSize: 13.5, fontWeight: 600,
                  }}>
                    Another link
                  </button>
                  <button onClick={() => setShareOpen(false)} style={{
                    flex: 1, padding: '11px 18px', borderRadius: 999, border: 'none', cursor: 'pointer',
                    background: '#0071E3', color: '#fff', fontSize: 13.5, fontWeight: 600,
                  }}>
                    Done
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ===== Shared-view banner =====
          The holder of this link is not a user of this app. They have no session, no
          navigation, and no way back to anything else. Say so plainly — an exec who
          cannot find the menu should know there isn't one, not assume it's broken.

          Their name is printed on the page. A screenshot that ends up somewhere it
          shouldn't is traceable to the person the link was issued to. Deterrence is
          cheap; use it. */}
      {shareToken && share && (
        <div className="island no-print" style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '9px 16px', borderRadius: 999, ...GLASS,
        }}>
          <span style={{ width: 8, height: 8, borderRadius: 999, background: C.green, boxShadow: `0 0 10px ${C.green}` }} />
          <span style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap' }}>Shared report — read only</span>
          {share.label && (
            <span style={{ fontSize: 12, color: txt(.5), whiteSpace: 'nowrap' }}>· for {share.label}</span>
          )}
          {share.expiresAt && (
            <span style={{ fontSize: 12, color: txt(.5), whiteSpace: 'nowrap' }}>
              · expires {new Date(share.expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
            </span>
          )}
        </div>
      )}

      {/* ===== Dynamic Island ===== */}
      {!shareToken && (
      <div className="island" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 8px 7px 10px', borderRadius: 999, ...GLASS }}>
        <div style={{ width: 30, height: 30, borderRadius: 999, background: 'linear-gradient(135deg,#0071E3,#5856D6)', boxShadow: '0 2px 10px rgba(0,113,227,.4)', flex: 'none' }} />
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.18, marginRight: 2 }}>
          <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: '-.01em', whiteSpace: 'nowrap' }}>{name ? `Hi, ${name}` : 'Recovery Intelligence'}</div>
          <div style={{ fontSize: 10.5, color: txt(.5), whiteSpace: 'nowrap' }}>Convin × RBL · {data.meta.reportDate}</div>
        </div>
        <span style={{ width: 1, height: 20, background: ink(.12), flex: 'none' }} />
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: txt(.55), whiteSpace: 'nowrap', padding: '0 4px' }}>
          <span style={{ width: 6, height: 6, borderRadius: 999, background: '#34C759', animation: 'pulseDot 2s ease-in-out infinite' }} />Live
        </span>
        <Link href="/" title="Home" className="pill" style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', textDecoration: 'none', padding: '7px 14px', background: ink(.07), whiteSpace: 'nowrap' }}>Home</Link>
        <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} title="Toggle light / dark" aria-label="Toggle theme" className="pill" style={{ background: ink(.07), color: 'var(--text)', fontSize: 13, padding: '7px 12px', lineHeight: 1 }}>{theme === 'dark' ? '☀' : '☾'}</button>
        {/* Print. No second renderer, no separate PDF layout — the browser prints THIS
            page, so what lands in the PDF is what they just watched on screen, forever.
            Cmd+P does the same thing; the button is here because an exec will look for it. */}
        <button onClick={printReport} title="Print / save as PDF" aria-label="Print report" className="pill"
          style={{ background: ink(.07), color: 'var(--text)', fontSize: 12, fontWeight: 600, padding: '7px 14px', whiteSpace: 'nowrap' }}>
          Print
        </button>
        <button onClick={openShare} title="Create a private read-only link to this report" className="pill"
          style={{ background: 'rgba(0,113,227,.1)', color: '#0071E3', fontSize: 12, fontWeight: 600, padding: '7px 14px', whiteSpace: 'nowrap' }}>
          Share
        </button>
        <button onClick={logout} className="pill" style={{ background: 'rgba(255,59,48,.1)', color: '#FF3B30', fontSize: 12, fontWeight: 600, padding: '7px 14px' }}>Logout</button>
      </div>
      )}

      <div style={{ height: 84 }} />

      <div className="page-shell" style={{ maxWidth: 1440, margin: '0 auto', padding: '0 40px' }}>
        {/* ===== Date navigator + same-day upload tabs =====
            Not rendered for a share link. The link is scoped to ONE report; offering the
            holder a date picker that cannot work is worse than offering nothing. */}
        {!shareToken && manifest && manifest.dates && manifest.dates.length > 0 && (() => {
          const day = manifest.dates[dateIdx];
          const nDates = manifest.dates.length;
          /* Summary sits to the LEFT of Day Total, and is the only tab that is not
             about the selected date — it is the whole campaign, every date at once. */
          const tabs = [
            /* The Summary covers THIS DATE, assembled from its Days. The count is the
               number of Days under the selected date — the same things the tabs beside
               it are named after, so the word finally means one thing. */
            { id: SUMMARY_ID, label: 'Summary', meta: `${day.uploads.length} day${day.uploads.length === 1 ? '' : 's'}` },
            { id: day.dayTotal, label: 'Day Total', meta: `${fmtInt(day.rowCount)} accounts` },
            ...day.uploads.map((u) => ({ id: u.id, label: dayLabel(u), meta: u.time || `${fmtInt(u.rowCount)} rows` }))];
          return (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between', padding: '28px 0 2px', animation: 'fadeUp .6s cubic-bezier(.32,.72,0,1) both' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, ...GLASS, borderRadius: 999, padding: '7px 10px 7px 16px' }}>
                <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: txt(.45), marginRight: 2 }}>Report date</span>
                <button aria-label="Older date" onClick={() => gotoDate(dateIdx + 1)} disabled={dateIdx >= manifest.dates.length - 1} style={arrowBtn(dateIdx >= manifest.dates.length - 1)}>‹</button>
                <span style={{ fontSize: 14, fontWeight: 600, minWidth: 118, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{day.display}</span>
                <button aria-label="Newer date" onClick={() => gotoDate(dateIdx - 1)} disabled={dateIdx <= 0} style={arrowBtn(dateIdx <= 0)}>›</button>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, ...GLASS, borderRadius: 999, padding: 5, opacity: switching ? 0.55 : 1, transition: 'opacity .2s' }}>
                {tabs.map((tb) => {
                  const on = tb.id === batchId;
                  return (
                    <button key={tb.id} onClick={() => selectBatch(tb.id)} style={{ border: 'none', cursor: on ? 'default' : 'pointer', borderRadius: 999, padding: '8px 15px', fontSize: 13, fontWeight: 600, color: on ? '#fff' : ink(.62), background: on ? '#0071E3' : 'transparent', transition: 'background .25s, color .25s', whiteSpace: 'nowrap' }}>
                      {tb.label}<span style={{ fontWeight: 500, opacity: on ? 0.8 : 0.55, marginLeft: 7, fontSize: 11.5 }}>{tb.meta}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* ===== Shared link: the tabs for THIS DATE, and nothing else =====
            The recipient can move between Day Total, Day 1, Day 2… for the one date the
            link was cut for. There is NO date navigator — that is what keeps the link
            scoped, and offering arrows that cannot work would be worse than offering
            none. The report date is shown as a fixed label so they always know what
            they are looking at.

            The tab list came from the server. Every click goes back through the token and
            is re-validated against the link's own date — the browser is not trusted to
            only ask for tabs it was offered. Hiding a button is not access control.

            Legacy batch-scoped links send no tabs, and get no tab bar. */}
        {shareToken && shareTabs.length > 1 && (
          <div className="no-print" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between', padding: '28px 0 2px', animation: 'fadeUp .6s cubic-bezier(.32,.72,0,1) both' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, ...GLASS, borderRadius: 999, padding: '9px 18px' }}>
              <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: txt(.45) }}>Report date</span>
              <span style={{ fontSize: 14, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{share?.display || data.meta.reportDate}</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, ...GLASS, borderRadius: 999, padding: 5, opacity: switching ? 0.55 : 1, transition: 'opacity .2s' }}>
              {shareTabs.map((tb) => {
                const on = tb.id === batchId;
                return (
                  <button key={tb.id} onClick={() => selectShareBatch(tb.id)} style={{ border: 'none', cursor: on ? 'default' : 'pointer', borderRadius: 999, padding: '8px 15px', fontSize: 13, fontWeight: 600, color: on ? '#fff' : txt(.62), background: on ? '#0071E3' : 'transparent', transition: 'background .25s, color .25s', whiteSpace: 'nowrap' }}>
                    {tb.label}
                    {tb.meta && <span style={{ fontWeight: 500, opacity: on ? 0.8 : 0.55, marginLeft: 7, fontSize: 11.5 }}>{tb.meta}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {/* ═══════════════════════ CAMPAIGN SUMMARY ═══════════════════════
            The Summary tab replaces the whole report body. It is not a view of the
            selected date — it is every date at once, unioned by account, and it has no
            batch behind it. Everything below stays mounted and untouched, so switching
            back to a day is instant. */}
        {isSummary ? <SummaryView s={summary} /> : (<>

        {/* ═══════════════════════ PRINT COVER ═══════════════════════
            Invisible on screen; the first page of the PDF. A report a bank will actually
            file needs, on its face: what it is, whose book it is, which cycle, how big,
            where the numbers came from, and who to shout at. Without this the PDF opens
            on a wall of charts with no date and no provenance — impossible to file, and
            impossible to defend six weeks later when someone asks "which cycle was this?".

            The provenance box is the most important thing on the page. It states, in
            writing, that the OUTCOME came from RBL's own status file and not from ours.
            That single sentence is what makes every other number in the document
            credible: we did not mark our own homework. */}
        <div className="print-only print-cover" style={{ display: 'none' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 14, borderBottom: '3px solid #1D1D1F' }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.16em', textTransform: 'uppercase', color: '#0071E3' }}>
              AI Collections Performance
            </div>
            <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: '#C9302C', border: '1px solid #C9302C', borderRadius: 4, padding: '3px 9px' }}>
              Confidential
            </div>
          </div>

          <h1 style={{ fontSize: 40, lineHeight: 1.08, fontWeight: 700, letterSpacing: '-.028em', margin: '26px 0 6px', color: '#1D1D1F' }}>
            Recovery Intelligence
          </h1>
          <div style={{ fontSize: 19, color: '#6E6E73', fontWeight: 500, marginBottom: data.meta.cycFile ? 8 : 30 }}>
            RBL Bank &nbsp;·&nbsp; prepared by Convin &nbsp;·&nbsp; {data.meta.reportDate}
          </div>
          {/* The exact book these numbers were computed from. A report a bank cannot tie
              back to a specific file is a report a bank cannot check. */}
          {data.meta.cycFile && (
            <div style={{ fontSize: 12.5, color: '#86868B', marginBottom: 30, fontVariantNumeric: 'tabular-nums' }}>
              Source book: <span style={{ color: '#3A3A3C', fontWeight: 600 }}>{data.meta.cycFile}</span>
            </div>
          )}

          {/* The four numbers a COO wants before reading anything else. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 26 }}>
            {[
              { l: 'Recovered Amount', v: fmtCr(t.recovered), s: `${pct(t.recoveryRatePct, 1)} of outstanding`, c: '#248A3D' },
              { l: 'Accounts resolved', v: fmtInt(t.resolved), s: `${pct(t.resolutionRatePct, 1)} of the book`, c: '#0071E3' },
              { l: 'Total Accounts', v: fmtInt(t.accounts), s: fmtCr(t.sumOut) + ' outstanding', c: '#5856D6' },
              { l: 'Still open', v: fmtCr(t.outstandingPending), s: `${fmtInt(t.unresolved)} accounts`, c: '#FF9500' },
            ].map((k, i) => (
              <div key={i} style={{ border: '1px solid rgba(0,0,0,.12)', borderRadius: 10, padding: '13px 14px' }}>
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: '#86868B', marginBottom: 6 }}>{k.l}</div>
                <div style={{ fontSize: 23, fontWeight: 700, letterSpacing: '-.02em', color: k.c, fontVariantNumeric: 'tabular-nums' }}>{k.v}</div>
                <div style={{ fontSize: 10.5, color: '#86868B', marginTop: 3 }}>{k.s}</div>
              </div>
            ))}
          </div>

          <div className="cover-provenance" style={{ border: '1px solid rgba(0,0,0,.12)', borderLeft: '3px solid #0071E3', borderRadius: 8, padding: '15px 17px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: '#86868B', marginBottom: 8 }}>
              Where these numbers came from
            </div>
            <div style={{ fontSize: 12, lineHeight: 1.65, color: '#3A3A3C' }}>
              Every account in RBL&apos;s CYC book is included — <b>including the ones the AI never reached</b> — so the
              denominator is the bank&apos;s, not ours. <b>The outcome (Resolved / Unresolved) is taken from RBL&apos;s own
              status file</b> and from nowhere else; Convin&apos;s export does not contain it, by design. We do not mark
              our own homework. Call activity, dispositions and talk time come from the Convin lead export, joined on
              Account No. Nothing on the following pages is estimated unless it is explicitly labelled an assumption.
            </div>

          </div>

          <div className="cover-strip" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: '#86868B', borderTop: '1px solid rgba(0,0,0,.10)', paddingTop: 10 }}>
            <span>{fmtInt(t.accounts)} accounts &nbsp;·&nbsp; {fmtInt(A.ai.attempts)} call attempts &nbsp;·&nbsp; {fmtInt(Math.round(A.ai.talkMinutes))} talk-minutes</span>
            <span>Generated {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
          </div>
        </div>

        {/* Running footer. Chrome repeats a position:fixed element on every printed page,
            so the provenance line and the confidentiality mark travel with any page that
            gets pulled out of the staple and passed around on its own. */}
        <div className="print-footer" style={{ display: 'none' }}>
          <span>Recovery Intelligence · RBL Bank · {data.meta.reportDate}</span>
          <span>Outcome sourced from RBL&apos;s status file · Prepared by Convin · Confidential</span>
        </div>

        {/* ===== Hero ===== */}
        <div className="hero" style={{ padding: '52px 0 36px' }}>
          <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.12em', color: C.blue, textTransform: 'uppercase', marginBottom: 14, animation: 'fadeUp .7s cubic-bezier(.32,.72,0,1) both' }}>AI Collections Performance</div>
          {/* print-solid-text: the gradient here is a background clipped to the glyphs,
              so the text itself is transparent. On paper the browser drops the background
              and the headline vanishes entirely. The class repaints it solid for print. */}
          <h1 className="print-solid-text" style={{ fontSize: 56, lineHeight: 1.04, fontWeight: 700, letterSpacing: '-.03em', margin: '0 0 16px', maxWidth: 900, background: 'linear-gradient(120deg,#34C759 0%,#0071E3 55%,#5856D6 100%)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', animation: 'fadeUp .8s cubic-bezier(.32,.72,0,1) both .05s' }}>
            {fmtCr(t.recovered)} recovered.<br />And every reason why.
          </h1>
          <p style={{ fontSize: 18, lineHeight: 1.5, color: txt(.6), maxWidth: 680, margin: 0, animation: 'fadeUp .8s cubic-bezier(.32,.72,0,1) both .1s' }}>
            Convin&apos;s AI worked {fmtInt(t.accounts)} RBL accounts holding {fmtCr(t.sumOut)} in outstanding — resolving {fmtInt(t.resolved)} of them ({pct(t.resolutionRatePct)}) across {fmtInt(A.ai.attempts)} calls.
          </p>
          {/* Same provenance line as the printed cover, on screen. */}
          {data.meta.cycFile && (
            <div style={{ fontSize: 13, color: txt(.45), marginTop: 16, animation: 'fadeUp .8s cubic-bezier(.32,.72,0,1) both .15s' }}>
              Source book: <span style={{ color: txt(.7), fontWeight: 600 }}>{data.meta.cycFile}</span>
            </div>
          )}
        </div>

        {/* ===== Schema-mismatch notice =====
            The dashboard renders a payload computed at UPLOAD time and cached — it does
            not recompute on load. So the stored data and the running code can drift
            apart, and they can drift in EITHER direction:

              data OLDER than app  — the aggregator gained a field the stored report
                                     lacks, so every card guarded on it silently
                                     disappears. No error, no clue. Two sections vanished
                                     exactly this way. Fix: `npm run rebuild`.

              data NEWER than app  — the code shipped, the payload was rebuilt, but the
                                     browser is still running an old bundle (a Vercel
                                     deploy that hasn't landed, or a cached chunk). Fix:
                                     redeploy and hard-refresh.

            This banner only ever handled the first case, and cheerfully told you to run
            `npm run rebuild` in the second — where rebuilding is useless and the real
            problem is a stale deploy. Advice that confidently points the wrong way is
            worse than no advice, because you will follow it. */}
        {data.version !== PAYLOAD_VERSION && (() => {
          const stored = data.version ?? 1;
          const appBehind = stored > PAYLOAD_VERSION;
          return (
            <div style={{
              ...GLASS, borderRadius: 18, padding: '16px 20px', marginBottom: 16,
              border: '1px solid rgba(255,149,0,.42)', background: 'rgba(255,149,0,.09)',
            }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: '#b7791f', marginBottom: 4 }}>
                {appBehind
                  ? 'You are running an older version of the app than the data'
                  : 'This report was computed by an older version of the analysis engine'}
              </div>
              <div style={{ fontSize: 13, color: txt(.72), lineHeight: 1.6 }}>
                The stored report is schema <b>v{stored}</b>; the app you are running is <b>v{PAYLOAD_VERSION}</b>.{' '}
                {appBehind ? (
                  <>
                    The data has been rebuilt but this browser is still running old code — a deploy that
                    has not landed yet, or a cached bundle. Sections and wording added since v{PAYLOAD_VERSION} will{' '}
                    <b>not appear</b>, however many times you rebuild. Check the deploy finished, then{' '}
                    <b>hard-refresh</b> (<code style={{ background: ink(.08), padding: '2px 7px', borderRadius: 6, fontSize: 12.5 }}>Cmd/Ctrl + Shift + R</code>).
                  </>
                ) : (
                  <>
                    Sections added since then are <b>not on this page</b> — they are missing, not empty. Regenerate
                    every stored report from its saved rows with{' '}
                    <code style={{ background: ink(.08), padding: '2px 7px', borderRadius: 6, fontSize: 12.5 }}>npm run rebuild</code>
                    {' '}and reload. Nothing is re-uploaded and no numbers change.
                  </>
                )}
              </div>
            </div>
          );
        })()}

        {/* ═══════════════════════ THE OUTCOME-WINDOW BANNER IS GONE ═══════════════
         *
         * REMOVED ON THE CLIENT'S EXPLICIT INSTRUCTION (14 July 2026), after being told
         * plainly what it was for. Recording that here rather than quietly deleting the
         * code, because whoever finds this next deserves to know it was a decision and
         * not an oversight.
         *
         * WHAT IT DID
         * The status file is a snapshot; the calls run for days. Pair a 4 July snapshot
         * with a campaign that ran to 7 July and every account still being dialled after
         * the pull comes back "Unresolved" — not because the customer refused, but
         * because nobody had looked yet. On the real book that was 740 accounts, 12,130
         * dials (30% of the campaign) and ₹5.74 Cr, all reading exactly 0.0% resolved.
         * The banner said so, in red, and told you to re-pull the status file.
         *
         * WHAT IS STILL HERE
         * The DETECTION is untouched. _outcomeWindow() in aggregate.mjs still finds the
         * blind cohort, and Conversation Duration, Dial Efficiency and Duration × L2 are
         * still computed over the measurable accounts only — so those charts cannot show
         * a false 0%, and each still carries a one-line footnote saying what it excluded
         * and why. Only the page-level warning is gone.
         *
         * WHAT THAT COSTS
         * Nothing now warns you, on a future upload, that an outcome file predates the
         * calls. The headline resolution rate can be a floor rather than a result, and
         * the page will not say so. That is a silent condition again — which is the exact
         * failure mode this app was built to refuse.
         *
         * The fix was never the banner. It is to upload a status file pulled AFTER the
         * last call. Do that and the condition disappears on its own.
         * ══════════════════════════════════════════════════════════════════════════ */}

        {/* ===== Data-quality notice =====
            Anything odd about the export is said out loud. A bank would far rather be
            told its file is strange than discover, later, that a chart quietly
            disagreed with the account count and nobody mentioned it. */}
        {data.quality && (data.quality.unknownBands?.length > 0 || data.quality.dirtyAttemptRows > 0) && (
          <div style={{ ...GLASS, borderRadius: 18, padding: '14px 18px', marginBottom: 16, display: 'flex', alignItems: 'flex-start', gap: 11, borderColor: C.orange + '40' }}>
            <span style={{ width: 7, height: 7, borderRadius: 999, background: C.orange, marginTop: 6, flex: 'none' }} />
            <div style={{ fontSize: 12.5, color: txt(.62), lineHeight: 1.55 }}>
              <strong style={{ color: 'var(--text)', fontWeight: 600 }}>A note on this export.</strong>{' '}
              {data.quality.unknownBands?.length > 0 && (
                <>We found balance {data.quality.unknownBands.length === 1 ? 'band' : 'bands'} we don&apos;t recognise
                  ({data.quality.unknownBands.join(', ')}). {data.quality.unknownBands.length === 1 ? 'It is' : 'They are'} charted
                  as-is rather than dropped, so every account is still accounted for.{' '}</>
              )}
              {data.quality.dirtyAttemptRows > 0 && (
                <>{fmtInt(data.quality.dirtyAttemptRows)} {data.quality.dirtyAttemptRows === 1 ? 'account records a connected call' : 'accounts record connected calls'} with
                  zero logged attempts — likely a dialler-export quirk. We&apos;ve counted {data.quality.dirtyAttemptRows === 1 ? 'it' : 'them'} as attempted so the funnel stays honest.</>
              )}
            </div>
          </div>
        )}

        {/* ===== KPI row ===== */}
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${kpis.length},1fr)`, gap: 16, marginBottom: 16 }}>
          {kpis.map((k, i) => (
            <div className="hover-kpi" key={i} style={{ ...GLASS, borderRadius: 22, padding: '22px 20px', animation: 'fadeUp .7s cubic-bezier(.32,.72,0,1) both' }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: k.color, marginBottom: 14, boxShadow: `0 0 12px ${k.color}` }} />
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: txt(.5), marginBottom: 8 }}>{k.label}</div>
              <div style={{ fontSize: 27, fontWeight: 700, letterSpacing: '-.02em', fontVariantNumeric: 'tabular-nums', marginBottom: 6 }}>{k.value}</div>
              <div style={{ fontSize: 12.5, color: txt(.48) }}>{k.sub}</div>
            </div>
          ))}
        </div>

        {/* ===== Overall Portfolio Summary + Resolution Summary ===== */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12,1fr)', gap: 16, marginBottom: 16 }}>
          <Card span={6}>
            <Title t="Overall Portfolio Summary" s="The book RBL handed us, before anything happened to it" />
            {[
              { l: 'Total accounts', v: fmtInt(t.accounts), c: C.blue },
              { l: 'Total outstanding', v: fmtCr(t.sumOut), c: C.indigo },
              { l: 'Total minimum due', v: fmtCr(t.sumMinDue), c: C.teal },
              { l: 'Average outstanding / account', v: fmtINR(t.avgOutstanding), c: C.purple },
              { l: 'Balance bands in the book', v: fmtInt(A.bandOrder.length), c: C.cyan },
              /* statesCovered — NOT state.length. The state list carries an "Unspecified"
                 bucket so the geography charts still add up to the book, and counting that
                 bucket as a state read 21 when there are 20. See totals in aggregate.mjs. */
              { l: 'States covered', v: fmtInt(A.totals.statesCovered ?? A.state.filter((s) => s.state !== 'Unspecified').length), c: C.orange },
            ].map((r, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 0', borderTop: i ? `1px solid ${ink(.07)}` : 'none' }}>
                <span style={{ fontSize: 13, color: txt(.65) }}>{r.l}</span>
                <span style={{ fontSize: 15, fontWeight: 700, color: r.c, fontVariantNumeric: 'tabular-nums' }}>{r.v}</span>
              </div>
            ))}
          </Card>

          <Card span={6}>
            <Title t="Resolution Summary" s="Resolved vs still open — the outcome comes from RBL's status file, not ours" />
            <div style={{ display: 'flex', height: 16, borderRadius: 8, overflow: 'hidden', margin: '4px 0 16px', background: ink(.07) }}>
              <div style={{ width: `${t.resolutionRatePct}%`, background: `linear-gradient(90deg,${C.green},#8BC34A)`, transition: 'width 1.1s cubic-bezier(.32,.72,0,1)' }} />
            </div>
            {[
              { l: 'Resolved accounts', v: fmtInt(t.resolved), s: pct(t.resolutionRatePct, 1) + ' of the book', c: C.green },
              { l: 'Unresolved accounts', v: fmtInt(t.unresolved), s: pct(100 - t.resolutionRatePct, 1) + ' still open', c: C.red },
              { l: 'Value recovered', v: fmtCr(t.recovered), s: pct(t.recoveryRatePct, 1) + ' of outstanding', c: C.green },
              { l: 'Value still outstanding', v: fmtCr(t.outstandingPending), s: 'the working opportunity', c: C.orange },
              { l: 'Average recovery / resolved account', v: fmtINR(t.avgRecoveryPerResolved), s: 'measured', c: C.blue },
            ].map((r, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderTop: i ? `1px solid ${ink(.07)}` : 'none' }}>
                <div>
                  <div style={{ fontSize: 13, color: txt(.7) }}>{r.l}</div>
                  <div style={{ fontSize: 11.5, color: txt(.42) }}>{r.s}</div>
                </div>
                <span style={{ fontSize: 16, fontWeight: 700, color: r.c, fontVariantNumeric: 'tabular-nums' }}>{r.v}</span>
              </div>
            ))}
          </Card>
        </div>

        {/* ===== AI Call Percentage — reach =====
            Total leads vs leads we actually got a human voice on. Deliberately kept apart
            from the CALL-level connect rate, which is a different number with a different
            denominator (connected calls ÷ dial attempts). Quoting one as the other in front
            of a bank is not a rounding error, it is a credibility event — 48.7% and 16.8%
            are both true and they mean completely different things. Both are on the card,
            each with its denominator written out. */}
        {R && (
          <Card span={12} style={{ marginBottom: 16 }}>
            <Title t="AI Call Percentage — Total Leads vs AI Connected Leads" s="How much of RBL's book the AI actually reached — measured per lead, not per dial" />
            <div style={{ display: 'grid', gridTemplateColumns: '210px 1fr 300px', gap: 26, alignItems: 'center' }}>

              {/* The headline rate, as a ring. */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <svg viewBox="0 0 120 120" style={{ width: 168, height: 168 }}>
                  <circle cx="60" cy="60" r="52" fill="none" stroke={ink(.09)} strokeWidth="13" />
                  <circle
                    cx="60" cy="60" r="52" fill="none" stroke={C.green} strokeWidth="13" strokeLinecap="round"
                    strokeDasharray={`${(R.connectionRatePct / 100) * 2 * Math.PI * 52} ${2 * Math.PI * 52}`}
                    transform="rotate(-90 60 60)"
                    style={{ transition: 'stroke-dasharray 1.2s cubic-bezier(.32,.72,0,1)' }}
                  />
                  <text x="60" y="58" textAnchor="middle" fontSize="22" fontWeight="700" fill="currentColor" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {R.connectionRatePct.toFixed(1)}%
                  </text>
                  <text x="60" y="74" textAnchor="middle" fontSize="7.5" fill="currentColor" opacity="0.5" letterSpacing="0.5">
                    AI CONNECTION RATE
                  </text>
                </svg>
                <div style={{ fontSize: 11.5, color: txt(.45), textAlign: 'center', marginTop: 2 }}>
                  connected leads ÷ total leads
                </div>
              </div>

              {/* Total leads vs connected leads, to scale. */}
              <div>
                <div style={{ marginBottom: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                    <span style={{ fontSize: 13, color: txt(.7) }}>Total leads in the book</span>
                    <span style={{ fontSize: 20, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtInt(R.totalLeads)}</span>
                  </div>
                  <div style={{ height: 22, borderRadius: 11, background: ink(.09) }} />
                </div>
                <div style={{ marginBottom: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                    <span style={{ fontSize: 13, color: txt(.7) }}>AI connected leads <span style={{ color: txt(.42) }}>— a human picked up</span></span>
                    <span style={{ fontSize: 20, fontWeight: 700, color: C.green, fontVariantNumeric: 'tabular-nums' }}>
                      {fmtInt(R.leadsConnected)} <span style={{ fontSize: 13, color: txt(.45), fontWeight: 500 }}>· {pct(R.connectionRatePct, 1)}</span>
                    </span>
                  </div>
                  <div style={{ height: 22, borderRadius: 11, background: ink(.09), overflow: 'hidden' }}>
                    <div style={{ width: `${R.connectionRatePct}%`, height: '100%', borderRadius: 11, background: `linear-gradient(90deg,${C.green},#8BC34A)`, transition: 'width 1.2s cubic-bezier(.32,.72,0,1)' }} />
                  </div>
                </div>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                    <span style={{ fontSize: 13, color: txt(.7) }}>Never reached <span style={{ color: txt(.42) }}>— dialled, never answered</span></span>
                    <span style={{ fontSize: 20, fontWeight: 700, color: txt(.55), fontVariantNumeric: 'tabular-nums' }}>
                      {fmtInt(R.leadsNotConnected)} <span style={{ fontSize: 13, color: txt(.45), fontWeight: 500 }}>· {pct(100 - R.connectionRatePct, 1)}</span>
                    </span>
                  </div>
                  <div style={{ height: 22, borderRadius: 11, background: ink(.09), overflow: 'hidden' }}>
                    <div style={{ width: `${100 - R.connectionRatePct}%`, height: '100%', borderRadius: 11, background: ink(.22), transition: 'width 1.2s cubic-bezier(.32,.72,0,1)' }} />
                  </div>
                </div>
                {R.neverAttempted > 0 && (
                  <div style={{ fontSize: 12, color: '#b7791f', marginTop: 12 }}>
                    {fmtInt(R.neverAttempted)} leads were never dialled at all — they are inside &quot;never reached&quot;.
                  </div>
                )}
              </div>

              {/* The other connection rate. Same word, different denominator. */}
              <div style={{ padding: '16px 18px', borderRadius: 16, background: ink(.03), border: `1px solid ${ink(.06)}` }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: txt(.45), marginBottom: 12 }}>
                  Per dial, not per lead
                </div>
                {[
                  { l: 'Total dial attempts', v: fmtInt(R.callAttempts) },
                  { l: 'Calls connected', v: fmtInt(R.callsConnected) },
                  { l: 'Call connect rate', v: pct(R.callConnectRatePct, 1), hi: true },
                  { l: 'Avg attempts per lead', v: R.avgAttemptsPerLead.toFixed(1) },
                  { l: 'Avg dials to reach one lead', v: R.avgAttemptsToConnect.toFixed(1), hi: true },
                ].map((r, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderTop: i ? `1px solid ${ink(.07)}` : 'none' }}>
                    <span style={{ fontSize: 12.5, color: txt(.62) }}>{r.l}</span>
                    <span style={{ fontSize: 14.5, fontWeight: 700, color: r.hi ? C.blue : ink(.85), fontVariantNumeric: 'tabular-nums' }}>{r.v}</span>
                  </div>
                ))}
                <div style={{ fontSize: 11, color: txt(.42), marginTop: 10, lineHeight: 1.5 }}>
                  This is <b>{pct(R.callConnectRatePct, 1)}</b>, not {pct(R.connectionRatePct, 1)} — a lead who never answers is dialled
                  many times and drags the per-dial figure down. Both are true. Don&apos;t quote one as the other.
                </div>
              </div>
            </div>

            {/* What reaching them was actually worth. This is the line the whole card exists for. */}
            <div style={{
              marginTop: 20, padding: '16px 18px', borderRadius: 16,
              background: 'rgba(52,199,89,.07)', border: '1px solid rgba(52,199,89,.22)',
              display: 'flex', alignItems: 'center', gap: 28, flexWrap: 'wrap',
            }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em', color: txt(.5) }}>Reached by the AI</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: '#248A3D', fontVariantNumeric: 'tabular-nums' }}>{pct(R.resolutionConnectedPct, 1)}</div>
                <div style={{ fontSize: 11.5, color: txt(.45) }}>{fmtInt(R.resolvedConnected)} of {fmtInt(R.leadsConnected)} resolved</div>
              </div>
              <div style={{ fontSize: 20, color: txt(.3) }}>vs</div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em', color: txt(.5) }}>Never reached</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: txt(.55), fontVariantNumeric: 'tabular-nums' }}>{pct(R.resolutionNotConnectedPct, 1)}</div>
                <div style={{ fontSize: 11.5, color: txt(.45) }}>{fmtInt(R.resolvedNotConnected)} of {fmtInt(R.leadsNotConnected)} resolved</div>
              </div>
              <div style={{ flex: 1, minWidth: 320, fontSize: 13, color: txt(.72), lineHeight: 1.6 }}>
                A lead the AI actually reached resolves{' '}
                <b style={{ color: '#248A3D' }}>{(R.resolutionConnectedPct - R.resolutionNotConnectedPct).toFixed(1)} points higher</b>{' '}
                than one it never got hold of.{' '}
                {/* Say the quiet part before an analyst does. This is a comparison between two
                    groups that were not randomly assigned — reachable customers may simply be
                    more reachable people. Claiming causation here is the fastest way to lose a
                    room, and conceding it costs us nothing: the gap is still the gap. */}
                <span style={{ color: txt(.5) }}>
                  These groups were not randomly assigned, so treat this as the measured gap between
                  reached and unreached customers, not as proof the call caused the payment.
                </span>
              </div>
            </div>
          </Card>
        )}

        {/* ===== Conversation Duration + AI Performance ===== */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12,1fr)', gap: 16, marginBottom: 16 }}>
          <Card span={8}>
            <Title t="Longer conversations recover more" s="Resolution rate by AI conversation length — the core behavioural insight" />
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, height: 200, marginTop: 6 }}>
              {A.duration.map((d, i) => (
                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%', gap: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: durColor(d.resolutionPct), fontVariantNumeric: 'tabular-nums' }}>{pct(d.resolutionPct, 0)}</div>
                  <div style={{ width: '100%', maxWidth: 66, borderRadius: '7px 7px 3px 3px', height: `${d.resolutionPct}%`, background: `linear-gradient(180deg,${durColor(d.resolutionPct)},${durColor(d.resolutionPct)}bb)`, transition: 'height 1.1s cubic-bezier(.32,.72,0,1)', minHeight: 6 }} />
                  <div style={{ fontSize: 11.5, color: txt(.55), textAlign: 'center', lineHeight: 1.2 }}>{d.bucket}</div>
                  <div style={{ fontSize: 10.5, color: txt(.38) }}>n={fmtInt(d.n)}</div>
                </div>
              ))}
            </div>
            {OW?.blindAccounts > 0 && (
              <div style={{ fontSize: 11, color: txt(.4), marginTop: 10 }}>
                Excludes {fmtInt(OW.blindAccounts)} accounts whose calls continued past the outcome file
                ({fmtDay(OW.outcomeSeenTo)}) — their result is not yet known.
              </div>
            )}
          </Card>
          <Card span={4}>
            <Title t="AI Calling Performance" s="Engagement at scale" />
            {[
              { l: 'Total attempts', v: fmtInt(A.ai.attempts), c: C.blue },
              { l: 'Connected', v: fmtInt(A.ai.connected), c: C.green },
              { l: 'Not connected', v: fmtInt(A.ai.notConnected), c: txt(.5) },
              { l: 'Connect rate', v: pct(A.ai.connectRatePct), c: C.teal },
              { l: 'Talk-minutes', v: fmtInt(A.ai.talkMinutes), c: C.purple },
              { l: 'Avg attempts / account', v: A.ai.avgAttempts.toFixed(1), c: C.indigo },
            ].map((r, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderTop: i ? '1px solid ' + ink(.07) : 'none' }}>
                <span style={{ fontSize: 13, color: txt(.65) }}>{r.l}</span>
                <span style={{ fontSize: 15, fontWeight: 700, color: r.c, fontVariantNumeric: 'tabular-nums' }}>{r.v}</span>
              </div>
            ))}
          </Card>
        </div>

        {/* ===== Disposition ===== */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12,1fr)', gap: 16, marginBottom: 16 }}>
          <Card span={12}>
            <Title t="Collection Disposition Analysis — L1" s="Recovered value by the AI's top-level disposition" />
            {A.disposition.slice(0, 7).map((d, i) => (
              <Bar key={i} label={d.name} right={fmtCr(d.recovered)} pctv={d.recovered / dispMax * 100}
                color={`linear-gradient(90deg,${C.green},${C.cyan})`} sub={`${fmtInt(d.resolved)} resolved of ${fmtInt(d.total)} · ${fmtCr(d.outstanding)} outstanding`} />
            ))}
          </Card>
        </div>

        {/* ===== Collection Disposition Analysis — L2 =====
            L1 tells you the agent logged a "Paid". L2 tells you which kind — the customer
            said the money was already sent, or promised it for later, or disputed the
            charge. Those sit inside the same L1 bucket and recover at completely different
            rates, and the difference is invisible until you split it. */}
        {dispL2.length > 0 && (
          <Card span={12} className="print-breakable" style={{ marginBottom: 16, padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '22px 22px 0' }}>
              <Title t="Collection Disposition Analysis — L2" s="What the customer actually said, and what it was worth — sorted by value recovered" />
            </div>
            <div className="table-scroll" style={{ overflowX: 'auto', padding: '4px 22px 22px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 760 }}>
                <thead>
                  <tr>
                    <th style={l2Th('left', 250)}>Disposition L2</th>
                    <th style={l2Th('right', 74)}>Accounts</th>
                    <th style={l2Th('right', 110)}>Recovered</th>
                    <th style={l2Th('right', 110)}>Outstanding</th>
                    <th style={l2Th('right', 96)}>Recovery %</th>
                    <th style={l2Th('right', 96)}>Resolution %</th>
                    <th style={l2Th('left', 150)}>Share of recovery</th>
                  </tr>
                </thead>
                <tbody>
                  {dispL2.map((d, i) => {
                    const good = d.resolutionPct >= t.resolutionRatePct;
                    return (
                      <tr key={i} style={{ borderTop: `1px solid ${ink(.07)}` }}>
                        <td style={{ padding: '11px 10px', fontWeight: 600, color: txt(.9) }}>
                          {d.name}
                          {d.name === '(Not contacted)' && (
                            <div style={{ fontSize: 11, fontWeight: 400, color: txt(.45), marginTop: 2 }}>
                              Never connected — no disposition exists for these
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '11px 10px', textAlign: 'right', color: txt(.62), fontVariantNumeric: 'tabular-nums' }}>{fmtInt(d.total)}</td>
                        <td style={{ padding: '11px 10px', textAlign: 'right', fontWeight: 700, color: '#248A3D', fontVariantNumeric: 'tabular-nums' }}>{fmtCr(d.recovered)}</td>
                        <td style={{ padding: '11px 10px', textAlign: 'right', color: txt(.72), fontVariantNumeric: 'tabular-nums' }}>{fmtCr(d.outstanding)}</td>
                        <td style={{ padding: '11px 10px', textAlign: 'right', color: txt(.72), fontVariantNumeric: 'tabular-nums' }}>{pct(d.recoveryPct, 1)}</td>
                        <td style={{ padding: '11px 10px', textAlign: 'right', fontWeight: 700, color: good ? '#248A3D' : '#C9302C', fontVariantNumeric: 'tabular-nums' }}>
                          {pct(d.resolutionPct, 1)}
                          <div style={{ fontSize: 10, fontWeight: 400, color: txt(.4) }}>vs {pct(t.resolutionRatePct, 0)}</div>
                        </td>
                        <td style={{ padding: '11px 10px' }}>
                          <div style={{ height: 10, borderRadius: 5, background: ink(.07), overflow: 'hidden' }}>
                            <div style={{ width: `${Math.max(1.5, d.recovered / dispL2Max * 100)}%`, height: '100%', borderRadius: 5, background: `linear-gradient(90deg,${C.green},${C.cyan})`, transition: 'width 1.1s cubic-bezier(.32,.72,0,1)' }} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div style={{ marginTop: 12, fontSize: 12, color: txt(.5), lineHeight: 1.6 }}>
                {/* Small L2 buckets are rolled up rather than charted. One account at 100%
                    resolution would otherwise sit at the top of a "best disposition" list,
                    and that is not an insight — it is a single customer. */}
                {dispL2Small.count > 0 && (
                  <>Dispositions with fewer than {L2_MIN_N} accounts are not listed: {fmtInt(dispL2Small.count)} accounts
                  across {dispL2Small.kinds} L2 {dispL2Small.kinds === 1 ? 'value' : 'values'}, {fmtCr(dispL2Small.recovered)} recovered.
                  A 100% resolution rate on one account is a customer, not a finding. </>
                )}
                {dispL2Ptp && dispL2Paid && (
                  <>
                    <b style={{ color: '#C9302C' }}>The two to read together:</b> {fmtInt(dispL2Paid.total)} customers said the payment
                    was already made and {pct(dispL2Paid.resolutionPct, 1)} of them resolved.{' '}
                    {fmtInt(dispL2Ptp.total)} promised to pay later — only {pct(dispL2Ptp.resolutionPct, 1)} did.
                  </>
                )}
              </div>
            </div>
          </Card>
        )}

        {/* ===== Outstanding vs Recovery Analysis =====
            The exec's real question is not "how much did we recover" — it is "did we only
            win the small ones?". So this shows recovered AGAINST outstanding inside each
            balance band, with the recovery rate called out. A high headline recovery that
            comes entirely from the 20-30K band is a very different story from one spread
            across the book, and the difference is invisible on a totals card. */}
        <Card span={12} style={{ marginBottom: 16 }}>
          <Title t="Outstanding vs Recovery Analysis" s="Recovered against outstanding in every balance band — is the recovery coming from the whole book, or only the cheap end?" />
          <div style={{ display: 'flex', gap: 16, marginBottom: 18, flexWrap: 'wrap' }}>
            {[
              { l: 'Total outstanding', v: fmtCr(t.sumOut), c: C.indigo },
              { l: 'Recovered', v: fmtCr(t.recovered), c: C.green },
              { l: 'Still pending', v: fmtCr(t.outstandingPending), c: C.orange },
              { l: 'Recovery rate', v: pct(t.recoveryRatePct, 1), c: C.blue },
            ].map((m, i) => (
              <div key={i} style={{ flex: '1 1 160px', padding: '12px 14px', borderRadius: 14, background: ink(.03), border: `1px solid ${ink(.06)}` }}>
                <div style={{ fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em', color: txt(.5) }}>{m.l}</div>
                <div style={{ fontSize: 19, fontWeight: 700, color: m.c, fontVariantNumeric: 'tabular-nums', marginTop: 4 }}>{m.v}</div>
              </div>
            ))}
          </div>
          {ovr.map((r, i) => (
            <div key={i} style={{ marginBottom: 13 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 13, marginBottom: 5 }}>
                <span style={{ color: txt(.78), fontWeight: 600 }}>{r.band}</span>
                <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12.5 }}>
                  <b style={{ color: '#248A3D' }}>{fmtCr(r.recovered)}</b>
                  <span style={{ color: txt(.4) }}> recovered of </span>
                  <b style={{ color: txt(.8) }}>{fmtCr(r.outstanding)}</b>
                  <span style={{ color: r.recoveryPct >= t.recoveryRatePct ? '#248A3D' : '#C9302C', fontWeight: 700 }}>{'  '}{pct(r.recoveryPct, 1)}</span>
                </span>
              </div>
              {/* One bar, two segments: recovered (green) sits inside the band's total
                  outstanding (grey), and the bar's WIDTH is that band's share of the
                  biggest band. So you can see size and success at the same time. */}
              <div style={{ height: 14, borderRadius: 7, background: ink(.06), overflow: 'hidden' }}>
                <div style={{ width: `${Math.max(1.5, r.outstanding / ovrMax * 100)}%`, height: '100%', borderRadius: 7, background: ink(.12), overflow: 'hidden' }}>
                  <div style={{ width: `${r.recoveryPct}%`, height: '100%', borderRadius: 7, background: `linear-gradient(90deg,${C.green},#8BC34A)`, transition: 'width 1.1s cubic-bezier(.32,.72,0,1)' }} />
                </div>
              </div>
              <div style={{ fontSize: 11.5, color: txt(.42), marginTop: 4 }}>
                {fmtInt(r.count)} accounts · {fmtCr(r.pending)} still pending
              </div>
            </div>
          ))}
        </Card>

        {/* ===== Balance band + Region ===== */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12,1fr)', gap: 16, marginBottom: 16 }}>
          <Card span={6}>
            <Title t="Balance Band Performance" s="Outstanding & resolution by current balance band" />
            {A.bandOrder.map((b, i) => {
              const d = A.band[b] || {};
              return <Bar key={i} label={b} right={`${fmtCr(d.outstanding)} · ${pct(d.resolutionPct, 0)} res`} pctv={(d.outstanding || 0) / bandMax * 100}
                color={['#5AC8FA', '#0071E3', '#5856D6', '#AF52DE', '#FF2D55', '#FF3B30'][i]} sub={`${fmtInt(d.count)} accounts · ${fmtInt(d.resolved)} resolved`} />;
            })}
          </Card>
          <Card span={6}>
            <Title t="Region-wise Performance" s="Recovered value & resolution by region" />
            {regionOrder.map((r, i) => {
              const d = A.region[r];
              return <Bar key={i} label={r} right={`${fmtCr(d.recovered)} rec · ${pct(d.resolutionPct, 0)}`} pctv={d.outstanding / regionMax * 100}
                color={['#5856D6', '#0071E3', '#5AC8FA', '#34C759', '#FF9500'][i % 5]} sub={`${fmtInt(d.count)} accounts · ${fmtCr(d.outstanding)} outstanding · ${pct(d.connectPct, 0)} connect`} />;
            })}
          </Card>
        </div>

        {/* ===== RBL's own segment ===== */}
        {segments.length > 0 && (
          <Card span={12} style={{ marginBottom: 16 }}>
            <Title t="Performance by RBL Segment" s="The bank's own risk grade, scored against what actually recovered" />
            {segments.length > 1 ? (
              <>
                {segments.map((s, i) => (
                  <Bar key={i} label={s.name} right={`${fmtCr(s.recovered)} rec · ${pct(s.resolutionPct, 1)} res`}
                    pctv={(s.outstanding || 0) / segMax * 100}
                    color={SEG_COLOR[String(s.name).toLowerCase()] || ['#0071E3', '#5856D6', '#AF52DE', '#FF9500'][i % 4]}
                    sub={`${fmtInt(s.count)} accounts · ${fmtCr(s.outstanding)} outstanding · ${fmtInt(s.resolved)} resolved`} />
                ))}
              </>
            ) : (
              /* One segment on every account. Say so, rather than draw a single bar at
                 100% and let an exec think it means something. A bank respects being
                 told what the data cannot support far more than it respects a chart. */
              <div style={{ fontSize: 14, color: txt(.72), lineHeight: 1.65 }}>
                Every account in this file carries the same segment — <b style={{ color: txt(.92) }}>{segments[0].name}</b>{' '}
                ({fmtInt(segments[0].count)} accounts, {pct(segments[0].resolutionPct, 1)} resolved). This cycle <i>is</i> the {segments[0].name.toLowerCase()} book,
                so there is no second segment to compare it against, and no honest lift to report.
                <div style={{ marginTop: 10, color: txt(.55), fontSize: 13 }}>
                  Send a cycle that spans more than one segment and the comparison appears automatically.
                </div>
              </div>
            )}
          </Card>
        )}

        {/* ===== States + Dial efficiency ===== */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12,1fr)', gap: 16, marginBottom: 16 }}>
          <Card span={6}>
            <Title t="State-wise Performance" s="Where the book concentrates, and how each state is recovering" />
            {stateTop.map((s, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 11 }}>
                <div style={{ width: 120, fontSize: 13, color: txt(.72), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.state}</div>
                <div style={{ flex: 1, height: 9, borderRadius: 5, background: ink(.07), overflow: 'hidden' }}>
                  <div style={{ height: '100%', borderRadius: 5, width: `${s.outstanding / stateMax * 100}%`, background: 'linear-gradient(90deg,#0071E3,#5AC8FA)', transition: 'width 1.1s cubic-bezier(.32,.72,0,1)' }} />
                </div>
                <div style={{ width: 128, textAlign: 'right', fontSize: 12, fontVariantNumeric: 'tabular-nums', color: txt(.85) }}>{fmtCr(s.outstanding)} · {pct(s.resolutionPct, 0)}</div>
              </div>
            ))}
          </Card>
          <Card span={6}>
            <Title t="Dial Efficiency" s="Connect & resolution by number of attempts" />
            {I.dial.map((d, i) => (
              <div key={i} style={{ marginBottom: 13 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}>
                  <span style={{ color: txt(.68) }}>{d.band} attempts · n={fmtInt(d.n)}</span>
                  {/* A percentage of 6 accounts is not a rate. Print the count. */}
                  <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: d.thin ? ink(.45) : undefined }}>
                    {d.thin ? 'too few to rate' : `${pct(d.resolutionPct, 0)} resolved`}
                  </span>
                </div>
                {!d.thin && (
                  <div style={{ display: 'flex', gap: 4, height: 9 }}>
                    <div style={{ height: '100%', borderRadius: 5, width: `${d.connectPct}%`, background: C.cyan, opacity: .5 }} />
                    <div style={{ height: '100%', borderRadius: 5, width: `${d.resolutionPct}%`, background: C.green, marginLeft: -4 }} />
                  </div>
                )}
              </div>
            ))}
            <div style={{ fontSize: 11, color: txt(.4), marginTop: 6 }}>
              Faded = connect rate · Solid = resolution.
              {OW?.blindAccounts > 0
                ? <> Excludes {fmtInt(OW.blindAccounts)} accounts still being dialled after the outcome file was pulled ({fmtDay(OW.outcomeSeenTo)}) — their result is not known, and counting them as failures would drive the heavily-dialled bands to a false zero.</>
                : <> The dialler stops once an account resolves, so attempts and outcome are not independent — read this as description, not cause.</>}
            </div>
          </Card>
        </div>

        {/* ===== Top 20 ===== */}
        <Card span={12} className="print-breakable" style={{ marginBottom: 16 }}>
          <Title t="High Outstanding Accounts — Top 20" s="Prioritised by exposure — for the collections team" />
          <div className="table-scroll" style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ color: txt(.45), textAlign: 'left' }}>
                  {['#', 'Customer', 'State', 'Outstanding', 'AI Connected', 'PTP', 'Status'].map((h, i) => (
                    <th key={i} style={{ padding: '10px 12px', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em', borderBottom: '1px solid ' + ink(.08), textAlign: i >= 3 ? 'right' : 'left' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {A.topOutstanding.map((r, i) => (
                  <tr key={i} className="hover-row">
                    <td style={{ padding: '10px 12px', color: txt(.4), fontVariantNumeric: 'tabular-nums' }}>{i + 1}</td>
                    <td style={{ padding: '10px 12px', fontWeight: 600 }}>{r.name}</td>
                    <td style={{ padding: '10px 12px', color: txt(.65) }}>{r.state}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fmtCr(r.outstanding)}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: txt(.65) }}>{r.connected}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right' }}>{r.ptp ? <span style={{ color: C.green, fontWeight: 600 }}>Yes</span> : <span style={{ color: txt(.35) }}>—</span>}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                      <span style={{ fontSize: 11.5, fontWeight: 600, padding: '3px 9px', borderRadius: 999, background: (r.status === 'Resolved' ? C.green : C.orange) + '22', color: r.status === 'Resolved' ? C.green : C.orange }}>{r.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {/* ═══════════════ COMPLETE COLLECTION FUNNEL ═══════════════
            A real funnel — drawn as one continuous tapering vessel in SVG, not a stack of
            bars pretending to be one.

            THE DESIGN PROBLEM, AND THE HONEST ANSWER.
            A funnel only means anything if each stage is a strict subset of the one above:
            the shape narrowing IS the claim. Stages 1-3 satisfy that (7,042 → 7,042 →
            3,429). Stages 4-6 do not, and cannot: "Promise to Pay Later" (367) and "Paid"
            (1,363) are mutually-exclusive Disposition L2 values, so Paid is nearly FOUR
            TIMES the size of the stage above it. Drawing them as a continuing taper would
            require either widening the funnel — which looks broken — or fudging the widths,
            which is a lie an analyst catches in ten seconds.

            So the vessel tapers through the journey and then OPENS into a base, and the
            three outcomes are drawn as what they actually are: parallel channels flowing
            out of the neck, side by side, sized against the book. You get the funnel
            silhouette an exec expects and the arithmetic survives contact with scrutiny. */}
        <Card span={12} style={{ marginBottom: 16 }}>
          <Title t="Complete Collection Funnel" s="From RBL's full book to a resolved customer — and what each stage was actually worth" />

          {funnelGeom && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 30, alignItems: 'start', marginTop: 8 }}>

              {/* ── The vessel ─────────────────────────────────────────────────── */}
              <svg
                viewBox={`${-FUNNEL_PAD} -6 ${FW + FUNNEL_PAD * 2} ${funnelGeom.height + 10}`}
                style={{ width: '100%', height: 'auto', display: 'block' }}
              >
                <defs>
                  <linearGradient id="fnJourney" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0071E3" />
                    <stop offset="100%" stopColor="#5AC8FA" />
                  </linearGradient>
                  <linearGradient id="fnGood" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#34C759" />
                    <stop offset="100%" stopColor="#8BC34A" />
                  </linearGradient>
                  <linearGradient id="fnBad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#FF3B30" />
                    <stop offset="100%" stopColor="#FF7A70" />
                  </linearGradient>
                </defs>

                {/* Journey: one tapering body, each stage a trapezoid butted against the next
                    so it reads as a single vessel rather than a stack of separate shapes. */}
                {funnelGeom.journey.map((g, i) => (
                  <g key={i}>
                    <path d={g.path} fill="url(#fnJourney)" opacity={0.92 - i * 0.14} />
                    {/* Hairline between bands — enough to separate, not enough to fragment. */}
                    <line x1={g.x0} y1={g.y0} x2={g.x1} y2={g.y0} stroke="#fff" strokeWidth="1.5" opacity="0.85" />

                    <text x={FW / 2} y={g.yMid - 7} textAnchor="middle" fontSize="10.5" fontWeight="700"
                      fill="#fff" letterSpacing="0.3" style={{ paintOrder: 'stroke' }}>
                      {g.stage.stage.toUpperCase()}
                    </text>
                    <text x={FW / 2} y={g.yMid + 12} textAnchor="middle" fontSize="16" fontWeight="700" fill="#fff">
                      {fmtInt(g.stage.value)}
                      <tspan fontSize="10.5" fontWeight="500" opacity="0.85">{'  '}{pct(g.stage.pctOfBook, 1)}</tspan>
                    </text>

                    {/* Drop-off, called out in the margin. The gap between stages is the
                        story: 3,613 customers the AI dialled and never reached. */}
                    {g.drop > 0 && (
                      <>
                        <text x={g.x1 + 14} y={g.yMid - 2} fontSize="10" fontWeight="700" fill="#C9302C">
                          −{fmtInt(g.drop)}
                        </text>
                        <text x={g.x1 + 14} y={g.yMid + 11} fontSize="9" fill={txt(.45)}>
                          {pct(g.dropPct, 0)} lost
                        </text>
                      </>
                    )}

                    {/* Resolution rate of everything that reached this stage, on the left. */}
                    <text x={g.x0 - 14} y={g.yMid - 2} textAnchor="end" fontSize="10" fontWeight="700"
                      fill={g.stage.resolutionPct >= t.resolutionRatePct ? '#248A3D' : ink(.5)}>
                      {pct(g.stage.resolutionPct, 1)}
                    </text>
                    <text x={g.x0 - 14} y={g.yMid + 11} textAnchor="end" fontSize="9" fill={txt(.4)}>
                      resolved
                    </text>
                  </g>
                ))}

                {/* Where the journey ends and outcomes begin. A dashed rule here used to be
                    drawn AT the neck's y — which is exactly the bottom edge of the last band,
                    so it painted over the blue rather than under it. The caption and the
                    curves already carry the message; the rule was noise. */}
                <text x={FW / 2} y={funnelGeom.neck.y + 20} textAnchor="middle" fontSize="9" fontWeight="700"
                  letterSpacing="1.2" fill={txt(.42)}>
                  OUTCOMES — PARALLEL, NOT SEQUENTIAL
                </text>

                {/* Outcomes: three channels flowing out of the neck. Curved connectors, so
                    it reads as liquid leaving the funnel rather than three unrelated bars. */}
                {funnelGeom.outcomes.map((o, i) => (
                  <g key={i}>
                    <path d={o.link} fill="none" stroke={o.good ? '#34C759' : '#FF3B30'} strokeWidth="1.25" opacity="0.35" />
                    {/* The label sits ABOVE the channel. A 5.2% channel is 66px wide — it
                        cannot hold the words "PROMISE TO PAY LATER" inside it, and trying
                        clipped it to "SE TO PAY L". */}
                    {o.label.map((line, k) => (
                      <text key={k} x={o.x + o.w / 2} y={o.y - 16 + k * 11} textAnchor="middle"
                        fontSize="9" fontWeight="700" letterSpacing="0.4" fill={txt(.6)}>
                        {line}
                      </text>
                    ))}
                    <rect x={o.x} y={o.y} width={o.w} height={o.h} rx="8"
                      fill={o.good ? 'url(#fnGood)' : 'url(#fnBad)'} opacity="0.95" />
                    <text x={o.x + o.w / 2} y={o.y + o.h / 2 + 6} textAnchor="middle" fontSize="17" fontWeight="700" fill="#fff">
                      {fmtInt(o.stage.value)}
                    </text>
                    <text x={o.x + o.w / 2} y={o.y + o.h + 15} textAnchor="middle" fontSize="9.5" fill={txt(.5)}>
                      {pct(o.stage.pctOfBook, 1)} of book
                    </text>
                    {o.stage.n < A.funnel.length && (
                      <text x={o.x + o.w / 2} y={o.y + o.h + 28} textAnchor="middle" fontSize="10" fontWeight="700"
                        fill={o.good ? '#248A3D' : '#C9302C'}>
                        {pct(o.stage.resolutionPct, 1)} resolved
                      </text>
                    )}
                  </g>
                ))}
              </svg>

              {/* ── The stage ledger. The chart is the picture; this is the receipt. ── */}
              <div>
                {A.funnel.map((f, i) => {
                  const prev = i > 0 ? A.funnel[i - 1] : null;
                  const step = prev && prev.kind === 'journey' && f.kind === 'journey' && prev.value
                    ? f.value / prev.value * 100 : null;
                  const good = f.resolutionPct >= t.resolutionRatePct;
                  return (
                    <div key={i} style={{ padding: '10px 0', borderTop: i ? `1px solid ${ink(.07)}` : 'none' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                        <span style={{ fontSize: 12.5 }}>
                          <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: 2, marginRight: 8,
                            background: f.kind === 'journey' ? C.blue : (good ? C.green : C.red) }} />
                          <b style={{ color: txt(.9) }}>{f.stage}</b>
                        </span>
                        <span style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtInt(f.value)}</span>
                      </div>
                      <div style={{ fontSize: 11, color: txt(.45), marginLeft: 15, marginTop: 2 }}>
                        {pct(f.pctOfBook, 1)} of book{step !== null ? ` · ${pct(step, 0)} step` : ''}
                        {f.n < A.funnel.length && (
                          <> · <b style={{ color: good ? '#248A3D' : '#C9302C' }}>{pct(f.resolutionPct, 1)} resolved</b></>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {ptpStage && paidStage && ptpStage.resolutionPct < paidStage.resolutionPct && (
            <div style={{ marginTop: 18, padding: '14px 16px', borderRadius: 14, background: 'rgba(255,59,48,.06)', border: '1px solid rgba(255,59,48,.18)', fontSize: 13, color: txt(.75), lineHeight: 1.6 }}>
              <b style={{ color: '#C9302C' }}>Read the two outcome channels together.</b>{' '}
              {fmtInt(ptpStage.value)} customers promised to pay later, and only {pct(ptpStage.resolutionPct, 1)} of them did.
              {' '}{fmtInt(paidStage.value)} said the payment was already made, and {pct(paidStage.resolutionPct, 1)} of those resolved.
              A promise is the weakest signal in this book.
            </div>
          )}
        </Card>

        {/* ===== Conversation Duration × Disposition L2 =====
            L1 tells you the agent got a "Paid" or a "Callback". L2 tells you WHY — and
            once you cross it with talk time, the book stops averaging out. The longest
            calls in the book are not the ones that recover; they are the ones that end
            in a promise. That is invisible at L1. */}
        {durL2.length > 0 && (
          <Card span={12} className="print-breakable" style={{ marginBottom: 16, padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '22px 22px 0' }}>
              <Title t="Conversation Duration Analysis — by Disposition L2" s="How long the AI talked, and what the customer actually said — resolution rate in every cell" />
            </div>
            <div className="table-scroll" style={{ overflowX: 'auto', padding: '4px 22px 22px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 860 }}>
                <thead>
                  <tr>
                    <th style={l2Th('left', 260)}>Disposition L2</th>
                    <th style={l2Th('right', 74)}>Accounts</th>
                    <th style={l2Th('right', 86)}>Avg talk</th>
                    <th style={l2Th('right', 84)}>Resolution</th>
                    {A.durationOrder.map((b) => <th key={b} style={l2Th('center', 84)}>{b}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {durL2.map((d, i) => (
                    <tr key={i} style={{ borderTop: `1px solid ${ink(.07)}` }}>
                      <td style={{ padding: '11px 10px', fontWeight: 600, color: txt(.9) }}>{d.name}</td>
                      <td style={{ padding: '11px 10px', textAlign: 'right', color: txt(.62), fontVariantNumeric: 'tabular-nums' }}>{fmtInt(d.n)}</td>
                      <td style={{ padding: '11px 10px', textAlign: 'right', color: txt(.62), fontVariantNumeric: 'tabular-nums' }}>{mmss(d.avgSeconds)}</td>
                      <td style={{ padding: '11px 10px', textAlign: 'right', fontWeight: 700, color: durColor(d.resolutionPct), fontVariantNumeric: 'tabular-nums' }}>{pct(d.resolutionPct, 1)}</td>
                      {d.buckets.map((b, j) => (
                        <td key={j} style={{ padding: 4, textAlign: 'center' }}>
                          {/* An empty cell is drawn as empty. A cell with 3 accounts in it is
                              NOT drawn as "100%" — that is noise, and a heat map makes noise
                              look like the strongest finding on the page. */}
                          {b.n === 0 ? (
                            <span style={{ color: txt(.2) }}>·</span>
                          ) : (
                            <div title={`${b.n} account${b.n === 1 ? '' : 's'}`} style={{
                              borderRadius: 6, padding: '7px 4px',
                              background: b.n < 10 ? ink(.04) : `${durColor(b.resolutionPct)}${heatAlpha(b.resolutionPct)}`,
                              color: b.n < 10 ? ink(.45) : ink(.92),
                              fontWeight: b.n < 10 ? 400 : 700, fontVariantNumeric: 'tabular-nums',
                            }}>
                              {b.n < 10 ? `n=${b.n}` : pct(b.resolutionPct, 0)}
                              <div style={{ fontSize: 10, fontWeight: 400, color: txt(.45), marginTop: 1 }}>{b.n >= 10 ? `n=${fmtInt(b.n)}` : ''}</div>
                            </div>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ marginTop: 12, fontSize: 12, color: txt(.5), lineHeight: 1.6 }}>
                Shaded cells are resolution rate; cells with fewer than 10 accounts show the raw count instead, because a
                percentage of eight accounts is not a finding.
                {A.l2BelowThreshold > 0 && ` ${fmtInt(A.l2BelowThreshold)} accounts sit in L2 dispositions with fewer than ${A.l2Min} accounts each and are not charted.`}
                {OW?.blindAccounts > 0 && ` Excludes ${fmtInt(OW.blindAccounts)} accounts still being dialled after the outcome file was pulled (${fmtDay(OW.outcomeSeenTo)}) — their result is not yet known, so counts here are lower than in the Disposition L2 table above, which is the full book.`}
                {l2Longest && l2Longest.resolutionPct < t.resolutionRatePct && (
                  <>
                    {' '}<b style={{ color: '#C9302C' }}>Note the top of the &quot;Avg talk&quot; column:</b> the longest conversations in this book end in{' '}
                    <b>{l2Longest.name}</b> ({mmss(l2Longest.avgSeconds)} average) and resolve at just {pct(l2Longest.resolutionPct, 1)} —
                    below the {pct(t.resolutionRatePct, 1)} book rate. Talk time alone is not the goal; what the customer commits to is.
                  </>
                )}
              </div>
            </div>
          </Card>
        )}

        {/* ===== Recoverable Opportunity ===== */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12,1fr)', gap: 16, marginBottom: 16 }}>
          <Card span={12}>
            <Title t="Recoverable Opportunity" s="The open book, and what to work next" />
            <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-.02em', fontVariantNumeric: 'tabular-nums' }}>{fmtCr(I.opportunity.openOutstanding)}</div>
            <div style={{ fontSize: 12.5, color: txt(.48), marginBottom: 16 }}>still outstanding across {fmtInt(t.unresolved)} open accounts</div>
            {I.opportunity.lists.map((l, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderTop: '1px solid ' + ink(.07) }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: txt(.8) }}>{l.label}</div>
                  <div style={{ fontSize: 11.5, color: txt(.45) }}>{l.note} · {fmtInt(l.count)} accounts</div>
                </div>
                <div style={{ fontSize: 15, fontWeight: 700, color: [C.green, C.blue, C.orange][i], fontVariantNumeric: 'tabular-nums' }}>{fmtCr(l.amount)}</div>
              </div>
            ))}
          </Card>
        </div>

        {/* ===== Account Explorer (server-side paginated) =====
            Excluded from print: on paper it is 15 rows of a 7,042-row paginated table —
            a meaningless fragment that costs three pages.

            NEVER rendered on a share link. This table is names, mobile numbers and
            19-digit account numbers. The fetch behind it is already blocked upstream;
            this is the second lock on the same door, because one lock on a bank's
            customer list is not enough. */}
        {!shareToken && (
        <Card span={12} className="no-print-explorer">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
            <Title t="Account Explorer" s={`${fmtInt(ex.total)} of ${fmtInt(t.accounts)} accounts${exLoading ? ' · updating…' : ''}`} />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <input value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="Search name, account, mobile…"
                style={{ padding: '10px 16px', fontSize: 13, borderRadius: 999, border: '1px solid ' + ink(.14), background: 'var(--input-bg)', outline: 'none', color: 'var(--text)', width: 240 }} />
              {[['Status', fStatus, setFStatus], ['Region', fRegion, setFRegion], ['Band', fBand, setFBand], ['Disposition', fDisp, setFDisp]].map(([key, val, set], i) => (
                <select key={i} value={val} onChange={(e) => { set(e.target.value); setPage(0); }}
                  style={{ padding: '10px 32px 10px 16px', fontSize: 13, borderRadius: 999, border: '1px solid ' + ink(.14), background: 'var(--input-bg)', outline: 'none', color: 'var(--text)' }}>
                  {['All', ...((ex.filters && ex.filters[key]) || [])].map((o) => <option key={o} value={o}>{o === 'All' ? `All ${key}s` : o}</option>)}
                </select>
              ))}
            </div>
          </div>
          <div className="table-scroll" style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ color: txt(.45), textAlign: 'left' }}>
                  {[['Customer', 'Name'], ['Status', 'Status'], ['Disposition', 'Disposition'], ['Region', 'Region'], ['Band', 'Band'], ['Outstanding', 'Outstanding'], ['Recovered', 'Recovered'], ['Att', 'Attempts'], ['Conn', 'Connected'], ['Lead', null]].map(([h, key], i) => {
                    const sortable = key && ['Outstanding', 'Recovered', 'Attempts', 'Connected'].includes(key);
                    return (
                      <th key={i} onClick={() => { if (sortable) { setSortKey(key); setSortDir(sortKey === key && sortDir === 'desc' ? 'asc' : 'desc'); setPage(0); } }}
                        style={{ padding: '10px 12px', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em', borderBottom: '1px solid ' + ink(.08), textAlign: i >= 5 && i <= 8 ? 'right' : 'left', cursor: sortable ? 'pointer' : 'default', whiteSpace: 'nowrap' }}>
                        {h}{sortKey === key ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r, i) => (
                  <tr key={i} className="hover-row">
                    <td style={{ padding: '10px 12px' }}>
                      <div style={{ fontWeight: 600 }}>{r[IDX.Name]}</div>
                      <div style={{ fontSize: 11, color: txt(.4), fontVariantNumeric: 'tabular-nums' }}>•••• {String(r[IDX.Mobile]).slice(-4)}</div>
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <span style={{ fontSize: 11.5, fontWeight: 600, padding: '3px 9px', borderRadius: 999, background: (r[IDX.Status] === 'Resolved' ? C.green : C.orange) + '22', color: r[IDX.Status] === 'Resolved' ? C.green : C.orange }}>{r[IDX.Status]}</span>
                    </td>
                    <td style={{ padding: '10px 12px', color: txt(.65) }}>{r[IDX.Disposition]}</td>
                    <td style={{ padding: '10px 12px', color: txt(.65) }}>{r[IDX.Region]}</td>
                    <td style={{ padding: '10px 12px', color: txt(.65) }}>{r[IDX.Band]}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fmtCr(r[IDX.Outstanding])}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: r[IDX.Recovered] > 0 ? C.green : ink(.3) }}>{r[IDX.Recovered] > 0 ? fmtCr(r[IDX.Recovered]) : '—'}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: txt(.6) }}>{r[IDX.Attempts]}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: txt(.6) }}>{r[IDX.Connected]}</td>
                    <td style={{ padding: '10px 12px' }}>
                      {r[IDX.Lead] ? <a href={r[IDX.Lead]} target="_blank" rel="noreferrer" style={{ color: C.blue, fontWeight: 600, textDecoration: 'none', fontSize: 12 }}>Open ↗</a> : <span style={{ color: txt(.3) }}>—</span>}
                    </td>
                  </tr>
                ))}
                {pageRows.length === 0 && (
                  <tr><td colSpan={10} style={{ padding: '28px 12px', textAlign: 'center', color: txt(.4) }}>{exLoading ? 'Loading…' : 'No matching accounts'}</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 }}>
            <div style={{ fontSize: 12.5, color: txt(.5) }}>Page {cur + 1} of {totalPages}</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setPage(Math.max(0, cur - 1))} disabled={cur === 0}
                style={{ padding: '8px 16px', fontSize: 13, fontWeight: 600, borderRadius: 999, border: '1px solid ' + ink(.14), background: cur === 0 ? ink(.03) : 'var(--input-bg, rgba(255,255,255,.7))', color: cur === 0 ? ink(.3) : 'var(--text,#1D1D1F)', cursor: cur === 0 ? 'default' : 'pointer' }}>Previous</button>
              <button onClick={() => setPage(Math.min(totalPages - 1, cur + 1))} disabled={cur >= totalPages - 1}
                style={{ padding: '8px 16px', fontSize: 13, fontWeight: 600, borderRadius: 999, border: '1px solid ' + ink(.14), background: cur >= totalPages - 1 ? ink(.03) : 'var(--input-bg, rgba(255,255,255,.7))', color: cur >= totalPages - 1 ? ink(.3) : 'var(--text,#1D1D1F)', cursor: cur >= totalPages - 1 ? 'default' : 'pointer' }}>Next</button>
            </div>
          </div>
        </Card>
        )}

        <div style={{ textAlign: 'center', fontSize: 12, color: txt(.4), marginTop: 40, lineHeight: 1.7 }}>
          Convin × RBL Bank · Recovery Intelligence · {data.meta.reportDate} · Recovered value counts full outstanding on resolved accounts.
          {shareToken && share && (
            <div style={{ marginTop: 8, color: txt(.35) }}>
              {/* The watermark. Quiet, but on every page and in every screenshot. */}
              Confidential · shared read-only{share.label ? ` with ${share.label}` : ''} · no customer names, mobile numbers
              or account numbers are included in this view.
            </div>
          )}
        </div>
        </>)}
      </div>
    </div>
  );
}
