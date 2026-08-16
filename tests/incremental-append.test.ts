/**
 * 増分更新の新しい出口（L4′.2 の 2 本目）のテスト。
 *
 * 判定は `tests/incremental.test.ts`（旧経路）と同じものを使う ——
 * 計器を新しく書くと、食い違ったときに相手を疑ってしまう。
 *
 *   1. 前方バイト同一（ADR-0005 の第一の受入基準・署名保持の必要十分条件）
 *   2. 追記部が `/Prev <旧 startxref>` を指す（§7.5.6）
 *   3. 新規オブジェクトが元 trailer の `/Size` 以上の番号を使う
 *   4. pdf-lib（独立した読み手）で読み戻して変更が見える
 *   5. `/ID` の第 1 要素は保持し、第 2 要素は変わる（§14.4）
 *   6. `origin > 0` でも 1〜5 が成り立つ（B-22 の回帰）
 *   7. 何も変えていない追記は断る（§7.5.6 は変更したオブジェクトを名指す節を定義している）
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type CosObject, dictGet, writeFile as writeCos } from 'normativepdf';
import { PDFArray, PDFDocument, PDFName } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openForEdit } from '../src/services/edit-open.js';
import { appendOpened } from '../src/services/incremental-append.js';
import { readPreviousSection } from '../src/services/incremental.js';

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pwm-append-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const nm = (value: string) => ({ kind: 'name', value }) as const;
const it2 = (value: number) => ({ kind: 'integer', value }) as const;
const rf = (objectNumber: number) =>
  ({ kind: 'ref', objectNumber, generationNumber: 0 }) as const;
const dc = (entries: Record<string, unknown>) =>
  ({ kind: 'dict', entries: new Map(Object.entries(entries)) }) as never;
const hx = (s: string) =>
  ({ kind: 'string', bytes: new Uint8Array(Buffer.from(s, 'latin1')), form: 'hex' }) as const;

/** `/ID` と「署名らしく見える印」を持つ 1 ページの文書。`junk` で origin を作る */
async function fixture(path: string, junk = 0): Promise<Uint8Array> {
  const body = writeCos(
    [
      { objectNumber: 1, generationNumber: 0, object: dc({ Type: nm('Catalog'), Pages: rf(2) }) },
      {
        objectNumber: 2,
        generationNumber: 0,
        object: dc({ Type: nm('Pages'), Kids: { kind: 'array', items: [rf(3)] }, Count: it2(1) }),
      },
      {
        objectNumber: 3,
        generationNumber: 0,
        object: dc({
          Type: nm('Page'),
          Parent: rf(2),
          Resources: dc({}),
          MediaBox: { kind: 'array', items: [it2(0), it2(0), it2(400), it2(300)] },
        }),
      },
    ],
    dc({
      Size: it2(4),
      Root: rf(1),
      ID: { kind: 'array', items: [hx('AAAAAAAAAAAAAAAA'), hx('BBBBBBBBBBBBBBBB')] },
    }),
    { version: '1.7' },
  );
  const parts = junk ? [Buffer.alloc(junk, 0x25), Buffer.from(body)] : [Buffer.from(body)];
  parts.push(Buffer.from('\n% /ByteRange [0 0 0 0]\n', 'latin1'));
  const bytes = Buffer.concat(parts);
  await writeFile(path, bytes);
  return new Uint8Array(bytes);
}

/** 注釈を 1 つ足して増分で保存する（測るのは出口なので、注釈は最小でよい） */
async function appendAnnot(input: string, output: string) {
  const opened = await openForEdit(input, { preserveSignatures: true });
  const page = (await opened.editor.pages())[0];
  if (page?.ref == null) throw new Error('fixture has no indirect page');
  const annot = await opened.editor.allocate(
    dc({
      Type: nm('Annot'),
      Subtype: nm('Text'),
      Rect: { kind: 'array', items: [it2(50), it2(200), it2(80), it2(230)] },
    }),
  );
  const updated = new Map(page.dict.entries);
  updated.set('Annots', { kind: 'array', items: [annot] } as never);
  opened.editor.set(
    page.ref.objectNumber,
    { kind: 'dict', entries: updated },
    page.ref.generationNumber,
  );
  return appendOpened(opened, { outputPath: output });
}

describe.each([
  ['origin = 0', 0],
  ['origin > 0（B-22 の回帰）', 137],
])('appendOpened — %s', (_label, junk) => {
  it('元のバイト列を残したまま追記し、独立した読み手が変更を見る', async () => {
    const input = join(dir, `in-${junk}.pdf`);
    const output = join(dir, `out-${junk}.pdf`);
    const original = await fixture(input, junk);

    const result = await appendAnnot(input, output);
    expect(result.incremental).toBe(true);

    const bytes = new Uint8Array(await readFile(output));
    // 1. 前方バイト同一
    expect(bytes.length).toBeGreaterThan(original.length);
    expect(
      Buffer.compare(Buffer.from(bytes.subarray(0, original.length)), Buffer.from(original)),
    ).toBe(0);

    const appended = Buffer.from(bytes.subarray(original.length)).toString('latin1');
    const section = await readPreviousSection(original);
    // 2. /Prev
    expect(appended).toContain(`/Prev ${section.startxref}`);
    // 3. 新規オブジェクトの番号
    for (const m of appended.matchAll(/(?:^|\n)(\d+) (\d+) obj\b/g)) {
      const start = m.index ?? 0;
      const end = appended.indexOf('endobj', start);
      const body = appended.slice(start, end > start ? end : start + 200);
      if (body.includes('/Type /Annot') || body.includes('/Type /XRef')) {
        expect(Number(m[1])).toBeGreaterThanOrEqual(section.size);
      }
    }
    // 4. 独立した読み手
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    const annots = doc.getPage(0).node.lookup(PDFName.of('Annots'));
    expect(annots).toBeInstanceOf(PDFArray);
    expect((annots as PDFArray).size()).toBe(1);
  });

  it('/ID は第 1 要素を保ち、第 2 要素を変える（§14.4）', async () => {
    const input = join(dir, `id-${junk}.pdf`);
    const output = join(dir, `id-out-${junk}.pdf`);
    await fixture(input, junk);
    await appendAnnot(input, output);

    const editor = (await openForEdit(output, { allowBreakingSignatures: true })).editor;
    const id = dictGet(editor.trailer(), 'ID') as CosObject | undefined;
    expect(id?.kind).toBe('array');
    if (id?.kind !== 'array') return;
    const text = id.items.map((x) =>
      x.kind === 'string' ? Buffer.from(x.bytes).toString('latin1') : '?',
    );
    expect(text[0]).toBe('AAAAAAAAAAAAAAAA');
    expect(text[1]).not.toBe('BBBBBBBBBBBBBBBB');
  });
});

describe('appendOpened — 断るもの', () => {
  it('何も変えていない追記は断る（§7.5.6）', async () => {
    const input = join(dir, 'nochange.pdf');
    await fixture(input);
    const opened = await openForEdit(input, { allowBreakingSignatures: true });
    await expect(
      appendOpened(opened, { outputPath: join(dir, 'never.pdf') }),
    ).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });
});
