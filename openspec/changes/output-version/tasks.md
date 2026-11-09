# Tasks

## 0. 前提

- [x] 0.1 方針と 4 点は人が決めている（2026-11-09・2026-11-10。2 点は #28 の本文に照らして同日に決め直した）
- [x] 0.2 版・`dc:title` の他の言語の項目・生成系の警告を人が決めた（2026-11-10）
- [x] 0.3 ブランチ `feat/output-version`

## 1. 受入テスト（先に落ちることを確かめる）

- [x] 1.1 `tests/output-version.test.ts` に OUTPUT-VERSION-001〜007、`tests/pdfua2.test.ts` に ENSURE-PDFA-004
- [x] 1.2 変更前の `src/` で落ちることを確かめる

## 2. 実装

- [x] 2.1 `page-ops-cos.ts`・`validation.ts`・`definitions.ts`（`merge_pdfs` の `pdfVersion`・版の混在を断る・Info → XMP）
- [x] 2.2 `edit-ensure-pdfa.ts`（2.0 の入力への `pdfa-3b`）
- [x] 2.3 `edit-metadata.ts`・`info-dict.ts`・`xmp-cos.ts`・`xmp-build.ts`（2.0 の Info・XMP の項目の運搬）
- [x] 2.4 `edit-tag-form.ts`・`edit-annotation.ts`（既定の名前空間の警告）
- [x] 2.5 `types/index.ts`・`output-*.ts`（`output`）、エラーの文（006）、説明文・instructions（007）
- [x] 2.6 CI の一覧が Node 22 と Node 20 で終了コード 0

## 3. 確認

- [x] 3.1 veraPDF 1.30.0 で、1.7 → 2.0 の `merge_pdfs`、2.0 の文書への `set_metadata`、UA-2 の文書への `add_annotation`・`tag_form_fields` を測る（record）
- [x] 3.2 PDF 1.7 だけの入力の出力が変更前と同じであること（A/B。`output` 以外）

## 3.5 記録

- [x] 3.5.1 `record.md`（版・かかった時間・人が判断した箇所・仕様と実装のずれ）

## 4. 承認と取り込み（人が判断する）

- [x] 4.1 人が `proposal.md` の front matter に `approved: YYYY-MM-DD` と `pr: N` を書く
- [ ] 4.2 マージの前に、同じ PR の中で `npx openspec archive output-version --yes` を実行する
- [ ] 4.3 `npx openspec validate --all && npx spec-ids check` が通る
