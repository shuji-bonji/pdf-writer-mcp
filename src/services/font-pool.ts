/**
 * 開いた文書へフォントを埋め込むための「番号の池」—— Phase 3 の L4′.2。
 *
 * 🔴 **なぜ池が要るのか。** `font-embed.ts` は番号を**同期**に配れる相手を求める
 * （`FontHost`）。生成パスの `WriterDocument` は自前の採番器を持つのでそのまま満たすが、
 * 開いた文書ではそれができない —— `writer-doc.ts` が書いているとおり、
 * **2 つの採番器が同じ文書に対して動くと、どちらも相手の配った番号を知らないまま
 * 重複を配る**。`PdfDocumentEditor.allocate` は非同期（初回に全参照を走査して、
 * 定義の無い番号を配らないようにする）なので、同期の口には直接繋げない。
 *
 * だから **先に必要な数だけ番号を採ってから**、同期の口にはその池から配らせる。
 * 採番器は最後まで `editor.allocate` 1 つだけである。
 *
 * **必要な数は数えられる**（2026-08-15 実測）:
 *
 * | 埋め込み方 | 使う番号 | 内訳 |
 * |---|---|---|
 * | 埋め込みフォント | **5** | `buildType0Font` が 4（FontFile / FontDescriptor / CIDFont / Type0）+ ToUnicode 1 |
 * | 標準 14 書体（§9.6.2.2） | **1** | フォント辞書だけ |
 *
 * 池が尽きたら**その場で落とす**。黙って `editor.allocate` に戻ると同期・非同期が
 * 混ざり、上の重複がまさに起きる。
 */

import { COS_NULL, type CosObject, type CosRef, type PdfDocumentEditor } from 'normativepdf';
import { PdfWriterError } from '../errors.js';
import type { FontHost } from './font-embed.js';

/** 埋め込みフォント 1 本が使う番号の数（実測・上表） */
export const EMBEDDED_FONT_OBJECTS = 5;
/** 標準 14 書体 1 本が使う番号の数 */
export const STANDARD_FONT_OBJECTS = 1;

export interface PooledFontHost extends FontHost {
  /** 実際に配った番号（呼び出し側が dirty を知る必要は無いが、判定で数えられるように） */
  readonly used: readonly CosRef[];
}

/**
 * 番号を `count` 個だけ先に確保し、同期に配る口を返す。
 *
 * 確保した番号にはいったん null を入れておく（`allocate` の走査に載せるため）。
 * 中身は配るときに `set` で入れる。
 */
export async function fontHostFor(
  editor: PdfDocumentEditor,
  count: number,
): Promise<PooledFontHost> {
  const pool: CosRef[] = [];
  for (let i = 0; i < count; i += 1) pool.push(await editor.allocate(COS_NULL));

  const used: CosRef[] = [];
  let next = 0;
  return {
    used,
    allocate(object: CosObject): CosRef {
      const ref = pool[next];
      if (ref === undefined) {
        throw new PdfWriterError(
          `the font needed more than ${count} object number(s); the pool is empty. ` +
            'Falling back to the editor here would mix a synchronous and an asynchronous ' +
            'allocator on one document, which hands out duplicate numbers.',
          'INTERNAL_ERROR',
        );
      }
      next += 1;
      editor.set(ref.objectNumber, object, ref.generationNumber);
      used.push(ref);
      return ref;
    },
  };
}
