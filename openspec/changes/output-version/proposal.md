---
approved: 2026-11-10
pr: 56
implementation: required
targets: [output-version, ensure-pdfa]
---

# Proposal

## Why

Issue: #28

出力の版（ヘッダー）と、出力が名乗る規格（`pdfuaid`・`pdfaid`）が、その版・規格の条文と食い違う経路が 5 か所あります（0.27.0 の作業中に見つかったもの）。また、呼び出し側（LLM）が「いまどの版の文書を扱っているか」を知る手段が、別のツールで読み直すことしかありません。

1. `merge_pdfs` は出力の版を先頭の入力の版にする（`page-ops-cos.ts` の `mergePdfs`）。`[1.7, 2.0]` の順では 2.0 の文書のページが `%PDF-1.7` のファイルに入り、版についての警告は出ない。ISO 32000-2 R-7.5.2-4 は、2.0 に適合する文書を書く処理系に版を 2.0 と示すことを求める（shall）。
2. タグ無しの PDF 2.0 に `ensure_pdfa(pdfa-3b)` を掛けると、ヘッダーが 2.0 のまま PDF/A-3b を名乗り、veraPDF 1.30.0 の ISO 19005-3:2012 6.1.2-1（ヘッダーは `%PDF-1.n`）で必ず落ちる。PDF/UA-2 の入力は 0.27.0 で断っている（ENSURE-PDFA-003）が、タグ無しの 2.0 は通る。
3. PDF 2.0 の文書に `set_metadata` を掛けると、版を見ずに Info の `Title`・`Author`・`Subject`・`Keywords`・`Creator` を書く（`edit-metadata.ts`）。ISO 32000-2 §14.3.3・Table 349 は、2.0 では Info の `CreationDate`・`ModDate` 以外を非推奨とし、XMP を使うことを求める（should）。ISO 14289-2 §6.2 は、PDF/UA-2 のファイルが ISO 32000-2 で非推奨の機能を含まないことを求める（should not）。
4. PDF/UA-2 の文書に `tag_form_fields`・`add_annotation` が足す構造要素には `/NS` が無く、既定の PDF 1.7 の名前空間に入る。ISO 14289-2 §8.2.4 はこれを許すが、呼び出し側には伝えていない。
5. XMP を作り直す経路（`syncXmpWithInfo`。`set_metadata`・`ensure_pdfa` が使う）は、`dc:title` の `rdf:Alt` の最初の項目だけを運び、`dc:creator` の複数の名前なども Info の 1 文字列から作り直す。

## What Changes

方針（2026-11-09 に本人が決定。#28 の本文）:

- 出力の版・宣言した規格の shall に反するものは断る。`next_actions` で版の合う呼び方を案内し、エラーの文に入力と出力の版を名指す。
- その版で非推奨（deprecated・should not）のものは、断らずにその版の正しい書き方で書き、どう書いたかを結果で伝える。
- 許される混在は書いて、結果で伝える。
- 断る範囲は writer 自身が書くもの（版の表示・宣言・合成の仕方）に限る。他のツールで作った入力の中身の適合は判定しない（pdf-verify-mcp の役目）。
- 原則: **編集の出力は入力の版のまま。版を変えるのは明示した変換だけ。**

変更:

- `merge_pdfs`：`pdfVersion` 引数（`"1.7"`・`"2.0"`）を足す。入力の版が混ざっていて `pdfVersion` が無ければ断り、`next_actions` で `pdfVersion: "2.0"` を案内する。`"2.0"` を渡したら 2.0 で書く（明示した変換。trailer `/ID` を書き、Info の値を XMP に移す）。`"1.7"` を渡して 2.0 の入力があれば断る（OUTPUT-VERSION-001）。
- `ensure_pdfa`：PDF 2.0 の入力に `pdfa-3b` を掛けたら、タグの有無に関係なく断る。`next_actions` は `pdfa-4`（ENSURE-PDFA-004）。
- `set_metadata`：PDF 2.0 の文書では値を XMP に書き、Info に新しいキーを足さない。既存のキーは、PDF/UA-2 を宣言した文書では XMP に移してから消し、それ以外の 2.0 の文書では残して XMP と同じ値にする（OUTPUT-VERSION-002）。
- XMP を作り直す経路：変更を指示された項目以外は、入力の XMP の値を言語の項目ごと運ぶ（OUTPUT-VERSION-003）。
- PDF/UA-2 の文書に構造要素を足す編集ツール：既定の名前空間に置いた要素があることを warnings で伝える（OUTPUT-VERSION-004）。
- ファイルを書く全ツールの結果に `output: { pdfVersion, declares }` を足す（OUTPUT-VERSION-005）。
- 版を理由に断るエラーの文に、入力の版・宣言と、求められた操作が要する版を名指す（OUTPUT-VERSION-006）。
- ツールの説明と initialize の instructions に、上の原則を 1 か所で書く（OUTPUT-VERSION-007）。

### 変わる振る舞い

- `merge_pdfs` に版の混ざった入力：先頭の入力の版で書いていたものが、`pdfVersion` が無ければ `INVALID_ARGUMENT` になる。
- `ensure_pdfa` にタグ無しの PDF 2.0 と `pdfa-3b`：通っていたものが `INVALID_ARGUMENT` になる。
- `set_metadata` に PDF 2.0 の文書：Info に無かったキーを Info に書かなくなる。PDF/UA-2 の文書では Info の `Title` 等が消える。
- XMP を作り直す経路：`dc:title` の 2 つ目以降の言語の項目・`dc:creator` の複数の名前などが出力に残る。
- 全ツールの結果に `output` が増える。

### 変わらない振る舞い

- 版のそろった入力への `merge_pdfs` の出力（`pdfVersion` を渡さない場合）。
- PDF 1.7 の文書への `set_metadata` の出力。
- `code`・`next_actions` の既存の `action`・`example`。

### 対象外

- `merge_pdfs` で準拠宣言（`pdfuaid`・`pdfaid`）を運ぶこと。今までどおり運ばず、warnings で伝える（B-10）。
- 足す構造要素に `/NS` を付けること（§8.2.4 は既定の名前空間を許す）。
- 他のツールで作った入力の中身が、その版の条文に合っているかの判定。
- `stamp_page_numbers`・`add_watermark` を `fontPath` なしで使うと標準フォントが埋め込まれない件（別の Issue）。

## Capabilities

- `output-version`（新しい共通 capability。ADDED: 001〜007）
- `ensure-pdfa`（ADDED: 004）

## 人が判断すること

- `merge_pdfs` は `pdfVersion` 引数で明示させる・PDF/UA-2 の文書だけ既存の Info のキーを消す（他の 2.0 は残して同期）・XMP の項目はそのまま運ぶ・結果は Issue の形（`declares`）（2026-11-10 に本人が決定。`merge_pdfs` と Info は、同日に一度「高いほうの版に上げる」「残して同期」と決めたものを、#28 の原則と ISO 14289-2 §6.2 に照らして決め直した）。
- タグ無しの 2.0 への `pdfa-3b` を断ること（方針の shall に当たる。2026-11-09 の方針から）。
- 版は 0.28.0（minor）・`dc:title` の `x-default` 以外の言語の項目は残して warnings で名指す・生成 3 ツールに適合を確かめていない旨の warnings は足さず `output.declares` と instructions（007）で伝える（2026-11-10 に本人が決定）。
