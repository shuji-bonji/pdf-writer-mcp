/**
 * Font Manager
 * カスタムフォント（.ttf/.otf）の埋め込みと、標準フォントへのフォールバックを担う。
 *
 * サブセット戦略（v0.3.0 で変更・ADR-2 改訂）:
 *   pdf-lib の `embedFont(subset: true)`（= fontkit のサブセッタ）は、Noto Sans JP のような
 *   CJK フォントでグリフを取りこぼし、**描画が豆腐化する**（poppler: "Embedded font file may be
 *   invalid" → "Couldn't create a font" / Acrobat: 一部の文字が空白）。ToUnicode は正しいため
 *   テキスト抽出だけは通り、破損に気づきにくい。
 *   そこで harfbuzz（subset-font）で**事前にサブセット**し、pdf-lib には subset:false で
 *   「すでに小さいフォント」を埋め込ませる。実測（本文 35 文字）:
 *     fontkit subset:true = 24KB（破損） / subset:false = 3.9MB（正常） / harfbuzz = 14.5KB（正常）
 *
 * .ttc（TrueTypeCollection）は非対応のため検知して弾く。
 */

import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { PDFDocument, StandardFonts, type PDFFont } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import subsetFont from 'subset-font';
import { ENV_KEYS } from '../config.js';
import { FONT_MAGIC } from '../constants.js';
import type { MissingGlyphPolicy } from '../types/index.js';
import { logger } from '../utils/logger.js';

/** 埋め込み前のフォント情報（グリフ照会に使う） */
export interface FontSource {
  /** 元のフォントバイト列。標準フォントの場合は undefined */
  bytes?: Uint8Array;
  name: string;
  isStandard: boolean;
  /** コードポイントのグリフ有無（埋め込みフォントのみ） */
  hasGlyph?: (codePoint: number) => boolean;
}

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
 * フォントファイルを開き、グリフ照会用の情報を返す（まだ doc には埋め込まない）。
 * @param fontPath 明示指定のフォントパス（優先）。未指定なら環境変数 → 標準フォント。
 */
export async function openFont(fontPath?: string): Promise<FontSource> {
  const resolvedPath = fontPath ?? process.env[ENV_KEYS.DEFAULT_FONT];

  if (!resolvedPath) {
    logger.info(CTX, 'No fontPath given; using StandardFonts.Helvetica (ASCII only)');
    return { name: 'Helvetica', isStandard: true };
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
        `Extract a single face to .otf/.ttf first ` +
        `(e.g. Python fonttools: TTCollection(path).fonts[i].save('out.otf')).`
    );
  }

  // グリフ有無の照会用にパースする（失敗しても埋め込み自体は続行）
  let hasGlyph: FontSource['hasGlyph'];
  try {
    const fk = fontkit.create(Buffer.from(bytes));
    hasGlyph = (cp: number) => fk.hasGlyphForCodePoint(cp);
  } catch {
    logger.warn(CTX, 'Glyph-coverage check unavailable (fontkit parse failed)');
  }

  return { bytes, name: basename(resolvedPath), isStandard: false, hasGlyph };
}

/**
 * 実際に描画するテキストに合わせてフォントをサブセットし、doc に埋め込む。
 * @param texts 描画予定の全テキスト（グリフ欠落ポリシー適用後のもの）
 */
export async function embedFontFor(
  doc: PDFDocument,
  source: FontSource,
  texts: string[]
): Promise<LoadedFont> {
  if (source.isStandard || !source.bytes) {
    const font = await doc.embedFont(StandardFonts.Helvetica);
    return { font, name: source.name, isStandard: true };
  }

  doc.registerFontkit(fontkit);

  // harfbuzz で使用グリフのみに絞る。失敗時は元フォントをそのまま埋め込む（正しさ優先・肥大は許容）
  let toEmbed: Uint8Array = source.bytes;
  const used = texts.join('') || ' ';
  try {
    // noLayoutClosure: GSUB による字形置換の連鎖を取り込まない。
    //   pdf-lib(subset:false) は「layout() が返した置換後グリフ」を CID として書く一方、
    //   ToUnicode は「cmap 由来のベースグリフ」からしか作らないため、置換が起きると
    //   CID と ToUnicode がずれてテキスト抽出が壊れる（数字が化ける等）。
    //   置換候補をサブセットに含めなければ置換自体が発生せず、両者が一致する。
    //   副次効果としてサブセットはさらに小さくなる（実測 9.1KB -> 4.5KB）。
    toEmbed = await subsetFont(Buffer.from(source.bytes), used, {
      targetFormat: 'sfnt',
      noLayoutClosure: true,
    });
    logger.info(
      CTX,
      `Subset ${source.name} with harfbuzz: ${source.bytes.length} -> ${toEmbed.length} bytes`
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn(CTX, `harfbuzz subsetting failed (${msg}); embedding the full font instead`);
  }

  let font: PDFFont;
  try {
    // subset:false — サブセットは済んでいる。pdf-lib(fontkit) の再サブセットは
    // グリフ破損を招くため使わない（上部コメント参照）
    font = await doc.embedFont(toEmbed, { subset: false });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to embed font ${source.name}: ${msg}`);
  }

  logger.info(CTX, `Embedded custom font: ${source.name}`);
  return { font, name: source.name, isStandard: false, hasGlyph: source.hasGlyph };
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
  source: Pick<FontSource, 'hasGlyph' | 'name'>,
  policy: MissingGlyphPolicy = 'error'
): { texts: string[]; warnings: string[] } {
  const hasGlyph = source.hasGlyph;
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
    .map(
      (ch) => `"${ch}" (U+${(ch.codePointAt(0) as number).toString(16).toUpperCase().padStart(4, '0')})`
    )
    .join(', ');
  const suffix = missing.size > 10 ? ` and ${missing.size - 10} more` : '';

  if (policy === 'error') {
    throw new Error(
      `The font "${source.name}" has no glyph for: ${list}${suffix}. ` +
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
