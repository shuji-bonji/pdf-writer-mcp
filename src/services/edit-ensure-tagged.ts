/**
 * `ensure_tagged` — Phase 3（pdf-lib 撤去）の L4′.2 で新経路へ移した 4 本目のツール。
 *
 * 中身は `tagged-cos.ts`。ここは入口・許可の判定・出口の 3 つだけを持つ。
 *
 * 🔴 **`assertDocMdpAllows(…, 'structure')` を書く前に呼ぶ。** 構造木の新設は
 * §12.8.2.2 Table 257 の「許される変更」に入らないので、認証署名のある文書では断る。
 *
 * 旧実装（`editor.ts` の `ensureTagged`）との違い:
 * - dirty 参照の申告が要らない。旧は catalog・各ページ・`/Metadata` の ref を手で
 *   積んでいた（`outcome.dirtiedRefs`）。`editor.set` を通ったものがそのまま書く集合になる
 * - `reserveExistingObjectNumbers` が要らない
 */

import type { EditResult, EnsureTaggedArgs, EnsureTaggedResult } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { assertDocMdpAllows } from './doc-mdp.js';
import { openForEdit } from './edit-open.js';
import { appendOpened } from './incremental-append.js';
import { saveOpened } from './output-edited.js';
import { ensureTaggedStructure } from './tagged-cos.js';

export async function ensureTagged(args: EnsureTaggedArgs): Promise<EnsureTaggedResult> {
  const opened = await openForEdit(args.inputPath, args);
  const preserve = args.preserveSignatures === true;
  if (preserve) {
    await assertDocMdpAllows(opened.editor, 'structure');
  }

  const outcome = await ensureTaggedStructure(opened.editor, {
    ...(args.title !== undefined ? { title: args.title } : {}),
    ...(args.lang !== undefined ? { lang: args.lang } : {}),
  });
  logger.info(
    'Editor',
    outcome.createdStructure
      ? `Created a minimal structure tree (${outcome.wrappedPages} page(s) wrapped in P)`
      : `Repaired document-level PDF/UA requirements (${outcome.addedRequirements.length} item(s))`,
  );

  const saved: EditResult = preserve
    ? await appendOpened(opened, args)
    : await saveOpened(opened, args);

  const warnings = [...(saved.warnings ?? []), ...outcome.warnings];
  return {
    ...saved,
    wasTagged: outcome.wasTagged,
    createdStructure: outcome.createdStructure,
    wrappedPages: outcome.wrappedPages,
    addedRequirements: outcome.addedRequirements,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}
