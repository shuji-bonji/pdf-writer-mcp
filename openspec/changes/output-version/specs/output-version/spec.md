## ADDED Requirements

### Requirement: SPEC-WRITER-OUTPUT-VERSION-001 merge_pdfs は版の違う入力を明示した版でだけ書く

`merge_pdfs` は `pdfVersion`（`"1.7"`・`"2.0"`）を受け取る。`pdfVersion` が無ければ、入力の版がすべて同じときだけその版で書き、混ざっていれば断る（SHALL）。`pdfVersion: "1.7"` で入力に PDF 2.0 があれば断る（SHALL）。断るときはファイルを書かず、`next_actions` に `pdfVersion: "2.0"` の案内を置く（SHALL）。`pdfVersion: "2.0"` で書くときは trailer に `/ID` を書き、先頭の入力の Info の日付以外の値を XMP に移して Info から除く（SHALL）。根拠は ISO 32000-2 R-7.5.2-4・Table 15・§14.3.3 と、#28 の原則（版を変えるのは明示した変換だけ）。

#### Scenario: 1.7 と 2.0 の入力で pdfVersion が無い

- **WHEN** PDF 1.7 の文書と PDF 2.0 の文書をこの順で、`pdfVersion` なしで `merge_pdfs` に渡す
- **THEN** `code` は `INVALID_ARGUMENT`、エラーの文に `1.7` と `2.0` の両方があり、`next_actions[0].example.pdfVersion` は `2.0`、`outputPath` にファイルが無い

#### Scenario: 1.7 と 2.0 の入力で pdfVersion 2.0

- **WHEN** `title` を持つ PDF 1.7 の文書と PDF 2.0 の文書を、`pdfVersion: "2.0"` で渡す
- **THEN** 出力のヘッダーは `%PDF-2.0`、trailer に `/ID` があり、XMP の `dc:title` に 1 つ目の題名があり、Info に `Title` が無い

#### Scenario: 2.0 の入力で pdfVersion 1.7

- **WHEN** PDF 2.0 の文書を含む入力を `pdfVersion: "1.7"` で渡す
- **THEN** `code` は `INVALID_ARGUMENT`

#### Scenario: 1.7 だけの入力は今までどおり

- **WHEN** PDF 1.7 の文書 2 つを `pdfVersion` なしで渡す
- **THEN** 出力のヘッダーは `%PDF-1.7` で、版についての warnings は無い

### Requirement: SPEC-WRITER-OUTPUT-VERSION-002 PDF 2.0 の文書の set_metadata は XMP に書く

PDF 2.0 の文書に `set_metadata` を掛けるとき、渡された値を XMP に書き（XMP が無ければ作る）、入力の Info に無いキーを Info に足さない（SHALL）。入力が PDF/UA-2 を宣言している（`pdfuaid:part` 2）なら、Info の `CreationDate`・`ModDate` 以外のキーの値を XMP に移してから Info から除き、除いたキーを warnings に書く（SHALL）。それ以外の PDF 2.0 の文書では、既存のキーを残し、渡された値で上書きして XMP と同じ値にする（SHALL）。根拠は ISO 32000-2 §14.3.3・Table 349（PDF 2.0 では `CreationDate`・`ModDate` 以外の Info のキーは非推奨。XMP を使う should）と ISO 14289-2 §6.2（PDF/UA-2 のファイルは非推奨の機能を含まない should not）。PDF 1.x の文書の扱いは変えない。

#### Scenario: Info に Title が無い 2.0 の文書

- **WHEN** `pdfVersion: "2.0"` で作った文書（Info は日付 2 つだけ）に `title: "New"` で `set_metadata` を呼ぶ
- **THEN** XMP の `dc:title` は `New`、Info に `Title` が無い

#### Scenario: Info に Title がある 2.0 の文書（PDF/UA-2 ではない）

- **WHEN** Info に `Title` を持ち、`pdfuaid` を宣言していない PDF 2.0 の文書に `title: "New"` で呼ぶ
- **THEN** Info の `Title` と XMP の `dc:title` はどちらも `New`

#### Scenario: Info に Title がある PDF/UA-2 の文書

- **WHEN** Info に `Title: "Old"` と `Author: "A"` を持ち、`pdfuaid:part` 2 を宣言した文書に `title: "New"` で呼ぶ
- **THEN** XMP の `dc:title` は `New`、`dc:creator` は `A`、Info には `CreationDate`・`ModDate` 以外のキーが無く、warnings に `Title` と `Author` が書かれている

### Requirement: SPEC-WRITER-OUTPUT-VERSION-003 XMP を作り直しても指示されていない項目を運ぶ

XMP を作り直す経路（`set_metadata`・`ensure_pdfa`）は、変更を指示された項目以外の入力の XMP の値を、言語別の項目（`rdf:Alt` の `rdf:li` と `xml:lang`）と並び（`rdf:Seq`・`rdf:Bag`）ごと出力に運ぶ（SHALL）。`dc:title` を変えるときは `x-default` の項目を書き換え、他の言語の項目は残してその言語を warnings に書く（SHALL）。根拠は ISO 32000-2 §14.3.2・§14.3.3（例は `dc:title` に 3 言語の項目を持つ）。

#### Scenario: 複数の言語の dc:title と dc:creator

- **WHEN** XMP の `dc:title` に `x-default`・`en`・`de` の 3 項目と、`dc:creator` に 2 人を持つ文書に、`author` だけを渡して `set_metadata` を呼ぶ
- **THEN** 出力の `dc:title` に同じ 3 項目が同じ値で残り、`dc:creator` に同じ 2 人が同じ順で残る

#### Scenario: 複数の言語の dc:title を持つ文書の題名を変える

- **WHEN** 同じ文書に `title: "New"` で `set_metadata` を呼ぶ
- **THEN** `dc:title` の `x-default` は `New`、`en`・`de` の項目は元の値のまま残り、warnings に `en` と `de` が書かれている

### Requirement: SPEC-WRITER-OUTPUT-VERSION-004 PDF/UA-2 の文書に足した既定の名前空間の要素を伝える

PDF/UA-2 を宣言した文書に構造要素を足す編集ツール（`tag_form_fields`・`add_annotation`）は、`/NS` を書かずに既定の PDF 1.7 の名前空間に置いた要素があるとき、その構造型を warnings に書く（SHALL）。根拠は ISO 14289-2 §8.2.4（PDF 1.7 と PDF 2.0 の名前空間のどちらに属してもよい）。

#### Scenario: PDF/UA-2 の文書に注釈を足す

- **WHEN** `tagged: true`・`pdfVersion: "2.0"` で作った文書に `add_annotation` でリンクを足す
- **THEN** warnings に既定の名前空間に置いた構造型（`Link` または `Annot`）が書かれている

### Requirement: SPEC-WRITER-OUTPUT-VERSION-005 結果で出力の版と宣言を伝える

ファイルを書く全ツールの結果は `output` を持ち、`output.pdfVersion` に出力のヘッダーの版（`"1.7"` か `"2.0"`）、`output.declares` に出力の XMP が宣言している規格を書く（SHALL）。`declares.pdfua` は `pdfuaid:part` の数（1 か 2）、`declares.pdfa` は `pdfaid:part` と `pdfaid:conformance` を小文字でつないだ文字列（`"3b"`・`"4"`・`"4f"` など）とし、宣言の無い規格のキーは置かない（SHALL）。値は書いた後のバイト列から読む（引数から推測しない）（SHALL）。`split_pdf` は各ファイルに `output` を持つ。

#### Scenario: PDF/UA-2 で作る

- **WHEN** `create_text_pdf` に `tagged: true`・`pdfVersion: "2.0"` を渡す
- **THEN** `output` は `{ "pdfVersion": "2.0", "declares": { "pdfua": 2 } }`

#### Scenario: PDF/UA-2 の文書に pdfa-4

- **WHEN** その文書に `ensure_pdfa(flavour: "pdfa-4")` を掛ける
- **THEN** `output` は `{ "pdfVersion": "2.0", "declares": { "pdfua": 2, "pdfa": "4" } }`

#### Scenario: タグ無しの 1.7

- **WHEN** `create_text_pdf` に既定の引数で渡す
- **THEN** `output` は `{ "pdfVersion": "1.7", "declares": {} }`

### Requirement: SPEC-WRITER-OUTPUT-VERSION-006 版を理由に断るエラーは版を名指す

入力の版または宣言と、求められた操作が要する版が両立しないために `INVALID_ARGUMENT` を返すとき、エラーの文に入力のヘッダーの版と宣言（`pdfuaid:part`・`pdfaid:part`）と、操作が要する版を書く（SHALL）。`next_actions` に、版の合う呼び方を `example` 付きで 1 つ以上置く（SHALL）。対象は ENSURE-PDFA-001・003・004 と OUTPUT-VERSION-001 で断る場合。

#### Scenario: タグ無しの 2.0 に pdfa-3b

- **WHEN** `pdfVersion: "2.0"` だけで作った文書に `ensure_pdfa(flavour: "pdfa-3b")` を掛ける
- **THEN** エラーの文に `2.0` と `1.` で始まるヘッダー（PDF/A-3 が要する版）の両方が書かれている

### Requirement: SPEC-WRITER-OUTPUT-VERSION-007 版の原則を 1 か所に書く

initialize の instructions に、版の原則（編集の出力は入力の版のまま。版を変えるのは明示した変換 — `ensure_pdfa(flavour: "pdfa-4")` と `merge_pdfs(pdfVersion)` — だけ。結果の `output` で版と宣言を返す）を 1 か所で書き、宣言の適合は確かめていないので pdf-verify-mcp で確かめることを同じ段落に書く（SHALL）。生成 3 ツールは、宣言を書いたことを warnings には書かない（`output.declares` で伝える）。版を変えうるツールと版を理由に断りうるツールの説明は、その 1 か所と同じ語で書く（SHALL）。

#### Scenario: instructions に原則がある

- **WHEN** initialize を呼ぶ
- **THEN** instructions に `ensure_pdfa`・`merge_pdfs`・`output` の 3 語を含む版の原則の段落が 1 つある
