/**
 * Page Operations
 * ページ単位の編集（merge / split / extract / delete / reorder / rotate）。
 *
 * editor.ts から切り出したモジュール。読込（loadForEdit: 署名ガード・
 * サイズ上限込み）と保存（saveEdited）は editor.ts / output.ts の共通処理を
 * そのまま使い、ここは「ページの選択とコピー」だけに責務を絞る。
 *
 * B-10a: `copyPages()` を使う 5 ツール（merge / split / extract / delete / reorder）は
 * 文書レベルのオブジェクトを運ばない（services/doc-level.ts の冒頭を参照）。
 * 引き継ぎ自体は B-10b/c の課題だが、**黙って落とさない**ことだけは先に守る。
 * rotate は in-place なので catalog が丸ごと残り、この問題は起きない。
 */

import { basename, extname, join } from 'node:path';
import { degrees, PDFDocument } from 'pdf-lib';
import { LIMITS } from '../constants.js';
import { invalidArg } from '../errors.js';
import type { CommonEditOptions, EditResult, SplitResult } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { parsePageSpec } from '../utils/page-spec.js';
import {
  type DocLevelSurvey,
  docLevelLossWarnings,
  mergeSurveys,
  surveyDocLevel,
} from './doc-level.js';
import { loadForEdit } from './editor.js';
import { saveEdited } from './output.js';

/** 基本メタデータを src から dst へ引き継ぐ（copyPages は文書情報を運ばないため） */
function copyDocumentInfo(src: PDFDocument, dst: PDFDocument): void {
  const title = src.getTitle();
  const author = src.getAuthor();
  const subject = src.getSubject();
  const keywords = src.getKeywords();
  const creator = src.getCreator();
  const producer = src.getProducer();
  const creationDate = src.getCreationDate();
  if (title !== undefined) dst.setTitle(title);
  if (author !== undefined) dst.setAuthor(author);
  if (subject !== undefined) dst.setSubject(subject);
  if (keywords !== undefined) dst.setKeywords([keywords]);
  if (creator !== undefined) dst.setCreator(creator);
  if (producer !== undefined) dst.setProducer(producer);
  if (creationDate !== undefined) dst.setCreationDate(creationDate);
}

/** src の指定ページ（1 始まり配列・指定順）だけを持つ新規文書を作る */
async function copyIntoNewDoc(src: PDFDocument, pages1: number[]): Promise<PDFDocument> {
  const dst = await PDFDocument.create();
  const copied = await dst.copyPages(
    src,
    pages1.map((n) => n - 1),
  );
  for (const p of copied) dst.addPage(p);
  copyDocumentInfo(src, dst);
  return dst;
}

/**
 * 保存し、入力にあった文書レベル要素が出力で失われていれば warnings に載せる（B-10a）。
 * 判定は出力の実測なので、引き継ぎを実装したものは自動的に報告されなくなる。
 */
async function saveWithDocLevelWarnings(
  dst: PDFDocument,
  opts: CommonEditOptions,
  tool: string,
  before: DocLevelSurvey,
): Promise<EditResult> {
  const warnings = docLevelLossWarnings({ tool, before, after: dst });
  const result = await saveEdited(dst, opts);
  if (warnings.length > 0) {
    logger.info('PageOps', `${tool}: document-level info was not carried over (see warnings)`);
    result.warnings = [...(result.warnings ?? []), ...warnings];
  }
  return result;
}

export async function mergePdfs(
  inputPaths: string[],
  opts: CommonEditOptions,
): Promise<EditResult> {
  const dst = await PDFDocument.create();
  // 文書情報の引き継ぎ元（先頭ファイル）はループ内で読んだ doc を再利用する
  let first: PDFDocument | null = null;
  // 採取だけ持ち回る（doc を全部抱えるとメモリを食うため）
  const surveys: DocLevelSurvey[] = [];
  for (const p of inputPaths) {
    const { doc: src } = await loadForEdit(p, opts);
    if (first === null) first = src;
    surveys.push(surveyDocLevel(src));
    const copied = await dst.copyPages(src, src.getPageIndices());
    for (const page of copied) dst.addPage(page);
  }
  if (first !== null) copyDocumentInfo(first, dst);
  logger.info('PageOps', `Merged ${inputPaths.length} PDFs (${dst.getPageCount()} pages)`);
  return saveWithDocLevelWarnings(dst, opts, 'merge_pdfs', mergeSurveys(surveys));
}

export async function extractPages(
  inputPath: string,
  pages: string,
  opts: CommonEditOptions,
): Promise<EditResult> {
  const { doc: src } = await loadForEdit(inputPath, opts);
  const pageNums = parsePageSpec(pages, src.getPageCount());
  const before = surveyDocLevel(src);
  const dst = await copyIntoNewDoc(src, pageNums);
  return saveWithDocLevelWarnings(dst, opts, 'extract_pages', before);
}

export async function deletePages(
  inputPath: string,
  pages: string,
  opts: CommonEditOptions,
): Promise<EditResult> {
  const { doc: src } = await loadForEdit(inputPath, opts);
  const total = src.getPageCount();
  const del = new Set(parsePageSpec(pages, total));
  if (del.size >= total) {
    throw invalidArg(`Cannot delete all ${total} page(s) — the result would be an empty PDF`);
  }
  const keep: number[] = [];
  for (let n = 1; n <= total; n++) if (!del.has(n)) keep.push(n);
  const before = surveyDocLevel(src);
  const dst = await copyIntoNewDoc(src, keep);
  return saveWithDocLevelWarnings(dst, opts, 'delete_pages', before);
}

export async function reorderPages(
  inputPath: string,
  order: number[],
  opts: CommonEditOptions,
): Promise<EditResult> {
  const { doc: src } = await loadForEdit(inputPath, opts);
  const total = src.getPageCount();
  if (order.length !== total) {
    throw invalidArg(`order must list all ${total} page(s) exactly once, got ${order.length}`);
  }
  const seen = new Set<number>();
  for (const n of order) {
    if (!Number.isInteger(n) || n < 1 || n > total) {
      throw invalidArg(`order contains an invalid page number ${n} (1..${total})`);
    }
    if (seen.has(n)) {
      throw invalidArg(`order contains page ${n} more than once`);
    }
    seen.add(n);
  }
  const before = surveyDocLevel(src);
  const dst = await copyIntoNewDoc(src, order);
  return saveWithDocLevelWarnings(dst, opts, 'reorder_pages', before);
}

export async function rotatePages(
  inputPath: string,
  rotation: number,
  pages: string | undefined,
  opts: CommonEditOptions,
): Promise<EditResult> {
  const { doc } = await loadForEdit(inputPath, opts);
  const targets = pages
    ? parsePageSpec(pages, doc.getPageCount())
    : Array.from({ length: doc.getPageCount() }, (_, i) => i + 1);
  for (const n of targets) {
    const page = doc.getPage(n - 1);
    const current = page.getRotation().angle;
    page.setRotation(degrees((((current + rotation) % 360) + 360) % 360));
  }
  return saveEdited(doc, opts);
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
  const { doc: src, absPath } = await loadForEdit(inputPath, opts);
  const total = src.getPageCount();
  const base = prefix ?? `${basename(absPath, extname(absPath))}-part`;
  const before = surveyDocLevel(src);

  const files: SplitResult['files'] = [];
  // 全パートが同じ入力から出るので損失も同じ。最初のパートで測り、結果全体に 1 度だけ載せる
  let warnings: string[] = [];
  for (const [i, range] of ranges.entries()) {
    const pageNums = parsePageSpec(range, total, `ranges[${i}]`);
    const dst = await copyIntoNewDoc(src, pageNums);
    if (i === 0) {
      warnings = docLevelLossWarnings({ tool: 'split_pdf', before, after: dst });
    }
    const outputPath = join(outputDir, `${base}${i + 1}.pdf`);
    const saved = await saveEdited(dst, { outputPath });
    files.push({ path: saved.path as string, pageCount: saved.pageCount, bytes: saved.bytes });
  }
  logger.info('PageOps', `Split "${absPath}" into ${files.length} file(s)`);
  return {
    files,
    count: files.length,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}
