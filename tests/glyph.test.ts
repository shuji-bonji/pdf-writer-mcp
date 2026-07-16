/**
 * グリフ欠落ポリシー（onMissingGlyph）のテスト
 * TEST_FONT_PATH に日本語フォント（例: Noto Sans JP .otf）があるときのみ実行。
 * ✔ (U+2714) は Noto Sans JP に存在しないことを前提フィクスチャとして使う。
 */

import { describe, expect, it } from 'vitest';
import { handleCreateTablePdf, handleCreateTextPdf } from '../src/tools/handlers.js';
import type { CreateResult } from '../src/types/index.js';

const fontPath = process.env.TEST_FONT_PATH;

describe.skipIf(!fontPath)('onMissingGlyph policy (embedded font)', () => {
  const MISSING = '✔'; // U+2714 — Noto Sans JP 系に無い

  it('defaults to error, listing the missing characters', async () => {
    await expect(handleCreateTextPdf({ text: `完了 ${MISSING} です`, fontPath })).rejects.toThrow(
      /U\+2714/,
    );
  });

  it('replace: substitutes 〓 and reports warnings', async () => {
    const result = (await handleCreateTextPdf({
      text: `完了 ${MISSING} です`,
      fontPath,
      onMissingGlyph: 'replace',
    })) as CreateResult;
    expect(result.pageCount).toBe(1);
    expect(result.warnings).toBeDefined();
    expect(result.warnings?.[0]).toMatch(/〓/);
    expect(result.warnings?.[0]).toMatch(/U\+2714/);
  });

  it('ignore: renders anyway but still warns', async () => {
    const result = (await handleCreateTextPdf({
      text: `完了 ${MISSING} です`,
      fontPath,
      onMissingGlyph: 'ignore',
    })) as CreateResult;
    expect(result.pageCount).toBe(1);
    expect(result.warnings?.[0]).toMatch(/blank/i);
  });

  it('no warnings when all glyphs are covered', async () => {
    const result = (await handleCreateTextPdf({
      text: '日本語と English の混在テキスト。',
      fontPath,
    })) as CreateResult;
    expect(result.warnings).toBeUndefined();
  });

  it('applies the policy to table cells', async () => {
    await expect(
      handleCreateTablePdf({
        headers: ['状態'],
        rows: [[`${MISSING} 完了`]],
        fontPath,
      }),
    ).rejects.toThrow(/U\+2714/);

    const result = (await handleCreateTablePdf({
      headers: ['状態'],
      rows: [[`${MISSING} 完了`]],
      fontPath,
      onMissingGlyph: 'replace',
    })) as CreateResult;
    expect(result.warnings?.[0]).toMatch(/〓/);
  });

  it('applies the policy to the title as well', async () => {
    await expect(
      handleCreateTextPdf({ text: '本文', title: `結果 ${MISSING}`, fontPath }),
    ).rejects.toThrow(/U\+2714/);
  });
});

describe('onMissingGlyph validation', () => {
  it('rejects unknown policy values', async () => {
    await expect(handleCreateTextPdf({ text: 'x', onMissingGlyph: 'skip' })).rejects.toThrow(
      /onMissingGlyph must be one of/,
    );
  });
});
