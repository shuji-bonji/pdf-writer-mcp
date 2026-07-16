import { PDFDocument, type PDFFont, StandardFonts } from 'pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';
import { hasNonLatin1, wrapText } from '../src/services/layout.js';

let font: PDFFont;

beforeAll(async () => {
  const doc = await PDFDocument.create();
  font = await doc.embedFont(StandardFonts.Helvetica);
});

describe('hasNonLatin1', () => {
  it.each(['hello', 'caf\u00e9', 'Ma\u00f1ana', '12345 ABC'])(
    'returns false for Latin-1 text: %s',
    (s) => {
      expect(hasNonLatin1(s)).toBe(false);
    },
  );

  it.each(['\u65e5\u672c\u8a9e', 'mixed \u3042'])(
    'returns true when non-Latin1 present: %s',
    (s) => {
      expect(hasNonLatin1(s)).toBe(true);
    },
  );
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
