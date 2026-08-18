/**
 * 編集パスに残っている色の変換 — Phase 3（pdf-lib 撤去）の L3' の残骸。
 *
 * **なぜ `color.ts` から出したのか。**
 * L1 では「pdf-lib の色の形を知るファイルを 1 つに」するため `color.ts` に置いていた。
 * L3' で生成パスが `Rgb` をそのまま `ContentStreamBuilder` へ渡すようになり、
 * `color.ts` から pdf-lib の import が消えた。ところが編集パスの 2 ファイル
 * （`page-number.ts` / `watermark.ts`）はまだ pdf-lib の `PDFPage.drawText` を呼ぶので、
 * 変換が要る。`color.ts` に戻すと**生成パスのファイルが pdf-lib を間接に引く**形になる。
 *
 * だから別ファイルにした。**残っている依存が 1 ファイルとして数えられる**ので、
 * 編集パスを移し終えたときに `git rm` 1 回で済み、それまでは
 * 「まだ 2 ファイルが pdf-lib で描いている」ことが import 元の一覧に出る。
 */

import { rgb } from 'pdf-lib';
import type { Rgb } from './color.js';

/** DeviceRGB の 3 成分（§8.6.4.3）を pdf-lib の色オブジェクトへ。 */
export function toPdfLibColor(color: Rgb) {
  return rgb(color.r, color.g, color.b);
}
