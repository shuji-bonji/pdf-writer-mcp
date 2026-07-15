/**
 * Builder
 * 「フォント読込 → グリフ検査 → サブセット埋め込み → レイアウト → 描画 → 保存」の共通フロー。
 * 各ツールハンドラは render コールバックだけ差し替えて使う。
 *
 * フォントのサブセットは「実際に描画するテキスト」に依存するため、
 * 埋め込みは入力テキストが確定した後（グリフ欠落ポリシー適用後）に行う。
 */

import { PDFDocument, rgb } from 'pdf-lib';
import { PAGE_SIZES, type PageSizeName } from '../constants.js';
import { DEFAULTS } from '../config.js';
import type { CommonCreateOptions, CreateResult } from '../types/index.js';
import { applyMissingGlyphPolicy, embedFontFor, openFont, type LoadedFont } from './font-manager.js';
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
  const source = await openFont(opts.fontPath);

  // 標準フォント × 非 Latin-1 は、この時点で分かりやすく弾く
  for (const t of inputTexts) assertRenderable(t, source);
  if (opts.title) assertRenderable(opts.title, source);

  // フォント未収録文字の検査・置換（埋め込みフォントのみ）
  // title もサブセット対象に含める必要があるため、先頭に連結して一括処理する
  const policy = opts.onMissingGlyph ?? 'error';
  const withTitle = opts.title ? [opts.title, ...inputTexts] : inputTexts;
  const applied = applyMissingGlyphPolicy(withTitle, source, policy);
  const warnings = [...applied.warnings];
  const title = opts.title ? applied.texts[0] : undefined;
  const texts = opts.title ? applied.texts.slice(1) : applied.texts;

  // 描画確定後のテキストでサブセットして埋め込む
  const loaded = await embedFontFor(doc, source, applied.texts);

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
  if (title) {
    engine.drawParagraph(title, {
      size: fontSize + 7,
      color: rgb(0, 0, 0),
      lineHeight: 1.2,
      spaceAfter: 12,
    });
  }

  render(engine, loaded, texts);

  const result = await finalizePdf(doc, opts, loaded.name);
  if (warnings.length > 0) result.warnings = warnings;
  return result;
}
