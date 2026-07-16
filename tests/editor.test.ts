/**
 * Tier A 編集ツールのテスト
 * フィクスチャは pdf-lib で都度生成する（フォント非依存・外部ツール非依存）。
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { containsSignature } from '../src/services/editor.js';
import {
  handleDeletePages,
  handleExtractPages,
  handleMergePdfs,
  handleReorderPages,
  handleRotatePages,
  handleSetMetadata,
  handleSplitPdf,
} from '../src/tools/handlers.js';
import type { EditResult, SplitResult } from '../src/types/index.js';

let dir: string;

/** ページ幅 100+n で n 番目（1 始まり）を識別できる PDF を作る */
async function makeFixture(
  name: string,
  pages: number,
  meta?: { title?: string },
): Promise<string> {
  const doc = await PDFDocument.create();
  for (let n = 1; n <= pages; n++) {
    doc.addPage([100 + n, 200]);
  }
  if (meta?.title) doc.setTitle(meta.title);
  const path = join(dir, name);
  await writeFile(path, await doc.save());
  return path;
}

async function loadResult(result: EditResult): Promise<PDFDocument> {
  const bytes = result.path
    ? await readFile(result.path)
    : Buffer.from(result.base64 as string, 'base64');
  return PDFDocument.load(bytes, { updateMetadata: false });
}

/** ページ幅からフィクスチャの元ページ番号列を復元する */
function pageIds(doc: PDFDocument): number[] {
  return doc.getPages().map((p) => Math.round(p.getSize().width - 100));
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pdf-writer-editor-'));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('set_metadata', () => {
  it('updates only the given fields and keeps others', async () => {
    const input = await makeFixture('meta.pdf', 1, { title: 'Original Title' });
    const result = (await handleSetMetadata({
      inputPath: input,
      author: 'shuji-bonji',
      keywords: ['pdf', 'mcp'],
    })) as EditResult;
    const doc = await loadResult(result);
    expect(doc.getAuthor()).toBe('shuji-bonji');
    expect(doc.getKeywords()).toContain('pdf');
    expect(doc.getTitle()).toBe('Original Title'); // 未指定フィールドは保持
  });

  it('rejects a call with no metadata fields', async () => {
    await expect(handleSetMetadata({ inputPath: '/tmp/x.pdf' })).rejects.toThrow(/at least one/);
  });
});

describe('merge_pdfs', () => {
  it('concatenates pages in order and keeps first file metadata', async () => {
    const a = await makeFixture('merge-a.pdf', 2, { title: 'Doc A' });
    const b = await makeFixture('merge-b.pdf', 3);
    const out = join(dir, 'merged.pdf');
    const result = (await handleMergePdfs({
      inputPaths: [a, b],
      outputPath: out,
    })) as EditResult;
    expect(result.pageCount).toBe(5);
    const doc = await loadResult(result);
    expect(doc.getTitle()).toBe('Doc A');
  });

  it('rejects fewer than 2 inputs', async () => {
    await expect(handleMergePdfs({ inputPaths: ['/tmp/only.pdf'] })).rejects.toThrow(/at least 2/);
  });
});

describe('split_pdf', () => {
  it('splits into one file per range with sequential names', async () => {
    const input = await makeFixture('split.pdf', 6);
    const result = (await handleSplitPdf({
      inputPath: input,
      ranges: ['1-2', '3-', '5'],
      outputDir: join(dir, 'parts'),
      prefix: 'chunk-',
    })) as SplitResult;
    expect(result.count).toBe(3);
    expect(result.files[0].pageCount).toBe(2);
    expect(result.files[1].pageCount).toBe(4);
    expect(result.files[2].pageCount).toBe(1);
    expect(result.files[0].path.endsWith('chunk-1.pdf')).toBe(true);
    const part2 = await PDFDocument.load(await readFile(result.files[1].path));
    expect(pageIds(part2)).toEqual([3, 4, 5, 6]);
  });
});

describe('extract_pages', () => {
  it('extracts pages preserving the requested order', async () => {
    const input = await makeFixture('extract.pdf', 5);
    const result = (await handleExtractPages({ inputPath: input, pages: '4,1-2' })) as EditResult;
    const doc = await loadResult(result);
    expect(pageIds(doc)).toEqual([4, 1, 2]);
  });
});

describe('delete_pages', () => {
  it('removes the given pages keeping original order', async () => {
    const input = await makeFixture('delete.pdf', 5);
    const result = (await handleDeletePages({ inputPath: input, pages: '1,4-5' })) as EditResult;
    const doc = await loadResult(result);
    expect(pageIds(doc)).toEqual([2, 3]);
  });

  it('rejects deleting every page', async () => {
    const input = await makeFixture('delete-all.pdf', 3);
    await expect(handleDeletePages({ inputPath: input, pages: '1-3' })).rejects.toThrow(
      /empty PDF/,
    );
  });
});

describe('reorder_pages', () => {
  it('reorders pages by the given permutation', async () => {
    const input = await makeFixture('reorder.pdf', 4);
    const result = (await handleReorderPages({
      inputPath: input,
      order: [4, 3, 2, 1],
    })) as EditResult;
    const doc = await loadResult(result);
    expect(pageIds(doc)).toEqual([4, 3, 2, 1]);
  });

  it('rejects non-permutations', async () => {
    const input = await makeFixture('reorder-bad.pdf', 3);
    await expect(handleReorderPages({ inputPath: input, order: [1, 2] })).rejects.toThrow(
      /exactly once/,
    );
    await expect(handleReorderPages({ inputPath: input, order: [1, 1, 2] })).rejects.toThrow(
      /more than once/,
    );
    await expect(handleReorderPages({ inputPath: input, order: [1, 2, 9] })).rejects.toThrow(
      /invalid page number/,
    );
  });
});

describe('rotate_pages', () => {
  it('rotates all pages by default and accumulates rotation', async () => {
    const input = await makeFixture('rotate.pdf', 2);
    const out = join(dir, 'rotated.pdf');
    await handleRotatePages({ inputPath: input, rotation: 90, outputPath: out });
    const result = (await handleRotatePages({ inputPath: out, rotation: 90 })) as EditResult;
    const doc = await loadResult(result);
    for (const p of doc.getPages()) {
      expect(p.getRotation().angle).toBe(180);
    }
  });

  it('rotates only the specified pages', async () => {
    const input = await makeFixture('rotate-partial.pdf', 3);
    const result = (await handleRotatePages({
      inputPath: input,
      rotation: 270,
      pages: '2',
    })) as EditResult;
    const doc = await loadResult(result);
    expect(doc.getPage(0).getRotation().angle).toBe(0);
    expect(doc.getPage(1).getRotation().angle).toBe(270);
    expect(doc.getPage(2).getRotation().angle).toBe(0);
  });

  it('rejects invalid rotation angles', async () => {
    await expect(handleRotatePages({ inputPath: '/tmp/x.pdf', rotation: 45 })).rejects.toThrow(
      /rotation must be one of/,
    );
  });
});

describe('signature guard', () => {
  it('detects /ByteRange in raw bytes', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([100, 100]);
    const clean = await doc.save();
    expect(containsSignature(clean)).toBe(false);
    const signedish = Buffer.concat([Buffer.from(clean), Buffer.from('\n/ByteRange [0 1 2 3]')]);
    expect(containsSignature(signedish)).toBe(true);
  });

  it('blocks editing signed-looking PDFs unless explicitly allowed', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([101, 200]);
    const bytes = await doc.save();
    // 末尾コメント的に /ByteRange を付与（pdf-lib は末尾ゴミがあってもパース可能）
    const path = join(dir, 'signed-ish.pdf');
    await writeFile(
      path,
      Buffer.concat([Buffer.from(bytes), Buffer.from('\n%/ByteRange [0 1 2 3]\n')]),
    );

    await expect(handleRotatePages({ inputPath: path, rotation: 90 })).rejects.toThrow(
      /digitally signed/,
    );

    const result = (await handleRotatePages({
      inputPath: path,
      rotation: 90,
      allowBreakingSignatures: true,
    })) as EditResult;
    expect(result.pageCount).toBe(1);
  });
});
