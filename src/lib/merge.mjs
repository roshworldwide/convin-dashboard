// Sheet merging — the built-in replacement for the manual Excel VLOOKUP.
//
// The STATUS sheet is primary: it decides which accounts exist (the leads Convin
// worked). Every ADDITIONAL sheet (portfolio / base / PDD file) is looked up by
// Account No and used to FILL IN fields the status sheet doesn't carry
// (outstanding, balance band, region, name, mobile, months-on-book …).
// A value already present in the status sheet is never overwritten.

import { getField, normalizeMap, missingCritical, ALIASES, accountKey, isCorruptAccount } from './normalize.mjs';

/** Parsed rows (array of string[]) -> array of record objects keyed by header. */
export function toObjects(parsed) {
  if (!parsed || !parsed.length) return [];
  const header = parsed[0].map((h) => String(h ?? '').trim());
  const out = [];
  for (let i = 1; i < parsed.length; i++) {
    const rec = parsed[i];
    if (!rec || rec.length < 2) continue;
    const o = {};
    for (let c = 0; c < header.length; c++) {
      const k = header[c];
      if (!k) continue;
      if (o[k] === undefined || String(o[k]).trim() === '') o[k] = rec[c] ?? '';
    }
    out.push(o);
  }
  return out;
}

/* isCorruptAccount and accountKey live in normalize.mjs — ONE definition, so the
   indexer, the row loop and the canonical row can never disagree about what an
   account number is. Re-exported here because existing callers import it from merge. */
export { isCorruptAccount };

/** Account numbers vary in leading zeros / spacing — index on both forms. */
const keys = (v) => {
  const s = String(v ?? '').trim();
  if (!s || isCorruptAccount(s)) return [];
  const stripped = s.replace(/^0+/, '');
  return stripped && stripped !== s ? [s, stripped] : [s];
};

function indexByAccount(objs, mapping) {
  const map = new Map();
  let recovered = 0, corrupt = 0;
  const via = new Set();          // which column(s) actually saved us
  for (const o of objs) {
    const a = accountKey(o, mapping);
    if (a.recovered) { recovered++; if (a.from) via.add(a.from); }
    if (a.corrupt) corrupt++;
    for (const k of keys(a.key)) if (!map.has(k)) map.set(k, o);
  }
  map._recovered = recovered;
  map._corrupt = corrupt;
  map._via = [...via];
  return map;
}

/**
 * Merge a primary (status) sheet with any number of additional sheets.
 * Returns { rows, stats } — rows are CANONICAL rows ready for aggregation.
 */
export function buildCanonicalRows(primaryParsed, extraParsedList = [], mapping = null, extraNames = []) {
  const primary = toObjects(primaryParsed);
  if (!primary.length) throw new Error('The status sheet has no data rows.');

  const sheets = (extraParsedList || []).filter(Boolean);
  const indexes = sheets.map((p) => indexByAccount(toObjects(p), mapping));
  const sheetName = (i) => extraNames[i] || `additional sheet ${i + 1}`;

  let matched = 0;
  let enriched = 0;
  let corrupted = 0;
  let unmatched = 0;
  /* Per-sheet hit counts. The old code kept ONE `matched` counter that was true if
     ANY sheet hit the row — so a lookup sheet that matched NOTHING was invisible
     behind a sheet that matched everything. That is precisely how RBL's book came
     out of the join with a perfect "7,042 matched, 0 unmatched" and not one single
     call record attached: the status file matched every row, the lead-outcome file
     matched none, and the sum of the two looked flawless. */
  const hits = new Array(indexes.length).fill(0);
  const rows = [];

  for (const base of primary) {
    const acct = getField(base, 'account_no', mapping);
    const rec = { ...base };
    let didMatch = false;

    if (isCorruptAccount(acct)) {
      corrupted++; // never guess — a wrong match would attach another customer's balance
    } else {
      for (let s = 0; s < indexes.length; s++) {
        const idx = indexes[s];
        let hit = null;
        for (const k of keys(acct)) { if (idx.has(k)) { hit = idx.get(k); break; } }
        if (!hit) continue;
        didMatch = true;
        hits[s]++;
        // Fill only what's missing/empty — the status sheet always wins.
        for (const [k, v] of Object.entries(hit)) {
          if (rec[k] === undefined || String(rec[k]).trim() === '') {
            if (v !== undefined && String(v).trim() !== '') { rec[k] = v; enriched++; }
          }
        }
      }
    }
    if (didMatch) matched++;
    else if (indexes.length && !isCorruptAccount(acct)) unmatched++;
    rows.push(rec);
  }

  /* A sheet the user deliberately uploaded that joined to NOTHING is never what they
     meant. It is the wrong file, or the two files number accounts differently. Both
     produce the same silent outcome: a dashboard that renders perfectly with nothing
     behind it. Stop the upload and say which file, rather than let it reach a client. */
  const usable = primary.length - corrupted;
  for (let s = 0; s < indexes.length; s++) {
    if (!usable) break;
    if (hits[s] !== 0) continue;
    const sampleTheirs = [...indexes[s].keys()][0] ?? '(none)';
    const sampleOurs = String(getField(primary[0] || {}, 'account_no', mapping) || '?');
    throw new Error(
      `"${sheetName(s)}" did not match a single account, so none of its columns were used. `
      + `The primary sheet numbers accounts like "${sampleOurs}", that file like "${sampleTheirs}". `
      + `Either it is the wrong export, or the Account No columns are in different formats. `
      + `Uploading it as-is would produce a dashboard with no data behind it.`,
    );
  }

  /* ── Validation. ────────────────────────────────────────────────────────────
     This used to inspect rows[0] ONLY, which was wrong in both directions:

       · If the first row happened to be malformed, a perfectly good 1,900-row
         file was rejected outright.
       · Far worse — if the first row was fine but the portfolio sheet was missing
         half the accounts, every unmatched row sailed through with NO outstanding.
         normalizeMap turns a missing number into 0, so those accounts quietly
         became worth ₹0 and the dashboard understated the book by half. The only
         hint was a soft "N rows had no match" warning under a headline number that
         was flatly wrong.

     A collections dashboard that understates recovery is worse than one that
     refuses to open. So we now check EVERY row, and a book whose money does not
     add up does not load.                                                       */
  const emptyRow = (r) => Object.values(r).every((v) => String(v ?? '').trim() === '');
  const real = rows.filter((r) => !emptyRow(r));            // ignore trailing junk lines
  const blankJunk = rows.length - real.length;

  // A row with no Account No is going to be dropped anyway — and it can never have
  // joined to the portfolio sheet, so it would always look like it was "missing
  // outstanding". Set those aside FIRST, or they'd block an otherwise-valid upload.
  const identified = [];
  let noAccount = 0;
  for (const r of real) {
    if (String(getField(r, 'account_no', mapping) || '').trim() === '') noAccount++;
    else identified.push(r);
  }

  const missingCount = {};
  const examples = {};
  for (const r of identified) {
    for (const k of missingCritical(r, mapping)) {
      missingCount[k] = (missingCount[k] || 0) + 1;
      if (!examples[k]) examples[k] = String(getField(r, 'account_no', mapping));
    }
  }

  const label = (k) => `"${(ALIASES[k] || [k])[0]}"`;
  const totalReal = identified.length;

  /* Missing on EVERY row. Two very different causes, and telling them apart is the
     difference between a user who can fix it and a user who is stuck:

       (a) the column genuinely isn't in any sheet   -> "add the sheet"
       (b) the column IS there, but NOTHING joined   -> "your account numbers don't match"

     (b) is what happens when the lead export and the bank's files number accounts
     differently. The old message said "couldn't find status", which sent people
     looking for a file that was already sitting in the upload box. */
  const extraHeaders = new Set();
  for (const p of (extraParsedList || []).filter(Boolean)) {
    for (const h of (p[0] || [])) extraHeaders.add(String(h ?? '').trim());
  }
  const isInSomeSheet = (k) => (ALIASES[k] || [k]).some((a) => extraHeaders.has(a))
    || (mapping && mapping[k] && extraHeaders.has(mapping[k]));

  const absent = Object.keys(missingCount).filter((k) => missingCount[k] === totalReal);
  if (absent.length) {
    const present = absent.filter(isInSomeSheet);
    if (present.length && indexes.length) {
      const wanted = present.map(label).join(', ');
      const sample = String(getField(identified[0] || {}, 'account_no', mapping) || '?');
      throw new Error(
        `The sheet with ${wanted} is here, but not one account matched it. `
        + `Every Account No in the primary sheet failed to find a partner — for example "${sample}". `
        + `The two files are numbering accounts differently (leading zeros, a prefix, or a different ID). `
        + `Check that the Account No columns hold the same format in both files.`,
      );
    }
    const wanted = absent.map(label).join(', ');
    throw new Error(
      `Couldn't find ${wanted} in the uploaded sheets. Add the sheet that contains ${wanted}, `
      + `or map the column explicitly.`,
    );
  }

  // Missing on SOME rows => a partial join. This is the silent-money case. Refuse.
  const partial = Object.keys(missingCount).filter((k) => missingCount[k] > 0 && k !== 'account_no');
  if (partial.length) {
    const detail = partial
      .map((k) => `${missingCount[k].toLocaleString('en-IN')} of ${totalReal.toLocaleString('en-IN')} rows have no ${label(k)} (e.g. account ${examples[k]})`)
      .join('; ');
    throw new Error(
      `This upload would report the wrong number, so it has been stopped. ${detail}. `
      + `Those accounts would be counted as ₹0 and the recovery figure would be understated. `
      + `Add the sheet that covers every account, or remove the rows that aren't in it.`,
    );
  }

  const warnings = [];
  if (corrupted) {
    warnings.push(
      `${corrupted} row${corrupted === 1 ? '' : 's'} have an Excel-corrupted Account No (e.g. "7.4787E+15") `
      + `and could not be matched. Re-export the sheet with the Account No column formatted as Text.`,
    );
  }
  /* We repaired a broken key. SAY SO. Convin's July lead export shipped every account
     number as "7.47678E+15" — 7,042 accounts crushed onto 964 strings — and the real
     number survived only inside External ID. Recovering it is right; recovering it
     quietly is not. If a bank later finds we rewrote their identifiers without a word,
     nothing else on the screen is believed again. */
  for (let s = 0; s < indexes.length; s++) {
    const rec = indexes[s]._recovered || 0;
    if (!rec) continue;
    const via = (indexes[s]._via || []).map((c) => `"${c}"`).join(' / ') || 'another column';
    warnings.push(
      `"${sheetName(s)}": the Account No column was corrupted by Excel on ${rec.toLocaleString('en-IN')} row${rec === 1 ? '' : 's'} `
      + `(written as "7.47678E+15", which collapses different accounts onto one value). `
      + `The real account number was recovered from ${via} in the same file and VERIFIED — each recovered number was `
      + `re-rounded the way Excel rounds, and it lands back exactly on the corrupted value, so it is provably the same account. `
      + `Nothing was guessed. To remove this warning, ask for the export with Account No formatted as Text.`,
    );
  }
  /* Rows where the key was wrecked and NOTHING in the row could prove what it was.
     These cannot be joined by any honest means — say so loudly, with the count. */
  for (let s = 0; s < indexes.length; s++) {
    const bad = indexes[s]._corrupt || 0;
    if (!bad) continue;
    warnings.push(
      `"${sheetName(s)}": ${bad.toLocaleString('en-IN')} row${bad === 1 ? ' has' : 's have'} an Account No destroyed by Excel `
      + `with no other column in the file carrying the real number. Those rows could not be joined to anything — `
      + `matching them would mean guessing, and a guessed account number attaches the wrong customer's balance. `
      + `Re-export with Account No formatted as Text.`,
    );
  }
  if (unmatched) {
    warnings.push(`${unmatched} row${unmatched === 1 ? '' : 's'} had no match in the additional sheet(s), but carried their own data.`);
  }
  /* A sheet that covers only part of the book is not fatal — it is the normal shape of
     a lead export, which only contains the accounts we actually dialled. But the exec
     must be told, because every metric drawn from that sheet (calls, promises, our
     score) has a smaller denominator than the book on screen. */
  for (let s = 0; s < indexes.length; s++) {
    if (!usable || !hits[s] || hits[s] === usable) continue;
    const pct = (hits[s] / usable) * 100;
    if (pct >= 99.5) continue;
    warnings.push(
      `"${sheetName(s)}" covers ${hits[s].toLocaleString('en-IN')} of ${usable.toLocaleString('en-IN')} accounts `
      + `(${pct.toFixed(1)}%). Anything it supplies — call activity, dispositions, our collection score — `
      + `is measured on those accounts only, not on the whole book.`,
    );
  }
  if (noAccount) {
    warnings.push(`${noAccount} row${noAccount === 1 ? '' : 's'} had no Account No and were skipped.`);
  }
  if (blankJunk) {
    warnings.push(`${blankJunk} blank row${blankJunk === 1 ? '' : 's'} at the end of the sheet were ignored.`);
  }

  const canonical = identified.map((r) => normalizeMap(r, mapping)).filter((r) => r.account_no);

  /* Duplicate accounts double-count the money — but ONLY genuine ones.
     Excel-corrupted account numbers all collapse onto the same few strings
     ("7.4787E+15"), so a naive check reports them as duplicates. They are not: they
     are distinct accounts whose IDs were mangled. On RBL's own book that produced a
     false "140 duplicates — balances counted more than once" warning, which would
     have told the client our headline number was inflated when it wasn't. Excluding
     corrupted IDs, RBL's book has zero true duplicates. */
  const seen = new Set();
  let duplicates = 0;
  for (const r of canonical) {
    if (isCorruptAccount(r.account_no)) continue;      // mangled, not duplicated
    if (seen.has(r.account_no)) duplicates++; else seen.add(r.account_no);
  }
  if (duplicates) {
    warnings.push(
      `${duplicates.toLocaleString('en-IN')} account${duplicates === 1 ? ' appears' : 's appear'} more than once in the sheet, `
      + `so ${duplicates === 1 ? 'its balance is' : 'their balances are'} counted more than once. Deduplicate before relying on the totals.`,
    );
  }

  return {
    rows: canonical,
    stats: {
      primaryRows: primary.length, rowsUsed: canonical.length, extraSheets: indexes.length,
      matched, unmatched, corrupted, filledCells: enriched,
      skippedNoAccount: noAccount, blankRows: blankJunk, duplicates,
      // Per-sheet coverage — so "matched: 7042" can never again hide a file that
      // matched nothing. The UI shows one line per uploaded lookup sheet.
      sheetCoverage: indexes.map((_, i) => ({ name: sheetName(i), matched: hits[i], of: usable })),
    },
    warnings,
  };
}
