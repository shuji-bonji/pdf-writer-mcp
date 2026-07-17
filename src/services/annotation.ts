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
  fill,
  fillAndStroke,
  lineTo,
  moveTo,
  PDFArray,
  type PDFDict,
  type PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  type PDFOperator,
  type PDFPage,
  type PDFRef,
  PDFString,
  type RGB,
  rectangle,
  rgb,
  setFillingRgbColor,
  setGraphicsState,
  setLineWidth,
  setStrokingRgbColor,
  stroke,
} from 'pdf-lib';
import { outputDate } from '../config.js';
import type { AddAnnotationArgs, AnnotationRect } from '../types/index.js';

/**
 * 注釈のテキストの段落区切りを CR（0Dh）に正規化する。
 *
 * ISO 32000-2 §12.5.6.2（R-12.5.6.2-7・shall）:
 *   「段落を区切るときは CARRIAGE RETURN (0Dh) を使わなければならず、
 *     例えば LINE FEED (0Ah) を使ってはならない」
 *
 * MCP の引数は JSON なので、利用者が書くのはまず `\n`（LF）である。そのまま
 * `/Contents` に入れると shall 違反になり、かつ popup で改行として扱わない
 * ビューアが出る。CRLF は CR 1 つに畳む（CR+LF を 2 段落と数えさせない）。
 *
 * SPEC-AUDIT Phase 2 で発見。veraPDF の PDF/UA 規則には現れない領域
 * （文字列の中身までは見ない）ため、条文照合でしか見つからない。
 */
export function normalizeAnnotationText(text: string): string {
  return text.replace(/\r\n|\n|\r/g, '\r');
}

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

export interface AddedAnnotation {
  /** 追加後のそのページの注釈数 */
  count: number;
  /** 追加した注釈への参照（構造木へ結び付けるのに使う） */
  ref: PDFRef;
  /** 対象ページ */
  page: PDFPage;
}

/** 注釈をページに追加する */
export function addAnnotation(doc: PDFDocument, args: AddAnnotationArgs): AddedAnnotation {
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
  // /Contents は日本語対応のため UTF-16BE。段落区切りは CR（§12.5.6.2・shall）
  dict.set(
    PDFName.of('Contents'),
    PDFHexString.fromText(normalizeAnnotationText(args.contents ?? '')),
  );
  if (args.author) dict.set(PDFName.of('T'), PDFHexString.fromText(args.author));
  // SOURCE_DATE_EPOCH（E-6）に従う。書式は §7.9.4 の日付文字列
  dict.set(PDFName.of('M'), PDFString.fromDate(outputDate()));
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

  // ISO 32000-2 Table 166: 「PDF writer は書き込み時に外観辞書を含めなければならない」
  // （shall。例外は退化 Rect と Popup/Projection/Link のみ — 本ツールの 3 種は全て対象）。
  // 32000-1 では Optional だったため v0.9.1 まで欠けていた（SPEC-AUDIT Phase 1 で発見）。
  const w = r.x2 - r.x1;
  const h = r.y2 - r.y1;
  const ap = context.obj({}) as PDFDict;
  ap.set(PDFName.of('N'), buildAppearance(doc, args, color, w, h));
  dict.set(PDFName.of('AP'), ap);

  let annots = page.node.lookup(PDFName.of('Annots'));
  if (!(annots instanceof PDFArray)) {
    annots = context.obj([]) as PDFArray;
    page.node.set(PDFName.of('Annots'), annots);
  }
  const ref = context.register(dict);
  (annots as PDFArray).push(ref);

  return { count: (annots as PDFArray).size(), ref, page };
}

/**
 * 通常外観（/AP /N）の Form XObject を組み立てて登録する。
 * BBox は [0 0 w h] で、ビューアが /Rect へ写像する。
 */
function buildAppearance(
  doc: PDFDocument,
  args: AddAnnotationArgs,
  color: RGB,
  w: number,
  h: number,
): PDFRef {
  const { context } = doc;
  const ops: PDFOperator[] = [];
  const extras: Record<string, unknown> = {};

  switch (args.type) {
    case 'highlight': {
      // Multiply ブレンドで下のテキストが透ける、いわゆる蛍光ペン
      extras.Resources = context.obj({
        ExtGState: { GS0: { Type: 'ExtGState', BM: 'Multiply' } },
      });
      ops.push(
        setGraphicsState('GS0'),
        setFillingRgbColor(color.red, color.green, color.blue),
        rectangle(0, 0, w, h),
        fill(),
      );
      break;
    }

    case 'square': {
      const lw = 1.5;
      ops.push(setLineWidth(lw), setStrokingRgbColor(color.red, color.green, color.blue));
      if (args.interiorColor) {
        const ic = parseHexColor(args.interiorColor);
        ops.push(
          setFillingRgbColor(ic.red, ic.green, ic.blue),
          rectangle(lw / 2, lw / 2, w - lw, h - lw),
          fillAndStroke(),
        );
      } else {
        ops.push(rectangle(lw / 2, lw / 2, w - lw, h - lw), stroke());
      }
      break;
    }

    default: {
      // text: 付箋アイコン（地色の紙面 + 枠 + 罫線 3 本の簡易ノート）
      ops.push(
        setFillingRgbColor(color.red, color.green, color.blue),
        rectangle(0, 0, w, h),
        fill(),
        setLineWidth(Math.max(0.75, h * 0.04)),
        setStrokingRgbColor(0.25, 0.25, 0.25),
        rectangle(0.5, 0.5, w - 1, h - 1),
        stroke(),
      );
      for (const frac of [0.3, 0.5, 0.7]) {
        ops.push(moveTo(w * 0.2, h * frac), lineTo(w * 0.8, h * frac), stroke());
      }
      break;
    }
  }

  const xobj = context.formXObject(ops, { BBox: context.obj([0, 0, w, h]), ...extras });
  return context.register(xobj);
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
