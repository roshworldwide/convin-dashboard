/* ── THE DAY TOTAL IS A UNION, NOT A SUM ──────────────────────────────────────
 *
 * It used to concatenate the rows of every upload filed under a date and aggregate the
 * lot. That is correct only if the uploads never overlap. In practice they always do:
 * you upload the book, spot something, re-upload the same book. Two uploads of one
 * 7,042-account book produced a "Day Total" of 14,084 accounts and DOUBLE the money —
 * and it was wrong in the flattering direction, which is the worst way for a number to
 * be wrong in front of a client. Three uploads tripled it. ₹13.12 Cr became ₹65.34 Cr.
 *
 * A day's book is the set of ACCOUNTS worked that day, not the number of rows filed.
 * So the Day Total is now the union of accounts across uploads, keyed on account_no:
 *
 *   · the same account in two uploads  -> counted ONCE, with the LATEST upload's data
 *     (uploads are processed in id order, u1 → u2 → u3, so the newest view wins — that
 *     is what you meant by re-uploading it)
 *   · different accounts in two uploads -> both counted, and the total is a true sum,
 *     exactly as before. Splitting a book across two files still works.
 *
 * The upshot: uploading the same file twice is now a no-op on the money instead of a
 * catastrophe. Outstanding stays outstanding. There is nothing to add up twice.
 */

/**
 * @param {Array<Array<object>>} chunks  canonical rows, one array per upload, in upload order
 * @returns {{rows: object[], duplicates: number, sources: number}}
 */
export function unionByAccount(chunks) {
  const byAccount = new Map();
  let duplicates = 0;
  let noAccount = 0;

  for (const rows of chunks) {
    for (const r of rows) {
      const key = String(r.account_no ?? '').trim();
      if (!key) {
        /* No account number: we cannot tell it apart from any other unidentified row, so
           we cannot dedupe it. Keeping it would let a re-upload inflate the book again
           through the back door. It was already excluded upstream by buildCanonicalRows,
           so this is belt-and-braces — but count it so the number is never a mystery. */
        noAccount++;
        continue;
      }
      if (byAccount.has(key)) duplicates++;
      byAccount.set(key, r);      // last upload wins
    }
  }

  return {
    rows: [...byAccount.values()],
    duplicates,
    noAccount,
    sources: chunks.length,
  };
}
