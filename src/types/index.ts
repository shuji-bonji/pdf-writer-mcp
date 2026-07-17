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
  /**
   * タグ付き PDF（PDF/UA-1）として生成するか。既定 false。
   * true にすると構造木・XMP 宣言・/Lang・DisplayDocTitle を付与する。
   * PDF/UA はタイトルを要求するため title の指定が必須になる。
   */
  tagged?: boolean;
  /**
   * 文書の自然言語（BCP 47。例 'ja' / 'en-US'）。
   * tagged 時に省略すると本文から推定し、結果を warnings で報告する。
   */
  lang?: string;
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

export interface SetMetadataArgs extends CommonEditOptions, PreservableEditOptions {
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
 * しおり（1 項目）。children で入れ子にできる
 */
export interface BookmarkInput {
  /** 表示名 */
  title: string;
  /** 移動先ページ（1 始まり） */
  page: number;
  /** 子項目を開いた状態で表示するか。既定 true */
  open?: boolean;
  children?: BookmarkInput[];
}

export interface AddBookmarksArgs extends CommonEditOptions, PreservableEditOptions {
  inputPath: string;
  bookmarks: BookmarkInput[];
}

/** 注釈の矩形（PDF 座標系・左下原点・pt） */
export interface AnnotationRect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export type AnnotationType = 'text' | 'highlight' | 'square';

export interface AddAnnotationArgs extends CommonEditOptions, PreservableEditOptions {
  inputPath: string;
  /** 対象ページ（1 始まり） */
  page: number;
  type: AnnotationType;
  rect: AnnotationRect;
  /** 注釈の本文 */
  contents?: string;
  /** 作成者（/T） */
  author?: string;
  /** #rrggbb。既定は type ごと（text=#ffd400 / highlight=#ffff00 / square=#ff0000） */
  color?: string;
  /** square の塗り色 */
  interiorColor?: string;
  /** text のアイコン名。既定 Note */
  icon?: 'Note' | 'Comment' | 'Key' | 'Help' | 'NewParagraph' | 'Paragraph' | 'Insert';
  /** text を開いた状態にするか。既定 false */
  open?: boolean;
  /**
   * 支援技術向けの代替テキスト。
   * タグ付き PDF では注釈が Annot 構造要素に内包される（PDF/UA 7.18.1-1）ため、
   * その要素の /Alt になる。タグ無し文書では無視される。
   */
  alt?: string;
}

/** スタンプの配置（ページの回転を考慮した「見た目の」位置） */
export type StampPosition =
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right'
  | 'top-left'
  | 'top-center'
  | 'top-right';

export interface StampPageNumbersArgs extends CommonEditOptions, PreservableEditOptions {
  inputPath: string;
  /**
   * 書式。`{n}` が現在ページ、`{total}` が総ページ数に展開される。
   * 既定 `{n}`。例: `- {n} -` / `{n} / {total}` / `Page {n} of {total}`
   */
  format?: string;
  /** 配置。既定 bottom-center */
  position?: StampPosition;
  /** 端からの余白（pt）。既定 24 */
  margin?: number;
  /** フォントサイズ（pt）。既定 9 */
  fontSize?: number;
  /** #rrggbb。既定 #666666 */
  color?: string;
  /** 埋め込むフォント。省略時は PDF_WRITER_FONT → 標準フォント */
  fontPath?: string;
  /** 番号を振るページ指定（"1,3-5,8-"）。省略時は全ページ */
  pages?: string;
  /** 最初に振る番号。既定 1（表紙を 0 扱いにする等に使う） */
  startAt?: number;
}

export interface StampResult extends EditResult {
  /** 番号を刻んだページ数 */
  stamped: number;
  /** タグ付き PDF で Artifact として囲んだか */
  artifact: boolean;
}

export interface AddWatermarkArgs extends CommonEditOptions, PreservableEditOptions {
  inputPath: string;
  /** 透かし文字（日本語可。フォント指定が必要） */
  text: string;
  /** フォントサイズ（pt）。既定 60 */
  fontSize?: number;
  /** #rrggbb。既定 #808080 */
  color?: string;
  /** 不透明度 0〜1。既定 0.15 */
  opacity?: number;
  /** 反時計回りの角度（度）。既定 45 */
  angle?: number;
  /** 本文の背面に敷くか。既定 true */
  behind?: boolean;
  /** 埋め込むフォント。省略時は PDF_WRITER_FONT → 標準フォント */
  fontPath?: string;
  /** 対象ページ（"1,3-5,8-"）。省略時は全ページ */
  pages?: string;
}

export interface WatermarkResult extends EditResult {
  /** 透かしを入れたページ数 */
  watermarked: number;
  /** タグ付き PDF で Artifact として囲んだか */
  artifact: boolean;
}

export interface FillFormArgs extends CommonEditOptions {
  inputPath: string;
  /** フィールド名 → 値。text=文字列/数値、checkbox=真偽値、dropdown/optionlist=文字列か配列、radio=文字列 */
  fields: Record<string, string | number | boolean | string[]>;
  /** 値の描画に使うフォント。省略時は PDF_WRITER_FONT → 標準フォント。日本語には必須 */
  fontPath?: string;
  /** 記入後にフラット化して非対話にするか。既定 false */
  flatten?: boolean;
  /** タグ付き PDF でもフラット化を許すか（PDF/UA 準拠が壊れる）。既定 false */
  allowBreakingTags?: boolean;
}

export interface FlattenFormArgs extends CommonEditOptions {
  inputPath: string;
  /** 外観生成に使うフォント。既存の値に日本語が含まれる場合に必要 */
  fontPath?: string;
  /** タグ付き PDF でもフラット化を許すか（PDF/UA 準拠が壊れる）。既定 false */
  allowBreakingTags?: boolean;
}

/** 署名保持の増分更新に対応した編集ツールの共通オプション */
export interface PreservableEditOptions {
  /**
   * 署名済み PDF に対し、既存署名を無効化せず増分更新（末尾追記）で編集する。
   * 既定 false。認証署名（DocMDP）の許可レベルに反する変更は拒否される。
   */
  preserveSignatures?: boolean;
}

export interface TagFormFieldsArgs extends CommonEditOptions, PreservableEditOptions {
  inputPath: string;
  /** フィールド名 → 人間可読な代替名（/TU）。省略したフィールドはフィールド名で代用し警告する */
  labels?: Record<string, string>;
}

/** フォーム 1 フィールドの情報 */
export interface FormFieldSummary {
  name: string;
  kind: string;
  value?: string | string[] | boolean;
  options?: string[];
  readOnly: boolean;
  required: boolean;
}

export interface FormResult extends EditResult {
  /** 値を設定したフィールド数 */
  filled: number;
  /** フラット化したか */
  flattened: boolean;
  /** 処理後のフィールド一覧（フラット化後は空） */
  fields: FormFieldSummary[];
}

export interface EnsureTaggedArgs extends CommonEditOptions, PreservableEditOptions {
  inputPath: string;
  /** 文書タイトル（PDF/UA 7.1 で必須）。省略時は既存 Info の Title を使う */
  title?: string;
  /** 文書の自然言語（BCP 47。7.2 で必須） */
  lang?: string;
}

export interface EnsureTaggedResult extends EditResult {
  /** 入力が既にタグ付きだったか */
  wasTagged: boolean;
  /** 構造木を新設したか（タグ無し入力のみ） */
  createdStructure: boolean;
  /** P 要素で包んだページ数 */
  wrappedPages: number;
  /** 補った文書レベル要件 */
  addedRequirements: string[];
}

export interface TagFormFieldsResult extends EditResult {
  /** 新たに Form 構造要素へ内包した Widget 数 */
  taggedWidgets: number;
  /** 既に構造木に結ばれていてスキップした Widget 数 */
  skippedWidgets: number;
  /** 処理後のフィールド一覧 */
  fields: FormFieldSummary[];
}

/**
 * 埋め込みファイルと本文の関係（PDF/A-3 §6.8 / ISO 32000-2 Table 46）。
 * PDF/A-3 では指定が必須。
 */
export type AttachmentRelationship =
  /** 本文の元になったデータ（例: 請求書 PDF に対する元の CSV） */
  | 'Source'
  /** 本文と同じ内容の機械可読データ（例: ZUGFeRD/電帳法の XML・CSV） */
  | 'Data'
  /** 本文の代替表現（例: 音声版） */
  | 'Alternative'
  /** 補足資料 */
  | 'Supplement'
  /** 不明・その他 */
  | 'Unspecified';

export interface AttachFileArgs extends CommonEditOptions, PreservableEditOptions {
  inputPath: string;
  /** 埋め込むファイルのパス */
  attachmentPath: string;
  /** PDF 内での表示名。省略時は元のファイル名 */
  name?: string;
  /** 説明（/Desc） */
  description?: string;
  /** MIME 型。省略時は拡張子から推定 */
  mimeType?: string;
  /** 本文との関係。既定 Unspecified */
  relationship?: AttachmentRelationship;
}

/**
 * 添付結果
 */
export interface AttachResult extends EditResult {
  attachment: {
    name: string;
    bytes: number;
    mimeType: string;
    relationship: string;
  };
  /** 埋め込み後の全添付ファイル名 */
  attachments: string[];
}

/**
 * 編集結果
 */
export interface EditResult {
  path?: string;
  base64?: string;
  pageCount: number;
  bytes: number;
  /** 注意すべき事象の報告（タグ付き PDF への注釈で alt 未指定、等） */
  warnings?: string[];
  /** 増分更新（末尾追記）で保存したか。true なら既存署名は保持されている */
  incremental?: boolean;
}

/**
 * 分割結果
 */
export interface SplitResult {
  files: Array<{ path: string; pageCount: number; bytes: number }>;
  count: number;
  /**
   * 注意すべき事象の報告。全パートが同じ入力から出るため損失も共通で、
   * 結果全体に 1 度だけ載せる（B-10a: 文書レベル要素の非引き継ぎ）
   */
  warnings?: string[];
}

/**
 * MCP レスポンスの content block（最小限）
 */
export interface ContentBlock {
  type: 'text';
  text: string;
}
