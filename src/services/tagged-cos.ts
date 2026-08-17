/**
 * `ensure_tagged` の中身を COS の上に置き直したもの —— Phase 3 の L4′.2。
 *
 * 旧実装は `ensure-tagged.ts`（264 行・全面的に pdf-lib）。**器だけを変えた**もので、
 * できること / できないことは同じである:
 *   - **できる**: 文書レベルの要件（StructTreeRoot / MarkInfo / `/Lang` /
 *     DisplayDocTitle / XMP）を機械的に満たし、ページ内容をタグの下に置くこと。
 *     既にタグ付きなら**構造木には触らず**欠落要件だけ補う。
 *   - **できない**: 意味のある構造の推定。見出し・表・リスト・読み順・図の代替テキストは
 *     内容の理解を要する。タグ無し文書には「1 ページ = 1 段落（P）」の足場を作るだけで、
 *     これは「読み上げられる」状態にはするが「適切に構造化された」状態ではない。
 *
 * | 要件 | 何を言っているか |
 * |---|---|
 * | R-14.7.5.2-2 / -4 | 内容項目は BDC…EMC で囲み、属性リストに **MCID** を持つ |
 * | R-14.7.5.4-7 / -8 | ページの親ツリーの値は**配列**で、MCID をそのまま添字にする |
 * | R-14.7.5.4-12 / -17 | ページ辞書に `/StructParents`（その配列を引く鍵）を書く |
 * | R-14.7.5.4-9〜-11 | `/ParentTreeNextKey` は使用中のどの鍵より大きい整数 |
 * | R-14.6.1-11 | marked-content の並びは**単一の内容ストリーム**に収まること |
 * | R-7.7.3.3-23 | `/Contents` が配列なら、**連結して 1 本の内容ストリームとして扱う** |
 *
 * 🔴 **BDC と EMC を別のストリームに置いてよい根拠は R-7.7.3.3-23 である。**
 * 配列は連結して 1 本として扱われるので、R-14.6.1-11 の「単一の内容ストリームに
 * 収まる」を満たす。既存の内容ストリームのバイト列に触らずに包めるのはこのためで、
 * 旧実装が採った形と同じである。
 *
 * ⚠️ **`ContentStreamBuilder` は使えない。** `finish()` は 1 本の中で括弧の
 * 釣り合いを求める（R-9.4.1-6 / R-14.6.1-12）ので、`BDC` だけのストリームを作れない。
 * ここは 2 本に分けて置くのが目的なので、演算子を直接バイト列で書く。
 */

import {
  COS_NULL,
  type CosDict,
  type CosObject,
  type CosRef,
  dictGet,
  dictGetRaw,
  type PdfDocumentEditor,
} from 'normativepdf';
import { PdfWriterError } from '../errors.js';
import { arr, bool, dict, int, name, stream, textString } from './cos.js';
import { textOf } from './cos-read.js';
import { setInfoEntries } from './info-dict.js';
import { infoCreationDateIso, writeXmpMetadata } from './xmp-cos.js';

export interface EnsureTaggedOptions {
  /** 文書タイトル（PDF/UA 7.1 で必須）。省略時は既存 Info の Title を使う */
  title?: string;
  /** 文書の自然言語（BCP 47。7.2 で必須） */
  lang?: string;
}

export interface EnsureTaggedOutcome {
  /** 入力が既にタグ付きだったか */
  wasTagged: boolean;
  /** 構造木を新設したか（タグ無し入力のみ） */
  createdStructure: boolean;
  /** P 要素で包んだページ数（新設時） */
  wrappedPages: number;
  /** 補った文書レベル要件 */
  addedRequirements: string[];
  warnings: string[];
}

const enc = (text: string): Uint8Array => new TextEncoder().encode(text);

/** catalog を読んで書き戻す（`/Root` が間接参照でも直接辞書でも同じ形で扱う）。 */
async function updateCatalog(
  editor: PdfDocumentEditor,
  mutate: (entries: Map<string, CosObject>) => void,
): Promise<void> {
  const rootRaw = dictGetRaw(editor.trailer(), 'Root');
  if (rootRaw === undefined) {
    throw new PdfWriterError('the trailer has no /Root (§7.5.5 Table 15)', 'INVALID_PDF');
  }
  const catalog = await editor.resolve(rootRaw);
  if (catalog.kind !== 'dict') {
    throw new PdfWriterError('/Root does not resolve to the catalog dictionary', 'INVALID_PDF');
  }
  const entries = new Map<string, CosObject>(catalog.entries);
  mutate(entries);
  const updated: CosDict = { kind: 'dict', entries };
  if (rootRaw.kind === 'ref') {
    editor.set(rootRaw.objectNumber, updated, rootRaw.generationNumber);
  } else {
    editor.setTrailerEntry('Root', updated);
  }
}

async function readCatalog(editor: PdfDocumentEditor): Promise<CosDict | undefined> {
  const rootRaw = dictGetRaw(editor.trailer(), 'Root');
  if (rootRaw === undefined) return undefined;
  const catalog = await editor.resolve(rootRaw);
  return catalog.kind === 'dict' ? catalog : undefined;
}

/** `/MarkInfo` の `/Marked` が true か（R-14.7.1-7）。 */
export async function isMarked(editor: PdfDocumentEditor): Promise<boolean> {
  const catalog = await readCatalog(editor);
  if (catalog === undefined) return false;
  const markInfo = await editor.resolve(dictGet(catalog, 'MarkInfo') ?? COS_NULL);
  if (markInfo.kind !== 'dict') return false;
  const marked = await editor.resolve(dictGet(markInfo, 'Marked') ?? COS_NULL);
  return marked.kind === 'boolean' && marked.value;
}

/** 構造木があり、かつタグ付きを名乗っているか（`struct-append.ts` の `isTagged` と同じ判定）。 */
export async function isTaggedDoc(editor: PdfDocumentEditor): Promise<boolean> {
  const catalog = await readCatalog(editor);
  if (catalog === undefined) return false;
  const root = await editor.resolve(dictGet(catalog, 'StructTreeRoot') ?? COS_NULL);
  if (root.kind !== 'dict') return false;
  return isMarked(editor);
}

/**
 * ページ内容を `/P <</MCID n>> BDC … EMC` で包む。
 *
 * 既存の内容ストリームのバイト列には触らない —— `/Contents` 配列の前後に
 * 1 本ずつ足すだけである（R-7.7.3.3-23 で連結が 1 本として扱われる）。
 */
async function wrapPageContentInP(
  editor: PdfDocumentEditor,
  pageDict: CosDict,
  mcid: number,
): Promise<CosDict> {
  const bdc = await editor.allocate(stream([], enc(`/P <</MCID ${mcid}>> BDC\n`)));
  const emc = await editor.allocate(stream([], enc('EMC\n')));

  const raw = dictGetRaw(pageDict, 'Contents');
  let middle: readonly CosObject[];
  if (raw === undefined || raw.kind === 'null') {
    // 内容の無いページ。R-7.7.3.3-26 は空の配列を禁じるが、ここは 2 本入るので空にならない
    middle = [];
  } else {
    const resolved = await editor.resolve(raw);
    if (resolved.kind === 'array') {
      middle = resolved.items;
    } else if (raw.kind === 'ref') {
      middle = [raw];
    } else {
      // 直接オブジェクトのストリーム。R-7.3.8.1-5 はストリームを間接オブジェクトに
      // 限るので、配列へ入れる前に番号を与える
      middle = [await editor.allocate(resolved)];
    }
  }

  const entries = new Map<string, CosObject>(pageDict.entries);
  entries.set('Contents', arr([bdc, ...middle, emc]));
  return { kind: 'dict', entries };
}

/**
 * 構造木をゼロから作り、各ページの内容を P 要素で包む（タグ無し文書のみ）。
 * `Document > P × ページ数` の平坦な木。
 */
async function createMinimalStructure(
  editor: PdfDocumentEditor,
  outcome: EnsureTaggedOutcome,
): Promise<void> {
  // `/Parent` が相互に要るので、先に番号だけ採る（`outline.ts` と同じ手順）
  const rootRef = await editor.allocate(COS_NULL);
  const docElemRef = await editor.allocate(COS_NULL);

  const pElems: CosRef[] = [];
  const nums: CosObject[] = [];

  const pages = await editor.pages();
  for (const [index, page] of pages.entries()) {
    if (page.ref === null) {
      throw new PdfWriterError(
        `page ${index + 1} is a direct object, so it cannot be named by /Pg (R-14.7.5.2-18); ` +
          'rewrite the document so every page is an indirect object first',
        'INVALID_PDF',
      );
    }
    const mcid = 0; // 1 ページ 1 要素なので MCID は常に 0
    const wrapped = await wrapPageContentInP(editor, page.dict, mcid);

    const pRef = await editor.allocate(
      dict([
        ['Type', name('StructElem')],
        ['S', name('P')],
        ['P', docElemRef],
        ['Pg', page.ref],
        // R-14.7.5.2-5: K が整数なら、それは `/Pg` のページにある MCID を指す
        ['K', int(mcid)],
      ]),
    );
    pElems.push(pRef);

    // ページ → 親ツリーの鍵（R-14.7.5.4-12/-17）
    const entries = new Map<string, CosObject>(wrapped.entries);
    entries.set('StructParents', int(index));
    editor.set(page.ref.objectNumber, { kind: 'dict', entries }, page.ref.generationNumber);

    // 値は**配列**で、MCID がその添字になる（R-14.7.5.4-7/-8/-18/-19）
    nums.push(int(index), await editor.allocate(arr([pRef])));
    outcome.wrappedPages += 1;
  }

  editor.set(
    docElemRef.objectNumber,
    dict([
      ['Type', name('StructElem')],
      ['S', name('Document')],
      ['P', rootRef],
      ['K', arr(pElems)],
    ]),
    docElemRef.generationNumber,
  );

  const parentTree = await editor.allocate(dict([['Nums', arr(nums)]]));
  editor.set(
    rootRef.objectNumber,
    dict([
      ['Type', name('StructTreeRoot')],
      ['K', docElemRef],
      ['ParentTree', parentTree],
      // R-14.7.5.4-9: 使用中のどの鍵（0〜ページ数-1）より大きい
      ['ParentTreeNextKey', int(pages.length)],
    ]),
    rootRef.generationNumber,
  );

  await updateCatalog(editor, (entries) => {
    entries.set('StructTreeRoot', rootRef);
  });
  outcome.createdStructure = true;
  outcome.addedRequirements.push('StructTreeRoot(Document > P)');
}

/** 文書レベルの PDF/UA 要件を補う（構造木の有無に関わらず実施）。 */
async function applyDocumentRequirements(
  editor: PdfDocumentEditor,
  opts: EnsureTaggedOptions,
  outcome: EnsureTaggedOutcome,
): Promise<void> {
  // `/MarkInfo <</Marked true>>`（7.1）
  if (!(await isMarked(editor))) {
    await updateCatalog(editor, (entries) => {
      entries.set('MarkInfo', dict([['Marked', bool(true)]]));
    });
    outcome.addedRequirements.push('MarkInfo/Marked');
  }

  // `/Lang`（7.2）
  const catalog = await readCatalog(editor);
  if (opts.lang !== undefined && opts.lang !== '') {
    const lang = opts.lang;
    await updateCatalog(editor, (entries) => {
      entries.set('Lang', textString(lang));
    });
    outcome.addedRequirements.push('Lang');
  } else if (catalog === undefined || dictGet(catalog, 'Lang') === undefined) {
    outcome.warnings.push(
      'No "lang" given and the document declares no /Lang; PDF/UA-1 7.2 requires one. ' +
        'Pass "lang" (BCP 47) — a missing or wrong language makes screen readers mispronounce text.',
    );
  }

  // `/ViewerPreferences <</DisplayDocTitle true>>`（7.1）
  const vpRaw = catalog === undefined ? undefined : dictGetRaw(catalog, 'ViewerPreferences');
  const vp = vpRaw === undefined ? COS_NULL : await editor.resolve(vpRaw);
  if (vp.kind === 'dict' && vpRaw !== undefined) {
    const entries = new Map<string, CosObject>(vp.entries);
    entries.set('DisplayDocTitle', bool(true));
    if (vpRaw.kind === 'ref') {
      editor.set(vpRaw.objectNumber, { kind: 'dict', entries }, vpRaw.generationNumber);
    } else {
      await updateCatalog(editor, (catalogEntries) => {
        catalogEntries.set('ViewerPreferences', { kind: 'dict', entries });
      });
    }
  } else {
    await updateCatalog(editor, (entries) => {
      entries.set('ViewerPreferences', dict([['DisplayDocTitle', bool(true)]]));
    });
  }
  outcome.addedRequirements.push('ViewerPreferences/DisplayDocTitle');

  // タイトル（7.1）: 引数 → 既存 Info の順
  const infoRaw = dictGetRaw(editor.trailer(), 'Info');
  const info = infoRaw === undefined ? COS_NULL : await editor.resolve(infoRaw);
  const infoText = async (key: string): Promise<string | undefined> =>
    info.kind === 'dict' ? textOf(await editor.resolve(dictGet(info, key) ?? COS_NULL)) : undefined;

  const title = opts.title ?? (await infoText('Title'));
  if (title !== undefined && title !== '') {
    await setInfoEntries(editor, [['Title', textString(title)]]);
  }

  // XMP（pdfuaid:part 1 + dc:title）
  await writeXmpMetadata(editor, {
    ...(title !== undefined ? { title } : {}),
    ...((await infoText('Author')) !== undefined ? { author: await infoText('Author') } : {}),
    ...((await infoText('Subject')) !== undefined ? { subject: await infoText('Subject') } : {}),
    ...((await infoText('Keywords')) !== undefined ? { keywords: await infoText('Keywords') } : {}),
    pdfuaPart: 1,
    ...(opts.lang !== undefined ? { lang: opts.lang } : {}),
    // W-6: 既存 PDF の編集経路なので、作成日時は Info の `/CreationDate` から引き継ぐ
    ...((await infoCreationDateIso(editor)) !== undefined
      ? { createDate: await infoCreationDateIso(editor) }
      : {}),
  });
  outcome.addedRequirements.push('XMP(pdfuaid:part, dc:title)');

  if (title === undefined || title === '') {
    outcome.warnings.push(
      'No title: PDF/UA-1 7.1 requires a document title (dc:title + DisplayDocTitle). ' +
        'Pass "title" — validation will fail without it.',
    );
  }
}

/** PDF/UA-1 の器に載せる。既にタグ付きなら構造木は温存し、欠落した文書要件のみ補う。 */
export async function ensureTaggedStructure(
  editor: PdfDocumentEditor,
  opts: EnsureTaggedOptions,
): Promise<EnsureTaggedOutcome> {
  const outcome: EnsureTaggedOutcome = {
    wasTagged: await isTaggedDoc(editor),
    createdStructure: false,
    wrappedPages: 0,
    addedRequirements: [],
    warnings: [],
  };

  const catalog = await readCatalog(editor);
  const structRoot =
    catalog === undefined
      ? COS_NULL
      : await editor.resolve(dictGet(catalog, 'StructTreeRoot') ?? COS_NULL);

  if (structRoot.kind !== 'dict') {
    await createMinimalStructure(editor, outcome);
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

  await applyDocumentRequirements(editor, opts, outcome);
  return outcome;
}
