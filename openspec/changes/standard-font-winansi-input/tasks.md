# Tasks

## 0. 前提

- [x] 0.1 方針は人が決めている（2026-11-06 に Issue のコメントで決定。決まっていなかった点は proposal の「人が判断すること」）。ブランチは `fix/winansi-input-and-glyph-detail`

## 1. 受入テスト（先に落ちることを確かめる）

- [x] 1.1 受入テストを足す。名前を「SPEC-WRITER-<機能>-<3 桁> <Scenario 名>」で、文字列のまま書く（テンプレートで組み立てない）。期待値を仕様 ID のために変えない
- [x] 1.2 変更前の `src/` で落ちることを確かめる

## 2. 実装

- [x] 2.1 実装する
- [x] 2.2 CI の一覧（check:engines・check・typecheck・test（`TEST_FONT_PATH` あり／なし）・build・check:public-types・`openspec validate --all`・`spec-ids check`）が Node 22 と Node 20 で終了コード 0

## 3. 確認

- [x] 3.1 `tools/list` の差を確かめる

## 4. 承認と取り込み（人が判断する）

- [ ] 4.1 人が `proposal.md` の front matter に `approved: YYYY-MM-DD` と `pr: N` を書く
- [ ] 4.2 マージの前に、同じ PR の中で `npx openspec archive <slug> --yes` を実行する（`standard-font-winansi-input` を先に）
- [ ] 4.3 archive の後、正本 `standard-font-encoding` の Purpose の「U+0100 以上の文字を `FONT_REQUIRED` で断る判定は、この capability の対象外」を、004 を含む形に直す
- [ ] 4.4 `npx openspec validate --all && npx spec-ids check` が通る
