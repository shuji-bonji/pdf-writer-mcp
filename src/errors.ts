/**
 * family-compatible 構造化エラー応答（E-2） — pdf-writer-mcp 実装
 *
 * 設計指針:
 * - pdf-reader-mcp v0.6.0 の error contract に準拠（`code` 文字列を共有）
 * - 共通パッケージ依存を持たない独立実装
 * - writer 固有のコード（SIGNED_PDF / TAGGED_PDF / FONT_REQUIRED /
 *   MISSING_GLYPH）を追加。いずれも「明示フラグや引数の追加で再試行できる」
 *   ガード系で、`retryable: true` + `next_actions` により出力パイプライン
 *   Skill / LLM エージェントが自律的に分岐できる。
 *
 * family contract 仕様:
 * @see https://github.com/shuji-bonji/houki-research-skill/blob/main/docs/ERROR-CODES.md
 */

/** family 共通コードの部分集合 + writer 固有拡張 */
export type WriterErrorCode =
  // 引数・入力（クライアント責任）
  | 'INVALID_ARGUMENT'
  // リソース未発見
  | 'DOC_NOT_FOUND'
  | 'FONT_NOT_FOUND'
  // PDF コンテンツ
  | 'INVALID_PDF'
  | 'ENCRYPTED_PDF'
  | 'UNSUPPORTED_PDF_FEATURE'
  | 'FILE_TOO_LARGE'
  // writer 固有ガード（フラグ・引数の追加で再試行可能）
  | 'SIGNED_PDF'
  | 'TAGGED_PDF'
  | 'FONT_REQUIRED'
  | 'MISSING_GLYPH'
  // システム
  | 'INTERNAL_ERROR';

/** 次に取るべきアクションの提案。LLM が読んで自律的に再試行することを想定 */
export interface NextAction {
  /** 推奨アクション（tool 名 or 自然言語） */
  action: string;
  /** どんなときに有効か */
  reason: string;
  /** 具体的な引数例（任意） */
  example?: Record<string, unknown>;
}

/** family-compatible 共通エラー応答 */
export interface WriterServiceError {
  /** 1文の人間可読メッセージ（LLM もここを読む） */
  error: string;
  /** プログラム判定用の安定したコード */
  code: WriterErrorCode;
  /** 追加情報（任意） */
  hint?: string;
  /** LLM が次に取るべき手段の候補 */
  next_actions?: NextAction[];
  /** フラグや引数を変えれば再試行できるか */
  retryable?: boolean;
}

/** コード・ヒント・next_actions を運ぶ writer 固有の Error */
export class PdfWriterError extends Error {
  constructor(
    message: string,
    public readonly code: WriterErrorCode,
    public readonly options: {
      hint?: string;
      next_actions?: NextAction[];
      retryable?: boolean;
    } = {},
  ) {
    super(message);
    this.name = 'PdfWriterError';
  }
}

/** 引数エラーの短縮形（validation.ts / page-spec.ts の大量の検査で使う） */
export function invalidArg(message: string): PdfWriterError {
  return new PdfWriterError(message, 'INVALID_ARGUMENT');
}

/** 投げられた値を family 形式のエラー応答へ変換する */
export function toStructuredError(error: unknown): WriterServiceError {
  if (error instanceof PdfWriterError) {
    const out: WriterServiceError = { error: error.message, code: error.code };
    if (error.options.hint) out.hint = error.options.hint;
    if (error.options.next_actions && error.options.next_actions.length > 0) {
      out.next_actions = error.options.next_actions;
    }
    if (error.options.retryable !== undefined) out.retryable = error.options.retryable;
    return out;
  }
  if (error instanceof Error) {
    return { error: error.message, code: 'INTERNAL_ERROR' };
  }
  return { error: String(error), code: 'INTERNAL_ERROR' };
}

/** よく使う next_actions のプリセット（writer のガード解除フラグ群） */
export const NEXT_ACTIONS = {
  allowBreakingSignatures: (): NextAction => ({
    action: 'retry_with_allowBreakingSignatures',
    reason:
      '署名を無効化してよい場合のみ、同じ引数に "allowBreakingSignatures": true を足して再試行してください',
    example: { allowBreakingSignatures: true },
  }),
  allowBreakingTags: (): NextAction => ({
    action: 'retry_with_allowBreakingTags',
    reason: 'PDF/UA 適合を壊してよい場合のみ、"allowBreakingTags": true を足して再試行してください',
    example: { allowBreakingTags: true },
  }),
  provideFontPath: (): NextAction => ({
    action: 'retry_with_fontPath',
    reason:
      '非 Latin 文字（日本語等）には埋め込みフォントが必要です。"fontPath" に .ttf/.otf を指定するか、環境変数 PDF_WRITER_FONT を設定してください',
    example: { fontPath: '/path/to/NotoSansJP-Regular.otf' },
  }),
  changeMissingGlyphPolicy: (): NextAction => ({
    action: 'retry_with_onMissingGlyph',
    reason:
      'フォントに無い文字が本文に含まれます。別のフォントを指定するか、"onMissingGlyph": "replace"（豆腐で置換）/ "ignore"（黙って除去）を指定してください',
    example: { onMissingGlyph: 'replace' },
  }),
  checkFilePath: (path?: string): NextAction => ({
    action: 'verify_file_path',
    reason: 'ファイルパスが正しいか、絶対パスで指定されているか確認してください',
    example: path ? { inputPath: path } : undefined,
  }),
} as const;
