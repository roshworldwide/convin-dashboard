// Minimal, dependency-free CSV parsing.
// Handles quoted fields, escaped quotes ("") and commas inside quotes.
// Collections exports don't embed newlines inside fields, so we parse per line —
// which lets the CLI stream a 1M-row file via readline without loading it all.

export function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += c;
    } else if (c === '"') {
      inQ = true;
    } else if (c === ',') {
      out.push(cur); cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

// Parse an entire CSV string into an array of string[] records (header first).
export function parseCsv(text) {
  const clean = text.replace(/^﻿/, '');
  const lines = clean.split(/\r\n|\n|\r/);
  const rows = [];
  for (const ln of lines) {
    if (ln === '') continue;
    rows.push(parseCsvLine(ln));
  }
  return rows;
}
