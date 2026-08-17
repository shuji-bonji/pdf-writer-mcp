/**
 * DocMDP（§12.8.2.2）の判定を COS の上に置き直したもののテスト。
 *
 * 旧実装（`incremental.ts` の pdf-lib 版）と**同じ 7 つの形**で突き合わせて
 * 一致することを確かめてから書いた（handoff §3.14）。ここではその形を固定する。
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFile as writeCos } from 'normativepdf';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertDocMdpAllows, findDocMdpPermission } from '../src/services/doc-mdp.js';
import { openForEdit } from '../src/services/edit-open.js';

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pwm-mdp-'));
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
const ar = (items: unknown[]) => ({ kind: 'array', items }) as never;
const lit = (s: string) =>
  ({ kind: 'string', bytes: new Uint8Array(Buffer.from(s, 'latin1')), form: 'literal' }) as const;

type Shape = 'none' | 'approval' | 'p1' | 'p2' | 'p3' | 'no-p' | 'nested';

/** 署名フィールドの形だけを変えた 1 ページの文書 */
function build(shape: Shape): Uint8Array {
  const objects: unknown[] = [
    { objectNumber: 2, generationNumber: 0, object: dc({ Type: nm('Pages'), Kids: ar([rf(3)]), Count: it2(1) }) },
    {
      objectNumber: 3,
      generationNumber: 0,
      object: dc({
        Type: nm('Page'),
        Parent: rf(2),
        Resources: dc({}),
        MediaBox: ar([it2(0), it2(0), it2(400), it2(300)]),
      }),
    },
  ];
  let catalog = dc({ Type: nm('Catalog'), Pages: rf(2) });
  let size = 4;

  if (shape !== 'none') {
    const params =
      shape === 'no-p'
        ? dc({ Type: nm('TransformParams'), V: nm('1.2') })
        : dc({ Type: nm('TransformParams'), P: it2(shape === 'nested' ? 1 : Number(shape.slice(1))), V: nm('1.2') });
    const sigRef =
      shape === 'approval'
        ? dc({ TransformMethod: nm('FieldMDP'), TransformParams: dc({ Type: nm('TransformParams') }) })
        : dc({ TransformMethod: nm('DocMDP'), TransformParams: params });
    const value = dc({ Type: nm('Sig'), Filter: nm('Adobe.PPKLite'), Reference: ar([sigRef]) });
    const leaf = dc({ FT: nm('Sig'), T: lit('Signature1'), V: value });
    objects.push({
      objectNumber: size,
      generationNumber: 0,
      // nested: 親フィールドの /Kids の下に署名を置き、走査が降りることを測る
      object: shape === 'nested' ? dc({ T: lit('Parent'), Kids: ar([leaf]) }) : leaf,
    });
    catalog = dc({
      Type: nm('Catalog'),
      Pages: rf(2),
      AcroForm: dc({ Fields: ar([rf(size)]), SigFlags: it2(3) }),
    });
    size += 1;
  }

  objects.unshift({ objectNumber: 1, generationNumber: 0, object: catalog });
  return writeCos(objects as never, dc({ Size: it2(size), Root: rf(1) }), { version: '1.7' });
}

async function open(shape: Shape) {
  const path = join(dir, `${shape}.pdf`);
  await writeFile(path, build(shape));
  return (await openForEdit(path, { allowBreakingSignatures: true })).editor;
}

describe('findDocMdpPermission — 許可レベルを探す（§12.8.2.2）', () => {
  it.each([
    ['署名が無い', 'none', undefined],
    ['承認署名だけ（TransformMethod が DocMDP でない）', 'approval', undefined],
    ['P=1', 'p1', 1],
    ['P=2', 'p2', 2],
    ['P=3', 'p3', 3],
    ['P 省略 → Table 257 の既定 2', 'no-p', 2],
    ['/Kids の下にネストした署名', 'nested', 1],
  ] as const)('%s', async (_label, shape, expected) => {
    expect(await findDocMdpPermission(await open(shape))).toBe(expected);
  });
});

describe('assertDocMdpAllows — 断る／通す', () => {
  it('認証署名が無ければどの変更も通す', async () => {
    const editor = await open('none');
    for (const change of ['annotation', 'metadata-or-outline', 'structure', 'content'] as const) {
      await expect(assertDocMdpAllows(editor, change)).resolves.toBeUndefined();
    }
  });

  it('P=3 は注釈だけ通す', async () => {
    const editor = await open('p3');
    await expect(assertDocMdpAllows(editor, 'annotation')).resolves.toBeUndefined();
    await expect(assertDocMdpAllows(editor, 'metadata-or-outline')).rejects.toMatchObject({
      code: 'SIGNED_PDF',
    });
  });

  it('P=2 は注釈も断る（記入と署名だけが許される）', async () => {
    await expect(assertDocMdpAllows(await open('p2'), 'annotation')).rejects.toMatchObject({
      code: 'SIGNED_PDF',
    });
  });

  it('P=1 は「最終版」なので何も通さない', async () => {
    const editor = await open('p1');
    await expect(assertDocMdpAllows(editor, 'annotation')).rejects.toThrow(/declared the document final/);
  });
});
