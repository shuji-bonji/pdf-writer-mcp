---
approved: 2026-11-10
pr: 33
implementation: required
targets: [pdfua2]
---

# Proposal

## Why

Issue: #31・#32

#28 の検証で、PDF/UA-2 の文書を編集する 2 つのツールの出力が veraPDF 1.30.0 の `pdfua-2` で落ちることが分かりました（2026-11-10）。

1. `add_annotation` に `alt` を渡すと、ISO 14289-2 8.9.4.2-1 で落ちる（#31）。注釈の `/Contents` には `contents`（無ければ空文字）を、`Annot` 構造要素の `/Alt` には `alt` を書くので、値が違う。0.27.0 でも同じ。
2. `tag_form_fields` の出力が 8.10.2.3-1 で落ちる（#32）。このツールは `Lbl` 構造要素を作らず、ウィジェットに `/Contents` も書かないので、ラベルも `Contents` も無いウィジェットになる。

#28 の方針（出力が宣言した規格の shall に反するものは断る、その版・規格の書き方で書く）に当てはめると、どちらも writer 自身が書くものが PDF/UA-2 の shall に反しています。

## What Changes

- `add_annotation`：PDF/UA-2 を宣言した文書で `alt` を渡されたとき、`contents` が無ければ注釈の `/Contents` に `alt` を書く（§8.9.4.1: 代替記述は `Contents` で書く。§8.9.4.2: `Contents` と `Alt` は同じ値）。`contents` と `alt` の両方があり値が違えば、ファイルを書かずに `INVALID_ARGUMENT` を返す（PDFUA2-007）。
- `tag_form_fields`：PDF/UA-2 を宣言した文書で、`/Contents` を持たないウィジェットに `/Contents` を書く。値は `labels[フィールド名]`、無ければ既存の `/TU`、それも無ければフィールド名（§8.10.2.3: ラベルが無ければ `Contents` を書く。`TU` と同じ値でもよい）（PDFUA2-008）。

### 変わる振る舞い

- PDF/UA-2 の文書への `add_annotation`（`alt` あり・`contents` なし）：`/Contents` が空文字から `alt` になる。
- PDF/UA-2 の文書への `add_annotation`（`alt` と `contents` の値が違う）：書いていたものが `INVALID_ARGUMENT` になる。
- PDF/UA-2 の文書への `tag_form_fields`：ウィジェットに `/Contents` が増える。

### 変わらない振る舞い

- PDF/UA-1 の文書・タグ無しの文書への `add_annotation` と `tag_form_fields` の出力。
- 既に `/Contents` を持つウィジェット。既に構造木に結ばれているウィジェット（今までどおり触らない）。

### 対象外

- `Lbl` 構造要素を作ること（見えている文字のどれがラベルかを、このツールは知らない）。
- `add_annotation` で `contents` だけを渡したときの扱い（§8.9.2.3 はマークアップ注釈の `Contents` を省いてよいとし、`Alt` が無ければ §8.9.4.2 は当たらない）。

## Capabilities

- `pdfua2`（ADDED: 007・008）

## 人が判断すること

- `add_annotation` は `/Contents` を `alt` に揃え、値が違えば断る。`tag_form_fields` の `/Contents` は `labels` → `/TU` → フィールド名（2026-11-10 に本人が決定）。
- 🔴 未判断: 版。0.28.1（patch）を提案（PDF/UA-2 の文書を編集した出力の不具合の修正。断るのは引数が規格の shall に反するときだけ）。
