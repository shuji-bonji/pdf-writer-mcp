# record: nested-lists-pdfua2

PDF family の OpenSpec + spec-ids 導入（pdf-agent-stack `docs/specs/31`）のもとでの記録です。書式は計画 §8 です。時刻は JST です。

| 項目 | 記録 |
| --- | --- |
| きっかけ | pdf-writer-mcp#20（2026-11-06 起票。PDF/UA-2 の出力（#26・変更 `pdfua2-output`）を待っていた） |
| 版 | OpenSpec 1.14.1 / spec-ids 0.5.0 / pdf-writer-mcp 0.26.1 → 0.27.0（案）/ Claude（claude.ai、モデル claude-opus-5-5）/ 2026-11-09 |
| 仕様の確認 | ISO 32000-2 §14.8.4.8.2 と例 H.8.3 は #20 で確認済み（この変更で新たには引いていない） |
| 人が判断した箇所 | 分岐の条件（宣言する適合）は #20 で、範囲に含めることは 2026-11-09 に本人が決定 |
| 構造木の形 | pdf-reader-mcp の `inspect_tags` で `L > (LI, L > (LI, LI), LI)` を確かめた。veraPDF 1.30.0 `pdfua-2` で 1,728/1,728 |
| reader で読んだ結果 | pdf-reader-mcp 0.23.0 は、この形でも `LBody` の中に置く形でも、`LI` の `text`・`pages`・`boxes` を同じに返す（#52・#54） |
| ゲート | 変更 `pdfua2-output` と同じ |
| テスト | `tests/list-structure.test.ts` の 005 の 2 件。変更前の `src/` では 2 件とも落ちた |
| 仕様と実装のずれ | 0 件 |
| 維持の手間 | 仕様だけを変えた変更: 0 件。003 を PDF/UA-1 に限る MODIFIED は、振る舞いを変えない文言の変更 |
