/**
 * 描画実体（グリフ）の回帰テスト
 *
 * 背景: pdf-lib の embedFont(subset:true)（fontkit サブセッタ）は CJK フォントの
 * グリフを取りこぼし、全ビューアで豆腐/空白になる不具合があった（v0.2.1 以前）。
 * ToUnicode は正しいままなので extract.test.ts は素通りしてしまい、破損を検知できなかった。
 *
 * ここでは「埋め込まれたフォントを取り出して、実際に使用文字のグリフ実体（アウトライン）が
 * 残っているか」を検証する。外部ツール非依存（zlib + fontkit のみ）。
 */

import { inflateSync } from 'node:zlib';
import fontkit from '@pdf-lib/fontkit';
import { describe, it, expect } from 'vitest';
import { handleCreateTextPdf } from '../src/tools/handlers.js';
import type { CreateResult } from '../src/types/index.js';

const fontPath = process.env.TEST_FONT_PATH;

/** PDF バイト列から埋め込みフォントプログラム（FontFile/FontFile2/FontFile3）を取り出す */
function extractEmbeddedFont(pdf: Buffer): Buffer | undefined {
  // 各 stream を総当たりで inflate し、sfnt/CFF のシグネチャを持つものを拾う
  const marker = Buffer.from('stream');
  let idx = 0;
  while ((idx = pdf.indexOf(marker, idx)) !== -1) {
    // "endstream" の一部にマッチした場合は読み飛ばす
    if (pdf.subarray(idx - 3, idx).toString('latin1') === 'end') {
      idx += marker.length;
      continue;
    }
    let start = idx + marker.length;
    if (pdf[start] === 0x0d) start++;
    if (pdf[start] === 0x0a) start++;
    const end = pdf.indexOf(Buffer.from('endstream'), start);
    if (end === -1) break;
    const raw = pdf.subarray(start, end);
    try {
      const data = inflateSync(raw);
      const magic = data.subarray(0, 4).toString('latin1');
      // OpenType(CFF)='OTTO', TrueType=0x00010000, 生CFF は先頭が 0x01 0x00
      if (
        magic === 'OTTO' ||
        data.readUInt32BE(0) === 0x00010000 ||
        (data[0] === 0x01 && data[1] === 0x00)
      ) {
        return data;
      }
    } catch {
      // 非圧縮 or 画像等 — 無視
    }
    idx = end;
  }
  return undefined;
}

describe.skipIf(!fontPath)('embedded font integrity (glyph outlines survive subsetting)', () => {
  it('keeps real outlines for every rendered character', async () => {
    const text = 'グリフ欠落ポリシーの確認。収録あり。実装されるはず。English します。';
    const result = (await handleCreateTextPdf({ text, fontPath, returnBase64: true })) as CreateResult;
    const pdf = Buffer.from(result.base64 as string, 'base64');

    const fontData = extractEmbeddedFont(pdf);
    expect(fontData, 'embedded font program not found in output PDF').toBeDefined();

    const embedded = fontkit.create(fontData as Buffer);

    // 使用した各文字が、埋め込みフォント側でも「中身のあるグリフ」として残っていること。
    // 破損時はここでグリフ自体が失われる（= 豆腐/空白描画の原因）。
    const chars = [...new Set([...text.replace(/[\s。]/g, '')])];
    const broken: string[] = [];
    for (const ch of chars) {
      const cp = ch.codePointAt(0) as number;
      if (!embedded.hasGlyphForCodePoint(cp)) {
        broken.push(ch);
        continue;
      }
      const [glyph] = embedded.glyphsForString(ch);
      // path.commands が空 = アウトライン無し（.notdef 相当）
      if (!glyph || glyph.path.commands.length === 0) broken.push(ch);
    }

    expect(broken, `characters lost their outlines after subsetting: ${broken.join('')}`).toEqual([]);
  });

  it('subsets the font (output stays far smaller than the source font)', async () => {
    const result = (await handleCreateTextPdf({
      text: '短いテキスト',
      fontPath,
      returnBase64: true,
    })) as CreateResult;
    // 元フォントは数 MB。サブセットが効いていれば PDF 全体で 1MB を大きく下回る
    expect(result.bytes).toBeLessThan(500_000);
  });
});
