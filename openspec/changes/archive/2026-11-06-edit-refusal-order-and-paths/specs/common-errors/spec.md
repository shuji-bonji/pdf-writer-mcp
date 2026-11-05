## ADDED Requirements

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
