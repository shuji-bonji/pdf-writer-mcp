/**
 * `rotate_pages` を新しい経路（normativepdf）へ移したあとのテスト。
 *
 * 検証の主眼:
 *   - `/Rotate`（§7.7.3.3 Table 31）の**継承**（§7.7.3.4）を解決して足す
 *   - 90 の倍数でない値は書かない（R-7.7.3.3-28）
 *   - **入力のヘッダの版を保つ**。旧実装（pdf-lib）は入力が %PDF-2.0 でも
 *     %PDF-1.7 を書いていた（catalog /Version も足さないので実効版が下がる）
 *   - **入力の相互参照の形を保つ**。旧実装は古典テーブルの文書にも
 *     オブジェクトストリーム + 相互参照ストリームを足していた
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type CosObject, dictGet, PdfDocumentEditor, writeFile as writeCos } from 'normativepdf';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rotatePages } from '../src/services/page-rotate.js';

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pwm-rotate-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const name = (value: string) => ({ kind: 'name', value }) as const;
const int = (value: number) => ({ kind: 'integer', value }) as const;
const ref = (objectNumber: number) => ({ kind: 'ref', objectNumber, generationNumber: 0 }) as const;
const dict = (entries: Record<string, unknown>) =>
  ({ kind: 'dict', entries: new Map(Object.entries(entries)) }) as never;
const box = { kind: 'array', items: [int(0), int(0), int(612), int(792)] } as const;

/**
 * 2 ページの文書。`rootRotate` を渡すと**親ノード**に `/Rotate` を置く
 * （§7.7.3.4 の継承を測るため）。`pageRotate` はページ 1 自身に置く。
 */
function twoPagePdf(
  opts: { version?: string; rootRotate?: number; pageRotate?: number } = {},
): Uint8Array {
  const pagesEntries: Record<string, unknown> = {
    Type: name('Pages'),
    Kids: { kind: 'array', items: [ref(3), ref(4)] },
    Count: int(2),
  };
  if (opts.rootRotate !== undefined) pagesEntries.Rotate = int(opts.rootRotate);

  const page = (own?: number) => {
    const e: Record<string, unknown> = {
      Type: name('Page'),
      Parent: ref(2),
      Resources: dict({}),
      MediaBox: box,
    };
    if (own !== undefined) e.Rotate = int(own);
    return dict(e);
  };

  return writeCos(
    [
      {
        objectNumber: 1,
        generationNumber: 0,
        object: dict({ Type: name('Catalog'), Pages: ref(2) }),
      },
      { objectNumber: 2, generationNumber: 0, object: dict(pagesEntries) },
      { objectNumber: 3, generationNumber: 0, object: page(opts.pageRotate) },
      { objectNumber: 4, generationNumber: 0, object: page() },
    ],
    dict({ Size: int(5), Root: ref(1) }),
    { version: opts.version ?? '1.7' },
  );
}

async function write(fileName: string, bytes: Uint8Array): Promise<string> {
  const path = join(dir, fileName);
  await writeFile(path, bytes);
  return path;
}

/** 出力を開いて、各ページの実効 `/Rotate`（継承込み）を読む */
async function rotationsOf(path: string): Promise<(number | undefined)[]> {
  const editor = await PdfDocumentEditor.open(new Uint8Array(await readFile(path)));
  const pages = await editor.pages();
  const out: (number | undefined)[] = [];
  for (let i = 0; i < pages.length; i++) {
    const value = await editor.pageAttribute(i, 'Rotate');
    out.push(value?.kind === 'integer' ? value.value : undefined);
  }
  return out;
}

describe('rotate_pages — /Rotate の計算', () => {
  it('全ページに足す', async () => {
    const input = await write('all.pdf', twoPagePdf());
    const out = join(dir, 'all-out.pdf');
    const result = await rotatePages(input, 90, undefined, { outputPath: out });
    expect(result.pageCount).toBe(2);
    expect(await rotationsOf(out)).toEqual([90, 90]);
  });

  it('ページを指定すると、そのページだけに足す', async () => {
    const input = await write('some.pdf', twoPagePdf());
    const out = join(dir, 'some-out.pdf');
    await rotatePages(input, 180, '2', { outputPath: out });
    expect(await rotationsOf(out)).toEqual([undefined, 180]);
  });

  it('既にある値に足す（累積する）', async () => {
    const input = await write('acc.pdf', twoPagePdf({ pageRotate: 90 }));
    const out = join(dir, 'acc-out.pdf');
    await rotatePages(input, 90, '1', { outputPath: out });
    expect((await rotationsOf(out))[0]).toBe(180);
  });

  it('親ノードから継承した値に足す（§7.7.3.4）', async () => {
    const input = await write('inherit.pdf', twoPagePdf({ rootRotate: 270 }));
    const out = join(dir, 'inherit-out.pdf');
    await rotatePages(input, 90, '1', { outputPath: out });
    // 270 + 90 = 360 → 0。ページ 2 は親の 270 のまま
    expect(await rotationsOf(out)).toEqual([0, 270]);
  });

  it('90 の倍数でない値は書かない（R-7.7.3.3-28）', async () => {
    const input = await write('bad.pdf', twoPagePdf());
    await expect(
      rotatePages(input, 45, undefined, { outputPath: join(dir, 'never.pdf') }),
    ).rejects.toBeInstanceOf(RangeError);
  });
});

describe('rotate_pages — 入力の形を保つ', () => {
  it('ヘッダの版を保つ（旧実装は %PDF-1.7 を書いていた）', async () => {
    const input = await write('v20.pdf', twoPagePdf({ version: '2.0' }));
    const out = join(dir, 'v20-out.pdf');
    await rotatePages(input, 90, undefined, { outputPath: out });
    const head = Buffer.from(await readFile(out))
      .subarray(0, 8)
      .toString('latin1');
    expect(head).toBe('%PDF-2.0');
  });

  it('古典テーブルの入力にオブジェクトストリームを足さない', async () => {
    const input = await write('table.pdf', twoPagePdf());
    const out = join(dir, 'table-out.pdf');
    await rotatePages(input, 90, undefined, { outputPath: out });
    const bytes = await readFile(out);
    expect(bytes.includes(Buffer.from('/ObjStm'))).toBe(false);
    expect(bytes.includes(Buffer.from('/Type /XRef'))).toBe(false);
  });

  it('/Info の /ModDate は打たれる', async () => {
    const input = await write('mod.pdf', twoPagePdf());
    const out = join(dir, 'mod-out.pdf');
    await rotatePages(input, 90, undefined, { outputPath: out });
    const editor = await PdfDocumentEditor.open(new Uint8Array(await readFile(out)));
    const infoRaw = editor.trailer().entries.get('Info');
    expect(infoRaw).toBeDefined();
    const info = await editor.resolve(infoRaw as CosObject);
    expect(info.kind).toBe('dict');
    if (info.kind !== 'dict') return;
    expect(dictGet(info, 'ModDate')).toBeDefined();
  });
});
