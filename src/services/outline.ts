/**
 * Outline (bookmarks)
 * pdf-lib はアウトライン API を持たないため、/Outlines 辞書を低レベルに構築する。
 *
 * 構造（ISO 32000-1 §12.3.3）:
 *   Catalog /Outlines -> Outline dictionary { /Type /Outlines, /First, /Last, /Count }
 *   各 item: { /Title, /Parent, /Dest, /Prev, /Next, /First, /Last, /Count }
 *
 * /Count の符号: 開いた項目は子孫数の正、閉じた項目は負（§12.3.3 Table 153）。
 * ルートの /Count は「可視な子孫の総数」。
 */

import { PDFDocument, PDFDict, PDFName, PDFNumber, PDFArray, PDFHexString, PDFRef } from 'pdf-lib';
import { LIMITS } from '../constants.js';
import type { BookmarkInput } from '../types/index.js';

interface BuiltNode {
  ref: PDFRef;
  dict: PDFDict;
  /** 自身を含まない子孫の数 */
  descendants: number;
  open: boolean;
}

/**
 * しおりツリーを構築して doc に設定する（既存の /Outlines は置換）。
 * @returns 追加したしおりの総数
 */
export function setBookmarks(doc: PDFDocument, bookmarks: BookmarkInput[]): number {
  const context = doc.context;
  const pages = doc.getPages();

  const rootRef = context.nextRef();
  const rootDict = context.obj({ Type: 'Outlines' }) as PDFDict;

  let total = 0;

  /** items を兄弟として構築し、親 parentRef に連結する */
  const buildLevel = (items: BookmarkInput[], parentRef: PDFRef, depth: number): BuiltNode[] => {
    if (depth > LIMITS.BOOKMARK_MAX_DEPTH) {
      throw new Error(`bookmarks are nested too deeply (max ${LIMITS.BOOKMARK_MAX_DEPTH} levels)`);
    }

    const nodes: BuiltNode[] = [];
    for (const item of items) {
      const pageIndex = item.page - 1;
      if (pageIndex < 0 || pageIndex >= pages.length) {
        throw new Error(
          `bookmark "${item.title}" points to page ${item.page}, but the document has ${pages.length} page(s)`
        );
      }
      total++;

      const ref = context.nextRef();
      const dict = context.obj({}) as PDFDict;

      // /Dest [page /XYZ left top zoom] — null は「現在値を維持」
      const dest = context.obj([
        pages[pageIndex].ref,
        PDFName.of('XYZ'),
        context.obj(null),
        context.obj(null),
        context.obj(null),
      ]) as PDFArray;

      // 日本語を含むため UTF-16BE（PDFHexString.fromText）で書く
      dict.set(PDFName.of('Title'), PDFHexString.fromText(item.title));
      dict.set(PDFName.of('Parent'), parentRef);
      dict.set(PDFName.of('Dest'), dest);

      const node: BuiltNode = { ref, dict, descendants: 0, open: item.open ?? true };

      if (item.children && item.children.length > 0) {
        const children = buildLevel(item.children, ref, depth + 1);
        node.descendants = children.reduce((sum, c) => sum + 1 + c.descendants, 0);
        dict.set(PDFName.of('First'), children[0].ref);
        dict.set(PDFName.of('Last'), children[children.length - 1].ref);
        // 開: 正の子孫数 / 閉: 負の子孫数
        dict.set(PDFName.of('Count'), PDFNumber.of(node.open ? node.descendants : -node.descendants));
      }

      nodes.push(node);
    }

    // 兄弟の双方向リンク
    for (let i = 0; i < nodes.length; i++) {
      if (i > 0) nodes[i].dict.set(PDFName.of('Prev'), nodes[i - 1].ref);
      if (i < nodes.length - 1) nodes[i].dict.set(PDFName.of('Next'), nodes[i + 1].ref);
      context.assign(nodes[i].ref, nodes[i].dict);
    }
    return nodes;
  };

  const top = buildLevel(bookmarks, rootRef, 1);
  if (top.length > 0) {
    rootDict.set(PDFName.of('First'), top[0].ref);
    rootDict.set(PDFName.of('Last'), top[top.length - 1].ref);
  }
  // ルートの /Count は可視な子孫の数（閉じた項目の中身は数えない）
  const visible = top.reduce((sum, n) => sum + 1 + (n.open ? n.descendants : 0), 0);
  rootDict.set(PDFName.of('Count'), PDFNumber.of(visible));

  context.assign(rootRef, rootDict);
  doc.catalog.set(PDFName.of('Outlines'), rootRef);

  return total;
}

/** しおりの総数を数える（検査用・上限チェックに使う） */
export function countBookmarks(items: BookmarkInput[]): number {
  let n = 0;
  for (const item of items) {
    n++;
    if (item.children) n += countBookmarks(item.children);
  }
  return n;
}
