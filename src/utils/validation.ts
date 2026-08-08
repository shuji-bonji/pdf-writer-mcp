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
 * description は英語が正典（B-21）。日本語はサイト側の翻訳メモリが持つ。
 */

import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { LIMITS, PAGE_SIZES, type PageSizeName } from '../constants.js';
import { invalidArg } from '../errors.js';
import { PDF_VERSIONS } from '../services/pdf-version.js';
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
    .describe(
      'Destination file path (absolute). When omitted, a base64 string is returned instead.',
    ),
  returnBase64: z
    .boolean()
    .optional()
    .describe('When true, include a base64 string in the result in addition to saving.'),
  fontPath: zPath
    .optional()
    .describe(
      'Absolute path of the font file to embed (.ttf / .otf). Required for non-Latin text such as Japanese. ' +
        '.ttc (TrueType Collection) is not supported. Can also be set via the PDF_WRITER_FONT environment variable.',
    ),
  fontSize: zFontSize.optional().describe('Body font size (pt). Default 11. Range 4-96.'),
  pageSize: zPageSize.optional().describe('Page size. Default A4.'),
  margin: zMargin
    .optional()
    .describe('Margin on all sides (pt). Default 56 (about 20 mm). Range 0-300.'),
  title: z
    .string()
    .optional()
    .describe('PDF title. Set in the metadata and also drawn as a heading at the top of the body.'),
  author: z.string().optional().describe('PDF author (metadata).'),
  onMissingGlyph: z
    .enum(['error', 'replace', 'ignore'])
    .optional()
    .describe(
      'What to do with characters the font lacks (e.g. ✔ U+2714, missing from Noto Sans JP). ' +
        'error (default) = fail, listing the missing characters / replace = substitute 〓 with a warning / ' +
        'ignore = render as blanks with a warning.',
    ),
  tagged: z
    .boolean()
    .optional()
    .describe(
      'Generate as a tagged PDF (PDF/UA-1, ISO 14289). Default false. ' +
        'When true, a structure tree, the PDF/UA declaration, /Lang and DisplayDocTitle are added, ' +
        'making the document readable by screen readers. PDF/UA requires a title, so title becomes required.',
    ),
  lang: z
    .string()
    .regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, {
      message: 'must be a BCP 47 language tag like "ja" or "en-US"',
    })
    .optional()
    .describe(
      'Natural language of the document (BCP 47, e.g. "ja" / "en-US"). When omitted with tagged, ' +
        'it is inferred from the text and the guess is reported in warnings. A wrong language declaration ' +
        'makes screen readers misread — state it explicitly when you know it.',
    ),
  pdfVersion: z
    .enum(PDF_VERSIONS)
    .optional()
    .describe(
      'PDF version to output. Default "1.7". "2.0" (ISO 32000-2) satisfies not just the version claim but ' +
        'the duties bound to it: a trailer /ID is added (Required per Table 15), and the Info dictionary is ' +
        'trimmed to CreationDate / ModDate with title, author and Producer moved to XMP (§14.3.3). ' +
        'Cannot be combined with tagged: true (the only declaration the writer can produce is PDF/UA-1, built on PDF 1.7).',
    ),
} as const;

export const commonEditShape = {
  outputPath: zPath
    .optional()
    .describe(
      'Destination file path (absolute). When omitted, a base64 string is returned instead.',
    ),
  returnBase64: z
    .boolean()
    .optional()
    .describe('When true, include a base64 string in the result in addition to saving.'),
  allowBreakingSignatures: z
    .boolean()
    .optional()
    .describe(
      'When the target is digitally signed (detected via /ByteRange), the default is an error. ' +
        'Set true to proceed, accepting that the signatures become invalid.',
    ),
} as const;

const inputPath = zPath.describe('Absolute path of the target PDF.');

// ---------------------------------------------------------------------------
// ツール別スキーマ（shape = MCP 公開用 / schema = 実行時検証用）
// ---------------------------------------------------------------------------

export const createTextShape = {
  text: z
    .string()
    .max(LIMITS.TEXT_MAX_LENGTH)
    .describe('Body text. \\n breaks lines; blank lines separate paragraphs.'),
  ...commonCreateShape,
} as const;

export const createMarkdownShape = {
  markdown: z.string().max(LIMITS.TEXT_MAX_LENGTH).describe('Markdown string.'),
  ...commonCreateShape,
} as const;

export const createTableShape = {
  headers: z
    .array(z.string())
    .min(1)
    .max(LIMITS.TABLE_MAX_COLS)
    .describe('Header row (column titles).'),
  rows: z
    .array(z.array(z.string()))
    .max(LIMITS.TABLE_MAX_ROWS)
    .describe(
      'Data rows. Each row is an array of strings; the same column count as headers is recommended.',
    ),
  ...commonCreateShape,
} as const;

/** 署名保持の増分更新に対応したツールが共有する preserveSignatures フィールド */
const zPreserveSignatures = z
  .boolean()
  .optional()
  .describe(
    'Edit a signed PDF via an incremental update (appending) without invalidating existing signatures. ' +
      'Default false. The original bytes are untouched, so /ByteRange holds. ' +
      'Changes beyond the certification (DocMDP) permission level are refused.',
  );

export const setMetadataShape = {
  inputPath: zPath.describe('Absolute path of the PDF to edit.'),
  title: z.string().optional().describe('Title.'),
  author: z.string().optional().describe('Author.'),
  subject: z.string().optional().describe('Subject.'),
  keywords: z.array(z.string()).optional().describe('Array of keywords.'),
  creator: z.string().optional().describe('Creating application name.'),
  preserveSignatures: zPreserveSignatures,
  ...commonEditShape,
} as const;

export const mergePdfsShape = {
  inputPaths: z
    .array(zPath)
    .min(2)
    .max(LIMITS.MERGE_MAX_INPUTS)
    .describe('Absolute paths of the PDFs to merge (in merge order, 2 or more).'),
  ...commonEditShape,
} as const;

export const splitPdfShape = {
  inputPath: zPath.describe('Absolute path of the PDF to split.'),
  ranges: z
    .array(z.string().min(1))
    .min(1)
    .max(LIMITS.SPLIT_MAX_PARTS)
    .describe(
      'Array of page ranges. Each element is "1-3" / "5" / "7-" / "-2" (1-based). Example: ["1-3", "4-"].',
    ),
  outputDir: zPath.describe('Output directory (absolute path).'),
  prefix: z
    .string()
    .min(1)
    .optional()
    .describe('Output filename prefix. Default "<input name>-part".'),
  allowBreakingSignatures: commonEditShape.allowBreakingSignatures,
} as const;

export const extractPagesShape = {
  inputPath,
  pages: zPageSpec.describe(
    'Pages to extract, "1,3-5,8-" (1-based). The given order becomes the output order.',
  ),
  ...commonEditShape,
} as const;

export const deletePagesShape = {
  inputPath,
  pages: zPageSpec.describe('Pages to delete, "1,3-5,8-" (1-based).'),
  ...commonEditShape,
} as const;

export const reorderPagesShape = {
  inputPath,
  order: z
    .array(z.number().int())
    .min(1)
    .describe('New page order (1-based). Example: [5,4,3,2,1] reverses a 5-page document.'),
  ...commonEditShape,
} as const;

export const rotatePagesShape = {
  inputPath,
  // z.union([z.literal(90), ...]) は JSON Schema で anyOf になる。SDK の変換は正しいが、
  // anyOf を落として型を見失うクライアントが実在し、rotate_pages が呼べなくなっていた（B-13）。
  // z.literal([...]) なら等価な意味のまま平坦な {type:'number', enum:[...]} になる。
  // 実行時の厳格さは不変（文字列 "90" は引き続き拒否）。値の列挙は anyOf ではなく enum で表すこと。
  rotation: z.literal([90, 180, 270]).describe('Clockwise rotation (degrees): 90 / 180 / 270.'),
  pages: zPageSpec.optional().describe('Target pages, "1,3-5" (1-based). All pages when omitted.'),
  ...commonEditShape,
} as const;

const bookmarkSchema: z.ZodType<BookmarkInput> = z.lazy(() =>
  z.object({
    title: z.string().min(1).describe('Display name.'),
    page: z.number().int().min(1).describe('Destination page (1-based).'),
    open: z.boolean().optional().describe('Whether children start expanded. Default true.'),
    children: z
      .array(bookmarkSchema)
      .min(1)
      .optional()
      .describe('Array of child bookmarks (same shape).'),
  }),
);

export const addBookmarksShape = {
  inputPath,
  bookmarks: z
    .array(bookmarkSchema)
    .min(1)
    .describe(
      'Array of bookmarks, each { title, page, open?, children? }. page is 1-based. ' +
        'Nest via children — up to 8 levels and 2000 entries in total.',
    ),
  preserveSignatures: zPreserveSignatures,
  ...commonEditShape,
} as const;

export const addAnnotationShape = {
  inputPath,
  page: z.number().int().min(1).describe('Target page (1-based).'),
  type: z
    .enum(['text', 'highlight', 'square'])
    .describe('text = sticky note icon / highlight = highlight / square = rectangle.'),
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
    .describe(
      'Annotation rectangle in PDF space (origin bottom-left, pt). Must satisfy x1<x2 and y1<y2.',
    ),
  contents: z.string().optional().describe('Annotation body text (CJK fine).'),
  author: z.string().optional().describe('Author name.'),
  alt: z
    .string()
    .optional()
    .describe(
      'Alt text for assistive technology. In tagged PDFs the annotation is enclosed in an Annot structure ' +
        "element (PDF/UA 7.18.1-1) and this becomes that element's /Alt. Ignored in untagged documents.",
    ),
  color: z
    .string()
    .optional()
    .describe('#rrggbb. Defaults per type (text=#ffd400 / highlight=#ffff00 / square=#ff0000).'),
  interiorColor: z.string().optional().describe('Fill colour for square (#rrggbb).'),
  icon: z
    .enum(['Note', 'Comment', 'Key', 'Help', 'NewParagraph', 'Paragraph', 'Insert'])
    .optional()
    .describe('Icon for text notes. Default Note.'),
  open: z.boolean().optional().describe('Whether the text note starts open. Default false.'),
  preserveSignatures: z
    .boolean()
    .optional()
    .describe(
      'Add the annotation to a signed PDF via an incremental update (appending) without invalidating ' +
        'existing signatures. Default false. The original bytes are untouched, so /ByteRange holds. ' +
        'In tagged PDFs the enclosure in an Annot structure element rides the same update, preserving ' +
        'PDF/UA conformance. Under a certification signature (DocMDP), allowed only at P=3.',
    ),
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
      'Format. {n} = current page, {total} = total pages. Default "{n}". ' +
        'Examples: "- {n} -" / "{n} / {total}" / "Page {n}". Must contain {n}.',
    ),
  position: z
    .enum(['bottom-left', 'bottom-center', 'bottom-right', 'top-left', 'top-center', 'top-right'])
    .optional()
    .describe(
      'Placement. Default bottom-center. Visual position, taking page /Rotate into account.',
    ),
  margin: zMargin.optional().describe('Margin from the edge (pt). Default 24. Range 0-300.'),
  fontSize: zFontSize.optional().describe('Font size (pt). Default 9. Range 4-96.'),
  color: z.string().min(1).optional().describe('#rrggbb. Default #666666.'),
  fontPath: zPath
    .optional()
    .describe(
      'Font to embed (.ttf/.otf). Falls back to the PDF_WRITER_FONT environment variable, then the standard font. ' +
        'Required for formats containing CJK text.',
    ),
  pages: zPageSpec
    .optional()
    .describe(
      'Pages to stamp, "1,3-5,8-" (1-based). All when omitted. Use "2-" to skip a cover page.',
    ),
  startAt: z
    .number()
    .int()
    .optional()
    .describe(
      'First number to stamp. Default 1. Useful to start at 1 after skipping a cover page.',
    ),
  preserveSignatures: zPreserveSignatures,
  ...commonEditShape,
} as const;

export const addWatermarkShape = {
  inputPath,
  text: z.string().min(1).describe('Watermark text, e.g. "社外秘" / "DRAFT" / "COPY".'),
  fontSize: zFontSize.optional().describe('Font size (pt). Default 60. Range 4-96.'),
  color: z.string().min(1).optional().describe('#rrggbb. Default #808080 (grey).'),
  opacity: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe(
      'Opacity, 0 (transparent) to 1 (opaque). Default 0.15 — faint enough to keep the content readable.',
    ),
  angle: z
    .number()
    .finite()
    .optional()
    .describe('Counter-clockwise angle (degrees). Default 45. 0 = horizontal.'),
  behind: z
    .boolean()
    .optional()
    .describe(
      'Draw behind the content. Default true. false draws over it (to strengthen the tamper-deterrent claim).',
    ),
  fontPath: zPath
    .optional()
    .describe(
      'Font to embed (.ttf/.otf). Falls back to the PDF_WRITER_FONT environment variable, then the standard font. ' +
        'Required for CJK watermarks.',
    ),
  pages: zPageSpec.optional().describe('Target pages, "1,3-5,8-" (1-based). All when omitted.'),
  preserveSignatures: zPreserveSignatures,
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
      'Object of field name → value. Value type matches the field kind: ' +
        'text = string or number / checkbox = boolean / dropdown, optionlist = string or string array / radio = string. ' +
        'Example: {"user.name": "山田 太郎", "agree": true, "plan": "A"}',
    ),
  fontPath: zPath
    .optional()
    .describe(
      'Font used to render values (.ttf/.otf). Falls back to the PDF_WRITER_FONT environment variable, ' +
        'then the standard font. Required for CJK values.',
    ),
  flatten: z
    .boolean()
    .optional()
    .describe(
      'Flatten to non-interactive after filling. Default false. When true, values can no longer be edited.',
    ),
  allowBreakingTags: z
    .boolean()
    .optional()
    .describe(
      'Allow flattening even on a tagged PDF. Default false. When true, PDF/UA-1 conformance breaks.',
    ),
  ...commonEditShape,
} as const;

export const flattenFormShape = {
  inputPath,
  fontPath: zPath
    .optional()
    .describe(
      'Font for appearance regeneration. Falls back to the PDF_WRITER_FONT environment variable, then the ' +
        'standard font. Not needed when existing appearances can be reused, but required for CJK forms that need regeneration.',
    ),
  allowBreakingTags: z
    .boolean()
    .optional()
    .describe('Allow flattening even on a tagged PDF. Default false.'),
  ...commonEditShape,
} as const;

export const tagFormFieldsShape = {
  inputPath,
  labels: z
    .record(z.string(), z.string().min(1))
    .optional()
    .describe(
      'Field name → human-readable alternate name (/TU) — what a screen reader speaks. ' +
        'Example: {"user.name": "氏名", "agree": "利用規約に同意する"}. ' +
        'Omitted fields fall back to the field name as /TU, reported in warnings. ' +
        'A nonexistent field name errors, listing every field name.',
    ),
  preserveSignatures: zPreserveSignatures,
  ...commonEditShape,
} as const;

export const ensureTaggedShape = {
  inputPath,
  title: z
    .string()
    .min(1)
    .optional()
    .describe('Document title (required by PDF/UA-1 7.1). Falls back to the existing Info Title.'),
  lang: z
    .string()
    .regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, {
      message: 'must be a BCP 47 language tag like "ja" or "en-US"',
    })
    .optional()
    .describe('Natural language of the document (BCP 47, e.g. "ja"). Required by PDF/UA-1 7.2.'),
  preserveSignatures: zPreserveSignatures,
  ...commonEditShape,
} as const;

export const ensurePdfaShape = {
  inputPath,
  flavour: z
    .enum(['pdfa-3b', 'pdfa-4', 'pdfa-4f'])
    .optional()
    .describe(
      'The PDF/A to claim. Default "pdfa-3b". "pdfa-4" (ISO 19005-4) is built on PDF 2.0, so beyond ' +
        '/ID, OutputIntent and XMP pdfaid it **sets the header to 2.0 and drops the Info dictionary** ' +
        '(-4 forbids Info unless PieceInfo is present). ' +
        '**-4 has no conformance level**, so pdfaid:rev is written instead of pdfaid:conformance. ' +
        '**Documents with attachments must use "pdfa-4f"** — plain "pdfa-4" requires every attachment to be ' +
        'PDF/A itself, so bundling JSON or CSV (the Japanese e-bookkeeping-law pattern) would not conform. ' +
        'Combination with preserveSignatures is refused unless the input is already PDF 2.0 ' +
        '(an incremental update cannot rewrite the header, and rewriting it would break the signatures).',
    ),
  preserveSignatures: zPreserveSignatures,
  ...commonEditShape,
} as const;

export const attachFileShape = {
  inputPath,
  attachmentPath: zPath.describe('Absolute path of the file to embed.'),
  name: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Display name inside the PDF. Defaults to the original filename. Must not duplicate an existing attachment.',
    ),
  description: z
    .string()
    .min(1)
    .optional()
    .describe('Description of the attachment (/Desc; CJK fine).'),
  mimeType: z
    .string()
    .min(1)
    .optional()
    .describe('MIME type. Inferred from the extension when omitted (e.g. .csv → text/csv).'),
  relationship: z
    .enum(['Source', 'Data', 'Alternative', 'Supplement', 'Unspecified'])
    .optional()
    .describe(
      'Relation to the document content (PDF/A-3 §6.8). Data = machine-readable data with the same content ' +
        'as the document (invoice XML/CSV etc.) / Source = the source data of the document / ' +
        'Alternative = an alternative representation / Supplement = supplementary material / ' +
        'Unspecified = unknown (default). PDF/A-3 requires a meaningful value, so omission warns.',
    ),
  preserveSignatures: zPreserveSignatures,
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
export const EnsureTaggedSchema = z.object(ensureTaggedShape);
export const EnsurePdfaSchema = z.object(ensurePdfaShape);
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
