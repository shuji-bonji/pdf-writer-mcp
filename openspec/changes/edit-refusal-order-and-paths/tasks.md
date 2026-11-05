# Tasks

## 0. 前提

- [x] 0.1 方針は人が決めている（#10 のコメントと、ファイルシステムのエラーの横断の決定。2026-11-06）。ブランチは `fix/writer-findings`（#10・#9・#11 の 3 件）

## 1. 受入テスト（先に落ちることを確かめる）

- [x] 1.1 `tests/edit-refusals.test.ts` を足す。ツールは `buildServer()` の実物を in-memory の transport で呼ぶ。名前を「SPEC-WRITER-COMMON-ERRORS-<3 桁> <Scenario 名>」で始める
- [x] 1.2 変更前の `src/` で落ちることを確かめる

## 2. 実装

- [x] 2.1 `src/errors.ts`: `PdfWriterError` と本文に `detail` を足し、ファイルシステムのエラーを `INVALID_ARGUMENT` にする関数（`outputWriteError`）を置く
- [x] 2.2 `src/services/edit-open.ts`: 暗号化の確認を署名の確認より前に移し、`detail.keyDerived` と `hint` を分ける
- [x] 2.3 書き出しの 3 か所（`output-edited.ts`・`incremental-append.ts`・`output-created.ts`）を `outputWriteError` に通す。全書き直しの失敗の文を直す
- [x] 2.4 CI の一覧（check:engines・check・typecheck・test（Node 22・20、`TEST_FONT_PATH` あり）・build・check:public-types）が終了コード 0

## 3. 確認

- [x] 3.1 `tools/list` の差が無いことを確かめる

## 4. 承認と取り込み（人が判断する）

- [ ] 4.1 人が `proposal.md` の front matter に `approved: YYYY-MM-DD` と `pr: N` を書く
- [ ] 4.2 マージの前に、同じ PR の中で `npx openspec archive edit-refusal-order-and-paths --yes` を実行する
- [ ] 4.3 `npx openspec validate --all && npx spec-ids check` が通る
