/**
 * COS を**読む**向きの原始関数 —— Phase 3（pdf-lib 撤去）の L4′.2。
 *
 * `cos.ts` は書く向き（`textString` / `literal` / `stream` …）を持っている。
 * ここはその対で、**読む向きだけ**を置く。対を別のパッケージに分けないために
 * normativepdf ではなく writer 側に置いた（受け皿の数え = §3.18）。
 *
 * | 要件 | 何を言っているか |
 * |---|---|
 * | R-7.9.2.2.1-2 | テキスト文字列は PDFDocEncoding / UTF-16BE / **(PDF 2.0) UTF-8** のいずれか |
 * | R-7.9.2.2.1-3 | UTF-16BE は先頭 2 バイトが 254, 255（`FE FF`） |
 * | R-7.9.2.2.1-4 | UTF-8 は先頭 3 バイトが 239, 187, 191（`EF BB BF`） |
 * | R-7.9.2.2.1-5 | 補助文字（サロゲート対）を扱えること |
 * | R-7.9.4-12 | 日付は `D:` と `YYYY` が必須。以降の欄は前の欄が全部あるときだけ置ける |
 * | R-7.9.4-16 | `MM` と `DD` の既定は 01、他の数値欄の既定は 0 |
 * | R-7.9.4-17 | UT の情報が無ければ GMT とみなす |
 * | R-7.9.4-18 | 時差の指定があってもなくても、日付の残りは現地時刻 |
 */

import type { CosObject } from 'normativepdf';

/**
 * PDFDocEncoding が Latin-1 と違う符号位置（Table D.2 の PDF 欄）。
 *
 * 🔴 **BOM の無いテキスト文字列は PDFDocEncoding であって Latin-1 ではない。**
 * バイトをそのまま `String.fromCharCode` に渡すと、下の範囲だけ黙って別の文字になる。
 */
const PDF_DOC_ENCODING_DIFFS: Readonly<Record<number, number>> = {
  // 0x18–0x1F: 発音区別符号（Latin-1 では制御文字）
  0x18: 0x02d8, // breve
  0x19: 0x02c7, // caron
  0x1a: 0x02c6, // circumflex
  0x1b: 0x02d9, // dotaccent
  0x1c: 0x02dd, // hungarumlaut
  0x1d: 0x02db, // ogonek
  0x1e: 0x02da, // ring
  0x1f: 0x02dc, // tilde
  // 0x80–0x9E: 約物と合字（Latin-1 では C1 制御文字）
  0x80: 0x2022, // bullet
  0x81: 0x2020, // dagger
  0x82: 0x2021, // daggerdbl
  0x83: 0x2026, // ellipsis
  0x84: 0x2014, // emdash
  0x85: 0x2013, // endash
  0x86: 0x0192, // florin
  0x87: 0x2044, // fraction
  0x88: 0x2039, // guilsinglleft
  0x89: 0x203a, // guilsinglright
  0x8a: 0x2212, // minus
  0x8b: 0x2030, // perthousand
  0x8c: 0x201e, // quotedblbase
  0x8d: 0x201c, // quotedblleft
  0x8e: 0x201d, // quotedblright
  0x8f: 0x2018, // quoteleft
  0x90: 0x2019, // quoteright
  0x91: 0x201a, // quotesinglbase
  0x92: 0x2122, // trademark
  0x93: 0xfb01, // fi
  0x94: 0xfb02, // fl
  0x95: 0x0141, // Lslash
  0x96: 0x0152, // OE
  0x97: 0x0160, // Scaron
  0x98: 0x0178, // Ydieresis
  0x99: 0x017d, // Zcaron
  0x9a: 0x0131, // dotlessi
  0x9b: 0x0142, // lslash
  0x9c: 0x0153, // oe
  0x9d: 0x0161, // scaron
  0x9e: 0x017e, // zcaron
  // Table D.2 の PDF 欄に無く、**周囲が割り当て済みの範囲にある**符号位置。
  // Latin-1 のまま通すと 0xAD が軟ハイフンという「PDFDocEncoding に無い文字」になるので、
  // 文字を当てずに U+FFFD を返す。0x00–0x17 の制御符号はそのまま通す（表の対象外）
  0x7f: 0xfffd,
  0x9f: 0xfffd,
  0xad: 0xfffd,
  // 0xA0 は Latin-1 では NO-BREAK SPACE だが PDFDocEncoding では EURO SIGN
  0xa0: 0x20ac,
};

/** PDFDocEncoding の 1 バイト列を復号する。 */
function decodePdfDocEncoding(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) {
    out += String.fromCodePoint(PDF_DOC_ENCODING_DIFFS[byte] ?? byte);
  }
  return out;
}

/** UTF-16BE（BOM を除いた本体）を復号する。奇数バイトの余りは落とす。 */
function decodeUtf16Be(body: Uint8Array): string {
  const units: number[] = [];
  for (let i = 0; i + 1 < body.length; i += 2) {
    units.push((body[i] << 8) | body[i + 1]);
  }
  // サロゲート対（R-7.9.2.2.1-5）は String.fromCharCode の並びで組み上がる
  let out = '';
  for (let i = 0; i < units.length; i += 1024) {
    out += String.fromCharCode(...units.slice(i, i + 1024));
  }
  return out;
}

/**
 * テキスト文字列（§7.9.2.2.1）を復号する。
 *
 * 判定は BOM だけで行う —— 中身から推測しない。推測を入れると、
 * 「日本語のときだけ別の経路に落ちる」読み方になる。
 */
export function decodeTextString(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return decodeUtf16Be(bytes.subarray(2));
  }
  // PDF 2.0（R-7.9.2.2.1-4）。旧実装（pdf-lib）はこの形を復号しない
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3));
  }
  return decodePdfDocEncoding(bytes);
}

/** COS の値が文字列ならテキストとして復号する。それ以外は `undefined`。 */
export function textOf(obj: CosObject | undefined): string | undefined {
  if (obj === undefined || obj.kind !== 'string') return undefined;
  return decodeTextString(obj.bytes);
}

/**
 * §7.9.4 の日付。
 *
 * `'` は書く向き（R-7.9.4-14 / -15）の決まりなので、**読む向きでは省いた形も受け取る**
 * （`+0900`）。受け取らないと、`/CreationDate` を読めなかった文書で現在時刻に落ち、
 * Info の作成日時と XMP の `xmp:CreateDate` が食い違う文書を自分で作ることになる（W-6）。
 */
const DATE_RE =
  /^D:(\d{4})(?:(\d{2})(?:(\d{2})(?:(\d{2})(?:(\d{2})(?:(\d{2}))?)?)?)?)?(?:(Z|\+|-)(?:(\d{2})'?(?:(\d{2})'?)?)?)?$/;

const inRange = (value: number, min: number, max: number): boolean =>
  Number.isInteger(value) && value >= min && value <= max;

/**
 * PDF の日付文字列を時点に変換する。読めない値・範囲外の値は `undefined`
 * （壊れた値を XMP へ複製しない）。
 */
export function parsePdfDate(text: string): Date | undefined {
  const m = DATE_RE.exec(text.trim());
  if (!m) return undefined;

  // R-7.9.4-16: MM と DD の既定は 01、他は 0
  const year = Number(m[1]);
  const month = m[2] === undefined ? 1 : Number(m[2]);
  const day = m[3] === undefined ? 1 : Number(m[3]);
  const hour = m[4] === undefined ? 0 : Number(m[4]);
  const minute = m[5] === undefined ? 0 : Number(m[5]);
  const second = m[6] === undefined ? 0 : Number(m[6]);
  const sign = m[7];
  const offsetHour = m[8] === undefined ? 0 : Number(m[8]);
  const offsetMinute = m[9] === undefined ? 0 : Number(m[9]);

  if (!inRange(month, 1, 12)) return undefined;
  if (!inRange(day, 1, 31)) return undefined;
  if (!inRange(hour, 0, 23)) return undefined;
  if (!inRange(minute, 0, 59)) return undefined;
  if (!inRange(second, 0, 59)) return undefined;
  if (!inRange(offsetHour, 0, 23)) return undefined;
  if (!inRange(offsetMinute, 0, 59)) return undefined;

  // R-7.9.4-18: 日付の欄は現地時刻。R-7.9.4-17: UT の情報が無ければ GMT
  const offsetMinutes =
    sign === '+' ? offsetHour * 60 + offsetMinute : sign === '-' ? -(offsetHour * 60 + offsetMinute) : 0;

  // 2 月 31 日のような繰り上がりを拒む（暦に無い日を「読めた」ことにしない）。
  // 時差を足す前の暦の上で確かめる —— 足したあとだと日が動いて判定できない
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) return undefined;

  const date = new Date(
    Date.UTC(year, month - 1, day, hour, minute, second) - offsetMinutes * 60_000,
  );
  // 0〜99 年は Date.UTC が 1900 年代に寄せるので戻す
  if (year < 100) date.setUTCFullYear(year);
  if (Number.isNaN(date.getTime())) return undefined;
  return date;
}

/** §7.9.4 の日付を UTC の ISO 8601（秒まで）にする。読めなければ `undefined`。 */
export function pdfDateToIso(text: string): string | undefined {
  const date = parsePdfDate(text);
  if (date === undefined) return undefined;
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}
