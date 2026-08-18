/**
 * ページの `/Resources` に資源を足す —— Phase 3 の L4′.2 の共有部品。
 *
 * `page-draw.ts`（透かし・ページ番号）と `acroform-flatten.ts`（フォームの焼き込み）が
 * 使う。分けたのは、**継承の扱いを 1 か所に閉じる**ためである。
 *
 * | 要件 | 何を言っているか |
 * |---|---|
 * | R-7.7.3.4 | `/Resources` は祖先から継承される |
 * | R-7.7.3.3-8 | ページに資源が要るなら `/Resources` は空でない辞書 |
 *
 * 🔴 **継承していた値をページに書き写してから足す。** ページ自身に `/Resources` を
 * 書くと継承は以後使われないので、写さないと既存の内容ストリームが使っている資源名が
 * 解決できなくなる（§3.28.2 で 1 度作った欠陥）。
 */

import { COS_NULL, type CosObject, type PageEntry, type PdfDocumentEditor } from 'normativepdf';

/** 資源の種別（`/Font` `/ExtGState` `/XObject` …）ごとに「名前 → 値」を足す */
export type ResourceAdditions = Readonly<Record<string, Readonly<Record<string, CosObject>>>>;

/**
 * 継承を解いた `/Resources` に `additions` を足した辞書を返す（書き込みはしない）。
 *
 * 同名の資源が既にあれば**上書きする** —— 呼び出し側が既存とぶつからない名前を選ぶ責任を
 * 持つ。ぶつからない名前が要るときは `freshResourceName` を使う。
 */
export async function resourcesWith(
  editor: PdfDocumentEditor,
  page: PageEntry,
  additions: ResourceAdditions,
): Promise<CosObject> {
  const raw = await editor.pageAttribute(page.index, 'Resources');
  const resolved = raw === undefined ? COS_NULL : await editor.resolve(raw);
  const entries = new Map<string, CosObject>(resolved.kind === 'dict' ? resolved.entries : []);

  for (const [category, values] of Object.entries(additions)) {
    if (Object.keys(values).length === 0) continue;
    const existing = await editor.resolve(entries.get(category) ?? COS_NULL);
    const merged = new Map<string, CosObject>(existing.kind === 'dict' ? existing.entries : []);
    for (const [key, value] of Object.entries(values)) merged.set(key, value);
    entries.set(category, { kind: 'dict', entries: merged });
  }
  return { kind: 'dict', entries };
}

/**
 * その種別で使われていない資源名を作る（`prefix0` `prefix1` …）。
 * 継承した資源も見るので、祖先が使っている名前ともぶつからない。
 */
export async function freshResourceName(
  editor: PdfDocumentEditor,
  page: PageEntry,
  category: string,
  prefix: string,
): Promise<string> {
  const raw = await editor.pageAttribute(page.index, 'Resources');
  const resolved = raw === undefined ? COS_NULL : await editor.resolve(raw);
  const group =
    resolved.kind === 'dict'
      ? await editor.resolve(resolved.entries.get(category) ?? COS_NULL)
      : COS_NULL;
  const taken = group.kind === 'dict' ? group.entries : new Map<string, CosObject>();
  for (let i = 0; ; i += 1) {
    const candidate = `${prefix}${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}
