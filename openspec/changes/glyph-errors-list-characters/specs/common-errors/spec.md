## ADDED Requirements

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
