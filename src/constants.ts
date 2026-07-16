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
  /** merge の最大入力ファイル数。暴走防止 */
  MERGE_MAX_INPUTS: 50,
  /** split の最大分割数。暴走防止 */
  SPLIT_MAX_PARTS: 200,
  /** しおりの最大総数・最大ネスト深さ */
  BOOKMARK_MAX_TOTAL: 2_000,
  BOOKMARK_MAX_DEPTH: 8,
  /** 埋め込みファイルの最大サイズ（バイト）。PDF 全体がメモリに載るため上限を設ける */
  ATTACHMENT_MAX_BYTES: 100 * 1024 * 1024,
} as const;

/** attach_file が受け付ける AFRelationship（PDF/A-3 §6.8） */
export const ATTACHMENT_RELATIONSHIPS = [
  'Source',
  'Data',
  'Alternative',
  'Supplement',
  'Unspecified',
] as const;

/** add_annotation が受け付ける注釈種別 */
export const ANNOTATION_TYPES = ['text', 'highlight', 'square'] as const;

/** text 注釈のアイコン名（ISO 32000-1 Table 172 の一般的な値） */
export const ANNOTATION_ICONS = [
  'Note',
  'Comment',
  'Key',
  'Help',
  'NewParagraph',
  'Paragraph',
  'Insert',
] as const;

/** rotate_pages が受け付ける回転角（時計回り・度） */
export const ROTATION_ANGLES = [90, 180, 270] as const;

/**
 * レンダラが入力テキストに無くても描画しうる文字。
 *
 * フォントのサブセットは「入力テキスト」を基に行うため、レンダラが後から足す文字は
 * サブセットに含まれず .notdef（豆腐）になる。実例: Markdown の `- item` は原文に
 * 中黒を含まないが、箇条書きレンダラが '•' を描画する（v0.3.0〜v0.4.0 の回帰）。
 * 番号リストの marker（`1. `）も同様に生成物。
 */
export const RENDERER_GENERATED_CHARS = '•0123456789. ';

/**
 * フォントファイルのマジックナンバー（先頭 4 bytes）
 * .ttc（TrueTypeCollection）は pdf-lib がサブセット化できないため検知して弾く
 */
export const FONT_MAGIC = {
  /** 'ttcf' — TrueType Collection */
  TTC: 'ttcf',
} as const;
