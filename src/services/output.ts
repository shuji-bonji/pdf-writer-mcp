/**
 * Output
 * PDF のメタデータ付与・保存・base64 化を共通化する。
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { PDFDocument, SaveOptions } from 'pdf-lib';
import { documentDate, PACKAGE_INFO } from '../config.js';
import type {
  CommonCreateOptions,
  CommonEditOptions,
  CreateResult,
  EditResult,
} from '../types/index.js';
import { logger } from '../utils/logger.js';
import { normalizeEmbeddedFonts } from './font-conformance.js';
import {
  DEFAULT_PDF_VERSION,
  type PdfVersion,
  patchHeaderVersion,
  trimInfoForPdf20,
} from './pdf-version.js';
import { ensureFileIdentifier } from './pdfa-conformance.js';
import { setXmpMetadata } from './xmp.js';

/**
 * 編集済み PDF の保存・base64 化。
 * create 系の finalizePdf と異なり、既存メタデータ（Title/Producer/CreationDate 等）を
 * 尊重し、ModificationDate のみ更新する。
 *
 * saveOptions は pdf-lib の save() にそのまま渡す。フォーム系ツールは
 * `{ updateFieldAppearances: false }` を渡すこと（既定の true だと pdf-lib が
 * 標準フォント Helvetica で外観を作り直し、日本語の値が WinAnsi で落ちる）。
 */
/** `saveEdited` の追加指示。既定では何もしない（既存の呼び出しは無変更） */
export interface SaveEditedExtras {
  /**
   * `save()` の直前に走るフック。**ModDate の更新より後でなければ意味が無い処理**をここに置く
   * （B-20 = PDF/A-4 の Info 削除。先に消しても `setModificationDate` が作り直してしまう）。
   */
  beforeSave?: (doc: PDFDocument) => void;
  /**
   * 保存後にヘッダへ焼き込む版。pdf-lib は常に `%PDF-1.7` を書くので、
   * 2.0 を名乗らせる経路はここしかない（`services/pdf-version.ts`）。
   */
  targetVersion?: PdfVersion;
}

export async function saveEdited(
  doc: PDFDocument,
  opts: CommonEditOptions,
  saveOptions?: SaveOptions,
  extras: SaveEditedExtras = {},
): Promise<EditResult> {
  doc.setModificationDate(documentDate(doc));

  // B-14: 編集系でもフォントを埋める経路がある（stamp_page_numbers / add_watermark）
  await normalizeEmbeddedFonts(doc);

  extras.beforeSave?.(doc);

  const saved = await doc.save(saveOptions);
  const bytes =
    extras.targetVersion === undefined || extras.targetVersion === '1.7'
      ? saved
      : patchHeaderVersion(saved, extras.targetVersion);
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
  const version = opts.pdfVersion ?? DEFAULT_PDF_VERSION;
  const producer = `${PACKAGE_INFO.name}/${PACKAGE_INFO.version}`;
  const now = documentDate(doc);

  if (version === '2.0') {
    // B-16。順序に意味がある: ①メタデータの置き場所を XMP に移す → ②Info を日付 2 つに削る
    // → ③/ID を作る（②の後でないと、消えるキーを混ぜて digest を取ることになる）。
    // 版そのものの宣言（ヘッダ）は save の後（pdf-lib が context.header を見ないため）

    // §14.3.3: Info で document level metadata を表すのは PDF 2.0 で非推奨。
    // **XMP を先に書くのが必須**で、書かずに Info だけ削ると題名がどこにも残らない
    setXmpMetadata(doc, {
      title: opts.title,
      author: opts.author,
      producer,
      lang: opts.lang,
    });
    doc.setCreationDate(now);
    doc.setModificationDate(now);
    trimInfoForPdf20(doc);

    // Table 15: /ID は PDF 2.0 で Required。E-6（SOURCE_DATE_EPOCH）下でも決定論的
    ensureFileIdentifier(doc);
  } else {
    if (opts.title) doc.setTitle(opts.title);
    if (opts.author) doc.setAuthor(opts.author);
    doc.setProducer(producer);
    doc.setCreationDate(now);
    doc.setModificationDate(now);
  }

  // B-14: pdf-lib が書いたフォント辞書を条文に合わせて是正する（save の直前に置くこと。
  // pdf-lib はフォントを flush 時に初めて context へ書き出すため）
  await normalizeEmbeddedFonts(doc);

  const saved = await doc.save();
  // pdf-lib は保存時に `%PDF-1.7` を決め打ちで書く（context.header を見ない）ので、
  // 版の宣言はここで入れる。1.7 のときは何も起きない
  const bytes = version === '1.7' ? saved : patchHeaderVersion(saved, version);

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
