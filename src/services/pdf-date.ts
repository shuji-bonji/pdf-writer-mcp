/**
 * §7.9.4 の日付文字列 — Phase 3（pdf-lib 撤去）。
 *
 * `output-created.ts`（生成パスの出口）と `output-edited.ts`（編集パスの出口）が
 * 同じ形を書くので、条文の形を 1 箇所に置いた。
 */

/**
 * `D:YYYYMMDDHHmmSSOHH'mm'`（§7.9.4 Table 4）。
 * UTC で書く（`Z` ではなく `+00'00'` = Table 4 の形）。
 */
export function pdfDate(when: Date): string {
  const p = (n: number, w = 2): string => String(n).padStart(w, '0');
  return (
    `D:${when.getUTCFullYear()}${p(when.getUTCMonth() + 1)}${p(when.getUTCDate())}` +
    `${p(when.getUTCHours())}${p(when.getUTCMinutes())}${p(when.getUTCSeconds())}+00'00'`
  );
}
