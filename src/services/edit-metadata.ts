/**
 * `set_metadata` — Phase 3（pdf-lib 撤去）の L4′.2 で新経路へ移した 3 本目のツール。
 *
 * 旧実装（`editor.ts` の `setMetadata`）との違い:
 * - Info への書き込みが `setInfoEntries` の 1 か所に寄る（`/Info` が間接参照か直接かの
 *   分岐が 1 つだけになる）
 * - dirty 参照の申告が要らない。旧は同期した `/Metadata` の ref と catalog の
 *   `/Root` を手で積んでいたが、`editor.set` を通ったものがそのまま書く集合になる
 * - `reserveExistingObjectNumbers` が要らない（`allocate` が定義の無い番号まで走査する）
 *
 * 🔴 **意図して変えた 1 点: 文字列の符号化。** 旧実装は pdf-lib の
 * `PDFHexString.fromText` で**常に** UTF-16BE の 16 進文字列を書いていた。
 * ここは `cos.ts` の `textString` を使うので、**ASCII の題名はリテラル文字列**になる
 * （§7.9.2.2 はどちらも許す）。しおり（§3.15.4）と同じ差である。
 * 日本語は旧実装と同じく UTF-16BE（BOM 付き）になる。
 */

import type { EditResult, SetMetadataArgs } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { textString } from './cos.js';
import { assertDocMdpAllows } from './doc-mdp.js';
import { openForEdit } from './edit-open.js';
import { appendOpened } from './incremental-append.js';
import { setInfoEntries } from './info-dict.js';
import { saveOpened } from './output-edited.js';
import { syncXmpWithInfo } from './xmp-cos.js';

export async function setMetadata(args: SetMetadataArgs): Promise<EditResult> {
  const opened = await openForEdit(args.inputPath, args);
  const preserve = args.preserveSignatures === true;
  if (preserve) {
    // §12.8.2.2 Table 257: 文書情報の変更は P=2 でも許される範囲だが、
    // P=1（一切の変更を認めない）では断る
    await assertDocMdpAllows(opened.editor, 'metadata-or-outline');
  }

  await setInfoEntries(opened.editor, [
    ['Title', args.title === undefined ? undefined : textString(args.title)],
    ['Author', args.author === undefined ? undefined : textString(args.author)],
    ['Subject', args.subject === undefined ? undefined : textString(args.subject)],
    // 旧実装（pdf-lib の `setKeywords`）と同じく空白 1 つで繋ぐ
    ['Keywords', args.keywords === undefined ? undefined : textString(args.keywords.join(' '))],
    ['Creator', args.creator === undefined ? undefined : textString(args.creator)],
  ]);

  // B-9: XMP を持つ文書では Info と `/Metadata` を同期させる（§14.3.3）
  const sync = await syncXmpWithInfo(opened.editor);
  const warnings = [...sync.warnings];
  if (sync.updated) {
    warnings.push(
      'The document carries XMP metadata (/Metadata); it was regenerated to stay ' +
        'consistent with the updated Info dictionary (dc:title etc.).',
    );
  }

  const result = preserve ? await appendOpened(opened, args) : await saveOpened(opened, args);
  if (warnings.length > 0) result.warnings = [...(result.warnings ?? []), ...warnings];
  if (preserve) {
    logger.info(
      'Editor',
      `Updated metadata via incremental update (+${result.bytes - opened.bytes.length} bytes); ` +
        'signatures preserved',
    );
  }
  return result;
}
