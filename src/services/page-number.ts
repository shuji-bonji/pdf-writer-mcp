/**
 * ページ番号の書式と配置 —— 計算だけを持つ。
 *
 * 描画そのものは `page-draw.ts`（COS）にある。pdf-lib にも normativepdf にも依存しない。
 *
 * **回転**: ページが `/Rotate` を持つ場合、見た目の「右下」は座標系上の別の隅になる。
 * ページの回転角に応じて配置を補正する。
 *
 * `stampPage` / `StampOptions` は消した（pdf-lib の `drawText` を呼ぶ関数だった）。
 * `computePosition` は `PDFPage` ではなく素の寸法を取る形にして、
 * `edit-stamp.ts` から**同じ関数**を呼べるようにした（§3.28 では複製していた）。
 */

import type { StampPosition } from '../types/index.js';

/** ページ番号テキストの書式を展開する */
export function formatPageNumber(template: string, pageNumber: number, total: number): string {
  return template.replaceAll('{n}', String(pageNumber)).replaceAll('{total}', String(total));
}

export interface StampLayout {
  x: number;
  y: number;
}

/** 配置の計算に要るページの寸法。`rotation` は 0 / 90 / 180 / 270 に畳んだ値 */
export interface PageBox {
  width: number;
  height: number;
  rotation: number;
}

/**
 * 配置を計算する。
 * ページの回転（`/Rotate`）を考慮し、「見た目の」指定位置に来るようにする。
 */
export function computePosition(
  page: PageBox,
  position: StampPosition,
  textWidth: number,
  fontSize: number,
  margin: number,
): StampLayout {
  const { width, height } = page;
  const rotation = ((page.rotation % 360) + 360) % 360;

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
