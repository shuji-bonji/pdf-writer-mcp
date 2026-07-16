/**
 * Input Validation — Zod スキーマ一元化（E-5）
 *
 * 以前は手書き asserts（本ファイル）と definitions.ts の JSON Schema が
 * 同じ制約を二重管理していた。v0.7.0 からは Zod スキーマがただ一つの情報源:
 *   - MCP への公開スキーマ（definitions.ts が shape を JSON Schema 化）
 *   - 実行時検証（handlers.ts が parseArgs で同じスキーマを適用）
 * の両方をここから導出する。閾値は constants.ts に集約（変更なし）。
 *
 * フィールドの description もここに置く — ツール説明と実検証の乖離を防ぐ。
 */

import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { LIMITS, PAGE_SIZES, type PageSizeName } from '../constants.js';
import { invalidArg } from '../errors.js';
import type { BookmarkInput } from '../types/index.js';

// ---------------------------------------------------------------------------
// 共有ビルディングブロック
// ---------------------------------------------------------------------------

/**
 * ファイルパスの検査（E-1）。
 * writer は family で唯一「任意パスへ書き込む」サーバなので、
 * 絶対パスを強制し ".." セグメントを拒否する。
 * 解決結果ではなく指定文字列そのものを検査する（"/a/../b" のような
 * 意図の読めない指定を、正規化して通すのではなく明示的に拒否する）。
 */
const zPath = z
  .string()
  .min(1)
  .refine((p) => isAbsolute(p), {
    message: 'must be an absolute path (e.g. "/path/to/file.pdf")',
  })
  .refine((p) => !p.split(/[/\\]+/).includes('..'), {
    message: 'must not contain ".." segments',
  });

const zFontSize = z.number().finite().min(LIMITS.FONT_SIZE_MIN).max(LIMITS.FONT_SIZE_MAX);

const zMargin = z.number().finite().min(LIMITS.MARGIN_MIN).max(LIMITS.MARGIN_MAX);

/** "1,3-5,8-" 形式のページ指定（構文の詳細検査は page-spec.ts が行う） */
const zPageSpec = z.string().min(1);

const zPageSize = z.enum(Object.keys(PAGE_SIZES) as [PageSizeName, ...PageSizeName[]]);

// ---------------------------------------------------------------------------
// 共通オプション（create 系 / edit 系）
// ---------------------------------------------------------------------------

export const commonCreateShape = {
  outputPath: zPath
    .optional()
    .describe('保存先ファイルパス（絶対パス）。省略した場合は base64 文字列を返す。'),
  returnBase64: z
    .boolean()
    .optional()
    .describe('true の場合、保存に加えて base64 文字列も結果に含める。'),
  fontPath: zPath
    .optional()
    .describe(
      '埋め込むフォントファイル(.ttf / .otf)の絶対パス。日本語など非ラテン文字を含む場合は必須。' +
        '.ttc(TrueTypeCollection)は非対応。環境変数 PDF_WRITER_FONT でも指定可。',
    ),
  fontSize: zFontSize.optional().describe('本文フォントサイズ(pt)。既定 11。範囲 4〜96。'),
  pageSize: zPageSize.optional().describe('ページサイズ。既定 A4。'),
  margin: zMargin.optional().describe('上下左右マージン(pt)。既定 56(≒20mm)。範囲 0〜300。'),
  title: z
    .string()
    .optional()
    .describe('PDF タイトル。メタデータに設定し、本文冒頭にも見出しとして描画する。'),
  author: z.string().optional().describe('PDF 作成者(メタデータ)。'),
  onMissingGlyph: z
    .enum(['error', 'replace', 'ignore'])
    .optional()
    .describe(
      'フォントに存在しない文字(例: Noto Sans JP に無い ✔ U+2714)の扱い。' +
        'error(既定)=欠落文字を列挙してエラー / replace=〓 に置換して警告 / ignore=空白のまま描画して警告。',
    ),
  tagged: z
    .boolean()
    .optional()
    .describe(
      'タグ付き PDF(PDF/UA-1・ISO 14289)として生成する。既定 false。' +
        'true にすると構造木・PDF/UA 宣言・/Lang・DisplayDocTitle を付与し、' +
        'スクリーンリーダで読める文書になる。PDF/UA はタイトルを要求するため title が必須。',
    ),
  lang: z
    .string()
    .regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, {
      message: 'must be a BCP 47 language tag like "ja" or "en-US"',
    })
    .optional()
    .describe(
      '文書の自然言語(BCP 47。例 "ja" / "en-US")。tagged 時に省略すると本文から推定し、' +
        '推定結果を warnings で報告する。誤った言語宣言はスクリーンリーダの誤読を招くため、' +
        '確実な場合は明示すること。',
    ),
} as const;

export const commonEditShape = {
  outputPath: zPath
    .optional()
    .describe('保存先ファイルパス（絶対パス）。省略した場合は base64 文字列を返す。'),
  returnBase64: z
    .boolean()
    .optional()
    .describe('true の場合、保存に加えて base64 文字列も結果に含める。'),
  allowBreakingSignatures: z
    .boolean()
    .optional()
    .describe(
      '編集対象が電子署名済み(/ByteRange 検知)の場合、既定ではエラーにする。' +
        'true を指定すると署名が無効化されることを承知の上で編集を続行する。',
    ),
} as const;

const inputPath = zPath.describe('対象 PDF の絶対パス。');

// ---------------------------------------------------------------------------
// ツール別スキーマ（shape = MCP 公開用 / schema = 実行時検証用）
// ---------------------------------------------------------------------------

export const createTextShape = {
  text: z
    .string()
    .max(LIMITS.TEXT_MAX_LENGTH)
    .describe('本文テキスト。\\n で改行、空行で段落区切り。'),
  ...commonCreateShape,
} as const;

export const createMarkdownShape = {
  markdown: z.string().max(LIMITS.TEXT_MAX_LENGTH).describe('Markdown 文字列。'),
  ...commonCreateShape,
} as const;

export const createTableShape = {
  headers: z
    .array(z.string())
    .min(1)
    .max(LIMITS.TABLE_MAX_COLS)
    .describe('ヘッダ行(列見出し)の配列。'),
  rows: z
    .array(z.array(z.string()))
    .max(LIMITS.TABLE_MAX_ROWS)
    .describe('データ行の配列。各行は文字列の配列で、headers と同じ列数を推奨。'),
  ...commonCreateShape,
} as const;

export const setMetadataShape = {
  inputPath: zPath.describe('編集対象 PDF の絶対パス。'),
  title: z.string().optional().describe('タイトル。'),
  author: z.string().optional().describe('作成者。'),
  subject: z.string().optional().describe('サブタイトル・件名。'),
  keywords: z.array(z.string()).optional().describe('キーワードの配列。'),
  creator: z.string().optional().describe('作成アプリケーション名。'),
  ...commonEditShape,
} as const;

export const mergePdfsShape = {
  inputPaths: z
    .array(zPath)
    .min(2)
    .max(LIMITS.MERGE_MAX_INPUTS)
    .describe('結合する PDF の絶対パスの配列(結合順・2 件以上)。'),
  ...commonEditShape,
} as const;

export const splitPdfShape = {
  inputPath: zPath.describe('分割対象 PDF の絶対パス。'),
  ranges: z
    .array(z.string().min(1))
    .min(1)
    .max(LIMITS.SPLIT_MAX_PARTS)
    .describe(
      'ページ範囲指定の配列。各要素は "1-3" / "5" / "7-" / "-2" 形式(1 始まり)。例: ["1-3", "4-"]。',
    ),
  outputDir: zPath.describe('出力先ディレクトリ（絶対パス）。'),
  prefix: z
    .string()
    .min(1)
    .optional()
    .describe('出力ファイル名の接頭辞。既定は "<入力ファイル名>-part"。'),
  allowBreakingSignatures: commonEditShape.allowBreakingSignatures,
} as const;

export const extractPagesShape = {
  inputPath,
  pages: zPageSpec.describe('ページ指定。"1,3-5,8-" 形式(1 始まり)。指定順が出力順になる。'),
  ...commonEditShape,
} as const;

export const deletePagesShape = {
  inputPath,
  pages: zPageSpec.describe('削除するページ指定。"1,3-5,8-" 形式(1 始まり)。'),
  ...commonEditShape,
} as const;

export const reorderPagesShape = {
  inputPath,
  order: z
    .array(z.number().int())
    .min(1)
    .describe('新しいページ順(1 始まり)。例: 5 ページの逆順は [5,4,3,2,1]。'),
  ...commonEditShape,
} as const;

export const rotatePagesShape = {
  inputPath,
  rotation: z
    .union([z.literal(90), z.literal(180), z.literal(270)])
    .describe('時計回りの回転角(度)。90 / 180 / 270。'),
  pages: zPageSpec
    .optional()
    .describe('対象ページ指定。"1,3-5" 形式(1 始まり)。省略時は全ページ。'),
  ...commonEditShape,
} as const;

const bookmarkSchema: z.ZodType<BookmarkInput> = z.lazy(() =>
  z.object({
    title: z.string().min(1).describe('表示名。'),
    page: z.number().int().min(1).describe('移動先ページ(1 始まり)。'),
    open: z.boolean().optional().describe('子項目を展開した状態で表示するか。既定 true。'),
    children: z.array(bookmarkSchema).min(1).optional().describe('子しおりの配列(同じ形)。'),
  }),
);

export const addBookmarksShape = {
  inputPath,
  bookmarks: z
    .array(bookmarkSchema)
    .min(1)
    .describe(
      'しおりの配列。各要素は { title, page, open?, children? }。' +
        'page は 1 始まり。children で階層化でき、最大 8 階層・合計 2000 件まで。',
    ),
  ...commonEditShape,
} as const;

export const addAnnotationShape = {
  inputPath,
  page: z.number().int().min(1).describe('対象ページ(1 始まり)。'),
  type: z
    .enum(['text', 'highlight', 'square'])
    .describe('text=付箋アイコン / highlight=ハイライト / square=矩形。'),
  rect: z
    .object({
      x1: z.number().finite(),
      y1: z.number().finite(),
      x2: z.number().finite(),
      y2: z.number().finite(),
    })
    .refine((r) => r.x1 < r.x2 && r.y1 < r.y2, {
      message: 'rect must satisfy x1 < x2 and y1 < y2',
    })
    .describe('注釈の矩形。PDF 座標系(左下原点・pt)。x1<x2 かつ y1<y2 であること。'),
  contents: z.string().optional().describe('注釈の本文(日本語可)。'),
  author: z.string().optional().describe('作成者名。'),
  alt: z
    .string()
    .optional()
    .describe(
      '支援技術向けの代替テキスト。タグ付き PDF では注釈が Annot 構造要素に内包される' +
        '(PDF/UA 7.18.1-1)ため、その要素の /Alt になる。タグ無し文書では無視される。',
    ),
  color: z
    .string()
    .optional()
    .describe(
      '#rrggbb 形式。既定は type ごと(text=#ffd400 / highlight=#ffff00 / square=#ff0000)。',
    ),
  interiorColor: z.string().optional().describe('square の塗り色(#rrggbb)。'),
  icon: z
    .enum(['Note', 'Comment', 'Key', 'Help', 'NewParagraph', 'Paragraph', 'Insert'])
    .optional()
    .describe('text のアイコン。既定 Note。'),
  open: z.boolean().optional().describe('text を開いた状態にするか。既定 false。'),
  ...commonEditShape,
} as const;

export const stampPageNumbersShape = {
  inputPath,
  format: z
    .string()
    .min(1)
    .refine((f) => f.includes('{n}'), {
      message: 'format must contain "{n}" (the page number placeholder)',
    })
    .optional()
    .describe(
      '書式。{n}=現在ページ、{total}=総ページ数。既定 "{n}"。' +
        '例: "- {n} -" / "{n} / {total}" / "{n} ページ"。{n} を必ず含めること。',
    ),
  position: z
    .enum(['bottom-left', 'bottom-center', 'bottom-right', 'top-left', 'top-center', 'top-right'])
    .optional()
    .describe('配置。既定 bottom-center。ページの回転(/Rotate)を考慮した見た目の位置。'),
  margin: zMargin.optional().describe('端からの余白(pt)。既定 24。範囲 0〜300。'),
  fontSize: zFontSize.optional().describe('フォントサイズ(pt)。既定 9。範囲 4〜96。'),
  color: z.string().min(1).optional().describe('#rrggbb。既定 #666666。'),
  fontPath: zPath
    .optional()
    .describe(
      '埋め込むフォント(.ttf/.otf)。省略時は環境変数 PDF_WRITER_FONT → 標準フォント。' +
        '日本語を含む書式には必須。',
    ),
  pages: zPageSpec
    .optional()
    .describe(
      '番号を刻むページ指定。"1,3-5,8-" 形式(1 始まり)。省略時は全ページ。' +
        '表紙を除くなら "2-" のように指定する。',
    ),
  startAt: z
    .number()
    .int()
    .optional()
    .describe('最初に刻む番号。既定 1。表紙を除いて 1 から始めたい場合などに使う。'),
  ...commonEditShape,
} as const;

export const addWatermarkShape = {
  inputPath,
  text: z.string().min(1).describe('透かし文字。例: "社外秘" / "DRAFT" / "COPY"。'),
  fontSize: zFontSize.optional().describe('フォントサイズ(pt)。既定 60。範囲 4〜96。'),
  color: z.string().min(1).optional().describe('#rrggbb。既定 #808080(灰)。'),
  opacity: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe('不透明度 0(透明)〜1(不透明)。既定 0.15。本文を読める程度に薄くする。'),
  angle: z.number().finite().optional().describe('反時計回りの角度(度)。既定 45。0 で水平。'),
  behind: z
    .boolean()
    .optional()
    .describe(
      '本文の背面に敷くか。既定 true。false にすると本文の上に重なる(改ざん防止の主張を強めたい場合)。',
    ),
  fontPath: zPath
    .optional()
    .describe(
      '埋め込むフォント(.ttf/.otf)。省略時は環境変数 PDF_WRITER_FONT → 標準フォント。' +
        '日本語の透かしには必須。',
    ),
  pages: zPageSpec
    .optional()
    .describe('対象ページ指定。"1,3-5,8-" 形式(1 始まり)。省略時は全ページ。'),
  ...commonEditShape,
} as const;

export const fillFormShape = {
  inputPath,
  fields: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]))
    .refine((o) => Object.keys(o).length > 0, {
      message: 'fields must contain at least one field to fill',
    })
    .describe(
      'フィールド名 → 値のオブジェクト。値の型はフィールド種別に対応する: ' +
        'text=文字列か数値 / checkbox=真偽値 / dropdown・optionlist=文字列か文字列配列 / radio=文字列。' +
        '例: {"user.name": "山田 太郎", "agree": true, "plan": "A"}',
    ),
  fontPath: zPath
    .optional()
    .describe(
      '値の描画に使うフォント(.ttf/.otf)。省略時は環境変数 PDF_WRITER_FONT → 標準フォント。' +
        '日本語の値には必須。',
    ),
  flatten: z
    .boolean()
    .optional()
    .describe(
      '記入後にフラット化して非対話にするか。既定 false。true にすると値は編集できなくなる。',
    ),
  allowBreakingTags: z
    .boolean()
    .optional()
    .describe(
      'タグ付き PDF でもフラット化を許すか。既定 false。true にすると PDF/UA-1 準拠が壊れる。',
    ),
  ...commonEditShape,
} as const;

export const flattenFormShape = {
  inputPath,
  fontPath: zPath
    .optional()
    .describe(
      '外観生成に使うフォント。省略時は環境変数 PDF_WRITER_FONT → 標準フォント。' +
        '既存の外観をそのまま使える場合は不要だが、再生成が必要な日本語フォームでは要る。',
    ),
  allowBreakingTags: z
    .boolean()
    .optional()
    .describe('タグ付き PDF でもフラット化を許すか。既定 false。'),
  ...commonEditShape,
} as const;

export const tagFormFieldsShape = {
  inputPath,
  labels: z
    .record(z.string(), z.string().min(1))
    .optional()
    .describe(
      'フィールド名 → 人間可読な代替名(/TU)。スクリーンリーダが読み上げる名前で、' +
        '例: {"user.name": "氏名", "agree": "利用規約に同意する"}。' +
        '省略したフィールドはフィールド名を /TU に代用し、warnings で報告する。' +
        '存在しないフィールド名を指定するとエラーに全フィールド名が列挙される。',
    ),
  ...commonEditShape,
} as const;

export const attachFileShape = {
  inputPath,
  attachmentPath: zPath.describe('埋め込むファイルの絶対パス。'),
  name: z
    .string()
    .min(1)
    .optional()
    .describe('PDF 内での表示名。省略時は元のファイル名。既存の添付と同名にはできない。'),
  description: z.string().min(1).optional().describe('添付の説明(/Desc・日本語可)。'),
  mimeType: z
    .string()
    .min(1)
    .optional()
    .describe('MIME 型。省略時は拡張子から推定(例 .csv → text/csv)。'),
  relationship: z
    .enum(['Source', 'Data', 'Alternative', 'Supplement', 'Unspecified'])
    .optional()
    .describe(
      '本文との関係(PDF/A-3 §6.8)。Data=本文と同じ内容の機械可読データ(請求書の XML/CSV 等) / ' +
        'Source=本文の元データ / Alternative=代替表現 / Supplement=補足資料 / Unspecified=不明(既定)。' +
        'PDF/A-3 では意味のある値が必須のため、省略すると警告する。',
    ),
  ...commonEditShape,
} as const;

// ---------------------------------------------------------------------------
// 実行時検証用フルスキーマ（オブジェクト横断の制約はここに付ける）
// ---------------------------------------------------------------------------

export const CreateTextSchema = z.object(createTextShape);
export const CreateMarkdownSchema = z.object(createMarkdownShape);
export const CreateTableSchema = z.object(createTableShape);
export const SetMetadataSchema = z
  .object(setMetadataShape)
  .refine(
    (a) =>
      a.title !== undefined ||
      a.author !== undefined ||
      a.subject !== undefined ||
      a.keywords !== undefined ||
      a.creator !== undefined,
    { message: 'set_metadata requires at least one of: title, author, subject, keywords, creator' },
  );
export const MergePdfsSchema = z.object(mergePdfsShape);
export const SplitPdfSchema = z.object(splitPdfShape);
export const ExtractPagesSchema = z.object(extractPagesShape);
export const DeletePagesSchema = z.object(deletePagesShape);
export const ReorderPagesSchema = z.object(reorderPagesShape);
export const RotatePagesSchema = z.object(rotatePagesShape);
export const AddBookmarksSchema = z.object(addBookmarksShape);
export const AddAnnotationSchema = z.object(addAnnotationShape);
export const StampPageNumbersSchema = z.object(stampPageNumbersShape);
export const AddWatermarkSchema = z.object(addWatermarkShape);
export const FillFormSchema = z.object(fillFormShape);
export const FlattenFormSchema = z.object(flattenFormShape);
export const TagFormFieldsSchema = z.object(tagFormFieldsShape);
export const AttachFileSchema = z.object(attachFileShape);

/**
 * Zod 検証を family エラー（INVALID_ARGUMENT）へ変換して適用する。
 * MCP SDK も shape で検証するが、オブジェクト横断の refine はフルスキーマに
 * しか無いため、ハンドラ側でも必ずこれを通すこと。
 */
export function parseArgs<T>(schema: z.ZodType<T>, args: unknown): T {
  const result = schema.safeParse(args);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw invalidArg(`Invalid arguments — ${issues}`);
  }
  return result.data;
}
