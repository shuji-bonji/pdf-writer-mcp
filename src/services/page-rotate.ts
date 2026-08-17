/**
 * ページの回転 — Phase 3（pdf-lib 撤去）の L4′.2 の 1 本目。
 *
 * **なぜこれが最初か。** §3.8 の段取りは「COS だけの葉 8 ファイル」を 1 段にしていたが、
 * その 8 つは **import の向きの葉**であって、**呼び出しの向きでは `editor.ts` /
 * `page-ops.ts` から呼ばれる**。ファイル単位で書き換えると呼び出し元が型で落ちるので、
 * 移す単位は**ツール 1 本**になる。数え直すと、17 あるツールのうち
 * **他の受け皿を 1 つも要らないのは `rotate_pages` だけ**だった:
 *
 * - `preserveSignatures` を持たない（`page-ops.ts` の 6 ツールはどれも持たない）ので、
 *   まだ移していない `incremental.ts` を呼ばない
 * - ページを複写しない（`/Rotate` を書き換えるだけ）ので、L4′.6 のグラフ複写も要らない
 * - 描画もフォントも構造木も触らない
 *
 * **旧実装との違いは 1 つだけ。** 継承の解決を `page.getRotation()`（pdf-lib）から
 * `PdfDocumentEditor.pageAttribute`（§7.7.3.4）に替えた。どちらも
 * 「ページ自身 → 祖先を `/Parent` で遡る」で、R-7.7.3.4-4 の「継承した値は
 * そのまま使い、混ぜない」も同じである。
 */

import { PdfWriterError } from '../errors.js';
import type { CommonEditOptions, EditResult } from '../types/index.js';
import { parsePageSpec } from '../utils/page-spec.js';
import { int } from './cos.js';
import { openForEdit } from './edit-open.js';
import { saveOpened } from './output-edited.js';
import { normalizeRotation } from './rotation.js';

/**
 * 対象ページの `/Rotate`（§7.7.3.3 Table 31）に `rotation` を足す。
 *
 * `pages` を省略すると全ページ。角度は 90 の倍数でなければならず
 * （R-7.7.3.3-28）、そこは `normalizeRotation` が検査する。
 */
export async function rotatePages(
  inputPath: string,
  rotation: number,
  pages: string | undefined,
  opts: CommonEditOptions,
): Promise<EditResult> {
  const opened = await openForEdit(inputPath, opts);
  const { editor } = opened;
  const entries = await editor.pages();

  const targets = pages
    ? parsePageSpec(pages, entries.length)
    : Array.from({ length: entries.length }, (_, i) => i + 1);

  for (const n of targets) {
    const page = entries[n - 1];
    if (page === undefined) continue;
    if (page.ref === null) {
      // 直接オブジェクトのページは差し替える住所が無い。コーパス 12,942 ページで
      // 0 件だが、0 件は「起きない」ではないので黙って飛ばさない
      throw new PdfWriterError(
        `Page ${n} of "${opened.absPath}" is a direct object in the page tree, so it has no ` +
          'object number to write back to.',
        'INVALID_PDF',
      );
    }

    // §7.7.3.4: 自分に無ければ祖先を遡る。無ければ 0（Table 31 の既定）
    const inherited = await editor.pageAttribute(n - 1, 'Rotate');
    const current = inherited?.kind === 'integer' ? inherited.value : 0;

    const updated = new Map(page.dict.entries);
    updated.set('Rotate', int(normalizeRotation(current + rotation)));
    editor.set(
      page.ref.objectNumber,
      { kind: 'dict', entries: updated },
      page.ref.generationNumber,
    );
  }

  return saveOpened(opened, opts);
}
