/**
 * Builder
 * 「doc 生成 → フォント埋め込み → レイアウトエンジン → 描画 → 保存」の共通フロー。
 * 各ツールハンドラは render コールバックだけ差し替えて使う。
 */

import { PDFDocument, rgb } from 'pdf-lib';
import { PAGE_SIZES, type PageSizeName } from '../constants.js';
import { DEFAULTS } from '../config.js';
import type { CommonCreateOptions, CreateResult } from '../types/index.js';
import { applyMissingGlyphPolicy, loadFont, type LoadedFont } from './font-manager.js';
import { LayoutEngine } from './layout.js';
import { finalizePdf } from './output.js';
import { assertRenderable } from './renderers/text.js';

/**
 * render コールバック。texts には onMissingGlyph ポリシー適用済みの
 * 入力テキスト（buildPdf の inputTexts と同順）が渡される。
 */
export type RenderFn = (engine: LayoutEngine, loaded: LoadedFont, texts: string[]) => void;

export async function buildPdf(
  opts: CommonCreateOptions,
  inputTexts: string[],
  render: RenderFn
): Promise<CreateResult> {
  const doc = await PDFDocument.create();
  const loaded = await loadFont(doc, opts.fontPath);

  // フォント未収録文字の検査・置換（埋め込みフォントのみ。標準フォントは assertRenderable が担当）
  const policy = opts.onMissingGlyph ?? 'error';
  const applied = applyMissingGlyphPolicy(inputTexts, loaded, policy);
  const warnings = [...applied.warnings];

  const pageName: PageSizeName = opts.pageSize ?? (DEFAULTS.pageSize as PageSizeName);
  const [pageWidth, pageHeight] = PAGE_SIZES[pageName];
  const fontSize = opts.fontSize ?? DEFAULTS.fontSize;

  const engine = new LayoutEngine(doc, {
    pageWidth,
    pageHeight,
    margin: opts.margin ?? DEFAULTS.margin,
    font: loaded.font,
    fontSize,
    lineHeight: DEFAULTS.lineHeight,
  });

  // タイトルが指定されていれば本文冒頭に見出しとして描画（メタデータにも finalizePdf で設定）
  if (opts.title) {
    assertRenderable(opts.title, loaded);
    const titleApplied = applyMissingGlyphPolicy([opts.title], loaded, policy);
    warnings.push(...titleApplied.warnings);
    engine.drawParagraph(titleApplied.texts[0], {
      size: fontSize + 7,
      color: rgb(0, 0, 0),
      lineHeight: 1.2,
      spaceAfter: 12,
    });
  }

  render(engine, loaded, applied.texts);

  const result = await finalizePdf(doc, opts, loaded.name);
  if (warnings.length > 0) result.warnings = warnings;
  return result;
}
