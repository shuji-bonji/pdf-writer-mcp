/**
 * Text Renderer
 * プレーンテキスト → PDF。空行を段落区切りとして扱う。
 */

import { rgb } from 'pdf-lib';
import { DEFAULTS } from '../../config.js';
import { NEXT_ACTIONS, PdfWriterError } from '../../errors.js';
import type { FontSource, LoadedFont } from '../font-manager.js';
import { hasNonLatin1, type LayoutEngine } from '../layout.js';

export function renderText(engine: LayoutEngine, text: string, loaded: LoadedFont): void {
  assertRenderable(text, loaded);

  // 連続する空行を段落境界とみなす
  const paragraphs = text.split(/\n[ \t]*\n/);
  for (const para of paragraphs) {
    if (para.trim() === '') continue;
    // タグ付き時は各段落を <P> にする
    engine.struct?.begin('P');
    engine.drawParagraph(para, {
      color: rgb(0.1, 0.1, 0.1),
      spaceAfter: DEFAULTS.paragraphGap,
    });
    engine.struct?.end();
  }
}

/** 標準フォントに日本語などを渡すと壊れるため、事前に分かりやすく弾く */
export function assertRenderable(
  text: string,
  loaded: Pick<FontSource | LoadedFont, 'isStandard'>,
): void {
  if (loaded.isStandard && hasNonLatin1(text)) {
    throw new PdfWriterError(
      'The text contains non-Latin characters (e.g. Japanese) but no embeddable font was provided.',
      'FONT_REQUIRED',
      { retryable: true, next_actions: [NEXT_ACTIONS.provideFontPath()] },
    );
  }
}
