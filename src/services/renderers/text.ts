/**
 * Text Renderer
 * プレーンテキスト → PDF。空行を段落区切りとして扱う。
 */

import { rgb } from 'pdf-lib';
import { LayoutEngine, hasNonLatin1 } from '../layout.js';
import type { FontSource, LoadedFont } from '../font-manager.js';
import { DEFAULTS } from '../../config.js';

export function renderText(engine: LayoutEngine, text: string, loaded: LoadedFont): void {
  assertRenderable(text, loaded);

  // 連続する空行を段落境界とみなす
  const paragraphs = text.split(/\n[ \t]*\n/);
  for (const para of paragraphs) {
    if (para.trim() === '') continue;
    engine.drawParagraph(para, {
      color: rgb(0.1, 0.1, 0.1),
      spaceAfter: DEFAULTS.paragraphGap,
    });
  }
}

/** 標準フォントに日本語などを渡すと壊れるため、事前に分かりやすく弾く */
export function assertRenderable(text: string, loaded: Pick<FontSource | LoadedFont, 'isStandard'>): void {
  if (loaded.isStandard && hasNonLatin1(text)) {
    throw new Error(
      'The text contains non-Latin characters (e.g. Japanese) but no embeddable font was provided. ' +
        'Pass "fontPath" pointing to a .ttf/.otf font (e.g. Noto Sans JP), ' +
        `or set the ${'PDF_WRITER_FONT'} environment variable.`
    );
  }
}
