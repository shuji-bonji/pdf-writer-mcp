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

import {
  type PDFArray,
  type PDFDict,
  type PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  type PDFRef,
} from 'pdf-lib';
import { LIMITS } from '../constants.js';
import type { BookmarkInput } from '../types/index.js';

interface BuiltNode {
  ref: PDFRef;
  dict: PDFDict;
  /**
   * 自身を含まない「可視な」子孫の数（ISO 32000-2 §12.3.3 Table 151 の再帰手続き）。
   * 直下の子 + 開いている子の可視子孫のみを数える — 閉じた子の中身は数えない。
   * v0.9.1 までは全子孫数を使っており、開いた項目の下に閉じた枝があると過大だった
   * （SPEC-AUDIT Phase 1 で発見・是正）。
   */
  visibleDescendants: number;
  open: boolean;
  /** 子を持つか（= 「open outline entry」判定に使う） */
  hasChildren: boolean;
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
  /** 「開いた outline 項目」（子を持ち open な項目）が 1 つでもあるか */
  let anyOpenEntry = false;

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
          `bookmark "${item.title}" points to page ${item.page}, but the document has ${pages.length} page(s)`,
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

      const node: BuiltNode = {
        ref,
        dict,
        visibleDescendants: 0,
        open: item.open ?? true,
        hasChildren: false,
      };

      if (item.children && item.children.length > 0) {
        node.hasChildren = true;
        if (node.open) anyOpenEntry = true;
        const children = buildLevel(item.children, ref, depth + 1);
        // §12.3.3 の再帰手続き: 直下の子 + 「開いている」子の可視子孫のみ
        node.visibleDescendants = children.reduce(
          (sum, c) => sum + 1 + (c.open && c.hasChildren ? c.visibleDescendants : 0),
          0,
        );
        dict.set(PDFName.of('First'), children[0].ref);
        dict.set(PDFName.of('Last'), children[children.length - 1].ref);
        // 開: 正の可視子孫数 / 閉: 負（絶対値 = 開いたときに可視になる数）
        dict.set(
          PDFName.of('Count'),
          PDFNumber.of(node.open ? node.visibleDescendants : -node.visibleDescendants),
        );
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
  // ルートの /Count（Table 150）: 全階層の可視項目の総数。負にできない。
  // 「開いた項目が 1 つも無ければ省略しなければならない」（shall — SPEC-AUDIT Phase 1 で是正）
  if (anyOpenEntry) {
    const visible = top.reduce(
      (sum, n) => sum + 1 + (n.open && n.hasChildren ? n.visibleDescendants : 0),
      0,
    );
    rootDict.set(PDFName.of('Count'), PDFNumber.of(visible));
  }

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
