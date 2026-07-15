/**
 * subset-font の型宣言（本体は型定義を同梱していないため最小限を自前で用意）
 * @see https://github.com/papandreou/subset-font
 */
declare module 'subset-font' {
  interface SubsetFontOptions {
    /** 出力フォーマット。'sfnt' は入力のアウトライン形式（CFF/glyf）を維持する */
    targetFormat?: 'sfnt' | 'woff' | 'woff2' | 'truetype';
    /** OpenType feature タグの指定（省略時は既定のフィーチャを保持） */
    preserveNameIds?: number[];
    variationAxes?: Record<string, number | { min: number; max: number; default: number }>;
  }

  /**
   * harfbuzz(wasm) を用いて、text に含まれる文字のグリフだけを残したフォントを返す。
   */
  export default function subsetFont(
    font: Buffer,
    text: string,
    options?: SubsetFontOptions
  ): Promise<Buffer>;
}
