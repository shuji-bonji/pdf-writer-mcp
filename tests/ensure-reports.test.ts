/**
 * ensure_pdfa と ensure_tagged の応答が、入力に何があり何を変えたかを正しく返すこと。
 *
 * - openspec/changes/ensure-pdfa4-refuses-pdfua1（#9・F-19）: PDF/UA を宣言した入力に PDF/A-4 を名乗らせない
 * - openspec/changes/ensure-reports-what-changed（#11・F-20・F-31）: replacedRequirements・
 *   requirementsChanged・previousDeclaration
 *
 * ツールは buildServer() の実物を InMemoryTransport 越しに呼び、本文を見る。
 * 検体は ASCII の本文なので TEST_FONT_PATH が無くても走る。
 */

import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { PDFDocument, PDFName, type PDFString } from 'pdf-lib';
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

async function ok(name: string, args: Record<string, unknown>): Promise<Body> {
  const { isError, body } = await call(name, args);
  expect(isError, JSON.stringify(body)).toBe(false);
  return body;
}

const files = { tagged: '', untagged: '' };

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'writer-ensure-reports-'));
  const server = buildServer();
  client = new Client({ name: 'ensure-reports-test', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  files.tagged = join(dir, 'tagged.pdf');
  await ok('create_markdown_pdf', {
    markdown: '# Report\n\nbody text\n',
    title: 'Report',
    lang: 'en',
    tagged: true,
    outputPath: files.tagged,
  });
  files.untagged = join(dir, 'untagged.pdf');
  await ok('create_text_pdf', { text: 'plain body', outputPath: files.untagged });
});

afterAll(async () => {
  await client?.close();
});

describe('SPEC-WRITER-ENSURE-PDFA-001 PDF/UA を宣言した入力に PDF/A-4 を名乗らせない', () => {
  it('SPEC-WRITER-ENSURE-PDFA-001 PDF/UA-1 の入力に pdfa-4f', async () => {
    const outputPath = join(dir, 'never-4f.pdf');
    const { isError, body } = await call('ensure_pdfa', {
      inputPath: files.tagged,
      flavour: 'pdfa-4f',
      outputPath,
    });
    expect(isError).toBe(true);
    expect(body.code).toBe('INVALID_ARGUMENT');
    expect(body.next_actions[0].example.flavour).toBe('pdfa-3b');
    expect(existsSync(outputPath)).toBe(false);
  });

  it('SPEC-WRITER-ENSURE-PDFA-001 PDF/UA-1 の入力に pdfa-4', async () => {
    const { body } = await call('ensure_pdfa', {
      inputPath: files.tagged,
      flavour: 'pdfa-4',
      outputPath: join(dir, 'never-4.pdf'),
    });
    expect(body.code).toBe('INVALID_ARGUMENT');
  });

  it('SPEC-WRITER-ENSURE-PDFA-001 PDF/UA-1 の入力に pdfa-3b は今までどおり', async () => {
    const outputPath = join(dir, 'pdfa3b.pdf');
    await ok('ensure_pdfa', { inputPath: files.tagged, flavour: 'pdfa-3b', outputPath });
    expect(readFileSync(outputPath).toString('latin1')).toMatch(/pdfuaid:part/);
  });
});

describe('SPEC-WRITER-ENSURE-PDFA-002 前の宣言そのものを返す', () => {
  it('SPEC-WRITER-ENSURE-PDFA-002 PDF/A-3b の文書に pdfa-4f', async () => {
    const first = join(dir, 'untagged-3b.pdf');
    await ok('ensure_pdfa', { inputPath: files.untagged, flavour: 'pdfa-3b', outputPath: first });
    const body = await ok('ensure_pdfa', {
      inputPath: first,
      flavour: 'pdfa-4f',
      outputPath: join(dir, 'untagged-4f.pdf'),
    });
    expect(body.previousDeclaration).toEqual({ part: 3, conformance: 'B' });
    expect(body).not.toHaveProperty('wasDeclared');
  });

  it('SPEC-WRITER-ENSURE-PDFA-002 宣言の無い文書', async () => {
    const body = await ok('ensure_pdfa', {
      inputPath: files.untagged,
      outputPath: join(dir, 'untagged-3b-again.pdf'),
    });
    expect(body.previousDeclaration).toBeNull();
  });
});

describe('SPEC-WRITER-ENSURE-TAGGED-001 足したものと書き直したものを分けて返す', () => {
  it('SPEC-WRITER-ENSURE-TAGGED-001 タグ付きで作った文書に同じ lang と title', async () => {
    const body = await ok('ensure_tagged', {
      inputPath: files.tagged,
      lang: 'en',
      title: 'Report',
      outputPath: join(dir, 'tagged-same.pdf'),
    });
    expect(body.addedRequirements).toEqual([]);
    expect(body.replacedRequirements).toEqual([]);
  });

  it('SPEC-WRITER-ENSURE-TAGGED-001 違う lang は書き直したものとして返す', async () => {
    const outputPath = join(dir, 'tagged-ja.pdf');
    const body = await ok('ensure_tagged', {
      inputPath: files.tagged,
      lang: 'ja',
      title: 'Report',
      outputPath,
    });
    expect(body.replacedRequirements).toContain('Lang');
    expect(body.addedRequirements).not.toContain('Lang');
    const doc = await PDFDocument.load(readFileSync(outputPath), { updateMetadata: false });
    expect((doc.catalog.lookup(PDFName.of('Lang')) as PDFString).decodeText()).toBe('ja');
  });

  it('SPEC-WRITER-ENSURE-TAGGED-001 タグ無しの文書には今までどおり足す', async () => {
    const body = await ok('ensure_tagged', {
      inputPath: files.untagged,
      lang: 'en',
      title: 'Plain',
      outputPath: join(dir, 'untagged-tagged.pdf'),
    });
    expect(body.addedRequirements).toEqual(
      expect.arrayContaining([
        'Lang',
        'ViewerPreferences/DisplayDocTitle',
        'XMP(pdfuaid:part, dc:title)',
      ]),
    );
  });
});

describe('SPEC-WRITER-ENSURE-TAGGED-002 変化が無くても出力を書き出し、変化が無かったことを返す', () => {
  it('SPEC-WRITER-ENSURE-TAGGED-002 変化が無い', async () => {
    const outputPath = join(dir, 'tagged-unchanged.pdf');
    const body = await ok('ensure_tagged', {
      inputPath: files.tagged,
      lang: 'en',
      title: 'Report',
      outputPath,
    });
    expect(body.requirementsChanged).toBe(false);
    expect(existsSync(outputPath)).toBe(true);
  });

  it('SPEC-WRITER-ENSURE-TAGGED-002 変化がある', async () => {
    const body = await ok('ensure_tagged', {
      inputPath: files.untagged,
      lang: 'en',
      title: 'Plain',
      outputPath: join(dir, 'untagged-changed.pdf'),
    });
    expect(body.requirementsChanged).toBe(true);
  });
});
