## ADDED Requirements

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
