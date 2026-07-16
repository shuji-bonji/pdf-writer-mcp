import { describe, expect, it } from 'vitest';
import {
  validateCommonOptions,
  validateCreateMarkdownArgs,
  validateCreateTableArgs,
  validateCreateTextArgs,
  validateMergePdfsArgs,
  validatePageSize,
  validatePath,
} from '../src/utils/validation.js';

describe('validateCreateTextArgs', () => {
  it('accepts a valid text arg', () => {
    expect(() => validateCreateTextArgs({ text: 'hello' })).not.toThrow();
  });

  it('accepts valid common options', () => {
    expect(() =>
      validateCreateTextArgs({ text: 'hi', fontSize: 12, margin: 40, pageSize: 'A4' }),
    ).not.toThrow();
  });

  it.each([null, undefined, 42, 'string'])('rejects non-object args: %p', (v) => {
    expect(() => validateCreateTextArgs(v)).toThrow();
  });

  it('rejects missing text', () => {
    expect(() => validateCreateTextArgs({})).toThrow();
  });

  it('rejects non-string text', () => {
    expect(() => validateCreateTextArgs({ text: 123 })).toThrow();
  });
});

describe('validateCommonOptions', () => {
  it.each([3, 97, -1, Infinity, NaN])('rejects out-of-range fontSize: %p', (n) => {
    expect(() => validateCommonOptions({ fontSize: n })).toThrow();
  });

  it.each([-1, 301, 500])('rejects out-of-range margin: %p', (n) => {
    expect(() => validateCommonOptions({ margin: n })).toThrow();
  });

  it('accepts empty options', () => {
    expect(() => validateCommonOptions({})).not.toThrow();
  });
});

describe('validatePageSize', () => {
  it.each(['A4', 'A3', 'A5', 'LETTER', 'LEGAL'])('accepts %s', (s) => {
    expect(() => validatePageSize(s)).not.toThrow();
  });

  it.each(['B5', 'a4', '', 4, null])('rejects %p', (v) => {
    expect(() => validatePageSize(v)).toThrow();
  });
});

describe('validatePath (E-1)', () => {
  it('accepts an absolute path', () => {
    expect(() => validatePath('/tmp/out.pdf', 'outputPath')).not.toThrow();
  });

  it.each(['relative/out.pdf', './out.pdf', 'out.pdf'])('rejects relative path: %p', (p) => {
    expect(() => validatePath(p, 'outputPath')).toThrow(/absolute/);
  });

  it.each(['/tmp/../etc/passwd', '/a/b/../c.pdf', '/..'])('rejects ".." segment: %p', (p) => {
    expect(() => validatePath(p, 'inputPath')).toThrow(/\.\./);
  });

  it.each(['', 42, null, undefined])('rejects non-string / empty: %p', (v) => {
    expect(() => validatePath(v, 'inputPath')).toThrow();
  });

  it('applies to common create options (outputPath / fontPath)', () => {
    expect(() => validateCommonOptions({ outputPath: 'rel.pdf' })).toThrow(/absolute/);
    expect(() => validateCommonOptions({ fontPath: '../font.otf' })).toThrow();
  });

  it('applies to each mergePdfs input', () => {
    expect(() => validateMergePdfsArgs({ inputPaths: ['/a.pdf', 'b.pdf'] })).toThrow(
      /inputPaths\[1\]/,
    );
  });
});

describe('validateCreateMarkdownArgs', () => {
  it('accepts valid markdown', () => {
    expect(() => validateCreateMarkdownArgs({ markdown: '# hi' })).not.toThrow();
  });
  it('rejects missing markdown', () => {
    expect(() => validateCreateMarkdownArgs({})).toThrow();
  });
});

describe('validateCreateTableArgs', () => {
  it('accepts valid table', () => {
    expect(() =>
      validateCreateTableArgs({ headers: ['a', 'b'], rows: [['1', '2']] }),
    ).not.toThrow();
  });

  it('accepts empty rows', () => {
    expect(() => validateCreateTableArgs({ headers: ['a'], rows: [] })).not.toThrow();
  });

  it('rejects empty headers', () => {
    expect(() => validateCreateTableArgs({ headers: [], rows: [] })).toThrow();
  });

  it('rejects non-string header', () => {
    expect(() => validateCreateTableArgs({ headers: ['a', 2], rows: [] })).toThrow();
  });

  it('rejects non-array row', () => {
    expect(() => validateCreateTableArgs({ headers: ['a'], rows: ['x'] })).toThrow();
  });

  it('rejects non-string cell', () => {
    expect(() => validateCreateTableArgs({ headers: ['a'], rows: [[1]] })).toThrow();
  });
});
