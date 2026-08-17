/**
 * COS を読む向きの原始関数（§7.9.2.2.1 / §7.9.4）。
 *
 * 旧実装（pdf-lib 委譲）との A/B は §3.19 に記録した。**意図して違う 3 点**を
 * ここで固定する:
 *   1. UTF-8 BOM（R-7.9.2.2.1-4・PDF 2.0）を復号する — 旧実装は復号しない
 *   2. 暦に無い日（2 月 31 日）は `undefined` — 旧実装は 3 月 3 日に繰り上げる
 *   3. 0x16 はそのまま通す — 旧実装は U+0017 に写す（ISO 32000-2 Table D.2 に無い）
 */

import { describe, expect, it } from 'vitest';
import { decodeTextString, parsePdfDate, pdfDateToIso, textOf } from '../src/services/cos-read.js';
import { hex, literal, textString } from '../src/services/cos.js';

const bytes = (...values: number[]): Uint8Array => new Uint8Array(values);
const points = (text: string): string[] =>
  [...text].map((ch) => `U+${(ch.codePointAt(0) as number).toString(16).toUpperCase().padStart(4, '0')}`);

describe('decodeTextString — §7.9.2.2.1', () => {
  it('BOM が無ければ PDFDocEncoding として読む', () => {
    expect(decodeTextString(new TextEncoder().encode('Hello (Title)'))).toBe('Hello (Title)');
  });

  it('PDFDocEncoding は Latin-1 ではない（0x80 / 0xA0 / 0x18）', () => {
    expect(points(decodeTextString(bytes(0x80)))).toEqual(['U+2022']); // bullet
    expect(points(decodeTextString(bytes(0xa0)))).toEqual(['U+20AC']); // euro（Latin-1 では NBSP）
    expect(points(decodeTextString(bytes(0x18)))).toEqual(['U+02D8']); // breve
  });

  it('Table D.2 に無く周囲が割り当て済みの符号は U+FFFD にする', () => {
    expect(points(decodeTextString(bytes(0x7f, 0x9f, 0xad)))).toEqual(['U+FFFD', 'U+FFFD', 'U+FFFD']);
  });

  it('0x16 はそのまま通す（旧実装は U+0017 に写していた）', () => {
    expect(points(decodeTextString(bytes(0x16)))).toEqual(['U+0016']);
  });

  it('UTF-16BE は BOM で判定する（R-7.9.2.2.1-3）', () => {
    expect(decodeTextString(bytes(0xfe, 0xff, 0x30, 0x53, 0x30, 0x93))).toBe('こん');
  });

  it('サロゲート対を復号する（R-7.9.2.2.1-5）', () => {
    expect(decodeTextString(bytes(0xfe, 0xff, 0xd8, 0x3d, 0xde, 0x00))).toBe('😀');
  });

  it('UTF-8 BOM を復号する（R-7.9.2.2.1-4・PDF 2.0）', () => {
    expect(decodeTextString(bytes(0xef, 0xbb, 0xbf, 0xe3, 0x81, 0x93, 0xe3, 0x82, 0x93))).toBe('こん');
  });

  it('書く向き（`textString`）と往復する', () => {
    for (const text of ['ASCII title', 'こんにちは', 'mixed 日本語 42', '😀 と絵文字']) {
      const written = textString(text);
      if (written.kind !== 'string') throw new Error('string ではない');
      expect(decodeTextString(written.bytes)).toBe(text);
    }
  });

  it('`literal` で書いた ASCII とも往復する', () => {
    const written = literal('Hello');
    if (written.kind !== 'string') throw new Error('string ではない');
    expect(decodeTextString(written.bytes)).toBe('Hello');
  });
});

describe('textOf', () => {
  it('文字列以外は undefined', () => {
    expect(textOf(undefined)).toBeUndefined();
    expect(textOf({ kind: 'name', value: 'Title' })).toBeUndefined();
    expect(textOf({ kind: 'integer', value: 1 })).toBeUndefined();
  });

  it('16 進文字列も同じ経路で読む（形はバイト列の書き方であって符号化ではない）', () => {
    expect(textOf(hex(bytes(0xfe, 0xff, 0x30, 0x53)))).toBe('こ');
  });
});

describe('parsePdfDate — §7.9.4', () => {
  it.each([
    ["D:20260815123045+09'00'", '2026-08-15T03:30:45Z'],
    ['D:20260815123045Z', '2026-08-15T12:30:45Z'],
    ["D:20260815123045-05'30'", '2026-08-15T18:00:45Z'],
    // R-7.9.4-17: UT の情報が無ければ GMT
    ['D:20260815123045', '2026-08-15T12:30:45Z'],
    // R-7.9.4-16: MM / DD の既定は 01、他は 0
    ['D:2026', '2026-01-01T00:00:00Z'],
    ['D:202608', '2026-08-01T00:00:00Z'],
    ['D:20260815', '2026-08-15T00:00:00Z'],
    ['D:2026081512', '2026-08-15T12:00:00Z'],
    ['D:202608151230', '2026-08-15T12:30:00Z'],
    // 読む向きでは `'` を省いた形も受け取る
    ['D:20260815123045+0900', '2026-08-15T03:30:45Z'],
    ['D:20260815123045+09', '2026-08-15T03:30:45Z'],
  ])('%s → %s', (input, iso) => {
    expect(pdfDateToIso(input)).toBe(iso);
  });

  it.each([
    ['20260815123045', 'D: が無い（R-7.9.4-12）'],
    ['D:20261315123045', '月が 13'],
    ['D:20260815253045', '時が 25'],
    ['D:20260815126045', '分が 60'],
    ['D:20260231000000', '2 月 31 日 — 旧実装は 3 月 3 日に繰り上げる'],
    ['D:2026081512304', '桁が足りない'],
    ['', '空'],
    ['not a date', '日付ではない'],
  ])('%s は undefined（%s）', (input) => {
    expect(parsePdfDate(input)).toBeUndefined();
  });

  it('前後の空白は落として読む', () => {
    expect(pdfDateToIso(' D:20260815123045Z ')).toBe('2026-08-15T12:30:45Z');
  });
});
