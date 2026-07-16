/**
 * E-6: SOURCE_DATE_EPOCH による決定論的出力のテスト。
 * 同一入力 → 同一バイト列（差分検証・キャッシュ・再現テストの前提）。
 */

import { PDFDocument } from 'pdf-lib';
import { afterEach, describe, expect, it } from 'vitest';
import { outputDate } from '../src/config.js';
import { handleCreateTextPdf } from '../src/tools/handlers.js';
import type { CreateResult } from '../src/types/index.js';

afterEach(() => {
  delete process.env.SOURCE_DATE_EPOCH;
});

describe('SOURCE_DATE_EPOCH (E-6)', () => {
  it('outputDate returns the fixed epoch when set', () => {
    process.env.SOURCE_DATE_EPOCH = '1700000000';
    expect(outputDate().toISOString()).toBe('2023-11-14T22:13:20.000Z');
  });

  it('outputDate rejects invalid values instead of silently being non-deterministic', () => {
    process.env.SOURCE_DATE_EPOCH = 'abc';
    expect(() => outputDate()).toThrow(/SOURCE_DATE_EPOCH/);
    process.env.SOURCE_DATE_EPOCH = '-5';
    expect(() => outputDate()).toThrow(/SOURCE_DATE_EPOCH/);
  });

  it('produces byte-identical PDFs for identical input', async () => {
    process.env.SOURCE_DATE_EPOCH = '1700000000';
    const args = { text: 'deterministic output test' };
    const a = (await handleCreateTextPdf(args)) as CreateResult;
    const b = (await handleCreateTextPdf(args)) as CreateResult;
    expect(a.base64).toBeDefined();
    expect(a.base64).toBe(b.base64);
  });

  it('embeds the fixed date in the PDF', async () => {
    process.env.SOURCE_DATE_EPOCH = '1700000000';
    const r = (await handleCreateTextPdf({ text: 'date check' })) as CreateResult;
    // Info 辞書は ObjStm 圧縮内にあるため、pdf-lib で読み戻して確認する
    const doc = await PDFDocument.load(Buffer.from(r.base64 as string, 'base64'), {
      updateMetadata: false,
    });
    expect(doc.getCreationDate()?.toISOString()).toBe('2023-11-14T22:13:20.000Z');
    expect(doc.getModificationDate()?.toISOString()).toBe('2023-11-14T22:13:20.000Z');
  });
});
