---
spec_id: WRITER
kind: common
introduced_by: family-error-contract
---
# common-errors Specification

## Purpose

20 ツールに共通する、失敗の返し方を定めます。エラー応答の形を PDF family で 1 つにそろえ、受け側が reader・verify・spec と同じ読み方で writer のエラーを読めるようにすることが目的です。ツール結果 `isError: true` の本文は PDF family の規約（pdf-agent-stack `docs/specs/06` §2.3）の平らな形にし、`retryable` を `code` ごとに決めた 1 つの値で必ず書き、`error`・`hint`・`next_actions[].reason` を英語で書きます。
writer 固有のガード（`SIGNED_PDF`・`TAGGED_PDF`・`FONT_REQUIRED`・`FONT_NOT_FOUND`・`MISSING_GLYPH`）は、フラグや引数を変えれば同じ編集が通るので `retryable: true` です。ガードの多くは `next_actions` に、解除のフラグや引数の例を載せます。受け側の Skill（pdf-publish など）は `next_actions[].action` と `example` で再試行を組み立てるので、これらの値は変えません。SDK がハンドラより前に拒む入力検証の失敗（相対パス・宣言に無いキーなど）は、この capability の対象外です（§2.11）。

## Requirements

### Requirement: SPEC-WRITER-COMMON-ERRORS-001 エラー応答の本文は family の平らな形にする

20 ツールのハンドラが返す失敗は、ツール結果の `isError: true` で返し、`content` の text を JSON のオブジェクトにする（SHALL）。最上位には `error`（空でない文字列）・`code`（文字列）・`retryable`（真偽値）を必ず書き、任意で `hint`（文字列）・`next_actions`（`{ action, reason, example? }` の配列）・`detail`（オブジェクト）を書く（SHALL）。最上位にこれ以外の項目を置かない（SHALL）。根拠は pdf-agent-stack `docs/specs/06` §2.3。

#### Scenario: 存在しないパスのエラーが形どおり

- **WHEN** `rotate_pages` に存在しない絶対パスを渡す
- **THEN** `isError` が `true` で、本文の `code` は `DOC_NOT_FOUND`、`error` は空でない文字列、`retryable` は真偽値、最上位の項目は `error`・`code`・`retryable`・`hint`・`next_actions`・`detail` のどれか

#### Scenario: PDF でないファイルのエラーが形どおり

- **WHEN** `rotate_pages` に中身が英文のテキストのファイルを渡す
- **THEN** `code` は `INVALID_PDF` で、`retryable` は真偽値

#### Scenario: 故障のエラーも形どおり

- **WHEN** ハンドラの中で `PdfWriterError` でない例外が投げられる
- **THEN** `code` は `INTERNAL_ERROR`、`error` は例外の文、`retryable` は `false`

### Requirement: SPEC-WRITER-COMMON-ERRORS-002 retryable は code ごとに 1 つの値にする

`retryable` は、引数・フラグ・環境を変えれば同じ文書についての同じ処理が成功しうるかを表し、`code` ごとに 1 つの値に決める（SHALL）。`INVALID_ARGUMENT`・`FONT_REQUIRED`・`FONT_NOT_FOUND`・`MISSING_GLYPH`・`SIGNED_PDF`・`TAGGED_PDF` は `true`、`DOC_NOT_FOUND`・`INVALID_PDF`・`ENCRYPTED_PDF`・`UNSUPPORTED_PDF_FEATURE`・`FILE_TOO_LARGE`・`INTERNAL_ERROR` は `false` にする（SHALL）。

#### Scenario: 存在しないパスは再試行できない

- **WHEN** `rotate_pages` に存在しない絶対パスを渡す
- **THEN** `retryable` は `false`

#### Scenario: 文書の所見は再試行できない

- **WHEN** `rotate_pages` に 0 バイトのファイルを渡す
- **THEN** `code` は `INVALID_PDF`、`retryable` は `false`

#### Scenario: フラグで解けるガードは再試行できる

- **WHEN** 日本語の本文を、フォントを渡さずに `create_text_pdf` に渡す
- **THEN** `code` は `FONT_REQUIRED`、`retryable` は `true`

#### Scenario: すべての code に値が決まっている

- **WHEN** サーバーが返しうる `code` を 1 つずつ確かめる
- **THEN** どの `code` にも `retryable` の値が 1 つ決まっている

### Requirement: SPEC-WRITER-COMMON-ERRORS-003 文の項目は英語で書き、分岐に使う値は変えない

エラーの本文の `error`・`hint`・`next_actions[].reason` は英語で書く（SHALL）。受け側が分岐と再試行に使う `next_actions[].action` の値（`retry_with_preserveSignatures`・`retry_with_allowBreakingSignatures`・`retry_with_allowBreakingTags`・`retry_with_fontPath`・`retry_with_onMissingGlyph`・`verify_file_path`）と `example` は変えない（SHALL）。

#### Scenario: next_actions の reason は英語

- **WHEN** `NEXT_ACTIONS` の 6 つの手を 1 つずつ作る
- **THEN** どの `reason` にも、かな・漢字が無い

#### Scenario: next_actions の action と example は変わらない

- **WHEN** `NEXT_ACTIONS` の 6 つの手を 1 つずつ作る
- **THEN** `action` と `example` は 0.23.2 と同じ値

#### Scenario: フォントが要るときの本文はすべて英語

- **WHEN** 日本語の本文を、フォントを渡さずに `create_text_pdf` に渡す
- **THEN** 本文の `error`・`hint`・`next_actions[].reason` にかな・漢字が無く、`next_actions[0].action` は `retry_with_fontPath`
