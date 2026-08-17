/**
 * DocMDP（認証署名の許可レベル） — Phase 3（pdf-lib 撤去）の L4′.2。
 *
 * `incremental.ts` の `findDocMdpPermission` と `editor.ts` の `assertDocMdpAllows` を
 * COS の上に置き直したもの。**判定そのものは writer の方針**（handoff §6）なので
 * normativepdf には持ち込まない —— ライブラリは「§12.8.2.2 が何と書いてあるか」を
 * 知る必要が無く、writer が「どの変更を断るか」を決める。
 *
 * 🔴 **これが無いまま増分更新を書くと、認証署名の許可レベルを見ないまま追記する。**
 * `incremental-append.ts` は出口であって判定を持たない。**呼ぶのは各ツールの責任**である。
 *
 * **DSS / DTS の例外について**（family 内で条文解釈を揃えるための注記・旧実装から引き継ぎ）:
 * §12.8.2.2 は P の全値に対して例外を置いている —— DSS（§12.8.4.3）と
 * 文書タイムスタンプ（§12.8.5）の追加に必要なデータ「のみ」を含む増分更新は、
 * 文書への変更とみなしてはならない（R-12.8.2.2.2-5）。P=1 の本文も
 * 「any changes shall invalidate the signature **with the exception of subsequent
 * DSS and/or document timestamp incremental updates**」と明示する（R-12.8.2.2.1-6）。
 * **writer は DSS も DTS も書かない**ので、ここで断る変更はいずれも例外に当たらない。
 * 将来 writer が DSS/DTS を扱うなら、この関数は「DSS/DTS のみの増分は常に許可」を
 * 先に判定する必要がある。
 */

import { dictGet, type PdfDocumentEditor } from 'normativepdf';
import { NEXT_ACTIONS, PdfWriterError } from '../errors.js';

/** 増分更新で加えようとしている変更の種類 */
export type DocMdpChange = 'annotation' | 'metadata-or-outline' | 'structure' | 'content';

/**
 * 認証署名（DocMDP）の許可レベル `P` を探す。
 *
 * 経路は §12.8.2.2 の定義どおり:
 * catalog → `/AcroForm` → `/Fields` →（`/Kids` を降りながら）→ 署名フィールドの `/V` →
 * `/Reference` の要素で `/TransformMethod` が `/DocMDP` のもの → `/TransformParams` → `/P`。
 * `/P` が無ければ **2**（Table 257 の既定値）。
 *
 * ⚠️ 旧実装（pdf-lib 版）に無かったものを 1 つ足してある: **訪問済みの参照を覚える**。
 * `/Kids` が輪になっている文書で止まらなくなるのを防ぐためで、
 * 正しい文書では結果は変わらない。
 */
export async function findDocMdpPermission(editor: PdfDocumentEditor): Promise<number | undefined> {
  const catalog = await editor.getCatalog();
  if (catalog.kind !== 'dict') return undefined;
  const acroForm = await editor.resolve(dictGet(catalog, 'AcroForm') ?? { kind: 'null' });
  if (acroForm.kind !== 'dict') return undefined;
  const fields = await editor.resolve(dictGet(acroForm, 'Fields') ?? { kind: 'null' });
  if (fields.kind !== 'array') return undefined;

  const seen = new Set<string>();

  const visit = async (value: unknown): Promise<number | undefined> => {
    const raw = value as Parameters<typeof editor.resolve>[0];
    if (raw && typeof raw === 'object' && 'kind' in raw && raw.kind === 'ref') {
      const key = `${raw.objectNumber} ${raw.generationNumber}`;
      if (seen.has(key)) return undefined;
      seen.add(key);
    }
    const field = await editor.resolve(raw);
    if (field.kind !== 'dict') return undefined;

    const v = await editor.resolve(dictGet(field, 'V') ?? { kind: 'null' });
    if (v.kind === 'dict') {
      const reference = await editor.resolve(dictGet(v, 'Reference') ?? { kind: 'null' });
      if (reference.kind === 'array') {
        for (const item of reference.items) {
          const sigRef = await editor.resolve(item);
          if (sigRef.kind !== 'dict') continue;
          const method = await editor.resolve(
            dictGet(sigRef, 'TransformMethod') ?? { kind: 'null' },
          );
          if (method.kind !== 'name' || method.value !== 'DocMDP') continue;
          const params = await editor.resolve(
            dictGet(sigRef, 'TransformParams') ?? { kind: 'null' },
          );
          if (params.kind === 'dict') {
            const p = await editor.resolve(dictGet(params, 'P') ?? { kind: 'null' });
            if (p.kind === 'integer') return p.value;
          }
          return 2; // Table 257: P 省略時の既定値
        }
      }
    }

    const kids = await editor.resolve(dictGet(field, 'Kids') ?? { kind: 'null' });
    if (kids.kind === 'array') {
      for (const kid of kids.items) {
        const found = await visit(kid);
        if (found !== undefined) return found;
      }
    }
    return undefined;
  };

  for (const field of fields.items) {
    const found = await visit(field);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * その変更を増分更新で加えてよいかを判定し、駄目なら断る（§12.8.2.2）。
 *
 * 認証署名が無ければ通す —— 承認署名だけの文書では、増分更新は合法である
 * （「署名後に変更あり」とは表示されるが、署名そのものは有効なまま）。
 */
export async function assertDocMdpAllows(
  editor: PdfDocumentEditor,
  change: DocMdpChange,
): Promise<void> {
  const p = await findDocMdpPermission(editor);
  if (p === undefined) return;
  if (change === 'annotation' && p >= 3) return;

  const label =
    change === 'annotation'
      ? p === 1
        ? 'the author declared the document final; any change (except DSS/DTS) invalidates it.'
        : 'only form fill-in and signing are permitted; annotations are not.'
      : change === 'structure'
        ? 'structure (tagging) changes are not among the permitted change types at any level.'
        : change === 'content'
          ? 'drawing onto page content is not among the permitted change types at any level.'
          : 'metadata and outline changes are not among the permitted change types at any level.';

  throw new PdfWriterError(
    `This PDF carries a certification signature (DocMDP) with permission level P=${p} — ${label}` +
      ' Even a signature-preserving incremental update would be flagged as a disallowed change.',
    'SIGNED_PDF',
    {
      retryable: true,
      hint: 'ISO 32000-2 §12.8.2.2: P=2 permits form fill-in; P=3 additionally permits annotations.',
      next_actions: [NEXT_ACTIONS.allowBreakingSignatures()],
    },
  );
}
