/**
 * B-7b'（タグ付き文書の増分対応 = dirty 追跡の一般化）のテスト
 *
 *   - struct-append が報告する dirty refs（StructTreeRoot / 親要素 / ParentTree / page）が
 *     増分に含まれ、前方バイト同一性を保ったまま構造木が更新される
 *   - tag_form_fields の preserveSignatures（/TU 書き込み = 既存フィールドの再定義を含む）
 *   - タグ付き文書への増分の重ね掛けで ParentTree キーが連番を保つ
 *   - DocMDP 認証文書では構造タグ付けを全レベルで拒否する
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, StandardFonts } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PdfWriterError } from '../src/errors.js';
import { addAnnotation, tagFormFields } from '../src/services/editor.js';
import { handleCreateTextPdf } from '../src/tools/handlers.js';
import type { EditResult, TagFormFieldsResult } from '../src/types/index.js';

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pwm-tincr-'));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const SIG_MARKER = Buffer.from('\n% fixture marker: /ByteRange [0 0 0 0]\n', 'latin1');

/** タグ付き（ASCII・フォント非依存）+ 署名済みに見える PDF */
async function makeTaggedSignedLooking(path: string): Promise<Uint8Array> {
  const tmp = join(dir, `t-${Math.random().toString(36).slice(2)}.pdf`);
  await handleCreateTextPdf({
    text: 'Tagged fixture body.',
    title: 'Tagged Fixture',
    tagged: true,
    lang: 'en',
    outputPath: tmp,
  });
  const bytes = Buffer.concat([Buffer.from(await readFile(tmp)), SIG_MARKER]);
  await writeFile(path, bytes);
  return bytes;
}

/** タグ付き + 未タグフォーム + 署名マーカー */
async function makeTaggedFormSignedLooking(path: string): Promise<Uint8Array> {
  const tmp = join(dir, `tf-${Math.random().toString(36).slice(2)}.pdf`);
  await handleCreateTextPdf({
    text: 'Please fill in the form.',
    title: 'Form Fixture',
    tagged: true,
    lang: 'en',
    outputPath: tmp,
  });
  const doc = await PDFDocument.load(await readFile(tmp), { updateMetadata: false });
  const page = doc.getPage(0);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const form = doc.getForm();
  const name = form.createTextField('user.name');
  name.setText('Taro');
  name.addToPage(page, { x: 50, y: 500, width: 200, height: 24, font });
  const agree = form.createCheckBox('agree');
  agree.addToPage(page, { x: 50, y: 450, width: 16, height: 16 });
  const bytes = Buffer.concat([Buffer.from(await doc.save()), SIG_MARKER]);
  await writeFile(path, bytes);
  return bytes;
}

describe('タグ付き文書への preserveSignatures 注釈（dirty 追跡）', () => {
  it('増分の重ね掛けでも ParentTree キーが連番を保つ', async () => {
    const input = join(dir, 'stack.pdf');
    const mid = join(dir, 'stack-1.pdf');
    const output = join(dir, 'stack-2.pdf');
    await makeTaggedSignedLooking(input);

    const base = {
      page: 1,
      type: 'text' as const,
      rect: { x1: 20, y1: 20, x2: 50, y2: 50 },
      preserveSignatures: true,
    };
    await addAnnotation({ ...base, inputPath: input, outputPath: mid, alt: 'first' });
    const first = await readFile(mid);
    const result = (await addAnnotation({
      ...base,
      inputPath: mid,
      outputPath: output,
      rect: { x1: 60, y1: 20, x2: 90, y2: 50 },
      alt: 'second',
    })) as EditResult;
    expect(result.incremental).toBe(true);

    const out = await readFile(output);
    expect(Buffer.compare(out.subarray(0, first.length), first)).toBe(0);

    // 2 つの注釈が別々の StructParent キーを持ち、ParentTreeNextKey が進んでいる
    const doc = await PDFDocument.load(out, { updateMetadata: false });
    const annots = doc.getPages()[0].node.lookup(PDFName.of('Annots')) as PDFArray;
    const keys: number[] = [];
    for (let i = 0; i < annots.size(); i++) {
      const a = annots.lookup(i);
      if (a instanceof PDFDict) {
        const sp = a.lookup(PDFName.of('StructParent'));
        if (sp instanceof PDFNumber) keys.push(sp.asNumber());
      }
    }
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);

    const root = doc.catalog.lookup(PDFName.of('StructTreeRoot')) as PDFDict;
    const next = root.lookup(PDFName.of('ParentTreeNextKey')) as PDFNumber;
    expect(next.asNumber()).toBeGreaterThan(Math.max(...keys));
  });
});

describe('tag_form_fields の preserveSignatures', () => {
  it('前方バイトを保ったまま /TU と Form 構造要素が付く', async () => {
    const input = join(dir, 'form.pdf');
    const output = join(dir, 'form-out.pdf');
    const original = await makeTaggedFormSignedLooking(input);

    const result = (await tagFormFields({
      inputPath: input,
      outputPath: output,
      labels: { 'user.name': '氏名', agree: '同意する' },
      preserveSignatures: true,
    })) as TagFormFieldsResult;
    expect(result.incremental).toBe(true);
    expect(result.taggedWidgets).toBe(2);

    const out = await readFile(output);
    expect(Buffer.compare(out.subarray(0, original.length), Buffer.from(original))).toBe(0);

    // 再読込: /TU（既存フィールドの再定義が増分に含まれた）と /Tabs
    const doc = await PDFDocument.load(out, { updateMetadata: false });
    const field = doc.getForm().getFieldMaybe('user.name');
    const tu = field?.acroField.dict.lookup(PDFName.of('TU'));
    expect((tu as { decodeText(): string }).decodeText()).toBe('氏名');
    expect(doc.getPage(0).node.lookup(PDFName.of('Tabs'))?.toString()).toBe('/S');
  });

  it('DocMDP 認証文書では構造タグ付けを拒否する（全レベル）', async () => {
    const input = join(dir, 'mdp.pdf');
    // タグ付き + フォーム + DocMDP P=3 の署名フィールド
    const tmp = join(dir, 'mdp-base.pdf');
    await makeTaggedFormSignedLooking(tmp);
    const doc = await PDFDocument.load(await readFile(tmp), { updateMetadata: false });
    const { context } = doc;
    const sigRef = context.obj({}) as PDFDict;
    sigRef.set(PDFName.of('TransformMethod'), PDFName.of('DocMDP'));
    sigRef.set(PDFName.of('TransformParams'), context.obj({ P: 3 }) as PDFDict);
    const refArray = context.obj([]) as PDFArray;
    refArray.push(sigRef);
    const v = context.obj({ Type: 'Sig' }) as PDFDict;
    v.set(PDFName.of('Reference'), refArray);
    const sigField = doc.getForm().createTextField('sig.holder');
    sigField.acroField.dict.set(PDFName.of('FT'), PDFName.of('Sig'));
    sigField.acroField.dict.set(PDFName.of('V'), context.register(v));
    await writeFile(input, await doc.save());

    const err = await tagFormFields({
      inputPath: input,
      labels: {},
      preserveSignatures: true,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(PdfWriterError);
    expect((err as PdfWriterError).code).toBe('SIGNED_PDF');
    expect((err as PdfWriterError).message).toMatch(/structure \(tagging\)/);
  });
});
