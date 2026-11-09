# Tasks

## 0. 前提

- [x] 0.1 直し方は人が決めている（2026-11-10）。ブランチは `fix/pdfua2-contents`
- [x] 0.2 版を人が決める

## 1. 受入テスト（先に落ちることを確かめる）

- [x] 1.1 `tests/pdfua2.test.ts` に PDFUA2-007・008
- [x] 1.2 変更前の `src/` で落ちることを確かめる

## 2. 実装

- [x] 2.1 `src/services/edit-annotation.ts`・`annotation-cos.ts`（PDF/UA-2 の文書で `/Contents` を `alt` に揃える・違えば断る）
- [x] 2.2 `src/services/acroform-tag.ts`・`edit-tag-form.ts`（PDF/UA-2 の文書でウィジェットに `/Contents`）
- [x] 2.3 説明文（`add_annotation` の `alt`・`tag_form_fields`）
- [x] 2.4 CI の一覧が Node 22 と Node 20 で終了コード 0

## 3. 確認

- [x] 3.1 veraPDF 1.30.0 で、PDF/UA-2 の文書への `add_annotation`（alt あり）と `tag_form_fields` の出力を `pdfua-2` で測る（フォームの検体は埋め込みフォントで作る）
- [x] 3.2 PDF/UA-1 の文書への 2 ツールの出力が 0.28.0 と同じであること（A/B）
- [x] 3.3 `record.md`

## 4. 承認と取り込み（人が判断する）

- [x] 4.1 人が `proposal.md` の front matter に `approved: YYYY-MM-DD` と `pr: N` を書く
- [ ] 4.2 マージの前に、同じ PR の中で `npx openspec archive pdfua2-contents --yes` を実行する
- [ ] 4.3 `npx openspec validate --all && npx spec-ids check` が通る
