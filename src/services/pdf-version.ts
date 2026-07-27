/**
 * PDF version output (B-16)
 *
 * ### pdf-lib の `context.header` は save では読まれない（B-16 で実測して分かったこと）
 *
 * 起票時の想定は「`context.header` は public field なので `PDFHeader.forVersion(2, 0)` に
 * 差し替えればよい」だった。**これは効かない** — `PDFWriter#computeBufferSize()` と
 * `PDFStreamWriter#computeBufferSize()` はどちらも `PDFHeader.forVersion(1, 7)` を
 * **その場で作って**書き出しており、`this.context.header` を一度も参照しない
 * （pdf-lib 1.17 系で実測。差し替えても出力は `%PDF-1.7` のまま）。
 *
 * そこで **save 後のバイト列でヘッダを差し替える**。`%PDF-1.7` と `%PDF-2.0` は
 * どちらも 8 バイトなので、**後続のバイトオフセット（xref / startxref）は 1 つも動かない**
 * （R-7.5.2-1「バイトオフセットは PERCENT SIGN から数える」）。長さが変わる置換なら
 * この手は使えないので、前提の 8 バイト一致は実行時にも確かめる。
 *
 * ### ヘッダを 2.0 にするだけでは PDF 2.0 の文書にならない
 *
 * ISO 32000-2 が版に紐づけて課す義務が 2 つある:
 *
 * 1. **trailer `/ID` が Required**（Table 15 — 1.7 では Encrypt がある場合のみ）。
 * 2. **Info 辞書は CreationDate / ModDate 以外が非推奨**（§14.3.3。他の document level
 *    metadata は metadata stream = XMP を使う **should**）。
 *
 * この 2 つを伴わない「ヘッダだけ 2.0」は、**版を偽る点で `ensure_pdfa` を非適合文書に
 * 掛けるのと同じ種類の嘘**になる。だからここは版の宣言と義務をひとまとめに扱う。
 *
 * ### 条文
 *
 * - R-7.5.2-3: ヘッダは `%PDF-1.n` / `%PDF-2.n` + 単一の EOL
 * - R-7.5.2-4: **この規格に適合する文書を書く処理系は、版を「ヘッダ **または** catalog の
 *   `/Version`」のどちらかで 2.0 と示さなければならない**（両方ではない。ここはヘッダを採る）
 * - R-7.5.2-7: バイナリを含むならヘッダ行の直後に 128 以上のバイトを 4 つ以上含むコメント行
 *   （pdf-lib の `PDFHeader#copyBytesInto` が `%` + 0x81×4 を書くので満たされる）
 */

import { PDFDict, type PDFDocument, PDFName, PDFRef } from 'pdf-lib';
import { PdfWriterError } from '../errors.js';

export const PDF_VERSIONS = ['1.7', '2.0'] as const;
export type PdfVersion = (typeof PDF_VERSIONS)[number];

/** 既定は 1.7 — 既存の出力バイト列を 1 バイトも動かさないため */
export const DEFAULT_PDF_VERSION: PdfVersion = '1.7';

/**
 * §14.3.3 が PDF 2.0 でも非推奨にしていない Info のキー。
 * 「In PDF 2.0 such use is deprecated **except for two entries, CreationDate and ModDate**」。
 */
const INFO_KEYS_ALIVE_IN_PDF20 = new Set(['CreationDate', 'ModDate']);

/** pdf-lib が必ず書くヘッダ。差し替えの前提（同じ長さであること）はここで固定する */
const PDF_LIB_HEADER = '%PDF-1.7';

/**
 * 保存済みバイト列のヘッダを指定版に差し替える（R-7.5.2-3 / -4）。**破壊的に書き換える**。
 *
 * `doc.save()` の直後に呼ぶこと。pdf-lib は `context.header` を見ないので、
 * 版を出力に反映する経路はここしかない（モジュール冒頭の説明を参照）。
 */
export function patchHeaderVersion(bytes: Uint8Array, version: PdfVersion): Uint8Array {
  const target = `%PDF-${version}`;
  // 長さが違うと xref の全オフセットがずれる。想定外の版が増えたらここで止まる
  if (target.length !== PDF_LIB_HEADER.length) {
    throw new PdfWriterError(
      `Cannot rewrite the PDF header to ${version}: "${target}" is not the same length as "${PDF_LIB_HEADER}", so every byte offset in the cross-reference table would shift.`,
      'INTERNAL_ERROR',
    );
  }

  const actual = String.fromCharCode(...bytes.subarray(0, target.length));
  if (actual === target) return bytes;
  if (actual !== PDF_LIB_HEADER) {
    // pdf-lib が書くヘッダが変わった = この関数の前提が崩れている。
    // 黙って上書きすると「版を偽った文書」を出すので、ここで気づかせる
    throw new PdfWriterError(
      `Expected the saved document to start with "${PDF_LIB_HEADER}" but found "${actual}". The PDF version was not rewritten.`,
      'INTERNAL_ERROR',
    );
  }

  for (let i = 0; i < target.length; i++) bytes[i] = target.charCodeAt(i);
  return bytes;
}

/**
 * Info 辞書を PDF 2.0 の作法へ寄せる（§14.3.3）。**削除したキー名を返す**。
 *
 * 消すのは Title / Author / Subject / Keywords / Creator / Producer / Trapped ——
 * **pdf-lib が `PDFDocument.create()` の時点で勝手に入れる Producer / Creator を含む**。
 * 呼び出し側が何も指定しなくても既定で非推奨エントリが載っているので、
 * 「書かない」ではなく「消す」必要がある。
 *
 * 表に無い独自キーも消す。§14.3.3 が非推奨にしているのは特定のキーではなく
 * **「Info で document level metadata を表現すること」そのもの**なので、
 * 独自キーを残すのは条文の読み方として一貫しない。
 *
 * 日付 2 つを残すのは条文どおりであると同時に、§14.3.4（Info と XMP の
 * 作成/更新日時が fully equivalent であること）を成立させる側でもある。
 */
export function trimInfoForPdf20(doc: PDFDocument): string[] {
  const info = doc.context.trailerInfo.Info;
  const dict = info instanceof PDFRef ? doc.context.lookup(info) : info;
  if (!(dict instanceof PDFDict)) return [];

  const removed: string[] = [];
  for (const [key] of dict.entries()) {
    const name = key.asString().replace(/^\//, '');
    if (INFO_KEYS_ALIVE_IN_PDF20.has(name)) continue;
    dict.delete(PDFName.of(name));
    removed.push(name);
  }
  return removed;
}
