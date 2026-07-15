/**
 * Builder
 * 「doc 生成 → フォント埋め込み → レイアウトエンジン → 描画 → 保存」の共通フロー。
 * 各ツールハンドラは render コールバックだけ差し替えて使う。
 */

import { PDFDocument, rgb } from 'pdf-lib';
import { PAGE_SIZES, type PageSizeName } from '../constants.js';
import { DEFAULTS } from '../config.js';
import type { CommonCreateOptions, CreateResult } from '../types/index.js';
import { loadFont, type LoadedFont } from './font-manager.js';
import { LayoutEngine } from './layout.js';
import { finalizePdf } from './output.js';
import { assertRenderable } from './renderers/text.js';

export type RenderFn = (engine: LayoutEngine, loaded: LoadedFont) => void;

export async function buildPdf(
  opts: CommonCreateOptions,
  render: RenderFn
): Promise<CreateResult> {
  const doc = await PDFDocument.create();
  const loaded = await loadFont(doc, opts.fontPath);

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
    engine.drawParagraph(opts.title, {
      size: fontSize + 7,
      color: rgb(0, 0, 0),
      lineHeight: 1.2,
      spaceAfter: 12,
    });
  }

  render(engine, loaded);

  return finalizePdf(doc, opts, loaded.name);
}
