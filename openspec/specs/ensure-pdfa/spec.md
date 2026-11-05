---
spec_id: WRITER
kind: tool
introduced_by: ensure-pdfa4-refuses-pdfua1
---
# ensure-pdfa Specification

## Purpose
`ensure_pdfa` ツールが、既存の PDF に PDF/A の文書レベルの要件と宣言を書くときの規則を定めます。このツールは宣言を書くだけで適合は確かめない（判定は pdf-verify-mcp と veraPDF の仕事）ことを前提に、宣言が両立しない入力（PDF/UA-1 を宣言した入力への PDF/A-4）を断ることと、入力がもともと名乗っていた宣言を返すことを扱います。補う要件の一覧と、PDF/A-4 のヘッダー・Info 辞書の始末は、既存のテスト（`tests/pdfa-conformance.test.ts`）が固定しています。

## Requirements

### Requirement: SPEC-WRITER-ENSURE-PDFA-001 PDF/UA を宣言した入力に PDF/A-4 を名乗らせない

入力の XMP が `pdfuaid:part` を宣言しているときに `flavour` が `pdfa-4` か `pdfa-4f` なら、ファイルを書かずに `INVALID_ARGUMENT` を返す（SHALL）。PDF/A-4 はヘッダーを `%PDF-2.0` にし、PDF/UA-1 は ISO 14289-1 §6.1 で版を 1.0〜1.7 とするので、両方の宣言を持つファイルは片方の検査で必ず落ちる。`next_actions` に、`flavour: "pdfa-3b"` で呼び直す案内を 1 つ置く（SHALL）。作成系の B-16（`tagged: true` と `pdfVersion: "2.0"` の組み合わせを断る）と同じ扱いである。

#### Scenario: PDF/UA-1 の入力に pdfa-4f

- **WHEN** `pdfuaid:part` を宣言したタグ付きの文書に、`flavour: "pdfa-4f"` で `ensure_pdfa` を呼ぶ
- **THEN** `code` は `INVALID_ARGUMENT`、`next_actions[0].example.flavour` は `pdfa-3b`、`outputPath` にファイルが無い

#### Scenario: PDF/UA-1 の入力に pdfa-4

- **WHEN** 同じ文書に `flavour: "pdfa-4"` で呼ぶ
- **THEN** `code` は `INVALID_ARGUMENT`

#### Scenario: PDF/UA-1 の入力に pdfa-3b は今までどおり

- **WHEN** 同じ文書に `flavour: "pdfa-3b"` で呼ぶ
- **THEN** 成功し、出力の XMP に `pdfuaid:part` が残る

### Requirement: SPEC-WRITER-ENSURE-PDFA-002 前の宣言そのものを返す

`ensure_pdfa` は、入力の XMP にあった PDF/A の宣言を `previousDeclaration: { part, conformance }` で返し、無ければ `null` を返す（SHALL）。`part` は `pdfaid:part` の数、`conformance` は `pdfaid:conformance` の文字列で、無ければ `null` にする（SHALL）。0.23.x の `wasDeclared`（真偽値）は返さない（SHALL）。「何かの宣言があった」と「求めた flavour と同じ宣言があった」を、受け側が区別できるようにするためである。

#### Scenario: PDF/A-3b の文書に pdfa-4f

- **WHEN** `ensure_pdfa`（`pdfa-3b`）の出力に、`flavour: "pdfa-4f"` で `ensure_pdfa` を呼ぶ
- **THEN** `previousDeclaration` は `{ part: 3, conformance: "B" }` で、応答に `wasDeclared` が無い

#### Scenario: 宣言の無い文書

- **WHEN** PDF/A を宣言していない文書に `ensure_pdfa` を呼ぶ
- **THEN** `previousDeclaration` は `null`
