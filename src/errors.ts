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
  /**
   * 引数・フラグ・環境を変えれば、同じ文書についての同じ処理が成功しうるか。
   * 値は `code` ごとに 1 つ（`RETRYABLE`）。SPEC-WRITER-COMMON-ERRORS-002
   */
  retryable: boolean;
  /** 書くことがあるときだけ置く（SPEC-WRITER-COMMON-ERRORS-005・006） */
  detail?: ErrorDetail;
}

/**
 * ファイルシステムのエラーの細かい理由（SPEC-WRITER-COMMON-ERRORS-006）。
 * 🔴 pdf-reader-mcp の入力側（#49）と同じ値を使う。family で値をそろえる。
 */
export type FileSystemReason =
  | 'PERMISSION_DENIED'
  | 'NOT_A_DIRECTORY'
  | 'IS_A_DIRECTORY'
  | 'READ_ONLY_FILESYSTEM'
  | 'NO_SPACE'
  | 'FILESYSTEM_ERROR';

/** `detail` に置く項目 */
export interface ErrorDetail {
  /** ファイルシステムのエラーの理由 */
  reason?: FileSystemReason;
  /** 書けなかった（読めなかった）パス */
  path?: string;
  /** 元の例外の文（`EACCES: permission denied, open '…'` など） */
  cause?: string;
  /** 全書き直しで組み直せなかった入力と、書くはずだった出力 */
  inputPath?: string;
  outputPath?: string;
  /** `ENCRYPTED_PDF`: 空の利用者パスワードで鍵を導けたか（ISO 32000-2 §7.6.4.3.2） */
  keyDerived?: boolean;
}

/**
 * `retryable` の値。**code ごとに 1 つ**で、エラーを作る箇所では選ばせない
 * （0.23.2 までは作る箇所ごとに書くか決めていて、書かないエラーがあった。#14）。
 *
 * 決め方は verify 0.33.0 と同じ「同じ文書についての同じ処理が成功しうるか」。
 * - `DOC_NOT_FOUND` は false（verify と §2.3 の例に合わせた。2026-11-05 決定）
 * - `FONT_NOT_FOUND` は true（別のフォントのパスを渡せば同じ文書を処理できる）
 * - `ENCRYPTED_PDF` は false（writer には password 引数が無い）
 *
 * `Record` なので、code を足して値を書き忘れると型検査で落ちる。
 */
export const RETRYABLE: Readonly<Record<WriterErrorCode, boolean>> = {
  INVALID_ARGUMENT: true,
  FONT_REQUIRED: true,
  FONT_NOT_FOUND: true,
  MISSING_GLYPH: true,
  SIGNED_PDF: true,
  TAGGED_PDF: true,
  DOC_NOT_FOUND: false,
  INVALID_PDF: false,
  ENCRYPTED_PDF: false,
  UNSUPPORTED_PDF_FEATURE: false,
  FILE_TOO_LARGE: false,
  INTERNAL_ERROR: false,
};

/** コード・ヒント・next_actions を運ぶ writer 固有の Error */
export class PdfWriterError extends Error {
  constructor(
    message: string,
    public readonly code: WriterErrorCode,
    public readonly options: {
      hint?: string;
      next_actions?: NextAction[];
      detail?: ErrorDetail;
    } = {},
  ) {
    super(message);
    this.name = 'PdfWriterError';
  }
}

const ERRNO_REASON: Readonly<Record<string, FileSystemReason>> = {
  EACCES: 'PERMISSION_DENIED',
  EPERM: 'PERMISSION_DENIED',
  ENOTDIR: 'NOT_A_DIRECTORY',
  // `mkdir(…, { recursive: true })` は、作るはずのフォルダーの位置にファイルがあると
  // ENOTDIR ではなく EEXIST を返す（Node 22 で実測）。書き出しで EEXIST が出るのはこの場合だけ
  EEXIST: 'NOT_A_DIRECTORY',
  EISDIR: 'IS_A_DIRECTORY',
  EROFS: 'READ_ONLY_FILESYSTEM',
  ENOSPC: 'NO_SPACE',
};

const REASON_TEXT: Readonly<Record<FileSystemReason, string>> = {
  PERMISSION_DENIED: 'permission denied',
  NOT_A_DIRECTORY: 'a part of the path is a file, not a folder',
  IS_A_DIRECTORY: 'the path is a folder',
  READ_ONLY_FILESYSTEM: 'the file system is read-only',
  NO_SPACE: 'no space left on the device',
  FILESYSTEM_ERROR: 'the file system refused the write',
};

/**
 * 出力のファイルを書けなかったときのエラー（SPEC-WRITER-COMMON-ERRORS-006）。
 *
 * 0.23.x は `writeFile` の例外を素通しして `INTERNAL_ERROR` にしていた。書けないのは
 * サーバーの故障ではなく、出力先を変えるか権限を直せば同じ処理が通る状況なので、
 * family の決定（2026-11-06）どおり `INVALID_ARGUMENT`（`retryable: true`）にする。
 * 名指すのは**出力のパス**（入力のパスではない）。
 */
export function outputWriteError(path: string, error: unknown): PdfWriterError {
  const errno = (error as { code?: unknown } | null)?.code;
  const reason = (typeof errno === 'string' && ERRNO_REASON[errno]) || 'FILESYSTEM_ERROR';
  const cause = error instanceof Error ? error.message : String(error);
  return new PdfWriterError(
    `Cannot write the output file "${path}": ${REASON_TEXT[reason]}${typeof errno === 'string' ? ` (${errno})` : ''}`,
    'INVALID_ARGUMENT',
    {
      hint: 'Pass an outputPath in a folder this server can write to, or fix the permissions of the folder.',
      detail: { reason, path, cause },
    },
  );
}

/** 引数エラーの短縮形（validation.ts / page-spec.ts の大量の検査で使う） */
export function invalidArg(message: string): PdfWriterError {
  return new PdfWriterError(message, 'INVALID_ARGUMENT');
}

/** 投げられた値を family 形式のエラー応答へ変換する */
export function toStructuredError(error: unknown): WriterServiceError {
  if (error instanceof PdfWriterError) {
    const out: WriterServiceError = {
      error: error.message,
      code: error.code,
      retryable: RETRYABLE[error.code],
    };
    if (error.options.hint) out.hint = error.options.hint;
    if (error.options.next_actions && error.options.next_actions.length > 0) {
      out.next_actions = error.options.next_actions;
    }
    if (error.options.detail && Object.keys(error.options.detail).length > 0) {
      out.detail = error.options.detail;
    }
    return out;
  }
  if (error instanceof Error) {
    return { error: error.message, code: 'INTERNAL_ERROR', retryable: RETRYABLE.INTERNAL_ERROR };
  }
  return { error: String(error), code: 'INTERNAL_ERROR', retryable: RETRYABLE.INTERNAL_ERROR };
}

/**
 * よく使う next_actions のプリセット（writer のガード解除フラグ群）
 *
 * 🔴 `action` と `example` は pdf-publish Skill（references/error-codes.md）が分岐と
 * 再試行に使う。値を変えない。`reason` は英語で書く（§2.3・F-10。
 * SPEC-WRITER-COMMON-ERRORS-003）。
 */
export const NEXT_ACTIONS = {
  preserveSignatures: (): NextAction => ({
    action: 'retry_with_preserveSignatures',
    reason:
      'The edit can keep the signatures by an incremental update, which appends to the file ' +
      'without touching the original bytes. Supported by add_annotation / set_metadata / ' +
      'add_bookmarks / tag_form_fields (tagged documents included). Add ' +
      '"preserveSignatures": true and call again.',
    example: { preserveSignatures: true },
  }),
  allowBreakingSignatures: (): NextAction => ({
    action: 'retry_with_allowBreakingSignatures',
    reason:
      'Only if invalidating the signatures is acceptable: call again with the same arguments ' +
      'plus "allowBreakingSignatures": true.',
    example: { allowBreakingSignatures: true },
  }),
  allowBreakingTags: (): NextAction => ({
    action: 'retry_with_allowBreakingTags',
    reason:
      'Only if breaking PDF/UA conformance is acceptable: call again with ' +
      '"allowBreakingTags": true.',
    example: { allowBreakingTags: true },
  }),
  provideFontPath: (): NextAction => ({
    action: 'retry_with_fontPath',
    reason:
      'Non-Latin text (Japanese, for example) needs an embedded font. Pass a .ttf/.otf file ' +
      'as "fontPath", or set the PDF_WRITER_FONT environment variable.',
    example: { fontPath: '/path/to/NotoSansJP-Regular.otf' },
  }),
  changeMissingGlyphPolicy: (): NextAction => ({
    action: 'retry_with_onMissingGlyph',
    reason:
      'The text has characters the font does not contain. Pass a different font, or set ' +
      '"onMissingGlyph" to "replace" (draw a replacement box) or "ignore" (drop them silently).',
    example: { onMissingGlyph: 'replace' },
  }),
  checkFilePath: (path?: string): NextAction => ({
    action: 'verify_file_path',
    reason: 'Check that the file path is correct and absolute, and that the file exists.',
    example: path ? { inputPath: path } : undefined,
  }),
} as const;
