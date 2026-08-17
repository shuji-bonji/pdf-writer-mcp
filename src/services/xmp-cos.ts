/**
 * XMP（`/Metadata`）と Info の同期を COS の上に置いたもの —— Phase 3 の L4′.2。
 *
 * 旧実装は `xmp.ts` の `syncXmpWithInfo` / `infoCreationDateIso`（102 行）で、
 * pdf-lib の `PDFDocument` を取る。**パケットを組み立てる `buildXmpPacket`（105 行）は
 * pdf-lib に触らないので、そのまま呼ぶ。** 変えたのは器だけである。
 *
 * B-9（SPEC-AUDIT Phase 1）: §14.3.3 は Info を PDF 2.0 で非推奨とし、XMP を持つ文書では
 * 両者の食い違いが dc:title 等の不一致（読み上げ・保存検証の誤り）になる。
 * Info を更新した後に呼ぶと、Info の現在値で XMP を組み直す。
 *
 * 引き継ぐもの: `pdfuaid:part` / `pdfaid:part` / `pdfaid:conformance` / `pdfaid:rev` /
 * `dc:language` / `xmp:CreateDate`。`xmp:CreateDate` が既存 XMP に無ければ
 * Info の `/CreationDate` から補う（W-6）。
 *
 * 差し替えは**同一 ref への `set`** で行い、catalog には触れない（増分更新で dirty が 1 つで済む）。
 */

import {
  COS_NULL,
  type CosDict,
  type CosObject,
  type CosRef,
  type CosStream,
  decodeStream,
  dictGet,
  dictGetRaw,
  type PdfDocumentEditor,
} from 'normativepdf';
import { documentDate } from '../config.js';
import { name, stream } from './cos.js';
import { pdfDateToIso, textOf } from './cos-read.js';
import { buildXmpPacket, type XmpOptions } from './xmp.js';

/** `/Info` を辞書として読む（無ければ `undefined`）。 */
async function readInfo(editor: PdfDocumentEditor): Promise<CosDict | undefined> {
  const raw = dictGetRaw(editor.trailer(), 'Info');
  if (raw === undefined || raw.kind === 'null') return undefined;
  const resolved = await editor.resolve(raw);
  return resolved.kind === 'dict' ? resolved : undefined;
}

/** `/Info` の 1 項目をテキストとして読む。 */
async function infoText(editor: PdfDocumentEditor, key: string): Promise<string | undefined> {
  const info = await readInfo(editor);
  if (info === undefined) return undefined;
  const value = await editor.resolve(dictGet(info, key) ?? { kind: 'null' });
  return textOf(value);
}

/**
 * Info の `/CreationDate`（§7.9.4）を UTC の ISO 8601 で返す。
 *
 * ここを見ずに現在時刻へ落とすと、Info の作成日時と `xmp:CreateDate` が食い違う文書を
 * 自分で作ることになり、R-14.3.4-4「両者が fully equivalent である限り他方へ追記してよい」の
 * 条件に反する（発見経緯 = 制約テーブル PoC CT-META-4）。
 *
 * 読めない値・暦に無い日は `undefined`（壊れた値を XMP へ複製しない）。
 */
export async function infoCreationDateIso(editor: PdfDocumentEditor): Promise<string | undefined> {
  const raw = await infoText(editor, 'CreationDate');
  if (raw === undefined) return undefined;
  return pdfDateToIso(raw);
}

/**
 * XMP パケットを `/Metadata` に置く（§14.3.2）。
 *
 * **既存の `/Metadata` が間接参照なら同じ番号を差し替える。** 旧実装
 * （`xmp.ts` の `setXmpMetadata`）は毎回新しいオブジェクトを登録して catalog を
 * 書き換えていたので、呼ぶたびにオブジェクトが 1 つ増え、古い方はどこからも
 * 参照されないまま残っていた。同じ番号に書けば増分更新でも dirty が 1 つで済む。
 */
async function attachXmp(editor: PdfDocumentEditor, packet: string): Promise<AttachResult> {
  const replacement = stream(
    [
      ['Type', name('Metadata')],
      ['Subtype', name('XML')],
    ],
    new TextEncoder().encode(packet),
  );

  const rootRaw = dictGetRaw(editor.trailer(), 'Root');
  if (rootRaw === undefined) return { catalogTouched: false };
  const catalog = await editor.resolve(rootRaw);
  if (catalog.kind !== 'dict') return { catalogTouched: false };

  const raw = dictGetRaw(catalog, 'Metadata');
  if (raw !== undefined && raw.kind === 'ref') {
    editor.set(raw.objectNumber, replacement, raw.generationNumber);
    return { ref: raw, catalogTouched: false };
  }

  const ref = await editor.allocate(replacement);
  const entries = new Map<string, CosObject>(catalog.entries);
  entries.set('Metadata', ref);
  if (rootRaw.kind === 'ref') {
    editor.set(rootRaw.objectNumber, { kind: 'dict', entries }, rootRaw.generationNumber);
  } else {
    editor.setTrailerEntry('Root', { kind: 'dict', entries });
  }
  return { ref, catalogTouched: true };
}

interface AttachResult {
  ref?: CosRef;
  catalogTouched: boolean;
}

/**
 * XMP を**新しく書く**（`xmp.ts` の `setXmpMetadata` の COS 版）。
 *
 * 既存 XMP からの引き継ぎはしない —— 引き継ぐのは `syncXmpWithInfo` の役目である。
 * 呼び出し側が `createDate` を明示すること（W-6）: ここで補うと、生成経路が
 * `SOURCE_DATE_EPOCH`（E-6）の決定論を失う。
 */
export async function writeXmpMetadata(
  editor: PdfDocumentEditor,
  opts: XmpOptions,
): Promise<AttachResult> {
  return attachXmp(editor, buildXmpPacket({ now: documentDate(editor), ...opts }));
}

export interface XmpSyncResult {
  /** XMP を更新したか（`/Metadata` が無ければ false） */
  updated: boolean;
  /** 同一 ref に差し替えた場合の参照（増分更新の dirty 追跡用） */
  ref?: CosRef;
  /** catalog 自体を書き換えたか（`/Metadata` が直接オブジェクトだった場合） */
  catalogTouched: boolean;
  warnings: string[];
}

/** 既存 XMP から引き継ぐ事実を取り出す。 */
const facts = (text: string) => ({
  pdfuaPart: /<pdfuaid:part>\s*(\d+)\s*<\/pdfuaid:part>/.exec(text)?.[1],
  lang: /<dc:language>[\s\S]*?<rdf:li>([^<]*)<\/rdf:li>/.exec(text)?.[1],
  createDate: /<xmp:CreateDate>([^<]+)<\/xmp:CreateDate>/.exec(text)?.[1],
  pdfaPart: /<pdfaid:part>\s*(\d+)\s*<\/pdfaid:part>/.exec(text)?.[1],
  pdfaConformance: /<pdfaid:conformance>\s*([^<\s]+)\s*<\/pdfaid:conformance>/.exec(text)?.[1],
  pdfaRev: /<pdfaid:rev>\s*(\d+)\s*<\/pdfaid:rev>/.exec(text)?.[1],
});

export async function syncXmpWithInfo(
  editor: PdfDocumentEditor,
  /**
   * 既存 XMP の値より優先して書き込む宣言（B-8 の `ensure_pdfa` 用）。
   * 保持ではなく**上書き**なので、新たに PDF/A を名乗らせるときに使う。
   */
  overrides?: { pdfaPart?: number; pdfaConformance?: string; pdfaRev?: number },
): Promise<XmpSyncResult> {
  const none: XmpSyncResult = { updated: false, catalogTouched: false, warnings: [] };

  const rootRaw = dictGetRaw(editor.trailer(), 'Root');
  if (rootRaw === undefined) return none;
  const catalog = await editor.resolve(rootRaw);
  if (catalog.kind !== 'dict') return none;

  const raw = dictGetRaw(catalog, 'Metadata');
  if (raw === undefined || raw.kind === 'null') return none;

  const resolved = await editor.resolve(raw);
  if (resolved.kind !== 'stream') {
    return {
      ...none,
      warnings: [
        'The document has /Metadata but not in a readable form; XMP was left unchanged ' +
          'and may now disagree with the Info dictionary.',
      ],
    };
  }

  let text: string;
  try {
    const existing: CosStream = resolved;
    const bytes =
      dictGet(existing.dict, 'Filter') === undefined
        ? existing.raw
        : await decodeStream(existing, { resolve: (v: CosObject) => v });
    text = new TextDecoder().decode(bytes);
  } catch {
    return {
      ...none,
      warnings: [
        'The existing XMP stream could not be decoded; it was left unchanged ' +
          'and may now disagree with the Info dictionary.',
      ],
    };
  }

  const kept = facts(text);
  // part を上書きするなら、level と rev も**その宣言の一部**として一緒に決まる。
  // 既存値へのフォールバックを残すと、-3b から -4 へ載せ替えたときに
  // `pdfaid:conformance` が生き残り、conformance level を持たない -4 が level を名乗る。
  const redeclaring = overrides?.pdfaPart !== undefined;

  const packet = buildXmpPacket({
    title: await infoText(editor, 'Title'),
    author: await infoText(editor, 'Author'),
    subject: await infoText(editor, 'Subject'),
    keywords: await infoText(editor, 'Keywords'),
    pdfuaPart: kept.pdfuaPart !== undefined ? Number(kept.pdfuaPart) : undefined,
    pdfaPart:
      overrides?.pdfaPart ?? (kept.pdfaPart !== undefined ? Number(kept.pdfaPart) : undefined),
    pdfaConformance: redeclaring ? overrides?.pdfaConformance : kept.pdfaConformance,
    pdfaRev: redeclaring
      ? overrides?.pdfaRev
      : kept.pdfaRev !== undefined
        ? Number(kept.pdfaRev)
        : undefined,
    lang: kept.lang,
    // W-6: 既存 XMP に xmp:CreateDate が無ければ Info の /CreationDate から補う
    createDate: kept.createDate ?? (await infoCreationDateIso(editor)),
    now: documentDate(editor),
  });

  const attached = await attachXmp(editor, packet);
  return {
    updated: true,
    ...(attached.ref !== undefined && !attached.catalogTouched ? { ref: attached.ref } : {}),
    catalogTouched: attached.catalogTouched,
    warnings: [],
  };
}

/**
 * B-8: 文書に PDF/A 適合を**宣言**させる（veraPDF `6.6.4-1`）。
 *
 * 既存 XMP があれば `pdfaid` を**上書き**し、他の宣言（`pdfuaid:part` / `dc:language` /
 * `xmp:CreateDate`）は `syncXmpWithInfo` が保持する。XMP が無ければ Info と `/Lang` から
 * 最小の XMP を新規に作る —— `ensure_pdfa` は既存 PDF が対象なので、この枝は普通に起こる。
 *
 * **自称と実体は別物**（`specs/09 §4`）。ここが作るのは宣言だけで、適合の判定は veraPDF が下す。
 */
export async function declarePdfa(
  editor: PdfDocumentEditor,
  part: number,
  conformance: string | undefined,
  rev?: number,
): Promise<XmpSyncResult> {
  const rootRaw = dictGetRaw(editor.trailer(), 'Root');
  const catalog = rootRaw === undefined ? COS_NULL : await editor.resolve(rootRaw);
  const hasMetadata = catalog.kind === 'dict' && dictGetRaw(catalog, 'Metadata') !== undefined;

  if (hasMetadata) {
    return syncXmpWithInfo(editor, {
      pdfaPart: part,
      ...(conformance !== undefined ? { pdfaConformance: conformance } : {}),
      ...(rev !== undefined ? { pdfaRev: rev } : {}),
    });
  }

  const lang = catalog.kind === 'dict' ? textOf(dictGet(catalog, 'Lang')) : undefined;
  const infoRaw = dictGetRaw(editor.trailer(), 'Info');
  const info = infoRaw === undefined ? COS_NULL : await editor.resolve(infoRaw);
  const infoText = async (key: string): Promise<string | undefined> =>
    info.kind === 'dict' ? textOf(await editor.resolve(dictGet(info, key) ?? COS_NULL)) : undefined;

  const attached = await writeXmpMetadata(editor, {
    ...((await infoText('Title')) !== undefined ? { title: await infoText('Title') } : {}),
    ...((await infoText('Author')) !== undefined ? { author: await infoText('Author') } : {}),
    ...((await infoText('Subject')) !== undefined ? { subject: await infoText('Subject') } : {}),
    ...((await infoText('Keywords')) !== undefined ? { keywords: await infoText('Keywords') } : {}),
    pdfaPart: part,
    ...(conformance !== undefined ? { pdfaConformance: conformance } : {}),
    ...(rev !== undefined ? { pdfaRev: rev } : {}),
    ...(lang !== undefined ? { lang } : {}),
    // W-6: 既存 PDF に XMP を新設する経路。作成日時は Info の /CreationDate から引き継ぐ
    ...((await infoCreationDateIso(editor)) !== undefined
      ? { createDate: await infoCreationDateIso(editor) }
      : {}),
  });
  return {
    updated: true,
    ...(attached.ref !== undefined && !attached.catalogTouched ? { ref: attached.ref } : {}),
    catalogTouched: attached.catalogTouched,
    warnings: [],
  };
}
