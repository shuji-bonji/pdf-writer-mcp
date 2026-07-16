/**
 * Structure tree (tagged PDF)
 * pdf-lib は論理構造の API を持たないため、StructTreeRoot / StructElem / ParentTree を
 * 低レベルに構築する。
 *
 * 仕組み（ISO 32000-1 §14.7 / §14.8）:
 *   1. ページのコンテンツストリームを BDC ... EMC で囲み、MCID を振る
 *      → `/P <</MCID 0>> BDC ... EMC`
 *   2. 各 StructElem が /K で MCID を参照し、/Pg で対象ページを指す
 *   3. ParentTree（番号ツリー）が「ページ → MCID 順の StructElem 参照配列」を持つ
 *      → ビューア/AT が MCID から構造要素を逆引きできる
 *   4. 各ページに /StructParents（ParentTree のキー）を持たせる
 *
 * PDF/UA-1 7.1-3「コンテンツは Artifact か実コンテンツとしてタグ付けする」を満たすため、
 * 描画は必ずこの層を通す（罫線・背景など意味を持たない描画は Artifact にする）。
 */

import {
  beginMarkedContent,
  endMarkedContent,
  PDFArray,
  type PDFDict,
  type PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFOperator,
  PDFOperatorNames,
  type PDFPage,
  type PDFRef,
  PDFString,
} from 'pdf-lib';

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
   * Headers/IDs で構造を示さない表では TH に /Scope が必須。
   */
  scope?: 'Row' | 'Column' | 'Both';
}

interface ElemNode {
  ref: PDFRef;
  dict: PDFDict;
  tag: StructTag;
  /** /K の中身: MCID(number) / 子要素(ref) / OBJR(ref) */
  kids: Array<{ kind: 'mcid'; mcid: number; page: PDFPage } | { kind: 'elem'; ref: PDFRef }>;
  parent: ElemNode | null;
}

/**
 * 構造木の構築器。
 * 使い方: begin(tag) → 描画 → end() を入れ子に呼び、最後に finalize()。
 */
export class StructTreeBuilder {
  private readonly doc: PDFDocument;
  private readonly rootRef: PDFRef;
  private readonly documentNode: ElemNode;
  private current: ElemNode;
  /** ページごとの MCID カウンタ */
  private mcidCounters = new Map<PDFPage, number>();
  /** ページごとの「MCID 順に並んだ StructElem 参照」 */
  private pageParents = new Map<PDFPage, PDFRef[]>();
  /** ページごとの /StructParents 番号 */
  private structParents = new Map<PDFPage, number>();
  private nextStructParent = 0;
  /** ParentTree に積む OBJR（注釈）用のエントリ */
  private objrEntries: Array<{ key: number; elemRef: PDFRef }> = [];

  constructor(doc: PDFDocument) {
    this.doc = doc;
    this.rootRef = doc.context.nextRef();

    const docRef = doc.context.nextRef();
    const docDict = doc.context.obj({}) as PDFDict;
    docDict.set(PDFName.of('Type'), PDFName.of('StructElem'));
    docDict.set(PDFName.of('S'), PDFName.of('Document'));
    docDict.set(PDFName.of('P'), this.rootRef);
    this.documentNode = { ref: docRef, dict: docDict, tag: 'Document', kids: [], parent: null };
    this.current = this.documentNode;
  }

  /** 構造要素を開始する */
  begin(tag: StructTag, options: StructElemOptions = {}): void {
    const ref = this.doc.context.nextRef();
    const dict = this.doc.context.obj({}) as PDFDict;
    dict.set(PDFName.of('Type'), PDFName.of('StructElem'));
    dict.set(PDFName.of('S'), PDFName.of(tag));
    dict.set(PDFName.of('P'), this.current.ref);
    if (options.alt) dict.set(PDFName.of('Alt'), PDFHexString.fromText(options.alt));
    if (options.actualText) {
      dict.set(PDFName.of('ActualText'), PDFHexString.fromText(options.actualText));
    }
    if (options.lang) dict.set(PDFName.of('Lang'), PDFString.of(options.lang));
    if (options.scope) {
      // /A << /O /Table /Scope /Column >>（属性辞書は /O で所属を示す）
      dict.set(
        PDFName.of('A'),
        this.doc.context.obj({ O: PDFName.of('Table'), Scope: PDFName.of(options.scope) }),
      );
    }

    const node: ElemNode = { ref, dict, tag, kids: [], parent: this.current };
    this.current.kids.push({ kind: 'elem', ref });
    this.current = node;
    this.nodes.push(node);
  }

  /** 構造要素を閉じる */
  end(): void {
    if (this.current.parent === null) {
      throw new Error('struct tree: end() called without a matching begin()');
    }
    this.current = this.current.parent;
  }

  private nodes: ElemNode[] = [];

  /** 現在の要素のタグ（診断用） */
  get currentTag(): StructTag {
    return this.current.tag;
  }

  /**
   * 実コンテンツの描画を BDC/EMC で囲む。
   * draw() の中で page への描画を行うこと。
   */
  markContent(page: PDFPage, draw: () => void): void {
    if (this.current === this.documentNode) {
      throw new Error(
        'struct tree: content must be inside a structure element (call begin() first)',
      );
    }
    const mcid = this.nextMcid(page);
    // `/Tag <</MCID n>> BDC` — pdf-lib の beginMarkedContent は BMC（プロパティ無し）しか
    // 出せず、PDFOperatorArg は辞書を受け付けないため、インライン辞書を文字列で渡す。
    // MCID は自前採番の非負整数なので、文字列化しても安全。
    page.pushOperators(
      PDFOperator.of(PDFOperatorNames.BeginMarkedContentSequence, [
        PDFName.of(this.current.tag),
        `<</MCID ${mcid}>>`,
      ]),
    );
    draw();
    page.pushOperators(endMarkedContent());
    this.current.kids.push({ kind: 'mcid', mcid, page });
  }

  /**
   * 意味を持たない描画（罫線・背景など）を Artifact として囲む。
   * PDF/UA 7.1-3 はすべてのコンテンツが Artifact か実コンテンツであることを要求する。
   */
  markArtifact(page: PDFPage, draw: () => void): void {
    page.pushOperators(beginMarkedContent(PDFName.of('Artifact')));
    draw();
    page.pushOperators(endMarkedContent());
  }

  /** 注釈を構造木に結び付ける（PDF/UA 7.18.1-1: Annot タグで包む） */
  addAnnotation(page: PDFPage, annotRef: PDFRef, alt?: string): void {
    this.begin('Annot', alt ? { alt } : {});
    const objr = this.doc.context.obj({}) as PDFDict;
    objr.set(PDFName.of('Type'), PDFName.of('OBJR'));
    objr.set(PDFName.of('Obj'), annotRef);
    objr.set(PDFName.of('Pg'), page.ref);
    const objrRef = this.doc.context.register(objr);
    this.current.kids.push({ kind: 'elem', ref: objrRef });

    // 注釈は /StructParent（単数）で ParentTree のキーを持つ
    const key = this.nextStructParent++;
    const annot = this.doc.context.lookup(annotRef);
    if (annot && 'set' in annot) {
      (annot as PDFDict).set(PDFName.of('StructParent'), PDFNumber.of(key));
    }
    this.objrEntries.push({ key, elemRef: this.current.ref });
    this.end();
  }

  private nextMcid(page: PDFPage): number {
    const n = this.mcidCounters.get(page) ?? 0;
    this.mcidCounters.set(page, n + 1);
    if (!this.pageParents.has(page)) {
      this.pageParents.set(page, []);
      this.structParents.set(page, this.nextStructParent++);
    }
    // MCID 順に現在の要素を記録する（ParentTree 用）
    (this.pageParents.get(page) as PDFRef[])[n] = this.current.ref;
    return n;
  }

  /**
   * StructTreeRoot・ParentTree を組み立てて catalog に設定する。
   * begin/end の対応が取れていなければエラー。
   */
  finalize(): void {
    if (this.current !== this.documentNode) {
      throw new Error(`struct tree: unclosed structure element <${this.current.tag}>`);
    }
    const { context, catalog } = this.doc;

    // 各要素の /K と /Pg を確定する
    for (const node of [this.documentNode, ...this.nodes]) {
      this.writeKids(node);
    }

    // ページに /StructParents を振る
    for (const [page, key] of this.structParents) {
      page.node.set(PDFName.of('StructParents'), PDFNumber.of(key));
    }

    // ParentTree（番号ツリー）
    const nums = context.obj([]) as PDFArray;
    const entries: Array<{ key: number; value: PDFArray | PDFRef }> = [];
    for (const [page, refs] of this.pageParents) {
      const key = this.structParents.get(page) as number;
      const arr = context.obj([]) as PDFArray;
      for (const ref of refs) arr.push(ref);
      entries.push({ key, value: arr });
    }
    for (const { key, elemRef } of this.objrEntries) {
      entries.push({ key, value: elemRef });
    }
    // 番号ツリーはキー昇順であること（§7.9.7）
    entries.sort((a, b) => a.key - b.key);
    for (const { key, value } of entries) {
      nums.push(PDFNumber.of(key));
      nums.push(value instanceof PDFArray ? context.register(value) : value);
    }
    const parentTree = context.obj({}) as PDFDict;
    parentTree.set(PDFName.of('Nums'), nums);
    const parentTreeRef = context.register(parentTree);

    const rootDict = context.obj({}) as PDFDict;
    rootDict.set(PDFName.of('Type'), PDFName.of('StructTreeRoot'));
    rootDict.set(PDFName.of('K'), this.documentNode.ref);
    rootDict.set(PDFName.of('ParentTree'), parentTreeRef);
    rootDict.set(PDFName.of('ParentTreeNextKey'), PDFNumber.of(this.nextStructParent));
    context.assign(this.rootRef, rootDict);

    context.assign(this.documentNode.ref, this.documentNode.dict);
    for (const node of this.nodes) context.assign(node.ref, node.dict);

    catalog.set(PDFName.of('StructTreeRoot'), this.rootRef);
    catalog.set(PDFName.of('MarkInfo'), context.obj({ Marked: true }));
  }

  /** ノードの /K と /Pg を書き込む */
  private writeKids(node: ElemNode): void {
    const { context } = this.doc;
    if (node.kids.length === 0) return;

    // すべての MCID が同一ページなら /Pg をまとめて指定できる
    const pages = new Set(
      node.kids.filter((k) => k.kind === 'mcid').map((k) => (k as { page: PDFPage }).page),
    );
    if (pages.size === 1) {
      const [page] = pages;
      node.dict.set(PDFName.of('Pg'), page.ref);
    }

    const kids = context.obj([]) as PDFArray;
    for (const kid of node.kids) {
      if (kid.kind === 'elem') {
        kids.push(kid.ref);
      } else if (pages.size === 1) {
        kids.push(PDFNumber.of(kid.mcid));
      } else {
        // ページをまたぐ場合は MCR 辞書で明示する
        const mcr = context.obj({}) as PDFDict;
        mcr.set(PDFName.of('Type'), PDFName.of('MCR'));
        mcr.set(PDFName.of('Pg'), kid.page.ref);
        mcr.set(PDFName.of('MCID'), PDFNumber.of(kid.mcid));
        kids.push(context.register(mcr));
      }
    }
    node.dict.set(PDFName.of('K'), kids.size() === 1 ? kids.get(0) : kids);
  }
}
