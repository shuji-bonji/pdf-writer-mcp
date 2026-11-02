/**
 * 生成 3 ツールの title と drawTitle（openspec/specs/create-title）の受入テスト
 *
 * 本文に題名を描くか（drawTitle）と、メタデータに書く題名を分けて確かめる。
 * タグ無し・標準フォント（ASCII）のものは TEST_FONT_PATH 無しでも走る。
 * タグ付きの構造木を見るものは日本語を描くので、フォントがあるときだけ走る。
 */

import { inflateSync } from 'node:zlib';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { handleCreateMarkdownPdf, handleCreateTextPdf } from '../src/tools/handlers.js';
import type { CreateResult } from '../src/types/index.js';

const fontPath = process.env.TEST_FONT_PATH;

const bytesOf = (result: CreateResult): Buffer => Buffer.from(result.base64 as string, 'base64');

async function load(result: CreateResult): Promise<PDFDocument> {
  return PDFDocument.load(bytesOf(result), { updateMetadata: false });
}

/**
 * 1 ページ目のコンテンツストリームに描かれた文字列を、描かれた順に返す。
 * 標準フォント（WinAnsi）は `<hex> Tj` で書かれるので、それを Latin-1 として読む。
 */
async function drawnStrings(result: CreateResult): Promise<string[]> {
  const doc = await load(result);
  const contents = doc.getPage(0).node.Contents();
  const streams: PDFRawStream[] = [];
  if (contents instanceof PDFRawStream) streams.push(contents);
  else if (contents instanceof PDFArray) {
    for (let i = 0; i < contents.size(); i++) {
      const s = contents.lookup(i);
      if (s instanceof PDFRawStream) streams.push(s);
    }
  }
  const out: string[] = [];
  for (const s of streams) {
    const raw = Buffer.from(s.getContents());
    let data: string;
    try {
      data = inflateSync(raw).toString('latin1');
    } catch {
      data = raw.toString('latin1');
    }
    for (const m of data.matchAll(/<([0-9A-Fa-f]*)>\s*Tj/g)) {
      out.push(Buffer.from(m[1], 'hex').toString('latin1'));
    }
    for (const m of data.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)) out.push(m[1]);
  }
  expect(
    out.length,
    'no text-showing operator found — the reader is not measuring',
  ).toBeGreaterThan(0);
  return out;
}

function readXmp(doc: PDFDocument): string {
  const meta = doc.catalog.lookup(PDFName.of('Metadata'));
  expect(meta, 'no /Metadata in catalog').toBeInstanceOf(PDFRawStream);
  return Buffer.from((meta as PDFRawStream).getContents()).toString('utf8');
}

function headingTags(doc: PDFDocument): string[] {
  const root = doc.catalog.lookup(PDFName.of('StructTreeRoot'));
  expect(root, 'no StructTreeRoot').toBeInstanceOf(PDFDict);
  const out: string[] = [];
  const seen = new Set<PDFDict>();
  const visit = (node: PDFDict): void => {
    if (seen.has(node)) return;
    seen.add(node);
    const s = node.lookup(PDFName.of('S'));
    if (s instanceof PDFName && /^H[1-6]$/.test(s.decodeText())) out.push(s.decodeText());
    const k = node.lookup(PDFName.of('K'));
    if (k instanceof PDFDict) visit(k);
    else if (k instanceof PDFArray) {
      for (let i = 0; i < k.size(); i++) {
        const kid = k.lookup(i);
        if (kid instanceof PDFDict) visit(kid);
      }
    }
  };
  visit(root as PDFDict);
  return out;
}

describe('SPEC-WRITER-CREATE-TITLE-002 title にもフォントに無い文字の扱いを当てる', () => {
  it('SPEC-WRITER-CREATE-TITLE-002 描かない title には標準フォントの検査を当てない', async () => {
    const result = (await handleCreateTextPdf({
      text: 'ASCII body.',
      title: '日本語の題名',
      drawTitle: false,
      returnBase64: true,
    })) as CreateResult;
    expect((await load(result)).getTitle()).toBe('日本語の題名');
  });
});

describe('SPEC-WRITER-CREATE-TITLE-004 既定では title を本文の先頭に描く', () => {
  it('SPEC-WRITER-CREATE-TITLE-004 drawTitle を渡さずに title 付きで生成する', async () => {
    const result = (await handleCreateTextPdf({
      text: 'Body paragraph.',
      title: 'Report Title',
      returnBase64: true,
    })) as CreateResult;
    const drawn = await drawnStrings(result);
    expect(drawn[0]).toBe('Report Title');
  });
});

describe('SPEC-WRITER-CREATE-TITLE-005 drawTitle が false なら title をメタデータにだけ書く', () => {
  it('SPEC-WRITER-CREATE-TITLE-005 drawTitle: false で title 付きで生成する', async () => {
    const result = (await handleCreateTextPdf({
      text: 'Body paragraph.',
      title: 'Report Title',
      drawTitle: false,
      returnBase64: true,
    })) as CreateResult;
    const drawn = await drawnStrings(result);
    expect(drawn.join('\n')).not.toContain('Report Title');
    expect(drawn[0]).toBe('Body paragraph.');
    expect((await load(result)).getTitle()).toBe('Report Title');
  });

  it.skipIf(!fontPath)(
    'SPEC-WRITER-CREATE-TITLE-005 題名と同じ H1 で始まる Markdown を、題名を描かずにタグ付きで生成する',
    async () => {
      const result = (await handleCreateMarkdownPdf({
        markdown: '# 報告書\n\n本文です。\n\n## 概要\n\n要約です。',
        title: '報告書',
        tagged: true,
        lang: 'ja',
        drawTitle: false,
        fontPath,
        returnBase64: true,
      })) as CreateResult;
      const doc = await load(result);
      expect(headingTags(doc).filter((t) => t === 'H1')).toHaveLength(1);
      expect(headingTags(doc)).toEqual(['H1', 'H2']);
      expect(readXmp(doc)).toMatch(/<dc:title>[\s\S]*?>報告書<\/rdf:li>[\s\S]*?<\/dc:title>/);
    },
  );
});

describe('SPEC-WRITER-CREATE-TITLE-003 タグ付きでは題名を最初の H1 として描き、本文の見出しはそれに続けて数える', () => {
  it.skipIf(!fontPath)(
    'SPEC-WRITER-CREATE-TITLE-003 題名を描かず H2 から始まる Markdown をタグ付きで生成する',
    async () => {
      const result = (await handleCreateMarkdownPdf({
        markdown: '## 概要\n\n本文。\n\n### 詳細\n\n本文。',
        title: '見出しの数え始め',
        tagged: true,
        lang: 'ja',
        drawTitle: false,
        fontPath,
        returnBase64: true,
      })) as CreateResult;
      expect(headingTags(await load(result))).toEqual(['H1', 'H2']);
    },
  );
});

describe('SPEC-WRITER-CREATE-TITLE-006 drawTitle が false でもタグ付きでは title を必須のままにする', () => {
  it('SPEC-WRITER-CREATE-TITLE-006 title を渡さず、drawTitle: false で tagged で生成する', async () => {
    await expect(
      handleCreateTextPdf({ text: 'Body.', tagged: true, drawTitle: false }),
    ).rejects.toThrow(/requires "title"/);
  });
});
