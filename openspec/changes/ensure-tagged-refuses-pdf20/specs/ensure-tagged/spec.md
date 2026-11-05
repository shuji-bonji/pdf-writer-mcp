## ADDED Requirements

### Requirement: SPEC-WRITER-ENSURE-TAGGED-003 PDF 2.0 の入力に PDF/UA-1 の宣言を書かない

入力の版が 2.0 以上のとき（ヘッダーが `%PDF-2.n`、または catalog の `/Version` が 2.0 以上。ISO 32000-2 §7.5.2）、`ensure_tagged` はファイルを書かずに `INVALID_ARGUMENT` を返す（SHALL）。writer が書けるアクセシビリティの宣言は PDF/UA-1 だけで、ISO 14289-1 §6.1 は PDF/UA-1 のファイルの版を 1.0〜1.7 とするためである。作成系の B-16 と `ensure_pdfa` の SPEC-WRITER-ENSURE-PDFA-001 と同じ扱いにする。

#### Scenario: PDF 2.0 で作った文書

- **WHEN** `create_text_pdf` を `pdfVersion: "2.0"` で作った文書に `ensure_tagged` を呼ぶ
- **THEN** `code` は `INVALID_ARGUMENT` で、`outputPath` にファイルが無い

#### Scenario: PDF 1.7 の文書は今までどおり

- **WHEN** `create_text_pdf` を既定の版で作った文書に `ensure_tagged` を呼ぶ
- **THEN** 成功し、出力の XMP に `pdfuaid:part` がある
