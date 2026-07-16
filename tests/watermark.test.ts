/**
 * add_watermark のテスト
 *
 * 検証の主眼:
 *   - 幾何: 回転しても文字の中心がページ中央に来ること（centeredOrigin）
 *   - 順序: behind の指定どおりに透かしが本文の前後へ入ること（/Contents の並び）
 *   - PDF/UA: タグ付き PDF に入れても Artifact で囲まれ、構造木を汚さないこと
 */

import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { PDFArray, PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';
import { addWatermark } from '../src/services/editor.js';
import { centeredOrigin } from '../src/services/watermark.js';
import { handleCreateTextPdf } from '../src/tools/handlers.js';
import { AddWatermarkSchema, parseArgs } from '../src/utils/validation.js';

const FONT_PATH = process.env.TEST_FONT_PATH;

let dir: string;

/** 素の（タグ無し）PDF を 2 ページ作る */
async function makePlainPdf(path: string): Promise<void> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const label of ['PAGE ONE', 'PAGE TWO']) {
    const page = doc.addPage([400, 400]);
    page.drawText(label, { x: 40, y: 200, size: 18, font });
  }
  await writeFile(path, await doc.save());
}

/** /Contents の各ストリームを復号して文字列で返す */
async function contentStreams(path: string, pageIndex = 0): Promise<string[]> {
  const doc = await PDFDocument.load(await readFile(path));
  const page = doc.getPage(pageIndex);
  const contents = page.node.lookup(PDFName.of('Contents'));
  const refs = contents instanceof PDFArray ? contents.asArray() : [];
  return refs.map((ref) => {
    const stream = doc.context.lookup(ref) as { getContents(): Uint8Array };
    let bytes = Buffer.from(stream.getContents());
    try {
      bytes = inflateSync(bytes);
    } catch {
      /* 非圧縮ならそのまま */
    }
    return bytes.toString('latin1');
  });
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pwm-watermark-'));
});

describe('centeredOrigin', () => {
  it('角度 0 では文字が水平方向にページ中央へ来る', () => {
    // 幅 400 のページに幅 100 の文字 → 開始 x は 400/2 - 50 = 150
    const { x } = centeredOrigin(400, 400, 100, 20, 0);
    expect(x).toBeCloseTo(150, 5);
  });

  it('どの角度でも文字の中心はページ中央に一致する', () => {
    const pageW = 595;
    const pageH = 842;
    const textW = 300;
    const size = 60;
    for (const angle of [0, 30, 45, 90, 135, -45]) {
      const { x, y } = centeredOrigin(pageW, pageH, textW, size, angle);
      // 開始点から、角度ぶん回した中心オフセットを足し戻すとページ中央になるはず
      const rad = (angle * Math.PI) / 180;
      const halfW = textW / 2;
      const halfH = size * 0.35;
      const cx = x + (halfW * Math.cos(rad) - halfH * Math.sin(rad));
      const cy = y + (halfW * Math.sin(rad) + halfH * Math.cos(rad));
      expect(cx).toBeCloseTo(pageW / 2, 5);
      expect(cy).toBeCloseTo(pageH / 2, 5);
    }
  });
});

describe('addWatermark', () => {
  it('全ページに透かしを入れる', async () => {
    const input = join(dir, 'plain.pdf');
    const output = join(dir, 'wm-all.pdf');
    await makePlainPdf(input);

    const result = await addWatermark({ inputPath: input, text: 'DRAFT', outputPath: output });

    expect(result.watermarked).toBe(2);
    expect(result.pageCount).toBe(2);
    expect(result.artifact).toBe(false); // タグ無し文書
  });

  it('pages 指定で対象ページを絞れる', async () => {
    const input = join(dir, 'plain2.pdf');
    const output = join(dir, 'wm-p2.pdf');
    await makePlainPdf(input);

    const result = await addWatermark({
      inputPath: input,
      text: 'COPY',
      pages: '2',
      outputPath: output,
    });

    expect(result.watermarked).toBe(1);
    // 1 ページ目には透かしが無い（本文ストリームのみ）
    const p1 = await contentStreams(output, 0);
    expect(p1.join('')).not.toContain('gs'); // 透明度用の ExtGState が使われていない
  });

  it('behind: true では透かしが本文より先に描画される', async () => {
    const input = join(dir, 'plain3.pdf');
    const output = join(dir, 'wm-behind.pdf');
    await makePlainPdf(input);

    await addWatermark({ inputPath: input, text: 'DRAFT', outputPath: output, behind: true });

    const streams = await contentStreams(output, 0);
    const wmIndex = streams.findIndex((s) => s.includes('gs')); // 透かしは ExtGState を使う
    const bodyIndex = streams.findIndex((s) => s.includes('Tf') && !s.includes('gs'));
    expect(wmIndex).toBeGreaterThanOrEqual(0);
    expect(bodyIndex).toBeGreaterThanOrEqual(0);
    expect(wmIndex).toBeLessThan(bodyIndex);
  });

  it('behind: false では透かしが本文より後に描画される', async () => {
    const input = join(dir, 'plain4.pdf');
    const output = join(dir, 'wm-front.pdf');
    await makePlainPdf(input);

    await addWatermark({ inputPath: input, text: 'DRAFT', outputPath: output, behind: false });

    const streams = await contentStreams(output, 0);
    const wmIndex = streams.findIndex((s) => s.includes('gs'));
    const bodyIndex = streams.findIndex((s) => s.includes('Tf') && !s.includes('gs'));
    expect(wmIndex).toBeGreaterThan(bodyIndex);
  });

  it.runIf(FONT_PATH)('タグ付き PDF では Artifact として囲む', async () => {
    const tagged = join(dir, 'tagged.pdf');
    await handleCreateTextPdf({
      text: '本文テキスト',
      title: 'テスト文書',
      lang: 'ja',
      tagged: true,
      fontPath: FONT_PATH,
      outputPath: tagged,
    });

    const output = join(dir, 'tagged-wm.pdf');
    const result = await addWatermark({
      inputPath: tagged,
      text: '社外秘',
      fontPath: FONT_PATH,
      outputPath: output,
    });

    expect(result.artifact).toBe(true);

    const streams = await contentStreams(output, 0);
    // 透かしのストリームが /Artifact BMC ... EMC で囲まれている
    const artifactStream = streams.find((s) => s.includes('/Artifact'));
    expect(artifactStream).toBeDefined();
    expect(artifactStream).toContain('BMC');
    expect(artifactStream).toContain('EMC');
  });

  it.runIf(FONT_PATH)('透かしは構造木に要素を増やさない', async () => {
    const tagged = join(dir, 'tagged2.pdf');
    await handleCreateTextPdf({
      text: '本文テキスト',
      title: 'テスト文書',
      lang: 'ja',
      tagged: true,
      fontPath: FONT_PATH,
      outputPath: tagged,
    });

    const countKids = async (path: string): Promise<number> => {
      const doc = await PDFDocument.load(await readFile(path));
      const root = doc.catalog.lookup(PDFName.of('StructTreeRoot')) as {
        lookup(n: PDFName): unknown;
      };
      const kids = root.lookup(PDFName.of('K'));
      return kids instanceof PDFArray ? kids.size() : 1;
    };
    const before = await countKids(tagged);

    const output = join(dir, 'tagged2-wm.pdf');
    await addWatermark({
      inputPath: tagged,
      text: '社外秘',
      fontPath: FONT_PATH,
      outputPath: output,
    });

    expect(await countKids(output)).toBe(before);
  });

  it.runIf(FONT_PATH)('日本語の透かしを埋め込める', async () => {
    const input = join(dir, 'plain5.pdf');
    const output = join(dir, 'wm-ja.pdf');
    await makePlainPdf(input);

    const result = await addWatermark({
      inputPath: input,
      text: '社外秘',
      fontPath: FONT_PATH,
      outputPath: output,
    });

    expect(result.watermarked).toBe(2);
  });

  it('標準フォントでは日本語の透かしを拒否する', async () => {
    const input = join(dir, 'plain6.pdf');
    await makePlainPdf(input);

    await expect(
      addWatermark({ inputPath: input, text: '社外秘', outputPath: join(dir, 'ng.pdf') }),
    ).rejects.toThrow();
  });
});

describe('validateAddWatermarkArgs', () => {
  const base = { inputPath: '/tmp/a.pdf', text: 'DRAFT' };

  it('最小構成を受け付ける', () => {
    expect(() => parseArgs(AddWatermarkSchema, base)).not.toThrow();
  });

  it('text が空なら弾く', () => {
    expect(() => parseArgs(AddWatermarkSchema, { ...base, text: '' })).toThrow(/text/);
  });

  it('opacity が範囲外なら弾く', () => {
    expect(() => parseArgs(AddWatermarkSchema, { ...base, opacity: 1.5 })).toThrow(/opacity/);
    expect(() => parseArgs(AddWatermarkSchema, { ...base, opacity: -0.1 })).toThrow(/opacity/);
  });

  it('fontSize が範囲外なら弾く', () => {
    expect(() => parseArgs(AddWatermarkSchema, { ...base, fontSize: 200 })).toThrow(/fontSize/);
  });

  it('angle が数値でなければ弾く', () => {
    expect(() => parseArgs(AddWatermarkSchema, { ...base, angle: '45' })).toThrow(/angle/);
  });

  it('behind が真偽値でなければ弾く', () => {
    expect(() => parseArgs(AddWatermarkSchema, { ...base, behind: 'yes' })).toThrow(/behind/);
  });
});
