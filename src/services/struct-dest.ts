/**
 * structure destination の行き先にする構造要素を、ページから選ぶ（#26・SPEC-WRITER-PDFUA2-006）。
 *
 * ISO 14289-2 §8.8 は、文書内を指す行き先を structure destination（ISO 32000-2 §12.3.2.3）に
 * することを求める。structure destination は先頭の要素がページではなく構造要素で、ビューアは
 * §12.3.2.3 の手順でその要素からページを決める:
 *
 *   要素の `/K` を配列の順に見る。最初の子が marked-content reference かオブジェクト参照なら
 *   そのページ。構造要素なら、その要素で同じ手順を繰り返す。見つからなければ次の子へ進む。
 *
 * しおりはページを指して作るので、**その手順で同じページに戻る要素**を選ぶ。候補は、
 * そのページの親配列（ParentTree の `/StructParents` の値。§14.7.5.4）に並ぶ要素を
 * MCID の順に見たもの。最初の候補が前のページから続く段落なら、手順は前のページに着くので、
 * 次の候補へ進む。どの候補も戻らなければ undefined（呼び出し側がページの行き先にする）。
 */

import {
  type CosDict,
  type CosObject,
  type CosRef,
  dictGet,
  dictGetRaw,
  type PdfDocumentEditor,
} from 'normativepdf';

const COS_NULL: CosObject = { kind: 'null' };

/** 数の木（§7.9.7）から鍵の値を引く。`/Nums` と `/Kids` のどちらの形でも辿る */
async function numberTreeLookup(
  editor: PdfDocumentEditor,
  node: CosObject,
  key: number,
  depth = 0,
): Promise<CosObject | undefined> {
  if (depth > 32) return undefined;
  const resolved = await editor.resolve(node);
  if (resolved.kind !== 'dict') return undefined;
  const nums = await editor.resolve(dictGet(resolved, 'Nums') ?? COS_NULL);
  if (nums.kind === 'array') {
    for (let i = 0; i + 1 < nums.items.length; i += 2) {
      const k = await editor.resolve(nums.items[i] as CosObject);
      if (k.kind === 'integer' && k.value === key) return nums.items[i + 1];
    }
  }
  const kids = await editor.resolve(dictGet(resolved, 'Kids') ?? COS_NULL);
  if (kids.kind === 'array') {
    for (const kid of kids.items) {
      const found = await numberTreeLookup(editor, kid, key, depth + 1);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

const sameRef = (a: CosObject | undefined, b: CosRef): boolean =>
  a?.kind === 'ref' &&
  a.objectNumber === b.objectNumber &&
  a.generationNumber === b.generationNumber;

/**
 * §12.3.2.3 の手順で、構造要素が指すページ（の参照）を決める。
 * MCID（整数）は要素の `/Pg`、MCR・OBJR は自身の `/Pg`（無ければ要素の `/Pg`）のページ。
 */
async function pageOfElement(
  editor: PdfDocumentEditor,
  element: CosDict,
  depth = 0,
): Promise<CosObject | undefined> {
  if (depth > 64) return undefined;
  const ownPage = dictGetRaw(element, 'Pg');
  const k = await editor.resolve(dictGet(element, 'K') ?? COS_NULL);
  const kids =
    k.kind === 'array' ? k.items : k.kind === 'null' ? [] : [dictGetRaw(element, 'K') as CosObject];
  for (const raw of kids) {
    const kid = await editor.resolve(raw);
    if (kid.kind === 'integer') {
      if (ownPage !== undefined) return ownPage;
      continue;
    }
    if (kid.kind !== 'dict') continue;
    const type = await editor.resolve(dictGet(kid, 'Type') ?? COS_NULL);
    const typeName = type.kind === 'name' ? type.value : undefined;
    if (typeName === 'MCR' || typeName === 'OBJR') {
      const page = dictGetRaw(kid, 'Pg') ?? ownPage;
      if (page !== undefined) return page;
      continue;
    }
    // 構造要素（`/Type /StructElem` は省略できる。§14.7.2 Table 355）
    const found = await pageOfElement(editor, kid, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * `page` を指す structure destination の要素。見つからなければ undefined。
 * 構造木・親ツリー・ページの `/StructParents` のどれかが無い文書でも undefined を返す。
 */
export async function structureElementForPage(
  editor: PdfDocumentEditor,
  structTreeRoot: CosDict,
  pageRef: CosRef,
  pageDict: CosDict,
): Promise<CosRef | undefined> {
  const key = await editor.resolve(dictGet(pageDict, 'StructParents') ?? COS_NULL);
  if (key.kind !== 'integer') return undefined;
  const parentTree = dictGetRaw(structTreeRoot, 'ParentTree');
  if (parentTree === undefined) return undefined;
  const value = await numberTreeLookup(editor, parentTree, key.value);
  if (value === undefined) return undefined;
  const parents = await editor.resolve(value);
  if (parents.kind !== 'array') return undefined;

  const tried = new Set<number>();
  for (const candidate of parents.items) {
    if (candidate.kind !== 'ref' || tried.has(candidate.objectNumber)) continue;
    tried.add(candidate.objectNumber);
    const element = await editor.resolve(candidate);
    if (element.kind !== 'dict') continue;
    if (sameRef(await pageOfElement(editor, element), pageRef)) return candidate;
  }
  return undefined;
}
