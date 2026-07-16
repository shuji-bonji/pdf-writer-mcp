/**
 * tag_form_fields（PDF/UA-1 7.18.4-1 / 7.18.3-1 / 7.18.1-3）のテスト
 *
 * 検証の主眼:
 *   - Widget が Form 構造要素に内包される（OBJR + /StructParent + ParentTree）
 *   - 対象ページに /Tabs /S が立つ
 *   - フィールドに /TU が付く（labels 指定はその値、未指定はフィールド名で代用 + 警告）
 *   - 冪等性: 二度目の実行は全 Widget をスキップし、構造要素が重複しない
 *   - タグ無し文書・存在しないフィールド名の labels は拒否
 *
 * CI に veraPDF は無いため、実際の準拠判定は手元の
 * `validate_conformance --flavour pdfua-1` で行うこと（v0.8.0 で COMPLIANT を確認済み）。
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, StandardFonts } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PdfWriterError } from '../src/errors.js';
import { tagFormFields } from '../src/services/editor.js';
import { handleCreateTextPdf, handleTagFormFields } from '../src/tools/handlers.js';
import type { TagFormFieldsResult } from '../src/types/index.js';

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pwm-formtag-'));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

/**
 * タグ付き PDF に「タグ付けされていないフォーム」を足したフィクスチャを作る。
 * 実運用の「create 系で作ったタグ付き文書に、後からフォームを足した」状況に相当する。
 * text(1) + checkbox(1) + radio(選択肢 2 = Widget 2) = Widget 4 / フィールド 3。
 */
async function makeTaggedFormPdf(path: string): Promise<void> {
  const tagged = join(dir, `base-${Math.random().toString(36).slice(2)}.pdf`);
  await handleCreateTextPdf({
    text: 'Please fill in the form below.',
    title: 'Application Form',
    tagged: true,
    lang: 'en',
    outputPath: tagged,
  });

  const doc = await PDFDocument.load(await readFile(tagged), { updateMetadata: false });
  const page = doc.getPage(0);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const form = doc.getForm();

  const name = form.createTextField('user.name');
  name.setText('Taro');
  name.addToPage(page, { x: 50, y: 200, width: 200, height: 24, font });

  const agree = form.createCheckBox('agree');
  agree.addToPage(page, { x: 50, y: 150, width: 16, height: 16 });

  const color = form.createRadioGroup('color');
  color.addOptionToPage('red', page, { x: 50, y: 100, width: 16, height: 16 });
  color.addOptionToPage('blue', page, { x: 80, y: 100, width: 16, height: 16 });

  await writeFile(path, await doc.save());
}

async function load(result: TagFormFieldsResult): Promise<PDFDocument> {
  return PDFDocument.load(Buffer.from(result.base64 as string, 'base64'), {
    updateMetadata: false,
  });
}

/** 構造木から S=Form の要素を集める */
function formElems(doc: PDFDocument): PDFDict[] {
  const root = doc.catalog.lookup(PDFName.of('StructTreeRoot'));
  if (!(root instanceof PDFDict)) return [];
  const out: PDFDict[] = [];
  const seen = new Set<PDFDict>();
  const visit = (node: PDFDict): void => {
    if (seen.has(node)) return;
    seen.add(node);
    const s = node.lookup(PDFName.of('S'));
    if (s instanceof PDFName && s.decodeText() === 'Form') out.push(node);
    const k = node.lookup(PDFName.of('K'));
    if (k instanceof PDFDict) visit(k);
    else if (k instanceof PDFArray) {
      for (let i = 0; i < k.size(); i++) {
        const kid = k.lookup(i);
        if (kid instanceof PDFDict) visit(kid);
      }
    }
  };
  visit(root);
  return out;
}

/** ページ /Annots 上の全 Widget 辞書を返す */
function widgetDicts(doc: PDFDocument): PDFDict[] {
  const out: PDFDict[] = [];
  for (const page of doc.getPages()) {
    const annots = page.node.lookup(PDFName.of('Annots'));
    if (!(annots instanceof PDFArray)) continue;
    for (let i = 0; i < annots.size(); i++) {
      const a = annots.lookup(i);
      if (a instanceof PDFDict && a.lookup(PDFName.of('Subtype'))?.toString() === '/Widget') {
        out.push(a);
      }
    }
  }
  return out;
}

describe('tag_form_fields', () => {
  it('Widget を Form 構造要素に内包し /Tabs /S と /TU を付ける', async () => {
    const input = join(dir, 't1.pdf');
    await makeTaggedFormPdf(input);

    const result = (await handleTagFormFields({
      inputPath: input,
      labels: { 'user.name': '氏名' },
    })) as TagFormFieldsResult;

    expect(result.taggedWidgets).toBe(4); // text + checkbox + radio×2
    expect(result.skippedWidgets).toBe(0);
    // labels 未指定の agree / color はフィールド名で代用した旨を警告する
    expect(result.warnings?.join('\n')).toMatch(/agree/);
    expect(result.warnings?.join('\n')).toMatch(/color/);

    const doc = await load(result);

    // 7.18.4-1: Form 要素が Widget の数だけあり、K → OBJR → /Obj が Widget を指す
    const elems = formElems(doc);
    expect(elems).toHaveLength(4);
    for (const elem of elems) {
      const k = elem.lookup(PDFName.of('K'));
      expect(k).toBeInstanceOf(PDFDict);
      expect((k as PDFDict).lookup(PDFName.of('Type'))?.toString()).toBe('/OBJR');
      const obj = (k as PDFDict).lookup(PDFName.of('Obj'));
      expect((obj as PDFDict).lookup(PDFName.of('Subtype'))?.toString()).toBe('/Widget');
    }

    // 全 Widget が /StructParent を持つ
    for (const w of widgetDicts(doc)) {
      expect(w.get(PDFName.of('StructParent'))).toBeDefined();
    }

    // 7.18.3-1: /Tabs /S
    expect(doc.getPage(0).node.lookup(PDFName.of('Tabs'))?.toString()).toBe('/S');

    // 7.18.1-3: /TU（labels 指定は指定値、未指定はフィールド名）
    const tuOf = (fieldName: string): string | undefined => {
      const field = doc.getForm().getFieldMaybe(fieldName);
      const tu = field?.acroField.dict.lookup(PDFName.of('TU'));
      return tu instanceof PDFHexString ? tu.decodeText() : undefined;
    };
    expect(tuOf('user.name')).toBe('氏名');
    expect(tuOf('agree')).toBe('agree');
    expect(tuOf('color')).toBe('color');
  });

  it('冪等: 二度目の実行は全 Widget をスキップし Form 要素が増えない', async () => {
    const input = join(dir, 't2.pdf');
    const once = join(dir, 't2-once.pdf');
    await makeTaggedFormPdf(input);

    await handleTagFormFields({ inputPath: input, outputPath: once });
    const again = (await handleTagFormFields({ inputPath: once })) as TagFormFieldsResult;

    expect(again.taggedWidgets).toBe(0);
    expect(again.skippedWidgets).toBe(4);
    expect(formElems(await load(again))).toHaveLength(4);
  });

  it('タグ無し文書は INVALID_ARGUMENT で拒否する', async () => {
    const input = join(dir, 't3.pdf');
    // タグ無し + フォームあり
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 300]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const f = doc.getForm().createTextField('a');
    f.addToPage(page, { x: 10, y: 10, width: 100, height: 20, font });
    await writeFile(input, await doc.save());

    const err = await tagFormFields({ inputPath: input }).catch((e) => e);
    expect(err).toBeInstanceOf(PdfWriterError);
    expect((err as PdfWriterError).code).toBe('INVALID_ARGUMENT');
    expect((err as PdfWriterError).message).toMatch(/not a tagged PDF/);
  });

  it('labels に存在しないフィールド名があると実在する名前を列挙して拒否する', async () => {
    const input = join(dir, 't4.pdf');
    await makeTaggedFormPdf(input);

    const err = await tagFormFields({
      inputPath: input,
      labels: { nosuch: 'ラベル' },
    }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/nosuch/);
    expect((err as Error).message).toMatch(/user\.name/);
  });

  it('フォームの無い文書はエラーにする', async () => {
    const input = join(dir, 't5.pdf');
    await handleCreateTextPdf({
      text: 'no form here',
      title: 'T',
      tagged: true,
      lang: 'en',
      outputPath: input,
    });
    const err = await tagFormFields({ inputPath: input }).catch((e) => e);
    expect(err).toBeInstanceOf(PdfWriterError);
    expect((err as Error).message).toMatch(/no AcroForm fields/);
  });
});
