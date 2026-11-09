# Record: output-version（#28）

## 版

0.28.0（minor。本人が 2026-11-10 に決定）。版上げ・タグ・公開は本人が行う。

## かかった時間

- 提案: 2026-11-10 01:20〜02:30 JST（+09:00）。Issue の本文を読めないまま一度書き、読めてから 3 点を決め直した
- 実装・確認: 2026-11-10 02:38〜03:05 JST（+09:00）

## 人が判断した箇所

- 方針（shall に反するものは断る・非推奨はその版の書き方で書く・許される混在は伝える）と原則（編集の出力は入力の版のまま）: 2026-11-09
- `merge_pdfs` は `pdfVersion` で明示させる。一度「高いほうの版に上げる」と決めたが、#28 の原則に反するので決め直した
- PDF 2.0 の文書の既存の Info の鍵は、PDF/UA-2 の文書だけ XMP に移して消す。一度「すべて残す」と決めたが、ISO 14289-2 §6.2 に照らして決め直した
- XMP の項目はそのまま運ぶ。`dc:title` は x-default だけ書き換え、ほかの言語は残して warnings で名指す
- 結果は `output: { pdfVersion, declares }`（Issue の形）。生成系に「適合は確かめていない」の warnings は足さない
- 承認: proposal の front matter に `approved: 2026-11-10`・`pr: 56`（🔴 PR の番号は 30。56 の PR は存在しない）

## 仕様と実装のずれ（実装中に delta を直したもの）

- 001: 承認時の文は「入力の版がすべて同じでなければ断る」だった。1.4 と 1.7 の混在まで断ると 0.27.0 で通っていた結合が止まるので、断るのは PDF 2.0 と 1.x の混在だけにし、1.x どうしは先頭の入力の版のまま（0.27.0 と同じ）にした
- 001: 承認時は `/ID` を `pdfVersion: "2.0"` のときだけ書く文だった。実測で、PDF 2.0 だけを結合した出力にも `/ID` が無かった（ISO 32000-2 Table 15 は 2.0 で Required）。ページを複製する 5 ツールの PDF 2.0 の出力すべてに書くようにし、Scenario「2.0 だけの入力にも trailer の /ID を書く」を足した
- 005: `output.pdfVersion` は「"1.7" か "2.0"」と書いていたが、編集は入力の版を保つので 1.4 なども返る。「ヘッダーと catalog の /Version のうち新しいほう」に直した
- 004: Scenario を「リンクを足す」から「注釈を足す」に直した（`add_annotation` にリンクの種類が無い）。`tag_form_fields` と PDF/UA-1 の Scenario を足した
- 003: 「x-default が無ければ先頭の項目を既定とみなす」を実装で決めた。このサーバの生成系は x-default ではなく文書の言語を `xml:lang` にした項目を 1 つ書くため
- SPEC-WRITER-PDFUA2-005 のテスト「数値文字参照で書かれた題名を二重に符号化しない」の期待値を緩めた。指示されていない `dc:title` は書かれていたとおり運ぶので、`&#x2014;` のまま残る（XML として同じ値。二重の符号化が無いことは同じく確かめている）

## 確認

- 受入テスト 21 件（`tests/output-version.test.ts` 20 件・`tests/pdfua2.test.ts` に ENSURE-PDFA-004）。変更前の `src/` で 15 件が落ちることを確かめた。変更前でも通った 6 件のうち「2.0 の入力で pdfVersion 1.7」は、0.27.0 の zod が知らない引数 `pdfVersion` を断っていたため（理由が違う）
- CI の一覧: check:engines・biome check・typecheck・vitest（フォントあり・なし）・build・check:public-types・openspec validate --all・spec-ids check が終了コード 0。Node 20.20.2 でも vitest 575 件が通る
- veraPDF 1.30.0（手元の pdf-verify-mcp）。検体は `pdf-agent-stack-eval/out/2026-11/outver/`
  - PDF/UA-2 の文書（Info に Title・Author を足したもの）に `set_metadata(title)`: `pdfua-2` 1,728/1,728
  - 1.7 と 2.0 を `merge_pdfs(pdfVersion: "2.0")` → `ensure_pdfa(pdfa-4)`: `pdfa-4` 109/109
  - 3 言語の `dc:title` と `xmpMM:DocumentID` を持つ PDF/UA-1 の文書に `set_metadata(title)` → `ensure_pdfa(pdfa-3b)`: `pdfa-3b` 146/146・`pdfua-1` 106/106
  - PDF/UA-2 の文書に `add_annotation`（alt あり）: `pdfua-2` で 8.9.4.2-1 が 1 件落ちる。0.27.0 で作った同じ検体も同じ 1 件で落ちる（#28 の変更とは別の不具合）
  - PDF/UA-2 の文書に `tag_form_fields`: 8.10.2.3-1（ラベルの無いウィジェットに Contents が要る）と 8.4.5.5.1-1（検体のフィールドを pdf-lib の Helvetica で作ったため）が落ちる。前者は別の不具合
- A/B（`SOURCE_DATE_EPOCH` を固定、0.27.0 と比べた 15 経路）: 1.7 の入力では 11 経路が sha256 一致。差が出たのは XMP を持つ文書の XMP を書き直す 4 経路（`set_metadata` 3 つ・`ensure_pdfa(pdfa-3b)` を PDF/UA-1 の入力に）で、値は同じ・プロパティを入れる `rdf:Description` の分け方だけが違う

## 読み返した回数

- Issue #28 の本文: 2 回（読めないまま提案を書き、読めてから 3 点を決め直した）
