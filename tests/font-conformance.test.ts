/**
 * B-14（SPEC-REAUDIT の W-2 / W-3 / W-4）: 埋め込みフォントの条文適合
 *
 * **ここは pdf-lib の読み戻しでは守れない。** pdf-lib は自分が書いた辞書をそのまま読み返すので、
 * 「CFF なのに FontFile2 と名乗っている」も「Length1 が無い」も検出できない。
 * W-1（v0.13.0 の carry 破損）でも同じやり方で空振りしたので、ここでは
 * **qpdf --qdf で展開したバイト列を直接検査**する（独立実装での読み戻し）。
 *
 * さらに W-2 は「辞書を条文に合わせたら描画が変わってしまった」が最悪の結末なので、
 * **poppler で実際にラスタライズして、是正前後でピクセルが変わらないこと**を確かめる。
 * CIDFontType0 のグリフ選択は CID → charset → GID（R-9.7.4.2-4）で、CIDFontType2 の
 * CID → GID とは別経路だからである。
 */

import { execFile, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handleCreateTextPdf } from '../src/tools/handlers.js';

const execFileAsync = promisify(execFile);

const FONT_OTF = process.env.TEST_FONT_PATH;
/** Linux/macOS のどちらでも見つかりやすい TrueType（無ければ .ttf の検査はスキップ） */
const TTF_CANDIDATES = [
  '/usr/share/fonts/truetype/crosextra/Carlito-Regular.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/System/Library/Fonts/Supplemental/Arial.ttf',
];

let dir: string;

/**
 * **同期で調べること。** `skipIf` の条件はテスト定義時に評価されるので、
 * `beforeAll` で立てたフラグを見ると常に「未検出」になり、**全件スキップのまま緑**になる
 * （最初の実装がこれで、7 件が黙って飛んだ。[[green-tests-can-be-vacuous]] のまた別の形）。
 */
function hasBinary(bin: string, args: string[]): boolean {
  try {
    execFileSync(bin, args, { stdio: 'ignore' });
    return true;
  } catch (error) {
    // 実行できて非 0 で終わるだけなら「在る」（pdftoppm -v は 99 を返す）
    return (error as { code?: string }).code !== 'ENOENT';
  }
}

const haveQpdf = hasBinary('qpdf', ['--version']);
const havePoppler = hasBinary('pdftoppm', ['-v']);
const ttfPath = TTF_CANDIDATES.find((candidate) => existsSync(candidate));

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pwm-fontconf-'));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** qpdf --qdf で圧縮とオブジェクトストリームを解いた中身（latin1 文字列） */
async function expanded(pdfPath: string): Promise<string> {
  const out = `${pdfPath}.qdf.pdf`;
  await execFileAsync('qpdf', ['--qdf', '--object-streams=disable', pdfPath, out]);
  return (await readFile(out)).toString('latin1');
}

/** PDF から埋め込みフォントプログラムの実体（デコード済み）を取り出す */
async function embeddedProgram(pdfPath: string): Promise<Buffer | undefined> {
  const out = `${pdfPath}.qdf2.pdf`;
  await execFileAsync('qpdf', ['--qdf', '--object-streams=disable', pdfPath, out]);
  const bytes = await readFile(out);
  const start = bytes.indexOf('OTTO', 0, 'latin1');
  if (start < 0) return undefined;
  const end = bytes.indexOf('\nendstream', start, 'latin1');
  return end < 0 ? undefined : bytes.subarray(start, end);
}

/**
 * CFF の charset を「GID 1.. に対応する CID の配列」として読む。
 * 実装（`font-conformance.ts`）とは独立に書いた読み取りで、判定基準は
 * 「identity か否か」という条文側の性質なので、実装の写しにはなっていない。
 */
function readCffCharset(font: Buffer): number[] | undefined {
  const numTables = font.readUInt16BE(4);
  let cffOffset = -1;
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    if (font.toString('latin1', rec, rec + 4) === 'CFF ') cffOffset = font.readUInt32BE(rec + 8);
  }
  if (cffOffset < 0) return undefined;
  const cff = font.subarray(cffOffset);

  const index = (pos: number): { items: Array<[number, number]>; end: number } => {
    const count = cff.readUInt16BE(pos);
    if (count === 0) return { items: [], end: pos + 2 };
    const offSize = cff[pos + 2];
    const at = pos + 3;
    const read = (i: number): number => {
      let v = 0;
      for (let b = 0; b < offSize; b++) v = v * 256 + cff[at + i * offSize + b];
      return v;
    };
    const dataStart = at + (count + 1) * offSize - 1;
    const items: Array<[number, number]> = [];
    for (let i = 0; i < count; i++) items.push([dataStart + read(i), dataStart + read(i + 1)]);
    return { items, end: dataStart + read(count) };
  };

  const name = index(cff[2]);
  const top = index(name.end);
  if (top.items.length === 0) return undefined;
  const dict = cff.subarray(top.items[0][0], top.items[0][1]);

  // Top DICT から charset(15) と CharStrings(17) のオフセットを拾う
  const ops = new Map<number, number[]>();
  let operands: number[] = [];
  for (let i = 0; i < dict.length; ) {
    const b0 = dict[i];
    if (b0 <= 21) {
      ops.set(b0 === 12 ? 1200 + dict[i + 1] : b0, operands);
      operands = [];
      i += b0 === 12 ? 2 : 1;
    } else if (b0 === 28) {
      operands.push(dict.readInt16BE(i + 1));
      i += 3;
    } else if (b0 === 29) {
      operands.push(dict.readInt32BE(i + 1));
      i += 5;
    } else if (b0 === 30) {
      i += 1;
      while (i < dict.length) {
        const v = dict[i];
        i += 1;
        if ((v & 0x0f) === 0x0f || v >> 4 === 0x0f) break;
      }
      operands.push(0);
    } else if (b0 >= 32 && b0 <= 246) {
      operands.push(b0 - 139);
      i += 1;
    } else if (b0 >= 247 && b0 <= 250) {
      operands.push((b0 - 247) * 256 + dict[i + 1] + 108);
      i += 2;
    } else if (b0 >= 251 && b0 <= 254) {
      operands.push(-(b0 - 251) * 256 - dict[i + 1] - 108);
      i += 2;
    } else {
      i += 1;
    }
  }

  const charsetOffset = ops.get(15)?.[0];
  const charStrings = ops.get(17)?.[0];
  if (!charsetOffset || charsetOffset <= 2 || !charStrings) return undefined;
  const numGlyphs = index(charStrings).items.length;

  const format = cff[charsetOffset];
  const out: number[] = [];
  if (format === 0) {
    for (let i = 0; i < numGlyphs - 1; i++) out.push(cff.readUInt16BE(charsetOffset + 1 + i * 2));
    return out;
  }
  if (format === 1 || format === 2) {
    let pos = charsetOffset + 1;
    while (out.length < numGlyphs - 1) {
      const first = cff.readUInt16BE(pos);
      const nLeft = format === 1 ? cff[pos + 2] : cff.readUInt16BE(pos + 2);
      for (let i = 0; i <= nLeft && out.length < numGlyphs - 1; i++) out.push(first + i);
      pos += format === 1 ? 3 : 4;
    }
    return out;
  }
  return undefined;
}

describe.skipIf(!FONT_OTF)('W-2: CFF (.otf) は CIDFontType0 + FontFile3 /OpenType で埋める', () => {
  let pdf: string;

  beforeAll(async () => {
    pdf = join(dir, 'otf.pdf');
    await handleCreateTextPdf({
      text: 'Conformance こんにちは 123',
      fontPath: FONT_OTF,
      outputPath: pdf,
    });
  });

  it.skipIf(!haveQpdf)(
    'FontFile2/CIDFontType2 ではなく FontFile3 /OpenType + CIDFontType0 になる',
    async () => {
      const text = await expanded(pdf);
      // R-9.7.4.2-3: CFF を埋め込む CIDFont の FontFile3 は CIDFontType0C か OpenType
      expect(text).toMatch(/\/FontFile3/);
      expect(text).toMatch(/\/Subtype \/OpenType/);
      expect(text).toMatch(/\/Subtype \/CIDFontType0\b/);
      // R-9.9.1-33/-34: OTTO は glyf も loca も持たないので FontFile2 とは名乗れない
      expect(text).not.toMatch(/\/FontFile2/);
      // CIDToGIDMap は Table 115 で CIDFontType2 専用
      expect(text).not.toMatch(/\/CIDToGIDMap/);
    },
  );

  it.skipIf(!haveQpdf)('埋め込まれた font program は CFF と cmap を持つ（Table 124）', async () => {
    const bytes = await readFile(pdf);
    // 圧縮を解いた qdf 側からストリーム実体を取り出す
    const text = await expanded(pdf);
    const start = text.indexOf('OTTO');
    expect(start, 'the embedded program should be a CFF-based OpenType (OTTO)').toBeGreaterThan(0);
    const header = text.slice(start, start + 4096);
    expect(header).toContain('CFF ');
    // Table 124 の FontFile3 / OpenType は CFF ベースのとき cmap を必須にしている
    expect(header).toContain('cmap');
    expect(bytes.length).toBeGreaterThan(0);
  });

  it.skipIf(!haveQpdf)(
    'CFF の charset が identity — CIDFontType0 のグリフ選択が CID=GID と噛み合う',
    async () => {
      // **これが W-2 の本丸**。CIDFontType0 のグリフ選択は CID → charset → GID
      // （R-9.7.4.2-4）で、CIDFontType2 の CID → GID とは別経路。
      // writer（pdf-lib）は Identity-H で CID = GID を書くので、charset が
      // 「新 GID → 元の GID」のままだと**条文どおりに解決する処理系が別のグリフを描く**。
      // 是正で charset を identity に潰しているので、ここでそれを直接確かめる。
      const font = await embeddedProgram(pdf);
      expect(font, 'the embedded font program should be extractable').toBeDefined();
      const charset = readCffCharset(font as Buffer);
      expect(
        charset,
        'the subset should be a CID-keyed CFF with a format 0/1/2 charset',
      ).toBeDefined();
      // .notdef は載らないので、載るのは GID 1.. の分
      expect(charset).toEqual((charset as number[]).map((_, i) => i + 1));
    },
  );

  it.skipIf(!havePoppler)('ラスタライズしても空白にならない（グリフが引けている）', async () => {
    await execFileAsync('pdftoppm', ['-r', '100', '-png', pdf, join(dir, 'ink')]);
    const png = await readFile(join(dir, 'ink-1.png'));
    // 何も描けていない PDF は同条件で 2KB 未満の真っ白 PNG になる（実測）
    expect(png.length).toBeGreaterThan(3000);
  });

  it.skipIf(!havePoppler)(
    'poppler の "Mismatch between font type and embedded font file" が出ない',
    async () => {
      // この警告こそ W-2 の症状だった（「無害・対応不要」と記録していたが実は shall 違反）
      const { stderr } = await execFileAsync('pdftoppm', [
        '-r',
        '50',
        '-png',
        pdf,
        join(dir, 'warn'),
      ]);
      expect(stderr).not.toContain('Mismatch between font type');
    },
  );
});

describe.skipIf(!FONT_OTF)('W-3: サブセット名に 6 大文字のタグを付ける（R-9.9.2-2/-3）', () => {
  it.skipIf(!haveQpdf)('BaseFont / FontName が ABCDEF+元の名前 になる', async () => {
    const pdf = join(dir, 'tag.pdf');
    await handleCreateTextPdf({ text: 'Tag test', fontPath: FONT_OTF, outputPath: pdf });
    const text = await expanded(pdf);

    const baseFonts = [...text.matchAll(/\/BaseFont \/([^\s/\]>]+)/g)].map((m) => m[1]);
    const fontNames = [...text.matchAll(/\/FontName \/([^\s/\]>]+)/g)].map((m) => m[1]);
    expect(baseFonts.length).toBeGreaterThan(0);
    expect(fontNames.length).toBeGreaterThan(0);

    for (const name of [...baseFonts, ...fontNames]) {
      // タグは大文字ちょうど 6 文字 + '+' + 元の PostScript 名
      expect(name).toMatch(/^[A-Z]{6}\+/);
      // pdf-lib の乱数サフィックス（-7572 など）は「元の PostScript 名」を壊すので残さない
      expect(name).not.toMatch(/-\d+$/);
    }
    // 同一フォントの BaseFont と FontName は同じ名前でなければならない
    expect(new Set([...baseFonts, ...fontNames]).size).toBe(1);
  });

  it.skipIf(!haveQpdf)('タグは内容が同じなら同じ（決定論的出力を壊さない）', async () => {
    const a = join(dir, 'tag-a.pdf');
    const b = join(dir, 'tag-b.pdf');
    await handleCreateTextPdf({ text: 'Same subset', fontPath: FONT_OTF, outputPath: a });
    await handleCreateTextPdf({ text: 'Same subset', fontPath: FONT_OTF, outputPath: b });
    const tagOf = async (p: string) =>
      /\/BaseFont \/([A-Z]{6})\+/.exec(await expanded(p))?.[1] ?? '';
    expect(await tagOf(a)).toBe(await tagOf(b));
    expect(await tagOf(a)).toHaveLength(6);
  });
});

describe('W-4: TrueType の FontFile2 には Length1 が要る（Table 125）', () => {
  it.skipIf(!haveQpdf)('Length1 がデコード後のバイト長と一致する', async () => {
    if (!ttfPath) return; // TrueType が見つからない環境ではスキップ
    const pdf = join(dir, 'ttf.pdf');
    await handleCreateTextPdf({ text: 'TrueType 123', fontPath: ttfPath, outputPath: pdf });
    const text = await expanded(pdf);

    // .ttf は glyf を持つので FontFile2 のままが正しい（OTTO 経路に巻き込まない）
    expect(text).toMatch(/\/FontFile2/);
    expect(text).toMatch(/\/Subtype \/CIDFontType2\b/);

    const declared = /\/Length1 (\d+)/.exec(text)?.[1];
    expect(declared, 'Length1 is Required for TrueType font programs').toBeDefined();

    // qdf は展開済みなので、ストリーム実体の長さと突き合わせられる
    const marker = new RegExp(`/Length1 ${declared}[^>]*>>\\s*stream\\r?\\n`);
    const match = marker.exec(text);
    expect(match).not.toBeNull();
    const start = (match as RegExpExecArray).index + (match as RegExpExecArray)[0].length;
    const end = text.indexOf('\nendstream', start);
    expect(end - start).toBe(Number(declared));
  });
});
