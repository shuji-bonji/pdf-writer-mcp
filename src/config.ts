/**
 * Application Configuration
 * バージョンは package.json から動的取得（config と package.json の不一致を防ぐ）
 */

import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const packageJson = require('../package.json') as {
  name: string;
  version: string;
};

/**
 * Package information (dynamically loaded from package.json)
 */
export const PACKAGE_INFO = {
  name: packageJson.name,
  version: packageJson.version,
} as const;

/**
 * 環境変数キー
 */
export const ENV_KEYS = {
  /** デフォルトで埋め込むフォントファイルのパス（.ttf / .otf） */
  DEFAULT_FONT: 'PDF_WRITER_FONT',
} as const;

/**
 * PDF 生成のデフォルト値
 * 単位はすべて pt（1pt = 1/72 inch）
 */
export const DEFAULTS = {
  /** ページサイズ名 */
  pageSize: 'A4',
  /** 上下左右マージン */
  margin: 56, // ≒ 20mm
  /** 本文フォントサイズ */
  fontSize: 11,
  /** 行間係数（fontSize に対する倍率。行送り = fontSize * lineHeight） */
  lineHeight: 1.45,
  /** 段落間の追加余白 */
  paragraphGap: 6,
} as const;
