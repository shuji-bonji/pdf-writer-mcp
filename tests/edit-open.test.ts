/**
 * 新しい入口と出口（L4′.1）のテスト。
 *
 * 検証の主眼:
 *   - 鎖が歩き切れる文書は `xref.kind === 'chain'` で開き、保存して読み戻せる
 *   - **暗号化された文書は ENCRYPTED_PDF で断る**。経路は 2 つ: 鍵を導ける文書は
 *     normativepdf が開いて復号するので trailer の `/Encrypt` を見て断り、鍵を導けない
 *     文書は normativepdf の EncryptionError を型で見て断る（0.8.0 以降）。
 *     旧入口（pdf-lib の例外文言を見ていた）の代わり
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
import { type CosObject, encryptPdf, writeFile as writeCos } from 'normativepdf';
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

/** 1 ページの最小文書の本体（オブジェクト 3 つ） */
function minimalObjects() {
  return [
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
}

/** 1 ページの最小文書。`extraTrailer` はトレーラに足す項目 */
function minimalPdf(extraTrailer: Record<string, unknown> = {}): Uint8Array {
  return writeCos(minimalObjects(), dict({ Size: int(4), Root: ref(1), ...extraTrailer }), {
    version: '1.7',
  });
}

/**
 * 標準セキュリティハンドラで暗号化した最小文書（§7.6.4）。乱数は固定して再現できるようにする。
 *
 * 🔴 `/Encrypt` を足しただけの平文は作れない。normativepdf 0.8.0 から `writeFile` は
 * trailer に `/Encrypt` を持つ文書を書くのを断る（暗号化の辞書の下に平文を書くことになる。
 * §7.6.2・normativepdf ADR-0008）。0.6.1 まではその形でこのテストを組んでいた。
 */
function encryptedPdf(method: 'AESV3' | 'AESV4', userPassword = ''): Uint8Array {
  let seed = 1;
  const random = (length: number) =>
    Uint8Array.from({ length }, () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed & 0xff;
    });
  return encryptPdf(minimalObjects() as never, dict({ Size: int(4), Root: ref(1) }), {
    method,
    userPassword: new TextEncoder().encode(userPassword),
    ownerPassword: new TextEncoder().encode('owner'),
    random,
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
  // 🔴 断る経路は 2 つある。normativepdf は鍵を導ける文書（利用者パスワードが空）は開いて
  // 復号するので、trailer の /Encrypt を見て writer が断る。鍵を導けない文書（利用者
  // パスワード付き）は normativepdf が EncryptionError で開くのを断る。どちらも
  // ENCRYPTED_PDF でなければならない —— 後者を INVALID_PDF（壊れたファイル）と言うと、
  // 利用者のすることが変わる（直すのではなく、復号する）
  it('利用者パスワードの無い AESV3 の文書は ENCRYPTED_PDF で断る', async () => {
    const path = await tmpPdf('aesv3.pdf', encryptedPdf('AESV3'));
    await expect(openForEdit(path, {})).rejects.toMatchObject({ code: 'ENCRYPTED_PDF' });
  });

  it('利用者パスワードの無い AESV4（ISO/TS 32003）の文書も ENCRYPTED_PDF で断る', async () => {
    const path = await tmpPdf('aesv4.pdf', encryptedPdf('AESV4'));
    await expect(openForEdit(path, {})).rejects.toMatchObject({ code: 'ENCRYPTED_PDF' });
  });

  it('利用者パスワード付きの文書（鍵が導けない）も ENCRYPTED_PDF で断り、INVALID_PDF と言わない', async () => {
    const path = await tmpPdf('aesv3-pw.pdf', encryptedPdf('AESV3', 'secret'));
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

describe('新しい出口は pdf-lib の後始末を持たない', () => {
  it('output-edited.ts は normalizeEmbeddedFonts を呼ばない', async () => {
    // 旧出口（output.ts の saveEdited）は保存前に必ず走らせていた。新しい経路で
    // フォントを埋め込むのは buildType0Font で、バイト列から辞書の型を導くので
    // 是正すべき誤りが作れない（§3.27.2 / §3.28）。呼ぶ必要が無い
    const { readFile } = await import('node:fs/promises');
    const source = await readFile(
      new URL('../src/services/output-edited.ts', import.meta.url),
      'utf8',
    );
    expect(source).not.toContain('normalizeEmbeddedFonts(');
  });
});
