/**
 * Page numbers (stamping)
 *
 * 既存 PDF の各ページにページ番号を刻む。
 *
 * 設計の要点:
 *   - **Artifact**: ページ番号は本文の意味を持たない装飾なので、タグ付き PDF では
 *     `/Artifact BMC ... EMC` で囲む（PDF/UA-1 7.1-3）。囲まないと「タグ付けされていない
 *     コンテンツ」として準拠が壊れる。タグ無し PDF では素のまま描く。
 *   - **フォント**: 編集系で唯一フォントを要する。create 系と同じ font-manager を通し、
 *     harfbuzz サブセット（ADR-7/8）とグリフ検査の恩恵をそのまま受ける。
 *   - **回転**: ページが /Rotate を持つ場合、見た目の「右下」は座標系上の別の隅になる。
 *     ページの回転角に応じて配置を補正する。
 */

import { degrees, type PDFFont, type PDFPage, rgb } from 'pdf-lib';
import type { StampPosition } from '../types/index.js';

/** ページ番号テキストの書式を展開する */
export function formatPageNumber(template: string, pageNumber: number, total: number): string {
  return template.replaceAll('{n}', String(pageNumber)).replaceAll('{total}', String(total));
}

export interface StampLayout {
  x: number;
  y: number;
}

/**
 * 配置を計算する。
 * ページの回転（/Rotate）を考慮し、「見た目の」指定位置に来るようにする。
 */
export function computePosition(
  page: PDFPage,
  position: StampPosition,
  textWidth: number,
  fontSize: number,
  margin: number,
): StampLayout {
  const { width, height } = page.getSize();
  const rotation = ((page.getRotation().angle % 360) + 360) % 360;

  // 回転している場合、ユーザから見た幅・高さは入れ替わる
  const swapped = rotation === 90 || rotation === 270;
  const visualWidth = swapped ? height : width;
  const visualHeight = swapped ? width : height;

  const isRight = position.endsWith('right');
  const isCenter = position.endsWith('center');
  const isBottom = position.startsWith('bottom');

  // まず「見た目の」座標を求める
  let vx: number;
  if (isRight) vx = visualWidth - margin - textWidth;
  else if (isCenter) vx = (visualWidth - textWidth) / 2;
  else vx = margin;
  const vy = isBottom ? margin : visualHeight - margin - fontSize;

  // 見た目の座標をページ座標系へ戻す
  switch (rotation) {
    case 90:
      return { x: vy, y: height - vx - textWidth };
    case 180:
      return { x: width - vx - textWidth, y: height - vy - fontSize };
    case 270:
      return { x: width - vy - fontSize, y: vx };
    default:
      return { x: vx, y: vy };
  }
}

export interface StampOptions {
  font: PDFFont;
  fontSize: number;
  /** #rrggbb を rgb() 済みで渡す */
  color: { red: number; green: number; blue: number };
  position: StampPosition;
  margin: number;
  /** タグ付き PDF なら Artifact で囲むためのコールバック */
  markArtifact?: (page: PDFPage, draw: () => void) => void;
}

/** 1 ページにページ番号を描く */
export function stampPage(page: PDFPage, text: string, options: StampOptions): void {
  const { font, fontSize, color, position, margin } = options;
  const textWidth = font.widthOfTextAtSize(text, fontSize);
  const { x, y } = computePosition(page, position, textWidth, fontSize, margin);
  const rotation = ((page.getRotation().angle % 360) + 360) % 360;

  const draw = (): void => {
    page.drawText(text, {
      x,
      y,
      size: fontSize,
      font,
      color: rgb(color.red, color.green, color.blue),
      // ページの回転に合わせて文字も回す（回転ページで横倒しにならないように）
      rotate: degrees(rotation),
    });
  };

  if (options.markArtifact) {
    options.markArtifact(page, draw);
  } else {
    draw();
  }
}
