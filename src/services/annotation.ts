/**
 * Annotation
 * pdf-lib の低レベル API で注釈辞書を組み立て、ページの /Annots に追加する。
 *
 * 対応（ISO 32000-1 §12.5.6）:
 *   - text      : 付箋（Text annotation）。/Rect の左上にアイコン表示
 *   - highlight : ハイライト（Highlight）。/QuadPoints が必須
 *   - square    : 矩形（Square）
 *
 * 座標系は PDF 準拠（左下原点・pt）。生成系レンダラの top 基準とは異なる点に注意。
 */

import {
  PDFArray,
  type PDFDict,
  type PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFString,
  type RGB,
  rgb,
} from 'pdf-lib';
import type { AddAnnotationArgs, AnnotationRect } from '../types/index.js';

/** #rrggbb / #rgb を pdf-lib の RGB へ */
export function parseHexColor(hex: string): RGB {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) {
    throw new Error(`color must be a hex string like "#ffcc00", got ${JSON.stringify(hex)}`);
  }
  let h = m[1];
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = Number.parseInt(h, 16);
  return rgb(((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255);
}

function colorArray(doc: PDFDocument, color: RGB): PDFArray {
  return doc.context.obj([color.red, color.green, color.blue]) as PDFArray;
}

/** 注釈をページに追加する。@returns 追加後のそのページの注釈数 */
export function addAnnotation(doc: PDFDocument, args: AddAnnotationArgs): number {
  const pages = doc.getPages();
  const pageIndex = args.page - 1;
  if (pageIndex < 0 || pageIndex >= pages.length) {
    throw new Error(`page ${args.page} is out of range (document has ${pages.length} page(s))`);
  }
  const page = pages[pageIndex];
  const { context } = doc;

  const r: AnnotationRect = args.rect;
  const rect = context.obj([r.x1, r.y1, r.x2, r.y2]) as PDFArray;

  const dict = context.obj({}) as PDFDict;
  dict.set(PDFName.of('Type'), PDFName.of('Annot'));
  dict.set(PDFName.of('Rect'), rect);
  dict.set(PDFName.of('P'), page.ref);
  // /Contents は日本語対応のため UTF-16BE
  dict.set(PDFName.of('Contents'), PDFHexString.fromText(args.contents ?? ''));
  if (args.author) dict.set(PDFName.of('T'), PDFHexString.fromText(args.author));
  dict.set(PDFName.of('M'), PDFString.fromDate(new Date()));
  // /F: bit3 Print（印刷に含める）
  dict.set(PDFName.of('F'), PDFNumber.of(4));

  const color = parseHexColor(args.color ?? defaultColor(args.type));
  dict.set(PDFName.of('C'), colorArray(doc, color));

  switch (args.type) {
    case 'text':
      dict.set(PDFName.of('Subtype'), PDFName.of('Text'));
      dict.set(PDFName.of('Name'), PDFName.of(args.icon ?? 'Note'));
      dict.set(PDFName.of('Open'), context.obj(args.open ?? false));
      break;

    case 'highlight': {
      dict.set(PDFName.of('Subtype'), PDFName.of('Highlight'));
      // QuadPoints は左上→右上→左下→右下 の順（§12.5.6.10 の慣行）
      const quad = context.obj([r.x1, r.y2, r.x2, r.y2, r.x1, r.y1, r.x2, r.y1]) as PDFArray;
      dict.set(PDFName.of('QuadPoints'), quad);
      break;
    }

    case 'square':
      dict.set(PDFName.of('Subtype'), PDFName.of('Square'));
      if (args.interiorColor) {
        dict.set(PDFName.of('IC'), colorArray(doc, parseHexColor(args.interiorColor)));
      }
      break;
  }

  let annots = page.node.lookup(PDFName.of('Annots'));
  if (!(annots instanceof PDFArray)) {
    annots = context.obj([]) as PDFArray;
    page.node.set(PDFName.of('Annots'), annots);
  }
  (annots as PDFArray).push(context.register(dict));

  return (annots as PDFArray).size();
}

function defaultColor(type: AddAnnotationArgs['type']): string {
  switch (type) {
    case 'highlight':
      return '#ffff00';
    case 'square':
      return '#ff0000';
    default:
      return '#ffd400';
  }
}
