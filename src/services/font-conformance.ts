/**
 * 埋め込みフォントの条文適合（B-14 = SPEC-REAUDIT の W-2 / W-3 / W-4）
 *
 * pdf-lib が書いたフォント辞書を**保存前に開き直して**是正する。
 * 「委譲先が書いた辞書を一度は自分の目で開く」（SPEC-AUDIT Phase 3 の教訓）の実践であり、
 * ここで直しているのは全て **veraPDF が見ない** 領域である（PDF/UA-1 はフォント
 * プログラムの形式一致を検査しない。だから今まで 106/106 のまま通っていた）。
 *
 * ## W-2: CFF (.otf) を CIDFontType2 + FontFile2 で埋めていた
 *
 * writer は harfbuzz で事前サブセットした sfnt を `subset:false` で pdf-lib に渡す。
 * pdf-lib の `CustomFontEmbedder` は `isCFF()`（= fontkit の `font.cff`）で分岐するが、
 * **OTTO コンテナでは false 側に落ちる**ため、中身が CFF なのに
 * `/Subtype /CIDFontType2` + `/FontFile2` になっていた。
 *
 * - **R-9.9.1-33 / -34**（Table 124 `FontFile2`）: font program は TrueType Reference Manual に
 *   適合し「"glyf", "head", "hhea", "hmtx", "loca", "maxp"」を含まなければならない（shall）。
 *   OTTO は glyf も loca も持たない。
 * - **R-9.7.4.2-3**: CIDFont が CFF の font program を埋め込むとき、`FontFile3` の
 *   `/Subtype` は `CIDFontType0C` か `OpenType` の**いずれかでなければならない**（shall）。
 *
 * 是正は Table 124 の `FontFile3` / `OpenType` の 2 番目・3 番目の箇条書きに従う:
 * 「"CFF " テーブルを含むなら CIDFontType0 CIDFont 辞書。CFF に加えて "cmap" テーブルを
 * 含まなければならない」。harfbuzz の出力は cmap を保持しているので、**バイト列はそのまま**
 * `/FontFile3` `/Subtype /OpenType` へ移し、CIDFont を `/CIDFontType0` にする。
 *
 * ### 落とし穴: CID-keyed CFF の charset（これを見落とすと文字化けする）
 *
 * pdf-lib は Identity-H + `CID = GID` 前提でコンテンツストリームを書く。
 * ところが **CIDFontType0 のグリフ選択は CID → charset → GID**（R-9.7.4.2-4）であり、
 * NotoSansJP のような CID-keyed CFF を harfbuzz でサブセットすると charset は
 * **「新 GID → 元の GID」**を保つ（実測: gid1→cid1, gid2→cid18, … gid9→cid1478）。
 * このまま CIDFontType0 と名乗ると、条文どおりに解決する処理系が**別のグリフを描く**。
 *
 * そこで charset を **identity に書き換える**（cid i = gid i）。ROS が `Adobe-Identity-0`
 * であること（= CID に外部の文字コレクション上の意味が無いこと）を確認してから行う。
 * 書き換えはバイト長を変えないので、他のテーブルのオフセットに影響しない。
 *
 * ## W-3: サブセット名に `ABCDEF+` タグが無い
 *
 * **R-9.9.2-2 / -3**（shall）: サブセットの `BaseFont` / `FontName` は
 * 「**大文字 6 文字**のタグ + `+` + 元の PostScript 名」でなければならず、同一 PDF 内の
 * 別サブセットは別タグでなければならない。pdf-lib は代わりに `-7572` のような
 * 乱数サフィックスを付けるので、形式不適合かつ「元の PostScript 名」も壊れている。
 *
 * タグは**フォントプログラムのバイト列のハッシュ**から決める。同じサブセットは常に同じタグ、
 * 違うサブセットは違うタグになり、`SOURCE_DATE_EPOCH` による決定論的出力（E-6）も壊さない。
 *
 * ## W-4: FontFile2 に `Length1` が無い
 *
 * Table 125 `Length1`:「(**Required** for Type 1 and TrueType font programs) …デコード後の
 * TrueType font program 全体のバイト長」。pdf-lib は書かない（ソース確認済み）。
 * .ttf 入力の経路に残るので、ここで足す。
 */

import { createHash } from 'node:crypto';
import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  type PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  type PDFRef,
} from 'pdf-lib';
import { logger } from '../utils/logger.js';

const CTX = 'FontConformance';

const KEY = {
  fontFile2: PDFName.of('FontFile2'),
  fontFile3: PDFName.of('FontFile3'),
  subtype: PDFName.of('Subtype'),
  baseFont: PDFName.of('BaseFont'),
  fontName: PDFName.of('FontName'),
  fontDescriptor: PDFName.of('FontDescriptor'),
  descendantFonts: PDFName.of('DescendantFonts'),
  cidToGidMap: PDFName.of('CIDToGIDMap'),
  length1: PDFName.of('Length1'),
  type: PDFName.of('Type'),
} as const;

/** CFF ベースの OpenType（中身は "CFF " テーブル。glyf も loca も持たない） */
const OTTO = 'OTTO';

/** TrueType アウトライン（sfnt version 0x00010000、または古い Apple の 'true'） */
function isTrueTypeProgram(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  const version1 = bytes[0] === 0x00 && bytes[1] === 0x01 && bytes[2] === 0x00 && bytes[3] === 0x00;
  return version1 || magic4(bytes) === 'true';
}

export interface FontConformanceResult {
  /** 是正したフォント数 */
  fixed: number;
  notes: string[];
}

function magic4(bytes: Uint8Array): string {
  if (bytes.length < 4) return '';
  return String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
}

/** 埋め込みフォントストリームのデコード後バイト列（Filter 付きなら展開する） */
function decodeStream(stream: PDFRawStream): Uint8Array | undefined {
  try {
    return stream.dict.has(PDFName.of('Filter'))
      ? decodePDFRawStream(stream).decode()
      : stream.contents;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// W-3: サブセットタグ
// ---------------------------------------------------------------------------

/** pdf-lib が付ける乱数サフィックス（`addRandomSuffix`: `名前-1234`） */
const RANDOM_SUFFIX = /-\d{1,6}$/;

/** 既にタグ付き（`ABCDEF+…`）か */
const TAGGED = /^[A-Z]{6}\+/;

/**
 * フォントプログラムから決定論的に 6 大文字のタグを作る（R-9.9.2-3）。
 * `salt` は同一文書内でタグが衝突したときの回避用。
 */
function subsetTag(program: Uint8Array, salt: number): string {
  const digest = createHash('sha256').update(program).update(String(salt)).digest();
  let tag = '';
  for (let i = 0; i < 6; i++) tag += String.fromCharCode(65 + (digest[i] % 26));
  return tag;
}

// ---------------------------------------------------------------------------
// W-2: CFF の charset を identity に書き換える
// ---------------------------------------------------------------------------

interface SfntTable {
  offset: number;
  length: number;
}

/** sfnt のテーブルディレクトリ */
function sfntTables(font: Uint8Array): Map<string, SfntTable> {
  const view = new DataView(font.buffer, font.byteOffset, font.byteLength);
  const numTables = view.getUint16(4);
  const tables = new Map<string, SfntTable>();
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    if (rec + 16 > font.length) break;
    let tag = '';
    for (let j = 0; j < 4; j++) tag += String.fromCharCode(font[rec + j]);
    tables.set(tag, { offset: view.getUint32(rec + 8), length: view.getUint32(rec + 12) });
  }
  return tables;
}

/** CFF の INDEX 構造を読む。戻り値は各要素の [開始, 終了] と INDEX 全体の終端 */
function readCffIndex(
  cff: Uint8Array,
  pos: number,
): { items: Array<[number, number]>; end: number } {
  const view = new DataView(cff.buffer, cff.byteOffset, cff.byteLength);
  const count = view.getUint16(pos);
  if (count === 0) return { items: [], end: pos + 2 };
  const offSize = cff[pos + 2];
  const offsetsAt = pos + 3;
  const readOffset = (i: number): number => {
    let value = 0;
    for (let b = 0; b < offSize; b++) value = value * 256 + cff[offsetsAt + i * offSize + b];
    return value;
  };
  const dataStart = offsetsAt + (count + 1) * offSize - 1;
  const items: Array<[number, number]> = [];
  for (let i = 0; i < count; i++) {
    items.push([dataStart + readOffset(i), dataStart + readOffset(i + 1)]);
  }
  return { items, end: dataStart + readOffset(count) };
}

/** CFF DICT を演算子 → オペランド列に展開する（演算子キーは `12 x` を `1200+x` で表す） */
function parseCffDict(dict: Uint8Array): Map<number, number[]> {
  const out = new Map<number, number[]>();
  let operands: number[] = [];
  let i = 0;
  while (i < dict.length) {
    const b0 = dict[i];
    if (b0 <= 21) {
      const op = b0 === 12 ? 1200 + dict[i + 1] : b0;
      i += b0 === 12 ? 2 : 1;
      out.set(op, operands);
      operands = [];
    } else if (b0 === 28) {
      operands.push((((dict[i + 1] << 8) | dict[i + 2]) << 16) >> 16);
      i += 3;
    } else if (b0 === 29) {
      operands.push((dict[i + 1] << 24) | (dict[i + 2] << 16) | (dict[i + 3] << 8) | dict[i + 4]);
      i += 5;
    } else if (b0 === 30) {
      // 実数。値は使わないので終端（ニブル 0xF）まで読み飛ばす
      i += 1;
      while (i < dict.length) {
        const v = dict[i];
        i += 1;
        if ((v & 0x0f) === 0x0f || v >> 4 === 0x0f) break;
      }
      operands.push(0);
    } else if (b0 >= 32 && b0 <= 246) {
      operands.push(b0 - 139);
      i += 1;
    } else if (b0 >= 247 && b0 <= 250) {
      operands.push((b0 - 247) * 256 + dict[i + 1] + 108);
      i += 2;
    } else if (b0 >= 251 && b0 <= 254) {
      operands.push(-(b0 - 251) * 256 - dict[i + 1] - 108);
      i += 2;
    } else {
      i += 1;
    }
  }
  return out;
}

/** CFF の標準文字列数（SID がこれ以上なら String INDEX を引く） */
const CFF_STANDARD_STRINGS = 391;

/**
 * CID-keyed CFF の charset を identity（CID i = GID i）へ書き換える。
 *
 * バイト長は変えない。書き換えたら true、書き換え不要／不可なら false。
 * `font` は破壊的に更新する。
 */
function makeCffCharsetIdentity(font: Uint8Array, cff: SfntTable): boolean {
  const table = font.subarray(cff.offset, cff.offset + cff.length);
  if (table.length < 4) return false;

  const headerSize = table[2];
  const nameIndex = readCffIndex(table, headerSize);
  const topIndex = readCffIndex(table, nameIndex.end);
  if (topIndex.items.length === 0) return false;
  const stringIndex = readCffIndex(table, topIndex.end);

  const [topStart, topEnd] = topIndex.items[0];
  const top = parseCffDict(table.subarray(topStart, topEnd));

  // ROS（op 12 30）が無ければ CID-keyed ではない。その場合 CID はそのまま GID として
  // 使われる（R-9.7.4.2-6）ので、charset に触る必要はない
  const ros = top.get(1230);
  if (!ros || ros.length < 2) return false;

  // ROS が Adobe-Identity-0 であること = CID に外部コレクション上の意味が無いことを確認する。
  // 意味のあるコレクション（Adobe-Japan1 等）で identity に潰すのは「別の嘘」になる
  const sidText = (sid: number): string => {
    if (sid < CFF_STANDARD_STRINGS) return `<std ${sid}>`;
    const item = stringIndex.items[sid - CFF_STANDARD_STRINGS];
    if (!item) return '';
    return String.fromCharCode(...table.subarray(item[0], item[1]));
  };
  const registry = sidText(ros[0]);
  const ordering = sidText(ros[1]);
  if (registry !== 'Adobe' || ordering !== 'Identity') {
    logger.warn(
      CTX,
      `CFF charset left as-is: the font declares the ${registry}-${ordering} character ` +
        'collection, where CID values carry meaning beyond glyph order',
    );
    return false;
  }

  const charStringsOffset = top.get(17)?.[0];
  const charsetOffset = top.get(15)?.[0];
  if (charStringsOffset === undefined || charsetOffset === undefined) return false;
  // 0/1/2 は定義済み charset（ISOAdobe など）。CID-keyed では通常現れない
  if (charsetOffset <= 2) return false;

  const numGlyphs = readCffIndex(table, charStringsOffset).items.length;
  if (numGlyphs <= 1) return false;

  const view = new DataView(table.buffer, table.byteOffset, table.byteLength);
  const format = table[charsetOffset];
  // .notdef（GID 0 / CID 0）は charset に載らないので、載るのは GID 1..numGlyphs-1
  const covered = numGlyphs - 1;

  if (format === 0) {
    for (let i = 0; i < covered; i++) {
      view.setUint16(charsetOffset + 1 + i * 2, i + 1);
    }
    return true;
  }

  if (format === 1 || format === 2) {
    // 連続範囲で表す。identity は最小個数の範囲で表せるので、元の範囲群が占めていた
    // 領域に必ず収まる（元も同じ glyph 数を、範囲あたり同じ上限で覆っていたため）
    const maxLeft = format === 1 ? 0xff : 0xffff;
    const recordSize = format === 1 ? 3 : 4;
    let written = 0;
    let cursor = charsetOffset + 1;
    while (written < covered) {
      const nLeft = Math.min(maxLeft, covered - written - 1);
      view.setUint16(cursor, written + 1);
      if (format === 1) table[cursor + 2] = nLeft;
      else view.setUint16(cursor + 2, nLeft);
      cursor += recordSize;
      written += nLeft + 1;
    }
    return true;
  }

  return false;
}

/** sfnt のテーブルチェックサムと head.checkSumAdjustment を計算し直す */
function refreshSfntChecksums(font: Uint8Array): void {
  const view = new DataView(font.buffer, font.byteOffset, font.byteLength);
  const numTables = view.getUint16(4);

  const sum = (start: number, length: number): number => {
    let total = 0;
    const end = start + length;
    for (let p = start; p < end; p += 4) {
      const b0 = font[p] ?? 0;
      const b1 = font[p + 1] ?? 0;
      const b2 = font[p + 2] ?? 0;
      const b3 = font[p + 3] ?? 0;
      total = (total + (((b0 << 24) | (b1 << 16) | (b2 << 8) | b3) >>> 0)) >>> 0;
    }
    return total >>> 0;
  };

  let headRecord = -1;
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    let tag = '';
    for (let j = 0; j < 4; j++) tag += String.fromCharCode(font[rec + j]);
    const offset = view.getUint32(rec + 8);
    const length = view.getUint32(rec + 12);
    if (tag === 'head') {
      headRecord = rec;
      // head の checkSumAdjustment は 0 とみなして計算する
      view.setUint32(offset + 8, 0);
    }
    view.setUint32(rec + 4, sum(offset, length));
  }

  if (headRecord >= 0) {
    const headOffset = view.getUint32(headRecord + 8);
    const adjustment = (0xb1b0afba - sum(0, font.length)) >>> 0;
    view.setUint32(headOffset + 8, adjustment);
  }
}

// ---------------------------------------------------------------------------
// 本体
// ---------------------------------------------------------------------------

interface EmbeddedFont {
  /** Type0 フォント辞書 */
  type0: PDFDict;
  /** DescendantFonts[0]（CIDFont 辞書） */
  cidFont: PDFDict;
  descriptor: PDFDict;
  programRef: PDFRef;
  program: PDFRawStream;
}

/** 文書内の埋め込み合成フォント（Type0 → CIDFont → FontDescriptor → プログラム）を集める */
function collectEmbeddedFonts(doc: PDFDocument): EmbeddedFont[] {
  const found: EmbeddedFont[] = [];
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFDict)) continue;
    if (object.get(KEY.type)?.toString() !== '/Font') continue;
    if (object.get(KEY.subtype)?.toString() !== '/Type0') continue;

    const descendants = object.lookup(KEY.descendantFonts);
    if (!(descendants instanceof PDFArray) || descendants.size() === 0) continue;
    const cidFont = descendants.lookup(0);
    if (!(cidFont instanceof PDFDict)) continue;
    const descriptor = cidFont.lookup(KEY.fontDescriptor);
    if (!(descriptor instanceof PDFDict)) continue;

    for (const key of [KEY.fontFile2, KEY.fontFile3]) {
      const ref = descriptor.get(key);
      const stream = descriptor.lookup(key);
      if (ref === undefined || !(stream instanceof PDFRawStream)) continue;
      found.push({
        type0: object,
        cidFont,
        descriptor,
        programRef: ref as PDFRef,
        program: stream,
      });
      break;
    }
  }
  return found;
}

/**
 * 埋め込みフォントを ISO 32000-2 に合わせて是正する（B-14）。
 *
 * **`doc.save()` の直前に呼ぶこと。** pdf-lib はフォントを保存時（`flush()`）に
 * 初めて context へ書き出すため、それより前には辞書が存在しない。
 */
export async function normalizeEmbeddedFonts(doc: PDFDocument): Promise<FontConformanceResult> {
  await doc.flush();

  const result: FontConformanceResult = { fixed: 0, notes: [] };
  const usedTags = new Set<string>();

  for (const font of collectEmbeddedFonts(doc)) {
    const program = decodeStream(font.program);
    if (!program) {
      result.notes.push('An embedded font program could not be decoded; it was left unchanged.');
      continue;
    }

    let touched = false;

    // --- W-2: CFF ベースの OpenType を CIDFontType0 + FontFile3 /OpenType へ ---
    if (magic4(program) === OTTO) {
      const tables = sfntTables(program);
      if (!tables.has('CFF ')) {
        result.notes.push(
          'An OpenType font program declares the OTTO tag but has no "CFF " table; ' +
            'it was left unchanged.',
        );
      } else if (!tables.has('cmap')) {
        // Table 124（FontFile3 / OpenType）は CFF ベースのとき cmap を必須にしている。
        // 無いまま OpenType と名乗るのは別の shall 違反なので、触らずに報告する
        result.notes.push(
          'A CFF-based OpenType font program has no "cmap" table, which ISO 32000-2 ' +
            'Table 124 requires for a FontFile3 with subtype OpenType; it was left unchanged.',
        );
      } else {
        const bytes = new Uint8Array(program); // 破壊的に書き換えるので複製する
        const patched = makeCffCharsetIdentity(bytes, tables.get('CFF ') as SfntTable);
        if (patched) refreshSfntChecksums(bytes);

        const stream = doc.context.flateStream(bytes, { Subtype: 'OpenType' });
        const ref = doc.context.register(stream);
        font.descriptor.delete(KEY.fontFile2);
        font.descriptor.set(KEY.fontFile3, ref);
        font.cidFont.set(KEY.subtype, PDFName.of('CIDFontType0'));
        // CIDToGIDMap は Table 115 で CIDFontType2 専用
        font.cidFont.delete(KEY.cidToGidMap);
        font.program = stream as PDFRawStream;
        touched = true;
      }
    }

    // --- W-4: TrueType には Length1 が要る ---
    if (isTrueTypeProgram(program)) {
      if (!font.program.dict.has(KEY.length1)) {
        font.program.dict.set(KEY.length1, PDFNumber.of(program.length));
        touched = true;
      }
    }

    // --- W-3: サブセット名のタグ ---
    const rawName = font.descriptor.get(KEY.fontName)?.toString().replace(/^\//, '') ?? '';
    if (rawName && !TAGGED.test(rawName)) {
      const base = rawName.replace(RANDOM_SUFFIX, '');
      let salt = 0;
      let tag = subsetTag(program, salt);
      while (usedTags.has(tag)) tag = subsetTag(program, ++salt);
      usedTags.add(tag);

      const tagged = PDFName.of(`${tag}+${base}`);
      font.descriptor.set(KEY.fontName, tagged);
      font.cidFont.set(KEY.baseFont, tagged);
      font.type0.set(KEY.baseFont, tagged);
      touched = true;
    } else if (TAGGED.test(rawName)) {
      usedTags.add(rawName.slice(0, 6));
    }

    if (touched) result.fixed += 1;
  }

  if (result.fixed > 0) {
    logger.info(CTX, `Normalized ${result.fixed} embedded font(s) for ISO 32000-2 conformance`);
  }
  return result;
}
