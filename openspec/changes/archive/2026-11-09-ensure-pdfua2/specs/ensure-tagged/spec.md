## MODIFIED Requirements

### Requirement: SPEC-WRITER-ENSURE-TAGGED-003 PDF 2.0 の入力に PDF/UA-1 の宣言を書かない

`ensure_tagged` は、入力の版で名乗る PDF/UA の part を決め、版は変えない（SHALL）。入力の版が 2.0 以上のとき（ヘッダーが `%PDF-2.n`、または catalog の `/Version` が 2.0 以上。ISO 32000-2 §7.5.2）は PDF/UA-2 を名乗り、XMP に `pdfuaid:part` 2 と `pdfuaid:rev` 2024 を書く（SHALL）。2.0 未満なら今までどおり PDF/UA-1 を名乗る（SHALL）。ISO 14289-1 §6.1 は PDF/UA-1 の版を 1.0〜1.7、ISO 14289-2 §6.1 は PDF/UA-2 の版を 2.0 とするため、PDF 2.0 の入力に PDF/UA-1 の宣言を書かない。PDF/UA-2 で構造木を新たに作るときは、`Document` と `P` を PDF 2.0 の名前空間に置く（SHALL。SPEC-WRITER-PDFUA2-002 と同じ規則）。PDF 2.0 の入力では Info 辞書に `Title` を書かず、題名は XMP の `dc:title` にだけ書く（SHALL。ISO 32000-2 §14.3.3）。warnings の「CLAIMS … NOT checked」は名乗った part と、確かめる `flavour`（`pdfua-1` か `pdfua-2`）を書く（SHALL）。0.26.x までは、PDF 2.0 の入力を `INVALID_ARGUMENT` で断っていた。

#### Scenario: PDF 2.0 で作った文書

- **WHEN** `create_text_pdf` を `pdfVersion: "2.0"` で作ったタグ無しの文書に `ensure_tagged` を呼ぶ
- **THEN** 成功し、ヘッダーは `%PDF-2.0` のまま、XMP の `pdfuaid:part` は 2、`pdfuaid:rev` は 2024 で、`Document` の `/NS` が PDF 2.0 の名前空間を指し、warnings に `pdfua-2` がある

#### Scenario: PDF 1.7 の文書は今までどおり

- **WHEN** `create_text_pdf` を既定の版で作った文書に `ensure_tagged` を呼ぶ
- **THEN** 成功し、出力の XMP に `pdfuaid:part` がある

## ADDED Requirements

### Requirement: SPEC-WRITER-ENSURE-TAGGED-004 PDF/UA-2 で測ると落ちる既存の構造木を名指す

PDF 2.0 の入力が構造木を持ち、構造木の根の子が PDF 2.0 の名前空間の `Document` 1 つだけでないとき、構造木は変えずに、PDF/UA-2 の検査で落ちることを warnings に書く（SHALL）。根拠は ISO 14289-2 §8.2.5.2（構造木の根は PDF 2.0 の名前空間の `Document` を唯一の子に持つ）。`ensure_tagged` は既存の構造木に触らない（SPEC-WRITER-ENSURE-TAGGED-001 の前提）。

#### Scenario: 名前空間の無い Document を持つ PDF 2.0 の文書

- **WHEN** `/NS` の無い `Document` を構造木の根の子に持つ PDF 2.0 の文書に `ensure_tagged` を呼ぶ
- **THEN** 成功し、warnings に `8.2.5.2` を含む文がある

#### Scenario: PDF/UA-2 で作った文書には書かない

- **WHEN** `tagged: true`・`pdfVersion: "2.0"` で作った文書に `ensure_tagged` を呼ぶ
- **THEN** warnings に `8.2.5.2` を含む文が無い
