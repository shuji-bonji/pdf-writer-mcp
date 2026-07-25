/**
 * PDF/A 適合の正規化（B-8 = PDF/A-3b）
 *
 * pdf-lib が書いた辞書を**保存前に開き直して**是正する。**B-14（font-conformance）と同じ流儀**で、
 * `doc.save()` の直前に呼ぶ（pdf-lib はオブジェクトを flush 時に初めて context へ書き出す）。
 *
 * ## ターゲットは PDF/A-3b（`specs/15-kickoff-b8-pdfa.md` Step 0 で決着）
 *
 * PDF/A-4 は PDF 2.0 基盤で、writer 側は B-16、verify 側は flavour 拡張が前提になるため
 * **B-20 として分離**した（`specs/16-pdfa4-roadmap.md`）。
 *
 * ## 合否はオラクル（veraPDF）が決める — ISO 19005 は手元に無い
 *
 * ISO 19005 は pdf-spec のコーパス外（**T2** = 「veraPDF はこう判定した」までしか言えない）。
 * なので**是正の成立根拠は条文で示せない**。ただし **19005 が参照している ISO 32000-1 の条文は引ける**
 * （`specs/09 §2` の「T2 → T1 の昇格ルート」）。本ファイルのコメントで条文番号を挙げている箇所は
 * すべてこの経路で引いた **T1** であり、「PDF/A がそれを要求している」根拠ではないことに注意。
 *
 * ## UC-4（電帳法）の実測で判明していた 3 件（veraPDF 143/146・pdfa-3b）
 *
 * | veraPDF ルール | 内容 | ここでの是正 |
 * |---|---|---|
 * | `6.1.3-1` | trailer に `/ID` が無い | `ensureFileIdentifier()` |
 * | `6.2.4.3-2` | DeviceRGB に `DefaultRGB` も PDF/A OutputIntent も無い（50 件） | `ensureSrgbOutputIntent()` |
 * | `6.6.4-1` | PDF/A Identification 拡張スキーマが無い | `xmp.ts`（`pdfaPart` / `pdfaConformance`） |
 *
 * ## なぜ DefaultRGB ではなく OutputIntent を採るか
 *
 * veraPDF の `6.2.4.3-2` は「device independent な `DefaultRGB` が設定されている**か**、
 * RGB destination profile を持つ PDF/A OutputIntent がある」ことを求める。どちらでも通りうるが:
 *
 * - `DefaultRGB` は **ページごとの `/Resources` の `/ColorSpace` サブ辞書**に置く（**R-8.6.5.7**:
 *   「the ColorSpace subdictionary of the current resource dictionary is checked」）。
 *   つまりページや Resources が増える経路（`add_watermark` / `stamp_page_numbers` / `merge_pdfs`）で
 *   **付け漏れが起きうる**。
 * - OutputIntent は **catalog 1 箇所**（`/OutputIntents`）なので、後続編集で壊れにくい。
 *
 * 長期保存の器としての PDF/A の趣旨（色を後から再現できるようにする）にも OutputIntent が沿う。
 */

import { createHash } from 'node:crypto';
import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  type PDFDocument,
  PDFHexString,
  PDFName,
  PDFRawStream,
  PDFRef,
} from 'pdf-lib';
import { documentDate } from '../config.js';
import { logger } from '../utils/logger.js';
import { buildSrgbIccProfile, SRGB_CONDITION_IDENTIFIER } from './srgb-icc.js';

const CONTEXT = 'PdfaConformance';

const KEY = {
  id: PDFName.of('ID'),
  outputIntents: PDFName.of('OutputIntents'),
  type: PDFName.of('Type'),
  s: PDFName.of('S'),
  outputConditionIdentifier: PDFName.of('OutputConditionIdentifier'),
  info: PDFName.of('Info'),
  destOutputProfile: PDFName.of('DestOutputProfile'),
  n: PDFName.of('N'),
} as const;

export interface PdfaConformanceResult {
  /** 補った項目（人間可読。レポートにそのまま出せる） */
  added: string[];
  /** 触らなかった理由などの注記 */
  notes: string[];
}

/**
 * trailer の `/ID`（File Identifier）を保証する。
 *
 * **R-14.4-7**（shall）: 値は**2 つのバイト文字列の配列**。
 * **R-14.4-8**（shall）: 第 1 要素は作成時の内容に基づく permanent identifier で、
 * **増分更新で変えてはならない**。
 * **R-14.4-10**（shall）: 第 2 要素は最終更新時の内容に基づく changing identifier。
 * **R-14.4-11**（shall）: **初回書き込み時は両者を同値**にする。
 * **R-14.4-12**（should）: MD5 等のダイジェストで計算し、入力に「現在時刻 / ファイルの位置 /
 * バイトサイズ / Info 辞書の全エントリ値」を含める。
 *
 * ### E-6（決定論的出力）との両立
 *
 * 条文が挙げる 4 項目のうち **ファイルサイズとパス名は採らない**:
 *
 * - サイズは `save()` 前には確定しない（この関数は save 直前に走る）
 * - パス名を混ぜると、**同じ内容を別のパスに書くだけでバイト列が変わる**
 *
 * どちらも `should` であり、しかも §14.4 の NOTE が
 * 「**計算は再現可能である必要はない。ユニークであればよい**」と明言している。
 * 逆向き（再現可能にすること）を禁じてはいないので、**E-6 を優先して
 * 「文書の時刻 + Info 辞書」から決める**。`SOURCE_DATE_EPOCH` 設定時は同一入力 → 同一 `/ID` になる。
 */
export function ensureFileIdentifier(doc: PDFDocument): boolean {
  const existing = doc.context.trailerInfo.ID;

  // 既存の第 1 要素は permanent identifier なので保持する（R-14.4-8）
  let permanent: PDFHexString | undefined;
  if (existing instanceof PDFArray && existing.size() >= 1) {
    const first = existing.get(0);
    if (first instanceof PDFHexString) permanent = first;
  }

  const digest = createHash('md5');
  // 「現在時刻」— documentDate は 1 文書 1 回に固定される（W-5）。E-6 では固定値
  digest.update(documentDate(doc).toISOString());
  // 「Info 辞書の全エントリ値」
  const info = doc.context.trailerInfo.Info;
  const infoDict = info instanceof PDFRef ? doc.context.lookup(info) : info;
  if (infoDict instanceof PDFDict) {
    for (const [key, value] of infoDict.entries()) {
      digest.update(key.asString());
      digest.update(String(value));
    }
  }
  const changing = PDFHexString.of(digest.digest('hex').toUpperCase());

  if (permanent === undefined) {
    // 初回書き込み: 両者を同値にする（R-14.4-11）
    doc.context.trailerInfo.ID = doc.context.obj([changing, changing]);
    return true;
  }
  if (existing instanceof PDFArray && existing.size() === 2) {
    // 既に 2 要素ある = 何もしない。第 2 要素の更新は増分更新側の責務であり、
    // ここで書き換えると「最終更新時の内容」の意味がずれる
    return false;
  }
  // 第 1 要素だけがある等の壊れた形 — permanent を保ったまま 2 要素に整える（R-14.4-7）
  doc.context.trailerInfo.ID = doc.context.obj([permanent, changing]);
  return true;
}

/**
 * sRGB の PDF/A OutputIntent を catalog に保証する。
 *
 * **ISO 32000-1 Table 365**（§14.11.5）の必須／条件付き必須:
 *
 * - `S`（Required）: PDF/A は **`GTS_PDFA1`**（同表が「GTS_PDFA1 corresponding to the PDF/A
 *   standard as defined by ISO 19005」と定める）
 * - `OutputConditionIdentifier`（Required）
 * - `DestOutputProfile`（`OutputConditionIdentifier` が標準の production condition を
 *   指さないとき Required、それ以外は optional）
 * - `Info`（同条件で Required）
 *
 * ### ICC プロファイルは条文上 optional だが、それでも埋め込む
 *
 * `sRGB IEC61966-2.1` は ICC Characterization Data Registry の登録名なので、
 * Table 365 の字面では `DestOutputProfile` を省けるはずである。しかし省かない:
 *
 * - veraPDF の `6.2.4.3-2` は「RGB **destination profile** を**含む** OutputIntent」を求めている
 * - PDF/A は**自己完結**を旨とする規格で、外部レジストリの参照に色の再現を委ねるのは趣旨に反する
 *
 * ここは **T2**（ISO 19005 を引けない）なので、最終的な合否は veraPDF に確認する。
 * プロファイルは同梱もダウンロードもせず**生成**する（`srgb-icc.ts`。E-6 と両立）。
 */
export function ensureSrgbOutputIntent(doc: PDFDocument): boolean {
  const { catalog, context } = doc;

  // 既に PDF/A OutputIntent があるなら触らない（利用者が意図して置いた可能性がある）
  const existing = catalog.lookup(KEY.outputIntents);
  if (existing instanceof PDFArray) {
    for (let i = 0; i < existing.size(); i++) {
      const intent = existing.lookup(i);
      if (intent instanceof PDFDict && intent.get(KEY.s) === PDFName.of('GTS_PDFA1')) return false;
    }
  }

  // ICC プロファイルストリーム。形式は ICCBased 色空間と同じ（Table 365 / §8.6.5.5）で、
  // `/N` は色成分数 = RGB なので 3
  const profile = buildSrgbIccProfile();
  const profileRef = context.register(context.flateStream(profile, { N: 3 }));

  const intent = context.obj({
    Type: 'OutputIntent',
    S: 'GTS_PDFA1',
    OutputConditionIdentifier: PDFHexString.fromText(SRGB_CONDITION_IDENTIFIER),
    Info: PDFHexString.fromText(SRGB_CONDITION_IDENTIFIER),
    DestOutputProfile: profileRef,
  });

  if (existing instanceof PDFArray) {
    existing.push(context.register(intent));
  } else {
    catalog.set(KEY.outputIntents, context.obj([context.register(intent)]));
  }
  return true;
}

/**
 * PDF/A-3b 化の是正をまとめて適用する。**`doc.save()` の直前に呼ぶこと。**
 *
 * XMP の `pdfaid`（veraPDF `6.6.4-1`）はここでは扱わない。XMP の生成は `xmp.ts` に
 * 集約されており、`pdfuaid:part` / `dc:language` / `xmp:CreateDate` の保持と
 * 同じ経路に乗せる必要があるため（B-9 の `syncXmpWithInfo` を壊さない）。
 */
export async function normalizePdfaConformance(doc: PDFDocument): Promise<PdfaConformanceResult> {
  await doc.flush();

  const result: PdfaConformanceResult = { added: [], notes: [] };

  if (ensureFileIdentifier(doc)) {
    result.added.push('trailer /ID (file identifier)');
    logger.debug(CONTEXT, 'Added a trailer /ID (file identifier).');
  } else {
    result.notes.push('The document already has a trailer /ID; it was left unchanged.');
  }

  if (ensureSrgbOutputIntent(doc)) {
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
export function hasPdfaDeclaration(doc: PDFDocument): boolean {
  const metadata = doc.catalog.lookup(PDFName.of('Metadata'));
  if (!(metadata instanceof PDFRawStream)) return false;
  try {
    const bytes = metadata.dict.has(PDFName.of('Filter'))
      ? decodePDFRawStream(metadata).decode()
      : metadata.contents;
    return /<pdfaid:part>/.test(new TextDecoder().decode(bytes));
  } catch {
    return false;
  }
}
