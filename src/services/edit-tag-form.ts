/**
 * `tag_form_fields` —— Phase 3 の L4′.2（15 本目）。
 *
 * **なぜ要るか（B-6）**: `fill_form` は「入力が準拠していれば出力も準拠」（構造木に
 * 触らない）だが、タグ付き PDF に AcroForm が**あるだけ**では PDF/UA-1 に通らない。
 * 本ツールが 7.18.4-1（Widget を `Form` 構造要素に内包）/ 7.18.3-1（`/Tabs /S`）/
 * 7.18.1-3（フィールドに `/TU`）を後付けで満たす。
 *
 * タグ無し文書は対象外 —— フォームのためだけに構造木を作り始めない。
 * ゼロからのタグ付けは create 系の `tagged: true`、既存文書の完全なタグ付けは
 * Tier C の `ensure_tagged` の領分である。
 *
 * 🔴 **DocMDP は `'structure'`。** 構造タグ付けは §12.8.2.2 Table 257 の許可種別に
 * 無いので、認証署名のある文書では**どの許可レベルでも断る**。
 *
 * 旧実装（`editor.ts` の `tagFormFields`）との違い:
 * - dirty 参照の申告が要らない。旧は「触った既存オブジェクト」を手で積んでいた
 * - `reserveExistingObjectNumbers` が要らない
 * - `/ModDate` は `saveOpened` / `appendOpened` が更新する
 */

import { PdfWriterError, invalidArg } from '../errors.js';
import type { TagFormFieldsArgs, TagFormFieldsResult } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { listFields, readAcroForm, usesXfa } from './acroform-read.js';
import { tagWidgets } from './acroform-tag.js';
import { assertDocMdpAllows } from './doc-mdp.js';
import { openForEdit } from './edit-open.js';
import { appendOpened } from './incremental-append.js';
import { saveOpened } from './output-edited.js';
import { isTaggedDoc } from './tagged-cos.js';

export async function tagFormFields(args: TagFormFieldsArgs): Promise<TagFormFieldsResult> {
  const opened = await openForEdit(args.inputPath, args);
  const preserve = args.preserveSignatures === true;

  if (!(await isTaggedDoc(opened.editor))) {
    throw new PdfWriterError(
      `"${args.inputPath}" is not a tagged PDF, so there is no structure tree to repair. ` +
        'tag_form_fields fixes forms inside already-tagged PDFs (PDF/UA-1 7.18.4).',
      'INVALID_ARGUMENT',
      {
        hint:
          'To produce a tagged PDF from scratch, use the create tools with "tagged": true. ' +
          'Full tagging of an existing untagged PDF (ensure_tagged) is a future Tier C feature.',
      },
    );
  }

  const form = await readAcroForm(opened.editor);
  if (form !== null && usesXfa(form)) {
    throw new PdfWriterError(
      'This PDF uses XFA forms, which pdf-writer-mcp does not support.',
      'UNSUPPORTED_PDF_FEATURE',
    );
  }
  if (form === null || form.fields.length === 0) {
    throw invalidArg(`"${args.inputPath}" has no AcroForm fields to tag.`);
  }

  if (preserve) {
    // 構造タグ付けは DocMDP の許可種別に含まれない（認証文書は全レベルで拒否）
    await assertDocMdpAllows(opened.editor, 'structure');
  }

  const outcome = await tagWidgets(opened, form, args.labels ?? {});

  const warnings: string[] = [];
  if (outcome.unlabeled.length > 0) {
    warnings.push(
      `No label given for ${outcome.unlabeled.length} field(s); the field name was used as /TU ` +
        `(${outcome.unlabeled.join(', ')}). Pass "labels" with human-readable names — ` +
        'screen readers announce /TU, and "user.name" reads poorly.',
    );
  }
  if (outcome.orphaned.length > 0) {
    warnings.push(
      `${outcome.orphaned.length} widget(s) were not found in any page's /Annots and were left ` +
        `untouched (${outcome.orphaned.join(', ')}).`,
    );
  }

  logger.info(
    'Editor',
    `Tagged ${outcome.tagged} widget(s) into Form structure elements` +
      (outcome.skipped > 0 ? `, ${outcome.skipped} already tagged` : ''),
  );

  const saved = preserve ? await appendOpened(opened, args) : await saveOpened(opened, args);
  const all = [...(saved.warnings ?? []), ...warnings];
  return {
    ...saved,
    taggedWidgets: outcome.tagged,
    skippedWidgets: outcome.skipped,
    fields: await listFields(opened.editor),
    warnings: all.length > 0 ? all : undefined,
  };
}
