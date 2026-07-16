/**
 * Tool ハンドラ群 + ディスパッチ用 Map
 *
 * 新しいツールを追加するときは:
 *   1. handleXxx 関数を実装
 *   2. 下の toolHandlers に 1 行追加
 * だけでよい。引数検査は validation.ts に集約。
 */

import { buildPdf } from '../services/builder.js';
import {
  addAnnotation,
  addBookmarks,
  addWatermark,
  attachFileToPdf,
  deletePages,
  extractPages,
  fillForm,
  flattenForm,
  mergePdfs,
  reorderPages,
  rotatePages,
  setMetadata,
  splitPdf,
  stampPageNumbers,
} from '../services/editor.js';
import { hasNonLatin1 } from '../services/layout.js';
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
  validateAddAnnotationArgs,
  validateAddBookmarksArgs,
  validateAddWatermarkArgs,
  validateAttachFileArgs,
  validateCreateMarkdownArgs,
  validateCreateTableArgs,
  validateCreateTextArgs,
  validateDeletePagesArgs,
  validateExtractPagesArgs,
  validateFillFormArgs,
  validateFlattenFormArgs,
  validateMergePdfsArgs,
  validateReorderPagesArgs,
  validateRotatePagesArgs,
  validateSetMetadataArgs,
  validateSplitPdfArgs,
  validateStampPageNumbersArgs,
} from '../utils/validation.js';

export async function handleCreateTextPdf(args: unknown): Promise<CreateResult> {
  validateCreateTextArgs(args);
  return buildPdf(args, [args.text], (engine, loaded, [text]) => renderText(engine, text, loaded));
}

export async function handleCreateMarkdownPdf(args: unknown): Promise<CreateResult> {
  validateCreateMarkdownArgs(args);
  return buildPdf(args, [args.markdown], (engine, loaded, [markdown]) =>
    renderMarkdown(engine, markdown, loaded),
  );
}

export async function handleCreateTablePdf(args: unknown): Promise<CreateResult> {
  validateCreateTableArgs(args);
  // ポリシー適用のためセルを平坦化して渡し、render 内で元の形に戻す
  const cells = [...args.headers, ...args.rows.flat()];
  return buildPdf(args, cells, (engine, loaded, texts) => {
    // 表は標準フォントで日本語不可のため、描画前に検査（判定は layout の hasNonLatin1 に統一）
    if (loaded.isStandard && hasNonLatin1(texts.join('\n'))) {
      throw new Error(
        'The table contains non-Latin characters (e.g. Japanese) but no embeddable font was provided. ' +
          'Pass "fontPath" pointing to a .ttf/.otf font, or set PDF_WRITER_FONT.',
      );
    }
    const headers = texts.slice(0, args.headers.length);
    const rows: string[][] = [];
    let i = args.headers.length;
    for (const row of args.rows) {
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
  validateSetMetadataArgs(args);
  return setMetadata(args);
}

export async function handleMergePdfs(args: unknown): Promise<EditResult> {
  validateMergePdfsArgs(args);
  return mergePdfs(args.inputPaths, args);
}

export async function handleSplitPdf(args: unknown): Promise<SplitResult> {
  validateSplitPdfArgs(args);
  return splitPdf(args.inputPath, args.ranges, args.outputDir, args.prefix, args);
}

export async function handleExtractPages(args: unknown): Promise<EditResult> {
  validateExtractPagesArgs(args);
  return extractPages(args.inputPath, args.pages, args);
}

export async function handleDeletePages(args: unknown): Promise<EditResult> {
  validateDeletePagesArgs(args);
  return deletePages(args.inputPath, args.pages, args);
}

export async function handleReorderPages(args: unknown): Promise<EditResult> {
  validateReorderPagesArgs(args);
  return reorderPages(args.inputPath, args.order, args);
}

export async function handleRotatePages(args: unknown): Promise<EditResult> {
  validateRotatePagesArgs(args);
  return rotatePages(args.inputPath, args.rotation, args.pages, args);
}

export async function handleAddBookmarks(args: unknown): Promise<EditResult> {
  validateAddBookmarksArgs(args);
  return addBookmarks(args);
}

export async function handleAddAnnotation(args: unknown): Promise<EditResult> {
  validateAddAnnotationArgs(args);
  return addAnnotation(args);
}

export async function handleAttachFile(args: unknown): Promise<AttachResult> {
  validateAttachFileArgs(args);
  return attachFileToPdf(args);
}

export async function handleStampPageNumbers(args: unknown): Promise<StampResult> {
  validateStampPageNumbersArgs(args);
  return stampPageNumbers(args);
}

export async function handleAddWatermark(args: unknown): Promise<WatermarkResult> {
  validateAddWatermarkArgs(args);
  return addWatermark(args);
}

export async function handleFillForm(args: unknown): Promise<FormResult> {
  validateFillFormArgs(args);
  return fillForm(args);
}

export async function handleFlattenForm(args: unknown): Promise<FormResult> {
  validateFlattenFormArgs(args);
  return flattenForm(args);
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
