/**
 * Tool ハンドラ群 + ディスパッチ用 Map
 *
 * 新しいツールを追加するときは:
 *   1. handleXxx 関数を実装
 *   2. 下の toolHandlers に 1 行追加
 * だけでよい。引数検査は validation.ts に集約。
 */

import type { CreateResult, EditResult, SplitResult } from '../types/index.js';
import {
  validateCreateTextArgs,
  validateCreateMarkdownArgs,
  validateCreateTableArgs,
  validateSetMetadataArgs,
  validateMergePdfsArgs,
  validateSplitPdfArgs,
  validateExtractPagesArgs,
  validateDeletePagesArgs,
  validateReorderPagesArgs,
  validateRotatePagesArgs,
} from '../utils/validation.js';
import { buildPdf } from '../services/builder.js';
import { renderText } from '../services/renderers/text.js';
import { renderMarkdown } from '../services/renderers/markdown.js';
import { renderTable } from '../services/renderers/table.js';
import {
  setMetadata,
  mergePdfs,
  splitPdf,
  extractPages,
  deletePages,
  reorderPages,
  rotatePages,
} from '../services/editor.js';

export async function handleCreateTextPdf(args: unknown): Promise<CreateResult> {
  validateCreateTextArgs(args);
  return buildPdf(args, (engine, loaded) => renderText(engine, args.text, loaded));
}

export async function handleCreateMarkdownPdf(args: unknown): Promise<CreateResult> {
  validateCreateMarkdownArgs(args);
  return buildPdf(args, (engine, loaded) => renderMarkdown(engine, args.markdown, loaded));
}

export async function handleCreateTablePdf(args: unknown): Promise<CreateResult> {
  validateCreateTableArgs(args);
  return buildPdf(args, (engine, loaded) => {
    // 表は標準フォントで日本語不可のため、描画前に検査
    const flat = [...args.headers, ...args.rows.flat()].join('\n');
    if (loaded.isStandard && /[^\x00-\xff]/.test(flat)) {
      throw new Error(
        'The table contains non-Latin characters (e.g. Japanese) but no embeddable font was provided. ' +
          'Pass "fontPath" pointing to a .ttf/.otf font, or set PDF_WRITER_FONT.'
      );
    }
    renderTable(engine, args.headers, args.rows);
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

/**
 * Tool ハンドラの Map（引数型は各ハンドラ側で検査するため any を許容）
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
};
