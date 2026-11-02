---
spec_id: WRITER
kind: common
approved: 2026-11-02
pr: 6
---
# create-title

## Purpose

生成 3 ツール（`create_text_pdf`・`create_markdown_pdf`・`create_table_pdf`）が共通に受け取る `title` の扱いを定めます。
`title` が必須になる条件、フォントに無い文字の扱い、タグ付きの文書で題名を構造木のどこに置くかを扱います。

この初版は、2026-11-02 時点の既存テストが固定している振る舞いを起こしたもので、期待値は変えていません。
起こした範囲は次のテストです（3 件。どれも `TEST_FONT_PATH` が無い環境では飛ぶ）。

- `tests/tagged.test.ts` の「requires a title, since PDF/UA mandates one」と「normalizes heading levels so none are skipped (7.4.2)」
- `tests/glyph.test.ts` の「applies the policy to the title as well」

次のテストも `title` に触れますが、この初版では起こしていません。
`tests/tagged.test.ts` の「writes XMP as UTF-8 with the pdfuaid declaration and extension schema」（主題は pdfuaid の宣言と拡張スキーマ）・`tests/pdf-version.test.ts` の「moves title, author and producer into the metadata stream」（主題は PDF 2.0 の Info 辞書の扱い）。
タグ無しの文書で `title` を Info 辞書の `/Title` に書くことと、本文の先頭に題名を描くことは、固定しているテストがありません。

ISO 14289-1 の §7.1・§7.4.2 は pdf-spec-mcp（`pdfua1`）で原文を確かめました。

## できないこと

- 題名が文書の内容に合っているかを判断すること
- 生成した文書が PDF/UA-1 に適合しているかを判定すること（pdf-verify-mcp の `validate_conformance` の仕事）

## Requirements

### Requirement: SPEC-WRITER-CREATE-TITLE-001 タグ付きで生成するときは title を必須にする

`tagged: true` で `title` が無いとき、生成 3 ツールは PDF を作らず、`requires "title"` を含むエラーにする（SHALL）。根拠は ISO 14289-1 §7.1（catalog の Metadata ストリームは `dc:title` を持つ）。

#### Scenario: title を渡さずに tagged で生成する

- **WHEN** `create_text_pdf` を `tagged: true`・`title` 無しで呼ぶ
- **THEN** `requires "title"` を含むエラーになる

### Requirement: SPEC-WRITER-CREATE-TITLE-002 title にもフォントに無い文字の扱いを当てる

埋め込みフォントで生成するとき、`title` の文字にも本文と同じ `onMissingGlyph` を当てる（SHALL）。既定の `error` では、フォントに無い文字を含む `title` は、その文字のコードポイントを挙げたエラーになる。

#### Scenario: フォントに無い文字を title に含める

- **WHEN** Noto Sans JP に無い U+2714 を含む `title` で、`onMissingGlyph` を指定せずに `create_text_pdf` を呼ぶ
- **THEN** `U+2714` を含むエラーになる

### Requirement: SPEC-WRITER-CREATE-TITLE-003 タグ付きでは題名を最初の H1 として描き、本文の見出しはそれに続けて数える

`tagged: true` のとき、`title` を本文の先頭に描き、構造木の最初の見出しを H1 にする（SHALL）。`create_markdown_pdf` の本文の見出しは、題名の H1 の後に続くものとして、直前の見出しの 1 つ下までに収める（SHALL）。このため、Markdown の `#` は H1、そのすぐ後の `###` は H2 になる。根拠は ISO 14289-1 §7.4.2（見出しのタグを使うなら最初は H1。降りるときにレベルを飛ばさない。同じレベルを繰り返してよい）。

#### Scenario: 見出しのレベルが飛ぶ Markdown をタグ付きで生成する

- **WHEN** `# 第1章` の後に `### 飛んだ見出し` を置いた Markdown を、`title` 付き・`tagged: true` で `create_markdown_pdf` に渡す
- **THEN** 構造木の見出しは順に H1（題名）・H1（`#`）・H2（`###`）になる
