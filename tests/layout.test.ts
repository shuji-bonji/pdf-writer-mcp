import { PDFDocument, type PDFFont, StandardFonts } from 'pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';
import { wrapText } from '../src/services/layout.js';
import { needsEmbeddedFont } from '../src/services/win-ansi.js';

let font: PDFFont;

beforeAll(async () => {
  const doc = await PDFDocument.create();
  font = await doc.embedFont(StandardFonts.Helvetica);
});

describe('needsEmbeddedFont', () => {
  it.each([
    'hello',
    'caf\u00e9',
    'Ma\u00f1ana',
    '12345 ABC',
    '\u201cq\u201d \u2013\u2014 \u20ac\u2026\u2122',
  ])('returns false for WinAnsiEncoding text: %s', (s) => {
    expect([...s].some((ch) => needsEmbeddedFont(ch.codePointAt(0) as number))).toBe(false);
  });

  it.each(['\u65e5\u672c\u8a9e', 'mixed \u3042', '\u0142', '\u2714'])(
    'returns true when a character outside WinAnsiEncoding is present: %s',
    (s) => {
      expect([...s].some((ch) => needsEmbeddedFont(ch.codePointAt(0) as number))).toBe(true);
    },
  );

  it('leaves characters below U+0100 to onMissingGlyph', () => {
    expect(needsEmbeddedFont(0x85)).toBe(false);
    expect(needsEmbeddedFont(0x01)).toBe(false);
  });
});

describe('wrapText', () => {
  it('keeps short text on one line', () => {
    const lines = wrapText('hello world', font, 12, 500);
    expect(lines).toEqual(['hello world']);
  });

  it('preserves explicit newlines and blank lines', () => {
    const lines = wrapText('a\n\nb', font, 12, 500);
    expect(lines).toEqual(['a', '', 'b']);
  });

  it('wraps long text into multiple lines', () => {
    const long = Array.from({ length: 40 }, () => 'word').join(' ');
    const lines = wrapText(long, font, 12, 100);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(font.widthOfTextAtSize(line, 12)).toBeLessThanOrEqual(100 + 1e-6);
    }
  });

  it('force-breaks a single token longer than maxWidth', () => {
    const token = 'x'.repeat(200);
    const lines = wrapText(token, font, 12, 80);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(font.widthOfTextAtSize(line, 12)).toBeLessThanOrEqual(80 + 1e-6);
    }
  });

  it('never returns a line wider than maxWidth (ascii paragraph)', () => {
    const text =
      'The quick brown fox jumps over the lazy dog. ' +
      'Supercalifragilisticexpialidocious antidisestablishmentarianism.';
    const lines = wrapText(text, font, 11, 150);
    for (const line of lines) {
      expect(font.widthOfTextAtSize(line, 11)).toBeLessThanOrEqual(150 + 1e-6);
    }
  });
});
