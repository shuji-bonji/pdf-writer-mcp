/**
 * `/Info` へ書く 1 か所（§7.5.5 / §14.3.3）と、XMP 同期の入口の判定。
 *
 * `/Info` はトレーラの項目で**間接参照でも直接オブジェクトでもよい**。
 * 分岐が 2 か所にあると片方だけ直した状態が生まれるので、ここで 3 形すべてを固定する。
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type CosDict, dictGet, dictGetRaw, writeFile as writeCos } from 'normativepdf';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { textString } from '../src/services/cos.js';
import { textOf } from '../src/services/cos-read.js';
import { openForEdit } from '../src/services/edit-open.js';
import { setInfoEntries } from '../src/services/info-dict.js';
import { syncXmpWithInfo } from '../src/services/xmp-cos.js';

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pwm-info-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const nm = (value: string) => ({ kind: 'name', value }) as const;
const it2 = (value: number) => ({ kind: 'integer', value }) as const;
const rf = (objectNumber: number) => ({ kind: 'ref', objectNumber, generationNumber: 0 }) as const;
const dc = (entries: Record<string, unknown>) =>
  ({ kind: 'dict', entries: new Map(Object.entries(entries)) }) as never;

/** 1 ページの最小文書。`info` で `/Info` の形を選ぶ */
async function fixture(path: string, info: 'none' | 'ref' | 'direct'): Promise<void> {
  const objects = [
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
  ];
  if (info === 'ref') {
    objects.push({
      objectNumber: 4,
      generationNumber: 0,
      object: dc({ Title: textString('Original'), Producer: textString('fixture') }),
    });
  }
  const trailer = dc({
    Size: it2(objects.length + 1),
    Root: rf(1),
    ...(info === 'ref' ? { Info: rf(4) } : {}),
    ...(info === 'direct' ? { Info: dc({ Title: textString('Original') }) } : {}),
  });
  await writeFile(path, writeCos(objects, trailer, { version: '1.7' }));
}

const infoOf = async (path: string): Promise<CosDict> => {
  const opened = await openForEdit(path, {});
  const raw = dictGetRaw(opened.editor.trailer(), 'Info');
  if (raw === undefined) throw new Error('/Info が無い');
  const resolved = await opened.editor.resolve(raw);
  if (resolved.kind !== 'dict') throw new Error('/Info が辞書ではない');
  return resolved;
};

describe('setInfoEntries — §7.5.5 の 3 形', () => {
  it('`/Info` が無ければ作ってトレーラに繋ぐ', async () => {
    const path = join(dir, 'none.pdf');
    await fixture(path, 'none');
    const opened = await openForEdit(path, {});
    await setInfoEntries(opened.editor, [['Title', textString('新設')]]);
    const bytes = await opened.editor.save();
    const out = join(dir, 'none-out.pdf');
    await writeFile(out, bytes);
    expect(textOf(dictGet(await infoOf(out), 'Title'))).toBe('新設');
  });

  it('間接参照なら同じ番号を差し替え、他の項目は残す', async () => {
    const path = join(dir, 'ref.pdf');
    await fixture(path, 'ref');
    const opened = await openForEdit(path, {});
    await setInfoEntries(opened.editor, [['Title', textString('更新')]]);
    expect(opened.editor.changed().map((o) => o.objectNumber)).toEqual([4]);
    const out = join(dir, 'ref-out.pdf');
    await writeFile(out, await opened.editor.save());
    const info = await infoOf(out);
    expect(textOf(dictGet(info, 'Title'))).toBe('更新');
    expect(textOf(dictGet(info, 'Producer'))).toBe('fixture');
  });

  it('直接オブジェクトならトレーラの項目ごと差し替える', async () => {
    const path = join(dir, 'direct.pdf');
    await fixture(path, 'direct');
    const opened = await openForEdit(path, {});
    await setInfoEntries(opened.editor, [['Author', textString('著者')]]);
    const out = join(dir, 'direct-out.pdf');
    await writeFile(out, await opened.editor.save());
    const info = await infoOf(out);
    expect(textOf(dictGet(info, 'Title'))).toBe('Original');
    expect(textOf(dictGet(info, 'Author'))).toBe('著者');
  });

  it('値が undefined の鍵は触らない（未指定と空欄を区別する）', async () => {
    const path = join(dir, 'skip.pdf');
    await fixture(path, 'ref');
    const opened = await openForEdit(path, {});
    await setInfoEntries(opened.editor, [
      ['Title', undefined],
      ['Author', undefined],
    ]);
    expect(opened.editor.dirty).toBe(false);
  });
});

describe('syncXmpWithInfo — 入口の判定', () => {
  it('`/Metadata` が無ければ何もしない（警告も出ない）', async () => {
    const path = join(dir, 'noxmp.pdf');
    await fixture(path, 'ref');
    const opened = await openForEdit(path, {});
    const result = await syncXmpWithInfo(opened.editor);
    expect(result).toEqual({ updated: false, catalogTouched: false, warnings: [] });
    expect(opened.editor.dirty).toBe(false);
  });
});
