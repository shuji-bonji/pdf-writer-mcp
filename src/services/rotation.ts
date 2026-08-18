/**
 * 回転角 — Phase 3（pdf-lib 撤去）の L1。
 *
 * 色（`color.ts`）と同じ形の作業である。角度は PDF の意味を持たない数値で、
 * `/Rotate`（§7.7.3.3 Table 31）は「90 の倍数の整数」としか言っていない。
 * それを pdf-lib の `degrees()` で包んでいたために、`page-ops` / `page-number` /
 * `watermark` の 3 ファイルが pdf-lib を import していた。**その 3 本は移し終えた**ので、
 * 変換関数（`toPdfLibRotation`）は消し、このファイルから pdf-lib の import も消えた。
 *
 * **値は素の数値のままにする。** 独自の型を作らないのは、包む理由が
 * 「pdf-lib がそう要求するから」しかないため — その要求は撤去とともに消える。
 * 変換は描画境界（この関数）1 つに閉じ、生成パスを normativepdf に載せ替えたら
 * 中身が「`/Rotate` を書く」「`cm` 行列を書く」に変わる。
 */

/**
 * `/Rotate` に書ける形へ正規化する。
 *
 * **R-7.7.3.3（Table 31 `/Rotate`）**: 値は「90 の倍数」でなければならない。
 * 負の値と 360 以上を 0〜270 に畳むのは仕様の要求ではなく**読み手への親切**だが、
 * 畳まずに `-90` を書くと処理系ごとに解釈が割れるので、書く側で決めておく。
 */
export function normalizeRotation(angle: number): number {
  if (!Number.isInteger(angle) || angle % 90 !== 0) {
    throw new RangeError(`/Rotate shall be a multiple of 90 (§7.7.3.3, Table 31); got ${angle}`);
  }
  return ((angle % 360) + 360) % 360;
}
