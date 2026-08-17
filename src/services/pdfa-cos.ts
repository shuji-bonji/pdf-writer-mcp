/**
 * PDF/A の「宣言」を COS の上で書く —— Phase 3 の L4′.2。
 *
 * 旧実装は `pdfa-conformance.ts`（291 行・pdf-lib）。**器だけを変えた**もので、
 * 本ツールが作るのは**宣言**だけであり適合を保証しない、という位置づけは同じである
 * （`specs/09 §4`「宣言 / 適合 / 検証は別物」。判定は veraPDF = `pdf-verify-mcp`）。
 *
 * | 要件 | 何を言っているか |
 * |---|---|
 * | R-14.4-7 / -8 | `/ID` は 2 要素の配列。第 1 要素は**作成時に決まり以後変わらない** |
 * | R-14.4-11 | 最初に書くときは 2 要素を同値にする |
 * | Table 365（§14.11.5） | OutputIntent の `S` は PDF/A では `GTS_PDFA1`。`OutputConditionIdentifier` は必須 |
 * | PDF/A-4 6.1.3-4 / -5 | 文書情報辞書を持たないこと。`/PieceInfo` があるときだけ `/ModDate` のみ残す（T2） |
 *
 * ⚠️ **ICC プロファイルは非圧縮で書く。** 旧実装は Flate で書いていたが、
 * normativepdf は書き側 Flate を拒む（ADR-0003 §4）。実測 548 バイトで、
 * `/Filter` は任意（§7.3.8.2）なので条文上は問題ない。生成パスも既に非圧縮である（§3.9.1）。
 */

import { createHash } from 'node:crypto';
import {
  ByteWriter,
  COS_NULL,
  type CosDict,
  type CosObject,
  decodeStream,
  dictGet,
  dictGetRaw,
  type PdfDocumentEditor,
  writeObject,
} from 'normativepdf';
import { documentDate } from '../config.js';
import { PdfWriterError } from '../errors.js';
import { logger } from '../utils/logger.js';
import { arr, dict, hex, int, name, stream, textString } from './cos.js';
import { buildSrgbIccProfile, SRGB_CONDITION_IDENTIFIER } from './srgb-icc.js';

const CONTEXT = 'PdfaConformance';

async function readCatalog(editor: PdfDocumentEditor): Promise<CosDict> {
  const rootRaw = dictGetRaw(editor.trailer(), 'Root');
  const catalog = rootRaw === undefined ? COS_NULL : await editor.resolve(rootRaw);
  if (catalog.kind !== 'dict') {
    throw new PdfWriterError('/Root does not resolve to the catalog dictionary', 'INVALID_PDF');
  }
  return catalog;
}

/** catalog を読んで書き戻す（`/Root` が間接参照でも直接辞書でも同じ形で扱う）。 */
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

/** COS の値を PDF の書き方でバイト列にする（ダイジェストの材料に使う）。 */
function bytesOf(object: CosObject): Uint8Array {
  const out = new ByteWriter();
  writeObject(out, object);
  return out.toUint8Array();
}

/**
 * トレーラの `/ID`（§14.4）を用意する。既に 2 要素あるなら**触らない**。
 *
 * 第 2 要素の更新は増分更新側の責務（`incremental-append.ts` の `updateFileId`）であり、
 * ここで書き換えると「最終更新時の内容」という意味がずれる。
 */
export async function ensureFileIdentifier(editor: PdfDocumentEditor): Promise<boolean> {
  const raw = dictGetRaw(editor.trailer(), 'ID');
  const existing = raw === undefined ? COS_NULL : await editor.resolve(raw);
  const items = existing.kind === 'array' ? existing.items : [];
  // 第 1 要素は permanent identifier なので保持する（R-14.4-8）
  const permanent = items[0]?.kind === 'string' ? items[0] : undefined;

  const digest = createHash('md5'); // §14.4 が例示するダイジェスト（暗号用途ではない）
  // 「現在時刻」— documentDate は 1 文書 1 回に固定される（W-5）。E-6 では固定値
  digest.update(documentDate(editor).toISOString());
  // 「Info 辞書の全エントリ値」
  const infoRaw = dictGetRaw(editor.trailer(), 'Info');
  const info = infoRaw === undefined ? COS_NULL : await editor.resolve(infoRaw);
  if (info.kind === 'dict') {
    for (const [key, value] of info.entries) {
      digest.update(key);
      digest.update(bytesOf(value));
    }
  }
  const changing = hex(new TextEncoder().encode(digest.digest('hex').toUpperCase()));

  if (permanent === undefined) {
    // 初回書き込み: 両者を同値にする（R-14.4-11）
    editor.setTrailerEntry('ID', arr([changing, changing]));
    return true;
  }
  if (items.length === 2) return false;
  // 第 1 要素だけがある等の壊れた形 — permanent を保ったまま 2 要素に整える（R-14.4-7）
  editor.setTrailerEntry('ID', arr([permanent, changing]));
  return true;
}

/**
 * sRGB の PDF/A OutputIntent を catalog に保証する（Table 365）。
 *
 * 既に `GTS_PDFA1` の OutputIntent があるなら触らない（利用者が意図して置いた可能性がある）。
 */
export async function ensureSrgbOutputIntent(editor: PdfDocumentEditor): Promise<boolean> {
  const catalog = await readCatalog(editor);
  const raw = dictGetRaw(catalog, 'OutputIntents');
  const existing = raw === undefined ? COS_NULL : await editor.resolve(raw);

  if (existing.kind === 'array') {
    for (const item of existing.items) {
      const intent = await editor.resolve(item);
      if (intent.kind !== 'dict') continue;
      const s = dictGet(intent, 'S');
      if (s?.kind === 'name' && s.value === 'GTS_PDFA1') return false;
    }
  }

  // ICC プロファイルストリーム。形式は ICCBased 色空間と同じ（Table 365 / §8.6.5.5）で、
  // `/N` は色成分数 = RGB なので 3
  const profile = await editor.allocate(stream([['N', int(3)]], buildSrgbIccProfile()));
  const intent = await editor.allocate(
    dict([
      ['Type', name('OutputIntent')],
      ['S', name('GTS_PDFA1')],
      ['OutputConditionIdentifier', textString(SRGB_CONDITION_IDENTIFIER)],
      ['Info', textString(SRGB_CONDITION_IDENTIFIER)],
      ['DestOutputProfile', profile],
    ]),
  );

  if (existing.kind === 'array' && raw !== undefined) {
    const items = [...existing.items, intent];
    if (raw.kind === 'ref') {
      editor.set(raw.objectNumber, arr(items), raw.generationNumber);
    } else {
      await updateCatalog(editor, (entries) => {
        entries.set('OutputIntents', arr(items));
      });
    }
  } else {
    await updateCatalog(editor, (entries) => {
      entries.set('OutputIntents', arr([intent]));
    });
  }
  return true;
}

export interface PdfaConformanceResult {
  added: string[];
  notes: string[];
}

/** PDF/A 化の是正をまとめて適用する（XMP の `pdfaid` は `xmp-cos.ts` の仕事）。 */
export async function normalizePdfaConformance(
  editor: PdfDocumentEditor,
): Promise<PdfaConformanceResult> {
  const result: PdfaConformanceResult = { added: [], notes: [] };

  if (await ensureFileIdentifier(editor)) {
    result.added.push('trailer /ID (file identifier)');
    logger.debug(CONTEXT, 'Added a trailer /ID (file identifier).');
  } else {
    result.notes.push('The document already has a trailer /ID; it was left unchanged.');
  }

  if (await ensureSrgbOutputIntent(editor)) {
    result.added.push('sRGB output intent (GTS_PDFA1)');
    logger.debug(CONTEXT, 'Added an sRGB PDF/A OutputIntent (GTS_PDFA1).');
  } else {
    result.notes.push(
      'The document already declares a GTS_PDFA1 output intent; it was left unchanged.',
    );
  }

  return result;
}

/**
 * XMP に PDF/A 宣言（`pdfaid:part`）があるか。
 * **自称を見るだけで、適合しているかは分からない**（判定は veraPDF = `pdf-verify-mcp` の仕事）。
 */
export async function hasPdfaDeclaration(editor: PdfDocumentEditor): Promise<boolean> {
  const catalog = await readCatalog(editor);
  const raw = dictGetRaw(catalog, 'Metadata');
  if (raw === undefined) return false;
  const metadata = await editor.resolve(raw);
  if (metadata.kind !== 'stream') return false;
  try {
    const bytes =
      dictGet(metadata.dict, 'Filter') === undefined
        ? metadata.raw
        : await decodeStream(metadata, { resolve: (v: CosObject) => v });
    return /<pdfaid:part>/.test(new TextDecoder().decode(bytes));
  } catch {
    return false;
  }
}

/**
 * PDF/A-4 のために Info 辞書を始末する（6.1.3-4 / -5・T2）。**保存の直前に呼ぶこと。**
 *
 * `/PieceInfo` が無ければトレーラから `/Info` を**外す**。旧実装は外すだけで
 * オブジェクトを残したが、pdf-lib が到達不能オブジェクトを書かないので結果的に消えていた。
 * 新しい出口は xref にある番号をすべて書くので、**参照を外すだけでは残る** ——
 * だから番号も併せて消す。
 */
export async function stripInfoForPdfa4(editor: PdfDocumentEditor): Promise<string | null> {
  const raw = dictGetRaw(editor.trailer(), 'Info');
  if (raw === undefined || raw.kind === 'null') return null;

  const catalog = await readCatalog(editor);
  const hasPieceInfo = dictGet(catalog, 'PieceInfo') !== undefined;

  if (!hasPieceInfo) {
    editor.removeTrailerEntry('Info');
    if (raw.kind === 'ref') editor.delete(raw.objectNumber, raw.generationNumber);
    return 'removed the Info dictionary (PDF/A-4 6.1.3-4)';
  }

  const info = await editor.resolve(raw);
  if (info.kind !== 'dict') return null;
  const removed = [...info.entries.keys()].filter((key) => key !== 'ModDate');
  if (removed.length === 0) return null;

  const modDate = dictGet(info, 'ModDate');
  const kept: CosDict = {
    kind: 'dict',
    entries: new Map(modDate === undefined ? [] : [['ModDate', modDate]]),
  };
  if (raw.kind === 'ref') {
    editor.set(raw.objectNumber, kept, raw.generationNumber);
  } else {
    editor.setTrailerEntry('Info', kept);
  }
  return `reduced the Info dictionary to ModDate, because /PieceInfo requires it (PDF/A-4 6.1.3-5): removed ${removed.join(', ')}`;
}
