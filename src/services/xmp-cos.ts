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
import { buildXmpPacket, type XmpOptions } from './xmp-build.js';

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

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  amp: '&',
};

/**
 * XML の文字参照を戻す（1 回の走査で。順に置き換えると `&amp;lt;` が `<` になる）。
 * 定義済みの 5 つの実体参照（XML 1.0 §4.6）と、数値文字参照 `&#NNN;`・`&#xHHHH;`（§4.1）。
 * 他のツールが書いた XMP は、記号や絵文字を数値文字参照で書いていることがある。
 * 戻せない参照（範囲外の数値・未定義の名前）はそのまま残す。
 */
function xmlUnescape(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return value.replace(/&(#x[0-9A-Fa-f]+|#[0-9]+|[A-Za-z]+);/g, (whole, body: string) => {
    if (body.startsWith('#')) {
      const code =
        body[1] === 'x' || body[1] === 'X'
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      return Number.isInteger(code) && code >= 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole;
    }
    return NAMED_ENTITIES[body] ?? whole;
  });
}

/**
 * XMP の `dc:title` の最初の項目（`rdf:Alt` の最初の `rdf:li`）を、文字参照を戻して返す。
 * 複数の言語の項目（ISO 32000-2 §14.3.3 の例は x-default・en・de の 3 つ）は最初の 1 つしか
 * 拾わない。書き戻す側（buildXmpPacket）が項目を 1 つしか書かないため（制限）。
 */
export function xmpTitleOf(xmp: string | null | undefined): string | undefined {
  if (xmp === null || xmp === undefined) return undefined;
  return xmlUnescape(/<dc:title>[\s\S]*?<rdf:li[^>]*>([^<]*)<\/rdf:li>/.exec(xmp)?.[1]);
}

/** 既存 XMP から引き継ぐ事実を取り出す。 */
const facts = (text: string) => ({
  pdfuaPart: /<pdfuaid:part>\s*(\d+)\s*<\/pdfuaid:part>/.exec(text)?.[1],
  // PDF/UA-2 の宣言は part と rev の対（ISO 14289-2 §5）。part だけ運ぶと rev が消える
  pdfuaRev: /<pdfuaid:rev>\s*(\d+)\s*<\/pdfuaid:rev>/.exec(text)?.[1],
  // dc:title の最初の項目（xmp-build が書く rdf:Alt の rdf:li）。実体参照は戻して持つ
  title: xmpTitleOf(text),
  lang: /<dc:language>[\s\S]*?<rdf:li>([^<]*)<\/rdf:li>/.exec(text)?.[1],
  createDate: /<xmp:CreateDate>([^<]+)<\/xmp:CreateDate>/.exec(text)?.[1],
  pdfaPart: /<pdfaid:part>\s*(\d+)\s*<\/pdfaid:part>/.exec(text)?.[1],
  pdfaConformance: /<pdfaid:conformance>\s*([^<\s]+)\s*<\/pdfaid:conformance>/.exec(text)?.[1],
  pdfaRev: /<pdfaid:rev>\s*(\d+)\s*<\/pdfaid:rev>/.exec(text)?.[1],
  // #4: TDMRep は既存 XMP から引き継ぐ。読む側は Report の 2 綴り（…tdmrep/ と …tdmrep#）の
  // どちらで宣言されていても `tdm:` 要素・属性を拾う（prefix は慣用の tdm に限る）
  tdmReservation: (/<tdm:reservation>\s*([01])\s*<\/tdm:reservation>/.exec(text) ??
    /\stdm:reservation\s*=\s*["']([01])["']/.exec(text))?.[1],
  tdmPolicy: (/<tdm:policy>\s*([^<\s]+)\s*<\/tdm:policy>/.exec(text) ??
    /\stdm:policy\s*=\s*["']([^"']+)["']/.exec(text))?.[1],
});

/** 書き込みの上書き指定（既存 XMP の値より優先する） */
export interface XmpOverrides {
  pdfaPart?: number;
  pdfaConformance?: string;
  pdfaRev?: number;
  /** #4: TDMRep。`null` は既存の宣言を取り除く */
  tdmReservation?: 0 | 1 | null;
  tdmPolicy?: string | null;
}

export async function syncXmpWithInfo(
  editor: PdfDocumentEditor,
  /**
   * 既存 XMP の値より優先して書き込む宣言（B-8 の `ensure_pdfa` 用）。
   * 保持ではなく**上書き**なので、新たに PDF/A を名乗らせるときに使う。
   */
  overrides?: XmpOverrides,
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
    // Info の Title を優先し、無ければ既存の dc:title を引き継ぐ。PDF 2.0 の出力は Info に Title を
    // 置かない（§14.3.3 が Info の文書メタデータを非推奨にしている）ので、Info だけから作ると、
    // 題名を書いていない編集（set_metadata の author だけなど）で dc:title が消える。
    // PDF/UA-1 §7.1・PDF/UA-2 §8.11.1 は dc:title を求める（SPEC-WRITER-PDFUA2-005）
    title: (await infoText(editor, 'Title')) ?? kept.title,
    author: await infoText(editor, 'Author'),
    subject: await infoText(editor, 'Subject'),
    keywords: await infoText(editor, 'Keywords'),
    pdfuaPart: kept.pdfuaPart !== undefined ? Number(kept.pdfuaPart) : undefined,
    pdfuaRev: kept.pdfuaRev !== undefined ? Number(kept.pdfuaRev) : undefined,
    pdfaPart:
      overrides?.pdfaPart ?? (kept.pdfaPart !== undefined ? Number(kept.pdfaPart) : undefined),
    pdfaConformance: redeclaring ? overrides?.pdfaConformance : kept.pdfaConformance,
    pdfaRev: redeclaring
      ? overrides?.pdfaRev
      : kept.pdfaRev !== undefined
        ? Number(kept.pdfaRev)
        : undefined,
    lang: kept.lang,
    ...tdmOptions(kept, overrides),
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
/**
 * #4: TDMRep の書き込み値を決める。override の `null` は取り除く、`undefined` は既存を保つ。
 * `policy` は `reservation` が無ければ書かない（Report の形に無い）。
 */
function tdmOptions(
  kept: { tdmReservation?: string; tdmPolicy?: string },
  overrides?: XmpOverrides,
): Pick<XmpOptions, 'tdmReservation' | 'tdmPolicy'> {
  const reservation =
    overrides?.tdmReservation === null
      ? undefined
      : (overrides?.tdmReservation ??
        (kept.tdmReservation !== undefined ? (Number(kept.tdmReservation) as 0 | 1) : undefined));
  const policy =
    overrides?.tdmPolicy === null ? undefined : (overrides?.tdmPolicy ?? kept.tdmPolicy);
  if (reservation === undefined) return {};
  return { tdmReservation: reservation, ...(policy !== undefined ? { tdmPolicy: policy } : {}) };
}

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

  return createXmpFromInfo(editor, {
    pdfaPart: part,
    ...(conformance !== undefined ? { pdfaConformance: conformance } : {}),
    ...(rev !== undefined ? { pdfaRev: rev } : {}),
  });
}

/**
 * XMP を持たない文書に XMP を**新設**する。Info 辞書（Title / Author / Subject / Keywords）と
 * カタログの `/Lang`、Info の `/CreationDate`（W-6）を引き継ぎ、`extra` を重ねる。
 * `declarePdfa`（PDF/A 宣言）と `set_metadata` の TDMRep（#4）が共用する。
 */
export async function createXmpFromInfo(
  editor: PdfDocumentEditor,
  extra: Omit<XmpOptions, 'now' | 'createDate'>,
): Promise<XmpSyncResult> {
  const rootRaw = dictGetRaw(editor.trailer(), 'Root');
  const catalog = rootRaw === undefined ? COS_NULL : await editor.resolve(rootRaw);
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
    ...(lang !== undefined ? { lang } : {}),
    ...extra,
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
