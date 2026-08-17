/**
 * `/Info`（§14.3.3 Table 349）へ項目を書く 1 か所 —— Phase 3 の L4′.2。
 *
 * `/Info` はトレーラの項目で、**間接参照でも直接オブジェクトでもよい**（§7.5.5）。
 * どちらの形かで書き方が変わるので、その分岐をここに 1 つだけ置く。
 * 分岐が複数箇所にあると、片方だけ直した状態が生まれる。
 */

import { type CosDict, type CosObject, dictGetRaw, type PdfDocumentEditor } from 'normativepdf';
import { dict } from './cos.js';

/**
 * `/Info` の項目を上書きする（既存の他の項目は残す）。
 *
 * 値が `undefined` の鍵は触らない —— 「指定しなかった」と「空にした」を区別する。
 * `/Info` がトレーラに無ければ作る。
 */
export async function setInfoEntries(
  editor: PdfDocumentEditor,
  values: Iterable<readonly [string, CosObject | undefined]>,
): Promise<void> {
  const updates = [...values].filter(
    (entry): entry is readonly [string, CosObject] => entry[1] !== undefined,
  );
  if (updates.length === 0) return;

  const raw = dictGetRaw(editor.trailer(), 'Info');

  if (raw === undefined || raw.kind === 'null') {
    const ref = await editor.allocate(dict(updates));
    editor.setTrailerEntry('Info', ref);
    return;
  }

  const resolved = await editor.resolve(raw);
  const entries = new Map<string, CosObject>(
    resolved.kind === 'dict' ? (resolved as CosDict).entries : [],
  );
  for (const [key, value] of updates) entries.set(key, value);
  const updated: CosDict = { kind: 'dict', entries };

  if (raw.kind === 'ref') {
    editor.set(raw.objectNumber, updated, raw.generationNumber);
  } else {
    editor.setTrailerEntry('Info', updated);
  }
}
