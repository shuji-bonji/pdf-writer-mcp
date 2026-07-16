/**
 * Application Configuration
 * バージョンは package.json から動的取得（config と package.json の不一致を防ぐ）
 */

import { createRequire } from 'node:module';

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
  /**
   * 決定論的出力（E-6）: reproducible-builds.org の慣習に従う UNIX 秒。
   * 設定時は CreationDate / ModificationDate / XMP の各日時に固定値を使い、
   * 同一入力 → 同一バイト列を保証する（学習データ工場の差分検証・キャッシュ用）。
   */
  SOURCE_DATE_EPOCH: 'SOURCE_DATE_EPOCH',
} as const;

/**
 * 出力に焼き込む「現在時刻」。SOURCE_DATE_EPOCH が設定されていれば固定値を返す。
 * 値が不正（数値でない・負）な場合は黙って現在時刻に落とさずエラーにする —
 * 再現性を期待した呼び出し側が黙って非決定的な出力を得るのが最悪のケースのため。
 */
export function outputDate(): Date {
  const raw = process.env[ENV_KEYS.SOURCE_DATE_EPOCH];
  if (raw === undefined || raw === '') return new Date();
  const epoch = Number(raw);
  if (!Number.isFinite(epoch) || epoch < 0) {
    throw new Error(
      `${ENV_KEYS.SOURCE_DATE_EPOCH} must be a non-negative number of seconds, got "${raw}"`,
    );
  }
  return new Date(epoch * 1000);
}

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
