/**
 * Constants
 * マジックナンバー・上限値を一元管理（根拠はコメントで明示）
 */

/**
 * 標準ページサイズ [width, height]（pt, 縦向き）
 * ISO 216 (A系) と US サイズ
 */
export const PAGE_SIZES = {
  A4: [595.28, 841.89],
  A3: [841.89, 1190.55],
  A5: [419.53, 595.28],
  LETTER: [612, 792],
  LEGAL: [612, 1008],
} as const;

export type PageSizeName = keyof typeof PAGE_SIZES;

/**
 * 入力バリデーションの上限値
 */
export const LIMITS = {
  /** フォントサイズの範囲（pt） */
  FONT_SIZE_MIN: 4,
  FONT_SIZE_MAX: 96,
  /** マージンの範囲（pt）。0 は全面利用、上限はページの暴走防止 */
  MARGIN_MIN: 0,
  MARGIN_MAX: 300,
  /** 1 回の生成で受け付ける本文テキストの最大長（文字）。DoS/巨大PDF防止 */
  TEXT_MAX_LENGTH: 500_000,
  /** 表の最大列数・行数。レイアウト破綻と巨大化の防止 */
  TABLE_MAX_COLS: 40,
  TABLE_MAX_ROWS: 5_000,
} as const;

/**
 * フォントファイルのマジックナンバー（先頭 4 bytes）
 * .ttc（TrueTypeCollection）は pdf-lib がサブセット化できないため検知して弾く
 */
export const FONT_MAGIC = {
  /** 'ttcf' — TrueType Collection */
  TTC: 'ttcf',
} as const;
