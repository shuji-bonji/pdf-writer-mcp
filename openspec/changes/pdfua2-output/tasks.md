# Tasks

## 0. 前提

- [x] 0.1 方針は人が決めている（2026-11-09。proposal の「人が判断すること」）。ブランチは `feat/pdfua2-output`（`nested-lists-pdfua2`・`ensure-pdfua2` と同じ）

## 1. 受入テスト（先に落ちることを確かめる）

- [x] 1.1 `tests/pdfua2.test.ts` に PDFUA2-001〜006 の受入テスト。`tests/pdf-version.test.ts` の B-16 の拒否のテストを、受け付けるテストに書き換える
- [x] 1.2 変更前の `src/` で落ちることを確かめる（PDFUA2-006 の「PDF/UA-1 の文書には書かない」と PDFUA2-001・002 の「PDF/UA-1 のまま」は変わらない振る舞いなので通る）

## 2. 実装

- [x] 2.1 `struct-tree.ts`（`StructProfile`・名前空間）・`builder.ts`・`output-created.ts`・`xmp-build.ts`（`pdfuaid:rev`）・`xmp-cos.ts`（`rev` と `dc:title` の引き継ぎ）・`pdfa-cos.ts`（`PDFUA2_REV`）・`renderers/markdown.ts`（見出し）・`edit-bookmarks.ts`
- [x] 2.2 説明文・instructions・README・DESIGN.md・TASKS.md
- [x] 2.3 CI の一覧（check:engines・check・typecheck・test（`TEST_FONT_PATH` あり／なし）・build・check:public-types・`openspec validate --all`・`spec-ids check`）が Node 22 と Node 20 で終了コード 0

## 3. 確認

- [x] 3.1 veraPDF 1.30.0（`pdfua-2`）で生成 3 ツールの出力と、編集後の出力を測る（record）
- [x] 3.2 変更前の dist と、PDF/UA-1・タグ無しの出力を sha256 で比べる（record）
- [x] 3.3 `tools/list` の差（record）

## 4. 承認と取り込み（人が判断する）

- [ ] 4.1 人が `proposal.md` の front matter に `approved: YYYY-MM-DD` と `pr: N` を書く
- [ ] 4.2 マージの前に、同じ PR の中で `npx openspec archive pdfua2-output --yes` を実行する。新しい `openspec/specs/pdfua2/spec.md` に front matter（`spec_id: WRITER`・`kind: common`・`introduced_by: pdfua2-output`）と Purpose（50 文字以上）を書く
- [ ] 4.3 `npx openspec validate --all && npx spec-ids check` が通る
