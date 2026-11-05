/**
 * エラー応答の契約（openspec/specs/common-errors）
 *
 * PDF family の規約（pdf-agent-stack docs/specs/06 §2.3）: ツール結果 `isError: true` の
 * 本文は平らな JSON で、`error`・`code`・`retryable` が必須、文の項目は英語。
 * ツールは buildServer() の実物を InMemoryTransport 越しに呼ぶ。
 * TEST_FONT_PATH が無くても全件が回る（フォントを使う入力を渡さない）。
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  NEXT_ACTIONS,
  PdfWriterError,
  toStructuredError,
  type WriterErrorCode,
} from '../src/errors.js';
import { buildServer } from '../src/server.js';

const TOP_LEVEL = new Set(['error', 'code', 'retryable', 'hint', 'next_actions', 'detail']);
const JAPANESE = /[぀-ヿ㐀-鿿]/;

let client: Client;
let dir: string;
let savedFontEnv: string | undefined;

// biome-ignore lint/suspicious/noExplicitAny: 応答の形そのものを検査する
async function call(
  name: string,
  args: Record<string, unknown>,
): Promise<{ isError: boolean; body: any }> {
  const result = (await client.callTool({ name, arguments: args })) as {
    isError?: boolean;
    content: Array<{ type: string; text?: string }>;
  };
  const text = result.content.find((c) => c.type === 'text')?.text ?? '';
  return { isError: result.isError === true, body: JSON.parse(text) };
}

// biome-ignore lint/suspicious/noExplicitAny: 応答の形そのものを検査する
function shapeViolations(body: any): string[] {
  const v: string[] = [];
  for (const k of Object.keys(body)) if (!TOP_LEVEL.has(k)) v.push(`契約に無い最上位の項目 ${k}`);
  if (typeof body.error !== 'string' || body.error === '') v.push('error が空でない文字列でない');
  if (typeof body.code !== 'string') v.push('code が文字列でない');
  if (typeof body.retryable !== 'boolean') v.push('retryable が真偽値でない');
  return v;
}

const rotate = (inputPath: string) => ({
  inputPath,
  rotation: 90,
  outputPath: join(dir, 'rotated.pdf'),
});

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'writer-common-errors-'));
  writeFileSync(join(dir, 'not-a-pdf.pdf'), 'This is a text file, not a PDF.\n');
  writeFileSync(join(dir, 'empty.pdf'), '');
  // フォントの既定を環境から拾わせない（FONT_REQUIRED を確かめるため）
  savedFontEnv = process.env.PDF_WRITER_FONT;
  delete process.env.PDF_WRITER_FONT;

  const server = buildServer();
  client = new Client({ name: 'common-errors-test', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
});

afterAll(async () => {
  if (savedFontEnv !== undefined) process.env.PDF_WRITER_FONT = savedFontEnv;
  await client?.close();
});

/** サーバーが返しうる code と、その retryable（SPEC-WRITER-COMMON-ERRORS-002） */
const ALL_CODES: Record<WriterErrorCode, boolean> = {
  INVALID_ARGUMENT: true,
  FONT_REQUIRED: true,
  FONT_NOT_FOUND: true,
  MISSING_GLYPH: true,
  SIGNED_PDF: true,
  TAGGED_PDF: true,
  DOC_NOT_FOUND: false,
  INVALID_PDF: false,
  ENCRYPTED_PDF: false,
  UNSUPPORTED_PDF_FEATURE: false,
  FILE_TOO_LARGE: false,
  INTERNAL_ERROR: false,
};

/** 0.23.2 の action と example（受け側の Skill が分岐と再試行に使う） */
const ACTIONS_0_23_2 = [
  [
    NEXT_ACTIONS.preserveSignatures(),
    'retry_with_preserveSignatures',
    { preserveSignatures: true },
  ],
  [
    NEXT_ACTIONS.allowBreakingSignatures(),
    'retry_with_allowBreakingSignatures',
    { allowBreakingSignatures: true },
  ],
  [NEXT_ACTIONS.allowBreakingTags(), 'retry_with_allowBreakingTags', { allowBreakingTags: true }],
  [
    NEXT_ACTIONS.provideFontPath(),
    'retry_with_fontPath',
    { fontPath: '/path/to/NotoSansJP-Regular.otf' },
  ],
  [
    NEXT_ACTIONS.changeMissingGlyphPolicy(),
    'retry_with_onMissingGlyph',
    { onMissingGlyph: 'replace' },
  ],
  [NEXT_ACTIONS.checkFilePath('/abs/in.pdf'), 'verify_file_path', { inputPath: '/abs/in.pdf' }],
] as const;

describe('common-errors', () => {
  it('SPEC-WRITER-COMMON-ERRORS-001 存在しないパスのエラーが形どおり', async () => {
    const res = await call('rotate_pages', rotate(join(dir, 'no-such-file.pdf')));
    expect(res.isError).toBe(true);
    expect(res.body.code).toBe('DOC_NOT_FOUND');
    expect(shapeViolations(res.body)).toEqual([]);
  });

  it('SPEC-WRITER-COMMON-ERRORS-001 PDF でないファイルのエラーが形どおり', async () => {
    const res = await call('rotate_pages', rotate(join(dir, 'not-a-pdf.pdf')));
    expect(res.isError).toBe(true);
    expect(res.body.code).toBe('INVALID_PDF');
    expect(shapeViolations(res.body)).toEqual([]);
  });

  it('SPEC-WRITER-COMMON-ERRORS-001 故障のエラーも形どおり', () => {
    const err = toStructuredError(new Error('something inside the server broke'));
    expect(err).toEqual({
      error: 'something inside the server broke',
      code: 'INTERNAL_ERROR',
      retryable: false,
    });
  });

  it('SPEC-WRITER-COMMON-ERRORS-002 存在しないパスは再試行できない', async () => {
    const res = await call('rotate_pages', rotate(join(dir, 'no-such-file.pdf')));
    expect(res.body.retryable).toBe(false);
  });

  it('SPEC-WRITER-COMMON-ERRORS-002 文書の所見は再試行できない', async () => {
    const res = await call('rotate_pages', rotate(join(dir, 'empty.pdf')));
    expect(res.body.code).toBe('INVALID_PDF');
    expect(res.body.retryable).toBe(false);
  });

  it('SPEC-WRITER-COMMON-ERRORS-002 フラグで解けるガードは再試行できる', async () => {
    const res = await call('create_text_pdf', { text: '日本語の本文' });
    expect(res.body.code).toBe('FONT_REQUIRED');
    expect(res.body.retryable).toBe(true);
  });

  it('SPEC-WRITER-COMMON-ERRORS-002 すべての code に値が決まっている', () => {
    const got = Object.fromEntries(
      Object.keys(ALL_CODES).map((code) => [
        code,
        toStructuredError(new PdfWriterError('x', code as WriterErrorCode)).retryable,
      ]),
    );
    expect(got).toEqual(ALL_CODES);
  });

  it('SPEC-WRITER-COMMON-ERRORS-003 next_actions の reason は英語', () => {
    const japanese = ACTIONS_0_23_2.map(([a]) => a.reason).filter((r) => JAPANESE.test(r));
    expect(japanese).toEqual([]);
  });

  it('SPEC-WRITER-COMMON-ERRORS-003 next_actions の action と example は変わらない', () => {
    for (const [a, action, example] of ACTIONS_0_23_2) {
      expect(a.action).toBe(action);
      expect(a.example).toEqual(example);
    }
  });

  it('SPEC-WRITER-COMMON-ERRORS-003 フォントが要るときの本文はすべて英語', async () => {
    const res = await call('create_text_pdf', { text: '日本語の本文' });
    const prose = [
      res.body.error,
      res.body.hint,
      ...(res.body.next_actions ?? []).map((a: { reason: string }) => a.reason),
    ].filter((s) => typeof s === 'string');
    expect(prose.filter((s: string) => JAPANESE.test(s))).toEqual([]);
    expect(res.body.next_actions[0].action).toBe('retry_with_fontPath');
  });
});
