/**
 * ensure_pdfa（B-8 = PDF/A-3b）のテスト
 *
 *   - ICC: 生成した sRGB プロファイルの構造（ヘッダ・タグテーブル・4 バイト整列）
 *   - /ID: 2 要素・初回は同値（R-14.4-7 / -11）/ 既存の permanent は保持（R-14.4-8）
 *   - OutputIntent: GTS_PDFA1 と DestOutputProfile / 既存があれば重複追加しない
 *   - XMP: pdfaid を書き、**pdfuaid を落とさない**（UC-2 回帰の要）
 *   - 決定論（E-6）: SOURCE_DATE_EPOCH 固定で /ID が再現する
 *   - 添付が生き残る（UC-4 = 電帳法。attach_file → ensure_pdfa の順序）
 *
 * ## このテストが空振りしないための注意
 *
 * 「緑のテストは空振りしうる」（フィクスチャ不在 + `if` ガードで High 3 件が生き延びた前例）。
 * ここでは **`expect` を `if` の中に置かない**。存在しないはずのものは
 * `toBeDefined()` / `toBe(...)` で必ず落とす。
 *
 * veraPDF による最終判定（146/146 COMPLIANT）は別途 e2e で確認する — ここは
 * 「辞書に何が書かれたか」の単体検証であり、**適合の証明ではない**。
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRawStream,
} from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensurePdfa } from '../src/services/edit-ensure-pdfa.js';
import { attachFileToPdf } from '../src/services/editor.js';
import {
  ensureFileIdentifier,
  ensureSrgbOutputIntent,
  hasPdfaDeclaration,
} from '../src/services/pdfa-conformance.js';
import { buildSrgbIccProfile, SRGB_CONDITION_IDENTIFIER } from '../src/services/srgb-icc.js';
import { handleCreateTextPdf } from '../src/tools/handlers.js';

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pwm-pdfa-'));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** タグ付き・タイトルありの PDF を作る（PDF/UA 経路 = UC-2 の回帰対象） */
async function makeTagged(path: string): Promise<void> {
  const result = await handleCreateTextPdf({
    text: 'invoice body',
    title: 'Invoice',
    lang: 'en',
    tagged: true,
    outputPath: path,
  });
  expect(result).toBeDefined();
}

function xmpText(doc: PDFDocument): string {
  const meta = doc.catalog.lookup(PDFName.of('Metadata'));
  expect(meta).toBeInstanceOf(PDFRawStream);
  const stream = meta as PDFRawStream;
  const bytes = stream.dict.has(PDFName.of('Filter'))
    ? decodePDFRawStream(stream).decode()
    : stream.contents;
  return new TextDecoder().decode(bytes);
}

function outputIntents(doc: PDFDocument): PDFArray {
  const oi = doc.catalog.lookup(PDFName.of('OutputIntents'));
  expect(oi).toBeInstanceOf(PDFArray);
  return oi as PDFArray;
}

describe('sRGB ICC profile generation', () => {
  const profile = buildSrgbIccProfile();
  const view = () => new DataView(profile.buffer, profile.byteOffset, profile.byteLength);
  const sig = (offset: number) => String.fromCharCode(...profile.subarray(offset, offset + 4));

  it('declares its own size and the expected ICC v2 header fields', () => {
    expect(view().getUint32(0)).toBe(profile.length);
    expect(view().getUint32(8)).toBe(0x02400000); // version 2.4
    expect(sig(12)).toBe('mntr'); // device class: display
    expect(sig(16)).toBe('RGB ');
    expect(sig(20)).toBe('XYZ '); // PCS
    expect(sig(36)).toBe('acsp');
  });

  it('uses the D50 illuminant the ICC spec fixes for the PCS', () => {
    // s15Fixed16: 1.0 = 0x00010000
    expect(view().getInt32(68) / 65536).toBeCloseTo(0.9642, 4);
    expect(view().getInt32(72) / 65536).toBeCloseTo(1.0, 4);
    expect(view().getInt32(76) / 65536).toBeCloseTo(0.82491, 4);
  });

  it('carries every tag ICC v2 requires of a matrix/TRC RGB profile', () => {
    const count = view().getUint32(128);
    const found = new Map<string, { offset: number; length: number }>();
    for (let i = 0; i < count; i++) {
      const entry = 132 + i * 12;
      found.set(sig(entry), {
        offset: view().getUint32(entry + 4),
        length: view().getUint32(entry + 8),
      });
    }
    for (const tag of ['desc', 'cprt', 'wtpt', 'rXYZ', 'gXYZ', 'bXYZ', 'rTRC', 'gTRC', 'bTRC']) {
      expect(found.has(tag)).toBe(true);
    }
    // 全タグが 4 バイト整列していて、プロファイル内に収まっている
    for (const [tag, { offset, length }] of found) {
      expect(offset % 4, `${tag} must be 4-byte aligned`).toBe(0);
      expect(offset + length, `${tag} must fit inside the profile`).toBeLessThanOrEqual(
        profile.length,
      );
    }
  });

  it('is byte-for-byte reproducible (E-6: no timestamp inside)', () => {
    expect(Buffer.from(buildSrgbIccProfile())).toEqual(Buffer.from(profile));
    // ヘッダの日時フィールド（24-35）は 0 埋め
    expect([...profile.subarray(24, 36)].every((b) => b === 0)).toBe(true);
  });
});

describe('ensureFileIdentifier', () => {
  it('writes two identical byte strings on first write (R-14.4-7 / -11)', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);

    expect(doc.context.trailerInfo.ID).toBeUndefined();
    expect(ensureFileIdentifier(doc)).toBe(true);

    const id = doc.context.trailerInfo.ID as PDFArray;
    expect(id).toBeInstanceOf(PDFArray);
    expect(id.size()).toBe(2);
    expect(String(id.get(0))).toBe(String(id.get(1)));
  });

  it('keeps the permanent identifier of an already-identified file (R-14.4-8)', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    const permanent = PDFHexString.of('0123456789ABCDEF0123456789ABCDEF');
    doc.context.trailerInfo.ID = doc.context.obj([permanent]); // 壊れた 1 要素の形

    expect(ensureFileIdentifier(doc)).toBe(true);
    const id = doc.context.trailerInfo.ID as PDFArray;
    expect(id.size()).toBe(2);
    expect(String(id.get(0))).toBe(String(permanent));
    // 第 2 要素は「最終更新時の内容」なので別値になる（R-14.4-10）
    expect(String(id.get(1))).not.toBe(String(permanent));
  });

  it('leaves a well-formed two-element ID alone', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    const a = PDFHexString.of('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    const b = PDFHexString.of('BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB');
    doc.context.trailerInfo.ID = doc.context.obj([a, b]);

    expect(ensureFileIdentifier(doc)).toBe(false);
    const id = doc.context.trailerInfo.ID as PDFArray;
    expect(String(id.get(0))).toBe(String(a));
    expect(String(id.get(1))).toBe(String(b));
  });
});

describe('ensureSrgbOutputIntent', () => {
  it('adds a GTS_PDFA1 intent with an embedded ICC profile (Table 365)', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);

    expect(ensureSrgbOutputIntent(doc)).toBe(true);

    const intents = outputIntents(doc);
    expect(intents.size()).toBe(1);
    const intent = intents.lookup(0) as PDFDict;
    expect(intent).toBeInstanceOf(PDFDict);
    expect(intent.get(PDFName.of('S'))).toBe(PDFName.of('GTS_PDFA1'));
    expect(intent.get(PDFName.of('Type'))).toBe(PDFName.of('OutputIntent'));

    // OutputConditionIdentifier は Required
    const condition = intent.lookup(PDFName.of('OutputConditionIdentifier')) as PDFHexString;
    expect(condition.decodeText()).toBe(SRGB_CONDITION_IDENTIFIER);

    // DestOutputProfile は条文上 optional だが、自己完結のため必ず埋める
    const profile = intent.lookup(PDFName.of('DestOutputProfile'));
    expect(profile).toBeInstanceOf(PDFRawStream);
    expect((profile as PDFRawStream).dict.lookup(PDFName.of('N'))?.toString()).toBe('3');
  });

  it('does not add a second PDF/A intent when one already exists (idempotent)', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);

    expect(ensureSrgbOutputIntent(doc)).toBe(true);
    expect(ensureSrgbOutputIntent(doc)).toBe(false);
    expect(outputIntents(doc).size()).toBe(1);
  });
});

describe('ensure_pdfa', () => {
  it('applies all three document-level requirements to a tagged PDF', async () => {
    const input = join(dir, 'tagged.pdf');
    const output = join(dir, 'tagged-pdfa.pdf');
    await makeTagged(input);

    const result = await ensurePdfa({ inputPath: input, outputPath: output });

    expect(result.flavour).toBe('3b');
    expect(result.wasDeclared).toBe(false);
    expect(result.addedRequirements).toContain('trailer /ID (file identifier)');
    expect(result.addedRequirements).toContain('sRGB output intent (GTS_PDFA1)');
    expect(result.addedRequirements).toContain('XMP pdfaid (part 3, conformance B)');

    const doc = await PDFDocument.load(await readFile(output), { updateMetadata: false });
    expect(doc.context.trailerInfo.ID).toBeInstanceOf(PDFArray);
    expect(outputIntents(doc).size()).toBe(1);
    expect(hasPdfaDeclaration(doc)).toBe(true);
  });

  it('B-21: 標準 14 書体の文書には「測ると落ちる」を構造化して返す', async () => {
    const input = join(dir, 'standard14.pdf');
    const output = join(dir, 'standard14-pdfa.pdf');
    // fontPath を渡さない = StandardFonts.Helvetica（埋め込まれない）
    await makeTagged(input);

    const result = await ensurePdfa({ inputPath: input, outputPath: output });

    // 宣言は書く（非破壊）。ただし「これは測ると落ちる」と名指しする
    expect(result.flavour).toBe('3b');
    expect(result.declarationRisks).toBeDefined();
    const risks = result.declarationRisks as NonNullable<typeof result.declarationRisks>;
    expect(risks).toHaveLength(1);
    expect(risks[0].code).toBe('FONT_NOT_EMBEDDED');
    expect(risks[0].affected.some((a) => a.includes('Helvetica'))).toBe(true);

    // 散文の警告にも出す（構造化フィールドを読まない利用者のため）
    expect((result.warnings ?? []).some((w) => w.includes('Known to fail'))).toBe(true);
  });

  it.skipIf(!process.env.TEST_FONT_PATH)(
    'B-21: フォントを埋め込んだ文書では risk を作らない（何にでも付けない）',
    async () => {
      const input = join(dir, 'embedded.pdf');
      const output = join(dir, 'embedded-pdfa.pdf');
      await handleCreateTextPdf({
        text: 'invoice body',
        title: 'Invoice',
        lang: 'en',
        tagged: true,
        fontPath: process.env.TEST_FONT_PATH,
        outputPath: input,
      });

      const result = await ensurePdfa({ inputPath: input, outputPath: output });

      // ここが常に発火するなら「PDF/A 宣言は全部危険」と言っているのと同じで情報量がない
      expect(result.declarationRisks).toBeUndefined();
    },
  );

  it('always warns that conformance was not checked (it only writes the claim)', async () => {
    const input = join(dir, 'honest.pdf');
    const output = join(dir, 'honest-pdfa.pdf');
    await makeTagged(input);

    const result = await ensurePdfa({ inputPath: input, outputPath: output });

    // 宣言を書いた以上、検査していない事実は必ず伝わらないといけない。
    // `if (warnings)` で包むと警告が消えても緑になるので、存在を直接要求する
    expect(result.warnings).toBeDefined();
    const warnings = result.warnings as string[];
    expect(warnings.some((w) => w.includes('CLAIMS PDF/A-3b'))).toBe(true);
    expect(warnings.some((w) => w.includes('validate_conformance'))).toBe(true);
    // 「veraPDF が判定する / ISO 19005 を引用しているのではない」= T2 の言い方も含む
    expect(warnings.some((w) => w.includes('veraPDF'))).toBe(true);
  });

  it('still warns on a document that already claims PDF/A (the claim is re-asserted)', async () => {
    const input = join(dir, 'again.pdf');
    const once = join(dir, 'again-1.pdf');
    const twice = join(dir, 'again-2.pdf');
    await makeTagged(input);

    await ensurePdfa({ inputPath: input, outputPath: once });
    const second = await ensurePdfa({ inputPath: once, outputPath: twice });

    expect(second.warnings).toBeDefined();
    expect((second.warnings as string[]).some((w) => w.includes('CLAIMS PDF/A-3b'))).toBe(true);
  });

  it('declares pdfaid without dropping pdfuaid (UC-2 regression)', async () => {
    const input = join(dir, 'ua.pdf');
    const output = join(dir, 'ua-pdfa.pdf');
    await makeTagged(input);

    const before = await PDFDocument.load(await readFile(input), { updateMetadata: false });
    expect(xmpText(before)).toContain('<pdfuaid:part>1</pdfuaid:part>');

    await ensurePdfa({ inputPath: input, outputPath: output });

    const xmp = xmpText(await PDFDocument.load(await readFile(output), { updateMetadata: false }));
    expect(xmp).toContain('<pdfaid:part>3</pdfaid:part>');
    expect(xmp).toContain('<pdfaid:conformance>B</pdfaid:conformance>');
    // PDF/A を名乗らせるついでに PDF/UA 宣言を落としてはいけない
    expect(xmp).toContain('<pdfuaid:part>1</pdfuaid:part>');
    // dc:title も残る（PDF/UA-1 7.1）
    expect(xmp).toContain('Invoice');
  });

  it('reports wasDeclared for a document that already claims PDF/A', async () => {
    const input = join(dir, 'twice.pdf');
    const once = join(dir, 'twice-1.pdf');
    const twice = join(dir, 'twice-2.pdf');
    await makeTagged(input);

    await ensurePdfa({ inputPath: input, outputPath: once });
    const second = await ensurePdfa({ inputPath: once, outputPath: twice });

    expect(second.wasDeclared).toBe(true);
    // 2 回目は /ID と OutputIntent を作り直さない
    expect(second.addedRequirements).not.toContain('trailer /ID (file identifier)');
    expect(second.addedRequirements).not.toContain('sRGB output intent (GTS_PDFA1)');
    expect(outputIntents(await PDFDocument.load(await readFile(twice))).size()).toBe(1);
  });

  it('keeps an embedded attachment alive (UC-4: attach_file then ensure_pdfa)', async () => {
    const input = join(dir, 'invoice.pdf');
    const attached = join(dir, 'invoice-attached.pdf');
    const output = join(dir, 'invoice-pdfa.pdf');
    const data = join(dir, 'invoice.csv');
    await makeTagged(input);
    await writeFile(data, 'no,amount\n1,1000\n', 'utf8');

    await attachFileToPdf({
      inputPath: input,
      attachmentPath: data,
      relationship: 'Data',
      outputPath: attached,
    });
    await ensurePdfa({ inputPath: attached, outputPath: output });

    const doc = await PDFDocument.load(await readFile(output), { updateMetadata: false });
    // catalog /AF（PDF/A-3 §6.8 の関連ファイル）が生き残っている
    const af = doc.catalog.lookup(PDFName.of('AF'));
    expect(af).toBeInstanceOf(PDFArray);
    expect((af as PDFArray).size()).toBe(1);
    // /Names /EmbeddedFiles も残っている
    const names = doc.catalog.lookup(PDFName.of('Names')) as PDFDict;
    expect(names).toBeInstanceOf(PDFDict);
    const embedded = names.lookup(PDFName.of('EmbeddedFiles')) as PDFDict;
    expect(embedded).toBeInstanceOf(PDFDict);
    expect((embedded.lookup(PDFName.of('Names')) as PDFArray).size()).toBe(2); // [name, ref]
  });

  it('produces the same /ID twice under SOURCE_DATE_EPOCH (E-6)', async () => {
    const previous = process.env.SOURCE_DATE_EPOCH;
    process.env.SOURCE_DATE_EPOCH = '1700000000';
    try {
      const input = join(dir, 'det.pdf');
      await makeTagged(input);

      const ids: string[] = [];
      for (const name of ['det-a.pdf', 'det-b.pdf']) {
        const output = join(dir, name);
        await ensurePdfa({ inputPath: input, outputPath: output });
        const doc = await PDFDocument.load(await readFile(output), { updateMetadata: false });
        ids.push(String((doc.context.trailerInfo.ID as PDFArray).get(0)));
      }
      expect(ids[0]).toBe(ids[1]);
    } finally {
      if (previous === undefined) delete process.env.SOURCE_DATE_EPOCH;
      else process.env.SOURCE_DATE_EPOCH = previous;
    }
  });
});

/**
 * B-20 = PDF/A-4。**判定はすべて veraPDF のもの**（ISO 19005-4 はコーパス外 = T2）で、
 * ここで検証できるのは「veraPDF が指摘した項目を、実際に書いた／消したか」だけである。
 * 適合そのものは e2e（veraPDF 109/109）で確かめる。
 *
 * 各期待値の隣にある規則 ID が**唯一の一次情報**なので、消さないこと。
 */
describe('ensure_pdfa (PDF/A-4)', () => {
  /** -4 は PDF 2.0 基盤なので、入力も 2.0 で作る */
  async function makePdf20(path: string): Promise<void> {
    await handleCreateTextPdf({
      text: 'invoice body',
      title: 'Invoice',
      pdfVersion: '2.0',
      outputPath: path,
    });
  }

  it('declares part 4 with a rev and no conformance level', async () => {
    const input = join(dir, 'a4-in.pdf');
    const output = join(dir, 'a4-out.pdf');
    await makePdf20(input);

    const result = await ensurePdfa({ inputPath: input, flavour: 'pdfa-4', outputPath: output });
    expect(result.flavour).toBe('4');

    const doc = await PDFDocument.load(await readFile(output), { updateMetadata: false });
    const xmp = xmpText(doc);
    expect(xmp).toContain('<pdfaid:part>4</pdfaid:part>');
    // 6.7.3-5「The value of "pdfaid:rev" shall be "2020"」— 抜くと veraPDF が落とすことを実測済み
    expect(xmp).toContain('<pdfaid:rev>2020</pdfaid:rev>');
    // -4 は conformance level を持たない。-3b からの載せ替えでも残ってはいけない
    expect(xmp).not.toContain('pdfaid:conformance');
  });

  it('rewrites the header to 2.0 (ISO 19005-4:2020 6.1.2-1)', async () => {
    const input = join(dir, 'a4-header-in.pdf');
    const output = join(dir, 'a4-header-out.pdf');
    await makePdf20(input);
    await ensurePdfa({ inputPath: input, flavour: 'pdfa-4', outputPath: output });

    // pdf-lib は保存のたびに 1.7 を書き直すので、**出力側の生バイト**を見ないと意味が無い
    const bytes = new Uint8Array(await readFile(output));
    expect(String.fromCharCode(...bytes.subarray(0, 8))).toBe('%PDF-2.0');
  });

  it('removes the Info dictionary (ISO 19005-4:2020 6.1.3-4)', async () => {
    const input = join(dir, 'a4-info-in.pdf');
    const output = join(dir, 'a4-info-out.pdf');
    await makePdf20(input);
    const result = await ensurePdfa({
      inputPath: input,
      flavour: 'pdfa-4',
      outputPath: output,
    });

    expect(result.addedRequirements.join(' ')).toContain('Info');
    // updateMetadata: false は必須 — 既定の load は Info を作り直して偽の赤を出す
    const doc = await PDFDocument.load(await readFile(output), { updateMetadata: false });
    expect(doc.context.trailerInfo.Info).toBeUndefined();
  });

  it('carries the PDF/A-4f variant in pdfaid:conformance (6.7.3-3)', async () => {
    const input = join(dir, 'a4f-in.pdf');
    const attached = join(dir, 'a4f-attached.pdf');
    const output = join(dir, 'a4f-out.pdf');
    const data = join(dir, 'a4f-data.csv');
    await makePdf20(input);
    await writeFile(data, 'no,amount\n1,1000\n', 'utf8');
    await attachFileToPdf({
      inputPath: input,
      attachmentPath: data,
      relationship: 'Data',
      outputPath: attached,
    });

    const result = await ensurePdfa({
      inputPath: attached,
      flavour: 'pdfa-4f',
      outputPath: output,
    });
    expect(result.flavour).toBe('4f');

    const doc = await PDFDocument.load(await readFile(output), { updateMetadata: false });
    const xmp = xmpText(doc);
    expect(xmp).toContain('<pdfaid:part>4</pdfaid:part>');
    expect(xmp).toContain('<pdfaid:conformance>F</pdfaid:conformance>');
    expect(xmp).toContain('<pdfaid:rev>2020</pdfaid:rev>');
    // 添付は -4f の存在理由そのもの。消えていないこと
    expect(doc.catalog.lookup(PDFName.of('AF'))).toBeInstanceOf(PDFArray);
  });

  it('names PDF/A-4 in the "not verified" warning, not PDF/A-3b', async () => {
    const input = join(dir, 'a4-warn-in.pdf');
    const output = join(dir, 'a4-warn-out.pdf');
    await makePdf20(input);
    const result = await ensurePdfa({ inputPath: input, flavour: 'pdfa-4', outputPath: output });

    const warnings = result.warnings ?? [];
    expect(warnings.some((w) => w.includes('CLAIMS PDF/A-4'))).toBe(true);
    expect(warnings.some((w) => w.includes('validate_conformance(flavour: "pdfa-4")'))).toBe(true);
  });

  it('does not silently bump the version of a signed file', async () => {
    // 増分更新は先頭のヘッダを書き換えられない。書き換えれば署名が壊れる。
    // フィクスチャの署名 PDF は 1.7 なので、-4 を求められたら断るのが正しい
    const input = join(dir, 'a4-signed-in.pdf');
    await makeTagged(input); // 1.7 の文書
    await expect(
      ensurePdfa({
        inputPath: input,
        flavour: 'pdfa-4',
        preserveSignatures: true,
        outputPath: join(dir, 'never.pdf'),
      }),
    ).rejects.toMatchObject({ code: 'SIGNED_PDF' });
  });

  it('leaves the PDF/A-3b default untouched', async () => {
    const input = join(dir, 'default-in.pdf');
    const output = join(dir, 'default-out.pdf');
    await makeTagged(input);
    const result = await ensurePdfa({ inputPath: input, outputPath: output });

    expect(result.flavour).toBe('3b');
    const bytes = new Uint8Array(await readFile(output));
    expect(String.fromCharCode(...bytes.subarray(0, 8))).toBe('%PDF-1.7');
    const doc = await PDFDocument.load(await readFile(output), { updateMetadata: false });
    expect(doc.context.trailerInfo.Info).toBeDefined();
    expect(xmpText(doc)).toContain('<pdfaid:conformance>B</pdfaid:conformance>');
  });
});
