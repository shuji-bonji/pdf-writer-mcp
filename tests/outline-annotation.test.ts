/**
 * Tier A 第2波（しおり・注釈）のテスト
 * 生成した PDF を pdf-lib で読み戻し、辞書構造を直接検証する。
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type PDFArray,
  PDFDict,
  PDFDocument,
  type PDFHexString,
  PDFName,
  type PDFNumber,
} from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseHexColor } from '../src/services/annotation.js';
import { handleAddAnnotation, handleAddBookmarks } from '../src/tools/handlers.js';
import type { EditResult } from '../src/types/index.js';

let dir: string;

async function makeFixture(name: string, pages = 5): Promise<string> {
  const doc = await PDFDocument.create();
  for (let n = 1; n <= pages; n++) doc.addPage([200, 300]);
  const path = join(dir, name);
  await writeFile(path, await doc.save());
  return path;
}

async function loadResult(result: EditResult): Promise<PDFDocument> {
  return PDFDocument.load(Buffer.from(result.base64 as string, 'base64'), {
    updateMetadata: false,
  });
}

function outlineRoot(doc: PDFDocument): PDFDict {
  const root = doc.catalog.lookup(PDFName.of('Outlines'));
  expect(root, 'no /Outlines in catalog').toBeInstanceOf(PDFDict);
  return root as PDFDict;
}

/** アウトラインの兄弟チェーンを /First → /Next で辿る */
function walkSiblings(parent: PDFDict): PDFDict[] {
  const out: PDFDict[] = [];
  let cur = parent.lookup(PDFName.of('First'));
  while (cur instanceof PDFDict) {
    out.push(cur);
    const next = cur.lookup(PDFName.of('Next'));
    cur = next instanceof PDFDict ? next : undefined;
  }
  return out;
}

const titleOf = (d: PDFDict): string =>
  (d.lookup(PDFName.of('Title')) as PDFHexString).decodeText();

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pdf-writer-outline-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('add_bookmarks', () => {
  it('builds a flat outline with correct links and destinations', async () => {
    const input = await makeFixture('bm-flat.pdf');
    const result = (await handleAddBookmarks({
      inputPath: input,
      bookmarks: [
        { title: '第1章 概要', page: 1 },
        { title: '第2章 実装', page: 3 },
      ],
    })) as EditResult;

    const doc = await loadResult(result);
    const root = outlineRoot(doc);
    const items = walkSiblings(root);

    expect(items).toHaveLength(2);
    expect(titleOf(items[0])).toBe('第1章 概要'); // 日本語が UTF-16BE で往復する
    expect(titleOf(items[1])).toBe('第2章 実装');

    // 双方向リンク
    expect(items[0].lookup(PDFName.of('Prev'))).toBeUndefined();
    expect(items[1].lookup(PDFName.of('Prev'))).toBe(items[0]);
    expect(items[1].lookup(PDFName.of('Next'))).toBeUndefined();

    // /Dest が正しいページを指す
    const dest = items[1].lookup(PDFName.of('Dest')) as PDFArray;
    expect(dest.lookup(0)).toBe(doc.getPage(2).node);
    expect((dest.lookup(1) as PDFName).decodeText()).toBe('XYZ');

    // ルートの /Count = 可視な子孫数
    expect((root.lookup(PDFName.of('Count')) as PDFNumber).asNumber()).toBe(2);
  });

  it('nests children and signs /Count by open state', async () => {
    const input = await makeFixture('bm-nested.pdf');
    const result = (await handleAddBookmarks({
      inputPath: input,
      bookmarks: [
        {
          title: 'Open parent',
          page: 1,
          children: [
            { title: 'child 1', page: 2 },
            { title: 'child 2', page: 3 },
          ],
        },
        { title: 'Closed parent', page: 4, open: false, children: [{ title: 'hidden', page: 5 }] },
      ],
    })) as EditResult;

    const doc = await loadResult(result);
    const root = outlineRoot(doc);
    const [openParent, closedParent] = walkSiblings(root);

    // 開いた親: 正の子孫数
    expect((openParent.lookup(PDFName.of('Count')) as PDFNumber).asNumber()).toBe(2);
    // 閉じた親: 負の子孫数（ISO 32000-1 §12.3.3）
    expect((closedParent.lookup(PDFName.of('Count')) as PDFNumber).asNumber()).toBe(-1);

    const children = walkSiblings(openParent);
    expect(children.map(titleOf)).toEqual(['child 1', 'child 2']);
    // 子は親を指す
    expect(children[0].lookup(PDFName.of('Parent'))).toBe(openParent);

    // ルート /Count は閉じた親の子を数えない: 1 + 2(開いた子) + 1 = 4
    expect((root.lookup(PDFName.of('Count')) as PDFNumber).asNumber()).toBe(4);
  });

  it('replaces existing bookmarks rather than appending', async () => {
    const input = await makeFixture('bm-replace.pdf');
    const first = (await handleAddBookmarks({
      inputPath: input,
      bookmarks: [{ title: 'old', page: 1 }],
      outputPath: join(dir, 'bm-replace-out.pdf'),
    })) as EditResult;

    const second = (await handleAddBookmarks({
      inputPath: first.path as string,
      bookmarks: [{ title: 'new', page: 1 }],
    })) as EditResult;

    const doc = await loadResult(second);
    const items = walkSiblings(outlineRoot(doc));
    expect(items.map(titleOf)).toEqual(['new']);
  });

  it('rejects out-of-range pages and malformed input', async () => {
    const input = await makeFixture('bm-bad.pdf', 2);
    await expect(
      handleAddBookmarks({ inputPath: input, bookmarks: [{ title: 'x', page: 9 }] }),
    ).rejects.toThrow(/page 9.*2 page/);
    await expect(handleAddBookmarks({ inputPath: input, bookmarks: [] })).rejects.toThrow(
      /non-empty array/,
    );
    await expect(
      handleAddBookmarks({ inputPath: input, bookmarks: [{ title: '', page: 1 }] }),
    ).rejects.toThrow(/title/);
    await expect(
      handleAddBookmarks({ inputPath: input, bookmarks: [{ title: 'x', page: 0 }] }),
    ).rejects.toThrow(/positive integer/);
  });
});

describe('add_annotation', () => {
  const rect = { x1: 10, y1: 20, x2: 60, y2: 40 };

  it('adds a text annotation with Japanese contents', async () => {
    const input = await makeFixture('an-text.pdf');
    const result = (await handleAddAnnotation({
      inputPath: input,
      page: 2,
      type: 'text',
      rect,
      contents: 'これは付箋です',
      author: 'shuji-bonji',
    })) as EditResult;

    const doc = await loadResult(result);
    const annots = doc.getPage(1).node.lookup(PDFName.of('Annots')) as PDFArray;
    expect(annots.size()).toBe(1);

    const a = annots.lookup(0) as PDFDict;
    expect((a.lookup(PDFName.of('Subtype')) as PDFName).decodeText()).toBe('Text');
    expect((a.lookup(PDFName.of('Contents')) as PDFHexString).decodeText()).toBe('これは付箋です');
    expect((a.lookup(PDFName.of('T')) as PDFHexString).decodeText()).toBe('shuji-bonji');
    expect((a.lookup(PDFName.of('Name')) as PDFName).decodeText()).toBe('Note');
    // 他ページには付かない
    expect(doc.getPage(0).node.lookup(PDFName.of('Annots'))).toBeUndefined();
  });

  it('adds a highlight with QuadPoints', async () => {
    const input = await makeFixture('an-hl.pdf');
    const result = (await handleAddAnnotation({
      inputPath: input,
      page: 1,
      type: 'highlight',
      rect,
      color: '#00ff00',
    })) as EditResult;

    const doc = await loadResult(result);
    const a = (doc.getPage(0).node.lookup(PDFName.of('Annots')) as PDFArray).lookup(0) as PDFDict;
    expect((a.lookup(PDFName.of('Subtype')) as PDFName).decodeText()).toBe('Highlight');

    const quad = a.lookup(PDFName.of('QuadPoints')) as PDFArray;
    expect(quad.size()).toBe(8);
    const nums = Array.from({ length: 8 }, (_, i) => (quad.lookup(i) as PDFNumber).asNumber());
    expect(nums).toEqual([10, 40, 60, 40, 10, 20, 60, 20]);

    const c = a.lookup(PDFName.of('C')) as PDFArray;
    expect((c.lookup(1) as PDFNumber).asNumber()).toBeCloseTo(1);
  });

  it('appends to existing annotations on the same page', async () => {
    const input = await makeFixture('an-multi.pdf');
    const first = (await handleAddAnnotation({
      inputPath: input,
      page: 1,
      type: 'square',
      rect,
      outputPath: join(dir, 'an-multi-out.pdf'),
    })) as EditResult;
    const second = (await handleAddAnnotation({
      inputPath: first.path as string,
      page: 1,
      type: 'text',
      rect: { x1: 70, y1: 20, x2: 90, y2: 40 },
    })) as EditResult;

    const doc = await loadResult(second);
    const annots = doc.getPage(0).node.lookup(PDFName.of('Annots')) as PDFArray;
    expect(annots.size()).toBe(2);
  });

  it('rejects invalid input', async () => {
    const input = await makeFixture('an-bad.pdf', 2);
    await expect(
      handleAddAnnotation({ inputPath: input, page: 9, type: 'text', rect }),
    ).rejects.toThrow(/out of range/);
    await expect(
      handleAddAnnotation({ inputPath: input, page: 1, type: 'circle', rect }),
    ).rejects.toThrow(/type must be one of/);
    await expect(
      handleAddAnnotation({
        inputPath: input,
        page: 1,
        type: 'text',
        rect: { x1: 60, y1: 20, x2: 10, y2: 40 },
      }),
    ).rejects.toThrow(/x1 < x2/);
    await expect(
      handleAddAnnotation({ inputPath: input, page: 1, type: 'text', rect, color: 'red' }),
    ).rejects.toThrow(/hex string/);
  });
});

describe('parseHexColor', () => {
  it('accepts #rgb and #rrggbb', () => {
    expect(parseHexColor('#f00')).toEqual({ type: 'RGB', red: 1, green: 0, blue: 0 });
    expect(parseHexColor('00ff00')).toEqual({ type: 'RGB', red: 0, green: 1, blue: 0 });
  });
  it('rejects garbage', () => {
    expect(() => parseHexColor('#ff')).toThrow(/hex string/);
  });
});
