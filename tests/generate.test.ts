import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import {
  handleCreateMarkdownPdf,
  handleCreateTablePdf,
  handleCreateTextPdf,
} from '../src/tools/handlers.js';

async function pageCountOfBase64(b64: string): Promise<number> {
  const bytes = Buffer.from(b64, 'base64');
  const doc = await PDFDocument.load(bytes);
  return doc.getPageCount();
}

describe('handlers (standard font, ASCII)', () => {
  it('create_text_pdf returns base64 with >=1 page', async () => {
    const res = await handleCreateTextPdf({ text: 'Hello World\n\nSecond paragraph.' });
    expect(res.base64).toBeTruthy();
    expect(res.pageCount).toBeGreaterThanOrEqual(1);
    expect(await pageCountOfBase64(res.base64 as string)).toBe(res.pageCount);
    expect(res.font).toBe('Helvetica');
  });

  it('create_markdown_pdf renders headings/lists/table', async () => {
    const md = '# Title\n\nText.\n\n- a\n- b\n\n| h1 | h2 |\n|----|----|\n| 1 | 2 |\n';
    const res = await handleCreateMarkdownPdf({ markdown: md });
    expect(res.pageCount).toBeGreaterThanOrEqual(1);
  });

  it('create_table_pdf paginates and re-draws header', async () => {
    const headers = ['id', 'name', 'note'];
    const rows = Array.from({ length: 120 }, (_, i) => [`${i}`, `name${i}`, 'note']);
    const res = await handleCreateTablePdf({ headers, rows });
    expect(res.pageCount).toBeGreaterThan(1);
  });
});

describe('handlers (guards)', () => {
  it('rejects Japanese text without a font', async () => {
    await expect(handleCreateTextPdf({ text: '\u65e5\u672c\u8a9e' })).rejects.toThrow(/non-Latin/);
  });

  it('rejects Japanese table without a font', async () => {
    await expect(
      handleCreateTablePdf({ headers: ['\u6c0f\u540d'], rows: [['\u5c71\u7530']] }),
    ).rejects.toThrow(/non-Latin/);
  });

  it('rejects invalid fontSize', async () => {
    await expect(handleCreateTextPdf({ text: 'x', fontSize: 999 })).rejects.toThrow();
  });
});

const fontPath = process.env.TEST_FONT_PATH;
describe.skipIf(!fontPath)('handlers (embedded Japanese font)', () => {
  it('creates a Japanese text PDF', async () => {
    const res = await handleCreateTextPdf({
      text: '\u65e5\u672c\u8a9e\u306e\u30c6\u30b9\u30c8\u3067\u3059\u3002',
      fontPath,
    });
    expect(res.pageCount).toBeGreaterThanOrEqual(1);
    expect(res.font).not.toBe('Helvetica');
  });
});
