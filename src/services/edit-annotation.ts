/**
 * `add_annotation` — Phase 3（pdf-lib 撤去）の L4′.2 で新経路へ移した 6 本目のツール。
 *
 * 🔴 **`assertDocMdpAllows(…, 'annotation')` を書く前に呼ぶ。** 注釈の追加が許されるのは
 * DocMDP P=3 のみ（承認署名なら制約なし・§12.8.2.2 Table 257）。
 *
 * 旧実装（`editor.ts` の `addAnnotation`）との違い:
 * - dirty 参照の申告が要らない。旧は `/Annots` の配列かページ辞書か、構造木の
 *   どの既存オブジェクトを触ったかを手で積んでいた
 * - `reserveExistingObjectNumbers` が要らない
 */

import type { AddAnnotationArgs, EditResult } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { addAnnotationDict } from './annotation-cos.js';
import { assertDocMdpAllows } from './doc-mdp.js';
import { openForEdit } from './edit-open.js';
import { appendOpened } from './incremental-append.js';
import { saveOpened } from './output-edited.js';
import { appendAnnotationToStructTree } from './struct-annot.js';

export async function addAnnotation(args: AddAnnotationArgs): Promise<EditResult> {
  const opened = await openForEdit(args.inputPath, args);
  const preserve = args.preserveSignatures === true;
  if (preserve) {
    await assertDocMdpAllows(opened.editor, 'annotation');
  }

  const added = await addAnnotationDict(opened.editor, args);

  // タグ付き PDF なら構造木にも結び付ける（PDF/UA 7.18.1-1 / 7.18.3-1）。
  // タグ無し文書では何もしない —— 注釈のためだけに構造木を作り始めない。
  const warnings: string[] = [];
  const linked = await appendAnnotationToStructTree(
    opened.editor,
    { ref: added.pageRef, dict: added.pageDict },
    added.ref,
    args.alt,
  );
  if (linked.tagged && !args.alt) {
    warnings.push(
      'The document is tagged and the annotation was nested in an Annot structure element. ' +
        'Pass "alt" to give assistive technology a description of it.',
    );
  }

  const result = preserve ? await appendOpened(opened, args) : await saveOpened(opened, args);
  if (warnings.length > 0) result.warnings = [...(result.warnings ?? []), ...warnings];
  logger.info(
    'Editor',
    `Added ${args.type} annotation to page ${args.page} (${added.count} on that page)` +
      (preserve ? '; signatures preserved' : ''),
  );
  return result;
}
