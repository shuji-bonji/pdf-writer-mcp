/**
 * `add_bookmarks` — Phase 3（pdf-lib 撤去）の L4′.2 で新経路へ移した 2 本目のツール。
 *
 * **これが最初に「1 つのツールが両方の出口を新経路で使う」形**である:
 * 通常は `saveOpened`（全書き直し）、`preserveSignatures` では
 * `appendOpened`（増分更新・§7.5.6）へ行く。
 *
 * 🔴 **`assertDocMdpAllows` を先に呼ぶ。** 出口（`incremental-append.ts`）は
 * 追記するだけで許可レベルを見ない。認証署名（DocMDP・§12.8.2.2）が
 * しおりの変更を許していない文書では、増分更新でも「許されない変更」として
 * 扱われるので、**書く前に断る**。
 *
 * 旧実装（`editor.ts` の `addBookmarks`）との違い:
 * - dirty 参照の申告が要らない。旧は catalog の `/Root` を手で `dirty` に積んでいたが、
 *   `setBookmarks` が `editor.set` を通るので、触ったものがそのまま書く集合になる
 * - `reserveExistingObjectNumbers` が要らない。`PdfDocumentEditor.allocate` が
 *   定義の無い番号まで走査して配る
 */

import { LIMITS } from '../constants.js';
import { invalidArg } from '../errors.js';
import type { AddBookmarksArgs, EditResult } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { assertDocMdpAllows } from './doc-mdp.js';
import { openForEdit } from './edit-open.js';
import { appendOpened } from './incremental-append.js';
import { countBookmarks, setBookmarks } from './outline.js';
import { saveOpened } from './output-edited.js';
import { readXmpDeclarations } from './pdfa-cos.js';

/**
 * PDF/UA-2 の入力に足したしおりが測ると落ちることの名指し（#26）。
 * ISO 14289-2 §8.8 は文書内を指す行き先を structure destination（ISO 32000-2 §12.3.2.3 の /SD）に
 * することを求める。setBookmarks はページの行き先（/Dest）しか書かない。
 * 実測（veraPDF 1.30.0、2026-11-09）: ISO 14289-2:2024 8.8-1 で 1 件落ちる。
 */
const PDFUA2_OUTLINE_WARNING =
  'The input declares PDF/UA-2, which requires destinations inside the document to be structure ' +
  'destinations (ISO 14289-2, 8.8). add_bookmarks writes page destinations only, so the file will NOT ' +
  'pass PDF/UA-2 validation (rule 8.8-1) after this edit. The bookmarks themselves work in viewers.';

export async function addBookmarks(args: AddBookmarksArgs): Promise<EditResult> {
  const total = countBookmarks(args.bookmarks);
  if (total > LIMITS.BOOKMARK_MAX_TOTAL) {
    throw invalidArg(`too many bookmarks (${total}, max ${LIMITS.BOOKMARK_MAX_TOTAL})`);
  }

  const opened = await openForEdit(args.inputPath, args);
  const preserve = args.preserveSignatures === true;
  if (preserve) {
    // §12.8.2.2: しおりは「許される変更の種類」に入っていない
    await assertDocMdpAllows(opened.editor, 'metadata-or-outline');
  }

  const declaresUa2 = (await readXmpDeclarations(opened.editor)).pdfuaPart === 2;
  const added = await setBookmarks(opened.editor, args.bookmarks);
  logger.info('Editor', `Set ${added} bookmark(s)`);

  let result: EditResult;
  if (preserve) {
    result = await appendOpened(opened, args);
    logger.info(
      'Editor',
      `Set ${added} bookmark(s) via incremental update (+${result.bytes - opened.bytes.length} bytes); ` +
        'signatures preserved',
    );
  } else {
    result = await saveOpened(opened, args);
  }
  if (!declaresUa2) return result;
  return { ...result, warnings: [...(result.warnings ?? []), PDFUA2_OUTLINE_WARNING] };
}
