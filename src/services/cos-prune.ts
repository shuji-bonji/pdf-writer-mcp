/**
 * 消したオブジェクトへの参照を取り除く —— Phase 3 の L4′.2（`flatten_form` の後始末）。
 *
 * 参照を外してからオブジェクトを消しても、**そのオブジェクトを指す別の参照が
 * どこかに残っていることがある**。入力に元から孤児が居て、それが消す相手を
 * 指している場合である（`form-basic.pdf` は `/T user` の辞書を 2 つ持ち、
 * `/AcroForm /Fields` に載っているのは片方だけ）。
 *
 * 宙吊りの参照は §7.3.10 により null オブジェクトとして読まれるので、
 * 意味は持たない。ただし読み手によっては診断を出す（poppler の
 * `Invalid XRef entry`）ので、取り除く。
 *
 * 🔴 **消す相手を限る。** 「解決できない参照をすべて消す」形にすると、入力が
 * 元から持っていた壊れ方まで黙って直してしまう。この操作で**自分が消した番号**
 * だけを対象にする。
 */

import type { CosObject, CosRef, PdfDocumentEditor } from 'normativepdf';

const refKey = (ref: { objectNumber: number; generationNumber: number }): string =>
  `${ref.objectNumber} ${ref.generationNumber}`;

/**
 * `doomed` に挙げた番号への参照を、文書中のすべてのオブジェクトから取り除く。
 *
 * 配列からは要素を落とし、辞書からは鍵ごと落とす（旧実装と同じ扱い）。
 * 戻り値は取り除いた参照の数。
 */
export async function pruneRefsTo(
  editor: PdfDocumentEditor,
  doomed: Iterable<CosRef>,
): Promise<number> {
  const gone = new Set<number>();
  for (const ref of doomed) gone.add(ref.objectNumber);
  if (gone.size === 0) return 0;

  const isDangling = (value: CosObject): boolean =>
    value.kind === 'ref' && gone.has(value.objectNumber);

  let removed = 0;

  /** 値を辿って、宙吊りの参照を落とした値を返す。変わらなければ null */
  const rewrite = (value: CosObject): CosObject | null => {
    if (value.kind === 'array') {
      const kept: CosObject[] = [];
      let changed = false;
      for (const item of value.items) {
        if (isDangling(item)) {
          removed += 1;
          changed = true;
          continue;
        }
        const next = rewrite(item);
        if (next === null) kept.push(item);
        else {
          kept.push(next);
          changed = true;
        }
      }
      return changed ? { kind: 'array', items: kept } : null;
    }
    if (value.kind === 'dict') {
      const entries = new Map<string, CosObject>();
      let changed = false;
      for (const [key, item] of value.entries) {
        if (isDangling(item)) {
          removed += 1;
          changed = true;
          continue;
        }
        const next = rewrite(item);
        entries.set(key, next ?? item);
        if (next !== null) changed = true;
      }
      return changed ? { kind: 'dict', entries } : null;
    }
    if (value.kind === 'stream') {
      const next = rewrite(value.dict);
      if (next === null || next.kind !== 'dict') return null;
      return { kind: 'stream', dict: next, raw: value.raw };
    }
    return null;
  };

  const deleted = new Set(editor.deleted().map(refKey));
  for (const [objectNumber, entry] of editor.base.xref) {
    // §7.5.8.3: オブジェクトストリームの中身（type 2）も対象。生成番号は 0
    if (objectNumber === 0 || (entry.type !== 'in-use' && entry.type !== 'compressed')) continue;
    if (gone.has(objectNumber)) continue;
    const generation = entry.type === 'in-use' ? entry.generation : 0;
    if (deleted.has(`${objectNumber} ${generation}`)) continue;
    const object = await editor.get(objectNumber, generation);
    if (object.kind === 'null') continue;
    const next = rewrite(object);
    if (next !== null) editor.set(objectNumber, next, generation);
  }
  // この実行で新しく書いたオブジェクトも見る（外観をページ資源へ移した後など）
  for (const { objectNumber, generationNumber, object } of editor.changed()) {
    if (gone.has(objectNumber)) continue;
    const next = rewrite(object);
    if (next !== null) editor.set(objectNumber, next, generationNumber);
  }
  return removed;
}
