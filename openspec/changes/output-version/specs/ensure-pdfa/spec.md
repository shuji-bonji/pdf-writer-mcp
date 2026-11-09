## ADDED Requirements

### Requirement: SPEC-WRITER-ENSURE-PDFA-004 PDF 2.0 の入力に PDF/A-3b を名乗らせない

入力のヘッダーが `%PDF-2.0` のときに `flavour` が `pdfa-3b` なら、PDF/UA の宣言の有無に関係なく、ファイルを書かずに `INVALID_ARGUMENT` を返す（SHALL）。`ensure_pdfa` はヘッダーを下げないので、出力は PDF/A-3 のヘッダーの規則（`%PDF-1.n`、n は 0〜7）で必ず落ちる。`next_actions` に `flavour: "pdfa-4"` で呼び直す案内を 1 つ置く（SHALL）。根拠は veraPDF 1.30.0 の ISO 19005-3:2012 6.1.2-1 の実測（PDF/A は pdf-spec-mcp のコーパスに無い）。PDF/UA-2 の入力（ENSURE-PDFA-003）はこの規則にも当たる。

#### Scenario: タグ無しの PDF 2.0 に pdfa-3b

- **WHEN** `pdfVersion: "2.0"` だけで作った文書に `flavour: "pdfa-3b"` で `ensure_pdfa` を呼ぶ
- **THEN** `code` は `INVALID_ARGUMENT`、`next_actions[0].example.flavour` は `pdfa-4`、`outputPath` にファイルが無い
