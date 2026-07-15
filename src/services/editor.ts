/**
 * Editor
 * 既存 PDF の編集（Tier A: メタデータ・ページ操作）を担う。
 *
 * create 系（builder → font → layout → renderer）とはフローが異なり、
 *   読込（loadForEdit: 署名ガード込み）→ 操作 → 保存（saveEdited）
 * の 3 段で完結する。
 *
 * 署名保全について（specs/05 §3-1）:
 *   pdf-lib の save() はファイル全体を再構築するため、既存の電子署名は必ず無効化される。
 *   署名（/ByteRange）を検知した場合は既定でエラーとし、明示フラグ
 *   allowBreakingSignatures: true があるときのみ続行する。
 *   署名を保持する増分更新（incremental_save）は Tier C の課題。
 */

import { readFile } from 'node:fs/promises';
import { resolve, basename, extname, join } from 'node:path';
import { PDFDocument, degrees } from 'pdf-lib';
import { LIMITS } from '../constants.js';
import type {
  CommonEditOptions,
  EditResult,
  SetMetadataArgs,
  SplitResult,
} from '../types/index.js';
import { logger } from '../utils/logger.js';
import { parsePageSpec } from '../utils/page-spec.js';
import { saveEdited } from './output.js';

/** 入力バイト列に電子署名（/ByteRange）が含まれるかの軽量検査 */
export function containsSignature(bytes: Uint8Array): boolean {
  // "/ByteRange" の ASCII 検索（署名辞書は非圧縮で現れるのが通例）
  const needle = [0x2f, 0x42, 0x79, 0x74, 0x65, 0x52, 0x61, 0x6e, 0x67, 0x65]; // "/ByteRange"
  outer: for (let i = 0; i <= bytes.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (bytes[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

/** PDF を読み込み、署名ガードを通す */
async function loadForEdit(
  filePath: string,
  opts: CommonEditOptions
): Promise<{ doc: PDFDocument; absPath: string }> {
  const absPath = resolve(filePath);
  let bytes: Uint8Array;
  try {
    bytes = await readFile(absPath);
  } catch {
    throw new Error(`Cannot read PDF file: ${absPath}`);
  }

  if (containsSignature(bytes) && !opts.allowBreakingSignatures) {
    throw new Error(
      `"${absPath}" appears to be digitally signed (/ByteRange found). ` +
        'Editing will invalidate existing signatures because pdf-lib rewrites the whole file. ' +
        'Pass "allowBreakingSignatures": true to proceed anyway. ' +
        '(Signature-preserving incremental update is a future Tier C feature.)'
    );
  }

  let doc: PDFDocument;
  try {
    // updateMetadata: false — 読込時に Producer/ModDate を書き換えない
    doc = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (e) {
    throw new Error(
      `Failed to parse PDF "${absPath}" (encrypted or corrupted?): ${e instanceof Error ? e.message : String(e)}`
    );
  }
  return { doc, absPath };
}

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
    pages1.map((n) => n - 1)
  );
  for (const p of copied) dst.addPage(p);
  copyDocumentInfo(src, dst);
  return dst;
}

// ---------------------------------------------------------------------------
// Tier A ツール本体
// ---------------------------------------------------------------------------

export async function setMetadata(args: SetMetadataArgs): Promise<EditResult> {
  const { doc } = await loadForEdit(args.inputPath, args);
  if (args.title !== undefined) doc.setTitle(args.title);
  if (args.author !== undefined) doc.setAuthor(args.author);
  if (args.subject !== undefined) doc.setSubject(args.subject);
  if (args.keywords !== undefined) doc.setKeywords(args.keywords);
  if (args.creator !== undefined) doc.setCreator(args.creator);
  return saveEdited(doc, args);
}

export async function mergePdfs(
  inputPaths: string[],
  opts: CommonEditOptions
): Promise<EditResult> {
  const dst = await PDFDocument.create();
  for (const p of inputPaths) {
    const { doc: src } = await loadForEdit(p, opts);
    const copied = await dst.copyPages(src, src.getPageIndices());
    for (const page of copied) dst.addPage(page);
  }
  // 文書情報は先頭ファイルから引き継ぐ
  const { doc: first } = await loadForEdit(inputPaths[0], opts);
  copyDocumentInfo(first, dst);
  logger.info('Editor', `Merged ${inputPaths.length} PDFs (${dst.getPageCount()} pages)`);
  return saveEdited(dst, opts);
}

export async function extractPages(
  inputPath: string,
  pages: string,
  opts: CommonEditOptions
): Promise<EditResult> {
  const { doc: src } = await loadForEdit(inputPath, opts);
  const pageNums = parsePageSpec(pages, src.getPageCount());
  const dst = await copyIntoNewDoc(src, pageNums);
  return saveEdited(dst, opts);
}

export async function deletePages(
  inputPath: string,
  pages: string,
  opts: CommonEditOptions
): Promise<EditResult> {
  const { doc: src } = await loadForEdit(inputPath, opts);
  const total = src.getPageCount();
  const del = new Set(parsePageSpec(pages, total));
  if (del.size >= total) {
    throw new Error(`Cannot delete all ${total} page(s) — the result would be an empty PDF`);
  }
  const keep: number[] = [];
  for (let n = 1; n <= total; n++) if (!del.has(n)) keep.push(n);
  const dst = await copyIntoNewDoc(src, keep);
  return saveEdited(dst, opts);
}

export async function reorderPages(
  inputPath: string,
  order: number[],
  opts: CommonEditOptions
): Promise<EditResult> {
  const { doc: src } = await loadForEdit(inputPath, opts);
  const total = src.getPageCount();
  if (order.length !== total) {
    throw new Error(`order must list all ${total} page(s) exactly once, got ${order.length}`);
  }
  const seen = new Set<number>();
  for (const n of order) {
    if (!Number.isInteger(n) || n < 1 || n > total) {
      throw new Error(`order contains an invalid page number ${n} (1..${total})`);
    }
    if (seen.has(n)) {
      throw new Error(`order contains page ${n} more than once`);
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
  opts: CommonEditOptions
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
  opts: CommonEditOptions
): Promise<SplitResult> {
  if (ranges.length > LIMITS.SPLIT_MAX_PARTS) {
    throw new Error(`Too many split parts (${ranges.length}, max ${LIMITS.SPLIT_MAX_PARTS})`);
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
  logger.info('Editor', `Split "${absPath}" into ${files.length} file(s)`);
  return { files, count: files.length };
}
