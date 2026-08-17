/**
 * 埋め込みファイル（§7.11.4 / §14.13）を COS の上で書く —— Phase 3 の L4′.2。
 *
 * 旧実装は `attachment.ts` の `attachFile`（pdf-lib の `doc.attach` に委ねていた）。
 * **器だけを変えた**もので、書く辞書の形は同じである。
 *
 * | 要件 | 何を言っているか |
 * |---|---|
 * | Table 43（§7.11.3） | ファイル指定辞書は `/Type /Filespec`、`/F`（ファイル指定文字列）、`/UF`（テキスト文字列） |
 * | Table 44 | `/EF` の `/F` が埋め込みファイルストリーム |
 * | Table 45（§7.11.4.2） | 埋め込みファイルストリームは `/Type /EmbeddedFile`、`/Subtype` は MIME 型の名前、`/Params` に `/Size` と日時 |
 * | §7.9.6 | 名前ツリーの鍵は**辞書順**でなければならない（shall） |
 * | §14.13 | `/AF`（associated files）で文書に結び付ける |
 *
 * ⚠️ **添付の中身は非圧縮で書く。** 旧実装（pdf-lib）は FlateDecode を掛けていたが、
 * normativepdf は書き側 Flate を拒む（ADR-0003 §4）。`/Filter` は任意（§7.3.8.2）で、
 * 埋め込みファイルの圧縮を求める条文は無い。
 */

import { readFile, stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import {
  COS_NULL,
  type CosDict,
  type CosObject,
  dictGet,
  dictGetRaw,
  type PdfDocumentEditor,
} from 'normativepdf';
import { ENV_KEYS, outputDate } from '../config.js';
import { LIMITS } from '../constants.js';
import { PdfWriterError } from '../errors.js';
import type { AttachmentRelationship } from '../types/index.js';
import { arr, dict, int, name, stream, textString } from './cos.js';
import { textOf } from './cos-read.js';
import { guessMimeType } from './attachment.js';
import { pdfDate } from './pdf-date.js';

export interface EmbeddedFileInfo {
  name: string;
  description?: string;
  relationship?: string;
  mimeType?: string;
}

export interface AttachFileOptions {
  filePath: string;
  name?: string;
  description?: string;
  mimeType?: string;
  relationship?: AttachmentRelationship;
}

export interface AttachedFile {
  name: string;
  bytes: number;
  mimeType: string;
  relationship: AttachmentRelationship;
}

const RELATIONSHIPS: Record<AttachmentRelationship, string> = {
  Source: 'Source',
  Data: 'Data',
  Alternative: 'Alternative',
  Supplement: 'Supplement',
  Unspecified: 'Unspecified',
};

async function readCatalog(editor: PdfDocumentEditor): Promise<CosDict> {
  const rootRaw = dictGetRaw(editor.trailer(), 'Root');
  const catalog = rootRaw === undefined ? COS_NULL : await editor.resolve(rootRaw);
  if (catalog.kind !== 'dict') {
    throw new PdfWriterError('/Root does not resolve to the catalog dictionary', 'INVALID_PDF');
  }
  return catalog;
}

async function updateCatalog(
  editor: PdfDocumentEditor,
  mutate: (entries: Map<string, CosObject>) => void,
): Promise<void> {
  const rootRaw = dictGetRaw(editor.trailer(), 'Root');
  if (rootRaw === undefined) {
    throw new PdfWriterError('the trailer has no /Root (§7.5.5 Table 15)', 'INVALID_PDF');
  }
  const catalog = await readCatalog(editor);
  const entries = new Map<string, CosObject>(catalog.entries);
  mutate(entries);
  if (rootRaw.kind === 'ref') {
    editor.set(rootRaw.objectNumber, { kind: 'dict', entries }, rootRaw.generationNumber);
  } else {
    editor.setTrailerEntry('Root', { kind: 'dict', entries });
  }
}

/** `/Names /EmbeddedFiles /Names`（平坦な名前ツリー）を読む。 */
async function embeddedFileNames(editor: PdfDocumentEditor): Promise<readonly CosObject[]> {
  const catalog = await readCatalog(editor);
  const names = await editor.resolve(dictGet(catalog, 'Names') ?? COS_NULL);
  if (names.kind !== 'dict') return [];
  const ef = await editor.resolve(dictGet(names, 'EmbeddedFiles') ?? COS_NULL);
  if (ef.kind !== 'dict') return [];
  const list = await editor.resolve(dictGet(ef, 'Names') ?? COS_NULL);
  return list.kind === 'array' ? list.items : [];
}

/** 埋め込まれているファイルを列挙する（名前・説明・関係・MIME 型）。 */
export async function listEmbeddedFiles(
  editor: PdfDocumentEditor,
): Promise<EmbeddedFileInfo[]> {
  const items = await embeddedFileNames(editor);
  const out: EmbeddedFileInfo[] = [];

  // 名前ツリーの `/Names` は [name1, spec1, name2, spec2, …]
  for (let i = 0; i + 1 < items.length; i += 2) {
    const key = textOf(await editor.resolve(items[i] as CosObject));
    if (key === undefined) continue;
    const info: EmbeddedFileInfo = { name: key };

    const spec = await editor.resolve(items[i + 1] as CosObject);
    if (spec.kind === 'dict') {
      const desc = textOf(await editor.resolve(dictGet(spec, 'Desc') ?? COS_NULL));
      if (desc !== undefined && desc !== '') info.description = desc;
      const rel = dictGet(spec, 'AFRelationship');
      if (rel?.kind === 'name') info.relationship = rel.value;
      const ef = await editor.resolve(dictGet(spec, 'EF') ?? COS_NULL);
      if (ef.kind === 'dict') {
        const file = await editor.resolve(dictGet(ef, 'F') ?? COS_NULL);
        if (file.kind === 'stream') {
          const subtype = dictGet(file.dict, 'Subtype');
          if (subtype?.kind === 'name') info.mimeType = subtype.value;
        }
      }
    }
    out.push(info);
  }
  return out;
}

/**
 * `/Params` の日時（Table 45）。
 *
 * **埋め込むファイル自身**の日時を書く。PDF を作った時刻を書くのは
 * 「この CSV は PDF を作った瞬間に作られた」という嘘であり、電帳法・PDF/A-3 の
 * 文脈では添付データの日時そのものが証跡になる。
 * `SOURCE_DATE_EPOCH`（E-6）が設定されているときだけ、再現性を優先して固定値で上書きする。
 */
async function attachmentDates(absPath: string): Promise<{ creation: Date; modification: Date }> {
  if (process.env[ENV_KEYS.SOURCE_DATE_EPOCH]) {
    const fixed = outputDate();
    return { creation: fixed, modification: fixed };
  }
  const stats = await stat(absPath);
  // birthtime はファイルシステムによっては 0 や mtime を返す。信用できないときは mtime で代用
  const birth = stats.birthtime;
  const usableBirth = birth instanceof Date && birth.getTime() > 0 ? birth : stats.mtime;
  return { creation: usableBirth, modification: stats.mtime };
}

/**
 * ファイルを PDF に埋め込む。同名の添付が既にあれば断る（名前ツリーの鍵は一意）。
 */
export async function attachFile(
  editor: PdfDocumentEditor,
  options: AttachFileOptions,
): Promise<AttachedFile> {
  const abs = resolve(options.filePath);
  let bytes: Uint8Array;
  try {
    bytes = await readFile(abs);
  } catch {
    throw new PdfWriterError(`Cannot read the file to attach: ${abs}`, 'INVALID_ARGUMENT');
  }
  if (bytes.length > LIMITS.ATTACHMENT_MAX_BYTES) {
    throw new PdfWriterError(
      `Attachment is too large (${bytes.length} bytes, max ${LIMITS.ATTACHMENT_MAX_BYTES})`,
      'INVALID_ARGUMENT',
    );
  }

  const fileName = options.name ?? basename(abs);
  if (fileName.trim() === '') {
    throw new PdfWriterError('name must not be empty', 'INVALID_ARGUMENT');
  }
  const existing = await listEmbeddedFiles(editor);
  if (existing.some((f) => f.name === fileName)) {
    throw new PdfWriterError(
      `An attachment named "${fileName}" already exists in this PDF. Pass a different "name".`,
      'INVALID_ARGUMENT',
    );
  }

  const mimeType = options.mimeType ?? guessMimeType(fileName);
  const relationship = options.relationship ?? 'Unspecified';
  const dates = await attachmentDates(abs);

  // Table 45: 埋め込みファイルストリーム。`/Subtype` は MIME 型を名前にしたもの
  const fileStream = await editor.allocate(
    stream(
      [
        ['Type', name('EmbeddedFile')],
        ['Subtype', name(mimeType)],
        [
          'Params',
          dict([
            ['Size', int(bytes.length)],
            ['CreationDate', textString(pdfDate(dates.creation))],
            ['ModDate', textString(pdfDate(dates.modification))],
          ]),
        ],
      ],
      bytes,
    ),
  );

  // Table 43 / Table 44: ファイル指定辞書
  const spec = await editor.allocate(
    dict([
      ['Type', name('Filespec')],
      ['F', textString(fileName)],
      ['UF', textString(fileName)],
      ['EF', dict([['F', fileStream]])],
      ...(options.description !== undefined && options.description !== ''
        ? ([['Desc', textString(options.description)]] as const)
        : []),
      ['AFRelationship', name(RELATIONSHIPS[relationship])],
    ]),
  );

  // 名前ツリーへ挿す。**鍵の辞書順を保つ**（§7.9.6・shall）
  const items = [...(await embeddedFileNames(editor))];
  const pairs: Array<{ key: string; k: CosObject; v: CosObject }> = [];
  for (let i = 0; i + 1 < items.length; i += 2) {
    pairs.push({
      key: textOf(await editor.resolve(items[i] as CosObject)) ?? '',
      k: items[i] as CosObject,
      v: items[i + 1] as CosObject,
    });
  }
  pairs.push({ key: fileName, k: textString(fileName), v: spec });
  pairs.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const flat: CosObject[] = [];
  for (const pair of pairs) flat.push(pair.k, pair.v);

  const catalog = await readCatalog(editor);
  const namesRaw = dictGetRaw(catalog, 'Names');
  const namesDict = namesRaw === undefined ? COS_NULL : await editor.resolve(namesRaw);
  const efRaw = namesDict.kind === 'dict' ? dictGetRaw(namesDict, 'EmbeddedFiles') : undefined;
  const efDict = efRaw === undefined ? COS_NULL : await editor.resolve(efRaw);

  const updatedEf: CosDict = {
    kind: 'dict',
    entries: new Map<string, CosObject>(
      efDict.kind === 'dict' ? [...efDict.entries, ['Names', arr(flat)]] : [['Names', arr(flat)]],
    ),
  };

  if (efRaw !== undefined && efRaw.kind === 'ref') {
    editor.set(efRaw.objectNumber, updatedEf, efRaw.generationNumber);
  } else if (namesRaw !== undefined && namesRaw.kind === 'ref' && namesDict.kind === 'dict') {
    const entries = new Map<string, CosObject>(namesDict.entries);
    entries.set('EmbeddedFiles', updatedEf);
    editor.set(namesRaw.objectNumber, { kind: 'dict', entries }, namesRaw.generationNumber);
  } else {
    const entries = new Map<string, CosObject>(
      namesDict.kind === 'dict' ? namesDict.entries : [],
    );
    entries.set('EmbeddedFiles', updatedEf);
    await updateCatalog(editor, (catalogEntries) => {
      catalogEntries.set('Names', { kind: 'dict', entries });
    });
  }

  // §14.13: `/AF` で文書に結び付ける
  const afRaw = dictGetRaw(catalog, 'AF');
  const af = afRaw === undefined ? COS_NULL : await editor.resolve(afRaw);
  const afItems = af.kind === 'array' ? [...af.items, spec] : [spec];
  if (afRaw !== undefined && afRaw.kind === 'ref' && af.kind === 'array') {
    editor.set(afRaw.objectNumber, arr(afItems), afRaw.generationNumber);
  } else {
    await updateCatalog(editor, (entries) => {
      entries.set('AF', arr(afItems));
    });
  }

  return { name: fileName, bytes: bytes.length, mimeType, relationship };
}
