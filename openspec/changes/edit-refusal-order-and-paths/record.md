# record: edit-refusal-order-and-paths

PDF family の OpenSpec + spec-ids 導入（pdf-agent-stack `docs/specs/31`）のもとでの記録です。書式は計画 §8 です。時刻は JST です。

| 項目 | 記録 |
| --- | --- |
| きっかけ | pdf-agent-stack#47 の試用の所見（#10・F-21・F-08・F-23） |
| 版 | OpenSpec 1.14.1 / spec-ids 0.5.0 / pdf-writer-mcp 0.23.3 → 0.24.0（提案。人が決める）/ Claude（claude.ai、モデル claude-opus-5-5）/ 2026-11-06 |
| PR の切り方 | writer の 3 件（#10・#9・#11）を 1 本のブランチ `fix/writer-findings` にまとめた。#12 は決定どおり別の版。提案は人の決定（各 Issue のコメント、2026-11-06 01:01）の後に書き、チャットでの承認を待たずに実装した。`approved`・`pr` の記入と archive は PR の後 |
| tools/list の比較 | 変更前（main の `4dc0c2a`）と変更後の `dist` を `pdf-agent-stack/scripts/tools-list-snapshot.mjs` で比べた。差は `ensure_pdfa`・`ensure_tagged` の description だけ（inputSchema・required・additionalProperties は 20 ツールとも同じ） |
| ゲート | check:engines・check・typecheck・test（Node 22 と Node 20.20.2、`TEST_FONT_PATH` あり、504 件）・build・check:public-types が終了コード 0 |
| 維持の手間 | 仕様だけを変えた変更: 0 件 |
| 人が判断した箇所 | (1) 方針（#10 のコメントと横断の決定）。(2) `detail.reason` の 6 つの値・`detail.keyDerived`・hint に `qpdf` を例として書くこと・入力を読めないときを対象外にすること（提案の「人が判断すること」。未確認） |
| 仕様と実装のずれ | 1 件。出力のフォルダーの位置にファイルがあるとき、`mkdir(…, { recursive: true })` は `ENOTDIR` ではなく `EEXIST` を返した（Node 22 で実測）。`EEXIST` も `NOT_A_DIRECTORY` に対応づけた |
| テスト | `tests/edit-refusals.test.ts` 7 件。変更前の `src/` で 6 件が落ち、変更後に通った（暗号化されていない署名付き文書の `SIGNED_PDF` は前から通る）。権限の件は root で走るときに飛ばす（CI の runner は root ではない） |
