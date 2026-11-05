---
approved:
pr:
implementation: required
targets: [ensure-tagged, ensure-pdfa]
---

# Proposal

## Why

`ensure_tagged` と `ensure_pdfa` が返す報告の項目が、ファイルに実際に起きた変更と食い違います（#11・F-20・F-31）。

1. **`ensure_tagged` が、すでにあった要件を `addedRequirements` に返し、値も書き直す**（F-20）。`create_markdown_pdf` を `tagged: true` で作った PDF（`Lang`・`ViewerPreferences/DisplayDocTitle`・`pdfuaid` がある）に呼ぶと、`["Lang", "ViewerPreferences/DisplayDocTitle", "XMP(pdfuaid:part, dc:title)"]` が返ります。`src/services/tagged-cos.ts` は、`Lang` を `lang` 引数があれば既存の値に関係なく、`DisplayDocTitle` と XMP を無条件に書き、無条件に積んでいます。ツールの説明は「欠落した文書要件のみ補う」です。
2. **`ensure_pdfa` の `wasDeclared` が、何についての宣言かを分けていない**（F-31）。PDF/A-3b を宣言した文書に `pdfa-4f` を求めると、`wasDeclared: true` が返ります。前の宣言は part 3・conformance B で、求めた flavour とは違います。

`ensure_tagged` の仕様はまだありません。この変更で capability `ensure-tagged` の初版を起こし、この振る舞いだけを書きます。`ensure-pdfa` は `ensure-pdfa4-refuses-pdfua1` の変更が作るので、そちらを先に archive します。

## What Changes

- `ensure_tagged`: `Lang`・`ViewerPreferences/DisplayDocTitle`・`XMP(pdfuaid:part, dc:title)` の 3 つは、入力に無かったものだけを `addedRequirements` に、値が違って書き直したものを新しい `replacedRequirements` に入れる。同じ値がすでにあるものは書き直さず、どちらにも入れない。
- `ensure_tagged`: 新しい `requirementsChanged`（真偽値）で、要件を 1 つでも足したか書き直したかを返す。`false` でも出力のファイルは書き出す（呼び出し側は `outputPath` にファイルがある前提で動く）。全書き直しなので `/ModDate` は今までどおり更新される。
- `ensure_pdfa`: `wasDeclared`（真偽値）を `previousDeclaration: { part, conformance } | null` に**置き換える**。`part` は入力の XMP の `pdfaid:part`（数）、`conformance` は `pdfaid:conformance`（文字列。無ければ `null`）。移行の版は設けない（0.x のため。2026-11-06 決定）。

### 変わる振る舞い

- `ensure_tagged` の `addedRequirements` の中身と、`replacedRequirements`・`requirementsChanged` の追加。すでに同じ値を持つ入力に対しては、その値を書き直さない。
- `ensure_pdfa` の応答から `wasDeclared` が無くなり、`previousDeclaration` が加わる（**破壊的変更**）。

### 変わらない振る舞い

- `MarkInfo/Marked`・`StructTreeRoot(Document > P)` の扱い（すでに条件付き）。
- `ensure_tagged` の warnings（CLAIMS … NOT checked など）。
- `ensure_pdfa` の `addedRequirements`（すでに条件付き）。

### 対象外

- `/Info` の `/Title` を、同じ値でも書き直していること（`addedRequirements` には入れていない）。
- 何も変わらないときに書き出しを省くこと（決定のとおり、書き出す）。

## Capabilities

- `ensure-tagged`（新規。`kind: tool`。ADDED: 001・002）
- `ensure-pdfa`（ADDED: 002）

## 人が判断すること

- 項目名 `replacedRequirements` と `requirementsChanged`。
- XMP を「同じ」と見なす条件を、`pdfuaid:part` が 1 で、`title` を渡したときは `dc:title` にその文字列がある、とすること（XMP の全体の一致は見ない）。
- 版。`wasDeclared` を外すので、writer の minor（0.24.0）を提案します。
