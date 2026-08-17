/**
 * フォント辞書を**読む**だけの関数 —— Phase 3 の L4′.2。
 *
 * `font-conformance.ts`（pdf-lib・是正まで行う 500 行超）のうち、
 * `ensure_pdfa` が使う「埋め込まれていないフォントを数える」部分だけを COS の上に置いた。
 * 是正（B-14 / W-2 / W-3 / W-4）はまだ移していない —— `output-edited.ts` の
 * 「まだ無いもの」に書いたとおりである。
 *
 * | 要件 | 何を言っているか |
 * |---|---|
 * | Table 122 / R-9.8.1 | font program は FontDescriptor の `/FontFile` `/FontFile2` `/FontFile3` に置く |
 * | §9.7.4 | Type0 の子（CIDFont）が FontDescriptor を持つ |
 */

import { type CosDict, collectObjects, dictGet, type PdfDocumentEditor } from 'normativepdf';

const nameOf = (dict: CosDict, key: string): string | undefined => {
  const value = dictGet(dict, key);
  return value?.kind === 'name' ? value.value : undefined;
};

/**
 * 埋め込まれた font program を持たないフォントを列挙する（B-21 の危険表示に使う）。
 *
 * **数えるだけで、直さない。** PDF/A はすべてのフォントの埋め込みを求めるが、
 * `ensure_pdfa` は埋め込みをしない。ここで観測できる不適合を、宣言と一緒に返すためにある。
 *
 * 走査は**ファイルにあるオブジェクト全部**で、ページから辿らない。旧実装
 * （`doc.context.enumerateIndirectObjects()`）と同じ範囲にするためである。
 */
export async function findNonEmbeddedFonts(
  editor: PdfDocumentEditor,
): Promise<{ baseFont: string; subtype: string }[]> {
  const found: { baseFont: string; subtype: string }[] = [];
  const seen = new Set<string>();

  const hasProgram = async (holder: CosDict): Promise<boolean> => {
    const descriptorRef = dictGet(holder, 'FontDescriptor');
    if (descriptorRef === undefined) return false;
    const descriptor = await editor.resolve(descriptorRef);
    if (descriptor.kind !== 'dict') return false;
    return ['FontFile', 'FontFile2', 'FontFile3'].some(
      (key) => dictGet(descriptor, key) !== undefined,
    );
  };

  for (const { object } of await collectObjects(editor.base)) {
    if (object.kind !== 'dict') continue;
    if (nameOf(object, 'Type') !== 'Font') continue;

    const subtype = nameOf(object, 'Subtype') ?? '(none)';
    // Type3 は font program を持たない（グリフが内容ストリームで書かれる）
    if (subtype === 'Type3') continue;

    let holder: CosDict = object;
    if (subtype === 'Type0') {
      const descendants = await editor.resolve(
        dictGet(object, 'DescendantFonts') ?? { kind: 'null' },
      );
      if (descendants.kind !== 'array' || descendants.items.length === 0) continue;
      const cidFont = await editor.resolve(descendants.items[0] as never);
      if (cidFont.kind !== 'dict') continue;
      holder = cidFont;
    }

    if (await hasProgram(holder)) continue;

    const baseFont = nameOf(object, 'BaseFont') ?? '(no BaseFont)';
    const key = `${subtype}:${baseFont}`;
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({ baseFont, subtype });
  }
  return found;
}
