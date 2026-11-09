---
spec_id: WRITER
kind: common
introduced_by: pdfua2-output
---
# pdfua2 Specification

## Purpose
タグ付きの PDF 2.0 を PDF/UA-2（ISO 14289-2:2024）として書くときの規則と、PDF/UA-2 を宣言した文書を編集するときの規則を定めます。生成 3 ツール（`create_text_pdf`・`create_markdown_pdf`・`create_table_pdf`）が `tagged: true` と `pdfVersion: "2.0"` で書く宣言（`pdfuaid:part` 2・`pdfuaid:rev` 2024）・構造要素の名前空間・題名の `Title`・見出しの段を扱います。編集では、XMP を作り直しても宣言と `dc:title` を残すことと、`add_bookmarks` がしおりの行き先を structure destination（ISO 14289-2 §8.8）で書くことを扱います。PDF/UA-1（PDF 1.7）の出力の規則は `create-title`・`create-markdown-pdf` にあり、この capability では変えません。適合の判定は pdf-verify-mcp（veraPDF）が行い、このサーバは判定しません。入れ子のリストの置き場所（`create-markdown-pdf` の 005）と、`ensure_tagged`・`ensure_pdfa` の PDF/UA-2 の扱い（`ensure-tagged` の 003・004、`ensure-pdfa` の 001・003）は、それぞれのツールの capability にあります。

## Requirements

### Requirement: SPEC-WRITER-PDFUA2-001 タグ付きの PDF 2.0 は PDF/UA-2 を宣言する

生成 3 ツール（`create_text_pdf`・`create_markdown_pdf`・`create_table_pdf`）に `tagged: true` と `pdfVersion: "2.0"` を渡したとき、ヘッダーを `%PDF-2.0` にし、XMP に `pdfuaid:part` 2 と `pdfuaid:rev` 2024 を書く（SHALL）。`pdfuaid` を記述する拡張スキーマ（`pdfaExtension`）には `rev` のプロパティも書く（SHALL）。`pdfVersion` を渡さないとき（1.7）は今までどおり `pdfuaid:part` 1 だけを書き、`rev` は書かない（SHALL）。根拠は ISO 14289-2 §5 Table 1（`part` と `rev` は Required、`part` は 2、`rev` は発行年の 4 桁）と §6.1（版は 2.0）、ISO 14289-1 §6.1（PDF/UA-1 の版は 1.0〜1.7）。生成系は PDF/UA-1 と同じく、適合を確かめていないことを warnings に書かない（変えるなら別の変更にする）。

#### Scenario: tagged と pdfVersion 2.0 で PDF/UA-2 の宣言を書く

- **WHEN** `create_text_pdf` に `tagged: true`・`pdfVersion: "2.0"`・`title`・`lang` を渡す
- **THEN** 成功し、ヘッダーは `%PDF-2.0`、XMP の `pdfuaid:part` は 2、`pdfuaid:rev` は 2024 で、拡張スキーマに `rev` の名前がある

#### Scenario: 既定の版では PDF/UA-1 のまま

- **WHEN** 同じ引数から `pdfVersion` を除いて呼ぶ
- **THEN** ヘッダーは `%PDF-1.7`、XMP の `pdfuaid:part` は 1 で、`pdfuaid:rev` は無い

### Requirement: SPEC-WRITER-PDFUA2-002 PDF/UA-2 の構造要素は PDF 2.0 の名前空間に置く

PDF/UA-2 で生成するとき、`StructTreeRoot` の `/Namespaces` に PDF 2.0 の標準構造名前空間（`/NS (http://iso.org/pdf2/ssn)`）の名前空間辞書を置き、PDF 2.0 の名前空間にある構造型の要素の `/NS` にその辞書を書く（SHALL）。PDF 2.0 の名前空間に無い `BlockQuote` と `Code` には `/NS` を書かず、既定の PDF 1.7 の名前空間に置く（SHALL）。PDF/UA-1 では `/NS` も `/Namespaces` も書かない（SHALL）。根拠は ISO 14289-2 §8.2.5.2（`Document` は PDF 2.0 の名前空間に置く）と §8.2.4（PDF 1.7・PDF 2.0 の名前空間のどちらに属してもよい）、ISO 32000-2 §14.8.6.1・Table 354・Table 355・Table 356・Annex M。

#### Scenario: Document と見出しは PDF 2.0 の名前空間、BlockQuote と Code は既定のまま

- **WHEN** 見出し・段落・引用・コードを含む Markdown を `tagged: true`・`pdfVersion: "2.0"` で `create_markdown_pdf` に渡す
- **THEN** `StructTreeRoot` の `/Namespaces` に `NS` が `http://iso.org/pdf2/ssn` の辞書が 1 つあり、`Document`・`H1`・`P` の `/NS` はその辞書を指し、`BlockQuote`・`Code` に `/NS` が無い

#### Scenario: PDF/UA-1 では名前空間を書かない

- **WHEN** 同じ Markdown を `tagged: true` だけで渡す
- **THEN** `StructTreeRoot` に `/Namespaces` が無く、どの要素にも `/NS` が無い

### Requirement: SPEC-WRITER-PDFUA2-003 PDF/UA-2 では描く題名を Title にする

PDF/UA-2 で生成し、題名を本文に描くとき（`drawTitle` が `false` でないとき）、題名を `Title` 構造要素で囲み、見出しにしない（SHALL）。根拠は ISO 14289-2 §8.2.5.13（題名は Title 構造型で示し、見出しとして示さない）。PDF/UA-1 の扱い（SPEC-WRITER-CREATE-TITLE-003）は変えない。

#### Scenario: 題名は Title になる

- **WHEN** `create_text_pdf` に `tagged: true`・`pdfVersion: "2.0"`・`title: "Report"` を渡す
- **THEN** `Document` の最初の子は `Title` で、構造木に `H1` が無い

### Requirement: SPEC-WRITER-PDFUA2-004 PDF/UA-2 では見出しの段を Markdown のまま使う

PDF/UA-2 で `create_markdown_pdf` を使うとき、見出しの構造型は Markdown の `#` の数（1〜6）のまま `H1`〜`H6` にし、段を飛ばさないための正規化をしない（SHALL）。題名を描くかどうかで見出しの段を変えない（SHALL）。根拠は ISO 14289-2 §8.2.5.12（段が明らかな見出しは、その段の構造型にする。段を連続させることは求めない — NOTE 2）。PDF/UA-1 の正規化（ISO 14289-1 §7.4.2、SPEC-WRITER-CREATE-TITLE-003）は変えない。

#### Scenario: 飛んだ見出しを飛んだまま書く

- **WHEN** `# A`、`### B` の Markdown を `tagged: true`・`pdfVersion: "2.0"`・`title` で渡す
- **THEN** 見出しの構造型は `H1`・`H3` の順

### Requirement: SPEC-WRITER-PDFUA2-005 編集で XMP を作り直しても PDF/UA-2 の宣言と dc:title を残す

既存の文書を編集して XMP を作り直すとき、入力の XMP の `pdfuaid:rev` を `pdfuaid:part` と一緒に引き継ぐ（SHALL）。Info 辞書に `Title` が無いときは、入力の XMP の `dc:title` の最初の項目を、文字参照（定義済みの実体参照と数値文字参照。XML 1.0 §4.1・§4.6）を戻した字で引き継ぐ（SHALL）。PDF 2.0 の出力は Info 辞書に `Title` を置かない（ISO 32000-2 §14.3.3 が Info の文書メタデータを非推奨にしている）ので、Info だけから作り直すと題名が消え、ISO 14289-2 §8.11.1（XMP の `dc:title`）を満たさなくなる。

#### Scenario: set_metadata で author だけを変える

- **WHEN** PDF/UA-2 で作った文書に `set_metadata` を `author` だけで呼ぶ
- **THEN** 出力の XMP に `pdfuaid:part` 2・`pdfuaid:rev` 2024・元の `dc:title` が残る

#### Scenario: 数値文字参照で書かれた題名を二重に符号化しない

- **WHEN** XMP の `dc:title` が `A &#x2014; B` と数値文字参照で書かれ、Info 辞書に `Title` が無い文書に、`set_metadata` を `author` だけで呼ぶ
- **THEN** 出力の XMP の `dc:title` は `A — B`（U+2014 の字そのもの）で、`&amp;#x2014;` を含まない

### Requirement: SPEC-WRITER-PDFUA2-006 PDF/UA-2 の文書に足すしおりは structure destination で書く

`add_bookmarks` の入力の XMP が `pdfuaid:part` 2 を宣言しているとき、しおりの行き先を `/A << /S /GoTo /D [ページ /XYZ null null null] /SD [構造要素 /XYZ null null null] >>` で書き、`/Dest` を書かない（SHALL）。構造要素は、そのページの親配列（ParentTree の `/StructParents` の値）に並ぶ要素を MCID の順に見て、ISO 32000-2 §12.3.2.3 の手順で同じページに戻る最初のものにする（SHALL）。前のページから続く要素は、手順が前のページに着くので選ばない。どの要素も戻らないページのしおりは、今までどおり `/Dest [ページ …]` で書き、PDF/UA-2 の検査で落ちることを warnings で名指す（SHALL）。PDF/UA-2 を宣言していない入力では、今までどおり `/Dest [ページ …]` だけを書く（SHALL）。根拠は ISO 14289-2 §8.8（文書内を指す行き先は structure destination にする）、ISO 32000-2 §12.3.2.3、§12.6.4.2 Table 202（`SD` は PDF 2.0 の項目で、`D` より優先される）、Table 151（`Dest` と `A` を同時に置かない）。`/D` を残すのは、`SD` を知らないビューアがそのページへ飛べるようにするためである。

#### Scenario: PDF/UA-2 の文書にしおりを足す

- **WHEN** PDF/UA-2 で作った 1 ページの文書に、1 ページ目を指す `add_bookmarks` を呼ぶ
- **THEN** しおりの項目に `/Dest` が無く、`/A` の `/S` は `GoTo`、`/D` の先頭は 1 ページ目、`/SD` の先頭は構造要素で、warnings に `8.8` を含む文が無い

#### Scenario: 前のページから続く要素は選ばない

- **WHEN** 段落が 1 ページ目から 2 ページ目へ続く PDF/UA-2 の文書に、2 ページ目を指すしおりを足す
- **THEN** `/SD` の要素は §12.3.2.3 の手順で 2 ページ目に着き、その段落ではない

#### Scenario: 構造要素の内容が無いページ

- **WHEN** 構造要素の内容を 1 つも持たないページを含む PDF/UA-2 の文書で、そのページを指すしおりを足す
- **THEN** 成功し、そのしおりは `/Dest` の先頭がそのページで、warnings に `8.8` と、そのしおりの題名を含む文がある

#### Scenario: PDF/UA-1 の文書は今までどおり

- **WHEN** PDF/UA-1 で作った文書に `add_bookmarks` を呼ぶ
- **THEN** しおりの項目に `/Dest` があり `/A` が無く、warnings に `8.8` を含む文が無い

### Requirement: SPEC-WRITER-PDFUA2-007 PDF/UA-2 の文書に足す注釈の Contents を Alt と揃える

PDF/UA-2 を宣言した文書（`pdfuaid:part` 2）に `add_annotation` で `alt` を渡したとき、`contents` が無ければ注釈の `/Contents` に `alt` を書く（SHALL）。`contents` と `alt` の両方があり値が違えば、ファイルを書かずに `INVALID_ARGUMENT` を返し、`next_actions` に同じ値で呼び直す案内を置く（SHALL）。根拠は ISO 14289-2 §8.9.4.1（代替記述は `Contents` で書く）と §8.9.4.2（`Contents` と直接囲む構造要素の `Alt` は同じ値）。PDF/UA-1 の文書とタグ無しの文書の扱いは変えない。

#### Scenario: alt だけを渡す

- **WHEN** `tagged: true`・`pdfVersion: "2.0"` で作った文書に `alt: "Box"` だけを渡して `add_annotation` を呼ぶ
- **THEN** 注釈の `/Contents` と `Annot` 構造要素の `/Alt` はどちらも `Box`

#### Scenario: contents と alt が違う

- **WHEN** 同じ文書に `contents: "Note"`・`alt: "Box"` で呼ぶ
- **THEN** `code` は `INVALID_ARGUMENT`、`outputPath` にファイルが無い

#### Scenario: PDF/UA-1 の文書は今までどおり

- **WHEN** `tagged: true` だけで作った文書に `alt: "Box"` だけを渡して呼ぶ
- **THEN** 注釈の `/Contents` は空文字のまま

### Requirement: SPEC-WRITER-PDFUA2-008 PDF/UA-2 の文書のウィジェットに Contents を書く

PDF/UA-2 を宣言した文書に `tag_form_fields` を掛けるとき、構造木に結んだウィジェットのうち `/Contents` を持たないものに `/Contents` を書く（SHALL）。値は `labels` のそのフィールドの値、無ければフィールドの既存の `/TU`、それも無ければフィールド名とする（SHALL）。既に `/Contents` を持つウィジェットは変えない（SHALL）。根拠は ISO 14289-2 §8.10.2.3（ラベルが無いウィジェットには `Contents` を書く。フィールドの `TU` は `Contents` と同じ値でもよい）。このツールは `Lbl` 構造要素を作らないので、結んだウィジェットにラベルは無い。PDF/UA-1 の文書の扱いは変えない。

#### Scenario: labels を渡したフィールド

- **WHEN** PDF/UA-2 で作った文書にテキストフィールド `user.name` を足し、`labels: { "user.name": "Name" }` で `tag_form_fields` を呼ぶ
- **THEN** そのウィジェットの `/Contents` は `Name`

#### Scenario: labels を渡さないフィールド

- **WHEN** 同じ文書に `labels` なしで呼ぶ
- **THEN** そのウィジェットの `/Contents` は `user.name`

#### Scenario: PDF/UA-1 の文書は今までどおり

- **WHEN** `tagged: true` だけで作った文書に同じフィールドを足し、`labels` を渡して呼ぶ
- **THEN** ウィジェットに `/Contents` が無い
