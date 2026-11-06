## MODIFIED Requirements

### Requirement: SPEC-WRITER-STANDARD-FONT-ENCODING-002 WinAnsiEncoding に符号の無い文字は onMissingGlyph に従う

標準フォントで描くとき、WinAnsiEncoding に符号の無い U+0100 未満の文字（U+0000〜U+0008・U+000E〜U+001F・U+007F〜U+009F）は、埋め込みフォントで「グリフが無い」文字と同じく `onMissingGlyph` に従って扱う（SHALL）。U+0100 以上で符号の無い文字は 004 に従う。既定の `error` では `MISSING_GLYPH` で失敗し、文字を `U+XXXX` で名指す（SHALL）。`replace` では `?` に置き換えて描き、warnings で名指す（SHALL）。`ignore` では空白の符号（`0x20`）で描き、warnings で名指す（SHALL）。どの場合も、その文字の下位 1 バイトを書かない（SHALL）。空白の制御文字（U+0009〜U+000D）は描く前に空白へ変わるので、グリフがあるものとして扱う（SHALL）。根拠は ISO 32000-1 Annex D.2 Table D.2（これらの文字は WinAnsiEncoding の欄に符号を持たない）。

#### Scenario: 既定では MISSING_GLYPH で失敗する

- **WHEN** `create_text_pdf` に `A\u0085B` を `fontPath` なしで渡す
- **THEN** `MISSING_GLYPH` で失敗し、メッセージに `U+0085` が入る

#### Scenario: replace では ? に置き換える

- **WHEN** `create_text_pdf` に `A\u0085B` を `fontPath` なし・`onMissingGlyph: "replace"` で渡す
- **THEN** 本文は `<413f42> Tj` と書かれ、warnings に `U+0085` が入る

#### Scenario: ignore では空白の符号で描く

- **WHEN** `create_text_pdf` に `A\u0085B` を `fontPath` なし・`onMissingGlyph: "ignore"` で渡す
- **THEN** 本文は `<412042> Tj` と書かれ、`<85>` は現れず、warnings に `U+0085` が入る

#### Scenario: 編集系も MISSING_GLYPH で失敗する

- **WHEN** `add_watermark` に `DRAFT\u007f` を `fontPath` なしで渡す
- **THEN** `MISSING_GLYPH` で失敗し、メッセージに `U+007F` が入る

## ADDED Requirements

### Requirement: SPEC-WRITER-STANDARD-FONT-ENCODING-004 WinAnsiEncoding にある字は受け付け、無い U+0100 以上の字だけを FONT_REQUIRED で断る

標準フォントで描くとき、入力の文字が WinAnsiEncoding に符号を持てば、U+0100 以上でも受け付けて 001 の符号で書く（SHALL）。U+0100 以上で WinAnsiEncoding に符号の無い文字が 1 つでもあれば、描く前に `FONT_REQUIRED` で失敗する（SHALL）。この判定は、生成 3 ツール（表のセル・描く題名を含む）と編集系 3 ツール（`add_watermark`・`stamp_page_numbers`・`fill_form`）で同じものを使う（SHALL）。`error` の文は、断った文字を `"<字>" (U+XXXX)` の形で、出てきた順に重複なしで最初の 10 字まで名指し、残りを `and N more` と書く（SHALL）。`code`（`FONT_REQUIRED`）・`retryable`（`true`）・`next_actions[].action`（`retry_with_fontPath`）・`example` は変えない（SHALL）。根拠は ISO 32000-1 Annex D.2 Table D.2（WinAnsiEncoding の欄）と ISO 32000-2 Annex D.1（Table D.2 の字はすべて Times・Helvetica・Courier の系列でサポートする。shall）。

#### Scenario: 曲がった引用符・ダッシュ・ユーロ・省略記号・商標を描く

- **WHEN** `create_text_pdf` に `“Quoted” — 5 € … ™` を `fontPath` なしで渡す
- **THEN** `FONT_REQUIRED` にならず、本文は `<9351756f7465649420972035208020852099> Tj` と書かれる

#### Scenario: 表のセルでも受け付ける

- **WHEN** `create_table_pdf` に `headers: ["It’s"]`・`rows: [["– dash"]]` を `fontPath` なしで渡す
- **THEN** `FONT_REQUIRED` にならず、コンテンツストリームに `<49749273> Tj` と `<962064617368> Tj` が書かれる

#### Scenario: 編集系でも受け付ける

- **WHEN** `add_watermark` に `DRAFT – v2` を `fontPath` なしで渡す
- **THEN** `FONT_REQUIRED` にならず、出力のファイルが書かれる

#### Scenario: 日本語はいまどおり断る

- **WHEN** `create_text_pdf` に `日本語` を `fontPath` なしで渡す
- **THEN** `FONT_REQUIRED` で失敗し、`retryable` は `true`、`next_actions[0].action` は `retry_with_fontPath`

#### Scenario: 断った字を U+XXXX で名指す

- **WHEN** `create_text_pdf` に `Price ł 日本` を `fontPath` なしで渡す
- **THEN** `FONT_REQUIRED` で失敗し、`error` に `"ł" (U+0142)`・`"日" (U+65E5)`・`"本" (U+672C)` がこの順で入り、`non-Latin` は入らない

#### Scenario: 11 字目からは数だけを書く

- **WHEN** `create_text_pdf` に異なる漢字 12 字を `fontPath` なしで渡す
- **THEN** `error` には最初の 10 字が名指され、`and 2 more` で終わる
