import { describe, expect, it } from 'vitest';
import { parsePageSpec } from '../src/utils/page-spec.js';

describe('parsePageSpec', () => {
  it('parses a single page', () => {
    expect(parsePageSpec('3', 10)).toEqual([3]);
  });

  it('parses a range (inclusive)', () => {
    expect(parsePageSpec('2-5', 10)).toEqual([2, 3, 4, 5]);
  });

  it('parses open-ended ranges', () => {
    expect(parsePageSpec('8-', 10)).toEqual([8, 9, 10]);
    expect(parsePageSpec('-3', 10)).toEqual([1, 2, 3]);
  });

  it('parses comma-separated chunks preserving order', () => {
    expect(parsePageSpec('5,1-2', 10)).toEqual([5, 1, 2]);
  });

  it('dedupes overlapping chunks keeping first occurrence', () => {
    expect(parsePageSpec('1-3,2-4', 10)).toEqual([1, 2, 3, 4]);
  });

  it('accepts whitespace around chunks', () => {
    expect(parsePageSpec(' 1 , 3-4 ', 10)).toEqual([1, 3, 4]);
  });

  it('rejects out-of-range pages', () => {
    expect(() => parsePageSpec('11', 10)).toThrow(/out of range/);
    expect(() => parsePageSpec('0', 10)).toThrow(/out of range/);
    expect(() => parsePageSpec('5-99', 10)).toThrow(/out of range/);
  });

  it('reports an open-ended chunk past the end as out of range, not reversed', () => {
    // 回帰: "2-" は to が pageCount に潰れるため from > to になり、
    // 1 ページの文書で「reversed」と誤報していた（実際は範囲外）
    expect(() => parsePageSpec('2-', 1)).toThrow(/out of range/);
    expect(() => parsePageSpec('11-', 10)).toThrow(/out of range/);
    // 端は有効
    expect(parsePageSpec('1-', 1)).toEqual([1]);
    expect(parsePageSpec('10-', 10)).toEqual([10]);
  });

  it('rejects reversed ranges', () => {
    expect(() => parsePageSpec('5-2', 10)).toThrow(/reversed/);
  });

  it('rejects malformed input', () => {
    expect(() => parsePageSpec('', 10)).toThrow();
    expect(() => parsePageSpec('abc', 10)).toThrow(/invalid chunk/);
    expect(() => parsePageSpec('1,,3', 10)).toThrow(/invalid chunk/);
    expect(() => parsePageSpec('-', 10)).toThrow(/invalid chunk/);
  });

  it('uses the given field name in errors', () => {
    expect(() => parsePageSpec('x', 10, 'ranges[0]')).toThrow(/ranges\[0\]/);
  });
});
