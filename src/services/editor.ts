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
import { basename, extname, join, resolve } from 'node:path';
import { degrees, PDFDocument } from 'pdf-lib';
import { LIMITS, STAMP_DEFAULTS, WATERMARK_DEFAULTS } from '../constants.js';
import type {
  AddAnnotationArgs,
  AddBookmarksArgs,
  AddWatermarkArgs,
  AttachFileArgs,
  AttachResult,
  CommonEditOptions,
  EditResult,
  SetMetadataArgs,
  SplitResult,
  StampPageNumbersArgs,
  StampResult,
  WatermarkResult,
} from '../types/index.js';
import { logger } from '../utils/logger.js';
import { parsePageSpec } from '../utils/page-spec.js';
import { addAnnotation as addAnnotationDict, parseHexColor } from './annotation.js';
import { attachFile, listEmbeddedFiles } from './attachment.js';
import { applyMissingGlyphPolicy, embedFontFor, openFont } from './font-manager.js';
import { countBookmarks, setBookmarks } from './outline.js';
import { saveEdited } from './output.js';
import { formatPageNumber, stampPage } from './page-number.js';
import { assertRenderable } from './renderers/text.js';
import { appendAnnotationToStructTree, isTagged, markArtifactOnPage } from './struct-append.js';
import { watermarkPage } from './watermark.js';

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
  opts: CommonEditOptions,
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
        '(Signature-preserving incremental update is a future Tier C feature.)',
    );
  }

  let doc: PDFDocument;
  try {
    // updateMetadata: false — 読込時に Producer/ModDate を書き換えない
    doc = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (e) {
    throw new Error(
      `Failed to parse PDF "${absPath}" (encrypted or corrupted?): ${e instanceof Error ? e.message : String(e)}`,
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
    pages1.map((n) => n - 1),
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
  opts: CommonEditOptions,
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
  opts: CommonEditOptions,
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

export async function addBookmarks(args: AddBookmarksArgs): Promise<EditResult> {
  const total = countBookmarks(args.bookmarks);
  if (total > LIMITS.BOOKMARK_MAX_TOTAL) {
    throw new Error(`too many bookmarks (${total}, max ${LIMITS.BOOKMARK_MAX_TOTAL})`);
  }
  const { doc } = await loadForEdit(args.inputPath, args);
  const added = setBookmarks(doc, args.bookmarks);
  logger.info('Editor', `Set ${added} bookmark(s)`);
  return saveEdited(doc, args);
}

export async function addAnnotation(args: AddAnnotationArgs): Promise<EditResult> {
  const { doc } = await loadForEdit(args.inputPath, args);
  const added = addAnnotationDict(doc, args);

  // タグ付き PDF なら構造木にも結び付ける（PDF/UA 7.18.1-1 / 7.18.3-1）。
  // タグ無し文書では何もしない — 注釈のためだけに構造木を作り始めない。
  const warnings: string[] = [];
  const linked = appendAnnotationToStructTree(doc, added.page, added.ref, args.alt);
  if (linked.tagged && !args.alt) {
    warnings.push(
      'The document is tagged and the annotation was nested in an Annot structure element. ' +
        'Pass "alt" to give assistive technology a description of it.',
    );
  }

  const result = await saveEdited(doc, args);
  if (warnings.length > 0) result.warnings = warnings;
  return result;
}

export async function attachFileToPdf(args: AttachFileArgs): Promise<AttachResult> {
  const { doc } = await loadForEdit(args.inputPath, args);
  const attached = await attachFile(doc, {
    filePath: args.attachmentPath,
    name: args.name,
    description: args.description,
    mimeType: args.mimeType,
    relationship: args.relationship,
  });

  const warnings: string[] = [];
  if (!args.relationship) {
    warnings.push(
      'No "relationship" given, so the attachment is marked Unspecified. ' +
        'PDF/A-3 requires a meaningful AFRelationship — use "Data" for machine-readable ' +
        'counterparts of the document (e.g. an invoice CSV/XML) or "Source" for the data it came from.',
    );
  }

  logger.info(
    'Editor',
    `Attached ${attached.name} (${attached.bytes} bytes, ${attached.mimeType})`,
  );
  const saved = await saveEdited(doc, args);
  return {
    ...saved,
    warnings: warnings.length > 0 ? warnings : undefined,
    attachment: attached,
    attachments: listEmbeddedFiles(doc).map((f) => f.name),
  };
}

export async function stampPageNumbers(args: StampPageNumbersArgs): Promise<StampResult> {
  const { doc } = await loadForEdit(args.inputPath, args);
  const total = doc.getPageCount();

  const format = args.format ?? STAMP_DEFAULTS.format;
  const position = args.position ?? STAMP_DEFAULTS.position;
  const margin = args.margin ?? STAMP_DEFAULTS.margin;
  const fontSize = args.fontSize ?? STAMP_DEFAULTS.fontSize;
  const startAt = args.startAt ?? STAMP_DEFAULTS.startAt;
  const color = parseHexColor(args.color ?? STAMP_DEFAULTS.color);

  const targets = args.pages
    ? parsePageSpec(args.pages, total)
    : Array.from({ length: total }, (_, i) => i + 1);

  // 刻むテキストを先に確定させる。フォントのサブセットは「実際に描く文字」に依存するため
  // （ADR-7/8）、番号を振り終えてから埋め込む必要がある。
  const stamps = targets.map((pageNo, i) => ({
    page: doc.getPage(pageNo - 1),
    text: formatPageNumber(format, startAt + i, total),
  }));

  const source = await openFont(args.fontPath);
  const texts = stamps.map((s) => s.text);
  for (const t of texts) assertRenderable(t, source);
  const applied = applyMissingGlyphPolicy(texts, source, 'error');
  const loaded = await embedFontFor(doc, source, applied.texts);

  const tagged = isTagged(doc);
  for (const [i, stamp] of stamps.entries()) {
    stampPage(stamp.page, applied.texts[i], {
      font: loaded.font,
      fontSize,
      color,
      position,
      margin,
      // タグ付き PDF ではページ番号を Artifact にする（PDF/UA 7.1-3）
      markArtifact: tagged ? (page, draw) => markArtifactOnPage(doc, page, draw) : undefined,
    });
  }

  logger.info(
    'Editor',
    `Stamped ${stamps.length} page(s)${tagged ? ' as artifacts (tagged PDF)' : ''}`,
  );
  const saved = await saveEdited(doc, args);
  return { ...saved, stamped: stamps.length, artifact: tagged };
}

export async function addWatermark(args: AddWatermarkArgs): Promise<WatermarkResult> {
  const { doc } = await loadForEdit(args.inputPath, args);
  const total = doc.getPageCount();

  const fontSize = args.fontSize ?? WATERMARK_DEFAULTS.fontSize;
  const opacity = args.opacity ?? WATERMARK_DEFAULTS.opacity;
  const angle = args.angle ?? WATERMARK_DEFAULTS.angle;
  const behind = args.behind ?? WATERMARK_DEFAULTS.behind;
  const color = parseHexColor(args.color ?? WATERMARK_DEFAULTS.color);

  const targets = args.pages
    ? parsePageSpec(args.pages, total)
    : Array.from({ length: total }, (_, i) => i + 1);

  // 透かし文字も create 系と同じ font-manager を通す（harfbuzz サブセット・グリフ検査）
  const source = await openFont(args.fontPath);
  assertRenderable(args.text, source);
  const applied = applyMissingGlyphPolicy([args.text], source, 'error');
  const loaded = await embedFontFor(doc, source, applied.texts);

  const tagged = isTagged(doc);
  for (const pageNo of targets) {
    watermarkPage(doc.getPage(pageNo - 1), applied.texts[0], {
      font: loaded.font,
      fontSize,
      color,
      opacity,
      angle,
      behind,
      // タグ付き PDF では透かしを Artifact にする（PDF/UA 7.1-3）
      markArtifact: tagged ? (page, draw) => markArtifactOnPage(doc, page, draw) : undefined,
    });
  }

  logger.info(
    'Editor',
    `Watermarked ${targets.length} page(s)${behind ? ' behind content' : ''}${tagged ? ' as artifacts' : ''}`,
  );
  const saved = await saveEdited(doc, args);
  return { ...saved, watermarked: targets.length, artifact: tagged };
}

export async function splitPdf(
  inputPath: string,
  ranges: string[],
  outputDir: string,
  prefix: string | undefined,
  opts: CommonEditOptions,
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
