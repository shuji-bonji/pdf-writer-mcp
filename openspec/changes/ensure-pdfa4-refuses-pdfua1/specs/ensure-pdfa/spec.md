## ADDED Requirements

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
