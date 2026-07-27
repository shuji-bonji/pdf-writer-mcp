/**
 * B-16 = PDF 2.0 出力（`pdfVersion: '2.0'`）のテスト
 *
 *   - ヘッダ: `%PDF-2.0` が出力の先頭 8 バイトに入る（R-7.5.2-3 / -4）
 *   - trailer `/ID`: PDF 2.0 で Required（Table 15）・初回は 2 要素同値（R-14.4-6）
 *   - Info: CreationDate / ModDate だけが残る（§14.3.3）
 *   - XMP: 題名・作成者・Producer の行き先がここになる（Info から消えるので必須）
 *   - 既定（1.7）は**バイト列が 1 バイトも動かない**
 *   - `tagged: true` との併用は拒否する（PDF/UA-1 は PDF 1.7 基盤）
 *
 * ## このテストが空振りしないための注意（2 つとも実際に踏んだ）
 *
 * 1. 版の書き換えは **save 後のバイト列**に対して行う（pdf-lib は `context.header` を
 *    見ないため）。「pdf-lib で読み戻して版を聞く」検証では素通りしうるので、
 *    生バイトを直接見て、さらに qpdf（独立実装）に版を答えさせる。
 * 2. **`PDFDocument.load()` は既定で Info 辞書を書き換える**（`updateMetadata` の既定は
 *    `true` で、コンストラクタが `updateInfoDict()` を呼び `/Producer` と `/Creator` を
 *    メモリ上で足す）。**ファイルに無いものが読み戻しで現れる**ので、Info を検査する
 *    ときは必ず `{ updateMetadata: false }` を渡す。これを忘れると
 *    「Info を削ったのに削れていない」という**偽の赤**が出る。
 *
 * [[green-tests-can-be-vacuous]] の裏返し — 読み戻し器が嘘をつく側。
 */

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFRef } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { patchHeaderVersion } from '../src/services/pdf-version.js';
import { handleCreateTextPdf } from '../src/tools/handlers.js';

const execFileAsync = promisify(execFile);

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pdf-writer-b16-'));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const BASE = {
  text: 'B-16.\n\nSecond paragraph.',
  title: 'B-16 title',
  author: 'B-16 author',
};

async function create(extra: Record<string, unknown>, name: string): Promise<Uint8Array> {
  const path = join(dir, name);
  await handleCreateTextPdf({ ...BASE, ...extra, outputPath: path });
  return new Uint8Array(await readFile(path));
}

const headerOf = (bytes: Uint8Array): string => String.fromCharCode(...bytes.subarray(0, 8));

/**
 * 読み戻し専用のロード。`updateMetadata: false` は**必須** — 既定の `true` は
 * ファイルに無い `/Producer` `/Creator` をメモリ上で足してしまう（冒頭の注意 2）。
 */
const loadForInspection = (bytes: Uint8Array): Promise<PDFDocument> =>
  PDFDocument.load(bytes, { updateMetadata: false });

function infoDict(doc: PDFDocument): PDFDict {
  const info = doc.context.trailerInfo.Info;
  const dict = info instanceof PDFRef ? doc.context.lookup(info) : info;
  expect(dict).toBeInstanceOf(PDFDict);
  return dict as PDFDict;
}

/**
 * 出力バイト列を比較するテストは時刻を固定する。固定しないと、2 回の生成が
 * **秒境界を跨いだときだけ**落ちる（W-5 と同じ形の、再現しない失敗）。
 */
async function withFixedClock<T>(fn: () => Promise<T>): Promise<T> {
  const previous = process.env.SOURCE_DATE_EPOCH;
  process.env.SOURCE_DATE_EPOCH = '1700000000';
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env.SOURCE_DATE_EPOCH;
    else process.env.SOURCE_DATE_EPOCH = previous;
  }
}

let qpdfAvailable: boolean | undefined;
async function hasQpdf(): Promise<boolean> {
  if (qpdfAvailable === undefined) {
    qpdfAvailable = await execFileAsync('qpdf', ['--version']).then(
      () => true,
      () => false,
    );
  }
  return qpdfAvailable;
}

describe('pdfVersion: "2.0" (B-16)', () => {
  it('writes a 2.0 header into the saved bytes', async () => {
    const bytes = await create({ pdfVersion: '2.0' }, 'v20.pdf');
    expect(headerOf(bytes)).toBe('%PDF-2.0');
    // R-7.5.2-7: ヘッダ行の直後は 128 以上のバイトを 4 つ以上含むコメント行
    expect(bytes[8]).toBe(0x0a);
    expect(bytes[9]).toBe(0x25); // '%'
    for (let i = 10; i < 14; i++) expect(bytes[i]).toBeGreaterThanOrEqual(128);
  });

  it('is read back as 2.0 by an independent implementation (qpdf)', async () => {
    if (!(await hasQpdf())) return;
    const path = join(dir, 'v20-qpdf.pdf');
    await handleCreateTextPdf({ ...BASE, pdfVersion: '2.0', outputPath: path });
    const { stdout } = await execFileAsync('qpdf', ['--check', path]).catch(
      (e: { stdout?: string }) => ({ stdout: e.stdout ?? '' }),
    );
    expect(stdout).toContain('PDF Version: 2.0');
    expect(stdout).toContain('No syntax or stream encoding errors found');
  });

  it('writes trailer /ID with two equal elements (Table 15 / R-14.4-6)', async () => {
    const bytes = await create({ pdfVersion: '2.0' }, 'v20-id.pdf');
    const doc = await loadForInspection(bytes);
    const id = doc.context.trailerInfo.ID;
    expect(id).toBeInstanceOf(PDFArray);
    const arr = id as PDFArray;
    expect(arr.size()).toBe(2);
    const [first, second] = [arr.get(0), arr.get(1)];
    expect(first).toBeInstanceOf(PDFHexString);
    expect(String(first)).toBe(String(second));
    // 各バイト列は 16 バイト以上（Table 15）— hex なので 32 桁以上
    expect(String(first).replace(/[<>]/g, '').length).toBeGreaterThanOrEqual(32);
  });

  it('leaves only CreationDate and ModDate in the Info dictionary (§14.3.3)', async () => {
    const bytes = await create({ pdfVersion: '2.0' }, 'v20-info.pdf');
    const doc = await loadForInspection(bytes);
    const keys = infoDict(doc)
      .keys()
      .map((k) => k.asString().replace(/^\//, ''))
      .sort();
    expect(keys).toEqual(['CreationDate', 'ModDate']);
  });

  it('moves title, author and producer into the metadata stream', async () => {
    const bytes = await create({ pdfVersion: '2.0' }, 'v20-xmp.pdf');
    const xmp = Buffer.from(bytes).toString('latin1');
    expect(xmp).toContain('<dc:title>');
    expect(xmp).toContain('B-16 title');
    expect(xmp).toContain('B-16 author');
    expect(xmp).toContain('<pdf:Producer>');
  });

  it('rejects tagged: true, which would declare PDF/UA-1 on a 2.0 file', async () => {
    await expect(
      handleCreateTextPdf({
        ...BASE,
        tagged: true,
        pdfVersion: '2.0',
        outputPath: join(dir, 'never.pdf'),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
});

describe('the 1.7 default is untouched', () => {
  it('still writes a 1.7 header and no trailer /ID', async () => {
    const bytes = await create({}, 'v17.pdf');
    expect(headerOf(bytes)).toBe('%PDF-1.7');
    expect(bytes.subarray(0, 8)).not.toEqual(new Uint8Array(Buffer.from('%PDF-2.0')));

    const doc = await loadForInspection(bytes);
    // 1.7 では /ID は Encrypt がある場合のみ Required。付けない挙動を維持する
    expect(doc.context.trailerInfo.ID).toBeUndefined();
    const keys = infoDict(doc)
      .keys()
      .map((k) => k.asString().replace(/^\//, ''));
    expect(keys).toContain('Title');
    expect(keys).toContain('Producer');
  });

  it('produces the same bytes whether pdfVersion is omitted or given as "1.7"', async () => {
    await withFixedClock(async () => {
      const omitted = await create({}, 'v17-omitted.pdf');
      const explicit = await create({ pdfVersion: '1.7' }, 'v17-explicit.pdf');
      expect(Buffer.from(omitted).equals(Buffer.from(explicit))).toBe(true);
    });
  });
});

describe('patchHeaderVersion', () => {
  it('refuses to rewrite bytes that do not start with the header pdf-lib writes', () => {
    // pdf-lib が書くヘッダが変わったら、黙って上書きせず気づかせる
    const bogus = new Uint8Array(Buffer.from('%PDF-1.4\nrest'));
    expect(() => patchHeaderVersion(bogus, '2.0')).toThrow(/Expected the saved document/);
  });

  it('is a no-op when the header already says the requested version', () => {
    const already = new Uint8Array(Buffer.from('%PDF-2.0\nrest'));
    const before = Buffer.from(already).toString('latin1');
    patchHeaderVersion(already, '2.0');
    expect(Buffer.from(already).toString('latin1')).toBe(before);
  });
});

describe('determinism (E-6) is not broken by the 2.0 path', () => {
  it('produces identical bytes across runs under SOURCE_DATE_EPOCH', async () => {
    await withFixedClock(async () => {
      // /ID は「文書の時刻 + Info 辞書」から作るので、時刻が固定なら再現する
      const a = await create({ pdfVersion: '2.0' }, 'det-a.pdf');
      const b = await create({ pdfVersion: '2.0' }, 'det-b.pdf');
      expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    });
  });
});
