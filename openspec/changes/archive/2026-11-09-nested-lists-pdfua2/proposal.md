---
approved: 2026-11-09
pr: 29
implementation: required
targets: [create-markdown-pdf]
---

# Proposal

## Why

0.25.0（#12）から、`create_markdown_pdf` は入れ子のリストを親の項目の `LBody` の中に置きます（SPEC-WRITER-CREATE-MARKDOWN-PDF-003）。ISO 32000-1 Table 336 は `LBody` の中のリストを許すので、PDF/UA-1 ではこの形でよいのですが、ISO 32000-2 §14.8.4.8.2 は、階層のあるリストの入れ子の `L` を親の `L` の直接の子か、親の `L` に属する `Div` の中に置くことを求めます（shall。例 H.8.3）。#20 で「分岐の条件は PDF の版ではなく、宣言する適合にする」と決め、PDF/UA-2 の出力（変更 `pdfua2-output`）ができるまで待っていました。

pdf-reader-mcp は 0.22.0（#52）と 0.23.0（#54）で、どちらの形で書かれた入れ子のリストも同じ `text`・`pages`・`boxes` で読めるようになっています。

## What Changes

- PDF/UA-2 で生成するとき、入れ子のリストを親の項目の `LI` の直後に、親の `L` の直接の子として置く（005）。
- 003 を PDF/UA-1 に限る（MODIFIED。振る舞いは変えない）。
- 描く位置（字下げ）は両方で同じ。

### 変わる振る舞い

- `tagged: true` + `pdfVersion: "2.0"` の入れ子のリストの構造木の形。この組み合わせは 0.26.x では断っていたので、利用者から見ると新しい出力。

### 変わらない振る舞い

- PDF/UA-1 とタグ無しの出力（変更前と sha256 一致。変更 `pdfua2-output` の record）。

### 対象外

- `Div` で包む形。親の `L` の直接の子だけにする。

## Capabilities

- `create-markdown-pdf`（MODIFIED: 003、ADDED: 005）

## 人が判断すること

- 範囲に含めること（2026-11-09 に本人が決定）。分岐の条件（宣言する適合）は #20 で決定済み。
