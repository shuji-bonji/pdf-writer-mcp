/**
 * 注釈（§12.5）を COS の上で組み立てる —— Phase 3 の L4′.2。
 *
 * 旧実装は `annotation.ts`（221 行・pdf-lib）。**器だけを変えた**もので、辞書の中身は同じ。
 *
 * | 要件 | 何を言っているか |
 * |---|---|
 * | Table 166 | `/Type /Annot`・`/Rect`・`/Subtype` は必須。**外観辞書は書き込み時に含めなければならない**（shall。退化 Rect と Popup / Projection / Link を除く） |
 * | §12.5.6.2 | テキスト注釈の `/Contents` の段落区切りは CR |
 * | R-7.8.2-8 | 内容ストリームの被演算子に間接参照は置けない（`ContentStreamBuilder` が拒む） |
 *
 * 外観ストリームは `ContentStreamBuilder` で書く。**ここは「自分で描く」場面なので合う**
 * （既存のバイト列を包む `ensure_tagged` では合わなかった。§3.20.1）。
 */

import { ContentStreamBuilder, type CosDict, type CosObject, type CosRef, dictGetRaw, type PdfDocumentEditor } from 'normativepdf';
import { outputDate } from '../config.js';
import { invalidArg } from '../errors.js';
import type { AddAnnotationArgs, AnnotationRect } from '../types/index.js';
import { type Rgb, rgbFromHex } from './color.js';
import { arr, bool, dict, int, name, num, rect as rectOf, stream, textString } from './cos.js';
import { pdfDate } from './pdf-date.js';

/** 段落区切りは CR（§12.5.6.2・shall） */
export function normalizeAnnotationText(text: string): string {
  return text.replace(/\r\n|\n|\r/g, '\r');
}

const colorArray = (color: Rgb): CosObject => arr([num(color.r), num(color.g), num(color.b)]);

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

export interface AddedAnnotation {
  /** そのページの注釈の数（追加後） */
  count: number;
  /** 追加した注釈への参照 */
  ref: CosRef;
  /** 追加先のページ */
  pageRef: CosRef;
  pageDict: CosDict;
}

/**
 * 通常外観（`/AP /N`）の Form XObject を組み立てて登録する。
 * BBox は `[0 0 w h]` で、ビューアが `/Rect` へ写像する。
 */
async function buildAppearance(
  editor: PdfDocumentEditor,
  args: AddAnnotationArgs,
  color: Rgb,
  w: number,
  h: number,
): Promise<CosRef> {
  const content = new ContentStreamBuilder();
  // `/Resources` は Optional（Table 95）。中身が無いのに空辞書を置くと、
  // 「資源を宣言している」と読める辞書が 1 つ増えるだけである
  let resources: CosObject | undefined;

  switch (args.type) {
    case 'highlight': {
      // Multiply ブレンドで下のテキストが透ける、いわゆる蛍光ペン
      resources = dict([
        [
          'ExtGState',
          dict([
            [
              'GS0',
              dict([
                ['Type', name('ExtGState')],
                ['BM', name('Multiply')],
              ]),
            ],
          ]),
        ],
      ]);
      content.op('gs', name('GS0'));
      content.op('rg', num(color.r), num(color.g), num(color.b));
      content.op('re', num(0), num(0), num(w), num(h));
      content.op('f');
      break;
    }

    case 'square': {
      const lw = 1.5;
      content.op('w', num(lw));
      content.op('RG', num(color.r), num(color.g), num(color.b));
      if (args.interiorColor) {
        const ic = rgbFromHex(args.interiorColor);
        content.op('rg', num(ic.r), num(ic.g), num(ic.b));
        content.op('re', num(lw / 2), num(lw / 2), num(w - lw), num(h - lw));
        content.op('B');
      } else {
        content.op('re', num(lw / 2), num(lw / 2), num(w - lw), num(h - lw));
        content.op('S');
      }
      break;
    }

    default: {
      // text: 付箋アイコン（地色の紙面 + 枠 + 罫線 3 本の簡易ノート）
      content.op('rg', num(color.r), num(color.g), num(color.b));
      content.op('re', num(0), num(0), num(w), num(h));
      content.op('f');
      content.op('w', num(Math.max(0.75, h * 0.04)));
      content.op('RG', num(0.25), num(0.25), num(0.25));
      content.op('re', num(0.5), num(0.5), num(w - 1), num(h - 1));
      content.op('S');
      for (const frac of [0.3, 0.5, 0.7]) {
        content.op('m', num(w * 0.2), num(h * frac));
        content.op('l', num(w * 0.8), num(h * frac));
        content.op('S');
      }
      break;
    }
  }

  return editor.allocate(
    stream(
      [
        ['Type', name('XObject')],
        ['Subtype', name('Form')],
        ['BBox', rectOf(0, 0, w, h)],
        ...(resources !== undefined ? ([['Resources', resources]] as const) : []),
      ],
      content.finish(),
    ),
  );
}

/** 注釈を組み立ててページの `/Annots` に足す。 */
export async function addAnnotationDict(
  editor: PdfDocumentEditor,
  args: AddAnnotationArgs,
): Promise<AddedAnnotation> {
  const pages = await editor.pages();
  const index = args.page - 1;
  if (index < 0 || index >= pages.length) {
    throw invalidArg(`page ${args.page} is out of range (document has ${pages.length} page(s))`);
  }
  const page = pages[index] as (typeof pages)[number];
  if (page.ref === null) {
    throw invalidArg(
      `page ${args.page} is a direct object, so an annotation cannot name it in /P (Table 166)`,
    );
  }

  const r: AnnotationRect = args.rect;
  const w = r.x2 - r.x1;
  const h = r.y2 - r.y1;
  const color = rgbFromHex(args.color ?? defaultColor(args.type));

  const entries: [string, CosObject][] = [
    ['Type', name('Annot')],
    ['Rect', rectOf(r.x1, r.y1, r.x2, r.y2)],
    ['P', page.ref],
    ['Contents', textString(normalizeAnnotationText(args.contents ?? ''))],
    // SOURCE_DATE_EPOCH（E-6）に従う。書式は §7.9.4 の日付文字列
    ['M', textString(pdfDate(outputDate()))],
    // `/F`: bit3 Print（印刷に含める）
    ['F', int(4)],
    ['C', colorArray(color)],
  ];
  if (args.author) entries.push(['T', textString(args.author)]);

  switch (args.type) {
    case 'text':
      entries.push(['Subtype', name('Text')]);
      entries.push(['Name', name(args.icon ?? 'Note')]);
      entries.push(['Open', bool(args.open ?? false)]);
      break;
    case 'highlight':
      entries.push(['Subtype', name('Highlight')]);
      // QuadPoints は左上→右上→左下→右下 の順（§12.5.6.10 の慣行）
      entries.push([
        'QuadPoints',
        arr([r.x1, r.y2, r.x2, r.y2, r.x1, r.y1, r.x2, r.y1].map((v) => num(v))),
      ]);
      break;
    case 'square':
      entries.push(['Subtype', name('Square')]);
      if (args.interiorColor) {
        entries.push(['IC', colorArray(rgbFromHex(args.interiorColor))]);
      }
      break;
  }

  // Table 166: 「PDF writer は書き込み時に外観辞書を含めなければならない」（shall）
  entries.push(['AP', dict([['N', await buildAppearance(editor, args, color, w, h)]])]);

  const annotRef = await editor.allocate(dict(entries));

  // `/Annots` は間接配列でも直接配列でもよい。間接なら配列オブジェクトだけを差し替える
  const raw = dictGetRaw(page.dict, 'Annots');
  const existing = raw === undefined ? { kind: 'null' as const } : await editor.resolve(raw);
  const items = existing.kind === 'array' ? [...existing.items, annotRef] : [annotRef];

  if (raw !== undefined && raw.kind === 'ref' && existing.kind === 'array') {
    editor.set(raw.objectNumber, arr(items), raw.generationNumber);
  } else {
    const pageEntries = new Map<string, CosObject>(page.dict.entries);
    pageEntries.set('Annots', arr(items));
    editor.set(page.ref.objectNumber, { kind: 'dict', entries: pageEntries }, page.ref.generationNumber);
  }

  return { count: items.length, ref: annotRef, pageRef: page.ref, pageDict: page.dict };
}
