# record: ensure-pdfua2

PDF family の OpenSpec + spec-ids 導入（pdf-agent-stack `docs/specs/31`）のもとでの記録です。書式は計画 §8 です。時刻は JST です。

| 項目 | 記録 |
| --- | --- |
| きっかけ | pdf-writer-mcp#26 の範囲（2026-11-09 に本人が決定） |
| 版 | OpenSpec 1.14.1 / spec-ids 0.5.0 / pdf-writer-mcp 0.26.1 → 0.27.0（案）/ Claude（claude.ai、モデル claude-opus-5-5）/ 2026-11-09 |
| 仕様の確認 | ISO 14289-2 §6.1・§8.2.5.2・§8.4.4・§8.11（pdf-spec-mcp）。PDF/A-3 のヘッダーの条文はコーパスに無い（ISO 19005 は対象外）ので、veraPDF の規則で裏を取った |
| 人が判断した箇所 | 範囲（2026-11-09）。🔴 未判断: PDF/UA-2 の入力への `pdfa-3b` を断ること・タグ無しの PDF 2.0 の入力への `pdfa-3b` を扱わないこと |
| 実測（veraPDF 1.30.0） | タグ無しの PDF 2.0 に `ensure_tagged`: `pdfua-2` 1,728/1,728。PDF/UA-2 で作った文書に `ensure_tagged`: 変化なし（`requirementsChanged: false`）・1,728/1,728。PDF/UA-2 の文書に `ensure_pdfa(pdfa-4)`: `pdfa-4` 109/109・`pdfua-2` 1,728/1,728。PDF/UA-2 の文書に（変更前のコードで）`ensure_pdfa(pdfa-3b)`: `pdfa-3b` で ISO 19005-3:2012 6.1.2-1 が 1 件落ちる（003 の根拠） |
| ゲート | 変更 `pdfua2-output` と同じ |
| テスト | `tests/ensure-tagged-version.test.ts` の 003（1 件を書き換え）、`tests/pdfua2.test.ts` の ENSURE-TAGGED-004（2 件）・ENSURE-PDFA-001（1 件追加）・ENSURE-PDFA-003（1 件）。変更前の `src/` では 5 件とも落ちた |
| 仕様と実装のずれ | 0 件 |
| 維持の手間 | 仕様だけを変えた変更: 0 件 |
