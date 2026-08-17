/**
 * しおり（§12.3.3）を COS の上に置き直したもののテスト。
 *
 * 旧実装（`outline-pdflib.ts`）とはオラクルの digest で突き合わせてあり、
 * `tree`（`/Outlines` の木も `/Info` も）は 3 つの形で完全一致した（handoff §3.15）。
 * ここで固定するのは**条文が要求する形**と、**意図して変えた 1 点**である。
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type CosObject, dictGet, writeFile as writeCos } from 'normativepdf';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openForEdit } from '../src/services/edit-open.js';
import { countBookmarks, setBookmarks } from '../src/services/outline.js';
import { saveOpened } from '../src/services/output-edited.js';

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pwm-outline-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const nm = (value: string) => ({ kind: 'name', value }) as const;
const iv = (value: number) => ({ kind: 'integer', value }) as const;
const rf = (objectNumber: number) => ({ kind: 'ref', objectNumber, generationNumber: 0 }) as const;
const dc = (entries: Record<string, unknown>) =>
  ({ kind: 'dict', entries: new Map(Object.entries(entries)) }) as never;
const ar = (items: unknown[]) => ({ kind: 'array', items }) as never;

/** 3 ページの最小文書 */
function threePages(): Uint8Array {
  const objects: unknown[] = [
    { objectNumber: 1, generationNumber: 0, object: dc({ Type: nm('Catalog'), Pages: rf(2) }) },
    {
      objectNumber: 2,
      generationNumber: 0,
      object: dc({ Type: nm('Pages'), Kids: ar([rf(3), rf(4), rf(5)]), Count: iv(3) }),
    },
  ];
  for (const n of [3, 4, 5]) {
    objects.push({
      objectNumber: n,
      generationNumber: 0,
      object: dc({
        Type: nm('Page'),
        Parent: rf(2),
        Resources: dc({}),
        MediaBox: ar([iv(0), iv(0), iv(400), iv(300)]),
      }),
    });
  }
  return writeCos(objects as never, dc({ Size: iv(6), Root: rf(1) }), { version: '1.7' });
}

/** しおりを付けて保存し、読み戻した文書を返す */
async function withBookmarks(fileName: string, bookmarks: Parameters<typeof setBookmarks>[1]) {
  const input = join(dir, `${fileName}.pdf`);
  const output = join(dir, `${fileName}-out.pdf`);
  await writeFile(input, threePages());
  const opened = await openForEdit(input, {});
  const total = await setBookmarks(opened.editor, bookmarks);
  await saveOpened(opened, { outputPath: output });
  const editor = (await openForEdit(output, {})).editor;
  const catalog = await editor.getCatalog();
  if (catalog.kind !== 'dict') throw new Error('no catalog');
  const outlines = await editor.resolve(dictGet(catalog, 'Outlines') as CosObject);
  return { editor, outlines, total, output };
}

/** 辞書であることを確かめて narrow する（違えばテストを落とす） */
function asDict(value: CosObject): Extract<CosObject, { kind: 'dict' }> {
  if (value.kind !== 'dict') throw new Error(`expected a dictionary, got ${value.kind}`);
  return value;
}

const get = async (
  editor: Awaited<ReturnType<typeof withBookmarks>>['editor'],
  d: CosObject,
  key: string,
): Promise<CosObject> => editor.resolve(dictGet(asDict(d), key) ?? { kind: 'null' });

describe('setBookmarks — 条文が要求する形（§12.3.3）', () => {
  it('catalog に /Outlines が付き、/Type と /First /Last を持つ', async () => {
    const { editor, outlines, total } = await withBookmarks('basic', [
      { title: '第 1 章', page: 1 },
      { title: '第 2 章', page: 3 },
    ]);
    expect(total).toBe(2);
    expect(outlines.kind).toBe('dict');
    if (outlines.kind !== 'dict') return;
    expect(dictGet(outlines, 'Type')).toEqual({ kind: 'name', value: 'Outlines' });
    // R-12.3.3-11 / -12: 間接参照であること
    expect(dictGet(outlines, 'First')?.kind).toBe('ref');
    expect(dictGet(outlines, 'Last')?.kind).toBe('ref');
    // R-12.3.3-16: 最上位項目の親はアウトライン辞書そのもの
    const first = asDict(await get(editor, outlines, 'First'));
    expect(dictGet(first, 'Parent')?.kind).toBe('ref');
    // R-12.3.3-17 / -18: 最初の項目に /Prev は無く /Next はある
    expect(dictGet(first, 'Prev')).toBeUndefined();
    expect(dictGet(first, 'Next')?.kind).toBe('ref');
  });

  it('/Count の符号と再帰手続き（R-12.3.3-21）', async () => {
    const { editor, outlines } = await withBookmarks('counts', [
      {
        title: '開いた章',
        page: 1,
        open: true,
        children: [
          { title: '子 1', page: 1 },
          // 閉じた枝: 中身は可視子孫に数えない
          { title: '閉じた子', page: 2, open: false, children: [{ title: '孫', page: 2 }] },
        ],
      },
    ]);
    if (outlines.kind !== 'dict') throw new Error('no outlines');
    const chapter = asDict(await get(editor, outlines, 'First'));
    // 直下の子 2 つ。閉じた子の孫は数えない → 2（開いているので正）
    expect(dictGet(chapter, 'Count')).toEqual({ kind: 'integer', value: 2 });
    const closed = asDict(await get(editor, await get(editor, chapter, 'First'), 'Next'));
    // 閉じた項目は負（絶対値 = 開いたときに可視になる数 = 1）
    expect(dictGet(closed, 'Count')).toEqual({ kind: 'integer', value: -1 });
    // ルートは可視項目の総数（章 1 + 子 2 = 3）
    expect(dictGet(outlines, 'Count')).toEqual({ kind: 'integer', value: 3 });
  });

  it('開いた項目が 1 つも無ければルートの /Count を省く（R-12.3.3-13）', async () => {
    const { outlines } = await withBookmarks('closed', [
      { title: '閉じた章', page: 1, open: false, children: [{ title: '子', page: 2 }] },
    ]);
    if (outlines.kind !== 'dict') throw new Error('no outlines');
    expect(dictGet(outlines, 'Count')).toBeUndefined();
    expect(dictGet(outlines, 'First')?.kind).toBe('ref');
  });
});

describe('setBookmarks — 断るもの', () => {
  it('存在しないページを指すしおりは断る', async () => {
    await expect(withBookmarks('badpage', [{ title: 'x', page: 9 }])).rejects.toThrow(/page 9/);
  });
});

describe('setBookmarks — 意図して変えたところ', () => {
  it('ASCII の題名はリテラル、日本語は UTF-16BE（旧は常に 16 進）', async () => {
    const { output } = await withBookmarks('titles', [
      { title: 'Chapter 1', page: 1 },
      { title: '第 1 章', page: 1 },
    ]);
    const text = Buffer.from(await readFile(output)).toString('latin1');
    // §7.9.2.2 はどちらの形も許す。writer の中で文字列の書き方を 1 つにするための差
    expect(text).toContain('(Chapter 1)');
    // 非 ASCII は BOM 付き UTF-16BE を **16 進文字列**で書く（2026-08-15 に直した。
    // それまではリテラルで書いており、同じ内容が八進エスケープの並びになっていた）
    expect(text).toMatch(/\/Title\s*<feff/i);
  });
});

describe('countBookmarks', () => {
  it('入れ子を含めて数える（文書には触らない）', () => {
    expect(
      countBookmarks([
        {
          title: 'a',
          page: 1,
          children: [
            { title: 'b', page: 1 },
            { title: 'c', page: 1 },
          ],
        },
        { title: 'd', page: 1 },
      ]),
    ).toBe(4);
  });
});
