---
spec_id: WRITER
kind: tool
introduced_by: list-labels-and-nesting
---
# create-markdown-pdf Specification

## Purpose
`create_markdown_pdf` ツールが、Markdown をタグ付き PDF に描くときの規則を定めます。この初版はリストだけを扱います。記号・番号を `Lbl`、本文を `LBody` に分けること、`L` に `ListNumbering` を書くこと、入れ子のリストを親の項目の `LBody` の中に置くこと、本文を記号の欄の右からそろえて描くことの 4 つです。根拠は ISO 14289-1 §7.6 と ISO 32000-1 Table 336・Table 347 です。見出し・段落・表などほかの要素の描き方は、既存のテスト（`tests/generate.test.ts`・`tests/tagged.test.ts`・`tests/strip-inline.test.ts`）と正本 `create-title` が固定しています。

## Requirements

### Requirement: SPEC-WRITER-CREATE-MARKDOWN-PDF-001 リストの記号を Lbl、本文を LBody で描く

`tagged: true` のとき、リストの各項目は `LI` とし、その子に記号（箇条書きの `•`、番号付きの `<番号>.`）を持つ `Lbl` と、本文を持つ `LBody` をこの順に置く（SHALL）。本文に記号を入れない（SHALL）。根拠は ISO 14289-1 §7.6（R-7.6-2・R-7.6-3）と ISO 32000-1 Table 336。

#### Scenario: 箇条書きの記号は Lbl に入る

- **WHEN** `- Alpha` と `- Bravo` の箇条書きを `tagged: true` で描く
- **THEN** 2 つの `LI` の子はどちらも `Lbl` と `LBody` の順で、`LBody` の文字は `Alpha`・`Bravo`（記号を含まない）

#### Scenario: 番号は Lbl に入る

- **WHEN** `1. One` と `2. Two` の番号付きリストを `tagged: true` で描く
- **THEN** `Lbl` の文字は `1.`・`2.`、`LBody` の文字は `One`・`Two`

### Requirement: SPEC-WRITER-CREATE-MARKDOWN-PDF-002 L に ListNumbering を書く

`tagged: true` のとき、`L` に属性 `/A << /O /List /ListNumbering … >>` を書く（SHALL）。値は番号付きリストで `Decimal`、箇条書きで `Disc` とする（SHALL）。番号付きリストへの明示は ISO 14289-1 §7.6（R-7.6-4）の shall で、値は ISO 32000-1 §14.8.5.5 Table 347 から選ぶ。

#### Scenario: 番号付きリストは Decimal

- **WHEN** 番号付きリストを `tagged: true` で描く
- **THEN** `L` の `/A` は `/O /List` と `/ListNumbering /Decimal` を持つ

#### Scenario: 箇条書きは Disc

- **WHEN** 箇条書きを `tagged: true` で描く
- **THEN** `L` の `/A` は `/O /List` と `/ListNumbering /Disc` を持つ

### Requirement: SPEC-WRITER-CREATE-MARKDOWN-PDF-003 入れ子のリストは親の項目の LBody の中に置く

入れ子のリストは、親の項目の文字に畳まず、親の `LI` の `LBody` の子に `L` として置く（SHALL）。根拠は ISO 32000-1 Table 336（`LBody` は「入れ子のリストを含む、ほかのブロックを子に持ってよい」）。子のリストの項目も 001・002 に従う（SHALL）。

#### Scenario: 箇条書きの中の箇条書き

- **WHEN** `- Alpha`、その下に字下げした `- Beta` と `- Gamma`、続けて `- Delta` を `tagged: true` で描く
- **THEN** 外側の `L` の `LI` は 2 つ（`Alpha`・`Delta`）で、`Alpha` の `LBody` の子に `L` があり、その `LI` は 2 つ（`Beta`・`Gamma`）。どの `LBody` の文字にも `- ` が無い

### Requirement: SPEC-WRITER-CREATE-MARKDOWN-PDF-004 本文は記号の幅だけ右から始め、折り返しもそろえる

リストの項目は、記号を項目の字下げの位置に描き、本文を記号の幅だけ右から描く（SHALL）。本文が折り返すときは、2 行目以降も本文の 1 行目の始まりにそろえる（SHALL）。入れ子のリストは親より 1 段右に字下げする（SHALL）。タグの有無にかかわらず同じ描き方にする（SHALL）。

#### Scenario: 折り返した本文の始まりがそろう

- **WHEN** 2 行に折り返す長さの本文を持つ箇条書きを描く
- **THEN** 本文の 1 行目と 2 行目の x 座標は同じで、記号の x 座標より大きい

#### Scenario: 入れ子は 1 段右

- **WHEN** 入れ子の箇条書きを描く
- **THEN** 子の項目の記号の x 座標は、親の項目の記号の x 座標より大きい
