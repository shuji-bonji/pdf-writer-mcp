## ADDED Requirements

### Requirement: SPEC-WRITER-ENSURE-PDFA-002 前の宣言そのものを返す

`ensure_pdfa` は、入力の XMP にあった PDF/A の宣言を `previousDeclaration: { part, conformance }` で返し、無ければ `null` を返す（SHALL）。`part` は `pdfaid:part` の数、`conformance` は `pdfaid:conformance` の文字列で、無ければ `null` にする（SHALL）。0.23.x の `wasDeclared`（真偽値）は返さない（SHALL）。「何かの宣言があった」と「求めた flavour と同じ宣言があった」を、受け側が区別できるようにするためである。

#### Scenario: PDF/A-3b の文書に pdfa-4f

- **WHEN** `ensure_pdfa`（`pdfa-3b`）の出力に、`flavour: "pdfa-4f"` で `ensure_pdfa` を呼ぶ
- **THEN** `previousDeclaration` は `{ part: 3, conformance: "B" }` で、応答に `wasDeclared` が無い

#### Scenario: 宣言の無い文書

- **WHEN** PDF/A を宣言していない文書に `ensure_pdfa` を呼ぶ
- **THEN** `previousDeclaration` は `null`
