/**
 * Page Operations
 * ページ単位の編集（merge / split / extract / delete / reorder / rotate）。
 *
 * editor.ts から切り出したモジュール。読込（loadForEdit: 署名ガード・
 * サイズ上限込み）と保存（saveEdited）は editor.ts / output.ts の共通処理を
 * そのまま使い、ここは「ページの選択とコピー」だけに責務を絞る。
 */

import { basename, extname, join } from 'node:path';
import { degrees, PDFDocument } from 'pdf-lib';
import { LIMITS } from '../constants.js';
import { invalidArg } from '../errors.js';
import type { CommonEditOptions, EditResult, SplitResult } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { parsePageSpec } from '../utils/page-spec.js';
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

export async function mergePdfs(
  inputPaths: string[],
  opts: CommonEditOptions,
): Promise<EditResult> {
  const dst = await PDFDocument.create();
  // 文書情報の引き継ぎ元（先頭ファイル）はループ内で読んだ doc を再利用する
  let first: PDFDocument | null = null;
  for (const p of inputPaths) {
    const { doc: src } = await loadForEdit(p, opts);
    if (first === null) first = src;
    const copied = await dst.copyPages(src, src.getPageIndices());
    for (const page of copied) dst.addPage(page);
  }
  if (first !== null) copyDocumentInfo(first, dst);
  logger.info('PageOps', `Merged ${inputPaths.length} PDFs (${dst.getPageCount()} pages)`);
  return saveEdited(dst, opts);
}

export async function extractPages(
  inputPath: string,
  pages: string,
  opts: CommonEditOptions,
): Promise<EditResult> {
  const { doc: src } = await loadForEdit(inputPath, opts);
  const pageNums = parsePageSpec(pages, src.getPageCount());
  const dst = await copyIntoNewDoc(src, pageNums);
  return saveEdited(dst, opts);
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
  const dst = await copyIntoNewDoc(src, keep);
  return saveEdited(dst, opts);
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
  const dst = await copyIntoNewDoc(src, order);
  return saveEdited(dst, opts);
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

  const files: SplitResult['files'] = [];
  for (const [i, range] of ranges.entries()) {
    const pageNums = parsePageSpec(range, total, `ranges[${i}]`);
    const dst = await copyIntoNewDoc(src, pageNums);
    const outputPath = join(outputDir, `${base}${i + 1}.pdf`);
    const saved = await saveEdited(dst, { outputPath });
    files.push({ path: saved.path as string, pageCount: saved.pageCount, bytes: saved.bytes });
  }
  logger.info('PageOps', `Split "${absPath}" into ${files.length} file(s)`);
  return { files, count: files.length };
}
