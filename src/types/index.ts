/**
 * 共有型
 */

import type { PageSizeName } from '../constants.js';

/**
 * フォントに存在しない文字（グリフ欠落）の扱い
 * - error: 欠落文字を列挙してエラー（既定）
 * - replace: 〓 に置換して警告
 * - ignore: そのまま描画（空白になる）して警告
 */
export type MissingGlyphPolicy = 'error' | 'replace' | 'ignore';

/**
 * すべての生成ツールに共通するオプション
 */
export interface CommonCreateOptions {
  /** 出力先パス。指定時はファイルに保存する */
  outputPath?: string;
  /** base64 文字列を結果に含めるか（outputPath 未指定なら自動的に true 相当） */
  returnBase64?: boolean;
  /** 埋め込むフォントファイルのパス（.ttf / .otf）。日本語には必須 */
  fontPath?: string;
  /** 本文フォントサイズ（pt） */
  fontSize?: number;
  /** ページサイズ名 */
  pageSize?: PageSizeName;
  /** 上下左右マージン（pt） */
  margin?: number;
  /** PDF メタデータ: タイトル */
  title?: string;
  /** PDF メタデータ: 作成者 */
  author?: string;
  /** フォント未収録文字の扱い。既定 'error' */
  onMissingGlyph?: MissingGlyphPolicy;
}

export interface CreateTextArgs extends CommonCreateOptions {
  /** 本文テキスト。\n で改行、空行で段落区切り */
  text: string;
}

export interface CreateMarkdownArgs extends CommonCreateOptions {
  /** Markdown 文字列 */
  markdown: string;
}

export interface CreateTableArgs extends CommonCreateOptions {
  /** ヘッダ行 */
  headers: string[];
  /** データ行（各行は headers と同じ列数を推奨） */
  rows: string[][];
}

/**
 * 生成結果
 */
export interface CreateResult {
  /** 保存した場合の絶対パス */
  path?: string;
  /** returnBase64 時の base64 文字列 */
  base64?: string;
  /** 生成ページ数 */
  pageCount: number;
  /** バイトサイズ */
  bytes: number;
  /** 埋め込みフォント名（標準フォント時は 'Helvetica'） */
  font: string;
  /** グリフ欠落の置換・無視など、注意すべき事象の報告 */
  warnings?: string[];
}

/**
 * すべての編集ツールに共通するオプション
 */
export interface CommonEditOptions {
  /** 出力先パス。指定時はファイルに保存する */
  outputPath?: string;
  /** base64 文字列を結果に含めるか（outputPath 未指定なら自動的に true 相当） */
  returnBase64?: boolean;
  /** 署名済み PDF（/ByteRange 検知）でも編集を続行するか。既定 false */
  allowBreakingSignatures?: boolean;
}

export interface SetMetadataArgs extends CommonEditOptions {
  /** 編集対象の PDF パス */
  inputPath: string;
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string[];
  creator?: string;
}

export interface MergePdfsArgs extends CommonEditOptions {
  /** 結合する PDF のパス（結合順） */
  inputPaths: string[];
}

export interface ExtractPagesArgs extends CommonEditOptions {
  inputPath: string;
  /** ページ指定（"1,3-5,8-" 形式・1 始まり） */
  pages: string;
}

export interface DeletePagesArgs extends CommonEditOptions {
  inputPath: string;
  pages: string;
}

export interface ReorderPagesArgs extends CommonEditOptions {
  inputPath: string;
  /** 新しいページ順（1 始まり・全ページを 1 回ずつ） */
  order: number[];
}

export interface RotatePagesArgs extends CommonEditOptions {
  inputPath: string;
  /** 時計回りの回転角 */
  rotation: 90 | 180 | 270;
  /** 対象ページ指定。省略時は全ページ */
  pages?: string;
}

export interface SplitPdfArgs extends CommonEditOptions {
  inputPath: string;
  /** 分割単位のページ指定の配列。各要素が 1 ファイルになる（例: ["1-3", "4-6", "7-"]） */
  ranges: string[];
  /** 出力先ディレクトリ */
  outputDir: string;
  /** 出力ファイル名の接頭辞。既定は "<入力名>-part" */
  prefix?: string;
}

/**
 * 編集結果
 */
export interface EditResult {
  path?: string;
  base64?: string;
  pageCount: number;
  bytes: number;
}

/**
 * 分割結果
 */
export interface SplitResult {
  files: Array<{ path: string; pageCount: number; bytes: number }>;
  count: number;
}

/**
 * MCP レスポンスの content block（最小限）
 */
export interface ContentBlock {
  type: 'text';
  text: string;
}
