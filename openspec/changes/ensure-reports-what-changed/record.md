# record: ensure-reports-what-changed

PDF family の OpenSpec + spec-ids 導入（pdf-agent-stack `docs/specs/31`）のもとでの記録です。書式は計画 §8 です。時刻は JST です。

| 項目 | 記録 |
| --- | --- |
| きっかけ | pdf-agent-stack#47 の試用の所見（#11・F-20・F-31） |
| 版 | OpenSpec 1.14.1 / spec-ids 0.5.0 / pdf-writer-mcp 0.23.3 → 0.24.0（提案。人が決める）/ Claude（claude.ai、モデル claude-opus-5-5）/ 2026-11-06 |
| PR の切り方 | writer の 3 件（#10・#9・#11）を 1 本のブランチ `fix/writer-findings` にまとめた。#12 は決定どおり別の版。提案は人の決定（各 Issue のコメント、2026-11-06 01:01）の後に書き、チャットでの承認を待たずに実装した。`approved`・`pr` の記入と archive は PR の後 |
| tools/list の比較 | 変更前（main の `4dc0c2a`）と変更後の `dist` を `pdf-agent-stack/scripts/tools-list-snapshot.mjs` で比べた。差は `ensure_pdfa`・`ensure_tagged` の description だけ（inputSchema・required・additionalProperties は 20 ツールとも同じ） |
| ゲート | check:engines・check・typecheck・test（Node 22 と Node 20.20.2、`TEST_FONT_PATH` あり、504 件）・build・check:public-types が終了コード 0 |
| 維持の手間 | 仕様だけを変えた変更: 0 件 |
| 人が判断した箇所 | (1) 方針（#11 のコメント）。(2) 項目名 `replacedRequirements`・`requirementsChanged` と、XMP を同じと見なす条件（提案の「人が判断すること」。未確認） |
| 仕様と実装のずれ | 0 件 |
| テスト | `tests/ensure-reports.test.ts` のうち ENSURE-PDFA-002 の 2 件と ENSURE-TAGGED の 5 件。変更前に 6 件が落ちた（タグ無しの文書に足す件は前から通る）。既存の `pdfa-conformance.test.ts` の `wasDeclared` の 2 件を `previousDeclaration` に書き換えた |
| archive の順 | `ensure-pdfa` は `ensure-pdfa4-refuses-pdfua1` が作るので、そちらを先に archive する |
