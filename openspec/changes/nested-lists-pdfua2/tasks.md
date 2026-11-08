# Tasks

## 0. 前提

- [x] 0.1 方針は人が決めている（#20 と 2026-11-09）。ブランチは `feat/pdfua2-output`

## 1. 受入テスト（先に落ちることを確かめる）

- [x] 1.1 `tests/list-structure.test.ts` に 005 の 2 件
- [x] 1.2 変更前の `src/` で 2 件とも落ちる

## 2. 実装

- [x] 2.1 `src/services/renderers/markdown.ts` の `drawList`
- [x] 2.2 CI の一覧が Node 22 と Node 20 で終了コード 0（変更 `pdfua2-output` と同じ一覧）

## 3. 確認

- [x] 3.1 pdf-reader-mcp の `inspect_tags` で構造木の形を読み、veraPDF（`pdfua-2`）で測る（record）

## 4. 承認と取り込み（人が判断する）

- [ ] 4.1 人が `proposal.md` の front matter に `approved: YYYY-MM-DD` と `pr: N` を書く
- [ ] 4.2 マージの前に、同じ PR の中で `npx openspec archive nested-lists-pdfua2 --yes` を実行する（`pdfua2-output` の後）
- [ ] 4.3 `npx openspec validate --all && npx spec-ids check` が通る
