## MODIFIED Requirements

### Requirement: SPEC-WRITER-CREATE-TITLE-002 title にもフォントに無い文字の扱いを当てる

埋め込みフォントで生成し、題名を本文に描くとき（`drawTitle` が `false` でないとき）、`title` の文字にも本文と同じ `onMissingGlyph` を当てる（SHALL）。既定の `error` では、フォントに無い文字を含む `title` は、その文字のコードポイントを挙げたエラーになる。題名を描かないとき（`drawTitle: false`）は、`title` を描かないので、フォントに無い文字の扱いも、標準フォントで WinAnsiEncoding に符号の無い字を `FONT_REQUIRED` で断ること（SPEC-WRITER-STANDARD-FONT-ENCODING-004）も、`title` には当てない（SHALL）。メタデータの `title` はテキスト文字列（ISO 32000-2 §7.9.2.2）として書くので、グリフを要さない。

#### Scenario: フォントに無い文字を title に含める

- **WHEN** Noto Sans JP に無い U+2714 を含む `title` で、`onMissingGlyph` を指定せずに `create_text_pdf` を呼ぶ
- **THEN** `U+2714` を含むエラーになる

#### Scenario: 描かない title には標準フォントの検査を当てない

- **WHEN** フォントを渡さず（標準フォント）、ASCII の本文と日本語の `title` を `drawTitle: false` で `create_text_pdf` に渡す
- **THEN** エラーにならず、Info 辞書の `/Title` にその日本語が入る
