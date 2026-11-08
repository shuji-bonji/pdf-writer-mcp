---
spec_id: WRITER
kind: tool
introduced_by: ensure-reports-what-changed
---
# ensure-tagged Specification

## Purpose
`ensure_tagged` ツールが、既存の PDF を PDF/UA-1 の器に載せるときの規則を定めます。扱うのは 2 つです。1 つは、文書レベルの要件（`Lang`・`ViewerPreferences/DisplayDocTitle`・XMP の `pdfuaid:part` と `dc:title`）について、足したもの・書き直したもの・変わらなかったものを応答で分けて返すことです。もう 1 つは、PDF/UA-1 が許さない版（PDF 2.0 以上。ISO 14289-1 §6.1）の入力を、何も書く前に断ることです。構造木の作り方と warnings は既存のテスト（`tests/ensure-tagged.test.ts`）が固定しています。

## Requirements

### Requirement: SPEC-WRITER-ENSURE-TAGGED-001 足したものと書き直したものを分けて返す

`ensure_tagged` は、文書レベルの要件 `Lang`・`ViewerPreferences/DisplayDocTitle`・`XMP(pdfuaid:part, dc:title)` について、入力に無かったものを `addedRequirements` に、入力にあったが値が違うので書き直したものを `replacedRequirements` に入れる（SHALL）。入力がすでに同じ値を持つ要件は、書き直さず、どちらにも入れない（SHALL）。`Lang` は渡した `lang` と catalog の `/Lang` が同じなら同じ値、`DisplayDocTitle` は `true` なら同じ値、XMP は `pdfuaid:part` が 1 で、`title` があるときは `dc:title` がそれを含めば同じ値とする。根拠は ISO 14289-1 §7.1・§7.2。

#### Scenario: タグ付きで作った文書に同じ lang と title

- **WHEN** `create_markdown_pdf` を `tagged: true`・`lang: "en"`・`title: "Report"` で作った文書に、同じ `lang` と `title` で `ensure_tagged` を呼ぶ
- **THEN** `addedRequirements` と `replacedRequirements` は空

#### Scenario: 違う lang は書き直したものとして返す

- **WHEN** 同じ文書に `lang: "ja"` で `ensure_tagged` を呼ぶ
- **THEN** `replacedRequirements` に `Lang` があり、`addedRequirements` に `Lang` が無く、出力の catalog の `/Lang` は `ja`

#### Scenario: タグ無しの文書には今までどおり足す

- **WHEN** タグ無しの文書に `lang` と `title` を渡して `ensure_tagged` を呼ぶ
- **THEN** `addedRequirements` に `Lang`・`ViewerPreferences/DisplayDocTitle`・`XMP(pdfuaid:part, dc:title)` がある

### Requirement: SPEC-WRITER-ENSURE-TAGGED-002 変化が無くても出力を書き出し、変化が無かったことを返す

足すものも書き直すものも無いときも、`outputPath`（または base64）に出力を返す（SHALL）。応答の `requirementsChanged` は、構造木を作ったか、要件を 1 つでも足したか書き直したときに `true`、それ以外は `false` にする（SHALL）。

#### Scenario: 変化が無い

- **WHEN** 同じ `lang` と `title` で 2 回目の `ensure_tagged` を呼ぶ
- **THEN** `requirementsChanged` は `false` で、`outputPath` にファイルがある

#### Scenario: 変化がある

- **WHEN** タグ無しの文書に `ensure_tagged` を呼ぶ
- **THEN** `requirementsChanged` は `true`

### Requirement: SPEC-WRITER-ENSURE-TAGGED-003 PDF 2.0 の入力に PDF/UA-1 の宣言を書かない

`ensure_tagged` は、入力の版で名乗る PDF/UA の part を決め、版は変えない（SHALL）。入力の版が 2.0 以上のとき（ヘッダーが `%PDF-2.n`、または catalog の `/Version` が 2.0 以上。ISO 32000-2 §7.5.2）は PDF/UA-2 を名乗り、XMP に `pdfuaid:part` 2 と `pdfuaid:rev` 2024 を書く（SHALL）。2.0 未満なら今までどおり PDF/UA-1 を名乗る（SHALL）。ISO 14289-1 §6.1 は PDF/UA-1 の版を 1.0〜1.7、ISO 14289-2 §6.1 は PDF/UA-2 の版を 2.0 とするため、PDF 2.0 の入力に PDF/UA-1 の宣言を書かない。PDF/UA-2 で構造木を新たに作るときは、`Document` と `P` を PDF 2.0 の名前空間に置く（SHALL。SPEC-WRITER-PDFUA2-002 と同じ規則）。PDF 2.0 の入力では Info 辞書に `Title` を書かず、題名は XMP の `dc:title` にだけ書く（SHALL。ISO 32000-2 §14.3.3）。warnings の「CLAIMS … NOT checked」は名乗った part と、確かめる `flavour`（`pdfua-1` か `pdfua-2`）を書く（SHALL）。0.26.x までは、PDF 2.0 の入力を `INVALID_ARGUMENT` で断っていた。

#### Scenario: PDF 2.0 で作った文書

- **WHEN** `create_text_pdf` を `pdfVersion: "2.0"` で作ったタグ無しの文書に `ensure_tagged` を呼ぶ
- **THEN** 成功し、ヘッダーは `%PDF-2.0` のまま、XMP の `pdfuaid:part` は 2、`pdfuaid:rev` は 2024 で、`Document` の `/NS` が PDF 2.0 の名前空間を指し、warnings に `pdfua-2` がある

#### Scenario: PDF 1.7 の文書は今までどおり

- **WHEN** `create_text_pdf` を既定の版で作った文書に `ensure_tagged` を呼ぶ
- **THEN** 成功し、出力の XMP に `pdfuaid:part` がある

### Requirement: SPEC-WRITER-ENSURE-TAGGED-004 PDF/UA-2 で測ると落ちる既存の構造木を名指す

PDF 2.0 の入力が構造木を持ち、構造木の根の子が PDF 2.0 の名前空間の `Document` 1 つだけでないとき、構造木は変えずに、PDF/UA-2 の検査で落ちることを warnings に書く（SHALL）。根拠は ISO 14289-2 §8.2.5.2（構造木の根は PDF 2.0 の名前空間の `Document` を唯一の子に持つ）。`ensure_tagged` は既存の構造木に触らない（SPEC-WRITER-ENSURE-TAGGED-001 の前提）。

#### Scenario: 名前空間の無い Document を持つ PDF 2.0 の文書

- **WHEN** `/NS` の無い `Document` を構造木の根の子に持つ PDF 2.0 の文書に `ensure_tagged` を呼ぶ
- **THEN** 成功し、warnings に `8.2.5.2` を含む文がある

#### Scenario: PDF/UA-2 で作った文書には書かない

- **WHEN** `tagged: true`・`pdfVersion: "2.0"` で作った文書に `ensure_tagged` を呼ぶ
- **THEN** warnings に `8.2.5.2` を含む文が無い
