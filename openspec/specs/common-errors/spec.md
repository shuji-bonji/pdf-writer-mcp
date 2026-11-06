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

エラーの本文の `error`・`hint`・`next_actions[].reason` は英語で書く（SHALL）。ただし `error` が原因として名指す入力の字（`"<字>" (U+XXXX)` の `<字>`。`FONT_REQUIRED`・`MISSING_GLYPH`）は入力をそのまま引いたもので、英語で書く対象に含めない。受け側が分岐と再試行に使う `next_actions[].action` の値（`retry_with_preserveSignatures`・`retry_with_allowBreakingSignatures`・`retry_with_allowBreakingTags`・`retry_with_fontPath`・`retry_with_onMissingGlyph`・`verify_file_path`）と `example` は変えない（SHALL）。

#### Scenario: next_actions の reason は英語

- **WHEN** `NEXT_ACTIONS` の 6 つの手を 1 つずつ作る
- **THEN** どの `reason` にも、かな・漢字が無い

#### Scenario: next_actions の action と example は変わらない

- **WHEN** `NEXT_ACTIONS` の 6 つの手を 1 つずつ作る
- **THEN** `action` と `example` は 0.23.2 と同じ値

#### Scenario: フォントが要るときの本文はすべて英語

- **WHEN** 日本語の本文を、フォントを渡さずに `create_text_pdf` に渡す
- **THEN** 本文の `error`（名指した入力の字を除く）・`hint`・`next_actions[].reason` にかな・漢字が無く、`next_actions[0].action` は `retry_with_fontPath`

### Requirement: SPEC-WRITER-COMMON-ERRORS-004 編集の入口は、暗号化を署名より先に確かめる

既存の PDF を編集するツールは、trailer の `/Encrypt`（ISO 32000-2 §7.5.5 Table 15）を、`/ByteRange` による署名の確認より先に確かめる（SHALL）。暗号化された文書は `preserveSignatures`・`allowBreakingSignatures` の有無にかかわらず `ENCRYPTED_PDF` で断り、実行できない再試行を `next_actions` で案内しない（SHALL）。

#### Scenario: 署名付きの暗号化文書は ENCRYPTED_PDF

- **WHEN** `/ByteRange` を含み、空の利用者パスワードで暗号化された文書を `set_metadata` に渡す
- **THEN** `code` は `ENCRYPTED_PDF` で、`next_actions` に `retry_with_preserveSignatures` が無い

#### Scenario: 暗号化されていない署名付き文書は今までどおり SIGNED_PDF

- **WHEN** `/ByteRange` を含む暗号化されていない文書を `set_metadata` に渡す
- **THEN** `code` は `SIGNED_PDF` で、`next_actions[0].action` は `retry_with_preserveSignatures`

### Requirement: SPEC-WRITER-COMMON-ERRORS-005 暗号化文書の拒否は、鍵を導けたかを分けて返す

`ENCRYPTED_PDF` の本文の `detail.keyDerived` に、空の利用者パスワードで鍵を導けたか（ISO 32000-2 §7.6.4.3.2）を真偽値で書く（SHALL）。`hint` は 2 つで分け、導けた文書には writer の外で復号すれば編集できることと、読むだけなら pdf-reader-mcp・pdf-verify-mcp がそのまま読めることを、導けない文書には利用者パスワードで復号してから渡すことを書く（SHALL）。

#### Scenario: 鍵を導ける暗号化文書

- **WHEN** 空の利用者パスワードで暗号化された文書を `set_metadata` に渡す
- **THEN** `code` は `ENCRYPTED_PDF`、`detail.keyDerived` は `true`、`hint` に `pdf-reader-mcp` がある

#### Scenario: 鍵を導けない暗号化文書

- **WHEN** 利用者パスワード付きで暗号化された文書を `set_metadata` に渡す
- **THEN** `code` は `ENCRYPTED_PDF`、`detail.keyDerived` は `false`、`hint` に `password` がある

### Requirement: SPEC-WRITER-COMMON-ERRORS-006 出力先に書けないときは INVALID_ARGUMENT にし、出力のパスを名指す

出力のファイルを書けない（親のフォルダーを作れない・ファイルを書けない）ときは、`INTERNAL_ERROR` ではなく `INVALID_ARGUMENT`（`retryable: true`）を返す（SHALL）。`error` は出力のパスを名指し、`detail` に `reason`（`PERMISSION_DENIED`・`NOT_A_DIRECTORY`・`IS_A_DIRECTORY`・`READ_ONLY_FILESYSTEM`・`NO_SPACE`・`FILESYSTEM_ERROR` のどれか）・`path`（出力のパス）・`cause`（元の例外の文）を書く（SHALL）。全書き直しで入力を組み直せなかったときは、`code` を `INVALID_PDF` のまま、`error` で入力と出力の両方のパスを名指し、`detail` に `inputPath`・`outputPath` を書く（SHALL）。入力のパスを「書けなかった」と名指さない（SHALL）。

#### Scenario: 出力のフォルダーの位置にファイルがある

- **WHEN** `outputPath` に、通常のファイルの下のパス（`<file>/out.pdf`）を渡して `rotate_pages` を呼ぶ
- **THEN** `code` は `INVALID_ARGUMENT`、`retryable` は `true`、`detail.reason` は `NOT_A_DIRECTORY`、`detail.path` は渡した `outputPath`、`error` に `outputPath` がある

#### Scenario: 出力のフォルダーに書く権限が無い

- **WHEN** 書く権限の無いフォルダーの下を `outputPath` にして `rotate_pages` を呼ぶ（root で走るときは飛ばす）
- **THEN** `code` は `INVALID_ARGUMENT`、`detail.reason` は `PERMISSION_DENIED`

#### Scenario: 入力を組み直せないときは両方のパスを名指す

- **WHEN** `/Resources` の無いページを持つ文書を、別の `outputPath` にして `set_metadata` に渡す
- **THEN** `code` は `INVALID_PDF`、`error` は `Cannot rewrite` で始まって入力と出力の両方のパスを含み、`detail.outputPath` は渡した `outputPath`

### Requirement: SPEC-WRITER-COMMON-ERRORS-007 字が原因の失敗は、原因の字を detail に機械が読める形で書く

`FONT_REQUIRED` と `MISSING_GLYPH` の本文の `detail` に、`characters`（原因の字の `U+XXXX` の文字列の配列。16 進は大文字で 4 桁以上。重複なしで、入力に出てきた順）と `count`（原因の字の重複なしの数）を書く（SHALL）。`characters` には最初の 1,000 字までを入れ、`count` は常に全体の数にする（SHALL）。`error` の文が最初の 10 字で切れる場合も、`characters` は 11 字目以降を含む（SHALL）。`error`・`code`・`retryable`・`next_actions` はこの要求で変えない（SHALL）。根拠は pdf-agent-stack `docs/specs/06` §2.3（`detail` はサーバ固有の補足。文の項目は版で変わる）。

#### Scenario: MISSING_GLYPH の原因の字を detail に書く

- **WHEN** `create_text_pdf` に `A\u0085B\u0001` を `fontPath` なしで渡す
- **THEN** `code` は `MISSING_GLYPH`、`detail` は `{ "characters": ["U+0085", "U+0001"], "count": 2 }`

#### Scenario: FONT_REQUIRED の原因の字を detail に書く

- **WHEN** `create_text_pdf` に `日本日語` を `fontPath` なしで渡す
- **THEN** `code` は `FONT_REQUIRED`、`detail` は `{ "characters": ["U+65E5", "U+672C", "U+8A9E"], "count": 3 }`

#### Scenario: 文が 10 字で切れても detail には全部入る

- **WHEN** `create_text_pdf` に異なる漢字 12 字を `fontPath` なしで渡す
- **THEN** `error` は `and 2 more` で終わり、`detail.characters` は 12 個、`detail.count` は 12

#### Scenario: 1,000 字を超えると characters を切り、count は全体の数

- **WHEN** `create_text_pdf` に異なる漢字 1,200 字を `fontPath` なしで渡す
- **THEN** `detail.characters` は 1,000 個、`detail.count` は 1,200

#### Scenario: サーバーの応答の本文にも detail が載る

- **WHEN** MCP の `tools/call` で `create_text_pdf` に `日本語の本文` をフォントなしで渡す
- **THEN** 本文の `detail.characters` の先頭は `U+65E5`、`detail.count` は 5
