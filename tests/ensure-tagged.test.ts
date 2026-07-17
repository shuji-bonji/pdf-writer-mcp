/**
 * ensure_tagged（B-7c）と B-7b''（attach/stamp/watermark の増分）のテスト
 *
 *   - タグ無し文書: 構造木新設（Document > P × ページ）+ BDC/EMC の包み + 文書要件
 *   - タグ付き文書: 構造木は温存し、欠落要件のみ補う（冪等）
 *   - 正直さ: 足場であることを警告する / title・lang 欠落を警告する
 *   - preserveSignatures: 前方バイト同一性
 *   - B-7b'': attach_file / stamp_page_numbers / add_watermark の増分対応
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type PDFArray, type PDFDict, PDFDocument, PDFName, type PDFNumber } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addWatermark,
  attachFileToPdf,
  ensureTagged,
  stampPageNumbers,
} from '../src/services/editor.js';
import { isTagged } from '../src/services/struct-append.js';
import { handleCreateTextPdf } from '../src/tools/handlers.js';
import type { EnsureTaggedResult } from '../src/types/index.js';

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pwm-ensure-'));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const SIG_MARKER = Buffer.from('\n% fixture marker: /ByteRange [0 0 0 0]\n', 'latin1');

/** タグ無しの素の PDF（2 ページ） */
async function makeUntagged(path: string, opts: { signed?: boolean } = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([300, 200]).drawText('page one');
  doc.addPage([300, 200]).drawText('page two');
  doc.setTitle('Existing Title');
  const saved = Buffer.from(await doc.save({ useObjectStreams: false }));
  const bytes = opts.signed ? Buffer.concat([saved, SIG_MARKER]) : saved;
  await writeFile(path, bytes);
  return bytes;
}

async function load(result: { base64?: string }): Promise<PDFDocument> {
  return PDFDocument.load(Buffer.from(result.base64 as string, 'base64'), {
    updateMetadata: false,
  });
}

describe('ensure_tagged — タグ無し文書', () => {
  it('構造木を新設し各ページを P で包む（Document > P × 2）', async () => {
    const input = join(dir, 'u1.pdf');
    await makeUntagged(input);

    const result = (await ensureTagged({
      inputPath: input,
      lang: 'en',
    })) as EnsureTaggedResult;

    expect(result.wasTagged).toBe(false);
    expect(result.createdStructure).toBe(true);
    expect(result.wrappedPages).toBe(2);
    // 足場であることを正直に警告する
    expect(result.warnings?.join('\n')).toMatch(/scaffold|starting point/i);

    const doc = await load(result);
    expect(isTagged(doc)).toBe(true); // StructTreeRoot + MarkInfo/Marked

    const root = doc.catalog.lookup(PDFName.of('StructTreeRoot')) as PDFDict;
    const docElem = root.lookup(PDFName.of('K')) as PDFDict;
    expect((docElem.lookup(PDFName.of('S')) as PDFName).decodeText()).toBe('Document');
    const kids = docElem.lookup(PDFName.of('K')) as PDFArray;
    expect(kids.size()).toBe(2);
    const first = kids.lookup(0) as PDFDict;
    expect((first.lookup(PDFName.of('S')) as PDFName).decodeText()).toBe('P');
    expect((first.lookup(PDFName.of('K')) as PDFNumber).asNumber()).toBe(0); // MCID

    // 文書要件
    expect(doc.catalog.lookup(PDFName.of('Lang'))?.toString()).toContain('en');
    const vp = doc.catalog.lookup(PDFName.of('ViewerPreferences')) as PDFDict;
    expect(vp.lookup(PDFName.of('DisplayDocTitle'))?.toString()).toBe('true');
    expect(doc.catalog.lookup(PDFName.of('Metadata'))).toBeDefined();

    // 各ページに /StructParents が振られ、内容が BDC/EMC で包まれる
    for (const [i, page] of doc.getPages().entries()) {
      expect((page.node.lookup(PDFName.of('StructParents')) as PDFNumber).asNumber()).toBe(i);
      const contents = page.node.lookup(PDFName.of('Contents')) as PDFArray;
      const firstStream = contents.lookup(0) as { getContentsString?: () => string };
      // 先頭ストリームが BDC で始まる
      const text = Buffer.from(
        (contents.lookup(0) as unknown as { contents: Uint8Array }).contents,
      ).toString('latin1');
      expect(text).toContain('/P <</MCID 0>> BDC');
      expect(firstStream).toBeDefined();
    }
  });

  it('title / lang の欠落を警告する', async () => {
    const input = join(dir, 'u2.pdf');
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    await writeFile(input, await doc.save());

    const result = (await ensureTagged({ inputPath: input })) as EnsureTaggedResult;
    const w = result.warnings?.join('\n') ?? '';
    expect(w).toMatch(/lang/i);
    expect(w).toMatch(/title/i);
  });

  it('preserveSignatures で前方バイトを保つ', async () => {
    const input = join(dir, 'u3.pdf');
    const output = join(dir, 'u3-out.pdf');
    const original = await makeUntagged(input, { signed: true });

    const result = (await ensureTagged({
      inputPath: input,
      outputPath: output,
      lang: 'en',
      title: 'Scaffolded',
      preserveSignatures: true,
    })) as EnsureTaggedResult;
    expect(result.incremental).toBe(true);

    const out = await readFile(output);
    expect(Buffer.compare(out.subarray(0, original.length), Buffer.from(original))).toBe(0);
    expect(isTagged(await PDFDocument.load(out, { updateMetadata: false }))).toBe(true);
  });
});

describe('ensure_tagged — タグ付き文書', () => {
  it('構造木は温存し、要件のみ補う（冪等）', async () => {
    const input = join(dir, 't1.pdf');
    await handleCreateTextPdf({
      text: 'already tagged body',
      title: 'Tagged',
      tagged: true,
      lang: 'en',
      outputPath: input,
    });
    const before = await PDFDocument.load(await readFile(input), { updateMetadata: false });
    const beforeRoot = before.catalog.lookup(PDFName.of('StructTreeRoot')) as PDFDict;
    const beforeKids = (
      (beforeRoot.lookup(PDFName.of('K')) as PDFDict).lookup(PDFName.of('K')) as PDFArray
    ).size();

    const result = (await ensureTagged({ inputPath: input, lang: 'en' })) as EnsureTaggedResult;
    expect(result.wasTagged).toBe(true);
    expect(result.createdStructure).toBe(false);
    expect(result.wrappedPages).toBe(0);

    // 構造木の子要素数が変わらない = 温存された
    const doc = await load(result);
    const root = doc.catalog.lookup(PDFName.of('StructTreeRoot')) as PDFDict;
    const kids = (
      (root.lookup(PDFName.of('K')) as PDFDict).lookup(PDFName.of('K')) as PDFArray
    ).size();
    expect(kids).toBe(beforeKids);
  });
});

describe("B-7b'': 増分更新の他ツールへの展開", () => {
  it('attach_file が preserveSignatures で前方バイトを保つ', async () => {
    const input = join(dir, 'a1.pdf');
    const output = join(dir, 'a1-out.pdf');
    const original = await makeUntagged(input, { signed: true });
    const att = join(dir, 'data.csv');
    await writeFile(att, 'a,b\n1,2\n');

    const result = await attachFileToPdf({
      inputPath: input,
      outputPath: output,
      attachmentPath: att,
      relationship: 'Data',
      preserveSignatures: true,
    });
    expect(result.incremental).toBe(true);
    expect(result.attachments).toContain('data.csv');

    const out = await readFile(output);
    expect(Buffer.compare(out.subarray(0, original.length), Buffer.from(original))).toBe(0);
    // 再読込で添付が見える
    const doc = await PDFDocument.load(out, { updateMetadata: false });
    expect(doc.catalog.lookup(PDFName.of('Names'))).toBeDefined();
  });

  it('stamp_page_numbers が preserveSignatures で前方バイトを保つ', async () => {
    const input = join(dir, 's1.pdf');
    const output = join(dir, 's1-out.pdf');
    const original = await makeUntagged(input, { signed: true });

    const result = await stampPageNumbers({
      inputPath: input,
      outputPath: output,
      format: '{n} / {total}',
      preserveSignatures: true,
    });
    expect(result.incremental).toBe(true);
    expect(result.stamped).toBe(2);

    const out = await readFile(output);
    expect(Buffer.compare(out.subarray(0, original.length), Buffer.from(original))).toBe(0);
  });

  it('add_watermark が preserveSignatures で前方バイトを保つ', async () => {
    const input = join(dir, 'w1.pdf');
    const output = join(dir, 'w1-out.pdf');
    const original = await makeUntagged(input, { signed: true });

    const result = await addWatermark({
      inputPath: input,
      outputPath: output,
      text: 'DRAFT',
      preserveSignatures: true,
    });
    expect(result.incremental).toBe(true);
    expect(result.watermarked).toBe(2);

    const out = await readFile(output);
    expect(Buffer.compare(out.subarray(0, original.length), Buffer.from(original))).toBe(0);
  });
});
