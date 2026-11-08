## MODIFIED Requirements

### Requirement: SPEC-WRITER-CREATE-MARKDOWN-PDF-003 入れ子のリストは親の項目の LBody の中に置く

PDF/UA-1 で生成するとき（`pdfVersion` が `"2.0"` でないとき）、入れ子のリストは、親の項目の文字に畳まず、親の `LI` の `LBody` の子に `L` として置く（SHALL）。根拠は ISO 32000-1 Table 336（`LBody` は「入れ子のリストを含む、ほかのブロックを子に持ってよい」）。子のリストの項目も 001・002 に従う（SHALL）。PDF/UA-2 での置き場所は 005 に従う（SHALL）。

#### Scenario: 箇条書きの中の箇条書き

- **WHEN** `- Alpha`、その下に字下げした `- Beta` と `- Gamma`、続けて `- Delta` を `tagged: true` で描く
- **THEN** 外側の `L` の `LI` は 2 つ（`Alpha`・`Delta`）で、`Alpha` の `LBody` の子に `L` があり、その `LI` は 2 つ（`Beta`・`Gamma`）。どの `LBody` の文字にも `- ` が無い

## ADDED Requirements

### Requirement: SPEC-WRITER-CREATE-MARKDOWN-PDF-005 PDF/UA-2 では入れ子のリストを親の L の直接の子に置く

PDF/UA-2 で生成するとき（`tagged: true` と `pdfVersion: "2.0"`）、入れ子のリストは、親の項目の `LI` の直後に、親の `L` の直接の子として置く（SHALL）。親の項目の `LBody` には入れ子の `L` を置かない（SHALL）。描く位置（親の項目の本文の欄から字下げ）は 003 と同じにする（SHALL）。根拠は ISO 32000-2 §14.8.4.8.2（階層のあるリストは、入れ子の `L` を親の `L` の直接の子か、親の `L` に属する `Div` の中に置く）と例 H.8.3。子のリストの項目も 001・002 に従う（SHALL）。

#### Scenario: PDF/UA-2 の箇条書きの中の箇条書き

- **WHEN** `- Alpha`、その下に字下げした `- Beta` と `- Gamma`、続けて `- Delta` を `tagged: true`・`pdfVersion: "2.0"` で描く
- **THEN** 外側の `L` の子は順に `LI`（`Alpha`）・`L`（`LI` が `Beta`・`Gamma`）・`LI`（`Delta`）で、`Alpha` の `LBody` に `L` が無い

#### Scenario: 描く位置は PDF/UA-1 と同じ

- **WHEN** 同じ Markdown を `tagged: true` だけで描いたものと、`pdfVersion: "2.0"` も付けて描いたものを比べる
- **THEN** `Beta` の文字の x 座標が同じ
