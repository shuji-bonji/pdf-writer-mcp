/**
 * 新しい入口と出口（L4′.1）のテスト。
 *
 * 検証の主眼:
 *   - 鎖が歩き切れる文書は `xref.kind === 'chain'` で開き、保存して読み戻せる
 *   - **trailer に `/Encrypt` があれば断る**。normativepdf はオブジェクトストリームを
 *     読む段でしか暗号化を名指さないので、古典 xref の暗号化文書は素通りする。
 *     ここが writer 側のガードで、旧入口（pdf-lib の例外文言を見ていた）の代わり
 *   - **`/Prev 0` で鎖が切れた文書を回復する**。回復しないと `pages()` が
 *     例外を投げずに 0 件を返す（ページ添字から始まる編集ツールが黙って何もしない形）
 *   - **回復した文書の全書き直しは断る**。重ねる順は推量なので、出力に焼き付けない
 *
 * フィクスチャは normativepdf の `writeFile` で組む（家の作法どおり、入力は
 * テスト側が生産する）。増分の節だけは「壊れた形」を作るために手で書く。
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type CosObject, writeFile as writeCos } from 'normativepdf';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PdfWriterError } from '../src/errors.js';
import { openForEdit } from '../src/services/edit-open.js';
import { saveOpened } from '../src/services/output-edited.js';

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pwm-l41-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const name = (value: string) => ({ kind: 'name', value }) as const;
const int = (value: number) => ({ kind: 'integer', value }) as const;
const ref = (objectNumber: number) => ({ kind: 'ref', objectNumber, generationNumber: 0 }) as const;
const dict = (entries: Record<string, unknown>) =>
  ({ kind: 'dict', entries: new Map(Object.entries(entries)) }) as never;

/** 1 ページの最小文書。`extraTrailer` はトレーラに足す項目 */
function minimalPdf(extraTrailer: Record<string, unknown> = {}): Uint8Array {
  const objects = [
    {
      objectNumber: 1,
      generationNumber: 0,
      object: dict({ Type: name('Catalog'), Pages: ref(2) }),
    },
    {
      objectNumber: 2,
      generationNumber: 0,
      object: dict({
        Type: name('Pages'),
        Kids: { kind: 'array', items: [ref(3)] },
        Count: int(1),
      }),
    },
    {
      objectNumber: 3,
      generationNumber: 0,
      object: dict({
        Type: name('Page'),
        Parent: ref(2),
        // R-7.7.3.3-8: 何も要らないページは**空の辞書**を置く（項目ごと落とすと
        // 「祖先から継承する」の意味になり、R-7.7.3.4-2 に反する）
        Resources: dict({}),
        MediaBox: { kind: 'array', items: [int(0), int(0), int(612), int(792)] },
      }),
    },
  ];
  return writeCos(objects, dict({ Size: int(4), Root: ref(1), ...extraTrailer }), {
    version: '1.7',
  });
}

/** xref の項目 1 行（正確に 20 バイト = §7.5.4） */
const entryLine = (offset: number, generation: number, type: 'n' | 'f') =>
  `${String(offset).padStart(10, '0')} ${String(generation).padStart(5, '0')} ${type} \n`;

/**
 * `/Prev 0` で鎖が切れた 2 リビジョンの文書。
 * 最新の節はオブジェクト 4 しか載せないので、重ねないと catalog に届かない。
 */
function pdfWithBrokenChain(): Uint8Array {
  const head = Buffer.from(minimalPdf());
  const obj4Offset = head.length;
  let tail = '4 0 obj\n<< /Type /Nothing >>\nendobj\n';
  const xrefOffset = head.length + tail.length;
  tail +=
    'xref\n' +
    `0 1\n${entryLine(0, 65535, 'f')}` +
    `4 1\n${entryLine(obj4Offset, 0, 'n')}` +
    'trailer\n<< /Size 5 /Root 1 0 R /Prev 0 >>\n' +
    `startxref\n${xrefOffset}\n%%EOF\n`;
  return new Uint8Array(Buffer.concat([head, Buffer.from(tail, 'latin1')]));
}

async function tmpPdf(fileName: string, bytes: Uint8Array): Promise<string> {
  const path = join(dir, fileName);
  await writeFile(path, bytes);
  return path;
}

describe('openForEdit — 鎖が歩き切れる文書', () => {
  it('xref.kind は chain で、ページが読める', async () => {
    const path = await tmpPdf('plain.pdf', minimalPdf());
    const opened = await openForEdit(path, {});
    expect(opened.xref.kind).toBe('chain');
    expect((await opened.editor.pages()).length).toBe(1);
  });

  it('saveOpened の出力は読み戻せて、/Info /ModDate が付く', async () => {
    const path = await tmpPdf('plain-save.pdf', minimalPdf());
    const opened = await openForEdit(path, {});
    const out = join(dir, 'plain-out.pdf');
    const result = await saveOpened(opened, { outputPath: out });
    expect(result.pageCount).toBe(1);

    const back = await openForEdit(out, {});
    const infoRaw = back.editor.trailer().entries.get('Info');
    expect(infoRaw).toBeDefined();
    const info = await back.editor.resolve(infoRaw as CosObject);
    expect(info.kind).toBe('dict');
    if (info.kind !== 'dict') return;
    expect(info.entries.get('ModDate')).toBeDefined();
  });
});

describe('openForEdit — 暗号化', () => {
  it('trailer に /Encrypt があれば ENCRYPTED_PDF で断る', async () => {
    // 🔴 この形（古典 xref・オブジェクトストリーム無し）は normativepdf が
    // 開けてしまう。断るのは writer の仕事である
    const path = await tmpPdf('encrypted.pdf', minimalPdf({ Encrypt: ref(9) }));
    await expect(openForEdit(path, {})).rejects.toMatchObject({ code: 'ENCRYPTED_PDF' });
  });
});

describe('openForEdit — 鎖が切れた文書の回復', () => {
  it('回復しなければページは 0 件に見える（回復の必要性を固定する）', async () => {
    const { PdfDocumentEditor } = await import('normativepdf');
    const editor = await PdfDocumentEditor.open(pdfWithBrokenChain());
    expect(editor.base.chainStop.kind).toBe('prev-zero');
    // 例外は出ない。**黙って 0 件**である
    expect((await editor.pages()).length).toBe(0);
  });

  it('openForEdit は節を重ねてページに届かせる', async () => {
    const path = await tmpPdf('broken-chain.pdf', pdfWithBrokenChain());
    const opened = await openForEdit(path, {});
    expect(opened.xref.kind).toBe('recovered');
    if (opened.xref.kind !== 'recovered') return;
    expect(opened.xref.stop).toBe('prev-zero');
    expect(opened.xref.sections.length).toBeGreaterThanOrEqual(2);
    expect(opened.xref.entriesAfter).toBeGreaterThan(opened.xref.entriesBefore);
    expect((await opened.editor.pages()).length).toBe(1);
  });

  it('回復した文書の全書き直しは断る（推量を出力に焼き付けない）', async () => {
    const path = await tmpPdf('broken-chain-save.pdf', pdfWithBrokenChain());
    const opened = await openForEdit(path, {});
    await expect(saveOpened(opened, { outputPath: join(dir, 'never.pdf') })).rejects.toBeInstanceOf(
      PdfWriterError,
    );
  });
});

describe('openForEdit — 署名ガード', () => {
  it('/ByteRange があれば SIGNED_PDF で断り、allowBreakingSignatures で通る', async () => {
    const base = Buffer.from(minimalPdf());
    const signedish = new Uint8Array(
      Buffer.concat([base, Buffer.from('% /ByteRange [0 1 2 3]\n', 'latin1')]),
    );
    const path = await tmpPdf('signedish.pdf', signedish);
    await expect(openForEdit(path, {})).rejects.toMatchObject({ code: 'SIGNED_PDF' });
    const opened = await openForEdit(path, { allowBreakingSignatures: true });
    expect(opened.xref.kind).toBe('chain');
  });
});

describe('新しい出口にまだ無いもの（L4′.2 で足す）', () => {
  it('output-edited.ts は normalizeEmbeddedFonts をまだ呼んでいない', async () => {
    // 旧出口（output.ts の saveEdited）は保存前に必ず走らせる。呼ぶ相手が
    // まだ pdf-lib の文書を取るので、新出口からは呼べない。**足したらこのテストを
    // 消し、output-edited.ts の冒頭の ⚠️ も一緒に消すこと**
    const { readFile } = await import('node:fs/promises');
    const source = await readFile(
      new URL('../src/services/output-edited.ts', import.meta.url),
      'utf8',
    );
    expect(source).not.toContain('normalizeEmbeddedFonts(');
  });
});
