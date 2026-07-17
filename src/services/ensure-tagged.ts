/**
 * ensure_tagged — 既存 PDF を PDF/UA-1 の「器」に載せる（Tier C・B-7c）
 *
 * できること / できないこと（正直に）:
 *   - **できる**: 文書レベルの要件を機械的に満たす — StructTreeRoot / MarkInfo /
 *     /Lang / DisplayDocTitle / XMP（pdfuaid:part・dc:title）、およびページ内容を
 *     タグの下に置くこと（7.1-3）。既にタグ付きなら**構造木には触らず**欠落要件だけ補う。
 *   - **できない**: 意味のある構造の推定。見出し・表・リスト・読み順・図の代替テキストは
 *     内容の理解を要し、機械には決められない。タグ無し文書に対しては
 *     「1 ページ = 1 段落（P）」という**足場**を作るだけで、これは
 *     「読み上げられる」状態にはするが「適切に構造化された」状態ではない。
 *
 * 設計判断: 既存内容を Artifact で包む選択肢は採らない。veraPDF は通るが
 * 「本文が丸ごと支援技術から隠れる」状態になり、準拠の体裁だけ整えて
 * アクセシビリティを損なう嘘になるため。P で包めば少なくとも読み上げられる。
 *
 * 既存内容の包み方（§14.8.2）: pdf-lib は追記しかできないので、
 *   [BDC ストリーム] + [既存内容…] + [EMC ストリーム]
 * となるよう /Contents 配列の前後に 1 本ずつ足す（watermark.ts の順序入替と同じ発想）。
 */

import {
  endMarkedContent,
  PDFArray,
  type PDFDict,
  type PDFDocument,
  PDFName,
  PDFNumber,
  type PDFPage,
  PDFRef,
  PDFString,
} from 'pdf-lib';
import { isTagged } from './struct-append.js';
import { setXmpMetadata } from './xmp.js';

export interface EnsureTaggedOutcome {
  /** 入力が既にタグ付きだったか */
  wasTagged: boolean;
  /** 構造木を新設したか（タグ無し入力のみ） */
  createdStructure: boolean;
  /** P 要素で包んだページ数（新設時） */
  wrappedPages: number;
  /** 補った文書レベル要件 */
  addedRequirements: string[];
  /** 変更した既存の間接オブジェクト（増分更新の dirty 追跡） */
  dirtiedRefs: PDFRef[];
  warnings: string[];
}

export interface EnsureTaggedOptions {
  /** 文書タイトル（PDF/UA 7.1 で必須）。省略時は既存 Info の Title を使う */
  title?: string;
  /** 文書の自然言語（BCP 47。7.2 で必須） */
  lang?: string;
}

/** ページ内容を `/P <</MCID n>> BDC … EMC` で包む（前後にストリームを 1 本ずつ足す） */
function wrapPageContentInP(doc: PDFDocument, page: PDFPage, mcid: number): void {
  const { context } = doc;
  // pdf-lib は /Contents を配列に正規化する（単一ストリームでも配列になる）
  page.pushOperators(endMarkedContent());
  const contents = page.node.lookup(PDFName.of('Contents'));
  if (!(contents instanceof PDFArray)) return;

  // 末尾に積まれた EMC はそのまま。先頭に BDC を挿し込む
  const bdc = context.stream(`/P <</MCID ${mcid}>> BDC`);
  contents.insert(0, context.register(bdc));
}

/**
 * 文書レベルの PDF/UA 要件を補う（構造木の有無に関わらず実施）。
 * 変更した既存オブジェクトを dirtied に積む。
 */
function applyDocumentRequirements(
  doc: PDFDocument,
  opts: EnsureTaggedOptions,
  outcome: EnsureTaggedOutcome,
  markDirty: (ref: unknown) => void,
): void {
  const { catalog, context } = doc;

  // /MarkInfo <</Marked true>>（7.1）
  const markInfo = catalog.lookup(PDFName.of('MarkInfo'));
  if (!(markInfo instanceof Object) || !isMarked(doc)) {
    catalog.set(PDFName.of('MarkInfo'), context.obj({ Marked: true }));
    outcome.addedRequirements.push('MarkInfo/Marked');
    markDirty(context.trailerInfo.Root);
  }

  // /Lang（7.2）
  const lang = opts.lang;
  if (lang) {
    catalog.set(PDFName.of('Lang'), PDFString.of(lang));
    outcome.addedRequirements.push('Lang');
    markDirty(context.trailerInfo.Root);
  } else if (catalog.get(PDFName.of('Lang')) === undefined) {
    outcome.warnings.push(
      'No "lang" given and the document declares no /Lang; PDF/UA-1 7.2 requires one. ' +
        'Pass "lang" (BCP 47) — a missing or wrong language makes screen readers mispronounce text.',
    );
  }

  // /ViewerPreferences <</DisplayDocTitle true>>（7.1）
  const vp = catalog.lookup(PDFName.of('ViewerPreferences'));
  if (vp && typeof (vp as PDFDict).set === 'function') {
    (vp as PDFDict).set(PDFName.of('DisplayDocTitle'), context.obj(true));
    const vpRaw = catalog.get(PDFName.of('ViewerPreferences'));
    markDirty(vpRaw instanceof PDFRef ? vpRaw : context.trailerInfo.Root);
  } else {
    catalog.set(PDFName.of('ViewerPreferences'), context.obj({ DisplayDocTitle: true }));
    markDirty(context.trailerInfo.Root);
  }
  outcome.addedRequirements.push('ViewerPreferences/DisplayDocTitle');

  // タイトル（7.1）: 引数 → 既存 Info の順
  const title = opts.title ?? doc.getTitle();
  if (title) {
    doc.setTitle(title);
    const info = context.trailerInfo.Info;
    markDirty(info);
  }

  // XMP（pdfuaid:part 1 + dc:title）
  const metaRaw = catalog.get(PDFName.of('Metadata'));
  setXmpMetadata(doc, {
    title,
    author: doc.getAuthor(),
    subject: doc.getSubject(),
    keywords: doc.getKeywords(),
    pdfuaPart: 1,
    lang: lang ?? undefined,
  });
  outcome.addedRequirements.push('XMP(pdfuaid:part, dc:title)');
  // setXmpMetadata は catalog に新しい参照を設定する → catalog が dirty
  markDirty(context.trailerInfo.Root);
  if (metaRaw instanceof PDFRef) markDirty(metaRaw);
}

/** MarkInfo /Marked が true か */
function isMarked(doc: PDFDocument): boolean {
  const markInfo = doc.catalog.lookup(PDFName.of('MarkInfo'));
  if (!markInfo || typeof (markInfo as PDFDict).lookup !== 'function') return false;
  return (markInfo as PDFDict).lookup(PDFName.of('Marked'))?.toString() === 'true';
}

/**
 * 構造木をゼロから作り、各ページの内容を P 要素で包む（タグ無し文書のみ）。
 * Document > P × ページ数 の平坦な木。
 */
function createMinimalStructure(doc: PDFDocument, outcome: EnsureTaggedOutcome): void {
  const { context, catalog } = doc;
  const rootRef = context.nextRef();
  const docElemRef = context.nextRef();

  const pElems: PDFRef[] = [];
  const numsEntries: Array<{ key: number; value: PDFRef }> = [];

  doc.getPages().forEach((page, index) => {
    const mcid = 0; // 1 ページ 1 要素なので MCID は常に 0
    wrapPageContentInP(doc, page, mcid);

    const pRef = context.nextRef();
    const pDict = context.obj({}) as PDFDict;
    pDict.set(PDFName.of('Type'), PDFName.of('StructElem'));
    pDict.set(PDFName.of('S'), PDFName.of('P'));
    pDict.set(PDFName.of('P'), docElemRef);
    pDict.set(PDFName.of('Pg'), page.ref);
    pDict.set(PDFName.of('K'), PDFNumber.of(mcid));
    context.assign(pRef, pDict);
    pElems.push(pRef);

    // ページ → ParentTree キー
    page.node.set(PDFName.of('StructParents'), PDFNumber.of(index));
    const arr = context.obj([]) as PDFArray;
    arr.push(pRef);
    numsEntries.push({ key: index, value: context.register(arr) });
    outcome.wrappedPages++;
  });

  // Document 要素
  const docElem = context.obj({}) as PDFDict;
  docElem.set(PDFName.of('Type'), PDFName.of('StructElem'));
  docElem.set(PDFName.of('S'), PDFName.of('Document'));
  docElem.set(PDFName.of('P'), rootRef);
  const kids = context.obj([]) as PDFArray;
  for (const ref of pElems) kids.push(ref);
  docElem.set(PDFName.of('K'), kids);
  context.assign(docElemRef, docElem);

  // ParentTree（キー昇順・§7.9.7）
  const nums = context.obj([]) as PDFArray;
  for (const { key, value } of numsEntries) {
    nums.push(PDFNumber.of(key));
    nums.push(value);
  }
  const parentTree = context.obj({}) as PDFDict;
  parentTree.set(PDFName.of('Nums'), nums);

  const rootDict = context.obj({}) as PDFDict;
  rootDict.set(PDFName.of('Type'), PDFName.of('StructTreeRoot'));
  rootDict.set(PDFName.of('K'), docElemRef);
  rootDict.set(PDFName.of('ParentTree'), context.register(parentTree));
  rootDict.set(PDFName.of('ParentTreeNextKey'), PDFNumber.of(numsEntries.length));
  context.assign(rootRef, rootDict);

  catalog.set(PDFName.of('StructTreeRoot'), rootRef);
  outcome.createdStructure = true;
  outcome.addedRequirements.push('StructTreeRoot(Document > P)');
}

/**
 * PDF/UA-1 の器に載せる。既にタグ付きなら構造木は温存し、欠落した文書要件のみ補う。
 */
export function ensureTaggedStructure(
  doc: PDFDocument,
  opts: EnsureTaggedOptions,
): EnsureTaggedOutcome {
  const outcome: EnsureTaggedOutcome = {
    wasTagged: isTagged(doc),
    createdStructure: false,
    wrappedPages: 0,
    addedRequirements: [],
    dirtiedRefs: [],
    warnings: [],
  };

  const dirtied = new Map<string, PDFRef>();
  const markDirty = (ref: unknown): void => {
    if (ref instanceof PDFRef) dirtied.set(ref.toString(), ref);
  };

  const hasStructTree = doc.catalog.lookup(PDFName.of('StructTreeRoot')) !== undefined;
  if (!hasStructTree) {
    createMinimalStructure(doc, outcome);
    markDirty(doc.context.trailerInfo.Root);
    for (const page of doc.getPages()) markDirty(page.ref);
    outcome.warnings.push(
      'This document had no structure tree. A minimal scaffold was created: each page is ' +
        'wrapped in a single P (paragraph) element. The text is now reachable by assistive ' +
        'technology, but headings, lists, tables, reading order and figure alt text are NOT ' +
        'represented — machine tagging cannot infer meaning. Treat this as a starting point, ' +
        'not as an accessible document, and have a human review the structure.',
    );
  } else if (!outcome.wasTagged) {
    outcome.warnings.push(
      'The document has a StructTreeRoot but was not marked as tagged; only the document-level ' +
        'requirements were repaired. The existing structure tree was left untouched.',
    );
  }

  applyDocumentRequirements(doc, opts, outcome, markDirty);

  if (!(opts.title ?? doc.getTitle())) {
    outcome.warnings.push(
      'No title: PDF/UA-1 7.1 requires a document title (dc:title + DisplayDocTitle). ' +
        'Pass "title" — validation will fail without it.',
    );
  }

  outcome.dirtiedRefs = [...dirtied.values()];
  return outcome;
}
