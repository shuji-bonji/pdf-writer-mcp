/**
 * Watermark
 *
 * 既存 PDF の各ページに透かし文字を重ねる。
 *
 * 設計の要点:
 *   - **Artifact**: 透かしは本文の意味を持たない装飾なので、タグ付き PDF では
 *     `/Artifact BMC ... EMC` で囲む（PDF/UA-1 7.1-3）。ページ番号（page-number.ts）と同じ扱い。
 *   - **前面 / 背面**: pdf-lib はコンテンツストリームへの追記しかできないため、素直に描くと
 *     必ず本文の前に乗る。背面に置くには描画後に /Contents の順序を入れ替える（下記 moveLastToFront）。
 *   - **中央斜め**: 既定は 45 度。`drawText` は (x, y) を回転の原点として扱うので、
 *     文字の中心がページ中央に来るよう開始点を逆算する（centeredOrigin）。
 */

import { degrees, PDFArray, PDFName, type PDFFont, type PDFPage, rgb } from 'pdf-lib';

export interface WatermarkOptions {
  font: PDFFont;
  fontSize: number;
  color: { red: number; green: number; blue: number };
  /** 0（透明）〜1（不透明） */
  opacity: number;
  /** 反時計回りの角度（度） */
  angle: number;
  /** true なら本文の背面に敷く */
  behind: boolean;
  /** タグ付き PDF なら Artifact で囲む */
  markArtifact?: (page: PDFPage, draw: () => void) => void;
}

/**
 * 回転した文字の中心がページ中央に来る描画開始点を求める。
 *
 * pdf-lib の `drawText` は (x, y) を**回転の原点**として扱うため、中央に置くには
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

/**
 * /Contents の末尾（＝今描いたばかりのストリーム）を先頭へ移す。
 *
 * pdf-lib は読み込んだページを `[q, 本文…, Q]` に正規化し、`drawText` はその後ろへ
 * 自前の `q … Q` ストリームを 1 本追記する。したがって末尾が透かしであり、
 * これを先頭へ移すと「透かし → 本文」の描画順になる。各ストリームは q/Q で
 * 自己完結しているため、順序を入れ替えてもグラフィックス状態は壊れない。
 */
export function moveLastToFront(page: PDFPage): boolean {
  const contents = page.node.lookup(PDFName.of('Contents'));
  if (!(contents instanceof PDFArray) || contents.size() < 2) return false;
  const lastIndex = contents.size() - 1;
  const last = contents.get(lastIndex);
  contents.remove(lastIndex);
  contents.insert(0, last);
  return true;
}

/** 1 ページに透かしを描く */
export function watermarkPage(page: PDFPage, text: string, options: WatermarkOptions): void {
  const { font, fontSize, color, opacity, angle, behind } = options;
  const { width, height } = page.getSize();
  const textWidth = font.widthOfTextAtSize(text, fontSize);
  const { x, y } = centeredOrigin(width, height, textWidth, fontSize, angle);

  const draw = (): void => {
    page.drawText(text, {
      x,
      y,
      size: fontSize,
      font,
      color: rgb(color.red, color.green, color.blue),
      opacity,
      rotate: degrees(angle),
    });
  };

  if (options.markArtifact) {
    options.markArtifact(page, draw);
  } else {
    draw();
  }

  if (behind) moveLastToFront(page);
}
