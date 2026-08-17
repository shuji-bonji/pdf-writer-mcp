/**
 * 既存のタグ付き PDF の構造木に、注釈やフォームフィールドを結び付ける —— Phase 3 の L4′.2。
 *
 * 旧実装は `struct-append.ts`（pdf-lib）。`tagged-cos.ts` が書くのは「木を**新設**する」枝で、
 * ここは「**既にある木に足す**」枝である。
 *
 * | 要件 | 何を言っているか |
 * |---|---|
 * | R-14.7.5.2-17 / -18 | 対象を指す辞書は `/Type /OBJR`、`/Pg` はページへの**間接参照** |
 * | R-14.7.5.4-9〜-11 | `/ParentTreeNextKey` は使用中のどの鍵より大きい整数 |
 * | R-14.7.5.4-12 / -17 | 注釈側には `/StructParent`（親ツリーを引く鍵）を書く |
 * | §14.7.4.2 Table 355 | 構造要素の `/P` は親への**間接参照**（必須） |
 * | PDF/UA-1 7.18.1-1 / 7.18.3-1 | 注釈は構造要素に入れる。注釈のあるページは `/Tabs /S` |
 *
 * 🔴 **旧実装にあった逆引き（`refOf`）が要らない。** pdf-lib は `lookup` が解決済みの
 * 辞書を返すので、その辞書の番号を知るには全オブジェクトを走査するしかなかった。
 * COS では `dictGetRaw` が参照をそのまま返すので、走査ごと消える。
 */

import {
  COS_NULL,
  type CosArray,
  type CosDict,
  type CosObject,
  type CosRef,
  dictGet,
  dictGetRaw,
  type PdfDocumentEditor,
} from 'normativepdf';
import { arr, dict, int, name, textString } from './cos.js';
import { isTaggedDoc } from './tagged-cos.js';

export interface AppendAnnotResult {
  /** 入力がタグ付きで、結び付けを行ったか */
  tagged: boolean;
  /** 割り当てた `/StructParent` の鍵 */
  structParent?: number;
}

/** StructTreeRoot 直下の実質的なルート要素（通常は Document）を、参照つきで返す。 */
async function documentElement(
  editor: PdfDocumentEditor,
  root: CosDict,
): Promise<{ ref: CosRef; dict: CosDict } | undefined> {
  const raw = dictGetRaw(root, 'K');
  if (raw === undefined) return undefined;

  const candidates: CosObject[] = [];
  if (raw.kind === 'ref') {
    candidates.push(raw);
  } else {
    const resolved = await editor.resolve(raw);
    if (resolved.kind === 'array') candidates.push(...resolved.items);
    else candidates.push(raw);
  }

  for (const candidate of candidates) {
    if (candidate.kind !== 'ref') continue;
    const value = await editor.resolve(candidate);
    if (value.kind === 'dict' && dictGet(value, 'S') !== undefined) {
      return { ref: candidate, dict: value };
    }
  }
  return undefined;
}

/** 要素の `/K` に子を追加した辞書を返す（単一値・配列・未設定のいずれにも対応）。 */
async function withKid(
  editor: PdfDocumentEditor,
  parent: CosDict,
  kid: CosRef,
): Promise<CosDict> {
  const entries = new Map<string, CosObject>(parent.entries);
  const raw = dictGetRaw(parent, 'K');

  if (raw === undefined) {
    entries.set('K', kid);
  } else {
    const resolved = await editor.resolve(raw);
    if (resolved.kind === 'array') {
      // `/K` が間接配列なら、その配列オブジェクトを差し替える方が dirty が少ない。
      // ここでは親辞書ごと書き戻すので、どちらの形でも同じ結果になるよう配列を作り直す
      entries.set('K', arr([...resolved.items, kid]));
    } else {
      // 単一値だった → 配列に昇格
      entries.set('K', arr([raw, kid]));
    }
  }
  return { kind: 'dict', entries };
}

/** 次に使える ParentTree の鍵（`/ParentTreeNextKey` が無ければ実データから算出）。 */
async function nextParentTreeKey(editor: PdfDocumentEditor, root: CosDict): Promise<number> {
  const declared = await editor.resolve(dictGet(root, 'ParentTreeNextKey') ?? COS_NULL);
  if (declared.kind === 'integer') return declared.value;

  const nums = await parentTreeNums(editor, root);
  if (nums === undefined) return 0;
  let max = -1;
  for (let i = 0; i < nums.items.length; i += 2) {
    const key = await editor.resolve(nums.items[i] as CosObject);
    if (key.kind === 'integer') max = Math.max(max, key.value);
  }
  return max + 1;
}

async function parentTreeNums(
  editor: PdfDocumentEditor,
  root: CosDict,
): Promise<CosArray | undefined> {
  const pt = await editor.resolve(dictGet(root, 'ParentTree') ?? COS_NULL);
  if (pt.kind !== 'dict') return undefined;
  const nums = await editor.resolve(dictGet(pt, 'Nums') ?? COS_NULL);
  return nums.kind === 'array' ? nums : undefined;
}

/** `/Nums` に鍵の昇順を保って `[key, value]` を挿す（§7.9.7 は昇順を求める）。 */
async function insertIntoNums(
  editor: PdfDocumentEditor,
  nums: CosArray,
  key: number,
  value: CosRef,
): Promise<CosArray> {
  const items = [...nums.items];
  let insertAt = items.length;
  for (let i = 0; i < items.length; i += 2) {
    const k = await editor.resolve(items[i] as CosObject);
    if (k.kind === 'integer' && k.value > key) {
      insertAt = i;
      break;
    }
  }
  items.splice(insertAt, 0, int(key), value);
  return arr(items);
}

/**
 * 指定タグの構造要素を Document 直下に足し、OBJR で対象を参照し、
 * ParentTree / `/StructParent` / `/Tabs` を整える。
 *
 * **タグ無し文書では何もしない**（`tagged: false` を返す）。
 * 注釈のためだけに構造木を作り始めない —— それは `ensure_tagged` の仕事である。
 */
export async function appendObjRefToStructTree(
  editor: PdfDocumentEditor,
  page: { ref: CosRef; dict: CosDict },
  targetRef: CosRef,
  tag: 'Annot' | 'Form',
  alt?: string,
): Promise<AppendAnnotResult> {
  if (!(await isTaggedDoc(editor))) return { tagged: false };

  const rootRaw = dictGetRaw(editor.trailer(), 'Root');
  if (rootRaw === undefined) return { tagged: false };
  const catalog = await editor.resolve(rootRaw);
  if (catalog.kind !== 'dict') return { tagged: false };

  const structRootRaw = dictGetRaw(catalog, 'StructTreeRoot');
  if (structRootRaw === undefined || structRootRaw.kind !== 'ref') {
    // `/StructTreeRoot` が直接辞書という異形。`/P` に置ける参照が無いので諦める
    return { tagged: false };
  }
  const root = await editor.resolve(structRootRaw);
  if (root.kind !== 'dict') return { tagged: false };

  const document = await documentElement(editor, root);
  const parentRef = document?.ref ?? structRootRaw;
  const parentDict = document?.dict ?? root;

  // 先に番号だけ採る（`/K` の OBJR と相互に要る）
  const elemRef = await editor.allocate(COS_NULL);
  const objr = await editor.allocate(
    dict([
      ['Type', name('OBJR')],
      ['Obj', targetRef],
      ['Pg', page.ref],
    ]),
  );
  editor.set(
    elemRef.objectNumber,
    dict([
      ['Type', name('StructElem')],
      ['S', name(tag)],
      ['P', parentRef],
      ['Pg', page.ref],
      ...(alt !== undefined && alt !== '' ? ([['Alt', textString(alt)]] as const) : []),
      ['K', objr],
    ]),
    elemRef.generationNumber,
  );

  // 親の `/K` に足す。親が root 自身なら root ごと書き戻す（下でまとめて書く）
  const parentWithKid = await withKid(editor, parentDict, elemRef);
  if (document !== undefined) {
    editor.set(parentRef.objectNumber, parentWithKid, parentRef.generationNumber);
  }

  const key = await nextParentTreeKey(editor, root);
  const nums = await parentTreeNums(editor, root);

  // root は必ず変わる（`/ParentTreeNextKey`。親が root なら `/K` も）
  const rootEntries = new Map<string, CosObject>(
    (document === undefined ? parentWithKid : root).entries,
  );

  if (nums !== undefined) {
    const updated = await insertIntoNums(editor, nums, key, elemRef);
    const ptRaw = dictGetRaw(root, 'ParentTree');
    const pt = ptRaw === undefined ? COS_NULL : await editor.resolve(ptRaw);
    const numsRaw = pt.kind === 'dict' ? dictGetRaw(pt, 'Nums') : undefined;

    if (numsRaw !== undefined && numsRaw.kind === 'ref') {
      editor.set(numsRaw.objectNumber, updated, numsRaw.generationNumber);
    } else if (ptRaw !== undefined && ptRaw.kind === 'ref' && pt.kind === 'dict') {
      const ptEntries = new Map<string, CosObject>(pt.entries);
      ptEntries.set('Nums', updated);
      editor.set(ptRaw.objectNumber, { kind: 'dict', entries: ptEntries }, ptRaw.generationNumber);
    } else if (pt.kind === 'dict') {
      const ptEntries = new Map<string, CosObject>(pt.entries);
      ptEntries.set('Nums', updated);
      rootEntries.set('ParentTree', { kind: 'dict', entries: ptEntries });
    }
  } else {
    // ParentTree が無い（または `/Kids` 形式）なら平坦な `/Nums` を新設する
    const created = await editor.allocate(dict([['Nums', arr([int(key), elemRef])]]));
    rootEntries.set('ParentTree', created);
  }

  rootEntries.set('ParentTreeNextKey', int(key + 1));
  editor.set(structRootRaw.objectNumber, { kind: 'dict', entries: rootEntries }, structRootRaw.generationNumber);

  // 注釈側に `/StructParent`（R-14.7.5.4-12）
  const target = await editor.resolve(targetRef);
  if (target.kind === 'dict') {
    const entries = new Map<string, CosObject>(target.entries);
    entries.set('StructParent', int(key));
    editor.set(targetRef.objectNumber, { kind: 'dict', entries }, targetRef.generationNumber);
  }

  // 7.18.3-1: 注釈のあるページは `/Tabs /S`（タブ順を構造順に）
  const pageNow = await editor.resolve(page.ref);
  const pageEntries = new Map<string, CosObject>(
    pageNow.kind === 'dict' ? pageNow.entries : page.dict.entries,
  );
  pageEntries.set('Tabs', name('S'));
  editor.set(page.ref.objectNumber, { kind: 'dict', entries: pageEntries }, page.ref.generationNumber);

  return { tagged: true, structParent: key };
}

/** 注釈を構造木へ（PDF/UA-1 7.18.1-1）。 */
export async function appendAnnotationToStructTree(
  editor: PdfDocumentEditor,
  page: { ref: CosRef; dict: CosDict },
  annotRef: CosRef,
  alt?: string,
): Promise<AppendAnnotResult> {
  return appendObjRefToStructTree(editor, page, annotRef, 'Annot', alt);
}
