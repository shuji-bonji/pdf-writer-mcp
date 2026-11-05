## ADDED Requirements

### Requirement: SPEC-WRITER-STANDARD-FONT-ENCODING-001 標準フォントで描く文字は WinAnsiEncoding の符号で書く

`fontPath` を渡さず標準フォント（Helvetica）で描くとき、フォント辞書には `/Encoding /WinAnsiEncoding` を書き、`Tj` に渡す文字列の各バイトは、その文字の WinAnsiEncoding の符号にする（SHALL）。符号は ISO 32000-1 Annex D.2 Table D.2（ISO 32000-2 Annex D.2 も同じ）の WinAnsiEncoding 欄に従う。レンダラが入力に無い字を足す場合（箇条書きの記号「•」など）も同じ表で書く（SHALL）。

#### Scenario: 箇条書きの記号を 0x95 で書く

- **WHEN** `create_markdown_pdf` に `- Alpha` を `fontPath` なしで渡す
- **THEN** 記号はコンテンツストリームで `<95> Tj` と書かれ、`<22>` は現れない

#### Scenario: Latin-1 と同じ符号の字はそのまま書く

- **WHEN** `create_text_pdf` に `Café © ½`（`Café © ½`）を `fontPath` なしで渡す
- **THEN** 本文は `<436166e920a920bd> Tj` と書かれる

### Requirement: SPEC-WRITER-STANDARD-FONT-ENCODING-002 WinAnsiEncoding に符号の無い文字は onMissingGlyph に従う

標準フォントで描くとき、WinAnsiEncoding に符号の無い文字（U+0000〜U+0008・U+000E〜U+001F・U+007F〜U+009F。U+0100 以上は SPEC の外で、いまどおり `FONT_REQUIRED`）は、埋め込みフォントで「グリフが無い」文字と同じく `onMissingGlyph` に従って扱う（SHALL）。既定の `error` では `MISSING_GLYPH` で失敗し、文字を `U+XXXX` で名指す（SHALL）。`replace` では `?` に置き換えて描き、warnings で名指す（SHALL）。`ignore` では空白の符号（`0x20`）で描き、warnings で名指す（SHALL）。どの場合も、その文字の下位 1 バイトを書かない（SHALL）。空白の制御文字（U+0009〜U+000D）は描く前に空白へ変わるので、グリフがあるものとして扱う（SHALL）。根拠は ISO 32000-1 Annex D.2 Table D.2（これらの文字は WinAnsiEncoding の欄に符号を持たない）。

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
