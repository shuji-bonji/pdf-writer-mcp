/**
 * COS 値の作り手 — Phase 3（pdf-lib 撤去）の L3'。
 *
 * normativepdf は COS の**型**（`CosObject` の判別可能ユニオン）を公開しているが、
 * 値を作る関数は公開していない。生成パスは辞書と配列を数百箇所で組むので、
 * `{ kind: 'name', value: 'Type' }` を毎回手で書くと**読めなくなるほうが先に来る**。
 *
 * ここにあるのは短縮記法だけで、判断は 1 つも入っていない。
 * ⚠️ これは pdf-lib → COS の変換層ではない（handoff §6 で作らないと決めたもの）。
 * pdf-lib の値を受け取る関数はここに 1 つも無い。
 */

import type { CosArray, CosDict, CosObject, CosRef, CosStream } from 'normativepdf';

export const name = (value: string): CosObject => ({ kind: 'name', value });

/**
 * 整数。§7.3.3 は整数と実数を別の型に分けており、`/Count` や `/MCID` のように
 * **整数であることが要求されている**場所に 1.0 を書けないようにするため、
 * 実数と別の関数にしてある。
 */
export const int = (value: number): CosObject => {
  if (!Number.isInteger(value)) {
    throw new RangeError(`an integer object shall have no fractional part (§7.3.3); got ${value}`);
  }
  return { kind: 'integer', value };
};

/** 実数。整数値でも実数として書く（座標のように単位が連続な場所で使う）。 */
export const real = (value: number): CosObject => {
  if (!Number.isFinite(value)) {
    // §7.3.3 NOTE 3: 実数の範囲を超えた値の扱いは実装依存。NaN / Infinity は
    // そもそも書ける表記が無いので、黙って 0 にせず投げる。
    throw new RangeError(`a real object shall be a finite number (§7.3.3); got ${value}`);
  }
  return { kind: 'real', value };
};

/** 整数なら整数として、そうでなければ実数として書く。座標・寸法に使う。 */
export const num = (value: number): CosObject =>
  Number.isInteger(value) ? int(value) : real(value);

export const bool = (value: boolean): CosObject => ({ kind: 'boolean', value });

export const arr = (items: readonly CosObject[]): CosArray => ({ kind: 'array', items });

export const dict = (entries: Iterable<readonly [string, CosObject]>): CosDict => ({
  kind: 'dict',
  entries: new Map(entries),
});

export const stream = (
  entries: Iterable<readonly [string, CosObject]>,
  raw: Uint8Array,
): CosStream => ({
  kind: 'stream',
  dict: dict(entries),
  raw,
});

/**
 * リテラル文字列。**PDFDocEncoding で書ける範囲だけ**を通す。
 *
 * §7.9.2.2 Table 115: テキスト文字列は PDFDocEncoding か UTF-16BE（BOM 付き）で
 * 符号化する。範囲外の文字をバイトに畳むと、`/Title` の日本語が黙って化ける ——
 * だから畳まずに `utf16` を使わせる。
 */
export const literal = (text: string): CosObject => {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code > 0xff) {
      throw new RangeError(
        `"${text[i]}" (U+${code.toString(16).toUpperCase().padStart(4, '0')}) is outside PDFDocEncoding; a text string that needs it shall be UTF-16BE with a byte order mark (§7.9.2.2)`,
      );
    }
    bytes[i] = code;
  }
  return { kind: 'string', bytes, form: 'literal' };
};

/**
 * テキスト文字列（§7.9.2.2）。ASCII だけならリテラル、そうでなければ
 * **UTF-16BE + BOM** にする。どちらになるかを呼び出し側が選べないのは意図的で、
 * 選ばせると「日本語を入れたときだけ化ける」経路が残るため。
 *
 * 🔴 **UTF-16BE は 16 進文字列（`<FEFF…>`）で書く。** 符号化（§7.9.2.2）と
 * 字句の形（§7.3.4: リテラルか 16 進か）は別の決めごとで、どちらでも読める。
 * それでも 16 進にするのは、UTF-16BE のバイト列にはリテラルで書くと
 * `\376\377` のような 8 進エスケープが並ぶバイトが多く含まれ、
 * **同じ内容が「読める形」と「エスケープだらけの形」の 2 通りになる**ためである。
 * 2026-08-15 にリテラルのまま出していたのを直した（`tests/spec-audit.test.ts` の
 * §12.5.6.2 が 16 進表記で CR を確かめており、そこで落ちた）。
 */
export const textString = (text: string): CosObject => {
  if (/^[\x20-\x7e\n\r\t]*$/.test(text)) return literal(text);
  const units: number[] = [0xfe, 0xff];
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number;
    if (cp > 0xffff) {
      const v = cp - 0x10000;
      const hi = 0xd800 + (v >> 10);
      const lo = 0xdc00 + (v & 0x3ff);
      units.push(hi >> 8, hi & 0xff, lo >> 8, lo & 0xff);
    } else {
      units.push(cp >> 8, cp & 0xff);
    }
  }
  return { kind: 'string', bytes: new Uint8Array(units), form: 'hex' };
};

/** 16 進文字列（§7.3.4.3）。グリフ番号の並びのように、バイトが文字でないものに使う。 */
export const hex = (bytes: Uint8Array): CosObject => ({ kind: 'string', bytes, form: 'hex' });

export const ref = (objectNumber: number, generationNumber = 0): CosRef => ({
  kind: 'ref',
  objectNumber,
  generationNumber,
});

/** `[llx lly urx ury]`（§7.9.5 Rectangle）。 */
export const rect = (llx: number, lly: number, urx: number, ury: number): CosArray =>
  arr([num(llx), num(lly), num(urx), num(ury)]);
