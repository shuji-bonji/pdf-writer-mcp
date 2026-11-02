---
approved: 2026-11-02
pr: 7
implementation: required
targets: [create-title]
---

# Proposal

## Why

生成 3 ツール（`create_text_pdf`・`create_markdown_pdf`・`create_table_pdf`）は、`title` を渡されると、メタデータに書くだけでなく、本文の先頭に見出しとして必ず描きます（`tools/list` の説明: "Set in the metadata and also drawn as a heading at the top of the body."）。

`tagged: true` では `title` が必須です（SPEC-WRITER-CREATE-TITLE-001）。そのため、`# 報告書` で始まる Markdown を `title: "報告書"` でタグ付きにすると、同じ見出しが 2 回描かれ、構造木にも H1 が 2 つ並びます。利用者は題名を Markdown から外すか、二重を受け入れるしかありません。2026-09-16 の Grok Build での実機評価（pdf-agent-stack #26）で見つかり、未起票のまま残っていました。

ISO 14289-1 §7.1 が求めているのは catalog の Metadata ストリームの `dc:title` で、本文に題名を描くことではありません（pdf-spec-mcp `pdfua1` で原文を確認）。題名をメタデータだけに書く選択肢があれば、PDF/UA-1 の要求を満たしたまま二重を避けられます。

## What Changes

- 生成 3 ツールの共通引数に `drawTitle`（boolean、既定 `true`）を足す。`false` なら `title` をメタデータにだけ書き、本文には描かない。
- 題名を描かないときは、題名にフォントの検査（標準フォントでの非 Latin-1 の拒否と `onMissingGlyph`）を当てない（002 の書き換え）。
- 題名を描かないタグ付きの Markdown では、本文の最初の見出しを H1 にする（003 の書き換え）。
- `title` と `drawTitle` の説明（`tools/list`）を書き換える。

### 変わる振る舞い

- `tools/list` の生成 3 ツールの `inputSchema` に `drawTitle` が増え、`title` の説明が変わる。
- `drawTitle: false` を渡したときだけ、題名が本文に描かれず、題名へのフォントの検査が行われず、見出しの数え始めが変わる。

### 変わらない振る舞い

- `drawTitle` を渡さないとき（既定）の出力は 1 バイトも変えない。
- `tagged: true` で `title` が必須であること（`drawTitle: false` でも必須）。
- 題名をメタデータに書く場所（PDF 1.7 は Info 辞書の `/Title`、タグ付きと PDF 2.0 は XMP の `dc:title`）。

### 対象外

- Markdown の先頭の H1 と `title` が同じかを見て、自動で片方を省くこと（暗黙の分岐になるので採らない。人の判断 2026-11-02）。
- 編集ツール（`set_metadata`・`ensure_tagged` など）の `title`。本文に描かないので関係しない。

## Capabilities

- `create-title`（既存・`kind: common`）: 002・003 を MODIFIED、004〜006 を ADDED。

## 人が判断すること

- 引数を足す形にすること（2026-11-02 に選択済み。自動で省く案は採らない）。
- 引数の名前（`drawTitle` を提案）と既定値（`true` = これまでどおり）。
- 版。引数が増えるので minor（0.23.0）を提案。
