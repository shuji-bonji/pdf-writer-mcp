/**
 * sfnt と CFF のバイト操作 —— Phase 3 の L4′.3。
 *
 * `font-conformance.ts`（pdf-lib が書いた辞書を保存前に是正するもの）から、
 * **pdf-lib に依らない部分だけ**を取り出した。新しい生成パスは `buildType0Font` が
 * バイト列から辞書の型を導くので是正そのものは要らなくなったが、
 * **CFF の charset を identity にする書き換え（W-2）は残る** ——
 * これはフォントプログラム側の話で、辞書の書き方とは別の問題だからである。
 *
 * ## W-2: CID-keyed CFF の charset
 *
 * §9.7.4.2: CIDFontType0 の埋め込みプログラムは、CID を glyph index に対応させる。
 * harfbuzz でサブセットした CFF は charset に元のフォントの SID/CID を残すので、
 * Identity-H で番号をそのまま渡すと**別の字が出る**。charset を恒等（GID = CID）に
 * 書き換えて揃える。
 *
 * 🔴 **書き換えたらチェックサムを取り直す。** sfnt はテーブルごとの checkSum と
 * head の checkSumAdjustment を持つ。片方だけ直すと「自分の宣言と合わない
 * フォントプログラム」になる。
 */

import { logger } from '../utils/logger.js';

const CTX = 'SfntCff';

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
/**
 * サブセット済み CFF プログラムの charset を identity へ書き換える（バイト列だけを触る）。
 *
 * **生成パス（L3'）から呼ぶための入口。** 編集パスは `normalizeEmbeddedFonts` が
 * 「pdf-lib が書いた辞書を後から是正する」流れの中でこれを行うが、生成パスは
 * `buildType0Font` が辞書をバイト列から導くので是正そのものが要らない。
 * **要らないのは辞書の話で、charset の書き換えは別の仕事である** ——
 * それを一緒に捨てると、CID → charset → GID（R-9.7.4.2-4）で解決する処理系が
 * 別のグリフを描く。W-2 と同じ死角で、寛容なビューアでは気づけない。
 *
 * @returns 書き換えたら true（CID-keyed でない・Identity ROS などでは false）
 */
export function makeSubsetCharsetIdentity(program: Uint8Array): boolean {
  const cff = sfntTables(program).get('CFF ');
  if (cff === undefined) return false;
  const patched = makeCffCharsetIdentity(program, cff);
  // 🔴 **書き換えたらチェックサムを取り直す。** sfnt はテーブルごとの checkSum と
  // head の checkSumAdjustment を持っており、中身を変えたまま放置すると
  // 「自分の宣言と合わないフォントプログラム」になる。`normalizeEmbeddedFonts` は
  // この 2 つを 1 組で行っており、片方だけ移すと差が静かに残る（実測: 長さは同じで
  // sha256 だけ変わる = チェックサム欄しか違わない、という形で oracle に出た）。
  if (patched) refreshSfntChecksums(program);
  return patched;
}

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
