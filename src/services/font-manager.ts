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
import type { MissingGlyphPolicy } from '../types/index.js';
import { logger } from '../utils/logger.js';

export interface LoadedFont {
  font: PDFFont;
  /** 表示用フォント名 */
  name: string;
  /** 標準フォント（英数字のみ）か否か。true の場合、日本語描画は不可 */
  isStandard: boolean;
  /** コードポイントのグリフ有無（埋め込みフォントのみ。標準フォントは undefined） */
  hasGlyph?: (codePoint: number) => boolean;
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

  // グリフ有無の照会用に fontkit でもパースする（失敗しても埋め込み自体は続行）
  let hasGlyph: LoadedFont['hasGlyph'];
  try {
    const fk = fontkit.create(Buffer.from(bytes));
    hasGlyph = (cp: number) => fk.hasGlyphForCodePoint(cp);
  } catch {
    logger.warn(CTX, 'fontkit parse for glyph-coverage check failed; missing-glyph detection disabled');
  }

  const name = basename(resolvedPath);
  logger.info(CTX, `Embedded custom font: ${name}`);
  return { font, name, isStandard: false, hasGlyph };
}

/** 〓（下駄記号）: 日本語組版でのグリフ欠落の慣習的代替 */
const GETA = 0x3013;

/**
 * フォントに存在しない文字の扱い（onMissingGlyph オプション）を適用する。
 *
 * - error（既定）: 欠落文字を列挙してエラー。無警告の空白（.notdef）出力を防ぐ
 * - replace: 欠落文字を 〓（フォントに無ければ ?）へ置換し、warnings で報告
 * - ignore: そのまま描画（空白になる）。warnings で報告
 */
export function applyMissingGlyphPolicy(
  texts: string[],
  loaded: LoadedFont,
  policy: MissingGlyphPolicy = 'error'
): { texts: string[]; warnings: string[] } {
  const hasGlyph = loaded.hasGlyph;
  // 標準フォントは assertRenderable（Latin-1 検査）側で扱うため対象外
  if (!hasGlyph) return { texts, warnings: [] };

  const missing = new Set<string>();
  for (const text of texts) {
    for (const ch of text) {
      if (ch === '\n' || ch === '\r' || ch === '\t') continue;
      if (!hasGlyph(ch.codePointAt(0) as number)) missing.add(ch);
    }
  }
  if (missing.size === 0) return { texts, warnings: [] };

  const list = [...missing]
    .slice(0, 10)
    .map((ch) => `"${ch}" (U+${(ch.codePointAt(0) as number).toString(16).toUpperCase().padStart(4, '0')})`)
    .join(', ');
  const suffix = missing.size > 10 ? ` and ${missing.size - 10} more` : '';

  if (policy === 'error') {
    throw new Error(
      `The font "${loaded.name}" has no glyph for: ${list}${suffix}. ` +
        'These characters would render as blank boxes. ' +
        'Remove/replace them, use a font that covers them, ' +
        'or set onMissingGlyph to "replace" (substitutes 〓) or "ignore".'
    );
  }

  if (policy === 'ignore') {
    return {
      texts,
      warnings: [
        `Rendered blank glyphs for unsupported characters (onMissingGlyph=ignore): ${list}${suffix}`,
      ],
    };
  }

  // replace
  const replacement = hasGlyph(GETA) ? '〓' : '?';
  const replaced = texts.map((text) =>
    [...text].map((ch) => (missing.has(ch) ? replacement : ch)).join('')
  );
  return {
    texts: replaced,
    warnings: [
      `Replaced ${missing.size} unsupported character(s) with "${replacement}": ${list}${suffix}`,
    ],
  };
}
