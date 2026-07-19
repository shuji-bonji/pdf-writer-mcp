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
 * 1 つの文書に焼き込む「現在時刻」を **1 回だけ**決めて共有する（W-5）。
 *
 * ISO 32000-2 **R-14.3.4-2 / -5** は、作成日時・更新日時を Info 辞書と XMP の
 * 両方に書く場合「**fully equivalent**」であることを要求する（shall）。
 * v0.13.1 までは Info 側（`output.ts`）と XMP 側（`xmp.ts`）が**別々に**
 * `outputDate()` を呼んでおり、2 回の呼び出しが**秒境界を跨ぐと不一致**になった
 * （`SOURCE_DATE_EPOCH` 設定時のみ常に同値）。実害が出る確率は低いが、
 * 「低い確率でだけ shall を破る」は再現しにくい不具合になるので潰しておく。
 *
 * 文書インスタンスをキーにするので、ツール 1 呼び出し = 1 文書 = 1 時刻。
 * 文書を跨いで固定はしない（別の PDF が同じ時刻を名乗る方が嘘になる）。
 */
const documentDates = new WeakMap<object, Date>();

export function documentDate(doc: object): Date {
  const cached = documentDates.get(doc);
  if (cached) return cached;
  const now = outputDate();
  documentDates.set(doc, now);
  return now;
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
