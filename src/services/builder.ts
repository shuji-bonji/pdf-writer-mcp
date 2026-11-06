/**
 * Builder
 * 「フォント読込 → グリフ検査 → サブセット埋め込み → レイアウト → 描画 → 保存」の共通フロー。
 * 各ツールハンドラは render コールバックだけ差し替えて使う。
 *
 * フォントのサブセットは「実際に描画するテキスト」に依存するため、
 * 埋め込みは入力テキストが確定した後（グリフ欠落ポリシー適用後）に行う。
 */

import { DEFAULTS } from '../config.js';
import { PAGE_SIZES, type PageSizeName, RENDERER_GENERATED_CHARS } from '../constants.js';
import { invalidArg, PdfWriterError } from '../errors.js';
import type { CommonCreateOptions, CreateResult } from '../types/index.js';
import { inferLang } from '../utils/lang.js';
import { rgb01 } from './color.js';
import { bool, dict, textString } from './cos.js';
import {
  applyMissingGlyphPolicy,
  embedFontFor,
  type LoadedFont,
  openFont,
} from './font-manager.js';
import { LayoutEngine } from './layout.js';
import { finalizeCreated } from './output-created.js';
import { DEFAULT_PDF_VERSION } from './pdf-version.js';
import { assertRenderable } from './renderers/text.js';
import { StructTreeBuilder } from './struct-tree.js';
import { WriterDocument } from './writer-doc.js';

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
  // B-16: writer が書けるアクセシビリティ宣言は PDF/UA-1（ISO 14289-1）だけで、
  // これは PDF 1.7 基盤の規格。PDF 2.0 の器に pdfuaid:part=1 を載せると、
  // **測れない宣言を自分で書く**ことになる（ensure_pdfa を非適合文書に掛けるのと同型）。
  // PDF 2.0 側の相手は PDF/UA-2 で、それは未実装なので黙って通さず断る。
  if (opts.tagged && opts.pdfVersion === '2.0') {
    throw new PdfWriterError(
      'tagged: true cannot be combined with pdfVersion: "2.0" — this server only writes the PDF/UA-1 declaration (ISO 14289-1), which is based on PDF 1.7. PDF/UA-2 output is not implemented.',
      'INVALID_ARGUMENT',
      {
        hint: 'Drop pdfVersion (PDF/UA-1 on PDF 1.7), or drop tagged (untagged PDF 2.0).',
      },
    );
  }

  const doc = WriterDocument.create(opts.pdfVersion ?? DEFAULT_PDF_VERSION);
  const source = await openFont(opts.fontPath);

  // 題名を本文に描くか（SPEC-WRITER-CREATE-TITLE-004 / 005）。描かない題名はメタデータにだけ入り、
  // メタデータはテキスト文字列（ISO 32000-2 §7.9.2.2）でグリフを要さないので、フォントの検査も当てない（002）
  const drawTitle = opts.title !== undefined && opts.drawTitle !== false;

  // 標準フォントで描けない字（WinAnsiEncoding に符号の無い U+0100 以上の字）は、この時点で断る
  assertRenderable(drawTitle ? [opts.title as string, ...inputTexts] : inputTexts, source);

  // フォント未収録文字の検査・置換（埋め込みフォントのみ）
  // 描く title もサブセット対象に含める必要があるため、先頭に連結して一括処理する
  const policy = opts.onMissingGlyph ?? 'error';
  const withTitle = drawTitle ? [opts.title as string, ...inputTexts] : inputTexts;
  const applied = applyMissingGlyphPolicy(withTitle, source, policy);
  const warnings = [...applied.warnings];
  const title = drawTitle ? applied.texts[0] : undefined;
  const texts = drawTitle ? applied.texts.slice(1) : applied.texts;

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
    // PDF/UA-1 §7.1 が求めるのは dc:title で、本文の題名ではない。描くかどうかに関わらず必須（006）
    if (!opts.title) {
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

  // 描く題名は本文冒頭に見出しとして描画（メタデータには描くかどうかに関わらず finalizeCreated が opts.title を書く）
  if (title) {
    struct?.begin('H1');
    engine.drawParagraph(title, {
      size: fontSize + 7,
      color: rgb01(0, 0, 0),
      lineHeight: 1.2,
      spaceAfter: 12,
    });
    struct?.end();
  }

  render(engine, loaded, texts);

  if (struct) {
    await struct.finalize();
    // PDF/UA-1 が catalog に要求するもの（MarkInfo と StructTreeRoot は finalize が置く）:
    //   /Lang                                 7.2 (1)
    //   /ViewerPreferences /DisplayDocTitle   7.1 (8)
    // XMP（pdfuaid:part / dc:title）は出口が uaLang を受けて書く
    await doc.updateCatalog([
      ['Lang', textString(lang as string)],
      ['ViewerPreferences', dict([['DisplayDocTitle', bool(true)]])],
    ]);
  }

  const result = await finalizeCreated(doc, opts, {
    fontName: loaded.name,
    ...(struct ? { uaLang: lang as string } : {}),
  });
  if (warnings.length > 0) result.warnings = warnings;
  return result;
}
