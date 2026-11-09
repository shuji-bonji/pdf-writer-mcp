# Record: pdfua2-contents（#31・#32）

## 版

0.28.1（patch。本人が 2026-11-10 に決定）。版上げ・タグ・公開は本人が行う。

## かかった時間

- 提案: 2026-11-10 04:15〜04:30 JST（+09:00）
- 実装・確認: 2026-11-10 04:32〜04:50 JST（+09:00）

## 人が判断した箇所

- `add_annotation`: PDF/UA-2 の文書で `alt` だけなら `/Contents` に `alt`、`contents` と `alt` が違えば断る
- `tag_form_fields`: PDF/UA-2 の文書で `/Contents` の無いウィジェットに `labels` → `/TU` → フィールド名
- どちらも PDF/UA-1 の出力は変えない。版は 0.28.1

## 仕様と実装のずれ

- なし。`tag_form_fields` で `/Contents` を書くのは「この呼び出しで構造木に結んだウィジェット」に限った（既に結ばれていて飛ばすウィジェットには触らない。冪等のまま）。仕様の文「構造木に結んだウィジェットのうち」と同じ

## 確認

- 受入テスト 6 件（`tests/pdfua2.test.ts`）。変更前の `src/` で、PDF/UA-2 の 4 件が落ち、PDF/UA-1 の 2 件が通ることを確かめた
- CI の一覧: check:engines・biome check・typecheck・vitest（フォントあり 581・なし 526 + skip 56）・Node 20.20.2 の vitest・build・check:public-types・openspec validate --all・spec-ids check が終了コード 0
- veraPDF 1.30.0（`pdfua-2`、1,728 規則）。検体は `pdf-agent-stack-eval/out/2026-11/c31/`
  - PDF/UA-2 の文書に `add_annotation(alt)`: 1,728/1,728
  - PDF/UA-2 の文書（テキストフィールドを Noto Sans JP の埋め込みで描いたもの）に `tag_form_fields`: 1,728/1,728。同じ入力を 0.28.0 に通すと 8.10.2.3-1 の 1 件だけで落ちる
- A/B（`SOURCE_DATE_EPOCH` を固定、0.28.0 と比べる）: PDF/UA-1 とタグ無しの文書への `add_annotation` 4 経路、PDF/UA-1 の文書への `tag_form_fields` 2 経路（labels あり・なし）がすべて sha256 一致

## 読み返した回数

- ISO 14289-2 §8.9・§8.10 の要求の一覧: 1 回
