# record: glyph-policy-wording

PDF family の OpenSpec + spec-ids 導入（pdf-agent-stack `docs/specs/31`）のもとでの記録です。書式は計画 §8 です。時刻は JST です。

| 項目 | 記録 |
| --- | --- |
| きっかけ | pdf-writer-mcp#25（0.26.0 の公開版の確認で、2026-11-06 に起票） |
| 版 | OpenSpec 1.14.1 / spec-ids 0.5.0 / pdf-writer-mcp 0.26.0 → 0.26.1（2026-11-08 に本人が決定）/ Claude（claude.ai、モデル claude-opus-5-5）/ 2026-11-08 |
| 作業中に広がった範囲 | (1) 編集系 4 ツールの `fontPath` の説明（「Required for CJK …」）。生成 3 ツールとは別の Zod の部品だった。境目は同じ WinAnsiEncoding（`edit-stamp.ts`・`edit-form.ts` も `assertRenderable` を通る）なので、同じ書き方にそろえた。(2) 正本 SPEC-WRITER-CREATE-TITLE-002 の本文の「標準フォントでの非 Latin-1 の拒否」。0.26.0 の 004 と食い違っていた（MODIFIED。Scenario は変えない） |
| 人が判断した箇所 | 版（0.26.1）・OpenSpec の変更を 1 つにすること（2026-11-08）。🔴 未判断: 編集系 4 ツールの `description` を変えないこと（proposal の「人が判断すること」） |
| tools/list の比較 | `main`（`9974571`）と変更後の `dist` を stdio で起動し、`tools/list` の応答を比べた。差は説明文の 10 か所（生成 3 ツールの `fontPath`・`onMissingGlyph` で 6、編集系 4 ツールの `fontPath` で 4）だけ |
| エラー本文の比較 | `create_text_pdf` に `A\u0085B` をフォントなしで渡した `tools/call` の本文。`error` の最後の文と `next_actions[0].reason` だけが変わり、`code`・`retryable`・`action`・`example`・`detail` は同じ |
| ゲート | check:engines・check・typecheck・test・build・check:public-types・`openspec validate --all`・`spec-ids check` が終了コード 0。test は Node 22.23.4 と Node 20.20.2 の両方で、`TEST_FONT_PATH` あり 536 件通過・1 件 skip／なし 481 件通過・56 件 skip（0.26.0 と同じ件数） |
| テスト | 足していない（文の項目は版で変わる約束）。既存のテストで文を照合しているものは 0 件だった（`blank boxes`・`drop them silently`・`replacement box`・`non-Latin text` を `src`・`tests`・`docs` で grep） |
| 仕様と実装のずれ | 1 件（正本 CREATE-TITLE-002 の文言。上の (2)） |
| 維持の手間 | 仕様だけを変えた変更: 0 件 |
| 未測定 | pdf-publish-skill の `references/error-codes.md` が、変える前の文を引いているか |
