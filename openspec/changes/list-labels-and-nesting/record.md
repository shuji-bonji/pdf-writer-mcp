# record: list-labels-and-nesting

PDF family の OpenSpec + spec-ids 導入（pdf-agent-stack `docs/specs/31`）のもとでの記録です。書式は計画 §8 です。時刻は JST です。

| 項目 | 記録 |
| --- | --- |
| きっかけ | pdf-writer-mcp#12（F-14。リストの記号を `LBody` の本文に入れていた）。コードを読む中で、番号付きリストの `ListNumbering` が無いこと（ISO 14289-1 §7.6 R-7.6-4）と、入れ子のリストを親の項目の文字に畳んでいることも見つけ、同じ変更に入れた |
| 版 | OpenSpec 1.14.1 / spec-ids 0.5.0 / pdf-writer-mcp 0.24.0 → 0.25.0（提案。人が決める）/ Claude（claude.ai、モデル claude-opus-5-5）/ 2026-11-06 |
| PR の切り方 | #12 と #17 を 1 本のブランチ `fix/list-structure-and-pdf20` にまとめた。どちらもタグ付き出力が PDF/UA-1 を満たすための変更で、同じ版で出す |
| 仕様の確認 | pdf-spec-mcp で ISO 14289-1 §7.6（R-7.6-2〜4）、ISO 32000-1 Table 336（`LBody` の中にリストを置ける）・Table 347（`ListNumbering` の値と、番号を `Lbl` に字として書く NOTE）を引いた |
| tools/list の比較 | 変更前（main の `7319844`）と変更後の `dist` を `pdf-agent-stack/scripts/tools-list-snapshot.mjs` で比べた。差は `create_markdown_pdf`・`ensure_tagged` の description だけ（inputSchema・required・additionalProperties は 20 ツールとも同じ） |
| ゲート | check:engines・check・typecheck・test（Node 22 と Node 20.20.2、`TEST_FONT_PATH` あり、513 件）・build・check:public-types が終了コード 0 |
| 維持の手間 | 仕様だけを変えた変更: 0 件 |
| 人が判断した箇所 | (1) 入れ子は A 案（親の項目の `LBody` の中に置く）。(2) 箇条書きの `ListNumbering` は `Disc`、番号付きは `Decimal`。(3) ぶら下げの字下げはタグの有無にかかわらず入れる（いずれも 2026-11-06 06:55 のチャット） |
| 仕様と実装のずれ | 0 件 |
| テスト | `tests/list-structure.test.ts` の 7 件。変更前に 7 件とも落ちた |
| 読み戻し | pdf-reader-mcp `extract_structured_text` で、各 `LI` の `label` に `•`・`8.`〜`10.` が入ることを確かめた。入れ子の `L` は、reader が `LI` の下の文字をまとめて 1 件にし、子の要素を出さないため、親の項目の `text` に混ざって出る（reader 側の扱い。writer の構造木は受入テストで確かめている） |
| 見た目の確認 | NotoSansJP で、タグ付きとタグ無しを 80 dpi の画像にして見た。折り返した 2 行目が本文の始まりにそろい、入れ子は親の本文の位置から始まる。タグ付きとタグ無しで画像は同じ |
| 未測定 | veraPDF の PDF/UA-1 の測定はホストで人が行う |
