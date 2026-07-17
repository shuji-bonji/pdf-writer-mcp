/**
 * Output
 * PDF のメタデータ付与・保存・base64 化を共通化する。
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { PDFDocument, SaveOptions } from 'pdf-lib';
import { outputDate, PACKAGE_INFO } from '../config.js';
import type {
  CommonCreateOptions,
  CommonEditOptions,
  CreateResult,
  EditResult,
} from '../types/index.js';
import { logger } from '../utils/logger.js';

/**
 * 編集済み PDF の保存・base64 化。
 * create 系の finalizePdf と異なり、既存メタデータ（Title/Producer/CreationDate 等）を
 * 尊重し、ModificationDate のみ更新する。
 *
 * saveOptions は pdf-lib の save() にそのまま渡す。フォーム系ツールは
 * `{ updateFieldAppearances: false }` を渡すこと（既定の true だと pdf-lib が
 * 標準フォント Helvetica で外観を作り直し、日本語の値が WinAnsi で落ちる）。
 */
export async function saveEdited(
  doc: PDFDocument,
  opts: CommonEditOptions,
  saveOptions?: SaveOptions,
): Promise<EditResult> {
  doc.setModificationDate(outputDate());

  const bytes = await doc.save(saveOptions);
  const result: EditResult = {
    pageCount: doc.getPageCount(),
    bytes: bytes.length,
  };

  if (opts.outputPath) {
    const abs = resolve(opts.outputPath);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, bytes);
    result.path = abs;
    logger.info('Output', `Saved PDF: ${abs} (${bytes.length} bytes, ${result.pageCount} pages)`);
  }

  if (opts.returnBase64 || !opts.outputPath) {
    result.base64 = Buffer.from(bytes).toString('base64');
  }

  return result;
}

/**
 * 事前に組み立て済みのバイト列（増分更新など doc.save() を通せないもの）の
 * 保存・base64 化。saveEdited と同じ出力規約に従う。
 */
export async function saveRawBytes(
  bytes: Uint8Array,
  pageCount: number,
  opts: CommonEditOptions,
): Promise<EditResult> {
  const result: EditResult = { pageCount, bytes: bytes.length };

  if (opts.outputPath) {
    const abs = resolve(opts.outputPath);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, bytes);
    result.path = abs;
    logger.info('Output', `Saved PDF: ${abs} (${bytes.length} bytes, ${pageCount} pages)`);
  }

  if (opts.returnBase64 || !opts.outputPath) {
    result.base64 = Buffer.from(bytes).toString('base64');
  }

  return result;
}

export async function finalizePdf(
  doc: PDFDocument,
  opts: CommonCreateOptions,
  fontName: string,
): Promise<CreateResult> {
  if (opts.title) doc.setTitle(opts.title);
  if (opts.author) doc.setAuthor(opts.author);
  doc.setProducer(`${PACKAGE_INFO.name}/${PACKAGE_INFO.version}`);
  const now = outputDate();
  doc.setCreationDate(now);
  doc.setModificationDate(now);

  const bytes = await doc.save();

  const result: CreateResult = {
    pageCount: doc.getPageCount(),
    bytes: bytes.length,
    font: fontName,
  };

  if (opts.outputPath) {
    const abs = resolve(opts.outputPath);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, bytes);
    result.path = abs;
    logger.info('Output', `Saved PDF: ${abs} (${bytes.length} bytes, ${result.pageCount} pages)`);
  }

  // 保存先がない場合、または明示要求時は base64 で返す
  if (opts.returnBase64 || !opts.outputPath) {
    result.base64 = Buffer.from(bytes).toString('base64');
  }

  return result;
}
