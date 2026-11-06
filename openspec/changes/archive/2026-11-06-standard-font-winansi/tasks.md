# Tasks

## 0. 前提

- [x] 0.1 方針は人が決めている（2026-11-06 08:02 に #19 を 0.25.1 として進めると決定。同日、符号の無い文字は onMissingGlyph に乗せると決定。作業中に見つけた文字幅の誤りを 003 として同じ変更に入れた）。ブランチは `fix/standard-font-winansi`

## 1. 受入テスト（先に落ちることを確かめる）

- [x] 1.1 受入テストを足す。名前を「SPEC-WRITER-<機能>-<3 桁> <Scenario 名>」で、文字列のまま書く（テンプレートで組み立てない）。期待値を仕様 ID のために変えない
- [x] 1.2 変更前の `src/` で落ちることを確かめる

## 2. 実装

- [x] 2.1 Table D.2 の WinAnsiEncoding 欄から Unicode → 符号の表を起こし、`encode`・標準フォントの `hasGlyph`・幅（AFM のグリフ名）に使う
- [x] 2.2 CI の一覧（check:engines・check・typecheck・test（`TEST_FONT_PATH` あり／なし）・build・check:public-types）が終了コード 0

## 3. 確認

- [x] 3.1 `tools/list` の差が無いことを確かめる
- [x] 3.2 標準フォントで描いた箇条書きを画像にして見る
- [x] 3.3 pdf-reader-mcp で読み戻し、`label` が `•` になることを確かめる

## 4. 承認と取り込み（人が判断する）

- [x] 4.1 人が `proposal.md` の front matter に `approved: YYYY-MM-DD` と `pr: N` を書く
- [x] 4.2 マージの前に、同じ PR の中で `npx openspec archive standard-font-winansi --yes` を実行する
- [ ] 4.3 archive の後、新しい正本 `standard-font-encoding` の先頭に front matter（`spec_id: WRITER`・`kind: common`・`introduced_by: standard-font-winansi`）と Purpose（50 文字以上）を書き足す
- [ ] 4.4 `npx openspec validate --all && npx spec-ids check` が通る
