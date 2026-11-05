# record: standard-font-winansi

PDF family の OpenSpec + spec-ids 導入（pdf-agent-stack `docs/specs/31`）のもとでの記録です。書式は計画 §8 です。時刻は JST です。

| 項目 | 記録 |
| --- | --- |
| きっかけ | pdf-reader-mcp の `extract_structured_text` が、0.25.0 で標準フォントの箇条書きを読むと `label: "\""` を返した（pdf-reader-mcp#52 の再現中）。コンテンツストリームを見ると writer が `<22> Tj` を書いていた。pdf-writer-mcp#19 として起票 |
| 版 | OpenSpec 1.14.1 / spec-ids 0.5.0 / pdf-writer-mcp 0.25.0 → 0.25.1（提案。人が決める）/ Claude（claude.ai、モデル claude-opus-5-5）/ 2026-11-06 |
| 仕様の確認 | pdf-spec-mcp で ISO 32000-2 Annex D.1・D.2（Table D.2 の WinAnsiEncoding 欄）、ISO 32000-1 Annex D.2（注 3: bullet は 225）、ISO 32000-1 §9.6.2.2（標準 14 書体の font metrics）を引いた |
| 表の照合 | Table D.2 から起こした表（`src/services/win-ansi.ts`）と `@pdf-lib/standard-fonts` の WinAnsi を U+0000〜U+FFFF で比べ、差は 0 件。この比較はテストに入れた |
| 作業中に広がった範囲 | (1) 符号の無い文字（U+0001・U+007F・U+0085）が生成 3 ツールの全経路で `encode` まで届くことを実測し、扱いを人に訊いた。(2) 実装中に、標準フォントの幅が AFM を文字そのもので引いていて、英字以外が幅 0 になることを見つけた。正しい幅の 44% と測られ、本文がページの外まで描かれていた（画像で確認）。#19 の本文の「1 を直せば幅も一致する」は誤りだったので、003 として同じ変更に入れた |
| 人が判断した箇所 | (1) #19 を 0.25.1 として進め、`assertRenderable` の判定（U+0100 以上を断る）は変えない（2026-11-06 08:07 のチャット）。(2) 符号の無い文字は onMissingGlyph に乗せる（同日、AskUserQuestion） |
| tools/list の比較 | main（`2caa5c1`）と変更後の `dist` を stdio で起動し、`tools/list` の応答を比べた。バイト単位で同じ |
| ゲート | check:engines・check・typecheck・test（`TEST_FONT_PATH` あり 521 件通過・1 件 skip／なし 466 件通過・56 件 skip）・build・check:public-types・`openspec validate --all`・`spec-ids check` が終了コード 0（Node 22.23.4） |
| テスト | `tests/standard-font-encoding.test.ts` の 9 件。変更前の `src/` では 7 件が落ちた。通った 2 件は、変わらない振る舞い（Latin-1 と同じ符号の字）と表の照合 |
| 見た目の確認 | 標準フォントで、長い段落・入れ子の箇条書き・番号付きリスト・Latin-1 の字を 60 dpi の画像にして見た。右余白の内側で折り返し、記号は「•」 |
| 仕様と実装のずれ | 0 件 |
| 維持の手間 | 仕様だけを変えた変更: 0 件 |
| 未測定 | 手元のビューアでの目視、pdf-reader-mcp での読み戻し（手元に渡した後に行う） |
