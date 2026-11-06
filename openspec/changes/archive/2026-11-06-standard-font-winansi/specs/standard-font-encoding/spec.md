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

### Requirement: SPEC-WRITER-STANDARD-FONT-ENCODING-003 標準フォントの文字幅は、書いた符号が指すグリフの幅で測る

標準フォントで描く文字の幅は、001 で書く符号が WinAnsiEncoding で指すグリフの、AFM（Adobe Font Metrics）の幅で測る（SHALL）。空白・数字・句読点・アクセント付きの字・記号も同じく測り、幅を 0 にしない（SHALL）。002 で空白の符号として描く文字は、空白の幅で測る（SHALL）。折り返しはこの幅で決め、本文を右余白の内側に収める（SHALL）。根拠は ISO 32000-1 §9.6.2.2（標準 14 書体は、フォントまたはその font metrics を処理系が持つ。NOTE が font metrics files として AFM を示す）と Annex D.2 Table D.2（符号と字の対応）。

#### Scenario: 数字・句読点・空白・記号を AFM の幅で測る

- **WHEN** 標準フォント（Helvetica）で `1. •` の幅を 1000 pt で測る
- **THEN** `one`（556）・`period`（278）・`space`（278）・`bullet`（350）の和の 1462 pt になる

#### Scenario: 長い段落を右余白の内側で折り返す

- **WHEN** `create_text_pdf` に `Invoice 2026-11-06: total 1,234.56 USD (paid). ` を 6 回つないだ段落を `fontPath` なしで渡す（A4・余白 56 pt・11 pt）
- **THEN** どの行も、AFM の幅で測った右端が 595.28 − 56 pt を越えない
