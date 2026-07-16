/**
 * 既存構造木への注釈追記（PDF/UA 7.18.1-1 / 7.18.3-1）
 *
 * veraPDF は「Widget/PrinterMark/Link 以外の注釈は Annot タグに内包する」(7.18.1-1) と
 * 「注釈のあるページは /Tabs /S」(7.18.3-1) を要求する。ここではその構造を固定する。
 * CI に veraPDF は無いため、実際の準拠判定は手元の
 * `validate_conformance --flavour pdfua-1` で行うこと（v0.6.0 時点で COMPLIANT）。
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFArray, PDFDict, PDFDocument, PDFName, type PDFNumber } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isTagged } from '../src/services/struct-append.js';
import { handleAddAnnotation, handleCreateTextPdf } from '../src/tools/handlers.js';
import type { EditResult } from '../src/types/index.js';

const fontPath = process.env.TEST_FONT_PATH;
let dir: string;

async function load(result: EditResult): Promise<PDFDocument> {
  return PDFDocument.load(Buffer.from(result.base64 as string, 'base64'), {
    updateMetadata: false,
  });
}

/** 構造木の全 StructElem を集める */
function collectElems(doc: PDFDocument): PDFDict[] {
  const root = doc.catalog.lookup(PDFName.of('StructTreeRoot'));
  if (!(root instanceof PDFDict)) return [];
  const out: PDFDict[] = [];
  const seen = new Set<PDFDict>();
  const visit = (node: PDFDict): void => {
    if (seen.has(node)) return;
    seen.add(node);
    if (node.lookup(PDFName.of('S')) instanceof PDFName) out.push(node);
    const k = node.lookup(PDFName.of('K'));
    if (k instanceof PDFDict) visit(k);
    else if (k instanceof PDFArray) {
      for (let i = 0; i < k.size(); i++) {
        const kid = k.lookup(i);
        if (kid instanceof PDFDict) visit(kid);
      }
    }
  };
  visit(root);
  return out;
}

const tagOf = (e: PDFDict): string => (e.lookup(PDFName.of('S')) as PDFName).decodeText();

/** タグ付きの土台 PDF をファイルに書き出す */
async function taggedBase(name: string): Promise<string> {
  const path = join(dir, name);
  await handleCreateTextPdf({
    text: 'タグ付きの本文です。',
    title: 'テスト文書',
    tagged: true,
    lang: 'ja',
    fontPath,
    outputPath: path,
  });
  return path;
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pdf-writer-struct-append-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe.skipIf(!fontPath)('annotations in tagged PDFs', () => {
  const rect = { x1: 10, y1: 20, x2: 60, y2: 40 };

  it('nests the annotation in an Annot structure element (7.18.1-1)', async () => {
    const input = await taggedBase('base.pdf');
    const result = (await handleAddAnnotation({
      inputPath: input,
      page: 1,
      type: 'highlight',
      rect,
      contents: 'ここが重要',
      alt: '重要箇所のハイライト',
      returnBase64: true,
    })) as EditResult;
    const doc = await load(result);

    const annots = collectElems(doc).filter((e) => tagOf(e) === 'Annot');
    expect(annots).toHaveLength(1);

    // /Alt が付いている
    expect(annots[0].lookup(PDFName.of('Alt'))?.toString()).toContain('91CD'); // UTF-16BE の「重」
    // /K に OBJR があり、注釈オブジェクトを指す
    const objr = annots[0].lookup(PDFName.of('K')) as PDFDict;
    expect((objr.lookup(PDFName.of('Type')) as PDFName).decodeText()).toBe('OBJR');
    const target = objr.lookup(PDFName.of('Obj')) as PDFDict;
    expect((target.lookup(PDFName.of('Subtype')) as PDFName).decodeText()).toBe('Highlight');
  });

  it('sets /Tabs to /S on pages carrying annotations (7.18.3-1)', async () => {
    const input = await taggedBase('tabs.pdf');
    const result = (await handleAddAnnotation({
      inputPath: input,
      page: 1,
      type: 'text',
      rect,
      alt: '付箋',
      returnBase64: true,
    })) as EditResult;
    const doc = await load(result);
    expect((doc.getPage(0).node.lookup(PDFName.of('Tabs')) as PDFName).decodeText()).toBe('S');
  });

  it('registers the annotation in the ParentTree with a fresh key', async () => {
    const input = await taggedBase('parent-tree.pdf');
    const result = (await handleAddAnnotation({
      inputPath: input,
      page: 1,
      type: 'square',
      rect,
      alt: '枠',
      returnBase64: true,
    })) as EditResult;
    const doc = await load(result);

    const root = doc.catalog.lookup(PDFName.of('StructTreeRoot')) as PDFDict;
    const pt = root.lookup(PDFName.of('ParentTree')) as PDFDict;
    const nums = pt.lookup(PDFName.of('Nums')) as PDFArray;

    // キーは昇順（番号ツリーの要件・§7.9.7）
    const keys: number[] = [];
    for (let i = 0; i < nums.size(); i += 2) {
      keys.push((nums.lookup(i) as PDFNumber).asNumber());
    }
    expect(keys).toEqual([...keys].sort((a, b) => a - b));

    // 注釈の /StructParent が ParentTree のキーと対応する
    const annot = (doc.getPage(0).node.lookup(PDFName.of('Annots')) as PDFArray).lookup(
      0,
    ) as PDFDict;
    const key = (annot.lookup(PDFName.of('StructParent')) as PDFNumber).asNumber();
    expect(keys).toContain(key);

    // ParentTreeNextKey がそのキーの先に進んでいる
    const next = (root.lookup(PDFName.of('ParentTreeNextKey')) as PDFNumber).asNumber();
    expect(next).toBeGreaterThan(key);
  });

  it('warns when alt is omitted on a tagged document', async () => {
    const input = await taggedBase('warn.pdf');
    const result = (await handleAddAnnotation({
      inputPath: input,
      page: 1,
      type: 'text',
      rect,
      returnBase64: true,
    })) as EditResult;
    expect(result.warnings?.join(' ')).toMatch(/Pass "alt"/);
  });

  it('supports multiple annotations without breaking the tree', async () => {
    const input = await taggedBase('multi.pdf');
    const first = (await handleAddAnnotation({
      inputPath: input,
      page: 1,
      type: 'text',
      rect,
      alt: '1つ目',
      outputPath: join(dir, 'multi-1.pdf'),
    })) as EditResult;
    const second = (await handleAddAnnotation({
      inputPath: first.path as string,
      page: 1,
      type: 'square',
      rect: { x1: 70, y1: 20, x2: 120, y2: 40 },
      alt: '2つ目',
      returnBase64: true,
    })) as EditResult;

    const doc = await load(second);
    expect(collectElems(doc).filter((e) => tagOf(e) === 'Annot')).toHaveLength(2);

    // それぞれ別のキーを持つ
    const annots = doc.getPage(0).node.lookup(PDFName.of('Annots')) as PDFArray;
    const keys = [0, 1].map((i) =>
      ((annots.lookup(i) as PDFDict).lookup(PDFName.of('StructParent')) as PDFNumber).asNumber(),
    );
    expect(new Set(keys).size).toBe(2);
  });
});

describe.skipIf(!fontPath)('annotations in untagged PDFs', () => {
  it('leaves untagged documents alone — no structure tree is invented', async () => {
    const path = join(dir, 'untagged.pdf');
    await handleCreateTextPdf({ text: '本文', fontPath, outputPath: path });

    const result = (await handleAddAnnotation({
      inputPath: path,
      page: 1,
      type: 'text',
      rect: { x1: 10, y1: 20, x2: 60, y2: 40 },
      alt: '無視されるはず',
      returnBase64: true,
    })) as EditResult;
    const doc = await load(result);

    expect(doc.catalog.lookup(PDFName.of('StructTreeRoot'))).toBeUndefined();
    expect(doc.getPage(0).node.lookup(PDFName.of('Tabs'))).toBeUndefined();
    expect(result.warnings).toBeUndefined();
    // 注釈自体は付く
    expect((doc.getPage(0).node.lookup(PDFName.of('Annots')) as PDFArray).size()).toBe(1);
  });
});

describe('isTagged', () => {
  it('requires both StructTreeRoot and MarkInfo/Marked', async () => {
    const bare = await PDFDocument.create();
    bare.addPage([100, 100]);
    expect(isTagged(bare)).toBe(false);

    // StructTreeRoot だけでは足りない
    const partial = await PDFDocument.create();
    partial.addPage([100, 100]);
    partial.catalog.set(
      PDFName.of('StructTreeRoot'),
      partial.context.register(partial.context.obj({ Type: 'StructTreeRoot' })),
    );
    expect(isTagged(partial)).toBe(false);

    partial.catalog.set(PDFName.of('MarkInfo'), partial.context.obj({ Marked: true }));
    expect(isTagged(partial)).toBe(true);
  });
});
