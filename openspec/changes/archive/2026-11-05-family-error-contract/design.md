# Design

## 応答の形

```jsonc
{
  "error": "Cannot read PDF file: /path/to/no-such-file.pdf",
  "code": "DOC_NOT_FOUND",
  "retryable": false,
  "next_actions": [
    {
      "action": "verify_file_path",
      "reason": "Check that the file path is correct and absolute.",
      "example": { "inputPath": "/path/to/no-such-file.pdf" }
    }
  ]
}
```

名前を変えたコードが無いので、verify・spec のような旧名の併記（`detail.legacyCode`）は付けません。

## `retryable` の値

規約の定義は「引数・フラグ・環境を変えれば成功しうるか」です。verify 0.33.0 と同じく「同じ文書についての同じ処理が成功しうるか」で決めます。

| `code` | `retryable` | 0.23.2 | 理由 |
| --- | --- | --- | --- |
| `INVALID_ARGUMENT` | `true` | 1 か所だけ `true` | 引数を直せば通る |
| `FONT_REQUIRED` | `true` | `true` | `fontPath` を渡せば通る |
| `FONT_NOT_FOUND` | `true` | 無い | 別のフォントのパスを渡せば同じ文書を処理できる |
| `MISSING_GLYPH` | `true` | `true` | `onMissingGlyph` か別のフォントで通る |
| `SIGNED_PDF` | `true` | `true` | `preserveSignatures` / `allowBreakingSignatures` で通る |
| `TAGGED_PDF` | `true` | `true` | `allowBreakingTags` で通る |
| `DOC_NOT_FOUND` | `false` | 無い | verify 0.33.0 と §2.3 の例に合わせる（2026-11-05 本人の判断。#14 の目安は `true` だった） |
| `INVALID_PDF` | `false` | 無い | 文書についての所見 |
| `ENCRYPTED_PDF` | `false` | 無い | writer には `password` 引数が無い |
| `UNSUPPORTED_PDF_FEATURE` | `false` | 無い | writer が扱わない機能 |
| `FILE_TOO_LARGE` | `false` | 無い | 上限は利用者が変えられない |
| `INTERNAL_ERROR` | `false` | 無い | サーバーの故障 |

表は `src/errors.ts` に `Record<WriterErrorCode, boolean>` で置き、`toStructuredError` が `code` から引きます。`Record` なので、コードを足して値を書き忘れると型検査で落ちます。`PdfWriterError` の `options` から `retryable` を外し、エラーを作る箇所（8 か所。提案の時点では 7 か所と数えていた）の `retryable: true` を消します（どれも表の値と同じ）。`WriterServiceError.retryable` は必須にします。

## 文面

`NEXT_ACTIONS` の `reason` 6 件を英語にします。内容（どのツールが増分更新に対応するか、`PDF_WRITER_FONT` の環境変数、`replace` / `ignore` の意味）は落としません。`action` と `example` は変えません。

## ライブラリの制約と仕様の制約

- 仕様の制約: なし。エラーの形は MCP の仕様（ツール結果の `isError`）と family の規約で決まり、PDF の条文には依らない。
- ライブラリの制約: なし。エラーはすべて `src/server.ts` の 1 か所（`toStructuredError`）を通るので、ハンドラは変えない。
