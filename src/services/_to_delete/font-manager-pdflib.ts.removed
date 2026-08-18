/**
 * 編集パスに残っているフォント埋め込み — Phase 3（pdf-lib 撤去）の L3' の残骸。
 *
 * **なぜ `font-manager.ts` から出したのか。**
 * `embedFontFor` は生成パスと編集パスの両方から呼ばれていた。L3' で生成側が
 * `WriterDocument` を受け取る形になった時点で、pdf-lib の `PDFDocument` を渡す
 * 編集側（`stamp_page_numbers` / `add_watermark` / `fill_form`）が通らなくなる。
 *
 * 同じ名前で 2 つの器を受ける形（オーバーロードや分岐）にしなかったのは、
 * **残っている pdf-lib 依存を数えられなくなる**ため。別ファイルにしておけば、
 * 編集パスを移し終えたときに `git rm` 1 回で済み、それまでは import 元の一覧に
 * 「まだ 1 ファイルが pdf-lib でフォントを埋めている」ことが出る。
 * `color-pdflib.ts` と同じ扱い。
 *
 * ⚠️ **こちらは `buildType0Font` を通らない**ので、辞書の型を pdf-lib が決める。
 * W-2（CFF を `CIDFontType2` + `FontFile2` で埋める）を表現できてしまう経路が
 * 編集側にはまだ残っており、`font-conformance.ts` の `normalizeEmbeddedFonts` が
 * 後から是正している。生成側はその是正が不要になった（型として作れない）。
 */

import fontkit from '@pdf-lib/fontkit';
import type { PDFDocument, PDFFont } from 'pdf-lib';
import subsetFont from 'subset-font';
import { PdfWriterError } from '../errors.js';
import { logger } from '../utils/logger.js';
import type { FontSource } from './font-manager.js';

const CTX = 'FontManager';
const STANDARD_14_FALLBACK = 'Helvetica';

/** 編集パス用の埋め込み結果。`font` は pdf-lib の値である */
export interface LoadedPdfLibFont {
  font: PDFFont;
  name: string;
  isStandard: boolean;
  hasGlyph?: (codePoint: number) => boolean;
}

/**
 * 実際に描画するテキストに合わせてフォントをサブセットし、pdf-lib の文書に埋め込む。
 *
 * サブセットを harfbuzz で先に済ませて `subset: false` で渡すのは v0.3.0 からの方針で、
 * pdf-lib（fontkit）の再サブセットが CJK でグリフを取りこぼして**描画が豆腐化する**
 * ためである（ToUnicode は正しいのでテキスト抽出だけ通り、破損に気づきにくい）。
 */
export async function embedFontIntoPdfLib(
  doc: PDFDocument,
  source: FontSource,
  texts: string[],
): Promise<LoadedPdfLibFont> {
  if (source.isStandard || !source.bytes) {
    const font = await doc.embedFont(STANDARD_14_FALLBACK);
    return { font, name: source.name, isStandard: true };
  }

  doc.registerFontkit(fontkit);

  let toEmbed: Uint8Array = source.bytes;
  const used = texts.join('') || ' ';
  try {
    toEmbed = await subsetFont(Buffer.from(source.bytes), used, {
      targetFormat: 'sfnt',
      noLayoutClosure: true,
    });
    logger.info(
      CTX,
      `Subset ${source.name} with harfbuzz: ${source.bytes.length} -> ${toEmbed.length} bytes`,
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn(CTX, `harfbuzz subsetting failed (${msg}); embedding the full font instead`);
  }

  let font: PDFFont;
  try {
    font = await doc.embedFont(toEmbed, { subset: false });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new PdfWriterError(`Failed to embed font ${source.name}: ${msg}`, 'INTERNAL_ERROR');
  }

  logger.info(CTX, `Embedded custom font: ${source.name}`);
  return { font, name: source.name, isStandard: false, hasGlyph: source.hasGlyph };
}
