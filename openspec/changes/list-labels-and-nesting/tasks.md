# Tasks

## 0. 前提

- [x] 0.1 方針は人が決めている（2026-11-06 06:55。入れ子は A 案、ほかは提案どおり）。ブランチは `fix/list-structure-and-pdf20`（#12・#17 の 2 件）

## 1. 受入テスト（先に落ちることを確かめる）

- [ ] 1.1 受入テストを足す。名前を「SPEC-WRITER-<機能>-<3 桁> <Scenario 名>」で、文字列のまま書く（テンプレートで組み立てない）
- [ ] 1.2 変更前の `src/` で落ちることを確かめる

## 2. 実装

- [ ] 2.1 実装する
- [ ] 2.2 CI の一覧（check:engines・check・typecheck・test（Node 22・20、`TEST_FONT_PATH` あり）・build・check:public-types）が終了コード 0

## 3. 確認

- [ ] 3.1 `tools/list` の差を確かめる

## 4. 承認と取り込み（人が判断する）

- [ ] 4.1 人が `proposal.md` の front matter に `approved: YYYY-MM-DD` と `pr: N` を書く
- [ ] 4.2 マージの前に、同じ PR の中で `npx openspec archive list-labels-and-nesting --yes` を実行する
- [ ] 4.3 archive の後、新しい正本があれば front matter（`spec_id: WRITER`・`kind: tool`・`introduced_by: list-labels-and-nesting`）と Purpose（50 文字以上）を書き足す
- [ ] 4.4 `npx openspec validate --all && npx spec-ids check` が通る
