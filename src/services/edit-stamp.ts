/**
 * `add_watermark` / `stamp_page_numbers` —— Phase 3 の L4′.2（13〜14 本目）。
 *
 * どちらも「既存のページに文字を描き足す」ツールで、受け皿を共有する:
 * `font-pool.ts`（番号の池）・`page-draw.ts`（描画の追記）・`tagged-cos.ts`（タグ判定）。
 *
 * 🔴 **DocMDP は `'content'`。** ページ内容への描画追記は §12.8.2.2 Table 257 の
 * 許可種別に無いので、認証署名のある文書では**どの許可レベルでも断る**。
 *
 * **測定は触っていない。** 位置の計算は `watermark.ts` の `centeredOrigin` と
 * `page-number.ts` の `computePosition` を**そのまま呼ぶ**。変えたのは描画の器だけである。
 * （両ファイルは pdf-lib の `drawText` を呼ぶ部分を落として、計算だけになった。）
 */

import { COS_NULL, type PageEntry, type PdfDocumentEditor } from 'normativepdf';
import { STAMP_DEFAULTS, WATERMARK_DEFAULTS } from '../constants.js';
import type {
  AddWatermarkArgs,
  StampPageNumbersArgs,
  StampResult,
  WatermarkResult,
} from '../types/index.js';
import { logger } from '../utils/logger.js';
import { parsePageSpec } from '../utils/page-spec.js';
import { rgbFromHex } from './color.js';
import { assertDocMdpAllows } from './doc-mdp.js';
import { openForEdit } from './edit-open.js';
import { applyMissingGlyphPolicy, embedFontFor, openFont } from './font-manager.js';
import { EMBEDDED_FONT_OBJECTS, fontHostFor, STANDARD_FONT_OBJECTS } from './font-pool.js';
import { appendOpened } from './incremental-append.js';
import { saveOpened } from './output-edited.js';
import { drawTextOnPage } from './page-draw.js';
import { computePosition, formatPageNumber } from './page-number.js';
import { assertRenderable } from './renderers/text.js';
import { isTaggedDoc } from './tagged-cos.js';
import { centeredOrigin } from './watermark.js';

/** ページの見た目の大きさと回転（§7.7.3.4 の継承を解決してから読む） */
async function pageBox(
  editor: PdfDocumentEditor,
  index: number,
): Promise<{ width: number; height: number; rotation: number }> {
  const box = await editor.pageAttribute(index, 'MediaBox');
  const media = box === undefined ? COS_NULL : await editor.resolve(box);
  const numbers =
    media.kind === 'array'
      ? await Promise.all(
          media.items.map(async (item) => {
            const value = await editor.resolve(item);
            return value.kind === 'integer' || value.kind === 'real' ? value.value : 0;
          }),
        )
      : [0, 0, 612, 792];
  const [x1 = 0, y1 = 0, x2 = 612, y2 = 792] = numbers;

  const rotateRaw = await editor.pageAttribute(index, 'Rotate');
  const rotate = rotateRaw === undefined ? COS_NULL : await editor.resolve(rotateRaw);
  const angle = rotate.kind === 'integer' ? rotate.value : 0;

  return {
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
    rotation: ((angle % 360) + 360) % 360,
  };
}

export async function addWatermark(args: AddWatermarkArgs): Promise<WatermarkResult> {
  const opened = await openForEdit(args.inputPath, args);
  const preserve = args.preserveSignatures === true;
  if (preserve) await assertDocMdpAllows(opened.editor, 'content');

  const pages = await opened.editor.pages();
  const total = pages.length;
  const fontSize = args.fontSize ?? WATERMARK_DEFAULTS.fontSize;
  const opacity = args.opacity ?? WATERMARK_DEFAULTS.opacity;
  const angle = args.angle ?? WATERMARK_DEFAULTS.angle;
  const behind = args.behind ?? WATERMARK_DEFAULTS.behind;
  const color = rgbFromHex(args.color ?? WATERMARK_DEFAULTS.color);
  const targets = args.pages
    ? parsePageSpec(args.pages, total)
    : Array.from({ length: total }, (_, i) => i + 1);

  // 透かし文字も生成パスと同じ font-manager を通す（harfbuzz サブセット・グリフ検査）
  const source = await openFont(args.fontPath);
  assertRenderable(args.text, source);
  const applied = applyMissingGlyphPolicy([args.text], source, 'error');
  const host = await fontHostFor(
    opened.editor,
    source.isStandard || !source.bytes ? STANDARD_FONT_OBJECTS : EMBEDDED_FONT_OBJECTS,
  );
  const loaded = await embedFontFor(host, source, applied.texts);

  const text = applied.texts[0] as string;
  const artifact = await isTaggedDoc(opened.editor);
  for (const pageNo of targets) {
    const size = await pageBox(opened.editor, pageNo - 1);
    const width = loaded.font.widthOfTextAtSize(text, fontSize);
    const origin = centeredOrigin(size.width, size.height, width, fontSize, angle);
    await drawTextOnPage(
      opened.editor,
      pages[pageNo - 1] as PageEntry,
      loaded.font,
      { text, x: origin.x, y: origin.y, size: fontSize, color, angle, opacity },
      { artifact, behind },
    );
  }

  logger.info(
    'Editor',
    `Watermarked ${targets.length} page(s)${behind ? ' behind content' : ''}${artifact ? ' as artifacts' : ''}`,
  );

  const saved = preserve ? await appendOpened(opened, args) : await saveOpened(opened, args);
  return { ...saved, watermarked: targets.length, artifact };
}

export async function stampPageNumbers(args: StampPageNumbersArgs): Promise<StampResult> {
  const opened = await openForEdit(args.inputPath, args);
  const preserve = args.preserveSignatures === true;
  if (preserve) await assertDocMdpAllows(opened.editor, 'content');

  const pages = await opened.editor.pages();
  const total = pages.length;
  const format = args.format ?? STAMP_DEFAULTS.format;
  const position = args.position ?? STAMP_DEFAULTS.position;
  const margin = args.margin ?? STAMP_DEFAULTS.margin;
  const fontSize = args.fontSize ?? STAMP_DEFAULTS.fontSize;
  const startAt = args.startAt ?? STAMP_DEFAULTS.startAt;
  const color = rgbFromHex(args.color ?? STAMP_DEFAULTS.color);
  const targets = args.pages
    ? parsePageSpec(args.pages, total)
    : Array.from({ length: total }, (_, i) => i + 1);

  // 刻む文字を先に確定させる。サブセットは「実際に描く文字」に依存するため（ADR-7/8）、
  // 番号を振り終えてから埋め込む
  const texts = targets.map((_, i) => formatPageNumber(format, startAt + i, total));
  const source = await openFont(args.fontPath);
  for (const text of texts) assertRenderable(text, source);
  const applied = applyMissingGlyphPolicy(texts, source, 'error');
  const host = await fontHostFor(
    opened.editor,
    source.isStandard || !source.bytes ? STANDARD_FONT_OBJECTS : EMBEDDED_FONT_OBJECTS,
  );
  const loaded = await embedFontFor(host, source, applied.texts);

  const artifact = await isTaggedDoc(opened.editor);
  for (const [i, pageNo] of targets.entries()) {
    const text = applied.texts[i] as string;
    const size = await pageBox(opened.editor, pageNo - 1);
    const width = loaded.font.widthOfTextAtSize(text, fontSize);
    const { x, y } = computePosition(size, position, width, fontSize, margin);
    await drawTextOnPage(
      opened.editor,
      pages[pageNo - 1] as PageEntry,
      loaded.font,
      // ページの回転に合わせて文字も回す（回転ページで横倒しにならないように）
      { text, x, y, size: fontSize, color, angle: size.rotation },
      { artifact, behind: false },
    );
  }

  logger.info('Editor', `Stamped ${targets.length} page(s)${artifact ? ' as artifacts' : ''}`);

  const saved = preserve ? await appendOpened(opened, args) : await saveOpened(opened, args);
  return { ...saved, stamped: targets.length, artifact };
}
