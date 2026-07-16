/**
 * fill_form / flatten_form のテスト
 *
 * 検証の主眼:
 *   - 種別ごとの値の適用と、型が合わないときの拒否
 *   - 日本語の値が「埋め込みフォントで」外観生成されること（pdf-lib の既定 Helvetica に落ちない）
 *   - フラット化で対話性が失われること
 *   - タグ付き PDF のフラット化を既定で拒否すること（PDF/UA 7.1 / 7.18.4）
 */

import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRef, PDFStream, StandardFonts } from 'pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';
import { fillForm, flattenForm } from '../src/services/editor.js';
import { listFields } from '../src/services/form.js';
import { handleCreateTextPdf } from '../src/tools/handlers.js';
import { FillFormSchema, FlattenFormSchema, parseArgs } from '../src/utils/validation.js';

const FONT_PATH = process.env.TEST_FONT_PATH;

let dir: string;

/** text / checkbox / dropdown / radio を 1 つずつ持つフォーム PDF を作る */
async function makeFormPdf(path: string): Promise<void> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 300]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const form = doc.getForm();

  const name = form.createTextField('user.name');
  name.setText('Taro');
  name.addToPage(page, { x: 50, y: 200, width: 200, height: 24, font });

  const agree = form.createCheckBox('agree');
  agree.addToPage(page, { x: 50, y: 150, width: 16, height: 16 });

  const plan = form.createDropdown('plan');
  plan.setOptions(['Basic', 'Pro']);
  plan.select('Basic');
  plan.addToPage(page, { x: 50, y: 100, width: 120, height: 24, font });

  const color = form.createRadioGroup('color');
  color.addOptionToPage('red', page, { x: 50, y: 60, width: 16, height: 16 });
  color.addOptionToPage('blue', page, { x: 80, y: 60, width: 16, height: 16 });

  await writeFile(path, await doc.save());
}

async function fieldsOf(path: string): Promise<ReturnType<typeof listFields>> {
  return listFields(await PDFDocument.load(await readFile(path)));
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pwm-form-'));
});

describe('listFields', () => {
  it('種別・現在値・選択肢を報告する', async () => {
    const input = join(dir, 'form.pdf');
    await makeFormPdf(input);

    const fields = await fieldsOf(input);
    const byName = Object.fromEntries(fields.map((f) => [f.name, f]));

    expect(byName['user.name'].kind).toBe('text');
    expect(byName['user.name'].value).toBe('Taro');
    expect(byName.agree.kind).toBe('checkbox');
    expect(byName.agree.value).toBe(false);
    expect(byName.plan.kind).toBe('dropdown');
    expect(byName.plan.options).toEqual(['Basic', 'Pro']);
    expect(byName.color.kind).toBe('radio');
    expect(byName.color.options).toEqual(['red', 'blue']);
  });
});

describe('fillForm', () => {
  it('種別ごとに値を設定する', async () => {
    const input = join(dir, 'f1.pdf');
    const output = join(dir, 'f1-out.pdf');
    await makeFormPdf(input);

    const result = await fillForm({
      inputPath: input,
      fields: { 'user.name': 'Jiro', agree: true, plan: 'Pro', color: 'blue' },
      outputPath: output,
    });

    expect(result.filled).toBe(4);
    expect(result.flattened).toBe(false);

    const byName = Object.fromEntries((await fieldsOf(output)).map((f) => [f.name, f]));
    expect(byName['user.name'].value).toBe('Jiro');
    expect(byName.agree.value).toBe(true);
    expect(byName.plan.value).toEqual(['Pro']);
    expect(byName.color.value).toBe('blue');
  });

  it('数値はテキストとして受け付ける', async () => {
    const input = join(dir, 'f2.pdf');
    const output = join(dir, 'f2-out.pdf');
    await makeFormPdf(input);

    await fillForm({ inputPath: input, fields: { 'user.name': 42 }, outputPath: output });

    const byName = Object.fromEntries((await fieldsOf(output)).map((f) => [f.name, f]));
    expect(byName['user.name'].value).toBe('42');
  });

  it('"true" / "false" の文字列もチェックボックスに使える', async () => {
    const input = join(dir, 'f3.pdf');
    const output = join(dir, 'f3-out.pdf');
    await makeFormPdf(input);

    await fillForm({ inputPath: input, fields: { agree: 'true' }, outputPath: output });

    const byName = Object.fromEntries((await fieldsOf(output)).map((f) => [f.name, f]));
    expect(byName.agree.value).toBe(true);
  });

  it('存在しないフィールド名なら、実在する名前を挙げて拒否する', async () => {
    const input = join(dir, 'f4.pdf');
    await makeFormPdf(input);

    await expect(fillForm({ inputPath: input, fields: { nope: 'x' } })).rejects.toThrow(
      /not found.*user\.name.*agree.*plan.*color/s,
    );
  });

  it('種別と値の型が合わなければ拒否する', async () => {
    const input = join(dir, 'f5.pdf');
    await makeFormPdf(input);

    await expect(fillForm({ inputPath: input, fields: { agree: 'maybe' } })).rejects.toThrow(
      /checkbox.*boolean/,
    );
    await expect(fillForm({ inputPath: input, fields: { 'user.name': true } })).rejects.toThrow(
      /text.*string or number/,
    );
  });

  it('選択肢に無い値なら、選べる値を挙げて拒否する', async () => {
    const input = join(dir, 'f6.pdf');
    await makeFormPdf(input);

    await expect(fillForm({ inputPath: input, fields: { plan: 'Ultra' } })).rejects.toThrow(
      /no option "Ultra".*Basic, Pro/,
    );
    await expect(fillForm({ inputPath: input, fields: { color: 'green' } })).rejects.toThrow(
      /no option "green".*red, blue/,
    );
  });

  it('fields が空なら拒否する', async () => {
    const input = join(dir, 'f7.pdf');
    await makeFormPdf(input);

    await expect(fillForm({ inputPath: input, fields: {} })).rejects.toThrow(/at least one/);
  });

  it('標準フォントでは日本語の値を拒否する', async () => {
    const input = join(dir, 'f8.pdf');
    await makeFormPdf(input);

    await expect(
      fillForm({ inputPath: input, fields: { 'user.name': '山田 太郎' } }),
    ).rejects.toThrow();
  });

  it.runIf(FONT_PATH)('日本語の値を埋め込みフォントで記入できる', async () => {
    const input = join(dir, 'f9.pdf');
    const output = join(dir, 'f9-out.pdf');
    await makeFormPdf(input);

    const result = await fillForm({
      inputPath: input,
      fields: { 'user.name': '山田 太郎' },
      fontPath: FONT_PATH,
      outputPath: output,
    });

    expect(result.filled).toBe(1);
    const byName = Object.fromEntries((await fieldsOf(output)).map((f) => [f.name, f]));
    expect(byName['user.name'].value).toBe('山田 太郎');
  });

  it.runIf(FONT_PATH)(
    '日本語を記入した PDF を再度開いて保存できる（外観が壊れていない）',
    async () => {
      const input = join(dir, 'f10.pdf');
      const filled = join(dir, 'f10-filled.pdf');
      const output = join(dir, 'f10-out.pdf');
      await makeFormPdf(input);

      await fillForm({
        inputPath: input,
        fields: { 'user.name': '山田 太郎' },
        fontPath: FONT_PATH,
        outputPath: filled,
      });
      // 2 回目の編集で pdf-lib が Helvetica で作り直そうとしないこと
      await fillForm({
        inputPath: filled,
        fields: { plan: 'Pro' },
        fontPath: FONT_PATH,
        outputPath: output,
      });

      const byName = Object.fromEntries((await fieldsOf(output)).map((f) => [f.name, f]));
      expect(byName['user.name'].value).toBe('山田 太郎');
      expect(byName.plan.value).toEqual(['Pro']);
    },
  );

  it('flatten: true で記入と同時に非対話化できる', async () => {
    const input = join(dir, 'f11.pdf');
    const output = join(dir, 'f11-out.pdf');
    await makeFormPdf(input);

    const result = await fillForm({
      inputPath: input,
      fields: { 'user.name': 'Jiro' },
      flatten: true,
      outputPath: output,
    });

    expect(result.flattened).toBe(true);
    expect(result.fields).toHaveLength(0);
    expect(await fieldsOf(output)).toHaveLength(0);
  });
});

describe('flattenForm', () => {
  it('フォームをフラット化してフィールドを消す', async () => {
    const input = join(dir, 'g1.pdf');
    const output = join(dir, 'g1-out.pdf');
    await makeFormPdf(input);

    const result = await flattenForm({ inputPath: input, outputPath: output });

    expect(result.flattened).toBe(true);
    expect(await fieldsOf(output)).toHaveLength(0);
  });

  it('フォームが無い PDF は拒否する', async () => {
    const plain = join(dir, 'g2.pdf');
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    await writeFile(plain, await doc.save());

    await expect(flattenForm({ inputPath: plain })).rejects.toThrow(/no AcroForm fields/);
  });

  it.runIf(FONT_PATH)('日本語の値を保ったままフラット化できる', async () => {
    const input = join(dir, 'g3.pdf');
    const filled = join(dir, 'g3-filled.pdf');
    const output = join(dir, 'g3-out.pdf');
    await makeFormPdf(input);

    await fillForm({
      inputPath: input,
      fields: { 'user.name': '山田 太郎' },
      fontPath: FONT_PATH,
      outputPath: filled,
    });
    const result = await flattenForm({
      inputPath: filled,
      fontPath: FONT_PATH,
      outputPath: output,
    });

    expect(result.flattened).toBe(true);
    expect(await fieldsOf(output)).toHaveLength(0);
  });
});

describe('タグ付き PDF', () => {
  /** タグ付き PDF に AcroForm を後付けした文書を作る */
  const makeTaggedForm = async (path: string): Promise<void> => {
    const base = join(dir, `${Date.now()}-base.pdf`);
    await handleCreateTextPdf({
      text: '申込書',
      title: '申込書',
      lang: 'ja',
      tagged: true,
      fontPath: FONT_PATH,
      outputPath: base,
    });
    const doc = await PDFDocument.load(await readFile(base));
    const tf = doc.getForm().createTextField('applicant');
    tf.addToPage(doc.getPage(0), { x: 50, y: 400, width: 200, height: 24 });
    await writeFile(path, await doc.save({ updateFieldAppearances: false }));
  };

  /** 構造木の指紋（要素数と ParentTree の次キー） */
  const structFingerprint = async (path: string): Promise<string> => {
    const doc = await PDFDocument.load(await readFile(path));
    const root = doc.catalog.lookup(PDFName.of('StructTreeRoot'), PDFDict);
    const kids = root.lookup(PDFName.of('K'));
    const kidCount = kids instanceof PDFArray ? kids.size() : 1;
    const nextKey = root.get(PDFName.of('ParentTreeNextKey'))?.toString() ?? '-';
    return `${kidCount}/${nextKey}`;
  };

  it.runIf(FONT_PATH)('記入は構造木を変更しない（準拠は入力から引き継がれる）', async () => {
    const input = join(dir, 't1.pdf');
    const output = join(dir, 't1-out.pdf');
    await makeTaggedForm(input);

    const before = await structFingerprint(input);
    await fillForm({
      inputPath: input,
      fields: { applicant: '山田 太郎' },
      fontPath: FONT_PATH,
      outputPath: output,
    });

    expect(await structFingerprint(output)).toBe(before);
  });

  it.runIf(FONT_PATH)('フラット化は既定で拒否する（PDF/UA 7.1-3 が壊れるため）', async () => {
    const input = join(dir, 't2.pdf');
    await makeTaggedForm(input);

    await expect(
      flattenForm({ inputPath: input, fontPath: FONT_PATH, outputPath: join(dir, 't2-out.pdf') }),
    ).rejects.toThrow(/tagged PDF.*PDF\/UA-1 7\.1.*allowBreakingTags/s);

    await expect(
      fillForm({
        inputPath: input,
        fields: { applicant: '山田 太郎' },
        flatten: true,
        fontPath: FONT_PATH,
        outputPath: join(dir, 't2b-out.pdf'),
      }),
    ).rejects.toThrow(/allowBreakingTags/);
  });

  it.runIf(FONT_PATH)('allowBreakingTags なら警告つきで強行する', async () => {
    const input = join(dir, 't3.pdf');
    const output = join(dir, 't3-out.pdf');
    await makeTaggedForm(input);

    const result = await flattenForm({
      inputPath: input,
      allowBreakingTags: true,
      fontPath: FONT_PATH,
      outputPath: output,
    });

    expect(result.flattened).toBe(true);
    expect(result.warnings?.join(' ')).toMatch(/no longer PDF\/UA-1 conforming/);
  });

  it('タグ無し文書のフラット化は警告を出さない', async () => {
    const input = join(dir, 't4.pdf');
    const output = join(dir, 't4-out.pdf');
    await makeFormPdf(input);

    const result = await flattenForm({ inputPath: input, outputPath: output });

    expect(result.warnings).toBeUndefined();
  });
});

describe('宙吊り参照の掃除（pdf-lib の flatten のバグ対策）', () => {
  /**
   * pdf-lib の flatten() は /Annots・/Kids に削除済みオブジェクトへの参照を残す。
   * poppler が `Invalid XRef entry` を出すため、pruneDanglingRefs で取り除いている。
   * このテストは対策を外すと落ちる。
   */
  const countDangling = async (path: string): Promise<number> => {
    const doc = await PDFDocument.load(await readFile(path));
    const alive = new Set(doc.context.enumerateIndirectObjects().map(([ref]) => ref.toString()));
    let dangling = 0;
    const seen = new Set<unknown>();
    const walk = (obj: unknown): void => {
      if (obj instanceof PDFRef) {
        if (!alive.has(obj.toString())) dangling++;
        return;
      }
      if (seen.has(obj)) return;
      seen.add(obj);
      if (obj instanceof PDFStream) walk(obj.dict);
      else if (obj instanceof PDFArray) for (const v of obj.asArray()) walk(v);
      else if (obj instanceof PDFDict) for (const [, v] of obj.entries()) walk(v);
    };
    for (const [, obj] of doc.context.enumerateIndirectObjects()) walk(obj);
    return dangling;
  };

  it('flatten_form の出力に宙吊り参照が残らない', async () => {
    const input = join(dir, 'h1.pdf');
    const output = join(dir, 'h1-out.pdf');
    await makeFormPdf(input);

    await flattenForm({ inputPath: input, outputPath: output });

    expect(await countDangling(output)).toBe(0);
  });

  it('fill_form + flatten の出力にも宙吊り参照が残らない', async () => {
    const input = join(dir, 'h2.pdf');
    const output = join(dir, 'h2-out.pdf');
    await makeFormPdf(input);

    await fillForm({
      inputPath: input,
      fields: { 'user.name': 'Jiro' },
      flatten: true,
      outputPath: output,
    });

    expect(await countDangling(output)).toBe(0);
  });

  it('フラット化すると AcroForm 自体が落ちる', async () => {
    const input = join(dir, 'h3.pdf');
    const output = join(dir, 'h3-out.pdf');
    await makeFormPdf(input);

    await flattenForm({ inputPath: input, outputPath: output });

    const doc = await PDFDocument.load(await readFile(output));
    expect(doc.catalog.get(PDFName.of('AcroForm'))).toBeUndefined();
  });

  it('フラット化しなければ AcroForm は保たれる', async () => {
    const input = join(dir, 'h4.pdf');
    const output = join(dir, 'h4-out.pdf');
    await makeFormPdf(input);

    await fillForm({ inputPath: input, fields: { 'user.name': 'Jiro' }, outputPath: output });

    const doc = await PDFDocument.load(await readFile(output));
    expect(doc.catalog.get(PDFName.of('AcroForm'))).toBeDefined();
  });
});

describe('validateFillFormArgs', () => {
  const base = { inputPath: '/tmp/a.pdf', fields: { a: 'x' } };

  it('最小構成を受け付ける', () => {
    expect(() => parseArgs(FillFormSchema, base)).not.toThrow();
  });

  it('文字列・数値・真偽値・文字列配列を受け付ける', () => {
    expect(() =>
      parseArgs(FillFormSchema, { ...base, fields: { a: 'x', b: 1, c: true, d: ['x', 'y'] } }),
    ).not.toThrow();
  });

  it('fields がオブジェクトでなければ拒否する', () => {
    expect(() => parseArgs(FillFormSchema, { ...base, fields: 'x' })).toThrow(/fields/);
    expect(() => parseArgs(FillFormSchema, { ...base, fields: ['x'] })).toThrow(/fields/);
  });

  it('fields が空なら拒否する', () => {
    expect(() => parseArgs(FillFormSchema, { ...base, fields: {} })).toThrow(/at least one/);
  });

  it('値の型が想定外なら拒否する', () => {
    expect(() => parseArgs(FillFormSchema, { ...base, fields: { a: { b: 1 } } })).toThrow(
      /fields\.a/,
    );
    expect(() => parseArgs(FillFormSchema, { ...base, fields: { a: [1, 2] } })).toThrow(
      /fields\.a/,
    );
  });

  it('flatten が真偽値でなければ拒否する', () => {
    expect(() => parseArgs(FillFormSchema, { ...base, flatten: 'yes' })).toThrow(/flatten/);
  });
});

describe('validateFlattenFormArgs', () => {
  it('最小構成を受け付ける', () => {
    expect(() => parseArgs(FlattenFormSchema, { inputPath: '/tmp/a.pdf' })).not.toThrow();
  });

  it('inputPath が無ければ拒否する', () => {
    expect(() => parseArgs(FlattenFormSchema, {})).toThrow(/inputPath/);
  });

  it('allowBreakingTags が真偽値でなければ拒否する', () => {
    expect(() =>
      parseArgs(FlattenFormSchema, { inputPath: '/tmp/a.pdf', allowBreakingTags: 'yes' }),
    ).toThrow(/allowBreakingTags/);
  });
});
