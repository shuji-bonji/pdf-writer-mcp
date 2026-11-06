# record: glyph-errors-list-characters

PDF family の OpenSpec + spec-ids 導入（pdf-agent-stack `docs/specs/31`）のもとでの記録です。書式は計画 §8 です。時刻は JST です。

| 項目 | 記録 |
| --- | --- |
| きっかけ | pdf-writer-mcp#23（#22 の範囲を広げないために分けたもの） |
| 版 | OpenSpec 1.14.1 / spec-ids 0.5.0 / pdf-writer-mcp 0.25.1 → 0.26.0（#22 と同じ版に入れる案）/ Claude（claude.ai、モデル claude-opus-5-5）/ 2026-11-06 |
| 人が判断した箇所 | 🔴 未判断: キーの名前と形（`characters` = `U+XXXX` の配列、`count`）・上限 1,000 字・warnings に構造を持たせないこと。#23 の「決める必要があること」を Claude が仮に決めた（proposal の「人が判断すること」） |
| 調べたこと | reader・verify の `src` に、字を原因にして失敗する code は無い（`MISSING_GLYPH`・`FONT_REQUIRED` は writer だけ）。キー名を family でそろえる相手が無い |
| tools/list の比較 | `standard-font-winansi-input` と同じ（差 0 件。エラー本文はツール結果で、`tools/list` には出ない） |
| ゲート | `standard-font-winansi-input` と同じブランチで、同じ一覧を Node 22・20 で回した |
| テスト | `tests/common-errors.test.ts` の 007 の 5 件。変更前の `src/` では 5 件とも落ちた |
| 仕様と実装のずれ | 0 件 |
| 維持の手間 | 仕様だけを変えた変更: 0 件 |
