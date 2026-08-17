/**
 * 文書をまたぐオブジェクトグラフの複写 —— Phase 3 の L4′.2。
 *
 * `page-ops.ts` の 5 ツール（merge / split / extract / delete / reorder）は
 * すべて「別の文書から選んだページを、新しい文書へ移す」形をしており、
 * 旧実装は pdf-lib の `copyPages` と `PDFObjectCopier` に委ねていた。
 * その 2 つに当たるものがここである。
 *
 * | 要件 | 何を言っているか |
 * |---|---|
 * | R-7.3.10-6 | 参照は「番号 + 世代」の対で 1 つのオブジェクトを指す。**別の文書の番号は別物** |
 * | R-7.3.8.1-5 | ストリームは間接オブジェクトでなければならない |
 * | R-7.7.3.3-5 | ページの `/Parent` は**その文書の**ページツリー節点への間接参照 |
 * | R-7.7.3.2-6 / -8 | 節点の `/Kids` と `/Count`（葉の総数） |
 *
 * 🔴 **循環を先に断つ。** ページ辞書は `/Parent` で親を指し、親は `/Kids` で子を指すので、
 * 素直に辿ると戻ってくる。**番号だけ先に採って対応表に載せ、中身は後から入れる**
 * （`outline.ts` の相互参照と同じ手順）。
 */

import {
  COS_NULL,
  type CosDict,
  type CosObject,
  type CosRef,
  dictGet,
  dictGetRaw,
  PdfDocumentEditor,
} from 'normativepdf';
import { PdfWriterError } from '../errors.js';
import { arr, dict, int, name } from './cos.js';

/** 複写の途中経過。同じ元オブジェクトを 2 度複写しないための対応表を持つ。 */
export interface CopyContext {
  readonly from: PdfDocumentEditor;
  readonly to: PdfDocumentEditor;
  /** 元の「番号 世代」→ 複写先の参照 */
  readonly seen: Map<string, CosRef>;
}

export const newCopyContext = (from: PdfDocumentEditor, to: PdfDocumentEditor): CopyContext => ({
  from,
  to,
  seen: new Map(),
});

const keyOf = (ref: CosRef): string => `${ref.objectNumber} ${ref.generationNumber}`;

/**
 * 値を複写する。参照は複写先の新しい番号に置き換わる。
 *
 * 直接オブジェクト（辞書・配列・スカラ）はその場で作り直し、参照だけが
 * 「番号を採って中身を入れる」経路を通る。
 */
export async function copyValue(ctx: CopyContext, value: CosObject): Promise<CosObject> {
  switch (value.kind) {
    case 'ref':
      return copyIndirect(ctx, value);
    case 'array': {
      const items: CosObject[] = [];
      for (const item of value.items) items.push(await copyValue(ctx, item));
      return { kind: 'array', items };
    }
    case 'dict': {
      const entries = new Map<string, CosObject>();
      for (const [key, item] of value.entries) entries.set(key, await copyValue(ctx, item));
      return { kind: 'dict', entries };
    }
    case 'stream': {
      // R-7.3.8.1-5: ストリームは間接オブジェクトなので、直接値として現れるのは
      // 呼び出し側が組み立てた場合だけ。辞書だけ複写して生バイトはそのまま持つ
      const entries = new Map<string, CosObject>();
      for (const [key, item] of value.dict.entries) entries.set(key, await copyValue(ctx, item));
      return { kind: 'stream', dict: { kind: 'dict', entries }, raw: value.raw };
    }
    default:
      // 真偽値・整数・実数・文字列・名前・null は値そのもの
      return value;
  }
}

/** 参照を複写する。既に複写済みなら対応表の参照を返す（循環と共有を 1 回にまとめる）。 */
async function copyIndirect(ctx: CopyContext, ref: CosRef): Promise<CosRef> {
  const key = keyOf(ref);
  const already = ctx.seen.get(key);
  if (already !== undefined) return already;

  // 🔴 先に番号だけ採る。中身を入れる前に対応表へ載せるので、
  // `/Parent` のように戻ってくる参照でも無限に降りない
  const placed = await ctx.to.allocate(COS_NULL);
  ctx.seen.set(key, placed);

  const source = await ctx.from.get(ref.objectNumber, ref.generationNumber);
  ctx.to.set(placed.objectNumber, await copyValue(ctx, source), placed.generationNumber);
  return placed;
}

/**
 * 元の文書の指定ページ（1 始まり・**指定した順**）を、複写先の文書へ足す。
 *
 * 複写先はページツリーの根を 1 つだけ持つ形（`PdfDocumentEditor.create()` が作る形）を
 * 前提とする。各ページの `/Parent` はその根に付け替える —— 元の親を複写すると
 * **元の文書のページツリーごと**複写され、選ばなかったページまで付いてくる。
 */
export async function copyPagesInto(
  ctx: CopyContext,
  pages1: readonly number[],
): Promise<CosRef[]> {
  const sourcePages = await ctx.from.pages();
  // 根の番号はライブラリが決める。ここで数字を書くと、向こうが変えたときに黙って壊れる
  const parent = PdfDocumentEditor.rootPagesRef;

  const added: CosRef[] = [];
  for (const number of pages1) {
    const page = sourcePages[number - 1];
    if (page === undefined) {
      throw new PdfWriterError(
        `page ${number} is out of range (the document has ${sourcePages.length} page(s))`,
        'INVALID_ARGUMENT',
      );
    }

    // ページ辞書は 1 枚ずつ複写する。`/Parent` は複写せず付け替える
    const entries = new Map<string, CosObject>();
    for (const [key, value] of page.dict.entries) {
      if (key === 'Parent') continue;
      entries.set(key, await copyValue(ctx, value));
    }
    // R-7.7.3.4: 継承する属性（`/Resources` `/MediaBox` `/CropBox` `/Rotate`）は
    // 元の祖先が持っていた値を**ページ自身に**書き写す。親を替える以上、
    // 継承の鎖は切れるので、ここで確定させないと既定値に落ちる
    for (const key of ['Resources', 'MediaBox', 'CropBox', 'Rotate'] as const) {
      if (entries.has(key)) continue;
      const inherited = await ctx.from.pageAttribute(number - 1, key);
      if (inherited !== undefined) entries.set(key, await copyValue(ctx, inherited));
    }
    entries.set('Parent', parent);
    entries.set('Type', name('Page'));

    added.push(await ctx.to.allocate({ kind: 'dict', entries }));
  }

  await appendKids(ctx.to, added);
  return added;
}

/** ページツリーの根の `/Kids` に足し、`/Count` を数え直す（R-7.7.3.2-6 / -8）。 */
async function appendKids(to: PdfDocumentEditor, pages: readonly CosRef[]): Promise<void> {
  if (pages.length === 0) return;
  const parent = PdfDocumentEditor.rootPagesRef;
  const node = await to.get(parent.objectNumber, parent.generationNumber);
  if (node.kind !== 'dict') {
    throw new PdfWriterError(
      'the destination document has no page tree root to add pages to (§7.7.3.2)',
      'INTERNAL_ERROR',
    );
  }
  const kids = await to.resolve(dictGet(node, 'Kids') ?? COS_NULL);
  const items = kids.kind === 'array' ? [...kids.items, ...pages] : [...pages];
  const entries = new Map<string, CosObject>(node.entries);
  entries.set('Kids', arr(items));
  entries.set('Count', int(items.length));
  entries.set('Type', name('Pages'));
  to.set(parent.objectNumber, { kind: 'dict', entries }, parent.generationNumber);
}

/**
 * catalog の 1 項目を複写する。**結果は必ず間接参照**になる。
 *
 * 🔴 ストリームは間接でなければならない（R-7.3.8.1-5・Table 29 の `Metadata` は
 * R-7.7.2-22）。直接のまま catalog に埋めると、catalog がオブジェクトストリームに
 * 入る構成で生バイトが埋まり、**出力 PDF が壊れる**（実測: `qpdf: unable to find
 * /Root dictionary`・v0.13.0 のリグレッション。W-1）。
 *
 * ストリーム以外も格上げするのは、旧実装（`copyForCatalog`）が選んだ形に合わせるためである
 * —— 一貫させておけば「解決してから渡す」誤りが再発しても壊れない。Table 29 は
 * ここで運ぶ鍵（`Names` / `AF` / `Lang` / `ViewerPreferences` / `OutputIntents`）に
 * 間接を禁じていない。`tests/doc-level.test.ts` の W-1 回帰がこの形を固定している。
 */
export async function copyCatalogValue(ctx: CopyContext, raw: CosObject): Promise<CosRef> {
  if (raw.kind === 'ref') return copyIndirect(ctx, raw);
  return ctx.to.allocate(await copyValue(ctx, raw));
}

/** 元の catalog（`/Root`）を辞書として読む。 */
export async function sourceCatalog(from: PdfDocumentEditor): Promise<CosDict | undefined> {
  const rootRaw = dictGetRaw(from.trailer(), 'Root');
  if (rootRaw === undefined) return undefined;
  const catalog = await from.resolve(rootRaw);
  return catalog.kind === 'dict' ? catalog : undefined;
}

/** 複写先の catalog に項目を書く。 */
export async function updateDestinationCatalog(
  to: PdfDocumentEditor,
  mutate: (entries: Map<string, CosObject>) => void,
): Promise<void> {
  const rootRaw = dictGetRaw(to.trailer(), 'Root');
  if (rootRaw === undefined || rootRaw.kind !== 'ref') {
    throw new PdfWriterError('the destination document has no /Root reference', 'INTERNAL_ERROR');
  }
  const catalog = await to.resolve(rootRaw);
  const entries = new Map<string, CosObject>(catalog.kind === 'dict' ? catalog.entries : []);
  mutate(entries);
  to.set(rootRaw.objectNumber, { kind: 'dict', entries }, rootRaw.generationNumber);
}

/** 空の辞書（`dict([])` の別名。読み手に「空である」ことを明示するため） */
export const emptyDict = (): CosDict => dict([]);
