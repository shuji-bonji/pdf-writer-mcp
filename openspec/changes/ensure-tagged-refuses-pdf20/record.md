# record: ensure-tagged-refuses-pdf20

PDF family の OpenSpec + spec-ids 導入（pdf-agent-stack `docs/specs/31`）のもとでの記録です。書式は計画 §8 です。時刻は JST です。

| 項目 | 記録 |
| --- | --- |
| きっかけ | pdf-writer-mcp#17。writer が版をどう分けて出しているかを確かめる中で、`create_text_pdf(pdfVersion: "2.0")` の出力に `ensure_tagged` をかけると、`%PDF-2.0` のまま `pdfuaid:part=1` が書かれることを実物で確かめた |
| 版 | OpenSpec 1.14.1 / spec-ids 0.5.0 / pdf-writer-mcp 0.24.0 → 0.25.0（提案。人が決める）/ Claude（claude.ai、モデル claude-opus-5-5）/ 2026-11-06 |
| PR の切り方 | `list-labels-and-nesting` と同じブランチ `fix/list-structure-and-pdf20` |
| 仕様の確認 | pdf-spec-mcp で ISO 14289-1 §6.1（PDF/UA-1 の版は 1.0〜1.7）と ISO 32000-1 §7.7.2 Table 28（catalog の `/Version` はヘッダーより後の版を指せる）を引いた |
| 判定に使う版 | normativepdf の `PdfDocument.version`（catalog の `/Version` がヘッダーより後ならその値、無ければヘッダーの版） |
| tools/list の比較 | `list-labels-and-nesting` の record と同じ。`ensure_tagged` の description に断る条件を足した |
| ゲート | `list-labels-and-nesting` の record と同じ |
| 維持の手間 | 仕様だけを変えた変更: 0 件 |
| 人が判断した箇所 | 版を確かめて断ること（2026-11-06 06:55 のチャット）。版を下げて書く案は採らない（2.0 の機能を使っているかを判定しないため） |
| 仕様と実装のずれ | 0 件 |
| テスト | `tests/ensure-tagged-version.test.ts` の 2 件。変更前に「PDF 2.0 で作った文書」の 1 件が落ちた（PDF 1.7 の件は前から通る） |
