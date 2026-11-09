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

入力の XMP が `pdfuaid:part` を 2 以外の値で宣言しているときに `flavour` が `pdfa-4` か `pdfa-4f` なら、ファイルを書かずに `INVALID_ARGUMENT` を返す（SHALL）。PDF/A-4 はヘッダーを `%PDF-2.0` にし、PDF/UA-1 は ISO 14289-1 §6.1 で版を 1.0〜1.7 とするので、両方の宣言を持つファイルは片方の検査で必ず落ちる。`next_actions` に、`flavour: "pdfa-3b"` で呼び直す案内を 1 つ置く（SHALL）。`pdfuaid:part` が 2（PDF/UA-2。ISO 14289-2 §6.1 で版は 2.0）なら PDF/A-4 と両立するので断らない（SHALL）。

#### Scenario: PDF/UA-1 の入力に pdfa-4f

- **WHEN** `pdfuaid:part` を宣言したタグ付きの文書に、`flavour: "pdfa-4f"` で `ensure_pdfa` を呼ぶ
- **THEN** `code` は `INVALID_ARGUMENT`、`next_actions[0].example.flavour` は `pdfa-3b`、`outputPath` にファイルが無い

#### Scenario: PDF/UA-1 の入力に pdfa-4

- **WHEN** 同じ文書に `flavour: "pdfa-4"` で呼ぶ
- **THEN** `code` は `INVALID_ARGUMENT`

#### Scenario: PDF/UA-1 の入力に pdfa-3b は今までどおり

- **WHEN** 同じ文書に `flavour: "pdfa-3b"` で呼ぶ
- **THEN** 成功し、出力の XMP に `pdfuaid:part` が残る

#### Scenario: PDF/UA-2 の入力に pdfa-4

- **WHEN** `tagged: true`・`pdfVersion: "2.0"` で作った文書に `flavour: "pdfa-4"` で呼ぶ
- **THEN** 成功し、出力の XMP に `pdfaid:part` 4 と `pdfuaid:part` 2・`pdfuaid:rev` 2024 がある

### Requirement: SPEC-WRITER-ENSURE-PDFA-002 前の宣言そのものを返す

`ensure_pdfa` は、入力の XMP にあった PDF/A の宣言を `previousDeclaration: { part, conformance }` で返し、無ければ `null` を返す（SHALL）。`part` は `pdfaid:part` の数、`conformance` は `pdfaid:conformance` の文字列で、無ければ `null` にする（SHALL）。0.23.x の `wasDeclared`（真偽値）は返さない（SHALL）。「何かの宣言があった」と「求めた flavour と同じ宣言があった」を、受け側が区別できるようにするためである。

#### Scenario: PDF/A-3b の文書に pdfa-4f

- **WHEN** `ensure_pdfa`（`pdfa-3b`）の出力に、`flavour: "pdfa-4f"` で `ensure_pdfa` を呼ぶ
- **THEN** `previousDeclaration` は `{ part: 3, conformance: "B" }` で、応答に `wasDeclared` が無い

#### Scenario: 宣言の無い文書

- **WHEN** PDF/A を宣言していない文書に `ensure_pdfa` を呼ぶ
- **THEN** `previousDeclaration` は `null`

### Requirement: SPEC-WRITER-ENSURE-PDFA-003 PDF/UA-2 を宣言した入力に PDF/A-3b を名乗らせない

入力の XMP が `pdfuaid:part` 2 を宣言しているときに `flavour` が `pdfa-3b` なら、ファイルを書かずに `INVALID_ARGUMENT` を返す（SHALL）。PDF/UA-2 は版を 2.0 とし（ISO 14289-2 §6.1）、PDF/A-3 はヘッダーを `%PDF-1.n`（n は 0〜7）に限る。`ensure_pdfa` はヘッダーを下げないので、両方の宣言を持つファイルは片方の検査で必ず落ちる。`next_actions` に、`flavour: "pdfa-4"` で呼び直す案内を 1 つ置く（SHALL）。PDF/A-3 のヘッダーの条文は pdf-spec-mcp のコーパスに無い（ISO 19005 は対象外）ので、根拠は veraPDF 1.30.0 の規則 ISO 19005-3:2012 6.1.2-1 の実測（2026-11-09。PDF/UA-2 の文書に `pdfa-3b` を掛けた出力が 1 件落ちる）とする。

#### Scenario: PDF/UA-2 の入力に pdfa-3b

- **WHEN** `tagged: true`・`pdfVersion: "2.0"` で作った文書に `flavour: "pdfa-3b"` で `ensure_pdfa` を呼ぶ
- **THEN** `code` は `INVALID_ARGUMENT`、`next_actions[0].example.flavour` は `pdfa-4`、`outputPath` にファイルが無い

### Requirement: SPEC-WRITER-ENSURE-PDFA-004 PDF 2.0 の入力に PDF/A-3b を名乗らせない

入力のヘッダーが `%PDF-2.0` のときに `flavour` が `pdfa-3b` なら、PDF/UA の宣言の有無に関係なく、ファイルを書かずに `INVALID_ARGUMENT` を返す（SHALL）。`ensure_pdfa` はヘッダーを下げないので、出力は PDF/A-3 のヘッダーの規則（`%PDF-1.n`、n は 0〜7）で必ず落ちる。`next_actions` に `flavour: "pdfa-4"` で呼び直す案内を 1 つ置く（SHALL）。根拠は veraPDF 1.30.0 の ISO 19005-3:2012 6.1.2-1 の実測（PDF/A は pdf-spec-mcp のコーパスに無い）。PDF/UA-2 の入力（ENSURE-PDFA-003）はこの規則にも当たる。

#### Scenario: タグ無しの PDF 2.0 に pdfa-3b

- **WHEN** `pdfVersion: "2.0"` だけで作った文書に `flavour: "pdfa-3b"` で `ensure_pdfa` を呼ぶ
- **THEN** `code` は `INVALID_ARGUMENT`、`next_actions[0].example.flavour` は `pdfa-4`、`outputPath` にファイルが無い
