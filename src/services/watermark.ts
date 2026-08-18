/**
 * 透かしの幾何 —— 文字をページ中央へ置く開始点を求める。
 *
 * 描画そのものは `page-draw.ts`（COS）にある。ここに残っているのは**計算だけ**で、
 * pdf-lib にも normativepdf にも依存しない。
 *
 * `watermarkPage` / `moveLastToFront` / `WatermarkOptions` は消した。
 * pdf-lib の `drawText` と「読み込んだページを `[q, 本文…, Q]` に正規化する」挙動を
 * 前提にした関数で、新しい経路では `/Contents` の前へ 1 本置くだけで済む（§3.28）。
 */

/**
 * 回転した文字の中心がページ中央に来る描画開始点を求める。
 *
 * `Tm` の平行移動成分は**回転の原点**なので、中央に置くには
 * 「文字の中心オフセットを角度ぶん回して引く」必要がある。
 */
export function centeredOrigin(
  pageWidth: number,
  pageHeight: number,
  textWidth: number,
  fontSize: number,
  angleDegrees: number,
): { x: number; y: number } {
  const rad = (angleDegrees * Math.PI) / 180;
  const halfW = textWidth / 2;
  // ベースラインから見た文字の視覚的中心（大文字高の約半分）
  const halfH = fontSize * 0.35;
  return {
    x: pageWidth / 2 - (halfW * Math.cos(rad) - halfH * Math.sin(rad)),
    y: pageHeight / 2 - (halfW * Math.sin(rad) + halfH * Math.cos(rad)),
  };
}
