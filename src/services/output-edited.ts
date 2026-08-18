/**
 * 編集パスの出口 — Phase 3（pdf-lib 撤去）の L4′.1。
 *
 * `output.ts` の `saveEdited` に対応する。分けたのは入口と同じ理由で、**受け取る器が違う**
 * から（pdf-lib の `PDFDocument` ではなく normativepdf の `PdfDocumentEditor`）。
 * 2 本が 1 本に戻るのは L4′.7。
 *
 * **`normalizeEmbeddedFonts` は要らない。** 旧出口は保存の直前に
 * 「pdf-lib が書いたフォント辞書の是正」（B-14 / W-2 / W-3 / W-4）を必ず走らせていた。
 * 新しい経路でフォントを埋め込むのは `buildType0Font` で、これは**バイト列から辞書の型を
 * 導く**ので、是正すべき誤りが作れない（`output-created.ts` の同じ判断と揃える）。
 *
 * 🔴 **回復読みで開いた文書は断る。** `edit-open.ts` が `startxref` を走査して組み直した
 * xref は推量なので（重ねる順は鎖の順ではなくオフセットの順）、**全書き直しはその推量を
 * 出力に焼き付ける**。元のバイト列を残す増分更新でしか書けない。
 * normativepdf 側も同じ理由で `save()` を `TruncatedHistoryError` で断るので、
 * ここでの拒否は writer の言葉で理由を返すためのものである。
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { PageTreeError, type PdfDocumentEditor, type WriteFileOptions } from 'normativepdf';
import { documentDate } from '../config.js';
import { PdfWriterError } from '../errors.js';
import type { CommonEditOptions, EditResult } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { textString } from './cos.js';
import type { OpenedForEdit } from './edit-open.js';
import { setInfoEntries } from './info-dict.js';
import { pdfDate } from './pdf-date.js';

export interface SaveOpenedExtras {
  /**
   * `save()` の直前に走るフック。**ModDate の更新より後でなければ意味が無い処理**を
   * ここに置く（旧出口の `SaveEditedExtras.beforeSave` と同じ役割）。
   */
  readonly beforeSave?: (editor: PdfDocumentEditor) => void | Promise<void>;
  /** `writeFile` に渡す指示（版・xref の形式・オブジェクトストリーム） */
  readonly write?: WriteFileOptions;
}

/**
 * `/Info` の `/ModDate` を今の時刻にする（§14.3.3 Table 349）。
 *
 * `/Info` がトレーラに無ければ作る。間接参照ならその番号を差し替え、
 * 直接オブジェクトならトレーラの項目ごと差し替える —— どちらの形も §7.5.5 は許している。
 */
export async function touchModDate(editor: PdfDocumentEditor, when: Date): Promise<void> {
  await setInfoEntries(editor, [['ModDate', textString(pdfDate(when))]]);
}

/**
 * 編集済み文書を全書き直しで保存する。
 *
 * 出力の規約（`outputPath` / `returnBase64` / `EditResult` の形）は旧出口と同じ。
 */
export async function saveOpened(
  opened: OpenedForEdit,
  opts: CommonEditOptions,
  extras: SaveOpenedExtras = {},
): Promise<EditResult> {
  if (opened.xref.kind === 'recovered') {
    throw new PdfWriterError(
      `"${opened.absPath}" was opened by recovering a broken /Prev chain (${opened.xref.stop}), ` +
        'so the order of its cross-reference sections is a guess. ' +
        'Rewriting the whole file would bake that guess in and drop whatever the scan missed.',
      'INVALID_PDF',
      {
        hint: 'Use the incremental path (preserveSignatures), which leaves the original bytes in place.',
      },
    );
  }

  const { editor } = opened;

  // 🔴 読めないオブジェクトに当たると normativepdf は自分の例外を投げる。素通しすると
  // writer のエラー体系（コードと next_actions）の外に出るので、書き出しまでを包む。
  // 実測: コーパス 2,917 本のうち 6 本がこの経路（`stream` の後の EOL が無い /
  // `endstream` が来ない = §7.3.8.1 の壊れ方）。**落ちる場所は `save()` とは限らない** ——
  // `/Info` を読む段（`touchModDate`）で落ちる検体のほうが多かった。
  let bytes: Uint8Array;
  try {
    await touchModDate(editor, documentDate(editor));
    await extras.beforeSave?.(editor);
    // 既定は**入力が使っていた形**。全書き直しは中身を変えない操作なので、
    // 相互参照の形も変えない（`edit-open.ts` の `SourceForm`）
    bytes = await editor.save({
      xref: opened.form.xref,
      objectStreams: opened.form.objectStreams,
      ...extras.write,
    });
  } catch (e) {
    if (e instanceof PdfWriterError) throw e;
    const cause = e instanceof Error ? e.message : String(e);
    // 🔴 落ちる理由は 2 通りあり、次にすることが違う。同じ hint を返すと読む側が迷う
    //   ページツリーが §7.7.3 に反する → 直せる（欠けている項目を足す）
    //   オブジェクトが読めない       → 直せない（元のファイルが壊れている）
    const brokenTree = e instanceof PageTreeError;
    throw new PdfWriterError(`Failed to write "${opened.absPath}": ${cause}`, 'INVALID_PDF', {
      hint: brokenTree
        ? 'The page tree does not satisfy ISO 32000-2 §7.7.3; the missing entries have to be supplied before writing.'
        : 'An object in the source file could not be read back, so the file cannot be rewritten.',
    });
  }
  return saveRawBytes(bytes, (await editor.pages()).length, opts);
}

/**
 * 出来上がったバイト列をファイルへ／base64 へ。
 *
 * 出口が 3 本（全書き直し・増分更新・ページ操作）あって、`outputPath` と
 * `returnBase64` の扱いは共通なので 1 か所に置く。旧 `output.ts` から移した。
 */
export async function saveRawBytes(
  bytes: Uint8Array,
  pageCount: number,
  opts: CommonEditOptions,
): Promise<EditResult> {
  const result: EditResult = { pageCount, bytes: bytes.length };

  if (opts.outputPath) {
    const abs = resolve(opts.outputPath);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, bytes);
    result.path = abs;
    logger.info('Output', `Saved PDF: ${abs} (${bytes.length} bytes, ${pageCount} pages)`);
  }

  if (opts.returnBase64 || !opts.outputPath) {
    result.base64 = Buffer.from(bytes).toString('base64');
  }

  return result;
}
