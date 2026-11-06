# record: standard-font-winansi-input

PDF family の OpenSpec + spec-ids 導入（pdf-agent-stack `docs/specs/31`）のもとでの記録です。書式は計画 §8 です。時刻は JST です。

| 項目 | 記録 |
| --- | --- |
| きっかけ | pdf-writer-mcp#22（#19 の作業中に「別の変更にする」と決めたもの）。0.25.1 の公開版で `“Quoted” — 5 € … ™`・`It’s`・`- – dash` が `FONT_REQUIRED` になった |
| 版 | OpenSpec 1.14.1 / spec-ids 0.5.0 / pdf-writer-mcp 0.25.1 → 0.26.0（#22 のコメントで決定）/ Claude（claude.ai、モデル claude-opus-5-5）/ 2026-11-06 |
| 仕様の確認 | pdf-spec-mcp で ISO 32000-2 Annex D.1（Table D.2 の字はすべて Times・Helvetica・Courier の系列でサポートする）を引いた。符号の表は 0.25.1 で Table D.2 から起こしたもの（`src/services/win-ansi.ts`）をそのまま使った |
| 作業中に広がった範囲 | (1) `create_table_pdf` のハンドラの独自の検査は、`buildPdf` が先に同じ判定を当てているので一度も届いていなかった。外した。(2) `buildPdf`・`fill_form`・`stamp_page_numbers` は入力を 1 つずつ検査していて、最初に落ちた入力の字しか名指さなかった。全部の入力を 1 回で検査するようにした（表で、見出しの字だけが名指されていた）。(3) SPEC-WRITER-COMMON-ERRORS-003 の受入テスト（日本語の本文を渡したときの `error` にかな・漢字が無い）が、字を名指すと落ちた。名指す字を 003 の対象から外すと書き足した（MODIFIED 003）。(4) `tests/common-errors.test.ts` の biome の警告 2 件（suppression の位置違い）を直した |
| 人が判断した箇所 | 版・エラー本文の変更が契約の範囲内であること・README の直し（#22 のコメント、2026-11-06）。🔴 未判断: MODIFIED 003（proposal の「人が判断すること」） |
| tools/list の比較 | `main`（`e3c8c12`）と変更後の `dist` を stdio で起動し、`tools/list` の応答を比べた。バイト単位で同じ（48,862 バイト） |
| ゲート | check:engines・check（警告 0 件）・typecheck・test・build・check:public-types・`openspec validate --all`・`spec-ids check` が終了コード 0。test は Node 22.23.4 と Node 20.20.2 の両方で、`TEST_FONT_PATH` あり 536 件通過・1 件 skip／なし 481 件通過・56 件 skip |
| テスト | `tests/standard-font-encoding.test.ts` の 004 の 6 件。変更前の `src/` では 5 件が落ちた。通った 1 件は変わらない振る舞い（日本語はいまどおり断る）。文を照合していた既存のテスト 3 件（`generate.test.ts` 2 件・`page-number.test.ts` 1 件）と `layout.test.ts` の `hasNonLatin1` のテストを直した |
| 見た目の確認 | 標準フォントで、見出し・段落・入れ子の箇条書きに 27 字を入れた文書と、表のセルに `It’s`・`– dash`・`5 €` を入れた文書を 70 dpi の画像にして見た。どの字も正しい形で描かれ、記号は「•」 |
| 仕様と実装のずれ | 0 件 |
| 維持の手間 | 仕様だけを変えた変更: 0 件 |
| 読み戻し | 上の 2 つの文書を pdftotext で読み、27 字と「•」が入力どおりに出ることを確かめた（pdf-reader-mcp では読んでいない） |
| 未測定 | 手元のビューアでの目視 |
