/**
 * 構造木（タグ付き PDF）— Phase 3（pdf-lib 撤去）の L3' で normativepdf の上に載せ替えた。
 *
 * **何が移り、何が残ったか。**
 * MCID・`/K`・ParentTree の添字という「1 つの数字が 3 か所に出る」問題は
 * normativepdf の `TaggedStream.contentItem()` が引き受けた（発行・`BDC` の書き込み・
 * `/K` への追加・親配列への記録が 1 呼び出し）。**呼び出し側は MCID を見ないので
 * 食い違えない。** ここに残るのは writer の関心だけ ——
 * PDF/UA-1 が要求するタグの選び方（`StructTag`）と `/Scope`。
 *
 * **旧実装から消えたもの:**
 * - `page.pushOperators` による `BDC` / `EMC` の手書き。pdf-lib の `beginMarkedContent` は
 *   プロパティリストを取れず、`<</MCID n>>` を**文字列として**渡す回避が要った。
 *   `ContentStreamBuilder` は辞書を被演算子に取れるので、その回避ごと不要になった
 * - `PDFPage` を鍵にする 3 つの `Map`（MCID カウンタ・親配列・`/StructParents`）。
 *   数え方は core が 1 か所で持つ。ここに残るのは「ページ → そのストリーム」1 本だけ
 * - MCR 辞書の組み立て。ページをまたぐ要素は normativepdf 0.4.0 の Table 357 が書く
 * - `addAnnotation`。注釈を木に結ぶのは**編集パス**の関心で
 *   （`ensure-tagged.ts` / `struct-append.ts`）、生成パスからは呼ばれていなかった（実測）
 *
 * ⚠️ **`markArtifact` は `BMC` を書く**（Table 352）。空のプロパティリストを持つ `BDC` は
 * 「何も持たないリスト」を宣言することになる。旧実装も `BMC` だった。
 */

import {
  StructTreeBuilder as CoreStructTree,
  type StructElement,
  type TaggedStream,
} from 'normativepdf';
import { dict, name } from './cos.js';
import type { WriterDocument, WriterPage } from './writer-doc.js';

/** 構造要素のタグ（PDF/UA で使う標準構造型の部分集合） */
export type StructTag =
  | 'Document'
  | 'H1'
  | 'H2'
  | 'H3'
  | 'H4'
  | 'H5'
  | 'H6'
  | 'P'
  | 'L'
  | 'LI'
  | 'LBody'
  | 'Lbl'
  | 'Table'
  | 'TR'
  | 'TH'
  | 'TD'
  | 'Figure'
  | 'Code'
  | 'BlockQuote'
  | 'Caption'
  | 'Span'
  | 'Annot';

export interface StructElemOptions {
  /** 代替テキスト（Figure では PDF/UA 必須） */
  alt?: string;
  /** 実テキスト（装飾文字などの読み替え） */
  actualText?: string;
  /** この要素の言語（文書既定と異なる場合） */
  lang?: string;
  /**
   * TH の見出し適用範囲（PDF/UA 7.5-1）。
   * Headers/IDs で構造を示さない表では TH に `/Scope` が必須。
   */
  scope?: 'Row' | 'Column' | 'Both';
}

/** 開いている要素 1 つ。`end()` が戻る先を持つ */
interface OpenElement {
  readonly element: StructElement;
  readonly tag: StructTag;
}

/**
 * 構造木の構築器。
 * 使い方: begin(tag) → 描画 → end() を入れ子に呼び、最後に await finalize()。
 */
export class StructTreeBuilder {
  readonly #doc: WriterDocument;
  readonly #core = new CoreStructTree();
  /** ページごとのタグ付きストリーム。**ページの同一性で引く**（`ref` の一致ではない） */
  readonly #streams = new Map<WriterPage, TaggedStream>();
  /**
   * 開いている要素、外側から順に。先頭は PDF/UA 7.1 の Document 要素で、
   * これは常に開いたまま（`end()` で外れない = 対応の取れない `end()` を検出できる）。
   */
  readonly #open: OpenElement[];

  constructor(doc: WriterDocument) {
    this.#doc = doc;
    this.#open = [{ element: this.#core.element('Document'), tag: 'Document' }];
  }

  /** 構造要素を開始する */
  begin(tag: StructTag, options: StructElemOptions = {}): void {
    const parent = this.#innermost.element;
    const extra = new Map(
      options.scope === undefined
        ? []
        : // /A << /O /Table /Scope /Column >>（属性辞書は /O で所属を示す）
          [
            [
              'A',
              dict([
                ['O', name('Table')],
                ['Scope', name(options.scope)],
              ]),
            ] as const,
          ],
    );
    const element = this.#core.element(tag, {
      parent,
      ...(options.alt !== undefined ? { alt: options.alt } : {}),
      ...(options.actualText !== undefined ? { actualText: options.actualText } : {}),
      ...(options.lang !== undefined ? { lang: options.lang } : {}),
      ...(extra.size > 0 ? { extra } : {}),
    });
    this.#open.push({ element, tag });
  }

  /** 構造要素を閉じる */
  end(): void {
    if (this.#open.length <= 1) {
      throw new Error('struct tree: end() called without a matching begin()');
    }
    this.#open.pop();
  }

  /** 現在の要素のタグ（診断用） */
  get currentTag(): StructTag {
    return this.#innermost.tag;
  }

  /**
   * 実コンテンツの描画を `BDC` / `EMC` で囲む。
   * draw() の中でページへの描画を行うこと。
   */
  markContent(page: WriterPage, draw: () => void): void {
    const current = this.#innermost;
    if (this.#open.length === 1) {
      throw new Error(
        'struct tree: content must be inside a structure element (call begin() first)',
      );
    }
    // MCID の発行・BDC の書き込み・/K への追加・親配列への記録は 1 呼び出しで起きる。
    // draw() が書く演算子はその BDC…EMC の中に入る（page.content が同じビルダを指すため）
    this.#streamFor(page).contentItem(current.element, () => draw());
  }

  /**
   * 意味を持たない描画（罫線・背景など）を Artifact として囲む。
   * PDF/UA 7.1-3 はすべてのコンテンツが Artifact か実コンテンツであることを要求する。
   */
  markArtifact(page: WriterPage, draw: () => void): void {
    this.#streamFor(page).artifact(() => draw());
  }

  /**
   * StructTreeRoot・ParentTree を組み立てて catalog に設定する。
   *
   * catalog を読むのに文書を辿るので非同期である（ADR-0007 §4: 非同期を隠さない）。
   */
  async finalize(): Promise<void> {
    if (this.#open.length !== 1) {
      throw new Error(`struct tree: unclosed structure element <${this.#innermost.tag}>`);
    }
    const built = this.#core.finish({
      reserve: () => this.#doc.reserve(),
      write: (target, object) => this.#doc.write(target, object),
    });

    // /StructParents はページ辞書に載る（R-14.7.5.4-12）。ページ辞書を組むのは
    // WriterDocument.save() なので、鍵だけ預ける
    for (const [page, stream] of this.#streams) {
      const key = built.structParents.get(stream);
      if (key !== undefined) this.#doc.setStructParents(page, key);
    }

    await this.#doc.updateCatalog([
      ['StructTreeRoot', built.structTreeRoot],
      ['MarkInfo', built.markInfo],
    ]);
  }

  get #innermost(): OpenElement {
    return this.#open[this.#open.length - 1] as OpenElement;
  }

  /** ページのタグ付きストリーム。無ければ**ページ自身のビルダの上に**作って結び付ける */
  #streamFor(page: WriterPage): TaggedStream {
    const known = this.#streams.get(page);
    if (known !== undefined) return known;
    // page.content はまだ素のビルダを返す。同じ実体の上に TaggedStream を作るので、
    // 構造木が書く BDC と描画が書く演算子が 1 本のストリームに並ぶ
    const stream = this.#core.stream(page.ref, page.content);
    page.attachTaggedStream(stream);
    this.#streams.set(page, stream);
    return stream;
  }
}
