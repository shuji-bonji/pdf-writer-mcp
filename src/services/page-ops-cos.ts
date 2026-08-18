/**
 * ページ操作 5 本（merge / split / extract / delete / reorder）—— Phase 3 の L4′.2。
 *
 * 旧実装は `page-ops.ts`（pdf-lib の `copyPages`）。**5 本すべてが同じ受け皿を通る**ので
 * まとめて移した。1 本だけ移すと `doc-level.ts` が 2 つの器で二重に存在する（§3.25.4）。
 *
 * B-10a: 5 本は文書レベルのオブジェクトを運ばない。引き継ぎ自体は B-10b/c の課題だが、
 * **黙って落とさない**ことは守る —— 入力にあって出力に無いものを警告で報告する。
 *
 * 🔴 **出力の版は入力に合わせる（§7.5.2）。** 旧実装は pdf-lib の `create()` が書く
 * `%PDF-1.7` に固定されていた。PDF 2.0 の入力を抜き出すと実効版が下がる ——
 * `rotate_pages`（§3.11.3）や `add_annotation`（§3.23.3）と同じ欠陥である。
 */

import { basename, extname, join } from 'node:path';
import { PdfDocumentEditor } from 'normativepdf';
import { documentDate } from '../config.js';
import { LIMITS } from '../constants.js';
import { invalidArg } from '../errors.js';
import type { CommonEditOptions, EditResult, SplitResult } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { parsePageSpec } from '../utils/page-spec.js';
import { textString } from './cos.js';
import { type CopyContext, copyPagesInto, newCopyContext } from './cos-copy.js';
import { textOf } from './cos-read.js';
import {
  type CatalogView,
  carryDocumentLevel,
  catalogView,
  type DocLevelSurvey,
  docLevelLossWarnings,
  firstWinsWarning,
  mergeSurveys,
  surveyDocLevel,
  usesOptionalContent,
} from './doc-level.js';
import { type OpenedForEdit, openForEdit } from './edit-open.js';
import { setInfoEntries } from './info-dict.js';
import { saveRawBytes } from './output-edited.js';
import { touchModDate } from './output-edited.js';

/** 基本メタデータを src から dst へ引き継ぐ（ページの複写は文書情報を運ばない） */
async function copyDocumentInfo(from: PdfDocumentEditor, to: PdfDocumentEditor): Promise<void> {
  const source = await readInfo(from);
  if (source === undefined) return;
  const entries: Array<readonly [string, ReturnType<typeof textString> | undefined]> = [];
  for (const key of ['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer'] as const) {
    const value = source.get(key);
    entries.push([key, value === undefined ? undefined : textString(value)]);
  }
  // `/CreationDate` は**元の文書の作成日時**であって、この操作の時刻ではない
  const created = source.get('CreationDate');
  entries.push(['CreationDate', created === undefined ? undefined : textString(created)]);
  await setInfoEntries(to, entries);
}

async function readInfo(editor: PdfDocumentEditor): Promise<Map<string, string> | undefined> {
  const trailer = editor.trailer();
  const raw = trailer.entries.get('Info');
  if (raw === undefined) return undefined;
  const info = await editor.resolve(raw);
  if (info.kind !== 'dict') return undefined;
  const out = new Map<string, string>();
  for (const [key, value] of info.entries) {
    const text = textOf(await editor.resolve(value));
    if (text !== undefined) out.set(key, text);
  }
  return out;
}

/** 入力の指定ページだけを持つ新しい文書を作る。 */
async function copyIntoNewDoc(
  opened: OpenedForEdit,
  pages1: number[],
): Promise<{ to: PdfDocumentEditor; ctx: CopyContext; warnings: string[] }> {
  // §7.5.2: 出力の版は入力に合わせる。既定の 1.7 に落とすと実効版が下がる
  const to = PdfDocumentEditor.create({ version: opened.editor.base.headerVersion });
  const ctx = newCopyContext(opened.editor, to);
  await copyPagesInto(ctx, pages1);
  await copyDocumentInfo(opened.editor, to);
  const carry = await carryDocumentLevel(ctx);
  return { to, ctx, warnings: carry.warnings };
}

/** 保存し、入力にあった文書レベル要素が出力で失われていれば warnings に載せる（B-10a）。 */
async function saveWithDocLevelWarnings(
  to: PdfDocumentEditor,
  opts: CommonEditOptions,
  tool: string,
  before: DocLevelSurvey,
  carryWarnings: string[] = [],
): Promise<EditResult> {
  const warnings = [...carryWarnings, ...(await lossWarnings(tool, before, to))];
  // §14.3.3 Table 349: `/ModDate` は「この文書が最後に変更された日時」。
  // ページを選び直した出力はここで生まれるので、書く前に入れる
  await touchModDate(to, documentDate(to));
  const bytes = await to.save();
  const result = await saveRawBytes(bytes, (await to.pages()).length, opts);
  if (warnings.length > 0) {
    logger.info('PageOps', `${tool}: document-level info was not carried over (see warnings)`);
    result.warnings = [...(result.warnings ?? []), ...warnings];
  }
  return result;
}

async function lossWarnings(
  tool: string,
  before: DocLevelSurvey,
  to: PdfDocumentEditor,
): Promise<string[]> {
  const after: CatalogView = await catalogView(to);
  return docLevelLossWarnings({
    tool,
    before,
    after,
    afterUsesOptionalContent: await usesOptionalContent(to),
  });
}

export async function mergePdfs(
  inputPaths: string[],
  opts: CommonEditOptions,
): Promise<EditResult> {
  let to: PdfDocumentEditor | null = null;
  const surveys: DocLevelSurvey[] = [];
  const carryWarnings: string[] = [];

  for (const path of inputPaths) {
    const opened = await openForEdit(path, opts);
    if (to === null) {
      // 版は**先頭の入力**に合わせる（先勝ちの一部）
      to = PdfDocumentEditor.create({ version: opened.editor.base.headerVersion });
    }
    surveys.push(surveyDocLevel(await catalogView(opened.editor)));

    const ctx = newCopyContext(opened.editor, to);
    const pages = await opened.editor.pages();
    await copyPagesInto(
      ctx,
      pages.map((_, index) => index + 1),
    );

    // B-10b: 文書レベルの引き継ぎは**先勝ち**。採らなかったものはここで報告する ——
    // `docLevelLossWarnings` は「その機能が出力にあるか」しか見ないので、
    // 入力 1 の添付さえ運ばれていれば入力 2 の添付が消えても黙ってしまう
    const carry = await carryDocumentLevel(ctx);
    for (const warning of carry.warnings) {
      if (!carryWarnings.includes(warning)) carryWarnings.push(warning);
    }
    if (carry.skipped.length > 0) {
      carryWarnings.push(firstWinsWarning('merge_pdfs', carry.skipped, `"${path}"`));
    }
    if (surveys.length === 1) await copyDocumentInfo(opened.editor, to);
  }

  if (to === null) throw invalidArg('merge_pdfs needs at least one input');
  logger.info('PageOps', `Merged ${inputPaths.length} PDFs (${(await to.pages()).length} pages)`);
  return saveWithDocLevelWarnings(to, opts, 'merge_pdfs', mergeSurveys(surveys), carryWarnings);
}

export async function extractPages(
  inputPath: string,
  pages: string,
  opts: CommonEditOptions,
): Promise<EditResult> {
  const opened = await openForEdit(inputPath, opts);
  const total = (await opened.editor.pages()).length;
  const pageNums = parsePageSpec(pages, total);
  const before = surveyDocLevel(await catalogView(opened.editor));
  const { to, warnings } = await copyIntoNewDoc(opened, pageNums);
  return saveWithDocLevelWarnings(to, opts, 'extract_pages', before, warnings);
}

export async function deletePages(
  inputPath: string,
  pages: string,
  opts: CommonEditOptions,
): Promise<EditResult> {
  const opened = await openForEdit(inputPath, opts);
  const total = (await opened.editor.pages()).length;
  const del = new Set(parsePageSpec(pages, total));
  if (del.size >= total) {
    throw invalidArg(`Cannot delete all ${total} page(s) — the result would be an empty PDF`);
  }
  const keep: number[] = [];
  for (let n = 1; n <= total; n += 1) if (!del.has(n)) keep.push(n);
  const before = surveyDocLevel(await catalogView(opened.editor));
  const { to, warnings } = await copyIntoNewDoc(opened, keep);
  return saveWithDocLevelWarnings(to, opts, 'delete_pages', before, warnings);
}

export async function reorderPages(
  inputPath: string,
  order: number[],
  opts: CommonEditOptions,
): Promise<EditResult> {
  const opened = await openForEdit(inputPath, opts);
  const total = (await opened.editor.pages()).length;
  if (order.length !== total) {
    throw invalidArg(`order must list all ${total} page(s) exactly once, got ${order.length}`);
  }
  const seen = new Set<number>();
  for (const n of order) {
    if (!Number.isInteger(n) || n < 1 || n > total) {
      throw invalidArg(`order contains an invalid page number ${n} (1..${total})`);
    }
    if (seen.has(n)) throw invalidArg(`order contains page ${n} more than once`);
    seen.add(n);
  }
  const before = surveyDocLevel(await catalogView(opened.editor));
  const { to, warnings } = await copyIntoNewDoc(opened, order);
  return saveWithDocLevelWarnings(to, opts, 'reorder_pages', before, warnings);
}

export async function splitPdf(
  inputPath: string,
  ranges: string[],
  outputDir: string,
  prefix: string | undefined,
  opts: CommonEditOptions,
): Promise<SplitResult> {
  if (ranges.length > LIMITS.SPLIT_MAX_PARTS) {
    throw invalidArg(`Too many split parts (${ranges.length}, max ${LIMITS.SPLIT_MAX_PARTS})`);
  }
  const opened = await openForEdit(inputPath, opts);
  const total = (await opened.editor.pages()).length;
  const base = prefix ?? `${basename(opened.absPath, extname(opened.absPath))}-part`;
  const before = surveyDocLevel(await catalogView(opened.editor));

  const files: SplitResult['files'] = [];
  // 全パートが同じ入力から出るので損失も同じ。最初のパートで測り、結果全体に 1 度だけ載せる
  let warnings: string[] = [];
  for (const [index, range] of ranges.entries()) {
    const pageNums = parsePageSpec(range, total, `ranges[${index}]`);
    const { to, warnings: carry } = await copyIntoNewDoc(opened, pageNums);
    if (index === 0) {
      warnings = [...carry, ...(await lossWarnings('split_pdf', before, to))];
    }
    const outputPath = join(outputDir, `${base}${index + 1}.pdf`);
    await touchModDate(to, documentDate(to));
    const saved = await saveRawBytes(await to.save(), (await to.pages()).length, { outputPath });
    files.push({ path: saved.path as string, pageCount: saved.pageCount, bytes: saved.bytes });
  }
  logger.info('PageOps', `Split "${opened.absPath}" into ${files.length} file(s)`);
  return {
    files,
    count: files.length,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}
