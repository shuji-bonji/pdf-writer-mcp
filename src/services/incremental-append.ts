/**
 * 編集パスの第 2 の出口（増分更新） — Phase 3（pdf-lib 撤去）の L4′.2 の 2 本目。
 *
 * `incremental.ts` の `buildIncrementalUpdate`（588 行のうち大半）に対応する。
 * **こちらは直列化も相互参照も書かない** —— それは `PdfDocumentEditor.appendUpdate`
 * （§7.5.6）が持っている。ここに残るのは **writer の方針**だけである（handoff §6）:
 *
 * - `/ID` の第 2 要素を更新する（§14.4）
 * - 出力の規約（`outputPath` / `returnBase64` / `EditResult`）を旧出口と揃える
 *
 * **書くオブジェクトの集合を呼び出し側が申告しない。** 旧実装は
 * 「`sinceObjectNumber` より大きい番号 + 呼び出し側が渡した `dirtyRefs`」を書いており、
 * 既存オブジェクトを変えたら申告が要った（`pageContentDirtyRefs` /
 * `catalogNamesDirtyRefs` の 69 行がその申告を組み立てていた）。
 * `PdfDocumentEditor` では変更が `set` / `allocate` / `delete` / `setTrailerEntry` しか
 * 通らないので、**触ったものがそのままオーバレイ = 書く集合**になる。
 * 申告漏れという欠陥クラスが表現不能になる。
 *
 * ⚠️ **DocMDP（§12.8.2.2）の判定はここに無い。** `findDocMdpPermission` は
 * まだ pdf-lib の文書を取る（`incremental.ts`）。最初の preserveSignatures 付きツールを
 * この出口へ寄せるときに COS 版へ移すこと —— 移し忘れると、認証署名の許可レベルを
 * 見ないまま追記する。
 *
 * ⚠️ **前方バイト同一性（ADR-0005）は測ってある**（handoff §3.13）:
 * 古典 xref テーブル / 相互参照ストリームの両方、および `origin > 0`（B-22 の回帰）で、
 * 出力の先頭 `original.length` バイトが入力と一致し、`/Prev` が旧 `startxref` を指し、
 * 新規オブジェクトが元 trailer の `/Size` 以上の番号を使うことを実測した。
 */

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  ByteWriter,
  type CosObject,
  dictGet,
  type PdfDocumentEditor,
  writeIndirectObject,
} from 'normativepdf';
import { documentDate } from '../config.js';
import { PdfWriterError } from '../errors.js';
import type { CommonEditOptions, EditResult } from '../types/index.js';
import { logger } from '../utils/logger.js';
import type { OpenedForEdit } from './edit-open.js';
import { touchModDate } from './output-edited.js';

/**
 * `/ID` の第 2 要素を更新する（§14.4）。
 *
 * R-14.4-11 は第 1 要素を「文書が作られたときのもの」として**保持**させ、
 * 第 2 要素は更新のたびに変えることを要求する。§14.4 の NOTE は
 * 「計算は再現可能である必要はない」と言っているので、旧実装と同じく
 * **元バイト列と、この更新が書くオブジェクト**から決める
 * （旧実装は追記済みのバイト列を混ぜていたが、追記の版付けは
 * `appendUpdate` が行うので、こちらは書く前に決まるものだけを混ぜる）。
 *
 * `/ID` を持たない文書には何もしない —— 無いものを足すのは §14.4 の要求ではなく、
 * `/ID` の有無そのものが `ensure_pdfa` の報告の根拠になっている。
 */
function updateFileId(editor: PdfDocumentEditor, original: Uint8Array): void {
  const id = dictGet(editor.trailer(), 'ID');
  if (id?.kind !== 'array' || id.items.length < 1) return;

  const digest = createHash('md5'); // §14.4 が例示するダイジェスト（暗号用途ではない）
  digest.update(original);
  for (const { objectNumber, generationNumber, object } of editor.changed()) {
    const out = new ByteWriter();
    writeIndirectObject(out, objectNumber, generationNumber, object);
    digest.update(out.toUint8Array());
  }
  // 🔴 ダイジェスト**そのもの**（16 バイト）を書く。16 進の文字列を
  // バイト列として書くと 32 バイトになり、`<…>` の中身が 64 桁に膨らむ
  // （2026-08-15 に `tests/incremental.test.ts` の §14.4 の判定が見つけた）
  const permanent = id.items[0] as CosObject;
  editor.setTrailerEntry('ID', {
    kind: 'array',
    items: [permanent, { kind: 'string', bytes: new Uint8Array(digest.digest()), form: 'hex' }],
  });
}

/**
 * 変更を増分更新として追記し、元のバイト列を残したまま保存する（§7.5.6）。
 *
 * 出力の規約は `saveOpened`（全書き直しの出口）と同じ。
 */
export async function appendOpened(
  opened: OpenedForEdit,
  opts: CommonEditOptions,
): Promise<EditResult> {
  const { editor } = opened;

  if (!editor.dirty) {
    throw new PdfWriterError(
      `Nothing changed in "${opened.absPath}", so there is no incremental update to append. ` +
        'ISO 32000-2 §7.5.6 describes a section that names the objects an update changed.',
      'INTERNAL_ERROR',
    );
  }

  // 出口 2 本で同じにする —— 旧経路も preserve 枝で `touchModificationDate` を呼んでいた。
  // **`/ID` より先**に打つ: `/ID` のダイジェストは「この更新が書くオブジェクト」から取るので、
  // `/Info` の変更が含まれていなければならない
  await touchModDate(editor, documentDate(editor));
  updateFileId(editor, opened.bytes);

  let bytes: Uint8Array;
  try {
    // 追記する節の形は**直前の節に合わせる**（`edit-open.ts` の `SourceForm`）
    const result = await editor.appendUpdate({ xref: opened.form.xref });
    bytes = result.bytes;
  } catch (e) {
    if (e instanceof PdfWriterError) throw e;
    const cause = e instanceof Error ? e.message : String(e);
    throw new PdfWriterError(
      `Failed to append an incremental update to "${opened.absPath}": ${cause}`,
      'INVALID_PDF',
    );
  }

  const pageCount = (await editor.pages()).length;
  const result: EditResult = { pageCount, bytes: bytes.length, incremental: true };

  if (opts.outputPath) {
    const abs = resolve(opts.outputPath);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, bytes);
    result.path = abs;
    logger.info(
      'Output',
      `Appended an incremental update: ${abs} (${bytes.length} bytes, ${pageCount} pages)`,
    );
  }

  if (opts.returnBase64 || !opts.outputPath) {
    result.base64 = Buffer.from(bytes).toString('base64');
  }

  return result;
}
