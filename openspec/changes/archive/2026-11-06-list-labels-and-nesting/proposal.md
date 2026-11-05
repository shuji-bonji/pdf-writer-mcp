---
approved: 2026-11-06
pr: 18
implementation: required
targets: [create-markdown-pdf]
---

# Proposal

## Why

`create_markdown_pdf` の箇条書きと番号付きリストに、3 つの問題があります（#12・F-14 と、着手の前に見つけた 2 点）。

1. **記号が本文に入る**（#12）。構造木は `L > LI > LBody` だけで、`LBody` の本文が「• 項目1」「1. 項目1」になります（`src/services/renderers/markdown.ts`）。pdf-reader-mcp の `extract_structured_text` は記号を本文として返します。ISO 14289-1 §7.6（R-7.6-3）は `Lbl` と `LBody` を含めてよい（may）とし、ISO 32000-1 Table 336 は `Lbl` を「箇条書きの記号や項目の番号と句読点を持つ」要素としています。
2. **番号付きリストに `ListNumbering` が無い**。ISO 14289-1 §7.6（R-7.6-4）は「番号付きリストの `L` には、ISO 32000-1 §14.8.5.5 Table 347 の `ListNumbering` 属性を明示する（shall）」としています。`src` に `ListNumbering` は 1 か所もありません。
3. **入れ子のリストが平らになる**。`- alpha` の下の `  - beta`・`  - gamma` は、Markdown の文字列のまま親の本文に畳まれ、「• alpha - beta - gamma」の 1 項目になります（marked 18.0.11 の `item.text` を空白でつないでいるため）。構造の入れ子も、見た目の字下げも失われます。

`create_markdown_pdf` の仕様はまだありません。この変更で capability `create-markdown-pdf` の初版を起こし、リストの振る舞いだけを書きます。

## What Changes

- 各項目の記号（`•`、`1.` など）を `Lbl`、本文を `LBody` で描く。`Lbl` は ISO 32000-1 Table 347 の NOTE のとおり、番号を明示的に持つ。
- `L` に `/A << /O /List /ListNumbering … >>` を書く。番号付きは `Decimal`、箇条書きは `Disc`。タグ付きの出力は PDF 1.7（B-16）なので、PDF 2.0 で足された値（`Ordered`・`Unordered`）は使わない。
- 入れ子のリストは、親の項目の `LBody` の中に子の `L` として置く（ISO 32000-1 Table 336: `LBody` は「入れ子のリストを含む、ほかのブロックを子に持ってよい」。2026-11-06 に A 案と決定）。見た目も 1 段ずつ字下げする。
- 本文は記号の幅だけ右から始め、2 行目以降も本文の始まりにそろえる（ぶら下げインデント）。タグの無い出力も同じ描き方にする。

### 変わる振る舞い

- タグ付きの出力の構造木（`LI` の子が `Lbl` と `LBody` になる、`L` に `/A`、入れ子の `L`）。
- リストの見た目（ぶら下げインデント、入れ子の字下げ）。タグの有無にかかわらない。

### 変わらない振る舞い

- 記号の文字（`•`、`<番号>. `）と、番号の始まり（`start`）。
- リスト以外の要素（見出し・段落・表・コード・引用）。
- `create_text_pdf`・`create_table_pdf`。

### 対象外

- 引用（`>`）やコードブロックを含む項目の中の、リスト以外のブロック。いまどおり本文の文字列として描く。
- タスクリスト（`- [ ]`）の記号。
- PDF 2.0 の形（子の `L` を親の `L` の直下に置く。ISO 32000-2 §14.8.4.8.2）。PDF/UA-2 の出力を作るときに切り替える。

## Capabilities

- `create-markdown-pdf`（新規。`kind: tool`。ADDED: 001〜004）

起こす範囲はリストの振る舞いだけです。見出しの階層と題名は `create-title` と既存のテスト（`tests/tagged.test.ts`）が固定しています。

## 人が判断すること

- 箇条書きにも `ListNumbering: Disc` を書くこと（条文では任意）。
- 版。出力の構造と見た目が変わるので、0.25.0（minor）を提案します。
- veraPDF の PDF/UA-1 で、入れ子を含む出力を手元で測ること（この環境には veraPDF が無い）。
