# Tasks

## 0. 前提

- [x] 0.1 方針は人が決めている（#11 のコメント、2026-11-06）。ブランチは `fix/writer-findings`

## 1. 受入テスト（先に落ちることを確かめる）

- [ ] 1.1 `tests/ensure-reports.test.ts` を足す。名前を「SPEC-WRITER-<機能>-<3 桁> <Scenario 名>」で始める
- [ ] 1.2 既存の `tests/pdfa-conformance.test.ts` の `wasDeclared` の期待を `previousDeclaration` に書き換える（意味は同じ）
- [ ] 1.3 変更前の `src/` で 1.1 が落ちることを確かめる

## 2. 実装

- [ ] 2.1 `src/services/tagged-cos.ts`: 3 つの要件を、入力の値と比べてから書く。`replacedRequirements`・`requirementsChanged` を返す
- [ ] 2.2 `src/services/edit-ensure-pdfa.ts`・`src/types/index.ts`: `wasDeclared` を `previousDeclaration` に置き換える
- [ ] 2.3 ツールの説明・README・CHANGELOG に書く。CI の一覧が終了コード 0

## 3. 確認

- [ ] 3.1 `tools/list` の差がツールの説明の文だけであることを確かめる

## 4. 承認と取り込み（人が判断する）

- [ ] 4.1 人が `proposal.md` の front matter に `approved: YYYY-MM-DD` と `pr: N` を書く
- [ ] 4.2 `ensure-pdfa4-refuses-pdfua1` を先に archive し、そのあと同じ PR の中で `npx openspec archive ensure-reports-what-changed --yes` を実行する
- [ ] 4.3 archive の後、正本 `openspec/specs/ensure-tagged/spec.md` の先頭に front matter（`spec_id: WRITER`・`kind: tool`・`introduced_by: ensure-reports-what-changed`）と Purpose（50 文字以上）を書き足す
- [ ] 4.4 `npx openspec validate --all && npx spec-ids check` が通る
