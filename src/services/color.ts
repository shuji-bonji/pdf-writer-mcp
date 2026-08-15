/**
 * 描画色 — Phase 3（pdf-lib 撤去）の L1 で切り出し、L3' で変換関数が消えた。
 *
 * **なぜ独自の型を置くのか。**
 * 色は PDF の意味を持たない値である（DeviceRGB の 3 成分・ISO 32000-2 §8.6.4.3）。
 * それを pdf-lib の `rgb()` で作っていたために、**本文の見た目を決めるだけの
 * ファイル 8 つが pdf-lib を import していた** — レンダラ 3 本（`renderers/{markdown,table,text}.ts`）は
 * `rgb` **しか**使っていない。ここを自前の値にすると、その 3 本から pdf-lib が丸ごと消える。
 *
 * **変換は 1 箇所に閉じる。** ⚠️ 当初は「描画境界は `layout.ts` だけ」と踏んでいたが、
 * **型検査が否定した** — `renderers/{markdown,table}.ts` は `engine.page.drawRectangle` /
 * `drawText` を直接呼んでおり、描画境界は 4 箇所ある。想定でなく実測で決まったので、
 * 変換関数はこのファイルに置き、**pdf-lib の色の形を知るファイルをここ 1 つに**した。
 * 生成パスを normativepdf に載せ替えたら、この関数の中身が「`rg` / `RG` 演算子を書く」に
 * 変わるだけで、呼び出し側は 1 行も動かない。
 *
 * ⚠️ これは pdf-lib → COS の変換層ではない（handoff §6 で作らないと決めたもの）。
 * 変換しているのは**数値 3 つ**であって、オブジェクトモデルではない。
 */

/** DeviceRGB の 3 成分。各 0.0〜1.0（§8.6.4.3）。 */
export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/**
 * 成分から色を作る。範囲外は**丸めずに拒む** — 0〜1 の外の値は
 * 「意図した薄さ」ではなく単位の取り違え（0〜255 で書いた）である場合がほとんどで、
 * 黙って飽和させると本文が真っ黒や真っ白になったまま気づけない。
 */
export function rgb01(r: number, g: number, b: number): Rgb {
  for (const [name, value] of [
    ['r', r],
    ['g', g],
    ['b', b],
  ] as const) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new RangeError(
        `DeviceRGB component ${name} must be in 0..1 (§8.6.4.3); got ${value}. 0-255 values need dividing by 255`,
      );
    }
  }
  return { r, g, b };
}

/**
 * `#rrggbb` / `#rgb` を解く。ツールの入口（Zod 検証済みの文字列）から使う。
 * 短縮形を受けるのは、以前 `annotation.ts` にあった `parseHexColor` がそうだったから —
 * **色の表現をコードベースに 2 つ持たない**ために、こちらへ吸収した。
 */
export function rgbFromHex(hex: string): Rgb {
  const match = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex.trim());
  if (match === null) {
    throw new RangeError(`colour must be a hex string like "#ffcc00"; got ${JSON.stringify(hex)}`);
  }
  const digits = match[1] as string;
  const full =
    digits.length === 3
      ? digits[0] + digits[0] + digits[1] + digits[1] + digits[2] + digits[2]
      : digits;
  const value = Number.parseInt(full, 16);
  return {
    r: ((value >> 16) & 0xff) / 255,
    g: ((value >> 8) & 0xff) / 255,
    b: (value & 0xff) / 255,
  };
}

/** よく使う色。文字列リテラルを散らかさないため。 */
export const COLORS = {
  bodyText: rgb01(0.1, 0.1, 0.1),
  heading: rgb01(0.05, 0.05, 0.05),
  mutedText: rgb01(0.4, 0.4, 0.4),
  codeText: rgb01(0.15, 0.15, 0.2),
  codeBackground: rgb01(0.95, 0.95, 0.96),
  tableHeaderBackground: rgb01(0.93, 0.93, 0.96),
  tableBorder: rgb01(0.7, 0.7, 0.72),
  tableText: rgb01(0.15, 0.15, 0.15),
  rule: rgb01(0.75, 0.75, 0.75),
} as const satisfies Record<string, Rgb>;
