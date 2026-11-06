/**
 * WinAnsiEncoding（ISO 32000-1 Annex D.2 Table D.2 の WinAnsiEncoding 欄）。
 *
 * 標準 14 書体は `/Encoding /WinAnsiEncoding` を宣言して描くので（`font-embed.ts`）、
 * `Tj` に渡すバイトはこの表の符号でなければならない。0.25.0 までは文字コードの
 * 下位 1 バイト（= Latin-1）を書いていて、箇条書きの「•」（U+2022）が 0x22（quotedbl）に
 * なっていた（#19）。
 *
 * Latin-1 と符号が同じなのは 0x20–0x7E と 0xA0–0xFF。違うのは 0x80–0x9F の 27 字で、
 * 下の表は Table D.2 の WIN 欄（8 進）を 16 進に直したもの。0x81・0x8D・0x8F・0x90・0x9D は
 * Table D.2 に字が無い（同表の注 3 は未使用の符号を bullet に割り当てるが、
 * 「bullet に特に割り当てるのは 225 だけ」とする）ので、表に入れない。
 *
 * 0xA0（space の別符号）と 0xAD（hyphen の別符号）は Table D.2 の注で WinAnsiEncoding に
 * 定められているので、U+00A0・U+00AD はそのままの符号で書く。
 */

/** 0x80–0x9F で WinAnsiEncoding が持つ 27 字（Unicode → 符号） */
const WIN_ANSI_HIGH: ReadonlyMap<number, number> = new Map([
  [0x20ac, 0x80], // Euro          200
  [0x201a, 0x82], // quotesinglbase 202
  [0x0192, 0x83], // florin        203
  [0x201e, 0x84], // quotedblbase  204
  [0x2026, 0x85], // ellipsis      205
  [0x2020, 0x86], // dagger        206
  [0x2021, 0x87], // daggerdbl     207
  [0x02c6, 0x88], // circumflex    210
  [0x2030, 0x89], // perthousand   211
  [0x0160, 0x8a], // Scaron        212
  [0x2039, 0x8b], // guilsinglleft 213
  [0x0152, 0x8c], // OE            214
  [0x017d, 0x8e], // Zcaron        216
  [0x2018, 0x91], // quoteleft     221
  [0x2019, 0x92], // quoteright    222
  [0x201c, 0x93], // quotedblleft  223
  [0x201d, 0x94], // quotedblright 224
  [0x2022, 0x95], // bullet        225
  [0x2013, 0x96], // endash        226
  [0x2014, 0x97], // emdash        227
  [0x02dc, 0x98], // tilde         230
  [0x2122, 0x99], // trademark     231
  [0x0161, 0x9a], // scaron        232
  [0x203a, 0x9b], // guilsinglright 233
  [0x0153, 0x9c], // oe            234
  [0x017e, 0x9e], // zcaron        236
  [0x0178, 0x9f], // Ydieresis     237
]);

/** WinAnsiEncoding の空白の符号。符号の無い文字を `ignore` で描くときに使う */
export const WIN_ANSI_SPACE = 0x20;

/**
 * 文字（コードポイント）の WinAnsiEncoding の符号。符号が無ければ `undefined`。
 * U+0000–U+001F・U+007F–U+009F・表に無い U+0100 以上は符号を持たない。
 */
export function winAnsiCode(codePoint: number): number | undefined {
  if ((codePoint >= 0x20 && codePoint <= 0x7e) || (codePoint >= 0xa0 && codePoint <= 0xff)) {
    return codePoint;
  }
  return WIN_ANSI_HIGH.get(codePoint);
}

/**
 * 標準フォントで「グリフがある」とみなす文字。`onMissingGlyph` の照会に使う。
 *
 * 空白の制御文字（U+0009–U+000D）は WinAnsiEncoding に符号を持たないが、描く前に
 * 改行・空白へ変わるので `encode` には届かない（2026-11-06 の実測。生成 3 ツールの全経路）。
 * ここで「無い」と答えると、いままで通っていた改行入りの入力が `MISSING_GLYPH` になる。
 */
export function standardFontHasGlyph(codePoint: number): boolean {
  if (codePoint >= 0x09 && codePoint <= 0x0d) return true;
  return winAnsiCode(codePoint) !== undefined;
}

/**
 * 標準フォントでは描けず、フォントの埋め込みが要る文字か（SPEC-WRITER-STANDARD-FONT-ENCODING-004）。
 *
 * U+0100 以上で WinAnsiEncoding に符号の無い文字。`“` `”` `–` `—` `€` `…` `™` などの 27 字は
 * U+0100 以上でも符号を持つので描ける（ISO 32000-2 Annex D.1 は Table D.2 の字をすべて
 * Helvetica で支えることを求める）。U+0100 未満で符号の無い文字（制御文字・U+007F–U+009F）は
 * ここでは答えず、`onMissingGlyph` に乗せる（002）。0.25.1 までの判定 `hasNonLatin1` は
 * U+0100 以上をすべて断っていた（#22）。
 */
export function needsEmbeddedFont(codePoint: number): boolean {
  return codePoint > 0xff && winAnsiCode(codePoint) === undefined;
}

/**
 * 文字列を WinAnsiEncoding のバイト列にする。符号の無い文字は空白の符号（0x20）にする。
 *
 * 符号の無い文字がここへ届くのは `onMissingGlyph: "ignore"` のときだけ
 * （既定の `error` と編集系は `applyMissingGlyphPolicy` で止まり、`replace` は `?` に替わる）。
 * そのときも下位 1 バイトは書かない —— 書けば WinAnsiEncoding の別の字になる。
 */
export function encodeWinAnsi(text: string): Uint8Array {
  const bytes: number[] = [];
  for (const ch of text) {
    bytes.push(winAnsiCode(ch.codePointAt(0) as number) ?? WIN_ANSI_SPACE);
  }
  return Uint8Array.from(bytes);
}
