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


export const PDF_VERSIONS = ['1.7', '2.0'] as const;
export type PdfVersion = (typeof PDF_VERSIONS)[number];

/** 既定は 1.7 — 既存の出力バイト列を 1 バイトも動かさないため */
export const DEFAULT_PDF_VERSION: PdfVersion = '1.7';
