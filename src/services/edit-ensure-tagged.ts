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

  // SPEC-WRITER-ENSURE-TAGGED-003（#17・#26）: 名乗る PDF/UA の part は入力の版で決める。
  // PDF/UA-1 は ISO 14289-1 §6.1 で版を 1.0〜1.7、PDF/UA-2 は ISO 14289-2 §6.1 で 2.0 とする。
  // 版は catalog の /Version を含めて見る（ISO 32000-1 §7.7.2 Table 28・ISO 32000-2 Table 29。
  // ヘッダーより後の版を指せる）。版は変えない（2.0 の機能を使っているかを判定しないため）。
  // 0.26.x までは 2.0 の入力を INVALID_ARGUMENT で断っていた
  const version = opened.editor.base.version;
  const uaPart: 1 | 2 = Number.parseFloat(version) >= 2 ? 2 : 1;

  const preserve = args.preserveSignatures === true;
  if (preserve) {
    await assertDocMdpAllows(opened.editor, 'structure');
  }

  const outcome = await ensureTaggedStructure(opened.editor, {
    ...(args.title !== undefined ? { title: args.title } : {}),
    ...(args.lang !== undefined ? { lang: args.lang } : {}),
    uaPart,
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

  // 宣言ツールは適合を測らない。ensure_pdfa と同型の CLAIMS … NOT checked を
  // 応答に残す（Grok 実機 UC04 / stack #39）。
  const claim = uaPart === 2 ? 'PDF/UA-2 (pdfuaid:part=2, rev=2024)' : 'PDF/UA-1 (pdfuaid:part=1)';
  const claimsWarning =
    `This file now CLAIMS ${claim}, but conformance was NOT ` +
    'checked here. Only document-level tagging requirements were supplied; reading order, ' +
    'alternative text, and similar PDF/UA rules are left as they are. ' +
    'If the document does not actually conform, that claim is now false. ' +
    `Verify before relying on it: pdf-verify-mcp validate_conformance(flavour: "${uaPart === 2 ? 'pdfua-2' : 'pdfua-1'}").`;

  const warnings = [...(saved.warnings ?? []), ...outcome.warnings, claimsWarning];
  return {
    ...saved,
    wasTagged: outcome.wasTagged,
    createdStructure: outcome.createdStructure,
    wrappedPages: outcome.wrappedPages,
    addedRequirements: outcome.addedRequirements,
    replacedRequirements: outcome.replacedRequirements,
    requirementsChanged:
      outcome.createdStructure ||
      outcome.addedRequirements.length > 0 ||
      outcome.replacedRequirements.length > 0,
    warnings,
  };
}
