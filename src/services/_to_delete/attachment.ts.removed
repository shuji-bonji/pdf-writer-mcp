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

import { readFile, stat } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import {
  AFRelationship,
  PDFArray,
  PDFDict,
  type PDFDocument,
  PDFName,
  type PDFObject,
} from 'pdf-lib';
import { ENV_KEYS, outputDate } from '../config.js';
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
 * 添付の /Params に入れる日時を決める（SPEC-AUDIT Phase 3）。
 *
 * ISO 32000-2 Table 45 は **埋め込まれたファイル自身**の日時を求めている:
 *   - `ModDate`（AF では**必須**）: "The date and time when the embedded file was last modified"
 *   - `CreationDate`: "The date and time when the embedded file was created"
 * §14.13.2（R-14.13.2-2・shall）はさらに明示的で、「ModDate の値は**ソースファイルの
 * 最終更新日時**でなければならない」と言う。
 *
 * v0.12.0 まで両方に `outputDate()`（＝ PDF の生成時刻）を焼き込んでいた。これは
 * 「この CSV は PDF を作った瞬間に作られ更新された」という**嘘**であり、電帳法・PDF/A-3 の
 * 文脈では添付データの更新日時そのものが証跡になるため実害がある。
 *
 * **E-6（決定論）との緊張**: ソースの mtime を使うと、同じ内容でも checkout のたびに
 * バイト列が変わる（git は mtime を保存しない）。`SOURCE_DATE_EPOCH` は
 * 「再現性を正確さより優先する」という**明示的な opt-in** なので、設定時は固定値で上書きする。
 * reproducible-builds.org の慣習は min(mtime, epoch) の clamp だが、それだと
 * mtime < epoch のとき出力が checkout 依存のままになり、本サーバが約束している
 * 「同一入力 → 同一バイト列」（config.ts の SOURCE_DATE_EPOCH の記述）を守れない。
 */
async function attachmentDates(
  absPath: string,
): Promise<{ creationDate: Date; modificationDate: Date }> {
  if (process.env[ENV_KEYS.SOURCE_DATE_EPOCH]) {
    // 決定論モード: 正確さより再現性（呼び出し側が明示的に選んでいる）
    const fixed = outputDate();
    return { creationDate: fixed, modificationDate: fixed };
  }
  const stats = await stat(absPath);
  // birthtime はファイルシステムによっては 0 や mtime を返す。信用できないときは mtime で代用
  const birth = stats.birthtime;
  const usableBirth = birth instanceof Date && birth.getTime() > 0 ? birth : stats.mtime;
  return { creationDate: usableBirth, modificationDate: stats.mtime };
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

  // Table 45 / §14.13.2: /Params の日時は「埋め込むファイル自身」のもの（SPEC-AUDIT Phase 3）。
  // SOURCE_DATE_EPOCH 設定時のみ固定値で上書きする（E-6・attachmentDates のコメント参照）
  const dates = await attachmentDates(abs);
  await doc.attach(bytes, name, {
    mimeType,
    description: options.description,
    afRelationship: toAFRelationship(relationship),
    ...dates,
  });

  // §7.9.6: 名前ツリーのキーは辞書順でなければならない（shall）。
  // pdf-lib の attach は「保存時まで実体化しない遅延埋め込み」かつ挿入順で追記するため、
  // flush() で名前ツリーを実体化してから並べ直す（SPEC-AUDIT Phase 1 で実測・是正）
  await doc.flush();
  sortEmbeddedFileNames(doc);

  return { name, bytes: bytes.length, mimeType, relationship };
}

/** /Names /EmbeddedFiles の名前ツリー（平坦な /Names 配列）をキーの辞書順に並べ直す */
function sortEmbeddedFileNames(doc: PDFDocument): void {
  const names = doc.catalog.lookup(PDFName.of('Names'));
  if (!(names instanceof PDFDict)) return;
  const ef = names.lookup(PDFName.of('EmbeddedFiles'));
  if (!(ef instanceof PDFDict)) return;
  const arr = ef.lookup(PDFName.of('Names'));
  if (!(arr instanceof PDFArray)) return;

  const pairs: Array<{ key: string; k: PDFObject; v: PDFObject }> = [];
  for (let i = 0; i + 1 < arr.size(); i += 2) {
    pairs.push({
      key: decodeName(arr.lookup(i)) ?? '',
      k: arr.get(i),
      v: arr.get(i + 1),
    });
  }
  pairs.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  while (arr.size() > 0) arr.remove(arr.size() - 1);
  for (const p of pairs) {
    arr.push(p.k);
    arr.push(p.v);
  }
}
