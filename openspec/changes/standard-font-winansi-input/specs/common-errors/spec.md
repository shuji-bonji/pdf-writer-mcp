## MODIFIED Requirements

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
