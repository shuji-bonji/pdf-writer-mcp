/**
 * MCP Tool 定義（E-5: McpServer + Zod 移行後のレジストリ）
 *
 * 入力スキーマ（shape）は utils/validation.ts の Zod スキーマから導出する —
 * 公開スキーマと実行時検証の情報源は一つ。実装は handlers.ts。
 *
 * annotations（E-4）:
 *   - readOnlyHint: writer は全ツールがファイルを書くため常に false
 *   - destructiveHint: 情報が失われる操作（delete_pages / flatten_form）のみ true
 *   - idempotentHint: 同一引数の再実行が同じ結果になるため true
 *   - openWorldHint: ローカルファイルのみを扱うため false
 */

import type { ZodRawShape } from 'zod';
import {
  addAnnotationShape,
  addBookmarksShape,
  addWatermarkShape,
  attachFileShape,
  createMarkdownShape,
  createTableShape,
  createTextShape,
  deletePagesShape,
  extractPagesShape,
  fillFormShape,
  flattenFormShape,
  mergePdfsShape,
  reorderPagesShape,
  rotatePagesShape,
  setMetadataShape,
  splitPdfShape,
  stampPageNumbersShape,
} from '../utils/validation.js';

export interface ToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  shape: ZodRawShape;
  annotations: ToolAnnotations;
}

const base: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

export const tools: ToolDefinition[] = [
  {
    name: 'create_text_pdf',
    title: 'Create PDF from Plain Text',
    description:
      'プレーンテキストから PDF を生成する。改行(\\n)を尊重し、空行を段落区切りとして扱う。長い行は自動で折り返す。',
    shape: createTextShape,
    annotations: base,
  },
  {
    name: 'create_markdown_pdf',
    title: 'Create PDF from Markdown',
    description:
      'Markdown から PDF を生成する。見出し・段落・箇条書き/番号リスト・コードブロック・引用・水平線・表に対応。' +
      'インライン装飾の記号は除去し字面のみ反映する(単一フォントのため)。',
    shape: createMarkdownShape,
    annotations: base,
  },
  {
    name: 'create_table_pdf',
    title: 'Create Table PDF',
    description:
      'ヘッダと行データから罫線付きの表 PDF を生成する。列幅は内容から自動算出し、セル内は折り返す。改ページ時はヘッダを再描画する。',
    shape: createTableShape,
    annotations: base,
  },
  {
    name: 'set_metadata',
    title: 'Set PDF Metadata',
    description:
      '既存 PDF のメタデータ(Info 辞書)を更新する。指定したフィールドのみ変更し、他は保持する。' +
      'title / author / subject / keywords / creator のうち最低 1 つが必要。',
    shape: setMetadataShape,
    annotations: base,
  },
  {
    name: 'merge_pdfs',
    title: 'Merge PDFs',
    description: '複数の PDF を指定順に 1 つへ結合する。文書メタデータは先頭ファイルから引き継ぐ。',
    shape: mergePdfsShape,
    annotations: base,
  },
  {
    name: 'split_pdf',
    title: 'Split PDF',
    description:
      'PDF をページ範囲ごとに複数ファイルへ分割する。ranges の各要素が 1 ファイルになる。' +
      '出力は "<prefix>1.pdf", "<prefix>2.pdf", ... の連番。',
    shape: splitPdfShape,
    annotations: base,
  },
  {
    name: 'extract_pages',
    title: 'Extract Pages',
    description:
      '指定ページだけを含む新しい PDF を作る。指定順を保持するため、ページの並べ替えを兼ねた抽出も可能。',
    shape: extractPagesShape,
    annotations: base,
  },
  {
    name: 'delete_pages',
    title: 'Delete Pages',
    description: '指定ページを削除した新しい PDF を作る。全ページの削除はエラー。',
    shape: deletePagesShape,
    annotations: { ...base, destructiveHint: true },
  },
  {
    name: 'reorder_pages',
    title: 'Reorder Pages',
    description: 'ページを並べ替える。order には全ページを新しい順序で 1 回ずつ列挙する。',
    shape: reorderPagesShape,
    annotations: base,
  },
  {
    name: 'add_bookmarks',
    title: 'Add Bookmarks (Outline)',
    description:
      'PDF にしおり(アウトライン)を設定する。既存のしおりは置換される。children で入れ子にできる。',
    shape: addBookmarksShape,
    annotations: base,
  },
  {
    name: 'add_annotation',
    title: 'Add Annotation',
    description:
      'ページに注釈を 1 つ追加する。付箋(text) / ハイライト(highlight) / 矩形(square) に対応。' +
      '座標は PDF 座標系(左下原点・pt)で指定する。',
    shape: addAnnotationShape,
    annotations: { ...base, idempotentHint: false },
  },
  {
    name: 'stamp_page_numbers',
    title: 'Stamp Page Numbers',
    description:
      '各ページにページ番号を刻む。タグ付き PDF では Artifact として囲むため PDF/UA 準拠を維持する。' +
      '日本語を含む書式を使う場合は fontPath か環境変数 PDF_WRITER_FONT が必要。',
    shape: stampPageNumbersShape,
    annotations: base,
  },
  {
    name: 'add_watermark',
    title: 'Add Watermark',
    description:
      '各ページの中央に斜めの透かし文字を重ねる("社外秘" / "DRAFT" / "COPY" 等)。' +
      '既定では本文の背面に薄く敷く。タグ付き PDF では Artifact として囲むため PDF/UA 準拠を維持する。' +
      '日本語の透かしには fontPath か環境変数 PDF_WRITER_FONT が必要。',
    shape: addWatermarkShape,
    annotations: base,
  },
  {
    name: 'fill_form',
    title: 'Fill Form (AcroForm)',
    description:
      '既存 PDF の対話フォーム(AcroForm)にフィールド値を流し込む。' +
      'フィールド名が分からない場合は、存在しない名前を指定するとエラーに全フィールド名と型が列挙される。' +
      '日本語の値には fontPath か環境変数 PDF_WRITER_FONT が必要。' +
      'flatten: true で記入後に非対話化できるが、タグ付き PDF では PDF/UA 準拠が壊れるため ' +
      'allowBreakingTags: true も要る。XFA フォームは非対応。',
    shape: fillFormShape,
    annotations: base,
  },
  {
    name: 'flatten_form',
    title: 'Flatten Form',
    description:
      '既存 PDF の対話フォーム(AcroForm)をフラット化し、記入済みの見た目を保ったまま非対話にする。' +
      '配布前に値を固定したい場合に使う。外観の再生成が要る場合に備え、既存の値に日本語が' +
      '含まれるなら fontPath か環境変数 PDF_WRITER_FONT を指定しておくこと。' +
      'タグ付き PDF では Widget 注釈が消えて Form 構造要素が宙に浮くため既定で拒否する' +
      '(allowBreakingTags: true で強行可)。',
    shape: flattenFormShape,
    annotations: { ...base, destructiveHint: true },
  },
  {
    name: 'attach_file',
    title: 'Attach File (Embedded File)',
    description:
      'PDF にファイルを埋め込む(添付する)。/Names /EmbeddedFiles と catalog /AF に登録し、' +
      'AFRelationship を付与する。PDF/A-3(ISO 19005-3)や電子帳簿保存法の文脈で、' +
      '「人が読む請求書 PDF + 機械可読データ(CSV/XML)」を 1 ファイルに束ねる用途に使う。',
    shape: attachFileShape,
    annotations: base,
  },
  {
    name: 'rotate_pages',
    title: 'Rotate Pages',
    description: 'ページを時計回りに回転する(90/180/270 度)。pages 省略時は全ページ。',
    shape: rotatePagesShape,
    annotations: base,
  },
];
