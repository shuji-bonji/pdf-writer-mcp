/**
 * しおり（文書アウトライン・§12.3.3） — Phase 3（pdf-lib 撤去）の L4′.2。
 *
 * 旧実装（`outline-pdflib.ts`）を COS の上に置き直したもの。**構造の決まりは同じ**で、
 * 変えたのは器だけである。条文は `pdf-spec-mcp` で引き直して確かめた:
 *
 * | 要件 | 何を言っているか |
 * |---|---|
 * | R-12.3.3-11 / -12 | アウトライン辞書の `/First` `/Last` は**間接参照**。項目が 1 つでもあれば必須 |
 * | R-12.3.3-13 | ルートの `/Count` は「**開いた項目が 1 つも無ければ省略しなければならない**」 |
 * | R-12.3.3-15 / -16 | 項目の `/Parent` は必須・間接参照。最上位項目の親は**アウトライン辞書そのもの** |
 * | R-12.3.3-17 / -18 | `/Prev` `/Next` は各段の最初／最後を除いて必須・間接参照 |
 * | R-12.3.3-19 / -20 | 子を持つ項目の `/First` `/Last` は必須・間接参照 |
 * | R-12.3.3-21 | `/Count` の可視子孫数は**再帰手続き**で決まる（閉じた枝の中身は数えない） |
 *
 * **`/Count` の符号**（Table 151）: 開いた項目は可視子孫数の正、閉じた項目は負
 * （絶対値は「開いたときに可視になる数」）。
 *
 * 🔴 **意図して変えたものが 1 つある: 題名の符号化。**
 * 旧実装は `PDFHexString.fromText` で**常に** UTF-16BE の 16 進文字列を書いていた。
 * ここでは `cos.ts` の `textString` を使うので、**ASCII の題名はリテラル文字列**になる
 * （§7.9.2.2 はどちらも許す）。生成パス（L3′）が同じ関数で「呼び出し側に選ばせない」と
 * 決めており、writer の中で文字列の書き方を 1 つにするための差である。
 * 日本語の題名は旧実装と同じく UTF-16BE（BOM 付き）になる。
 */

import {
  type CosDict,
  type CosObject,
  type CosRef,
  dictGet,
  type PdfDocumentEditor,
} from 'normativepdf';
import { LIMITS } from '../constants.js';
import type { BookmarkInput } from '../types/index.js';
import { arr, dict, int, name, textString } from './cos.js';
import { structureElementForPage } from './struct-dest.js';

export interface SetBookmarksOptions {
  /**
   * 行き先を structure destination で書くか（ISO 14289-2 §8.8。PDF/UA-2 の文書で true）。
   * 書くときは `/A << /S /GoTo /D [ページ …] /SD [構造要素 …] >>`（ISO 32000-2 §12.6.4.2 Table 202）。
   * `SD` は PDF 2.0 の項目で、`D` より優先される。`SD` を知らないビューアは `D` のページへ飛ぶ。
   * Table 151 は `Dest` と `A` を同時に置くことを禁じるので、`Dest` は書かない
   */
  readonly structureDestinations?: boolean;
  /** 構造要素を選べず、ページの行き先で書いたしおり（題名とページ） */
  readonly unresolved?: { title: string; page: number }[];
}

const COS_NULL: CosObject = { kind: 'null' };

interface BuiltNode {
  ref: CosRef;
  entries: Map<string, CosObject>;
  /**
   * 自身を含まない「可視な」子孫の数（R-12.3.3-21 の再帰手続き）。
   * 直下の子 + 開いている子の可視子孫のみを数える —— 閉じた子の中身は数えない。
   */
  visibleDescendants: number;
  open: boolean;
  /** 子を持つか（=「開いた outline 項目」の判定に使う） */
  hasChildren: boolean;
}

/**
 * しおりの木を組んで文書に設定する（既存の `/Outlines` は置き換える）。
 * @returns 追加したしおりの総数
 */
export async function setBookmarks(
  editor: PdfDocumentEditor,
  bookmarks: BookmarkInput[],
  options: SetBookmarksOptions = {},
): Promise<number> {
  const pages = await editor.pages();
  const structTreeRoot = options.structureDestinations
    ? await readStructTreeRoot(editor)
    : undefined;
  const elementForPage = new Map<number, CosRef | undefined>();

  // 参照を先に取ってから中身を書く。`/Parent` `/Prev` `/Next` が互いを指すので、
  // 番号が決まっていないと辿れる木にならない
  const rootRef = await editor.allocate(COS_NULL);
  const rootEntries = new Map<string, CosObject>([['Type', name('Outlines')]]);

  let total = 0;
  /** 「開いた outline 項目」（子を持ち open な項目）が 1 つでもあるか */
  let anyOpenEntry = false;

  const buildLevel = async (
    items: BookmarkInput[],
    parentRef: CosRef,
    depth: number,
  ): Promise<BuiltNode[]> => {
    if (depth > LIMITS.BOOKMARK_MAX_DEPTH) {
      throw new Error(`bookmarks are nested too deeply (max ${LIMITS.BOOKMARK_MAX_DEPTH} levels)`);
    }

    const nodes: BuiltNode[] = [];
    for (const item of items) {
      const pageIndex = item.page - 1;
      const page = pages[pageIndex];
      if (page === undefined || page.ref === null) {
        throw new Error(
          `bookmark "${item.title}" points to page ${item.page}, but the document has ${pages.length} page(s)`,
        );
      }
      total += 1;

      const ref = await editor.allocate(COS_NULL);
      // [page /XYZ left top zoom] —— null は「現在値を維持」（§12.3.2.2 Table 149）
      const pageDest = arr([page.ref, name('XYZ'), COS_NULL, COS_NULL, COS_NULL]);
      const entries = new Map<string, CosObject>([
        ['Title', textString(item.title)],
        ['Parent', parentRef],
      ]);
      let element: CosRef | undefined;
      if (structTreeRoot !== undefined) {
        if (!elementForPage.has(pageIndex)) {
          elementForPage.set(
            pageIndex,
            await structureElementForPage(editor, structTreeRoot, page.ref, page.dict),
          );
        }
        element = elementForPage.get(pageIndex);
      }
      if (element !== undefined) {
        // structure destination は Table 149 と同じ書き方で、先頭が構造要素（§12.3.2.3）
        entries.set(
          'A',
          dict([
            ['S', name('GoTo')],
            ['D', pageDest],
            ['SD', arr([element, name('XYZ'), COS_NULL, COS_NULL, COS_NULL])],
          ]),
        );
      } else {
        entries.set('Dest', pageDest);
        if (options.structureDestinations)
          options.unresolved?.push({ title: item.title, page: item.page });
      }

      const node: BuiltNode = {
        ref,
        entries,
        visibleDescendants: 0,
        open: item.open ?? true,
        hasChildren: false,
      };

      if (item.children && item.children.length > 0) {
        node.hasChildren = true;
        if (node.open) anyOpenEntry = true;
        const children = await buildLevel(item.children, ref, depth + 1);
        // R-12.3.3-21: 直下の子 + 「開いている」子の可視子孫のみ
        node.visibleDescendants = children.reduce(
          (sum, c) => sum + 1 + (c.open && c.hasChildren ? c.visibleDescendants : 0),
          0,
        );
        entries.set('First', (children[0] as BuiltNode).ref);
        entries.set('Last', (children[children.length - 1] as BuiltNode).ref);
        entries.set('Count', int(node.open ? node.visibleDescendants : -node.visibleDescendants));
      }

      nodes.push(node);
    }

    // 兄弟の双方向リンク（R-12.3.3-17 / -18）
    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i] as BuiltNode;
      const prev = nodes[i - 1];
      const next = nodes[i + 1];
      if (prev) node.entries.set('Prev', prev.ref);
      if (next) node.entries.set('Next', next.ref);
      editor.set(node.ref.objectNumber, dict(node.entries), node.ref.generationNumber);
    }
    return nodes;
  };

  const top = await buildLevel(bookmarks, rootRef, 1);
  if (top.length > 0) {
    rootEntries.set('First', (top[0] as BuiltNode).ref);
    rootEntries.set('Last', (top[top.length - 1] as BuiltNode).ref);
  }
  // ルートの `/Count`（Table 150）は全階層の可視項目の総数で、負にできない。
  // **開いた項目が 1 つも無ければ省略する**（R-12.3.3-13 = shall）
  if (anyOpenEntry) {
    const visible = top.reduce(
      (sum, n) => sum + 1 + (n.open && n.hasChildren ? n.visibleDescendants : 0),
      0,
    );
    rootEntries.set('Count', int(visible));
  }
  editor.set(rootRef.objectNumber, dict(rootEntries), rootRef.generationNumber);

  // catalog に繋ぐ。catalog の住所はトレーラの `/Root`（§7.5.5 Table 15）
  const root = dictGet(editor.trailer(), 'Root');
  if (root?.kind !== 'ref') {
    throw new Error('the trailer has no /Root reference, so /Outlines cannot be attached');
  }
  const catalog = await editor.get(root.objectNumber, root.generationNumber);
  if (catalog.kind !== 'dict') {
    throw new Error('the document catalog is not a dictionary (§7.7.2)');
  }
  const updated = new Map(catalog.entries);
  updated.set('Outlines', rootRef);
  editor.set(root.objectNumber, dict(updated), root.generationNumber);

  return total;
}

/** しおりの総数を数える（上限の検査に使う。文書には触らない） */
export function countBookmarks(items: BookmarkInput[]): number {
  let n = 0;
  for (const item of items) {
    n += 1;
    if (item.children) n += countBookmarks(item.children);
  }
  return n;
}

/** catalog の `/StructTreeRoot`。無ければ undefined */
async function readStructTreeRoot(editor: PdfDocumentEditor): Promise<CosDict | undefined> {
  const root = dictGet(editor.trailer(), 'Root');
  if (root === undefined) return undefined;
  const catalog = await editor.resolve(root);
  if (catalog.kind !== 'dict') return undefined;
  const tree = await editor.resolve(dictGet(catalog, 'StructTreeRoot') ?? COS_NULL);
  return tree.kind === 'dict' ? tree : undefined;
}
