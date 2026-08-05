import "./globals.css";

/* ─────────────────────────────────────────────────────────────────────────────
 * SF PRO, AND NOTHING ELSE.
 *
 * This file used to pull Geist and Geist Mono from Google Fonts. Two problems, and
 * the second is the serious one:
 *
 *   1. AURUM specifies ONE typeface — SF Pro, in three cuts. No display face, no
 *      serif, no third-party licence, no exceptions. Geist is a fourth voice in a
 *      system that is allowed one.
 *   2. It was a NETWORK REQUEST to fonts.googleapis.com on every page load, from a
 *      dashboard holding a bank's collections book. A webfont is a third-party
 *      request that carries the referrer, and this product is shown to RBL.
 *
 * So the stack is declared in CSS (--font-display / --font-text / --font-mono) and
 * contains only the mechanisms that resolve to SF Pro on an Apple platform, plus a
 * last-resort system-ui. Nothing is downloaded. See globals.css.
 * ───────────────────────────────────────────────────────────────────────────── */

export const metadata = {
  title: "Recovery Intelligence — Convin × RBL Bank",
  description:
    "AI collections performance: how much credit-card outstanding Convin's AI voice agents recovered for RBL Bank — recovery, call telemetry, compliance and intelligence.",
  /* This report lives at a private deep path and must never be indexed or listed. */
  robots: { index: false, follow: false, nocache: true },
};

/* THE FINISH, SET BEFORE FIRST PAINT.
 *
 * Black Titanium is the default. AURUM names it the canonical expression and assigns
 * it to "cinema, media, TELEMETRY, night" — and this product is telemetry: a frame
 * time, a connect rate, a curve of dials against payments. Natural Titanium is one
 * click away and is what every printed page uses regardless.
 *
 * The class is applied here, in a blocking inline script, rather than in an effect —
 * an effect runs after first paint, and the flash of the wrong finish is exactly the
 * kind of seam the system exists to remove.
 *
 * ── WHY THE KEY CHANGED ──────────────────────────────────────────────────────
 * The old key was `cvtheme`, and it could not be trusted, because the dashboard used
 * to WRITE it on every single mount:
 *
 *     const [theme, setTheme] = useState('light');          // ← the old default
 *     useEffect(() => { localStorage.setItem('cvtheme', theme); }, [theme]);
 *
 * That effect fires on mount, not just on change. So the first time anyone opened the
 * dashboard under the old build — without touching the toggle, without expressing any
 * preference at all — 'light' was persisted, permanently. Every returning visitor then
 * looked like someone who had explicitly chosen the light finish, and no change to the
 * default could ever reach them.
 *
 * `cvfinish` is written ONLY when a human clicks the toggle. A stored value in the new
 * key is a real preference and is honoured; the legacy key is ignored and cleared, so
 * everyone starts from the default once and then gets whatever they actually choose. */
const FINISH_INIT = `try{localStorage.removeItem('cvtheme');if(localStorage.getItem('cvfinish')!=='light'){document.documentElement.classList.add('dark')}}catch(e){document.documentElement.classList.add('dark')}`;

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning className="h-full">
      <head>
        {/* The finish carries a near-black canvas; tell the browser so the URL bar,
            the overscroll gutter and the form controls match rather than flashing
            white at the edges of the one screen that is meant to be a void. */}
        <meta name="color-scheme" content="dark light" />
        <script dangerouslySetInnerHTML={{ __html: FINISH_INIT }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
