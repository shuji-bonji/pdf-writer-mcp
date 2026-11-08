## MODIFIED Requirements

### Requirement: SPEC-WRITER-CREATE-TITLE-003 タグ付きでは題名を最初の H1 として描き、本文の見出しはそれに続けて数える

PDF/UA-1 で生成するとき（`tagged: true` で `pdfVersion` が `"2.0"` でないとき）、題名を本文に描くなら、`title` を本文の先頭に描き、構造木の最初の見出しを H1 にする（SHALL）。`create_markdown_pdf` の本文の見出しは、題名の H1 の後に続くものとして、直前の見出しの 1 つ下までに収める（SHALL）。このため、Markdown の `#` は H1、そのすぐ後の `###` は H2 になる。
題名を描かないとき（`drawTitle: false`）は、本文の最初の見出しを、Markdown のレベルに関わらず H1 にし、以降を同じ規則で収める（SHALL）。根拠は ISO 14289-1 §7.4.2（見出しのタグを使うなら最初は H1。降りるときにレベルを飛ばさない。同じレベルを繰り返してよい）。PDF/UA-2（`pdfVersion: "2.0"`）では、題名は SPEC-WRITER-PDFUA2-003、見出しの段は SPEC-WRITER-PDFUA2-004 に従う（SHALL）。

#### Scenario: 見出しのレベルが飛ぶ Markdown をタグ付きで生成する

- **WHEN** `# 第1章` の後に `### 飛んだ見出し` を置いた Markdown を、`title` 付き・`tagged: true` で `create_markdown_pdf` に渡す
- **THEN** 構造木の見出しは順に H1（題名）・H1（`#`）・H2（`###`）になる

#### Scenario: 題名を描かず H2 から始まる Markdown をタグ付きで生成する

- **WHEN** `## 概要` の後に `### 詳細` を置いた Markdown を、`title` 付き・`tagged: true`・`drawTitle: false` で `create_markdown_pdf` に渡す
- **THEN** 構造木の見出しは順に H1（`##`）・H2（`###`）になる
