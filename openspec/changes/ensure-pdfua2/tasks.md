# Tasks

## 0. 前提

- [x] 0.1 方針は人が決めている（2026-11-09）。ブランチは `feat/pdfua2-output`

## 1. 受入テスト（先に落ちることを確かめる）

- [x] 1.1 `tests/ensure-tagged-version.test.ts` の 003 を新しい振る舞いに書き換える。`tests/pdfua2.test.ts` に ENSURE-TAGGED-004・ENSURE-PDFA-001（PDF/UA-2 の入力に pdfa-4）・ENSURE-PDFA-003
- [x] 1.2 変更前の `src/` で落ちることを確かめる

## 2. 実装

- [x] 2.1 `src/services/edit-ensure-tagged.ts`・`tagged-cos.ts`・`edit-ensure-pdfa.ts`
- [x] 2.2 CI の一覧が Node 22 と Node 20 で終了コード 0（変更 `pdfua2-output` と同じ一覧）

## 3. 確認

- [x] 3.1 veraPDF 1.30.0 で、`ensure_tagged` の出力（`pdfua-2`）と `ensure_pdfa(pdfa-4)` の出力（`pdfua-2`・`pdfa-4`）を測る（record）

## 4. 承認と取り込み（人が判断する）

- [ ] 4.1 人が `proposal.md` の front matter に `approved: YYYY-MM-DD` と `pr: N` を書く
- [ ] 4.2 マージの前に、同じ PR の中で `npx openspec archive ensure-pdfua2 --yes` を実行する（`pdfua2-output` の後）
- [ ] 4.3 `npx openspec validate --all && npx spec-ids check` が通る
