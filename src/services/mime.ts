/**
 * 添付ファイルの MIME 型を拡張子から推す —— Phase 3 の L4′.3。
 *
 * `attachment.ts`（pdf-lib 版）から取り出した。§7.11.3 Table 45 の `/Subtype` は
 * MIME 型（RFC 2046）を名前として書くので、書く側が決める必要がある。
 * 拡張子からの推定は仕様の要求ではなく writer の便宜である。
 */

import { extname } from 'node:path';

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
