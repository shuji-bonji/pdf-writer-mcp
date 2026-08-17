/**
 * `attach_file` — Phase 3（pdf-lib 撤去）の L4′.2 で新経路へ移した 7 本目のツール。
 *
 * 🔴 **添付は DocMDP の許可種別に無い。** §12.8.2.2 Table 257 が挙げるのは
 * フォームの記入・注釈・署名で、ファイルの埋め込みは入っていない。だから
 * 認証署名のある文書では**どの許可レベルでも断る**（`'metadata-or-outline'` を渡すと
 * P=1 で断り、P=2 / P=3 では通ってしまうので、旧実装と同じ判定を保つ）。
 */

import type { AttachFileArgs, AttachResult, EditResult } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { attachFile, listEmbeddedFiles } from './attachment-cos.js';
import { assertDocMdpAllows } from './doc-mdp.js';
import { openForEdit } from './edit-open.js';
import { appendOpened } from './incremental-append.js';
import { saveOpened } from './output-edited.js';

export async function attachFileToPdf(args: AttachFileArgs): Promise<AttachResult> {
  const opened = await openForEdit(args.inputPath, args);
  const preserve = args.preserveSignatures === true;
  if (preserve) {
    await assertDocMdpAllows(opened.editor, 'metadata-or-outline');
  }

  const attached = await attachFile(opened.editor, {
    filePath: args.attachmentPath,
    ...(args.name !== undefined ? { name: args.name } : {}),
    ...(args.description !== undefined ? { description: args.description } : {}),
    ...(args.mimeType !== undefined ? { mimeType: args.mimeType } : {}),
    ...(args.relationship !== undefined ? { relationship: args.relationship } : {}),
  });

  const warnings: string[] = [];
  if (!args.relationship) {
    warnings.push(
      'No "relationship" given, so the attachment is marked Unspecified. ' +
        'PDF/A-3 requires a meaningful AFRelationship — use "Data" for machine-readable ' +
        'counterparts of the document (e.g. an invoice CSV/XML) or "Source" for the data it came from.',
    );
  }

  logger.info('Editor', `Attached ${attached.name} (${attached.bytes} bytes, ${attached.mimeType})`);

  // 保存の前に読む —— 出口は書くだけで、名前ツリーは既に editor の上にある
  const attachments = (await listEmbeddedFiles(opened.editor)).map((f) => f.name);

  const saved: EditResult = preserve
    ? await appendOpened(opened, args)
    : await saveOpened(opened, args);
  const all = [...(saved.warnings ?? []), ...warnings];
  return {
    ...saved,
    attachment: attached,
    attachments,
    ...(all.length > 0 ? { warnings: all } : {}),
  };
}
