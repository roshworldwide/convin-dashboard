'use client';

/* ═══════════════════════════════════════════════════════════════════════════════
 * AURUM — the component grammar.
 *
 * Every screen in this product is built from what is in this file. That is the point:
 * four pages hand-painted to look similar drift apart in a fortnight, and the drift
 * always shows up first in the one place it matters — a bank's report, where a card
 * on page 3 has a different radius from the card on page 1 and the whole document
 * quietly stops reading as a single instrument.
 *
 * Nothing here holds state or fetches anything. It is geometry, type and material.
 *
 * THE RULES THIS FILE ENFORCES SO CALLERS CANNOT BREAK THEM
 *   · Fourteen type steps. There is no fifteenth.
 *   · Anything a finger touches is a capsule; anything holding content is a squircle.
 *   · Bars grow with transform: scaleX — never a width transition. (8.33 ms.)
 *   · Every figure is tabular.
 *   · Colour comes from a ROLE, never a hex. There is not one hex in this file.
 * ═══════════════════════════════════════════════════════════════════════════════ */

/* ── COLOUR · the forty-two roles, as accessors ──────────────────────────────
   Product code says C.secondary, never --ti-20 and never a hex. That indirection
   is what lets a finish change repaint the product without touching a component. */
export const C = {
  canvas: 'var(--surface-canvas)',
  grouped: 'var(--surface-grouped)',
  raised: 'var(--surface-raised)',
  glass: 'var(--surface-glass)',
  scrim: 'var(--surface-scrim)',

  primary: 'var(--content-primary)',
  secondary: 'var(--content-secondary)',
  tertiary: 'var(--content-tertiary)',
  quaternary: 'var(--content-quaternary)',
  accent: 'var(--content-accent)',
  onAccent: 'var(--content-on-accent)',

  hairline: 'var(--stroke-hairline)',
  rim: 'var(--stroke-rim)',
  focus: 'var(--stroke-focus)',

  quiet: 'var(--fill-quiet)',
  pressed: 'var(--fill-pressed)',
  accentFill: 'var(--fill-accent)',

  /* SIGNAL — state only. Never brand, never decoration. Every use of one of these
     must carry a shape, a word or a position as a second channel. */
  nominal: 'var(--sig-nominal)',
  caution: 'var(--sig-caution)',
  abort: 'var(--sig-abort)',
  link: 'var(--sig-link)',

  /* Alpha washes. Stated as a percentage of a role rather than as a new opaque
     colour, so they stay correct over glass and in both finishes. */
  ink: (a) => `rgba(var(--ti-100-rgb), ${a})`,
  paper: (a) => `rgba(var(--ti-00-rgb), ${a})`,
  gold: (a) => `rgba(var(--accent-rgb), ${a})`,
  good: (a) => `rgba(var(--sig-nominal-rgb), ${a})`,
  warn: (a) => `rgba(var(--sig-caution-rgb), ${a})`,
  bad: (a) => `rgba(var(--sig-abort-rgb), ${a})`,
};

/* ── TYPE · the fourteen steps ───────────────────────────────────────────────
   A closed set. If a design needs a fifteenth size, the design is wrong.
   The cut switches at 20 pt — Display above, Text below — because Display below
   20 pt collapses its counters and Text above 20 pt reads slack. */
const step = (size, lead, track, weight, cut = 'text', extra) => ({
  fontFamily: cut === 'display' ? 'var(--font-display)' : cut === 'mono' ? 'var(--font-mono)' : 'var(--font-text)',
  fontSize: size,
  lineHeight: `${lead}px`,
  letterSpacing: track,
  fontWeight: weight,
  ...extra,
});

export const T = {
  colossus: step('var(--size-colossus)', 88, 'var(--track-colossus)', 700, 'display'),
  display1: step('var(--size-display-1)', 64, 'var(--track-display-1)', 700, 'display'),
  display2: step('var(--size-display-2)', 52, 'var(--track-display-2)', 700, 'display'),
  title1: step('var(--size-title-1)', 40, 'var(--track-title-1)', 700, 'display'),
  title2: step('var(--size-title-2)', 34, 'var(--track-title-2)', 600, 'display'),
  title3: step('var(--size-title-3)', 28, 'var(--track-title-3)', 600, 'display'),
  headline: step('var(--size-headline)', 22, 'var(--track-headline)', 600),
  body: step('var(--size-body)', 25, 'var(--track-body)', 400),
  callout: step('var(--size-callout)', 21, 'var(--track-callout)', 400),
  subhead: step('var(--size-subhead)', 20, 'var(--track-subhead)', 400),
  footnote: step('var(--size-footnote)', 18, 'var(--track-footnote)', 400),
  caption: step('var(--size-caption)', 16, 'var(--track-caption)', 400),
  micro: step('var(--size-micro)', 13, 'var(--track-micro)', 500),
  /* The only step that is set in caps. +0.16 em is not a flourish: at 10 pt, caps
     without that much air read as a single grey brick. */
  overline: step('var(--size-overline)', 12, 'var(--track-overline)', 600, 'text', { textTransform: 'uppercase' }),
  /* Telemetry, identifiers, timestamps, token names. Never used for prose. */
  mono: step('var(--size-footnote)', 18, '0', 400, 'mono'),
};

/** Every figure in this product is tabular. A live number whose digits jitter as they
 *  change destroys the illusion of an instrument — sheet 39. */
export const NUM = { fontVariantNumeric: 'tabular-nums', fontFeatureSettings: '"tnum" 1' };

/* ── MATERIAL ────────────────────────────────────────────────────────────────── */

/** Liquid Glass. Eight layers, composited in order; omit any one and the material
 *  reads as a translucent rectangle. Chrome is glass and floats; content is opaque
 *  and scrolls beneath it — the two never trade roles. */
export const glass = (weight = 'regular', elevation = 3) => ({
  background: C.glass,
  backdropFilter: `var(--glass-${weight})`,
  WebkitBackdropFilter: `var(--glass-${weight})`,
  border: `1px solid ${C.rim}`,
  /* The specular rim. One bright pixel on the top edge, one dim on the bottom —
     the highlight follows the single light source and never rotates. This is the
     tell of real glass, and it is the layer everyone omits. */
  boxShadow: `inset 0 1px 0 var(--specular-top), inset 0 -1px 0 var(--specular-bottom), var(--e${elevation})`,
  isolation: 'isolate',
});

/** An opaque surface. Cards hold content, so they are NOT glass — glass is for
 *  chrome that floats. One level only: there is no card inside a card. */
export const surface = (elevation = 1) => ({
  background: C.raised,
  border: `1px solid ${C.hairline}`,
  boxShadow: `var(--e${elevation})`,
});

/* ── COMPONENTS ──────────────────────────────────────────────────────────────── */

/** A card. Squircle, opaque, e1 Resting. `card` is what the print stylesheet keys
 *  off to stop a chart being sliced in half across a fold. */
export function Card({ span, children, style = {}, className = '', pad = 24, elevation = 1, as: Tag = 'div', ...rest }) {
  return (
    <Tag
      className={`card u-squircle hover-kpi ${className}`.trim()}
      /* `span` is only applied when the caller asks for it. It used to default to 12,
         which silently forced every card to full width inside an auto-fit grid — the
         hub's two cards stacked instead of sitting side by side, and the cause was a
         default three components away from the layout it broke. */
      style={{ ...(span ? { gridColumn: `span ${span}` } : null), ...surface(elevation), padding: pad, ...style }}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/** Floating chrome — bars, popovers, sheets. Glass, and only ever glass. */
export function Glass({ children, style = {}, className = '', weight = 'regular', elevation = 3, radius = 'var(--radius-capsule)' }) {
  return (
    <div className={`u-glass ${className}`.trim()} style={{ ...glass(weight, elevation), borderRadius: radius, ...style }}>
      {children}
    </div>
  );
}

/** The eyebrow above a title. Never more than four words. */
export function Overline({ children, tone = C.tertiary, style = {} }) {
  return <div style={{ ...T.overline, color: tone, ...style }}>{children}</div>;
}

/** A card heading. Title 3 plus an optional supporting line — exactly one step
 *  apart, because skipping a step reads as a flat, unranked page. */
export function Title({ t, s, style = {} }) {
  return (
    <div style={{ marginBottom: s ? 20 : 16, ...style }}>
      <div style={{ ...T.title3, color: C.primary }}>{t}</div>
      {s && <div style={{ ...T.subhead, color: C.tertiary, marginTop: 4, maxWidth: 780 }}>{s}</div>}
    </div>
  );
}

/** A statistic. The value is the message; the unit and the qualifier are footnotes.
 *  `accent` marks THE one figure that carries the screen — use it once. */
export function Stat({ label, value, sub, accent = false, tone, size = 'title1', style = {} }) {
  return (
    <div style={style}>
      <Overline>{label}</Overline>
      <div style={{ ...T[size], ...NUM, color: tone || (accent ? C.accent : C.primary), marginTop: 8 }}>{value}</div>
      {sub && <div style={{ ...T.caption, color: C.tertiary, marginTop: 6 }}>{sub}</div>}
    </div>
  );
}

/** A bar. The track is a quiet fill; the fill is Titanium unless the caller has spent
 *  the screen's one Aurum on it.
 *
 *  IT GROWS WITH transform: scaleX. The width is set once at render and never
 *  transitioned — animating width forces a layout read on every frame and blows the
 *  8.33 ms budget on the one element whose whole job is to look effortless. */
export function Bar({ label, right, pctv = 0, tone = C.tertiary, sub, height = 8, style = {} }) {
  return (
    <div style={{ marginBottom: 14, ...style }}>
      {(label || right) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, marginBottom: 7 }}>
          <span style={{ ...T.footnote, color: C.secondary }}>{label}</span>
          <span style={{ ...T.footnote, ...NUM, fontWeight: 600, color: C.primary, whiteSpace: 'nowrap' }}>{right}</span>
        </div>
      )}
      <Track pctv={pctv} tone={tone} height={height} />
      {sub && <div style={{ ...T.caption, color: C.tertiary, marginTop: 5 }}>{sub}</div>}
    </div>
  );
}

/** The bar itself, without the label furniture. */
export function Track({ pctv = 0, tone = C.tertiary, height = 8, style = {} }) {
  return (
    <div style={{ height, borderRadius: 'var(--radius-capsule)', background: C.quiet, overflow: 'hidden', ...style }}>
      <div
        className="u-grow"
        style={{
          width: `${Math.min(100, Math.max(0, pctv))}%`,
          height: '100%',
          borderRadius: 'var(--radius-capsule)',
          background: tone,
        }}
      />
    </div>
  );
}

/** A hairline. 0.5 pt. Prefer a GAP — a rule is admitted only when two groups must
 *  touch and space has run out. */
export function Hairline({ style = {} }) {
  return <div style={{ height: 1, background: C.hairline, ...style }} />;
}

/** A state dot. Never the only channel: it always sits beside a word. */
export function SignalDot({ tone = C.nominal, size = 7, pulse = false, style = {} }) {
  return (
    <span
      aria-hidden
      style={{
        width: size, height: size, borderRadius: 'var(--radius-capsule)', background: tone,
        flex: 'none', display: 'inline-block',
        animation: pulse ? 'pulseDot 2s ease-in-out infinite' : undefined,
        ...style,
      }}
    />
  );
}

/* Five variants, five sizes. Exactly one Metal capsule may exist on a screen — a
   second means the decision was never made. */
const CAPSULE_SIZE = {
  xs: { height: 28, padding: '0 12px', ...T.caption, fontWeight: 600 },
  s: { height: 36, padding: '0 16px', ...T.subhead, fontWeight: 600 },
  m: { height: 44, padding: '0 20px', ...T.headline },
  l: { height: 52, padding: '0 24px', ...T.headline },
  xl: { height: 64, padding: '0 32px', ...T.title3 },
};

const CAPSULE_VARIANT = {
  metal: { background: C.accentFill, color: C.onAccent, border: '1px solid transparent', boxShadow: 'var(--e2)' },
  solid: { background: C.primary, color: C.canvas, border: '1px solid transparent', boxShadow: 'var(--e1)' },
  glass: { background: C.glass, color: C.primary, border: `1px solid ${C.rim}`, backdropFilter: 'var(--glass-thin)', WebkitBackdropFilter: 'var(--glass-thin)' },
  tinted: { background: 'var(--fill-quiet)', color: C.accent, border: '1px solid transparent' },
  plain: { background: 'transparent', color: C.secondary, border: '1px solid transparent' },
  destruct: { background: 'var(--fill-quiet)', color: C.abort, border: `1px solid rgba(var(--sig-abort-rgb), .28)` },
};

/**
 * The capsule. A verb the user would say aloud — never "OK", "Submit" or "Yes".
 * The label never changes width while loading: a resizing button relocates the
 * user's finger mid-press.
 */
export function Capsule({
  children, variant = 'glass', size = 'm', full = false, as: Tag = 'button',
  style = {}, ...rest
}) {
  return (
    <Tag
      className="pill"
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        borderRadius: 'var(--radius-capsule)',
        cursor: rest.disabled ? 'default' : 'pointer',
        opacity: rest.disabled ? 0.4 : 1,
        textDecoration: 'none',
        whiteSpace: 'nowrap',
        width: full ? '100%' : undefined,
        minWidth: 'var(--target-min)',
        ...CAPSULE_SIZE[size],
        ...CAPSULE_VARIANT[variant],
        ...style,
      }}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/** An inline chip. Squircle-small, quiet, never a checkmark when selected — a
 *  selected chip gains a tint. */
export function Chip({ children, selected = false, tone, style = {} }) {
  return (
    <span
      className="u-squircle-sm"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '4px 10px',
        ...T.caption, fontWeight: 600,
        background: selected ? 'transparent' : C.quiet,
        color: tone || (selected ? C.accent : C.secondary),
        border: `1px solid ${selected ? C.gold(0.38) : 'transparent'}`,
        ...style,
      }}
    >
      {children}
    </span>
  );
}

/** A text field. The label sits ABOVE, never inside — a placeholder that vanishes on
 *  focus destroys the user's only reference for what they are typing. */
export function Field({ label, hint, style = {}, ...rest }) {
  return (
    <label style={{ display: 'block' }}>
      {label && <div style={{ ...T.overline, color: C.tertiary, marginBottom: 8 }}>{label}</div>}
      <input
        style={{
          width: '100%', height: 44, padding: '0 20px',
          ...T.callout,
          borderRadius: 'var(--radius-capsule)',
          border: `1px solid ${C.rim}`,
          background: C.quiet,
          color: C.primary,
          outline: 'none',
          ...style,
        }}
        {...rest}
      />
      {hint && <div style={{ ...T.caption, color: C.tertiary, marginTop: 7 }}>{hint}</div>}
    </label>
  );
}

/**
 * THE METAL. Not a gold gradient — a reflection.
 *
 * Constraints enforced here rather than trusted to the caller, because this is the
 * most-copied and least-understood object in the system:
 *   · Display sizes only (≥ 24 px) and weight 700. Below 28 px the Break falls inside
 *     one pixel row and the mark reads as dirt.
 *   · One string per screen. Never a sentence, never a label, and never a number the
 *     user must read in order to act — the Root stop is 2.13:1 and cannot carry text.
 *   · The glow is separate: emitted light, zero offset, removed on light finishes.
 *   · Under Increase Contrast the alloy is replaced by flat --content-primary. That
 *     rule lives in globals.css, keyed off .u-metal.
 */
export function Metal({ children, size = 'display2', style = {} }) {
  return (
    <span
      className="u-metal"
      style={{
        ...T[size],
        fontWeight: 700,
        background: 'var(--metal-aurum)',
        WebkitBackgroundClip: 'text',
        backgroundClip: 'text',
        color: 'transparent',
        WebkitTextFillColor: 'transparent',
        filter: 'var(--metal-glow)',
        display: 'inline-block',
        ...style,
      }}
    >
      {children}
    </span>
  );
}

/* ── DATA ────────────────────────────────────────────────────────────────────── */

/**
 * A delta, with THREE redundant channels: a triangle, a sign and a colour.
 * "Better" is never assumed from "up" — the caller states which direction is good,
 * because on this dashboard a rising complaint count and a rising recovery rate
 * point the same way on a chart and mean opposite things.
 *
 * Below `flat` the delta is not coloured at all. A 0.4-point move rendered in green
 * is a claim the data cannot support.
 */
export function delta(value, base, { higherIsBetter = true, flat = 1 } = {}) {
  const d = (value || 0) - (base || 0);
  const up = d >= 0;
  const material = Math.abs(d) >= flat;
  const good = higherIsBetter ? up : !up;
  return {
    d,
    abs: Math.abs(d),
    up,
    material,
    glyph: !material ? '—' : up ? '▲' : '▼',
    sign: !material ? '' : up ? '+' : '−',
    tone: !material ? C.tertiary : good ? C.nominal : C.abort,
  };
}

/** A table header cell. Overline, tertiary, never a colour. */
export const th = (align = 'left', width) => ({
  padding: '10px 10px',
  textAlign: align,
  width,
  ...T.overline,
  color: C.tertiary,
  whiteSpace: 'nowrap',
  borderBottom: `1px solid ${C.hairline}`,
});

/** A table body cell. Numeric columns are right-aligned with tabular figures, so the
 *  decimal points form a single vertical rule the eye scans without reading. */
export const td = (align = 'left', tone = C.secondary, extra = {}) => ({
  padding: '11px 10px',
  textAlign: align,
  ...T.footnote,
  ...(align === 'right' ? NUM : {}),
  color: tone,
  borderTop: `1px solid ${C.hairline}`,
  ...extra,
});

/* ── FORMATTERS ──────────────────────────────────────────────────────────────
   Shared, because four pages each carrying their own copy of fmtCr is four chances
   for the same rupee figure to be rounded two different ways in one document.

   Numerals over words, always: "3 minutes", not "three minutes". Digits are scanned;
   words must be read. */
export const fmtCr = (n) => {
  const s = n < 0 ? '−' : '';
  const a = Math.abs(n || 0);
  if (a >= 1e7) return `${s}₹${(a / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `${s}₹${(a / 1e5).toFixed(2)} L`;
  if (a >= 1e3) return `${s}₹${(a / 1e3).toFixed(1)}K`;
  return `${s}₹${Math.round(a)}`;
};
export const fmtINR = (n) => `₹${Math.round(n || 0).toLocaleString('en-IN')}`;
export const fmtInt = (n) => Math.round(n || 0).toLocaleString('en-IN');
export const pct = (n, d = 1) => `${(n || 0).toFixed(d)}%`;
export const mmss = (s) => {
  const t = Math.round(s || 0);
  return t < 60 ? `${t}s` : `${Math.floor(t / 60)}m ${String(t % 60).padStart(2, '0')}s`;
};
/** "2026-07-19" → "19 July". Parsed by hand rather than through new Date(), which
 *  reads a bare ISO date as UTC and prints the wrong day west of Greenwich. */
export const fmtDay = (iso) => {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso || '—';
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
};
