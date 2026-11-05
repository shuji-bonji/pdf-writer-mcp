# Tasks

## 0. 前提

- [x] 0.1 方針は人が決めている（#9 のコメント、2026-11-06）。ISO 14289-1 §6.1 は pdf-spec-mcp（`pdfua1`）で確かめた。ブランチは `fix/writer-findings`

## 1. 受入テスト（先に落ちることを確かめる）

- [ ] 1.1 `tests/ensure-pdfa-pdfua.test.ts` を足す。名前を「SPEC-WRITER-ENSURE-PDFA-001 <Scenario 名>」で始める
- [ ] 1.2 変更前の `src/` で落ちることを確かめる

## 2. 実装

- [ ] 2.1 `src/services/pdfa-cos.ts`: XMP の宣言を読む関数（`readXmpDeclarations`）を置く
- [ ] 2.2 `src/services/edit-ensure-pdfa.ts`: -4 系で `pdfuaid` があれば断る
- [ ] 2.3 ツールの説明に書く。CI の一覧が終了コード 0

## 3. 確認

- [ ] 3.1 `tools/list` の差がツールの説明の文だけであることを確かめる

## 4. 承認と取り込み（人が判断する）

- [ ] 4.1 人が `proposal.md` の front matter に `approved: YYYY-MM-DD` と `pr: N` を書く
- [ ] 4.2 マージの前に、同じ PR の中で `npx openspec archive ensure-pdfa4-refuses-pdfua1 --yes` を実行する
- [ ] 4.3 archive の後、正本 `openspec/specs/ensure-pdfa/spec.md` の先頭に front matter（`spec_id: WRITER`・`kind: tool`・`introduced_by: ensure-pdfa4-refuses-pdfua1`）と Purpose（50 文字以上）を書き足す
- [ ] 4.4 `npx openspec validate --all && npx spec-ids check` が通る
