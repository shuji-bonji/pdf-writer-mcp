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

入力の版が 2.0 以上のとき（ヘッダーが `%PDF-2.n`、または catalog の `/Version` が 2.0 以上。ISO 32000-2 §7.5.2）、`ensure_tagged` はファイルを書かずに `INVALID_ARGUMENT` を返す（SHALL）。writer が書けるアクセシビリティの宣言は PDF/UA-1 だけで、ISO 14289-1 §6.1 は PDF/UA-1 のファイルの版を 1.0〜1.7 とするためである。作成系の B-16 と `ensure_pdfa` の SPEC-WRITER-ENSURE-PDFA-001 と同じ扱いにする。

#### Scenario: PDF 2.0 で作った文書

- **WHEN** `create_text_pdf` を `pdfVersion: "2.0"` で作った文書に `ensure_tagged` を呼ぶ
- **THEN** `code` は `INVALID_ARGUMENT` で、`outputPath` にファイルが無い

#### Scenario: PDF 1.7 の文書は今までどおり

- **WHEN** `create_text_pdf` を既定の版で作った文書に `ensure_tagged` を呼ぶ
- **THEN** 成功し、出力の XMP に `pdfuaid:part` がある
