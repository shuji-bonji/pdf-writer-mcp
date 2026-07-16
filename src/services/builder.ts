/**
 * Builder
 * 「フォント読込 → グリフ検査 → サブセット埋め込み → レイアウト → 描画 → 保存」の共通フロー。
 * 各ツールハンドラは render コールバックだけ差し替えて使う。
 *
 * フォントのサブセットは「実際に描画するテキスト」に依存するため、
 * 埋め込みは入力テキストが確定した後（グリフ欠落ポリシー適用後）に行う。
 */

import { PDFDocument, rgb } from 'pdf-lib';
import { DEFAULTS } from '../config.js';
import { PAGE_SIZES, type PageSizeName, RENDERER_GENERATED_CHARS } from '../constants.js';
import { invalidArg } from '../errors.js';
import type { CommonCreateOptions, CreateResult } from '../types/index.js';
import { inferLang } from '../utils/lang.js';
import {
  applyMissingGlyphPolicy,
  embedFontFor,
  type LoadedFont,
  openFont,
} from './font-manager.js';
import { LayoutEngine } from './layout.js';
import { finalizePdf } from './output.js';
import { assertRenderable } from './renderers/text.js';
import { StructTreeBuilder } from './struct-tree.js';
import { applyPdfuaCatalog } from './xmp.js';

/**
 * render コールバック。texts には onMissingGlyph ポリシー適用済みの
 * 入力テキスト（buildPdf の inputTexts と同順）が渡される。
 */
export type RenderFn = (engine: LayoutEngine, loaded: LoadedFont, texts: string[]) => void;

export async function buildPdf(
  opts: CommonCreateOptions,
  inputTexts: string[],
  render: RenderFn,
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

  // 描画確定後のテキストでサブセットして埋め込む。
  // レンダラが入力に無い文字（箇条書きの '•' 等）を足すため、それらも必ず含める
  const loaded = await embedFontFor(doc, source, [...applied.texts, RENDERER_GENERATED_CHARS]);

  const pageName: PageSizeName = opts.pageSize ?? (DEFAULTS.pageSize as PageSizeName);
  const [pageWidth, pageHeight] = PAGE_SIZES[pageName];
  const fontSize = opts.fontSize ?? DEFAULTS.fontSize;

  // タグ付き（PDF/UA）の準備
  let struct: StructTreeBuilder | undefined;
  let lang: string | undefined;
  if (opts.tagged) {
    if (!title) {
      throw invalidArg(
        'tagged: true requires "title" — PDF/UA (ISO 14289-1, 7.1) mandates a document title.',
      );
    }
    if (source.isStandard) {
      // veraPDF 実測（2026-07-17）: 標準フォントは 7.21.4.1-1（フォント埋め込み）で必ず違反になる
      warnings.push(
        'The standard font (Helvetica) is not embedded, but PDF/UA-1 (7.21.4.1) requires all ' +
          'fonts to be embedded — this tagged PDF will NOT pass conformance validation. ' +
          'Pass "fontPath" (or set PDF_WRITER_FONT) to embed a font.',
      );
    }
    lang = opts.lang;
    if (!lang) {
      const inferred = inferLang(applied.texts.join('\n'));
      lang = inferred.lang;
      warnings.push(
        inferred.confident
          ? `Inferred document language as "${lang}"; pass "lang" explicitly to override.`
          : `Inferred document language as "${lang}", but the text has no kana so it could also be Chinese. Pass "lang" explicitly — a wrong /Lang makes screen readers mispronounce the text.`,
      );
    }
    struct = new StructTreeBuilder(doc);
  }

  const engine = new LayoutEngine(doc, {
    pageWidth,
    pageHeight,
    margin: opts.margin ?? DEFAULTS.margin,
    font: loaded.font,
    fontSize,
    lineHeight: DEFAULTS.lineHeight,
    struct,
  });

  // タイトルが指定されていれば本文冒頭に見出しとして描画（メタデータにも finalizePdf で設定）
  if (title) {
    struct?.begin('H1');
    engine.drawParagraph(title, {
      size: fontSize + 7,
      color: rgb(0, 0, 0),
      lineHeight: 1.2,
      spaceAfter: 12,
    });
    struct?.end();
  }

  render(engine, loaded, texts);

  if (struct) {
    struct.finalize();
    applyPdfuaCatalog(doc, { title: title as string, author: opts.author, lang: lang as string });
  }

  const result = await finalizePdf(doc, opts, loaded.name);
  if (warnings.length > 0) result.warnings = warnings;
  return result;
}
