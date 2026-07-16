/**
 * subset-font の型宣言（本体は型定義を同梱していないため最小限を自前で用意）
 * @see https://github.com/papandreou/subset-font
 */
declare module 'subset-font' {
  interface SubsetFontOptions {
    /** 出力フォーマット。'sfnt' は入力のアウトライン形式（CFF/glyf）を維持する */
    targetFormat?: 'sfnt' | 'woff' | 'woff2' | 'truetype';
    /** 残す name テーブルの nameId */
    preserveNameIds?: number[];
    /**
     * HB_SUBSET_FLAGS_NO_LAYOUT_CLOSURE 相当。
     * GSUB 等のレイアウト機能から到達するグリフをサブセットに含めない。
     */
    noLayoutClosure?: boolean;
    variationAxes?: Record<string, number | { min: number; max: number; default: number }>;
  }

  /**
   * harfbuzz(wasm) を用いて、text に含まれる文字のグリフだけを残したフォントを返す。
   */
  export default function subsetFont(
    font: Buffer,
    text: string,
    options?: SubsetFontOptions,
  ): Promise<Buffer>;
}
