/**
 * Zod スキーマ検証（E-5 移行後）。
 * 旧 asserts 版と同じ振る舞い（受理・拒否の境界）を検証する。
 */

import { describe, expect, it } from 'vitest';
import {
  CreateMarkdownSchema,
  CreateTableSchema,
  CreateTextSchema,
  MergePdfsSchema,
  parseArgs,
  SetMetadataSchema,
} from '../src/utils/validation.js';

describe('CreateTextSchema', () => {
  it('accepts a valid text arg', () => {
    expect(() => parseArgs(CreateTextSchema, { text: 'hello' })).not.toThrow();
  });

  it('accepts valid common options', () => {
    expect(() =>
      parseArgs(CreateTextSchema, { text: 'hi', fontSize: 12, margin: 40, pageSize: 'A4' }),
    ).not.toThrow();
  });

  it.each([null, undefined, 42, 'string'])('rejects non-object args: %p', (v) => {
    expect(() => parseArgs(CreateTextSchema, v)).toThrow();
  });

  it('rejects missing text', () => {
    expect(() => parseArgs(CreateTextSchema, {})).toThrow();
  });

  it('rejects non-string text', () => {
    expect(() => parseArgs(CreateTextSchema, { text: 123 })).toThrow();
  });

  it.each([3, 97, -1, Number.POSITIVE_INFINITY, Number.NaN])(
    'rejects out-of-range fontSize: %p',
    (n) => {
      expect(() => parseArgs(CreateTextSchema, { text: 'x', fontSize: n })).toThrow();
    },
  );

  it.each([-1, 301, 500])('rejects out-of-range margin: %p', (n) => {
    expect(() => parseArgs(CreateTextSchema, { text: 'x', margin: n })).toThrow();
  });

  it.each(['A4', 'A3', 'A5', 'LETTER', 'LEGAL'])('accepts pageSize %s', (s) => {
    expect(() => parseArgs(CreateTextSchema, { text: 'x', pageSize: s })).not.toThrow();
  });

  it.each(['B5', 'a4', '', 4, null])('rejects pageSize %p', (v) => {
    expect(() => parseArgs(CreateTextSchema, { text: 'x', pageSize: v })).toThrow();
  });

  it.each(['ja', 'en-US', 'zh-Hans-CN'])('accepts BCP 47 lang %s', (lang) => {
    expect(() => parseArgs(CreateTextSchema, { text: 'x', lang })).not.toThrow();
  });

  it.each(['j', 'japanese language', '123'])('rejects invalid lang %p', (lang) => {
    expect(() => parseArgs(CreateTextSchema, { text: 'x', lang })).toThrow();
  });
});

describe('paths (E-1)', () => {
  it('accepts an absolute outputPath', () => {
    expect(() =>
      parseArgs(CreateTextSchema, { text: 'x', outputPath: '/tmp/out.pdf' }),
    ).not.toThrow();
  });

  it.each(['relative/out.pdf', './out.pdf', 'out.pdf'])('rejects relative path: %p', (p) => {
    expect(() => parseArgs(CreateTextSchema, { text: 'x', outputPath: p })).toThrow(/absolute/);
  });

  it.each(['/tmp/../etc/passwd', '/a/b/../c.pdf', '/..'])('rejects ".." segment: %p', (p) => {
    expect(() => parseArgs(CreateTextSchema, { text: 'x', outputPath: p })).toThrow(/\.\./);
  });

  it('applies to fontPath too', () => {
    expect(() => parseArgs(CreateTextSchema, { text: 'x', fontPath: '../font.otf' })).toThrow();
  });

  it('applies to each mergePdfs input', () => {
    expect(() => parseArgs(MergePdfsSchema, { inputPaths: ['/a.pdf', 'b.pdf'] })).toThrow(
      /inputPaths\.1/,
    );
  });

  it('mergePdfs requires at least 2 inputs', () => {
    expect(() => parseArgs(MergePdfsSchema, { inputPaths: ['/a.pdf'] })).toThrow();
  });
});

describe('SetMetadataSchema', () => {
  it('requires at least one metadata field', () => {
    expect(() => parseArgs(SetMetadataSchema, { inputPath: '/a.pdf' })).toThrow(/at least one/);
  });

  it('accepts a single field', () => {
    expect(() => parseArgs(SetMetadataSchema, { inputPath: '/a.pdf', title: 't' })).not.toThrow();
  });
});

describe('CreateMarkdownSchema', () => {
  it('accepts valid markdown', () => {
    expect(() => parseArgs(CreateMarkdownSchema, { markdown: '# hi' })).not.toThrow();
  });
  it('rejects missing markdown', () => {
    expect(() => parseArgs(CreateMarkdownSchema, {})).toThrow();
  });
});

describe('CreateTableSchema', () => {
  it('accepts valid table', () => {
    expect(() =>
      parseArgs(CreateTableSchema, { headers: ['a', 'b'], rows: [['1', '2']] }),
    ).not.toThrow();
  });

  it('accepts empty rows', () => {
    expect(() => parseArgs(CreateTableSchema, { headers: ['a'], rows: [] })).not.toThrow();
  });

  it('rejects empty headers', () => {
    expect(() => parseArgs(CreateTableSchema, { headers: [], rows: [] })).toThrow();
  });

  it('rejects non-string header', () => {
    expect(() => parseArgs(CreateTableSchema, { headers: ['a', 2], rows: [] })).toThrow();
  });

  it('rejects non-array row', () => {
    expect(() => parseArgs(CreateTableSchema, { headers: ['a'], rows: ['x'] })).toThrow();
  });

  it('rejects non-string cell', () => {
    expect(() => parseArgs(CreateTableSchema, { headers: ['a'], rows: [[1]] })).toThrow();
  });
});
