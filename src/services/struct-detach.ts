/**
 * 構造木から要素を外す —— Phase 3 の L4′.2（フォームの焼き込みで要る）。
 *
 * `flatten_form` は Widget 注釈を消す。タグ付き文書ではその Widget を
 * `Form` 構造要素が OBJR で指しているので、**指す先が消えたまま残る**。
 *
 * | 要件 | 何を言っているか |
 * |---|---|
 * | §14.7.4.3 Table 324 | OBJR の `/Obj` は **Required** で、参照する対象そのものである |
 * | §7.3.10 | 解放済みの項目への参照は null オブジェクトとして読まれる |
 * | §14.7.4.4 | ParentTree は `/StructParent` の番号から構造要素を引く |
 *
 * 🔴 **参照を外すだけでは足りない。** `/Obj` を消すと「Required な項目の無い OBJR」に
 * なり、残すと「null を指す OBJR」になる。どちらも Table 324 に反するので、
 * **OBJR を持つ構造要素ごと親の `/K` から外し、ParentTree の対応も消す。**
 *
 * ⚠️ 旧実装（pdf-lib）は `/Obj` の**参照だけ**を取り除いていた（`pruneDanglingRefs`）。
 * §3.29.2 では「pdf-lib 特有の後始末なので要らない見込み」と数えたが、
 * **実測（オラクル）で必要と分かった** —— ただし必要なのは「宙吊り参照の除去」ではなく
 * 「構造要素の除去」である。
 */

import {
  type CosDict,
  type CosObject,
  type CosRef,
  dictGetRaw,
  type PdfDocumentEditor,
} from 'normativepdf';

const refKey = (ref: CosRef): string => `${ref.objectNumber} ${ref.generationNumber}`;

/**
 * `/StructParent` の番号で引ける構造要素を、構造木と ParentTree から外す。
 *
 * 戻り値は外した構造要素の参照（呼び出し側が消せるように）。
 * タグ無し文書や、対応する要素が見つからない場合は空を返す。
 */
export async function detachStructElements(
  editor: PdfDocumentEditor,
  structParentKeys: readonly number[],
): Promise<CosRef[]> {
  if (structParentKeys.length === 0) return [];
  const rootRaw = dictGetRaw(editor.trailer(), 'Root');
  if (rootRaw === undefined) return [];
  const catalog = await editor.resolve(rootRaw);
  if (catalog.kind !== 'dict') return [];
  const structRootRaw = dictGetRaw(catalog, 'StructTreeRoot');
  if (structRootRaw === undefined || structRootRaw.kind !== 'ref') return [];
  const root = await editor.resolve(structRootRaw);
  if (root.kind !== 'dict') return [];

  const ptRaw = dictGetRaw(root, 'ParentTree');
  if (ptRaw === undefined) return [];
  const pt = await editor.resolve(ptRaw);
  if (pt.kind !== 'dict') return [];
  const numsRaw = dictGetRaw(pt, 'Nums');
  if (numsRaw === undefined) return [];
  const nums = await editor.resolve(numsRaw);
  if (nums.kind !== 'array') return [];

  const wanted = new Set(structParentKeys);
  const detached: CosRef[] = [];
  const keptNums: CosObject[] = [];
  for (let i = 0; i + 1 < nums.items.length; i += 2) {
    const key = await editor.resolve(nums.items[i] as CosObject);
    const value = nums.items[i + 1] as CosObject;
    if (key.kind === 'integer' && wanted.has(key.value) && value.kind === 'ref') {
      detached.push(value);
      continue; // ParentTree から外す
    }
    keptNums.push(nums.items[i] as CosObject, value);
  }
  if (detached.length === 0) return [];

  // `/Nums` を書き戻す
  const nextNums: CosObject = { kind: 'array', items: keptNums };
  if (numsRaw.kind === 'ref') {
    editor.set(numsRaw.objectNumber, nextNums, numsRaw.generationNumber);
  } else if (ptRaw.kind === 'ref') {
    const entries = new Map<string, CosObject>(pt.entries);
    entries.set('Nums', nextNums);
    editor.set(ptRaw.objectNumber, { kind: 'dict', entries }, ptRaw.generationNumber);
  }

  // それぞれの `/P`（親）の `/K` から外す
  const doomed = new Set(detached.map(refKey));
  const parents = new Set<string>();
  const parentRefs: CosRef[] = [];
  for (const ref of detached) {
    const elem = await editor.resolve(ref);
    if (elem.kind !== 'dict') continue;
    const parent = dictGetRaw(elem, 'P');
    if (parent === undefined || parent.kind !== 'ref') continue;
    if (parents.has(refKey(parent))) continue;
    parents.add(refKey(parent));
    parentRefs.push(parent);
  }
  for (const parent of parentRefs) {
    await removeKids(editor, parent, doomed);
  }
  // 親が StructTreeRoot 自身のこともある
  await removeKids(editor, structRootRaw, doomed);

  // OBJR も間接オブジェクトなので、外した要素の `/K` ごと消す相手に加える
  const out = [...detached];
  for (const ref of detached) {
    const elem = await editor.resolve(ref);
    if (elem.kind !== 'dict') continue;
    const k = dictGetRaw(elem, 'K');
    if (k === undefined) continue;
    if (k.kind === 'ref') {
      out.push(k);
      continue;
    }
    const value = await editor.resolve(k);
    if (value.kind === 'array') {
      for (const item of value.items) if (item.kind === 'ref') out.push(item);
    }
  }
  return out;
}

/** `/K` から指定の参照を取り除く。`/K` は単一でも配列でもありうる（§14.7.2 Table 323） */
async function removeKids(
  editor: PdfDocumentEditor,
  ref: CosRef,
  doomed: ReadonlySet<string>,
): Promise<void> {
  const node = await editor.resolve(ref);
  if (node.kind !== 'dict') return;
  const raw = dictGetRaw(node, 'K');
  if (raw === undefined) return;

  if (raw.kind === 'ref') {
    if (!doomed.has(refKey(raw))) return;
    const entries = new Map<string, CosObject>(node.entries);
    entries.delete('K');
    editor.set(ref.objectNumber, { kind: 'dict', entries }, ref.generationNumber);
    return;
  }
  const value = await editor.resolve(raw);
  if (value.kind !== 'array') return;
  const kept = value.items.filter((item) => !(item.kind === 'ref' && doomed.has(refKey(item))));
  if (kept.length === value.items.length) return;

  const nextK: CosObject = { kind: 'array', items: kept };
  const entries = new Map<string, CosObject>(node.entries);
  entries.set('K', nextK);
  editor.set(ref.objectNumber, { kind: 'dict', entries }, ref.generationNumber);
}

/** Widget の `/StructParent`（無ければ undefined） */
export async function structParentOf(
  editor: PdfDocumentEditor,
  widget: CosDict,
): Promise<number | undefined> {
  const raw = dictGetRaw(widget, 'StructParent');
  if (raw === undefined) return undefined;
  const value = await editor.resolve(raw);
  return value.kind === 'integer' ? value.value : undefined;
}
