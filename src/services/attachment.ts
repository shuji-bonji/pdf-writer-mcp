/**
 * Embedded files (attachments)
 *
 * PDF に別ファイルを埋め込む（ISO 32000-1 §7.11.4 / §14.13）。
 * pdf-lib の `doc.attach()` が /Names /EmbeddedFiles・catalog /AF・/UF・/Params まで
 * 書いてくれるため、本モジュールは
 *   - 入力の検証（存在・サイズ・重複名）
 *   - MIME 型の推定
 *   - AFRelationship の既定値と用途の説明
 *   - 既存の添付一覧の読み取り
 * を担う。
 *
 * PDF/A-3（ISO 19005-3）と電子帳簿保存法の文脈:
 *   PDF/A-3 は任意形式のファイルを埋め込める唯一の PDF/A 部で、
 *   「人が読む請求書（PDF）＋機械可読データ（CSV/XML）」を 1 ファイルに束ねる用途に使う。
 *   その際 /AFRelationship は必須で、機械可読データなら Data、
 *   元データなら Source を指定する（§6.8）。
 */

import { readFile } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { AFRelationship, PDFArray, PDFDict, type PDFDocument, PDFName } from 'pdf-lib';
import { LIMITS } from '../constants.js';
import type { AttachmentRelationship } from '../types/index.js';

/** 拡張子 → MIME 型（電帳法・請求まわりで実際に使うものに絞る） */
const MIME_TYPES: Record<string, string> = {
  '.csv': 'text/csv',
  '.xml': 'application/xml',
  '.json': 'application/json',
  '.txt': 'text/plain',
  '.pdf': 'application/pdf',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword',
  '.zip': 'application/zip',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.html': 'text/html',
};

const DEFAULT_MIME = 'application/octet-stream';

export function guessMimeType(fileName: string): string {
  return MIME_TYPES[extname(fileName).toLowerCase()] ?? DEFAULT_MIME;
}

/** pdf-lib の AFRelationship へ変換する */
function toAFRelationship(rel: AttachmentRelationship): AFRelationship {
  switch (rel) {
    case 'Source':
      return AFRelationship.Source;
    case 'Data':
      return AFRelationship.Data;
    case 'Alternative':
      return AFRelationship.Alternative;
    case 'Supplement':
      return AFRelationship.Supplement;
    default:
      return AFRelationship.Unspecified;
  }
}

export interface EmbeddedFileInfo {
  name: string;
  description?: string;
  relationship?: string;
  mimeType?: string;
}

/** 既に埋め込まれているファイルの一覧を返す */
export function listEmbeddedFiles(doc: PDFDocument): EmbeddedFileInfo[] {
  const names = doc.catalog.lookup(PDFName.of('Names'));
  if (!(names instanceof PDFDict)) return [];
  const ef = names.lookup(PDFName.of('EmbeddedFiles'));
  if (!(ef instanceof PDFDict)) return [];
  const arr = ef.lookup(PDFName.of('Names'));
  if (!(arr instanceof PDFArray)) return [];

  const out: EmbeddedFileInfo[] = [];
  // 名前ツリーの /Names は [name1, spec1, name2, spec2, ...]
  for (let i = 0; i + 1 < arr.size(); i += 2) {
    const nameObj = arr.lookup(i);
    const spec = arr.lookup(i + 1);
    const name = decodeName(nameObj);
    if (name === null) continue;

    const info: EmbeddedFileInfo = { name };
    if (spec instanceof PDFDict) {
      const desc = spec.lookup(PDFName.of('Desc'));
      const decoded = decodeName(desc);
      if (decoded) info.description = decoded;
      const rel = spec.lookup(PDFName.of('AFRelationship'));
      if (rel instanceof PDFName) info.relationship = rel.decodeText();
      const efDict = spec.lookup(PDFName.of('EF'));
      if (efDict instanceof PDFDict) {
        const stream = efDict.get(PDFName.of('F'));
        const resolved = stream ? doc.context.lookup(stream) : undefined;
        const subtype =
          resolved && 'dict' in resolved
            ? (resolved as { dict: PDFDict }).dict.get(PDFName.of('Subtype'))
            : undefined;
        if (subtype instanceof PDFName) info.mimeType = subtype.decodeText();
      }
    }
    out.push(info);
  }
  return out;
}

/** PDFString / PDFHexString のいずれでもテキストとして読む */
function decodeName(value: unknown): string | null {
  if (value && typeof value === 'object' && 'decodeText' in value) {
    return (value as { decodeText(): string }).decodeText();
  }
  return null;
}

export interface AttachFileOptions {
  /** 埋め込むファイルのパス */
  filePath: string;
  /** PDF 内での表示名。省略時は元のファイル名 */
  name?: string;
  /** 説明（/Desc） */
  description?: string;
  /** MIME 型。省略時は拡張子から推定 */
  mimeType?: string;
  /** PDF/A-3 §6.8 の関係。既定 Unspecified */
  relationship?: AttachmentRelationship;
}

export interface AttachedFile {
  name: string;
  bytes: number;
  mimeType: string;
  relationship: string;
}

/**
 * ファイルを PDF に埋め込む。
 * 同名の添付が既にある場合はエラー（名前ツリーのキーは一意であるべき）。
 */
export async function attachFile(
  doc: PDFDocument,
  options: AttachFileOptions,
): Promise<AttachedFile> {
  const abs = resolve(options.filePath);
  let bytes: Uint8Array;
  try {
    bytes = await readFile(abs);
  } catch {
    throw new Error(`Cannot read the file to attach: ${abs}`);
  }
  if (bytes.length > LIMITS.ATTACHMENT_MAX_BYTES) {
    throw new Error(
      `Attachment is too large (${bytes.length} bytes, max ${LIMITS.ATTACHMENT_MAX_BYTES})`,
    );
  }

  const name = options.name ?? basename(abs);
  if (name.trim() === '') {
    throw new Error('name must not be empty');
  }
  const existing = listEmbeddedFiles(doc);
  if (existing.some((f) => f.name === name)) {
    throw new Error(
      `An attachment named "${name}" already exists in this PDF. Pass a different "name".`,
    );
  }

  const mimeType = options.mimeType ?? guessMimeType(name);
  const relationship = options.relationship ?? 'Unspecified';

  const stat = { creationDate: new Date(), modificationDate: new Date() };
  await doc.attach(bytes, name, {
    mimeType,
    description: options.description,
    afRelationship: toAFRelationship(relationship),
    ...stat,
  });

  return { name, bytes: bytes.length, mimeType, relationship };
}
