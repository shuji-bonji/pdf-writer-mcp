/**
 * E-2: family-compatible 構造化エラーのテスト。
 * コード・retryable・next_actions が出力パイプライン Skill の分岐に使える形か。
 */

import { describe, expect, it } from 'vitest';
import { invalidArg, PdfWriterError, toStructuredError } from '../src/errors.js';
import { handleCreateTextPdf, handleSetMetadata } from '../src/tools/handlers.js';

describe('toStructuredError (E-2)', () => {
  it('carries code / hint / retryable / next_actions from PdfWriterError', () => {
    // retryable は code から決まる（SPEC-WRITER-COMMON-ERRORS-002）
    const e = new PdfWriterError('signed', 'SIGNED_PDF', {
      hint: 'h',
      next_actions: [{ action: 'a', reason: 'r' }],
    });
    expect(toStructuredError(e)).toEqual({
      error: 'signed',
      code: 'SIGNED_PDF',
      hint: 'h',
      retryable: true,
      next_actions: [{ action: 'a', reason: 'r' }],
    });
  });

  it('maps plain Error to INTERNAL_ERROR', () => {
    expect(toStructuredError(new Error('boom'))).toEqual({
      error: 'boom',
      code: 'INTERNAL_ERROR',
      retryable: false,
    });
  });

  it('invalidArg produces INVALID_ARGUMENT', () => {
    expect(toStructuredError(invalidArg('bad'))).toEqual({
      error: 'bad',
      code: 'INVALID_ARGUMENT',
      retryable: true,
    });
  });
});

describe('handlers throw family-coded errors', () => {
  it('validation errors carry INVALID_ARGUMENT', async () => {
    await expect(
      handleSetMetadata({ inputPath: 'relative.pdf', title: 't' }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('missing file carries DOC_NOT_FOUND with next_actions', async () => {
    await expect(
      handleSetMetadata({ inputPath: '/no/such/file.pdf', title: 't' }),
    ).rejects.toMatchObject({ code: 'DOC_NOT_FOUND' });
  });

  it('non-Latin text without font carries FONT_REQUIRED (retryable)', async () => {
    const error = await handleCreateTextPdf({ text: '日本語テキスト' }).catch((e) => e);
    expect(error).toMatchObject({ code: 'FONT_REQUIRED' });
    expect(toStructuredError(error).retryable).toBe(true);
  });
});
