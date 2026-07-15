/**
 * Output
 * PDF のメタデータ付与・保存・base64 化を共通化する。
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import type { PDFDocument } from 'pdf-lib';
import { PACKAGE_INFO } from '../config.js';
import type { CommonCreateOptions, CreateResult } from '../types/index.js';
import { logger } from '../utils/logger.js';

export async function finalizePdf(
  doc: PDFDocument,
  opts: CommonCreateOptions,
  fontName: string
): Promise<CreateResult> {
  if (opts.title) doc.setTitle(opts.title);
  if (opts.author) doc.setAuthor(opts.author);
  doc.setProducer(`${PACKAGE_INFO.name}/${PACKAGE_INFO.version}`);
  doc.setCreationDate(new Date());
  doc.setModificationDate(new Date());

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
