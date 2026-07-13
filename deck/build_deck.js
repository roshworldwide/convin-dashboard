const pptxgen = require('/tmp/node_modules/pptxgenjs');

const P = {
  ink: '0B1226', navy: '18234A', slate: '5A6076', mute: '8B92A6',
  line: 'E4E7EF', paper: 'FFFFFF', wash: 'F5F6FA',
  violet: '6C5CE7', violetLt: 'EDEBFD',
  green: '1E9E6A', greenLt: 'E6F5EF',
  red: 'D9483B', redLt: 'FBEBE9',
  gold: 'D99A17',
};
const HEAD = 'Cambria', BODY = 'Calibri';

const pres = new pptxgen();
pres.layout = 'LAYOUT_WIDE';               // 13.3 x 7.5
pres.author = 'Convin';
pres.title = 'RoshRegression — Convin leadership briefing';
const W = 13.3, H = 7.5, M = 0.75;

/* ── helpers ─────────────────────────────────────────────────────────────── */
const dark = () => { const s = pres.addSlide(); s.background = { color: P.ink }; return s; };
const light = () => { const s = pres.addSlide(); s.background = { color: P.paper }; return s; };

const kicker = (s, text, onDark) => s.addText(text.toUpperCase(), {
  x: M, y: 0.52, w: 8, h: 0.26, fontFace: BODY, fontSize: 11, bold: true,
  charSpacing: 2.2, color: onDark ? P.violet : P.violet, margin: 0,
});
const title = (s, text, onDark, opts = {}) => s.addText(text, {
  x: M, y: 0.9, w: opts.w || 11.8, h: opts.h || 1.0, fontFace: HEAD, fontSize: opts.size || 34,
  bold: true, color: onDark ? P.paper : P.ink, margin: 0, valign: 'top', lineSpacing: opts.ls || 38,
});
const sub = (s, text, onDark, y = 1.95) => s.addText(text, {
  x: M, y, w: 11.8, h: 0.5, fontFace: BODY, fontSize: 14.5,
  color: onDark ? P.mute : P.slate, margin: 0, lineSpacing: 22,
});
const foot = (s, text, onDark) => s.addText(text, {
  x: M, y: H - 0.62, w: 11.8, h: 0.3, fontFace: BODY, fontSize: 10,
  color: onDark ? '4A5170' : P.mute, margin: 0, italic: true,
});

// Stat card. No edge stripes — a tinted panel and a dot, repeated as the motif.
const stat = (s, { x, y, w, v, l, c, tint }) => {
  s.addShape(pres.ShapeType.roundRect, {
    x, y, w, h: 1.5, rectRadius: 0.1, fill: { color: tint || P.wash }, line: { color: tint ? tint : P.line, width: 0.75 },
  });
  s.addShape(pres.ShapeType.ellipse, { x: x + 0.28, y: y + 0.32, w: 0.1, h: 0.1, fill: { color: c }, line: { width: 0 } });
  s.addText(v, { x: x + 0.28, y: y + 0.48, w: w - 0.5, h: 0.5, fontFace: HEAD, fontSize: 26, bold: true, color: c, margin: 0 });
  s.addText(l, { x: x + 0.28, y: y + 1.0, w: w - 0.5, h: 0.4, fontFace: BODY, fontSize: 10.5, color: P.slate, margin: 0, lineSpacing: 13 });
};

/* ═══ 1. Title ═══════════════════════════════════════════════════════════ */
{
  const s = dark();
  s.addShape(pres.ShapeType.ellipse, { x: M, y: 2.42, w: 0.16, h: 0.16, fill: { color: P.violet }, line: { width: 0 } });
  s.addText('RoshRegression', {
    x: M, y: 2.65, w: 11, h: 1.15, fontFace: HEAD, fontSize: 54, bold: true, color: P.paper, margin: 0,
  });
  s.addText('The model that decides which of RBL’s ₹8.69 Cr gets called first.', {
    x: M, y: 3.85, w: 9.6, h: 0.6, fontFace: BODY, fontSize: 19, color: 'B9BFD4', margin: 0,
  });
  s.addText('Internal briefing  ·  Convin leadership  ·  RBL Bank renewal', {
    x: M, y: 5.9, w: 9, h: 0.3, fontFace: BODY, fontSize: 12, color: '6E7796', margin: 0, charSpacing: 0.6,
  });
  s.addNotes('One line, one number, one name. Do not open with the dashboard. Open with the fact that we now own a piece of decision infrastructure — and that it has a name.');
}

/* ═══ 2. The problem ═════════════════════════════════════════════════════ */
{
  const s = light();
  kicker(s, 'Why we are having this meeting');
  title(s, 'A voice agent is a feature.\nEveryone is shipping one.');
  sub(s, 'RBL can swap our dialler for a competitor’s in a quarter. On calls-placed and minutes-talked we are\ninterchangeable — which means the only lever left in the renewal conversation is price.', false, 2.1);

  const rows = [
    ['What we sell today', 'AI voice agents that place calls and log dispositions.', 'Replaceable. Benchmarked on price per minute.', P.red],
    ['What RBL actually buys', 'Recovered rupees. They do not care how the call was made.', 'We have never shown them a number they could not get elsewhere.', P.gold],
    ['What we now have', 'A model that tells their floor which accounts to work first.', 'Not a feature. A decision they cannot make without us.', P.green],
  ];
  let y = 3.25;
  rows.forEach(([h, b, c, col]) => {
    s.addShape(pres.ShapeType.ellipse, { x: M, y: y + 0.12, w: 0.13, h: 0.13, fill: { color: col }, line: { width: 0 } });
    s.addText(h, { x: M + 0.32, y, w: 3.1, h: 0.35, fontFace: BODY, fontSize: 13, bold: true, color: P.ink, margin: 0 });
    s.addText(b, { x: M + 3.5, y, w: 4.6, h: 0.6, fontFace: BODY, fontSize: 12.5, color: P.slate, margin: 0, lineSpacing: 16 });
    s.addText(c, { x: M + 8.3, y, w: 3.9, h: 0.6, fontFace: BODY, fontSize: 12.5, color: col, margin: 0, italic: true, lineSpacing: 16 });
    y += 1.0;
  });
  s.addNotes('Do not soften this. The COO already knows we are commoditised; naming it buys credibility for everything after.');
}

/* ═══ 3. The finding ═════════════════════════════════════════════════════ */
{
  const s = dark();
  kicker(s, 'What we found in RBL’s own data', true);
  title(s, 'A promise to pay is the worst\nsignal on the board.', true);
  sub(s, 'RBL’s floor — and every collections agency in the country — chases the customers who promised.\nIn 1,908 real accounts, those customers were the least likely to pay.', true, 2.15);

  s.addChart(pres.ChartType.bar, [{
    name: 'Recovery rate',
    labels: ['Claimed already paid', 'Disposition: Paid', 'Qualified lead', 'Talked 2+ minutes', 'Connected on a call', 'Promised to pay'],
    values: [89.9, 77.9, 68.1, 61.3, 53.4, 25.5],
  }], {
    x: M, y: 3.15, w: 7.5, h: 3.35, barDir: 'bar', barGapWidthPct: 55,
    chartColors: [P.violet, P.violet, P.violet, P.violet, P.violet, P.red],
    varyColors: true,
    showValue: true, dataLabelPosition: 'outEnd', dataLabelColor: 'C7CCE0',
    dataLabelFontFace: BODY, dataLabelFontSize: 10, dataLabelFormatCode: '0.0"%"',
    catAxisLabelColor: 'C7CCE0', catAxisLabelFontFace: BODY, catAxisLabelFontSize: 11,
    valAxisLabelColor: '6E7796', valAxisLabelFontSize: 9, valAxisMaxVal: 100,
    valGridLine: { color: '232E52', size: 0.5 }, catGridLine: { style: 'none' },
    showLegend: false, showTitle: false, plotArea: { fill: { color: P.ink } },
  });

  s.addShape(pres.ShapeType.roundRect, {
    x: 8.6, y: 3.35, w: 3.95, h: 2.0, rectRadius: 0.1, fill: { color: '1C1430' }, line: { color: '3A2E63', width: 1 },
  });
  s.addText('–18.3 pts', { x: 8.9, y: 3.6, w: 3.4, h: 0.6, fontFace: HEAD, fontSize: 30, bold: true, color: P.red, margin: 0 });
  s.addText('below the book’s 43.8% average. 454 accounts promised. Only 26% of them paid.', {
    x: 8.9, y: 4.25, w: 3.4, h: 0.95, fontFace: BODY, fontSize: 12, color: 'B9BFD4', margin: 0, lineSpacing: 16,
  });
  s.addText('The book’s base rate is 43.8%. Bars above it are real signal; the bar below it is a trap.', {
    x: 8.6, y: 5.6, w: 3.95, h: 0.7, fontFace: BODY, fontSize: 11, color: '6E7796', margin: 0, italic: true, lineSpacing: 15,
  });
  s.addNotes('This is the slide that wins the room. It is counter-intuitive, it is from THEIR data, and any RBL analyst can verify it in the account table in 30 seconds. Silence after "the least likely to pay."');
}

/* ═══ 4. What it is ══════════════════════════════════════════════════════ */
{
  const s = light();
  kicker(s, 'The model');
  title(s, 'RoshRegression, in one slide.');
  sub(s, 'A regularised logistic regression — the same maths a bank’s credit risk team already signs off on —\nrefitted from scratch on every report RBL uploads.', false, 2.05);

  const cards = [
    ['Learns their book', 'Refit per report. Fourteen inputs, fourteen readable coefficients. No opinions carried over from another bank.'],
    ['Never leaves the building', 'No API key. No external model. No call to anyone’s cloud. Their cardholder data is scored inside their environment.'],
    ['Audit-ready by design', 'Every weight inspectable. Their model risk committee can sign it off in an afternoon — not a quarter.'],
    ['Costs nothing to run', '~4ms per batch. A million rows a day at zero marginal cost. It runs inside the ingest we already built.'],
  ];
  let x = M;
  cards.forEach(([h, b]) => {
    s.addShape(pres.ShapeType.roundRect, { x, y: 3.0, w: 2.85, h: 2.5, rectRadius: 0.1, fill: { color: P.wash }, line: { color: P.line, width: 0.75 } });
    s.addShape(pres.ShapeType.ellipse, { x: x + 0.28, y: 3.3, w: 0.12, h: 0.12, fill: { color: P.violet }, line: { width: 0 } });
    s.addText(h, { x: x + 0.28, y: 3.52, w: 2.3, h: 0.35, fontFace: BODY, fontSize: 13.5, bold: true, color: P.ink, margin: 0 });
    s.addText(b, { x: x + 0.28, y: 3.92, w: 2.3, h: 1.45, fontFace: BODY, fontSize: 11, color: P.slate, margin: 0, lineSpacing: 15 });
    x += 3.0;
  });
  s.addText('It is not an LLM. That is the point — and on the next slide, that turns out not to cost us anything.', {
    x: M, y: 5.75, w: 11.8, h: 0.4, fontFace: BODY, fontSize: 13, color: P.ink, margin: 0, italic: true,
  });
  s.addNotes('Anticipate the question before it is asked: "why not an LLM?" Answer it on the next slide with data, not opinion.');
}

/* ═══ 5. vs the LLM ══════════════════════════════════════════════════════ */
{
  const s = dark();
  kicker(s, 'The question everyone asks first', true);
  title(s, '“Why not just use an LLM?”\nWe ran the experiment.', true);
  sub(s, 'Same 120 held-out accounts. Same question. A frontier model, given every advantage — including prior\nknowledge of this book that a cold model would not have.', true, 2.15);

  stat(s, { x: M, y: 3.4, w: 3.5, v: '0.750', l: 'RoshRegression accuracy', c: P.violet, tint: '1C1430' });
  stat(s, { x: M + 3.7, y: 3.4, w: 3.5, v: '0.742', l: 'Frontier LLM accuracy', c: 'B9BFD4', tint: '141B33' });
  stat(s, { x: M + 7.4, y: 3.4, w: 3.5, v: 'p = 1.00', l: 'Statistically indistinguishable', c: P.mute, tint: '141B33' });

  s.addText('It tied. And a tie is a win.', {
    x: M, y: 5.35, w: 11.8, h: 0.45, fontFace: HEAD, fontSize: 22, bold: true, color: P.paper, margin: 0,
  });
  s.addText('The LLM needed an API call per account, a network round-trip, and every RBL cardholder’s financial data leaving the bank — to draw level with sixty lines of maths running on their own hardware for free. Send that sentence to their CISO and the LLM loses on the spot.', {
    x: M, y: 5.85, w: 11.8, h: 0.85, fontFace: BODY, fontSize: 12.5, color: '8E96B0', margin: 0, lineSpacing: 17,
  });
  s.addNotes('Do not oversell. Say plainly: it did not beat the LLM. It tied. Then explain why tying is the strongest possible result for a regulated buyer.');
}

/* ═══ 6. Proof: 10/10 ════════════════════════════════════════════════════ */
{
  const s = light();
  kicker(s, 'Validation');
  title(s, 'Ten reports. Ten wins.');
  sub(s, 'Independently graded by holdout — an open-source eval framework using paired significance tests, not\nvanity numbers. Every report: fit on 80%, scored on the 20% it had never seen.', false, 2.05);

  s.addChart(pres.ChartType.line, [
    { name: 'RoshRegression', labels: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'], values: [72.9, 74.5, 70.6, 73.3, 73.6, 74.1, 74.0, 74.3, 71.1, 70.9] },
    { name: 'Current playbook (chase the promises)', labels: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'], values: [48.9, 50.7, 52.4, 49.2, 52.1, 51.0, 51.2, 50.6, 52.5, 50.9] },
  ], {
    x: M, y: 3.0, w: 7.6, h: 3.1,
    chartColors: [P.violet, P.mute], lineSize: 2.5, lineSmooth: false,
    showValue: false, valAxisMinVal: 40, valAxisMaxVal: 85,
    catAxisLabelColor: P.slate, catAxisLabelFontFace: BODY, catAxisLabelFontSize: 10,
    valAxisLabelColor: P.mute, valAxisLabelFontSize: 9, valAxisLabelFormatCode: '0"%"',
    valGridLine: { color: P.line, size: 0.5 }, catGridLine: { style: 'none' },
    showLegend: true, legendPos: 'b', legendFontFace: BODY, legendFontSize: 10, legendColor: P.slate,
    showTitle: false,
  });
  s.addText('Accuracy per report — held-out accounts only', { x: M, y: 6.15, w: 7.6, h: 0.25, fontFace: BODY, fontSize: 10, color: P.mute, margin: 0 });

  stat(s, { x: 8.65, y: 3.0, w: 1.85, v: '10/10', l: 'reports won', c: P.green, tint: P.greenLt });
  stat(s, { x: 10.7, y: 3.0, w: 1.85, v: '+22.0', l: 'pts mean edge', c: P.violet, tint: P.violetLt });
  stat(s, { x: 8.65, y: 4.65, w: 1.85, v: '±1.5', l: 'pts of wobble', c: P.ink, tint: P.wash });
  stat(s, { x: 10.7, y: 4.65, w: 1.85, v: '3,790', l: 'unseen accounts', c: P.ink, tint: P.wash });

  foot(s, 'Reports 2–10 are synthetic — bootstrap resamples of the real 1,908-account book. Every row is a real account with a real outcome; the stability claim is sound, the rupee figures on them are not. Do not quote them to RBL as recoveries.');
  s.addNotes('READ THE FOOTNOTE OUT LOUD. If anyone repeats a synthetic rupee number to RBL we lose the account. The stability claim is what is real and it is what matters.');
}

/* ═══ 7. Drift ═══════════════════════════════════════════════════════════ */
{
  const s = light();
  kicker(s, 'The stress test');
  title(s, 'It holds on the days that go wrong.');
  sub(s, 'A collections model that only works on good dialling days is worthless — the bad days are exactly when\nRBL needs to know who to call. So we broke the book on purpose.', false, 2.05);

  s.addShape(pres.ShapeType.roundRect, { x: M, y: 3.1, w: 5.75, h: 2.6, rectRadius: 0.1, fill: { color: P.redLt }, line: { color: 'F0CBC6', width: 0.75 } });
  s.addText('Day 6 — half the book never picked up', { x: M + 0.35, y: 3.35, w: 5.05, h: 0.35, fontFace: BODY, fontSize: 13, bold: true, color: P.ink, margin: 0 });
  s.addText('54.3%', { x: M + 0.35, y: 3.75, w: 2.3, h: 0.55, fontFace: HEAD, fontSize: 28, bold: true, color: P.red, margin: 0 });
  s.addText('connect rate — the worst day we simulated', { x: M + 0.35, y: 4.3, w: 2.4, h: 0.5, fontFace: BODY, fontSize: 10.5, color: P.slate, margin: 0, lineSpacing: 13 });
  s.addText('+23.1 pts', { x: M + 3.1, y: 3.75, w: 2.3, h: 0.55, fontFace: HEAD, fontSize: 28, bold: true, color: P.green, margin: 0 });
  s.addText('it still beat the incumbent playbook by more than its own average', { x: M + 3.1, y: 4.3, w: 2.3, h: 0.7, fontFace: BODY, fontSize: 10.5, color: P.slate, margin: 0, lineSpacing: 13 });
  s.addText('Accuracy on that day: 0.741 — above its ten-report mean.', { x: M + 0.35, y: 5.1, w: 5.05, h: 0.35, fontFace: BODY, fontSize: 11.5, color: P.ink, margin: 0, italic: true });

  s.addShape(pres.ShapeType.roundRect, { x: 7.05, y: 3.1, w: 5.5, h: 2.6, rectRadius: 0.1, fill: { color: P.wash }, line: { color: P.line, width: 0.75 } });
  s.addText('No drift', { x: 7.4, y: 3.35, w: 4.8, h: 0.35, fontFace: BODY, fontSize: 13, bold: true, color: P.ink, margin: 0 });
  const drift = [
    ['3 worst-connectivity days', '0.719 accuracy   ·   +20.4 pts edge'],
    ['3 best-connectivity days', '0.731 accuracy   ·   +21.3 pts edge'],
  ];
  let dy = 3.85;
  drift.forEach(([a, b]) => {
    s.addText(a, { x: 7.4, y: dy, w: 2.5, h: 0.3, fontFace: BODY, fontSize: 11.5, color: P.slate, margin: 0 });
    s.addText(b, { x: 9.9, y: dy, w: 2.4, h: 0.3, fontFace: BODY, fontSize: 11.5, bold: true, color: P.ink, margin: 0 });
    dy += 0.5;
  });
  s.addText('The edge barely moves when conditions collapse. That is the difference between a demo and a system.', {
    x: 7.4, y: 4.95, w: 4.8, h: 0.6, fontFace: BODY, fontSize: 11.5, color: P.slate, margin: 0, italic: true, lineSpacing: 15,
  });
  s.addNotes('This is the slide that survives due diligence. Anyone can win on a good day.');
}

/* ═══ 8. Worth to RBL ════════════════════════════════════════════════════ */
{
  const s = dark();
  kicker(s, 'What it is worth to them', true);
  title(s, 'Same agents. Same dialler.\nDifferent call order.', true);
  sub(s, 'RoshRegression does not need RBL to buy anything new. It reorders the list they already work.', true, 2.15);

  s.addShape(pres.ShapeType.roundRect, { x: M, y: 3.1, w: 5.85, h: 2.55, rectRadius: 0.1, fill: { color: '1C1430' }, line: { color: '3A2E63', width: 1 } });
  s.addText('2.25×', { x: M + 0.4, y: 3.4, w: 5.05, h: 0.85, fontFace: HEAD, fontSize: 44, bold: true, color: P.violet, margin: 0 });
  s.addText('Work the top 10% of accounts by score and you capture 22.5% of every rupee that was going to come in — more than twice what working the book at random returns.', {
    x: M + 0.4, y: 4.3, w: 5.05, h: 1.1, fontFace: BODY, fontSize: 12.5, color: 'B9BFD4', margin: 0, lineSpacing: 17,
  });

  s.addShape(pres.ShapeType.roundRect, { x: 7.15, y: 3.1, w: 5.4, h: 2.55, rectRadius: 0.1, fill: { color: '141B33' }, line: { color: '2A3559', width: 1 } });
  s.addText('The measured book', { x: 7.5, y: 3.35, w: 4.7, h: 0.3, fontFace: BODY, fontSize: 12, bold: true, color: '8E96B0', margin: 0 });
  const bk = [
    ['₹6.50 Cr', 'recovered — 42.8% of the book'],
    ['₹8.69 Cr', 'still open, and now ranked'],
    ['₹77.95 L', 'what an agency would have billed'],
  ];
  let by = 3.75;
  bk.forEach(([v, l]) => {
    s.addText(v, { x: 7.5, y: by, w: 1.7, h: 0.35, fontFace: HEAD, fontSize: 17, bold: true, color: P.paper, margin: 0 });
    s.addText(l, { x: 9.3, y: by + 0.04, w: 3.0, h: 0.35, fontFace: BODY, fontSize: 11.5, color: '8E96B0', margin: 0 });
    by += 0.6;
  });

  s.addText('That is the ask on the table: let us rank the ₹8.69 Cr you have already written off as hard to reach.', {
    x: M, y: 6.0, w: 11.8, h: 0.4, fontFace: BODY, fontSize: 13, color: 'B9BFD4', margin: 0, italic: true,
  });
  s.addNotes('The 2.25x is the operational number. Accuracy is for their risk team; this is for their collections head.');
}

/* ═══ 9. The strategy ════════════════════════════════════════════════════ */
{
  const s = light();
  kicker(s, 'The play');
  title(s, 'This is how we stop being a vendor.');
  sub(s, 'A dialler is procured. A decision layer is embedded. The difference decides whether RBL is an annual\nnegotiation or an annuity.', false, 2.05);

  const steps = [
    ['1', 'They upload', 'Their book runs through our ingest. Nothing leaves their environment.', P.slate],
    ['2', 'It refits on their data', 'The model learns THIS book — not a generic one. It gets sharper every cycle they feed it.', P.violet],
    ['3', 'Their floor works our order', 'The call list is our output. Their collections rhythm is now built around it.', P.green],
    ['4', 'Switching costs appear', 'Replacing Convin now means replacing how their recovery team decides who to call. That is not a procurement decision any more.', P.ink],
  ];
  let x = M;
  steps.forEach(([n, h, b, c]) => {
    s.addShape(pres.ShapeType.roundRect, { x, y: 3.0, w: 2.85, h: 2.75, rectRadius: 0.1, fill: { color: P.wash }, line: { color: P.line, width: 0.75 } });
    s.addShape(pres.ShapeType.ellipse, { x: x + 0.28, y: 3.28, w: 0.42, h: 0.42, fill: { color: c }, line: { width: 0 } });
    s.addText(n, { x: x + 0.28, y: 3.34, w: 0.42, h: 0.3, fontFace: BODY, fontSize: 12, bold: true, color: 'FFFFFF', align: 'center', margin: 0 });
    s.addText(h, { x: x + 0.28, y: 3.85, w: 2.3, h: 0.35, fontFace: BODY, fontSize: 13.5, bold: true, color: P.ink, margin: 0 });
    s.addText(b, { x: x + 0.28, y: 4.25, w: 2.3, h: 1.4, fontFace: BODY, fontSize: 11, color: P.slate, margin: 0, lineSpacing: 15 });
    x += 3.0;
  });
  s.addNotes('This is the slide for the COO specifically. Everything before it was evidence; this is the thesis.');
}

/* ═══ 10. Honest limits ══════════════════════════════════════════════════ */
{
  const s = light();
  kicker(s, 'What we are not claiming');
  title(s, 'The weaknesses, from us,\nbefore RBL finds them.');
  sub(s, 'Every number in this deck survives scrutiny. These four do not — so we say them first, and stay credible\nfor everything else.', false, 2.1);

  const limits = [
    ['It is correlation, not cause', 'A two-minute call identifies someone who will pay. It does not prove that forcing longer calls creates payment — willing payers are also willing talkers. Say "identifies", never "causes".'],
    ['It only sees this one file', 'No bureau score. No prior-cycle history. No payment behaviour from before today. Which is also the argument for a deeper data agreement.'],
    ['Nine of the ten reports are synthetic', 'Real accounts, real outcomes, resampled. The stability claim holds. The rupee figures on those days do not exist.'],
    ['It is timid at the threshold', 'It catches only ~42% of the accounts that pay. Its strength is the ranking, not a yes/no verdict. Lead with the call order, never the label.'],
  ];
  let y = 3.2;
  limits.forEach(([h, b], i) => {
    const col = i % 2;
    const xx = M + col * 6.05;
    const yy = y + Math.floor(i / 2) * 1.6;
    s.addShape(pres.ShapeType.ellipse, { x: xx, y: yy + 0.1, w: 0.13, h: 0.13, fill: { color: P.gold }, line: { width: 0 } });
    s.addText(h, { x: xx + 0.32, y: yy, w: 5.3, h: 0.3, fontFace: BODY, fontSize: 13, bold: true, color: P.ink, margin: 0 });
    s.addText(b, { x: xx + 0.32, y: yy + 0.36, w: 5.3, h: 1.0, fontFace: BODY, fontSize: 11.5, color: P.slate, margin: 0, lineSpacing: 15 });
  });
  s.addText('A bank does not buy the vendor with the best numbers. It buys the one it believes.', {
    x: M, y: 6.35, w: 11.8, h: 0.4, fontFace: HEAD, fontSize: 15, bold: true, color: P.ink, margin: 0, italic: true,
  });
  s.addNotes('Counter-intuitive but true: this slide is why they will trust slide 6. Do not cut it to save time.');
}

/* ═══ 11. The ask ════════════════════════════════════════════════════════ */
{
  const s = dark();
  kicker(s, 'What we need', true);
  title(s, 'Three decisions.', true);

  const asks = [
    ['Take RoshRegression into the RBL renewal as the headline', 'Not the dialler. Not the minutes. The model, by name, with the promise-to-pay finding as the opener.'],
    ['Ask RBL for bureau and prior-cycle data', 'The model is at 0.75 blind. With payment history it moves materially — and the data ask is itself a deeper contract.'],
    ['Fund one validation cycle on live data', 'Everything here is measured, but nine of ten reports are resampled. One real month, and every claim becomes unimpeachable.'],
  ];
  let y = 2.6;
  asks.forEach(([h, b], i) => {
    s.addShape(pres.ShapeType.roundRect, { x: M, y, w: 11.8, h: 1.25, rectRadius: 0.08, fill: { color: '141B33' }, line: { color: '2A3559', width: 1 } });
    s.addShape(pres.ShapeType.ellipse, { x: M + 0.35, y: y + 0.45, w: 0.38, h: 0.38, fill: { color: P.violet }, line: { width: 0 } });
    s.addText(String(i + 1), { x: M + 0.35, y: y + 0.5, w: 0.38, h: 0.28, fontFace: BODY, fontSize: 12, bold: true, color: 'FFFFFF', align: 'center', margin: 0 });
    s.addText(h, { x: M + 0.95, y: y + 0.22, w: 10.5, h: 0.35, fontFace: BODY, fontSize: 14, bold: true, color: P.paper, margin: 0 });
    s.addText(b, { x: M + 0.95, y: y + 0.62, w: 10.5, h: 0.5, fontFace: BODY, fontSize: 12, color: '8E96B0', margin: 0, lineSpacing: 15 });
    y += 1.45;
  });

  s.addText('RBL is not buying a voice agent from us. They are buying the answer to “who do we call first?” — and\nfor the first time, we are the only ones who have it.', {
    x: M, y: 6.45, w: 11.8, h: 0.65, fontFace: HEAD, fontSize: 15, bold: true, color: P.paper, margin: 0, lineSpacing: 21,
  });
  s.addNotes('End on the reframe, not on a thank-you slide. Let it sit.');
}

pres.writeFile({ fileName: process.argv[2] || 'RoshRegression_Convin_Briefing.pptx' })
  .then((f) => console.log('wrote', f));
