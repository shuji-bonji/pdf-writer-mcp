---
approved:
pr:
implementation: required
targets: [ensure-tagged, ensure-pdfa]
---

# Proposal

## Why

宣言を書く 2 つのツールは、PDF/UA-2 が書けないことを前提に、PDF 2.0 との組み合わせを断っています。

- `ensure_tagged` は PDF 2.0 の入力を `INVALID_ARGUMENT` で断る（SPEC-WRITER-ENSURE-TAGGED-003。#17）。
- `ensure_pdfa` は PDF/UA を宣言した入力に `pdfa-4` を名乗らせない（SPEC-WRITER-ENSURE-PDFA-001。#9）。PDF/UA-2 の入力も断る。

変更 `pdfua2-output` で PDF/UA-2 が書けるようになると、どちらも条文の理由が無くなります。ISO 14289-2 §6.1 は PDF/UA-2 の版を 2.0 とし、PDF/A-4 も PDF 2.0 基盤です。逆に、PDF/UA-2 の入力に `pdfa-3b` を掛けると、ヘッダーは 2.0 のままで PDF/A-3b を名乗り、veraPDF 1.30.0 の ISO 19005-3:2012 6.1.2-1（ヘッダーは `%PDF-1.n`、n は 0〜7）で落ちます（実測 2026-11-09）。

## What Changes

- `ensure_tagged`：入力の版で名乗る part を決める。PDF 2.0 なら PDF/UA-2（`pdfuaid:part` 2・`rev` 2024）。構造木を作るときは `Document` と `P` を PDF 2.0 の名前空間に置く。Info 辞書に `Title` を書かない。CLAIMS の warnings に名乗った part と `flavour` を書く（003 を MODIFIED）。
- `ensure_tagged`：既存の構造木の根が PDF 2.0 の名前空間の `Document` 1 つでないとき、構造木は変えずに warnings で名指す（004）。
- `ensure_pdfa`：PDF/UA-2 の入力には `pdfa-4`・`pdfa-4f` を通す（001 を MODIFIED）。`pdfa-3b` は断り、`next_actions` で `pdfa-4` を案内する（003）。
- 説明文（`ensure_tagged`・`ensure_pdfa`・`title`・`lang`）と initialize の instructions。

### 変わる振る舞い

- `ensure_tagged` に PDF 2.0 の入力：`INVALID_ARGUMENT` だったものが、PDF/UA-2 を名乗る PDF を返す。
- `ensure_pdfa` に PDF/UA-2 の入力と `pdfa-4`：`INVALID_ARGUMENT` だったものが通る。`pdfa-3b`：通っていたものが `INVALID_ARGUMENT` になる（0.26.x では PDF/UA-2 の入力を作る手段が writer に無かった）。
- `ensure_pdfa` が PDF/UA-1 の入力を断るときの `hint` の文（PDF/UA-2 の作り方を案内する）。

### 変わらない振る舞い

- PDF 1.x の入力への `ensure_tagged`、PDF/UA-1 の入力への `ensure_pdfa` の出力（変更前と sha256 一致。変更 `pdfua2-output` の record）。`code`・`next_actions` の `action`・`example`。

### 対象外

- 既存の構造木を PDF/UA-2 に合わせて直すこと（名前空間を足す、`H` を `Hn` にするなど）。`ensure_tagged` は既存の構造木に触らない。
- タグ無しの PDF 2.0 の入力に `pdfa-3b` を掛けたときの扱い（同じ 6.1.2-1 で落ちるが、PDF/UA の宣言の両立の問題ではない）#28 で扱う。

## Capabilities

- `ensure-tagged`（MODIFIED: 003、ADDED: 004）
- `ensure-pdfa`（MODIFIED: 001、ADDED: 003）

## 人が判断すること

- 範囲に含めること（2026-11-09 に本人が決定）。
- 🔴 未判断: PDF/UA-2 の入力への `pdfa-3b` を断ること（003）。0.26.x では通っていた組み合わせ。
- 🔴 未判断: タグ無しの PDF 2.0 の入力への `pdfa-3b` を今回は扱わないこと。
