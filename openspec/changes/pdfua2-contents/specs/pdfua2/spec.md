## ADDED Requirements

### Requirement: SPEC-WRITER-PDFUA2-007 PDF/UA-2 の文書に足す注釈の Contents を Alt と揃える

PDF/UA-2 を宣言した文書（`pdfuaid:part` 2）に `add_annotation` で `alt` を渡したとき、`contents` が無ければ注釈の `/Contents` に `alt` を書く（SHALL）。`contents` と `alt` の両方があり値が違えば、ファイルを書かずに `INVALID_ARGUMENT` を返し、`next_actions` に同じ値で呼び直す案内を置く（SHALL）。根拠は ISO 14289-2 §8.9.4.1（代替記述は `Contents` で書く）と §8.9.4.2（`Contents` と直接囲む構造要素の `Alt` は同じ値）。PDF/UA-1 の文書とタグ無しの文書の扱いは変えない。

#### Scenario: alt だけを渡す

- **WHEN** `tagged: true`・`pdfVersion: "2.0"` で作った文書に `alt: "Box"` だけを渡して `add_annotation` を呼ぶ
- **THEN** 注釈の `/Contents` と `Annot` 構造要素の `/Alt` はどちらも `Box`

#### Scenario: contents と alt が違う

- **WHEN** 同じ文書に `contents: "Note"`・`alt: "Box"` で呼ぶ
- **THEN** `code` は `INVALID_ARGUMENT`、`outputPath` にファイルが無い

#### Scenario: PDF/UA-1 の文書は今までどおり

- **WHEN** `tagged: true` だけで作った文書に `alt: "Box"` だけを渡して呼ぶ
- **THEN** 注釈の `/Contents` は空文字のまま

### Requirement: SPEC-WRITER-PDFUA2-008 PDF/UA-2 の文書のウィジェットに Contents を書く

PDF/UA-2 を宣言した文書に `tag_form_fields` を掛けるとき、構造木に結んだウィジェットのうち `/Contents` を持たないものに `/Contents` を書く（SHALL）。値は `labels` のそのフィールドの値、無ければフィールドの既存の `/TU`、それも無ければフィールド名とする（SHALL）。既に `/Contents` を持つウィジェットは変えない（SHALL）。根拠は ISO 14289-2 §8.10.2.3（ラベルが無いウィジェットには `Contents` を書く。フィールドの `TU` は `Contents` と同じ値でもよい）。このツールは `Lbl` 構造要素を作らないので、結んだウィジェットにラベルは無い。PDF/UA-1 の文書の扱いは変えない。

#### Scenario: labels を渡したフィールド

- **WHEN** PDF/UA-2 で作った文書にテキストフィールド `user.name` を足し、`labels: { "user.name": "Name" }` で `tag_form_fields` を呼ぶ
- **THEN** そのウィジェットの `/Contents` は `Name`

#### Scenario: labels を渡さないフィールド

- **WHEN** 同じ文書に `labels` なしで呼ぶ
- **THEN** そのウィジェットの `/Contents` は `user.name`

#### Scenario: PDF/UA-1 の文書は今までどおり

- **WHEN** `tagged: true` だけで作った文書に同じフィールドを足し、`labels` を渡して呼ぶ
- **THEN** ウィジェットに `/Contents` が無い
