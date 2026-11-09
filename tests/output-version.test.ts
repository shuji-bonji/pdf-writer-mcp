/**
 * 出力の版と宣言（openspec/changes/output-version。#28）
 *
 * 方針: 出力の版・宣言した規格の shall に反するものは断る。非推奨はその版の正しい書き方で書く。
 * 許される混在は書いて伝える。編集の出力は入力の版のまま、版を変えるのは明示した変換だけ。
 *
 * 書いたものは pdf-lib（独立した読み手）で読み戻して確かめる。検体は ASCII の本文なので
 * TEST_FONT_PATH が無くても走る。
 */

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import {
  decodePDFRawStream,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRawStream,
  PDFString,
  StandardFonts,
} from 'pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';
import {
  handleAddAnnotation,
  handleCreateTextPdf,
  handleEnsurePdfa,
  handleMergePdfs,
  handleSetMetadata,
  handleSplitPdf,
  handleTagFormFields,
} from '../src/tools/handlers.js';

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'writer-output-version-'));
});

const headerOf = (bytes: Uint8Array) => Buffer.from(bytes.subarray(0, 8)).toString('latin1');

async function load(path: string): Promise<{ doc: PDFDocument; bytes: Uint8Array }> {
  const bytes = new Uint8Array(readFileSync(path));
  return { doc: await PDFDocument.load(bytes, { updateMetadata: false }), bytes };
}

function xmpOf(doc: PDFDocument): string {
  const meta = doc.catalog.lookup(PDFName.of('Metadata'));
  if (!(meta instanceof PDFRawStream)) return '';
  const bytes = meta.dict.has(PDFName.of('Filter'))
    ? decodePDFRawStream(meta).decode()
    : meta.contents;
  return new TextDecoder().decode(bytes);
}

/** Info の鍵の一覧（`/Info` が無ければ空） */
function infoKeys(doc: PDFDocument): string[] {
  const info = doc.context.lookup(doc.context.trailerInfo.Info);
  if (!(info instanceof PDFDict)) return [];
  return info.keys().map((k) => k.decodeText());
}

function infoText(doc: PDFDocument, key: string): string | undefined {
  const info = doc.context.lookup(doc.context.trailerInfo.Info);
  if (!(info instanceof PDFDict)) return undefined;
  const v = info.lookup(PDFName.of(key));
  return v instanceof PDFString || v instanceof PDFHexString ? v.decodeText() : undefined;
}

/** `dc:<prop>` の rdf:li を [xml:lang, 値] の組で返す */
function liItems(xmp: string, prop: string): Array<[string | undefined, string]> {
  const block = new RegExp(`<dc:${prop}>([\\s\\S]*?)</dc:${prop}>`).exec(xmp)?.[1] ?? '';
  return [...block.matchAll(/<rdf:li(?:\s+xml:lang="([^"]*)")?[^>]*>([^<]*)<\/rdf:li>/g)].map(
    (m) => [m[1], m[2]],
  );
}

/** ヘッダーを同じ長さで書き換える（xref のオフセットは動かない）。検体作りの都合 */
function withHeader(bytes: Uint8Array, header: '%PDF-1.7' | '%PDF-2.0'): Uint8Array {
  const out = new Uint8Array(bytes);
  out.set(new TextEncoder().encode(header), 0);
  return out;
}

async function create(name: string, extra: Record<string, unknown> = {}): Promise<string> {
  const outputPath = join(dir, name);
  await handleCreateTextPdf({ text: 'body text', outputPath, ...extra });
  return outputPath;
}

const createUa2 = (name: string) =>
  create(name, { title: 'Report', lang: 'en', tagged: true, pdfVersion: '2.0' });

/** pdf-lib で Info の項目を足し、ヘッダーを 2.0 に戻す（pdf-lib は %PDF-1.7 で書く） */
async function withInfo(path: string, name: string, entries: Record<string, string>) {
  const { doc } = await load(path);
  for (const [k, v] of Object.entries(entries)) {
    if (k === 'Title') doc.setTitle(v);
    if (k === 'Author') doc.setAuthor(v);
  }
  const out = join(dir, name);
  const was20 = headerOf(new Uint8Array(readFileSync(path))) === '%PDF-2.0';
  const saved = await doc.save({ useObjectStreams: false });
  writeFileSync(out, was20 ? withHeader(saved, '%PDF-2.0') : saved);
  return out;
}

const MULTI_XMP = `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
      <dc:title>
        <rdf:Alt>
          <rdf:li xml:lang="x-default">Annual report 2014</rdf:li>
          <rdf:li xml:lang="en">Annual report 2014</rdf:li>
          <rdf:li xml:lang="de">Jahresbericht 2014</rdf:li>
        </rdf:Alt>
      </dc:title>
      <dc:creator>
        <rdf:Seq>
          <rdf:li>John Doe</rdf:li>
          <rdf:li>Mary Miller</rdf:li>
        </rdf:Seq>
      </dc:creator>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/"
      xmpMM:DocumentID="uuid:1234">
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;

/** §14.3.3 の例と同じ dc:title（3 言語）と dc:creator（2 人）を持つ文書 */
async function createMultiLang(name: string): Promise<string> {
  const base = await create(`${name}-base.pdf`);
  const { doc } = await load(base);
  const stream = doc.context.stream(new TextEncoder().encode(MULTI_XMP), {
    Type: 'Metadata',
    Subtype: 'XML',
  });
  doc.catalog.set(PDFName.of('Metadata'), doc.context.register(stream));
  const out = join(dir, name);
  writeFileSync(out, await doc.save({ useObjectStreams: false }));
  return out;
}

describe('SPEC-WRITER-OUTPUT-VERSION-001 merge_pdfs は版の違う入力を明示した版でだけ書く', () => {
  it('SPEC-WRITER-OUTPUT-VERSION-001 1.7 と 2.0 の入力で pdfVersion が無い', async () => {
    const a = await create('m1-a.pdf', { title: 'First' });
    const b = await create('m1-b.pdf', { pdfVersion: '2.0' });
    const outputPath = join(dir, 'm1-out.pdf');
    const err = await handleMergePdfs({ inputPaths: [a, b], outputPath }).then(
      () => null,
      (e: unknown) => e as { code: string; message: string; options: Record<string, unknown> },
    );
    expect(err).toMatchObject({
      code: 'INVALID_ARGUMENT',
      options: { next_actions: [{ example: { pdfVersion: '2.0' } }] },
    });
    expect(err?.message).toContain('1.7');
    expect(err?.message).toContain('2.0');
    expect(existsSync(outputPath)).toBe(false);
  });

  it('SPEC-WRITER-OUTPUT-VERSION-001 1.7 と 2.0 の入力で pdfVersion 2.0', async () => {
    const a = await create('m2-a.pdf', { title: 'First' });
    const b = await create('m2-b.pdf', { pdfVersion: '2.0' });
    const outputPath = join(dir, 'm2-out.pdf');
    await handleMergePdfs({ inputPaths: [a, b], pdfVersion: '2.0', outputPath });
    const { doc, bytes } = await load(outputPath);
    expect(headerOf(bytes)).toBe('%PDF-2.0');
    expect(doc.context.trailerInfo.ID).toBeDefined();
    expect(liItems(xmpOf(doc), 'title').map(([, v]) => v)).toEqual(['First']);
    expect(infoKeys(doc)).not.toContain('Title');
  });

  it('SPEC-WRITER-OUTPUT-VERSION-001 2.0 の入力で pdfVersion 1.7', async () => {
    const a = await create('m3-a.pdf');
    const b = await create('m3-b.pdf', { pdfVersion: '2.0' });
    const outputPath = join(dir, 'm3-out.pdf');
    await expect(
      handleMergePdfs({ inputPaths: [a, b], pdfVersion: '1.7', outputPath }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(existsSync(outputPath)).toBe(false);
  });

  it('SPEC-WRITER-OUTPUT-VERSION-001 2.0 だけの入力にも trailer の /ID を書く', async () => {
    const a = await create('m5-a.pdf', { pdfVersion: '2.0' });
    const b = await create('m5-b.pdf', { pdfVersion: '2.0' });
    const outputPath = join(dir, 'm5-out.pdf');
    await handleMergePdfs({ inputPaths: [a, b], outputPath });
    const { doc, bytes } = await load(outputPath);
    expect(headerOf(bytes)).toBe('%PDF-2.0');
    expect(doc.context.trailerInfo.ID).toBeDefined();
  });

  it('SPEC-WRITER-OUTPUT-VERSION-001 1.7 だけの入力は今までどおり', async () => {
    const a = await create('m4-a.pdf');
    const b = await create('m4-b.pdf');
    const outputPath = join(dir, 'm4-out.pdf');
    const result = await handleMergePdfs({ inputPaths: [a, b], outputPath });
    const { bytes } = await load(outputPath);
    expect(headerOf(bytes)).toBe('%PDF-1.7');
    expect((result.warnings ?? []).join('\n')).not.toMatch(/PDF 2\.0|version/i);
  });
});

describe('SPEC-WRITER-OUTPUT-VERSION-002 PDF 2.0 の文書の set_metadata は XMP に書く', () => {
  it('SPEC-WRITER-OUTPUT-VERSION-002 Info に Title が無い 2.0 の文書', async () => {
    const input = await create('s1-in.pdf', { pdfVersion: '2.0' });
    const outputPath = join(dir, 's1-out.pdf');
    await handleSetMetadata({ inputPath: input, title: 'New', outputPath });
    const { doc } = await load(outputPath);
    expect(liItems(xmpOf(doc), 'title').map(([, v]) => v)).toEqual(['New']);
    expect(infoKeys(doc)).not.toContain('Title');
  });

  it('SPEC-WRITER-OUTPUT-VERSION-002 Info に Title がある 2.0 の文書（PDF/UA-2 ではない）', async () => {
    const base = await create('s2-base.pdf', { pdfVersion: '2.0' });
    const input = await withInfo(base, 's2-in.pdf', { Title: 'Old' });
    const outputPath = join(dir, 's2-out.pdf');
    await handleSetMetadata({ inputPath: input, title: 'New', outputPath });
    const { doc } = await load(outputPath);
    expect(infoText(doc, 'Title')).toBe('New');
    expect(liItems(xmpOf(doc), 'title').map(([, v]) => v)).toEqual(['New']);
  });

  it('SPEC-WRITER-OUTPUT-VERSION-002 Info に Title がある PDF/UA-2 の文書', async () => {
    const base = await createUa2('s3-base.pdf');
    const input = await withInfo(base, 's3-in.pdf', { Title: 'Old', Author: 'A' });
    const outputPath = join(dir, 's3-out.pdf');
    const result = await handleSetMetadata({ inputPath: input, title: 'New', outputPath });
    const { doc } = await load(outputPath);
    const xmp = xmpOf(doc);
    expect(liItems(xmp, 'title').map(([, v]) => v)).toEqual(['New']);
    expect(liItems(xmp, 'creator').map(([, v]) => v)).toEqual(['A']);
    expect(infoKeys(doc).filter((k) => k !== 'CreationDate' && k !== 'ModDate')).toEqual([]);
    const warnings = (result.warnings ?? []).join('\n');
    expect(warnings).toContain('Title');
    expect(warnings).toContain('Author');
  });
});

describe('SPEC-WRITER-OUTPUT-VERSION-003 XMP を作り直しても指示されていない項目を運ぶ', () => {
  it('SPEC-WRITER-OUTPUT-VERSION-003 複数の言語の dc:title と dc:creator', async () => {
    const input = await createMultiLang('x1-in.pdf');
    const outputPath = join(dir, 'x1-out.pdf');
    await handleSetMetadata({ inputPath: input, author: 'Someone', outputPath });
    const xmp = xmpOf((await load(outputPath)).doc);
    expect(liItems(xmp, 'title')).toEqual([
      ['x-default', 'Annual report 2014'],
      ['en', 'Annual report 2014'],
      ['de', 'Jahresbericht 2014'],
    ]);
    // author は指示したので書き換わる
    expect(liItems(xmp, 'creator').map(([, v]) => v)).toEqual(['Someone']);
    // 書き手の知らない名前空間の値も残る
    expect(xmp).toMatch(/xmpMM:DocumentID[\s\S]*uuid:1234/);
  });

  it('SPEC-WRITER-OUTPUT-VERSION-003 指示していない dc:creator は並びごと残る', async () => {
    const input = await createMultiLang('x2-in.pdf');
    const outputPath = join(dir, 'x2-out.pdf');
    await handleSetMetadata({ inputPath: input, subject: 'S', outputPath });
    const xmp = xmpOf((await load(outputPath)).doc);
    expect(liItems(xmp, 'creator').map(([, v]) => v)).toEqual(['John Doe', 'Mary Miller']);
  });

  it('SPEC-WRITER-OUTPUT-VERSION-003 複数の言語の dc:title を持つ文書の題名を変える', async () => {
    const input = await createMultiLang('x3-in.pdf');
    const outputPath = join(dir, 'x3-out.pdf');
    const result = await handleSetMetadata({ inputPath: input, title: 'New', outputPath });
    const xmp = xmpOf((await load(outputPath)).doc);
    expect(liItems(xmp, 'title')).toEqual([
      ['x-default', 'New'],
      ['en', 'Annual report 2014'],
      ['de', 'Jahresbericht 2014'],
    ]);
    const warnings = (result.warnings ?? []).join('\n');
    expect(warnings).toMatch(/\ben\b/);
    expect(warnings).toMatch(/\bde\b/);
  });
});

describe('SPEC-WRITER-OUTPUT-VERSION-004 PDF/UA-2 の文書に足した既定の名前空間の要素を伝える', () => {
  it('SPEC-WRITER-OUTPUT-VERSION-004 PDF/UA-2 の文書に注釈を足す', async () => {
    const input = await createUa2('a1-in.pdf');
    const result = await handleAddAnnotation({
      inputPath: input,
      page: 1,
      type: 'square',
      rect: { x1: 50, y1: 50, x2: 150, y2: 70 },
      alt: 'Example',
      outputPath: join(dir, 'a1-out.pdf'),
    });
    expect((result.warnings ?? []).join('\n')).toMatch(/\bAnnot\b[\s\S]*namespace/);
  });

  it('SPEC-WRITER-OUTPUT-VERSION-004 PDF/UA-2 の文書のフォームにタグを付ける', async () => {
    const base = await createUa2('f1-base.pdf');
    const { doc } = await load(base);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const field = doc.getForm().createTextField('user.name');
    field.addToPage(doc.getPage(0), { x: 50, y: 200, width: 200, height: 24, font });
    const input = join(dir, 'f1-in.pdf');
    // pdf-lib は %PDF-1.7 で書くので、ヘッダーを 2.0 に戻す（同じ長さなのでオフセットは動かない）
    writeFileSync(input, withHeader(await doc.save({ useObjectStreams: false }), '%PDF-2.0'));
    const result = await handleTagFormFields({
      inputPath: input,
      labels: { 'user.name': 'Name' },
      outputPath: join(dir, 'f1-out.pdf'),
    });
    expect((result.warnings ?? []).join('\n')).toMatch(/\bForm\b[\s\S]*namespace/);
  });

  it('SPEC-WRITER-OUTPUT-VERSION-004 PDF/UA-1 の文書には書かない', async () => {
    const input = await create('a2-in.pdf', { title: 'Report', lang: 'en', tagged: true });
    const result = await handleAddAnnotation({
      inputPath: input,
      page: 1,
      type: 'square',
      rect: { x1: 50, y1: 50, x2: 150, y2: 70 },
      alt: 'Example',
      outputPath: join(dir, 'a2-out.pdf'),
    });
    expect((result.warnings ?? []).join('\n')).not.toMatch(/namespace/);
  });
});

describe('SPEC-WRITER-OUTPUT-VERSION-005 結果で出力の版と宣言を伝える', () => {
  it('SPEC-WRITER-OUTPUT-VERSION-005 PDF/UA-2 で作る', async () => {
    const result = await handleCreateTextPdf({
      text: 'body text',
      title: 'Report',
      lang: 'en',
      tagged: true,
      pdfVersion: '2.0',
      outputPath: join(dir, 'o1.pdf'),
    });
    expect(result.output).toEqual({ pdfVersion: '2.0', declares: { pdfua: 2 } });
  });

  it('SPEC-WRITER-OUTPUT-VERSION-005 PDF/UA-2 の文書に pdfa-4', async () => {
    const input = await createUa2('o2-in.pdf');
    const result = await handleEnsurePdfa({
      inputPath: input,
      flavour: 'pdfa-4',
      outputPath: join(dir, 'o2-out.pdf'),
    });
    expect(result.output).toEqual({ pdfVersion: '2.0', declares: { pdfua: 2, pdfa: '4' } });
  });

  it('SPEC-WRITER-OUTPUT-VERSION-005 タグ無しの 1.7', async () => {
    const result = await handleCreateTextPdf({
      text: 'body text',
      outputPath: join(dir, 'o3.pdf'),
    });
    expect(result.output).toEqual({ pdfVersion: '1.7', declares: {} });
  });

  it('SPEC-WRITER-OUTPUT-VERSION-005 split_pdf は各ファイルに output を持つ', async () => {
    const input = await create('o4-in.pdf', { pdfVersion: '2.0' });
    const result = await handleSplitPdf({ inputPath: input, ranges: ['1'], outputDir: dir });
    expect(result.files[0]?.output).toEqual({ pdfVersion: '2.0', declares: {} });
  });
});

describe('SPEC-WRITER-OUTPUT-VERSION-006 版を理由に断るエラーは版を名指す', () => {
  it('SPEC-WRITER-OUTPUT-VERSION-006 タグ無しの 2.0 に pdfa-3b', async () => {
    const input = await create('e1-in.pdf', { pdfVersion: '2.0' });
    const err = await handleEnsurePdfa({
      inputPath: input,
      flavour: 'pdfa-3b',
      outputPath: join(dir, 'e1-out.pdf'),
    }).then(
      () => null,
      (e: unknown) => e as { message: string },
    );
    expect(err?.message).toContain('2.0');
    expect(err?.message).toMatch(/1\.\d|1\.x|%PDF-1\.n/);
  });
});

describe('SPEC-WRITER-OUTPUT-VERSION-007 版の原則を 1 か所に書く', () => {
  it('SPEC-WRITER-OUTPUT-VERSION-007 instructions に原則がある', async () => {
    const server = buildServer();
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await server.connect(serverT);
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(clientT);
    const instructions = client.getInstructions() ?? '';
    const paragraphs = instructions.split(/\n\s*\n/);
    const principle = paragraphs.filter(
      (p) => p.includes('ensure_pdfa') && p.includes('merge_pdfs') && p.includes('output'),
    );
    expect(principle).toHaveLength(1);
    await client.close();
  });
});
