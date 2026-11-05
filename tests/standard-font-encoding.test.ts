/**
 * 標準フォントで描く文字の符号（openspec/changes/standard-font-winansi。#19）
 *
 * 0.25.0 までは、標準フォントの `encode` が文字コードの下位 1 バイトを書いていた
 * （Latin-1 の符号化）。フォント辞書は `/Encoding /WinAnsiEncoding` なので、
 * 箇条書きの記号「•」（U+2022）が `0x22`（WinAnsiEncoding の quotedbl = `"`）になっていた。
 * 正しい符号は ISO 32000-1 Annex D.2 Table D.2 の WinAnsiEncoding 欄の 225（8 進）= 0x95。
 *
 * 0.25.0 のリストのテスト（list-structure.test.ts）は構造木と位置を見ていて、
 * 記号の字そのものは見ていなかったので、この不具合を通していた。
 *
 * どの検体も ASCII と Latin-1 だけなので、TEST_FONT_PATH が無くても走る。
 * 環境変数 PDF_WRITER_FONT が設定されていると標準フォントの経路を通らないので、空にして回す。
 */

import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { PDFArray, PDFDocument, PDFName, PDFRawStream, StandardFonts } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ENV_KEYS } from '../src/config.js';
import {
  handleAddWatermark,
  handleCreateMarkdownPdf,
  handleCreateTextPdf,
} from '../src/tools/handlers.js';
import type { CreateResult } from '../src/types/index.js';

let dir: string;

beforeAll(async () => {
  vi.stubEnv(ENV_KEYS.DEFAULT_FONT, '');
  dir = await mkdtemp(join(tmpdir(), 'pwm-std-font-'));
});

afterAll(() => {
  vi.unstubAllEnvs();
});

/** 全ページの /Contents を復号して latin1 の文字列でつなぐ */
async function pageContents(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  const parts: string[] = [];
  for (const page of doc.getPages()) {
    const contents = page.node.lookup(PDFName.of('Contents'));
    const streams = contents instanceof PDFArray ? contents.asArray() : [contents];
    for (const entry of streams) {
      const stream = (
        entry instanceof PDFRawStream ? entry : doc.context.lookup(entry as never)
      ) as PDFRawStream;
      let raw = Buffer.from(stream.getContents());
      try {
        raw = inflateSync(raw);
      } catch {
        /* 非圧縮ならそのまま */
      }
      parts.push(raw.toString('latin1'));
    }
  }
  return parts.join('\n');
}

async function created(result: CreateResult): Promise<string> {
  return pageContents(Buffer.from(result.base64 as string, 'base64'));
}

describe('SPEC-WRITER-STANDARD-FONT-ENCODING-001 標準フォントで描く文字は WinAnsiEncoding の符号で書く', () => {
  it('SPEC-WRITER-STANDARD-FONT-ENCODING-001 箇条書きの記号を 0x95 で書く', async () => {
    const result = (await handleCreateMarkdownPdf({
      markdown: '- Alpha',
      returnBase64: true,
    })) as CreateResult;
    expect(result.font).toBe('Helvetica');
    const content = await created(result);
    expect(content).toContain('<95> Tj');
    expect(content).not.toContain('<22> Tj');
  });

  it('SPEC-WRITER-STANDARD-FONT-ENCODING-001 Latin-1 と同じ符号の字はそのまま書く', async () => {
    const result = (await handleCreateTextPdf({
      text: 'Café © ½',
      returnBase64: true,
    })) as CreateResult;
    expect(await created(result)).toContain('<436166e920a920bd> Tj');
  });
});

describe('SPEC-WRITER-STANDARD-FONT-ENCODING-002 WinAnsiEncoding に符号の無い文字は onMissingGlyph に従う', () => {
  it('SPEC-WRITER-STANDARD-FONT-ENCODING-002 既定では MISSING_GLYPH で失敗する', async () => {
    await expect(
      handleCreateTextPdf({ text: 'A\u0085B', returnBase64: true }),
    ).rejects.toMatchObject({ code: 'MISSING_GLYPH', message: expect.stringMatching(/U\+0085/) });
  });

  it('SPEC-WRITER-STANDARD-FONT-ENCODING-002 replace では ? に置き換える', async () => {
    const result = (await handleCreateTextPdf({
      text: 'A\u0085B',
      onMissingGlyph: 'replace',
      returnBase64: true,
    })) as CreateResult;
    expect(await created(result)).toContain('<413f42> Tj');
    expect(result.warnings?.join('\n')).toMatch(/U\+0085/);
  });

  it('SPEC-WRITER-STANDARD-FONT-ENCODING-002 ignore では空白の符号で描く', async () => {
    const result = (await handleCreateTextPdf({
      text: 'A\u0085B',
      onMissingGlyph: 'ignore',
      returnBase64: true,
    })) as CreateResult;
    const content = await created(result);
    expect(content).toContain('<412042> Tj');
    expect(content).not.toContain('<418542>');
    expect(result.warnings?.join('\n')).toMatch(/U\+0085/);
  });

  it('SPEC-WRITER-STANDARD-FONT-ENCODING-002 編集系も MISSING_GLYPH で失敗する', async () => {
    const input = join(dir, 'plain.pdf');
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    doc.addPage([400, 400]).drawText('PAGE', { x: 40, y: 200, size: 18, font });
    await writeFile(input, await doc.save());

    await expect(
      handleAddWatermark({
        inputPath: input,
        text: 'DRAFT\u007f',
        outputPath: join(dir, 'out.pdf'),
      }),
    ).rejects.toMatchObject({ code: 'MISSING_GLYPH', message: expect.stringMatching(/U\+007F/) });
    await expect(readFile(join(dir, 'out.pdf'))).rejects.toThrow();
  });
});
