import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { handleCreateTextPdf } from '../src/tools/handlers.js';

/**
 * PDF 内のすべての stream を（FlateDecode なら）展開して結合した文字列を返す。
 * 外部ツール（pdftotext 等）に依存せず抽出可能性を検査するためのヘルパ。
 */
function decodeStreams(pdf: Buffer): string {
  const chunks: string[] = [];
  let pos = 0;
  for (;;) {
    const s = pdf.indexOf('stream', pos, 'latin1');
    if (s === -1) break;
    let dataStart = s + 'stream'.length;
    if (pdf[dataStart] === 0x0d) dataStart++;
    if (pdf[dataStart] === 0x0a) dataStart++;
    const e = pdf.indexOf('endstream', dataStart, 'latin1');
    if (e === -1) break;
    const raw = pdf.subarray(dataStart, e);
    try {
      chunks.push(zlib.inflateSync(raw).toString('latin1'));
    } catch {
      chunks.push(raw.toString('latin1'));
    }
    pos = e + 'endstream'.length;
  }
  return chunks.join('\n');
}

/**
 * コンテンツストリーム中の `<HEX> Tj` を hex 復号して連結する。
 * pdf-lib は show text を 16 進文字列で書き出すため、標準フォント(WinAnsi)では
 * 復号したバイト列がそのまま文字コードになる。
 */
function extractShownText(decoded: string): string {
  const out: string[] = [];
  for (const m of decoded.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) {
    const hex = m[1];
    let s = '';
    for (let i = 0; i + 1 < hex.length; i += 2) {
      s += String.fromCharCode(Number.parseInt(hex.slice(i, i + 2), 16));
    }
    out.push(s);
  }
  return out.join('');
}

describe('extractability (standard font)', () => {
  it('shown text decodes back to the original ASCII (copy/searchable)', async () => {
    const res = await handleCreateTextPdf({ text: 'Hello Searchable World' });
    const buf = Buffer.from(res.base64 as string, 'base64');
    const shown = extractShownText(decodeStreams(buf));
    expect(shown).toContain('Hello Searchable World');
  });
});

/**
 * 埋め込みフォント（日本語）の ToUnicode CMap を検証。
 * ToUnicode がないと CID グリフから文字へ逆引きできず抽出/検索ができないため、
 * これが「抽出・検索可能」の本質的な保証になる。
 * TEST_FONT_PATH があるときのみ実行。
 */
const fontPath = process.env.TEST_FONT_PATH;
describe.skipIf(!fontPath)('extractability (embedded CJK font, ToUnicode)', () => {
  it('emits a ToUnicode CMap that maps a Japanese glyph to U+65E5 (日)', async () => {
    const res = await handleCreateTextPdf({ text: '\u65e5\u672c\u8a9e', fontPath });
    const buf = Buffer.from(res.base64 as string, 'base64');
    const decoded = decodeStreams(buf);
    expect(decoded).toContain('beginbfchar');
    expect(decoded.toUpperCase()).toContain('65E5');
  });
});
