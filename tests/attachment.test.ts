/**
 * attach_file（埋め込みファイル / PDF/A-3・電帳法）のテスト
 *
 * PDF/A-3 §6.8 は埋め込みファイルに意味のある /AFRelationship を要求し、
 * catalog /AF での参照も要る。pdf-lib の attach() がそこまで書くことを前提に、
 * 本サーバが足す部分（検証・MIME 推定・重複防止・警告）と併せて固定する。
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { PDFArray, PDFDict, PDFDocument, PDFName, type PDFRawStream } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { guessMimeType, listEmbeddedFiles } from '../src/services/attachment.js';
import { handleAttachFile, handleCreateTextPdf } from '../src/tools/handlers.js';
import type { AttachResult } from '../src/types/index.js';

let dir: string;

async function basePdf(name: string): Promise<string> {
  const path = join(dir, name);
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  await writeFile(path, await doc.save());
  return path;
}

async function attachmentFile(name: string, content: string): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, content, 'utf8');
  return path;
}

async function load(result: AttachResult): Promise<PDFDocument> {
  return PDFDocument.load(Buffer.from(result.base64 as string, 'base64'), {
    updateMetadata: false,
  });
}

/** 埋め込みファイルの中身を取り出す */
function readAttachmentBytes(doc: PDFDocument, index = 0): Buffer {
  const names = doc.catalog.lookup(PDFName.of('Names')) as PDFDict;
  const ef = names.lookup(PDFName.of('EmbeddedFiles')) as PDFDict;
  const arr = ef.lookup(PDFName.of('Names')) as PDFArray;
  const spec = arr.lookup(index * 2 + 1) as PDFDict;
  const efDict = spec.lookup(PDFName.of('EF')) as PDFDict;
  const stream = doc.context.lookup(efDict.get(PDFName.of('F'))) as PDFRawStream;
  const raw = Buffer.from(stream.getContents());
  try {
    return inflateSync(raw);
  } catch {
    return raw;
  }
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pdf-writer-attach-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('attach_file', () => {
  it('embeds a file with AFRelationship and a catalog /AF reference (PDF/A-3 §6.8)', async () => {
    const pdf = await basePdf('base.pdf');
    const csv = await attachmentFile('invoice.csv', '請求番号,金額\nINV-001,10000\n');

    const result = (await handleAttachFile({
      inputPath: pdf,
      attachmentPath: csv,
      description: '請求データ（機械可読）',
      relationship: 'Data',
      returnBase64: true,
    })) as AttachResult;

    expect(result.attachment).toEqual({
      name: 'invoice.csv',
      bytes: Buffer.byteLength('請求番号,金額\nINV-001,10000\n', 'utf8'),
      mimeType: 'text/csv',
      relationship: 'Data',
    });
    expect(result.attachments).toEqual(['invoice.csv']);

    const doc = await load(result);
    // PDF/A-3 は catalog /AF での参照を要求する
    expect(doc.catalog.lookup(PDFName.of('AF'))).toBeInstanceOf(PDFArray);

    const files = listEmbeddedFiles(doc);
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe('invoice.csv');
    expect(files[0].description).toBe('請求データ（機械可読）'); // 日本語が往復する
    expect(files[0].relationship).toBe('Data');
    expect(files[0].mimeType).toBe('text/csv');
  });

  it('keeps the attached bytes intact', async () => {
    const pdf = await basePdf('bytes.pdf');
    const content = '請求番号,金額,税率\nINV-002,20000,10\n';
    const csv = await attachmentFile('data.csv', content);

    const result = (await handleAttachFile({
      inputPath: pdf,
      attachmentPath: csv,
      relationship: 'Data',
      returnBase64: true,
    })) as AttachResult;

    const doc = await load(result);
    expect(readAttachmentBytes(doc).toString('utf8')).toBe(content);
  });

  it('warns when relationship is omitted — PDF/A-3 needs a meaningful one', async () => {
    const pdf = await basePdf('warn.pdf');
    const csv = await attachmentFile('plain.csv', 'a,b\n1,2\n');

    const result = (await handleAttachFile({
      inputPath: pdf,
      attachmentPath: csv,
      returnBase64: true,
    })) as AttachResult;

    expect(result.attachment.relationship).toBe('Unspecified');
    expect(result.warnings?.join(' ')).toMatch(/PDF\/A-3 requires a meaningful AFRelationship/);
  });

  it('supports multiple attachments and lists them', async () => {
    const pdf = await basePdf('multi.pdf');
    const csv = await attachmentFile('one.csv', 'a\n1\n');
    const xml = await attachmentFile('two.xml', '<invoice/>');

    const first = (await handleAttachFile({
      inputPath: pdf,
      attachmentPath: csv,
      relationship: 'Data',
      outputPath: join(dir, 'multi-1.pdf'),
    })) as AttachResult;
    const second = (await handleAttachFile({
      inputPath: first.path as string,
      attachmentPath: xml,
      relationship: 'Source',
      returnBase64: true,
    })) as AttachResult;

    expect(second.attachments.sort()).toEqual(['one.csv', 'two.xml']);
    expect(listEmbeddedFiles(await load(second))).toHaveLength(2);
  });

  it('renames the attachment when "name" is given', async () => {
    const pdf = await basePdf('rename.pdf');
    const csv = await attachmentFile('ugly-temp-name.csv', 'a\n1\n');

    const result = (await handleAttachFile({
      inputPath: pdf,
      attachmentPath: csv,
      name: '請求データ.csv',
      relationship: 'Data',
      returnBase64: true,
    })) as AttachResult;

    expect(result.attachment.name).toBe('請求データ.csv');
    expect(listEmbeddedFiles(await load(result))[0].name).toBe('請求データ.csv');
  });

  it('rejects a duplicate name — name tree keys must be unique', async () => {
    const pdf = await basePdf('dup.pdf');
    const csv = await attachmentFile('dup.csv', 'a\n1\n');

    const first = (await handleAttachFile({
      inputPath: pdf,
      attachmentPath: csv,
      relationship: 'Data',
      outputPath: join(dir, 'dup-1.pdf'),
    })) as AttachResult;

    await expect(
      handleAttachFile({
        inputPath: first.path as string,
        attachmentPath: csv,
        relationship: 'Data',
      }),
    ).rejects.toThrow(/already exists/);
  });

  it('rejects a missing file and an unknown relationship', async () => {
    const pdf = await basePdf('bad.pdf');
    await expect(
      handleAttachFile({ inputPath: pdf, attachmentPath: '/nope/missing.csv' }),
    ).rejects.toThrow(/Cannot read the file to attach/);

    const csv = await attachmentFile('ok.csv', 'a\n1\n');
    await expect(
      handleAttachFile({ inputPath: pdf, attachmentPath: csv, relationship: 'Related' }),
    ).rejects.toThrow(/relationship/);
  });
});

describe('guessMimeType', () => {
  it('maps the formats that matter for invoices and bookkeeping', () => {
    expect(guessMimeType('invoice.csv')).toBe('text/csv');
    expect(guessMimeType('invoice.XML')).toBe('application/xml'); // 拡張子は大文字でも効く
    expect(guessMimeType('data.json')).toBe('application/json');
    expect(guessMimeType('book.xlsx')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  });

  it('falls back to octet-stream for unknown extensions', () => {
    expect(guessMimeType('weird.qqq')).toBe('application/octet-stream');
    expect(guessMimeType('noext')).toBe('application/octet-stream');
  });
});

describe.skipIf(!process.env.TEST_FONT_PATH)('attachments and tagged PDFs', () => {
  it('does not disturb a tagged document', async () => {
    const path = join(dir, 'tagged.pdf');
    await handleCreateTextPdf({
      text: '本文です。',
      title: 'タグ付き文書',
      tagged: true,
      lang: 'ja',
      fontPath: process.env.TEST_FONT_PATH,
      outputPath: path,
    });
    const csv = await attachmentFile('tagged-data.csv', 'a\n1\n');

    const result = (await handleAttachFile({
      inputPath: path,
      attachmentPath: csv,
      relationship: 'Data',
      returnBase64: true,
    })) as AttachResult;
    const doc = await load(result);

    // 構造木はそのまま残る（veraPDF ua1 でも COMPLIANT を確認済み）
    expect(doc.catalog.lookup(PDFName.of('StructTreeRoot'))).toBeInstanceOf(PDFDict);
    expect(listEmbeddedFiles(doc)).toHaveLength(1);
  });
});
