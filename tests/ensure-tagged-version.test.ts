/**
 * ensure_tagged は PDF 2.0 の入力に PDF/UA-1 の宣言を書かない
 * （openspec/changes/ensure-tagged-refuses-pdf20。#17）
 *
 * 0.24.0 は版を確かめず、`%PDF-2.0` のまま `pdfuaid:part=1` を書いていた。
 * ツールは buildServer() の実物を InMemoryTransport 越しに呼び、本文を見る。
 */

import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';

let client: Client;
let dir: string;

// biome-ignore lint/suspicious/noExplicitAny: 応答の形そのものを検査する
type Body = any;

async function call(
  name: string,
  args: Record<string, unknown>,
): Promise<{ isError: boolean; body: Body }> {
  const result = (await client.callTool({ name, arguments: args })) as {
    isError?: boolean;
    content: Array<{ type: string; text?: string }>;
  };
  const text = result.content.find((c) => c.type === 'text')?.text ?? '';
  return { isError: result.isError === true, body: JSON.parse(text) };
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'writer-ensure-tagged-version-'));
  const server = buildServer();
  client = new Client({ name: 'ensure-tagged-version-test', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
});

afterAll(async () => {
  await client?.close();
});

describe('SPEC-WRITER-ENSURE-TAGGED-003 PDF 2.0 の入力に PDF/UA-1 の宣言を書かない', () => {
  it('SPEC-WRITER-ENSURE-TAGGED-003 PDF 2.0 で作った文書', async () => {
    const input = join(dir, 'v20.pdf');
    const made = await call('create_text_pdf', {
      text: 'body',
      pdfVersion: '2.0',
      outputPath: input,
    });
    expect(made.isError).toBe(false);
    const outputPath = join(dir, 'v20-tagged.pdf');
    const { isError, body } = await call('ensure_tagged', {
      inputPath: input,
      title: 'T',
      lang: 'en',
      outputPath,
    });
    expect(isError).toBe(true);
    expect(body.code).toBe('INVALID_ARGUMENT');
    expect(existsSync(outputPath)).toBe(false);
  });

  it('SPEC-WRITER-ENSURE-TAGGED-003 PDF 1.7 の文書は今までどおり', async () => {
    const input = join(dir, 'v17.pdf');
    await call('create_text_pdf', { text: 'body', outputPath: input });
    const outputPath = join(dir, 'v17-tagged.pdf');
    const { isError } = await call('ensure_tagged', {
      inputPath: input,
      title: 'T',
      lang: 'en',
      outputPath,
    });
    expect(isError).toBe(false);
    expect(readFileSync(outputPath).toString('latin1')).toMatch(/pdfuaid:part/);
  });
});
