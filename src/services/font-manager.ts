/**
 * Font Manager
 * カスタムフォント（.ttf/.otf）の埋め込みと、標準フォントへのフォールバックを担う。
 * .ttc（TrueTypeCollection）は pdf-lib がサブセット化できないため検知して弾く。
 */

import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { PDFDocument, StandardFonts, type PDFFont } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { ENV_KEYS } from '../config.js';
import { FONT_MAGIC } from '../constants.js';
import { logger } from '../utils/logger.js';

export interface LoadedFont {
  font: PDFFont;
  /** 表示用フォント名 */
  name: string;
  /** 標準フォント（英数字のみ）か否か。true の場合、日本語描画は不可 */
  isStandard: boolean;
}

const CTX = 'FontManager';

/**
 * 先頭 4 bytes を ASCII として読む
 */
function magic4(bytes: Uint8Array): string {
  return String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
}

/**
 * フォントを読み込んで doc に埋め込む。
 * @param fontPath 明示指定のフォントパス（優先）。未指定なら環境変数 → 標準フォント。
 */
export async function loadFont(doc: PDFDocument, fontPath?: string): Promise<LoadedFont> {
  const resolvedPath = fontPath ?? process.env[ENV_KEYS.DEFAULT_FONT];

  if (!resolvedPath) {
    const font = await doc.embedFont(StandardFonts.Helvetica);
    logger.info(CTX, 'No fontPath given; using StandardFonts.Helvetica (ASCII only)');
    return { font, name: 'Helvetica', isStandard: true };
  }

  let bytes: Uint8Array;
  try {
    bytes = await readFile(resolvedPath);
  } catch {
    throw new Error(`Font file not found or unreadable: ${resolvedPath}`);
  }

  if (bytes.length < 4) {
    throw new Error(`Font file is too small to be valid: ${resolvedPath}`);
  }

  if (magic4(bytes) === FONT_MAGIC.TTC) {
    throw new Error(
      `Font file is a TrueTypeCollection (.ttc): ${resolvedPath}. ` +
        `pdf-lib cannot subset .ttc directly. Extract a single face to .otf/.ttf first ` +
        `(e.g. Python fonttools: TTCollection(path).fonts[i].save('out.otf')).`
    );
  }

  doc.registerFontkit(fontkit);
  let font: PDFFont;
  try {
    font = await doc.embedFont(bytes, { subset: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to embed font ${resolvedPath}: ${msg}`);
  }

  const name = basename(resolvedPath);
  logger.info(CTX, `Embedded custom font: ${name}`);
  return { font, name, isStandard: false };
}
