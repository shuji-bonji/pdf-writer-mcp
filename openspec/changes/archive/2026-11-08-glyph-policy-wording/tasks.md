# Tasks

## 0. 前提

- [x] 0.1 方針は人が決めている（2026-11-08。版は 0.26.1、OpenSpec の変更は 1 つ、Requirement は足さない）。ブランチは `fix/glyph-policy-wording`

## 1. 受入テスト

- [x] 1.1 足さない（文の項目は版で変わる約束。proposal の「対象外」）。CREATE-TITLE-002 の 2 件のテストはそのまま通ることを確かめる

## 2. 実装

- [x] 2.1 `src/errors.ts`（`changeMissingGlyphPolicy` の reason）・`src/services/font-manager.ts`（`MISSING_GLYPH` の `error`）・`src/utils/validation.ts`（`fontPath` 5 か所・`onMissingGlyph`）・README（英語・日本語）を直す
- [x] 2.2 CI の一覧（check:engines・check・typecheck・test（`TEST_FONT_PATH` あり／なし）・build・check:public-types・`openspec validate --all`・`spec-ids check`）が Node 22 と Node 20 で終了コード 0

## 3. 確認

- [x] 3.1 変更前後の `dist` で `tools/list` の差を確かめる（record に書く）
- [x] 3.2 `MISSING_GLYPH` の本文を MCP の `tools/call` で確かめる（record に書く）

## 4. 承認と取り込み（人が判断する）

- [X] 4.1 人が `proposal.md` の front matter に `approved: YYYY-MM-DD` と `pr: N` を書く
- [x] 4.2 マージの前に、同じ PR の中で `npx openspec archive glyph-policy-wording --yes` を実行する
- [x] 4.3 `npx openspec validate --all && npx spec-ids check` が通る
