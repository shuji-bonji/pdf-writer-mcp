# Tasks

## 0. 前提

- [x] 0.1 人が proposal.md を承認している（1 本の PR で提案・仕様・実装・archive を進める。ブランチは `fix/family-error-contract`）

## 1. 受入テスト（先に落ちることを確かめる）

- [x] 1.1 `tests/common-errors.test.ts` を足す。各 Scenario を 1 件以上のテストにし、名前を「SPEC-WRITER-COMMON-ERRORS-<3 桁> <Scenario 名>」で始める。ツールは `buildServer()` を InMemoryTransport で呼び、本文の JSON を見る（`TEST_FONT_PATH` が無くても通るものだけにする）
- [x] 1.2 既存のテストが `retryable` の有無や日本語の文面を固定していれば、新しい形に合わせる（`tests/errors.test.ts`・`tests/form.test.ts`。期待の意味は変えない）
- [x] 1.3 変更前の `src/` で 1.1 が落ちることを確かめる

## 2. 実装

- [x] 2.1 `src/errors.ts`: `retryable` の表（`Record<WriterErrorCode, boolean>`）を置き、`toStructuredError` が表から引く。`WriterServiceError.retryable` を必須にし、`PdfWriterError` の `options` から `retryable` を外す。`NEXT_ACTIONS` の `reason` を英語にする
- [x] 2.2 エラーを作る箇所の `retryable: true`（8 か所。提案では 7 か所と書いていた）を消す
- [x] 2.3 CI と同じ一覧（`npm run check`・`npm run typecheck`・`npm run build`・`npm test`）が終了コード 0。`TEST_FONT_PATH` 無しでも通る

## 3. 出力が変わらないことの確認

- [x] 3.1 変更前と変更後の `dist` を起動し、`tools/list` の差が無いことを確かめる
- [x] 3.2 pdf-agent-stack の `eval/e2e` の S6 を `PDF_E2E_WRITER_DIR` で手元のビルドに向けて回し、writer の 3 件（相対パスは SDK の前段で落ちる 1 件を含めて 4 件）と宣言に無いキーの 1 件が通ることを確かめる

## 4. 版と記録

- [x] 4.1 `CHANGELOG.md`（英語）の `[Unreleased]` に書く。版は人が決める
- [x] 4.2 `README.md` と `README.ja.md`、`docs/` にエラーの形の記述があれば両方を直す
- [x] 4.3 `record.md` を計画 §8 の書式で書く

## 5. 承認と取り込み（人が判断する）

- [ ] 5.1 人が `proposal.md` の front matter に `approved: YYYY-MM-DD` と `pr: N` を書く
- [ ] 5.2 マージの前に、同じ PR の中で `npx openspec archive family-error-contract --yes` を実行する
- [ ] 5.3 archive の後、正本 `openspec/specs/common-errors/spec.md` の先頭に front matter（`spec_id: WRITER`・`kind: common`・`introduced_by: family-error-contract`）と Purpose（50 文字以上）を書き足す（OpenSpec 1.14.1 は差分の front matter を写さない）。`ls openspec/changes` が `archive` だけであることを確かめる
- [ ] 5.4 `npx openspec validate --all && npx spec-ids check` が通る
