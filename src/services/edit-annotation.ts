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

import { PdfWriterError } from '../errors.js';
import type { AddAnnotationArgs, EditResult } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { addAnnotationDict } from './annotation-cos.js';
import { assertDocMdpAllows } from './doc-mdp.js';
import { openForEdit } from './edit-open.js';
import { appendOpened } from './incremental-append.js';
import { saveOpened } from './output-edited.js';
import { readXmpDeclarations } from './pdfa-cos.js';
import { appendAnnotationToStructTree, defaultNamespaceNote } from './struct-annot.js';

export async function addAnnotation(args: AddAnnotationArgs): Promise<EditResult> {
  const opened = await openForEdit(args.inputPath, args);
  const preserve = args.preserveSignatures === true;
  if (preserve) {
    await assertDocMdpAllows(opened.editor, 'annotation');
  }

  // SPEC-WRITER-PDFUA2-007（#31）: PDF/UA-2 では注釈の代替記述は /Contents で書き（ISO 14289-2
  // §8.9.4.1）、/Contents と直接囲む構造要素の /Alt は同じ値でなければならない（§8.9.4.2）。
  // 0.28.0 までは alt だけを渡すと /Contents が空文字になり、8.9.4.2-1 で落ちていた
  const ua2 = (await readXmpDeclarations(opened.editor)).pdfuaPart === 2;
  const alt = args.alt !== undefined && args.alt !== '' ? args.alt : undefined;
  if (ua2 && alt !== undefined && args.contents !== undefined && args.contents !== alt) {
    throw new PdfWriterError(
      "The document declares PDF/UA-2, where an annotation's Contents and the Alt of the structure " +
        'element enclosing it shall be identical (ISO 14289-2 §8.9.4.2). "contents" and "alt" differ.',
      'INVALID_ARGUMENT',
      {
        hint: 'Pass only "alt" (it is also written as Contents), or pass the same text in both.',
        next_actions: [
          {
            action: 'retry_with_alt_as_contents',
            reason:
              'In PDF/UA-2 the alternative description of an annotation is its Contents (§8.9.4.1); one text serves both.',
            example: { contents: alt, alt },
          },
        ],
      },
    );
  }
  const added = await addAnnotationDict(
    opened.editor,
    ua2 && alt !== undefined && args.contents === undefined ? { ...args, contents: alt } : args,
  );

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

  if (linked.tagged && ua2) {
    warnings.push(defaultNamespaceNote(['Annot']));
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
