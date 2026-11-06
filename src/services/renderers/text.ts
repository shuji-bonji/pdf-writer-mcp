/**
 * Text Renderer
 * プレーンテキスト → PDF。空行を段落区切りとして扱う。
 */

import { DEFAULTS } from '../../config.js';
import { NEXT_ACTIONS, PdfWriterError } from '../../errors.js';
import { characterDetail, describeCharacters } from '../char-report.js';
import { COLORS } from '../color.js';
import type { FontSource, LoadedFont } from '../font-manager.js';
import type { LayoutEngine } from '../layout.js';
import { needsEmbeddedFont } from '../win-ansi.js';

export function renderText(engine: LayoutEngine, text: string, loaded: LoadedFont): void {
  assertRenderable(text, loaded);

  // 連続する空行を段落境界とみなす
  const paragraphs = text.split(/\n[ \t]*\n/);
  for (const para of paragraphs) {
    if (para.trim() === '') continue;
    // タグ付き時は各段落を <P> にする
    engine.struct?.begin('P');
    engine.drawParagraph(para, {
      color: COLORS.bodyText,
      spaceAfter: DEFAULTS.paragraphGap,
    });
    engine.struct?.end();
  }
}

/**
 * 標準フォントでは描けない字（WinAnsiEncoding に符号の無い U+0100 以上の字）を、描く前に断る
 * （SPEC-WRITER-STANDARD-FONT-ENCODING-004）。断った字は文と `detail` で名指す
 * （SPEC-WRITER-COMMON-ERRORS-007）。
 *
 * 生成 3 ツールは `buildPdf` が、表のセルと描く題名を含むすべての入力にこれを当てる。
 * 編集系（`add_watermark`・`stamp_page_numbers`・`fill_form`）も同じ関数を通る。
 */
export function assertRenderable(
  text: string | readonly string[],
  loaded: Pick<FontSource | LoadedFont, 'isStandard'>,
): void {
  if (!loaded.isStandard) return;
  const refused = new Set<string>();
  // 入力が複数（表のセル・題名・フォームの値）でも、原因の字は全部を 1 回で名指す
  for (const t of typeof text === 'string' ? [text] : text) {
    for (const ch of t) {
      if (needsEmbeddedFont(ch.codePointAt(0) as number)) refused.add(ch);
    }
  }
  if (refused.size === 0) return;
  const chars = [...refused];
  throw new PdfWriterError(
    `The text contains characters the standard font (Helvetica, WinAnsiEncoding) cannot encode: ${describeCharacters(chars)}. No embeddable font was provided.`,
    'FONT_REQUIRED',
    { next_actions: [NEXT_ACTIONS.provideFontPath()], detail: characterDetail(chars) },
  );
}
