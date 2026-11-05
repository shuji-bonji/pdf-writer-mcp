---
approved:
pr:
implementation: required
targets: [ensure-tagged]
---

# Proposal

## Why

PDF 2.0 の入力に `ensure_tagged` を呼ぶと、ヘッダーが `%PDF-2.0` のまま、XMP に PDF/UA-1 の宣言（`pdfuaid:part=1`）が書かれます（#17）。0.24.0 で、`create_text_pdf`（`pdfVersion: "2.0"`）の出力に `ensure_tagged` を呼んで確かめました。警告も拒否もありません。

ISO 14289-1 §6.1（pdf-spec-mcp の `pdfua1`、R-6.1-1）は、PDF/UA-1 のファイルの版を 1.0〜1.7 としています。writer はほかの 2 か所で、同じ組み合わせをすでに断っています。作成系の `tagged: true` と `pdfVersion: "2.0"`（`builder.ts` の B-16）と、`ensure_pdfa` の PDF/UA の入力への `pdfa-4`・`pdfa-4f`（0.24.0、#9）です。`ensure_tagged` だけが入力の版を見ていません。

## What Changes

- 入力の版（ヘッダー、または catalog の `/Version` で上げた版。ISO 32000-2 §7.5.2）が 2.0 以上なら、ファイルを書かずに `INVALID_ARGUMENT` を返す。`hint` で、writer が書ける宣言は PDF/UA-1（PDF 1.7 基盤）だけで、PDF/UA-2 の出力は未実装であることと、PDF 1.7 で作り直す手を書く。

### 変わる振る舞い

- PDF 2.0 の入力への `ensure_tagged` がエラー応答になる。

### 変わらない振る舞い

- PDF 1.x の入力への `ensure_tagged`。
- 作成系の B-16 と、`ensure_pdfa` の #9 の拒否。

### 対象外

- PDF/UA-2 の宣言を書くこと（未実装）。
- 2.0 の入力を 1.7 に下げて書き直すこと（版を黙って変えない）。

## Capabilities

- `ensure-tagged`（ADDED: 003）

## 人が判断すること

- `next_actions` を付けないこと。1.7 に戻す手は writer の中に無く（作り直すしかない）、再試行で解ける形の案内を出せないためです。`retryable` は `INVALID_ARGUMENT` の表どおり `true` になります。
- catalog の `/Version` で上げた版も見ること（ヘッダーが 1.7 でも、catalog が `/Version /2.0` なら断る）。
