/**
 * 共有型
 */

import type { PageSizeName } from '../constants.js';

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
}

/**
 * MCP レスポンスの content block（最小限）
 */
export interface ContentBlock {
  type: 'text';
  text: string;
}
