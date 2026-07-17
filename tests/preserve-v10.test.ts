/**
 * v0.10.0（B-7b + B-9）のテスト
 *
 *   1. §7.5.6: 前 trailer の全エントリ引き継ぎ（標準外キーが増分 trailer に現れる）
 *   2. preserveSignatures の展開: set_metadata / add_bookmarks（前方バイト同一性）
 *   3. DocMDP: メタデータ・しおり変更は P=3 でも拒否（注釈と異なり全 P で不可）
 *   4. B-9: XMP を持つ文書で set_metadata が dc:title 等を同期し、
 *      pdfuaid:part / dc:language / xmp:CreateDate を保持する
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PdfWriterError } from '../src/errors.js';
import { addAnnotation, addBookmarks, setMetadata } from '../src/services/editor.js';
import { handleCreateTextPdf } from '../src/tools/handlers.js';
import type { EditResult } from '../src/types/index.js';

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pwm-v10-'));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function makeSignedLookingPdf(path: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([400, 300]);
  const saved = await doc.save({ useObjectStreams: false });
  const bytes = Buffer.concat([
    Buffer.from(saved),
    Buffer.from('\n% fixture marker: /ByteRange [0 0 0 0]\n', 'latin1'),
  ]);
  await writeFile(path, bytes);
  return bytes;
}

async function load(result: EditResult): Promise<PDFDocument> {
  return PDFDocument.load(Buffer.from(result.base64 as string, 'base64'), {
    updateMetadata: false,
  });
}

function xmpText(doc: PDFDocument): string {
  const meta = doc.catalog.lookup(PDFName.of('Metadata'));
  expect(meta).toBeInstanceOf(PDFRawStream);
  return new TextDecoder().decode((meta as PDFRawStream).contents);
}

describe('§7.5.6: 前 trailer の全エントリ引き継ぎ', () => {
  it('標準外の trailer キーが増分 trailer にも現れる', async () => {
    const input = join(dir, 'carry.pdf');
    const doc = await PDFDocument.create();
    doc.addPage([300, 200]);
    const saved = Buffer.from(await doc.save({ useObjectStreams: false }));
    // trailer 辞書に標準外キーを注入する（startxref の値は xref 先頭を指すため不変）
    const patched = Buffer.from(
      saved.toString('latin1').replace(/trailer\n<</, 'trailer\n<< /PWMTest 42'),
      'latin1',
    );
    expect(patched.toString('latin1')).toContain('/PWMTest 42');
    await writeFile(input, patched);

    const result = (await addAnnotation({
      inputPath: input,
      page: 1,
      type: 'text',
      rect: { x1: 10, y1: 10, x2: 40, y2: 40 },
      preserveSignatures: true,
    })) as EditResult;

    const out = Buffer.from(result.base64 as string, 'base64');
    const appended = out.subarray(patched.length).toString('latin1');
    expect(appended).toContain('/PWMTest 42'); // §7.5.6: 全エントリ引き継ぎ
    expect(appended).toContain('/Prev ');
  });
});

describe('preserveSignatures の展開', () => {
  it('set_metadata: 前方バイトを保ったままタイトルが更新される', async () => {
    const input = join(dir, 'meta.pdf');
    const original = await makeSignedLookingPdf(input);

    const result = await setMetadata({
      inputPath: input,
      title: '更新後のタイトル',
      preserveSignatures: true,
    });
    expect(result.incremental).toBe(true);

    const out = Buffer.from(result.base64 as string, 'base64');
    expect(Buffer.compare(out.subarray(0, original.length), Buffer.from(original))).toBe(0);
    const doc = await load(result);
    expect(doc.getTitle()).toBe('更新後のタイトル');
  });

  it('add_bookmarks: 前方バイトを保ったまましおりが設定される', async () => {
    const input = join(dir, 'bm.pdf');
    const original = await makeSignedLookingPdf(input);

    const result = await addBookmarks({
      inputPath: input,
      bookmarks: [{ title: '第1章', page: 1 }],
      preserveSignatures: true,
    });
    expect(result.incremental).toBe(true);

    const out = Buffer.from(result.base64 as string, 'base64');
    expect(Buffer.compare(out.subarray(0, original.length), Buffer.from(original))).toBe(0);

    const doc = await load(result);
    const outlines = doc.catalog.lookup(PDFName.of('Outlines'));
    expect(outlines).toBeInstanceOf(PDFDict);
    const first = (outlines as PDFDict).lookup(PDFName.of('First')) as PDFDict;
    expect((first.lookup(PDFName.of('Title')) as PDFHexString).decodeText()).toBe('第1章');
  });

  it('DocMDP: メタデータ変更は P=3 でも拒否される', async () => {
    const input = join(dir, 'mdp3.pdf');
    const doc = await PDFDocument.create();
    doc.addPage([300, 200]);
    const { context } = doc;
    const sigRef = context.obj({}) as PDFDict;
    sigRef.set(PDFName.of('TransformMethod'), PDFName.of('DocMDP'));
    sigRef.set(PDFName.of('TransformParams'), context.obj({ P: 3 }) as PDFDict);
    const refArray = context.obj([]) as PDFArray;
    refArray.push(sigRef);
    const v = context.obj({ Type: 'Sig' }) as PDFDict;
    v.set(PDFName.of('Reference'), refArray);
    const field = context.obj({ FT: 'Sig', T: PDFHexString.fromText('Sig1') }) as PDFDict;
    field.set(PDFName.of('V'), context.register(v));
    const fields = context.obj([]) as PDFArray;
    fields.push(context.register(field));
    const acroForm = context.obj({}) as PDFDict;
    acroForm.set(PDFName.of('Fields'), fields);
    doc.catalog.set(PDFName.of('AcroForm'), context.register(acroForm));
    await writeFile(input, await doc.save());

    const err = await setMetadata({
      inputPath: input,
      title: 'x',
      preserveSignatures: true,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(PdfWriterError);
    expect((err as PdfWriterError).code).toBe('SIGNED_PDF');
    expect((err as PdfWriterError).message).toMatch(/metadata and outline/);
  });
});

describe('B-9: set_metadata の XMP 併記更新', () => {
  it('XMP の dc:title を同期し pdfuaid:part / dc:language を保持する', async () => {
    const input = join(dir, 'xmp.pdf');
    // 生成はフォント非依存にする（本文と title は描画されるため ASCII）。
    // 日本語は setMetadata 側で使う — メタデータは描画されないのでフォント不要。
    await handleCreateTextPdf({
      text: 'body text',
      title: 'Original Title',
      author: '元の作成者', // author は描画されないため非 ASCII 可
      tagged: true, // XMP（pdfuaid:part 1 + dc:title + dc:language）が付く
      lang: 'en',
      outputPath: input,
    });

    const result = await setMetadata({
      inputPath: input,
      title: '新しいタイトル',
      subject: '概要説明',
      keywords: ['検証', 'XMP'],
    });
    expect(result.warnings?.join('\n')).toMatch(/XMP/);

    const doc = await load(result);
    expect(doc.getTitle()).toBe('新しいタイトル');
    const xmp = xmpText(doc);
    expect(xmp).toContain('新しいタイトル'); // dc:title 同期
    expect(xmp).not.toContain('Original Title');
    expect(xmp).toContain('概要説明'); // dc:description（Info の Subject）
    expect(xmp).toContain('検証 XMP'); // pdf:Keywords
    expect(xmp).toMatch(/<pdfuaid:part>\s*1\s*<\/pdfuaid:part>/); // PDF/UA 宣言の保持
    expect(xmp).toContain('<rdf:li>en</rdf:li>'); // dc:language の保持
    expect(xmp).toContain('元の作成者'); // 未指定フィールドは Info の現在値を維持
  });

  it('XMP の無い文書では何もしない（警告も出ない）', async () => {
    const input = join(dir, 'noxmp.pdf');
    const doc = await PDFDocument.create();
    doc.addPage([300, 200]);
    await writeFile(input, await doc.save());
    const result = await setMetadata({ inputPath: input, title: 'plain' });
    expect(result.warnings ?? []).toHaveLength(0);
  });
});
