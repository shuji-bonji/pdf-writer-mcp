/**
 * Tool ハンドラ群 + ディスパッチ用 Map
 *
 * 新しいツールを追加するときは:
 *   1. validation.ts に Zod スキーマ（shape + フルスキーマ）を追加
 *   2. definitions.ts のレジストリに 1 エントリ追加
 *   3. handleXxx 関数を実装し、下の toolHandlers に 1 行追加
 *
 * 引数検査は Zod（validation.ts）に一元化。MCP SDK も shape で検証するが、
 * オブジェクト横断の refine はフルスキーマ側にしか無いため parseArgs を必ず通す。
 */

import { NEXT_ACTIONS, PdfWriterError } from '../errors.js';
import { buildPdf } from '../services/builder.js';
import {
  addAnnotation,
  addBookmarks,
  addWatermark,
  attachFileToPdf,
  fillForm,
  flattenForm,
  setMetadata,
  stampPageNumbers,
} from '../services/editor.js';
import { hasNonLatin1 } from '../services/layout.js';
import {
  deletePages,
  extractPages,
  mergePdfs,
  reorderPages,
  rotatePages,
  splitPdf,
} from '../services/page-ops.js';
import { renderMarkdown } from '../services/renderers/markdown.js';
import { renderTable } from '../services/renderers/table.js';
import { renderText } from '../services/renderers/text.js';
import type {
  AttachResult,
  CreateResult,
  EditResult,
  FormResult,
  SplitResult,
  StampResult,
  WatermarkResult,
} from '../types/index.js';
import {
  AddAnnotationSchema,
  AddBookmarksSchema,
  AddWatermarkSchema,
  AttachFileSchema,
  CreateMarkdownSchema,
  CreateTableSchema,
  CreateTextSchema,
  DeletePagesSchema,
  ExtractPagesSchema,
  FillFormSchema,
  FlattenFormSchema,
  MergePdfsSchema,
  parseArgs,
  ReorderPagesSchema,
  RotatePagesSchema,
  SetMetadataSchema,
  SplitPdfSchema,
  StampPageNumbersSchema,
} from '../utils/validation.js';

export async function handleCreateTextPdf(args: unknown): Promise<CreateResult> {
  const a = parseArgs(CreateTextSchema, args);
  return buildPdf(a, [a.text], (engine, loaded, [text]) => renderText(engine, text, loaded));
}

export async function handleCreateMarkdownPdf(args: unknown): Promise<CreateResult> {
  const a = parseArgs(CreateMarkdownSchema, args);
  return buildPdf(a, [a.markdown], (engine, loaded, [markdown]) =>
    renderMarkdown(engine, markdown, loaded),
  );
}

export async function handleCreateTablePdf(args: unknown): Promise<CreateResult> {
  const a = parseArgs(CreateTableSchema, args);
  // ポリシー適用のためセルを平坦化して渡し、render 内で元の形に戻す
  const cells = [...a.headers, ...a.rows.flat()];
  return buildPdf(a, cells, (engine, loaded, texts) => {
    // 表は標準フォントで日本語不可のため、描画前に検査（判定は layout の hasNonLatin1 に統一）
    if (loaded.isStandard && hasNonLatin1(texts.join('\n'))) {
      throw new PdfWriterError(
        'The table contains non-Latin characters (e.g. Japanese) but no embeddable font was provided.',
        'FONT_REQUIRED',
        { retryable: true, next_actions: [NEXT_ACTIONS.provideFontPath()] },
      );
    }
    const headers = texts.slice(0, a.headers.length);
    const rows: string[][] = [];
    let i = a.headers.length;
    for (const row of a.rows) {
      rows.push(texts.slice(i, i + row.length));
      i += row.length;
    }
    renderTable(engine, headers, rows);
  });
}

// ---------------------------------------------------------------------------
// 編集系（Tier A）
// ---------------------------------------------------------------------------

export async function handleSetMetadata(args: unknown): Promise<EditResult> {
  const a = parseArgs(SetMetadataSchema, args);
  return setMetadata(a);
}

export async function handleMergePdfs(args: unknown): Promise<EditResult> {
  const a = parseArgs(MergePdfsSchema, args);
  return mergePdfs(a.inputPaths, a);
}

export async function handleSplitPdf(args: unknown): Promise<SplitResult> {
  const a = parseArgs(SplitPdfSchema, args);
  return splitPdf(a.inputPath, a.ranges, a.outputDir, a.prefix, a);
}

export async function handleExtractPages(args: unknown): Promise<EditResult> {
  const a = parseArgs(ExtractPagesSchema, args);
  return extractPages(a.inputPath, a.pages, a);
}

export async function handleDeletePages(args: unknown): Promise<EditResult> {
  const a = parseArgs(DeletePagesSchema, args);
  return deletePages(a.inputPath, a.pages, a);
}

export async function handleReorderPages(args: unknown): Promise<EditResult> {
  const a = parseArgs(ReorderPagesSchema, args);
  return reorderPages(a.inputPath, a.order, a);
}

export async function handleRotatePages(args: unknown): Promise<EditResult> {
  const a = parseArgs(RotatePagesSchema, args);
  return rotatePages(a.inputPath, a.rotation, a.pages, a);
}

export async function handleAddBookmarks(args: unknown): Promise<EditResult> {
  const a = parseArgs(AddBookmarksSchema, args);
  return addBookmarks(a);
}

export async function handleAddAnnotation(args: unknown): Promise<EditResult> {
  const a = parseArgs(AddAnnotationSchema, args);
  return addAnnotation(a);
}

export async function handleAttachFile(args: unknown): Promise<AttachResult> {
  const a = parseArgs(AttachFileSchema, args);
  return attachFileToPdf(a);
}

export async function handleStampPageNumbers(args: unknown): Promise<StampResult> {
  const a = parseArgs(StampPageNumbersSchema, args);
  return stampPageNumbers(a);
}

export async function handleAddWatermark(args: unknown): Promise<WatermarkResult> {
  const a = parseArgs(AddWatermarkSchema, args);
  return addWatermark(a);
}

export async function handleFillForm(args: unknown): Promise<FormResult> {
  const a = parseArgs(FillFormSchema, args);
  return fillForm(a);
}

export async function handleFlattenForm(args: unknown): Promise<FormResult> {
  const a = parseArgs(FlattenFormSchema, args);
  return flattenForm(a);
}

/**
 * Tool ハンドラの Map（引数型は各ハンドラ側で検査するため any を許容）
 */
// biome-ignore lint/suspicious/noExplicitAny: MCP 境界の引数は各ハンドラ側で検査する
export const toolHandlers: Record<string, (args: any) => Promise<unknown>> = {
  create_text_pdf: handleCreateTextPdf,
  create_markdown_pdf: handleCreateMarkdownPdf,
  create_table_pdf: handleCreateTablePdf,
  set_metadata: handleSetMetadata,
  merge_pdfs: handleMergePdfs,
  split_pdf: handleSplitPdf,
  extract_pages: handleExtractPages,
  delete_pages: handleDeletePages,
  reorder_pages: handleReorderPages,
  rotate_pages: handleRotatePages,
  add_bookmarks: handleAddBookmarks,
  add_annotation: handleAddAnnotation,
  attach_file: handleAttachFile,
  stamp_page_numbers: handleStampPageNumbers,
  add_watermark: handleAddWatermark,
  fill_form: handleFillForm,
  flatten_form: handleFlattenForm,
};
