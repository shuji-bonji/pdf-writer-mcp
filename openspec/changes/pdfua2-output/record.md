# record: pdfua2-output

PDF family の OpenSpec + spec-ids 導入（pdf-agent-stack `docs/specs/31`）のもとでの記録です。書式は計画 §8 です。時刻は JST です。

| 項目 | 記録 |
| --- | --- |
| きっかけ | pdf-writer-mcp#26（#20 の前提。2026-11-08 に起票） |
| 版 | OpenSpec 1.14.1 / spec-ids 0.5.0 / pdf-writer-mcp 0.26.1 → 0.27.0（案）/ normativepdf 0.9.1（変更なし。構造要素の `/NS` は `extra` で書き、`StructTreeRoot` の `/Namespaces` は書き込みの途中で足した）/ Claude（claude.ai、モデル claude-opus-5-5）/ 2026-11-09 |
| 仕様の確認 | pdf-spec-mcp（`pdfua2` = ISO 14289-2:2024、`iso32000-2`）で §5・§6.2・§8.2.4・§8.2.5（全節）・§8.11、ISO 32000-2 §14.8.6.1・§14.7.4.2・Annex M を読んだ。条文の一覧は proposal |
| 人が判断した箇所 | 2026-11-09: 引数の形（`tagged` + `pdfVersion: "2.0"`）・名前空間（PDF 2.0 にある型はすべて 2.0）・題名は `Title`・範囲（#20・`ensure_tagged`・`ensure_pdfa`）。🔴 未判断: 版・`dc:title` の引き継ぎを PDF/UA-2 以外にも当てること・`add_bookmarks` は warnings だけにすること・生成系の CLAIMS の warnings |
| 作業中に見つけたこと | (1) `syncXmpWithInfo` が `pdfuaid:part` は引き継ぐのに `pdfuaid:rev` を引き継いでいなかった。(2) 同じ経路が `dc:title` を Info 辞書からだけ作っていて、Info に `Title` を置かない PDF 2.0 の文書に `set_metadata` を `author` だけで掛けると `dc:title` が消えた（実測）。PDF/A-4 にした文書、タグ無しの 2.0 の文書でも同じ。(3) `add_bookmarks` の出力は §8.8-1 で落ちる（ページの行き先しか書かないため） |
| veraPDF（1.30.0、`pdfua-2`、1,728 規則） | 適合: 生成 3 ツールの出力（日本語・Noto Sans JP。Markdown は見出し・飛んだ見出し・入れ子のリスト・番号付きリスト・引用・コード・表）、その文書に `set_metadata`（修正後）・`add_annotation` を掛けた出力。非適合: `add_bookmarks` 8.8-1（PDFUA2-006 で名指す）、`stamp_page_numbers`・`add_watermark` を `fontPath` なしで掛けた出力 8.4.5.5.1-1（標準フォント。PDF/UA-1 と同じ扱い）。比較: 変更前の PDF/UA-1 の出力は `pdfua-2` で 4 規則が落ち、`pdfua-1` では 106/106 |
| veraPDF で測れないもの | §8.2.5.12（見出しの段）・§8.2.5.13（題名の Title）は検査されない。pdf-reader-mcp の `inspect_tags` と受入テストで形を確かめた |
| A/B | 変更前（`origin/main` `333e794`）と変更後の dist を `SOURCE_DATE_EPOCH=1700000000` で stdio から呼び、28 通り（生成 3 ツール × 1.7/2.0 × 標準/埋め込みフォント × タグ有無（2.0 のタグ付きは除く）と、編集 10 通り）の出力の sha256 と応答を比べた。25 通りが同じ。差は `set_metadata`・`ensure_pdfa(pdfa-4)` をタグ無しの 2.0 の文書に掛けた 2 通り（`dc:title` が残るようになった）と、PDF/UA-1 の入力への `ensure_pdfa(pdfa-4)` の `hint` の文 1 通り |
| tools/list の比較 | 20 ツールのうち、`create_markdown_pdf`・`ensure_tagged`・`ensure_pdfa` の `description` と、生成 3 ツールの `drawTitle`・`tagged`・`pdfVersion`、`ensure_tagged` の `title`・`lang` の説明文だけが違う。型・必須・列挙は同じ |
| ゲート | check:engines・check・typecheck・test・build・check:public-types・`openspec validate --all`・`spec-ids check` が終了コード 0。test は Node 22.23.4 と Node 20.20.2 の両方で、`TEST_FONT_PATH` あり 551 件通過・1 件 skip／なし 496 件通過・56 件 skip（0.26.1 から 15 件増） |
| テスト | `tests/pdfua2.test.ts` の PDFUA2-001〜006（10 件）。変更前の `src/` では 6 件が落ちた。通った 4 件は変わらない振る舞い（PDF/UA-1 のまま・名前空間を書かない・PDF/UA-1 にはしおりの警告を書かない）。`tests/pdf-version.test.ts` の B-16 の拒否のテストを、受け付けるテストに書き換えた |
| 仕様と実装のずれ | 0 件 |
| 維持の手間 | 仕様だけを変えた変更: 0 件。CREATE-TITLE-003 を PDF/UA-1 に限る MODIFIED は、振る舞いを変えない文言の変更 |
