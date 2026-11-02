# Tasks

## 1. 受入テスト（直す前に落ちることを確かめる）

- [x] 1.1 `tests/create-title.test.ts` を足し、describe / it の名前に仕様 ID と Scenario 名を書く（002 の 2 つ目・003 の 2 つ目・004・005 の 2 つ・006）。フォントが要るもの（003・005 の 2 つ目）は `skipIf(!process.env.TEST_FONT_PATH)` にする
- [x] 1.2 変更前の `src/` で、新しい受入テストのうち `drawTitle` を使うものが落ちることを確かめる（004 は今の振る舞いを固定するテストなので変更前も通る）

## 2. 実装

- [x] 2.1 `commonCreateShape` に `drawTitle` を足し、`title` の説明を直す
- [x] 2.2 `buildPdf` で `drawTitle` を 1 か所で決め、フォントの検査・サブセット・描画を分ける。`tagged` の `title` 必須は `opts.title` で見る
- [x] 2.3 `renderMarkdown` に見出しの数え始めを渡し、`handleCreateMarkdownPdf` から題名を描くかで `1` / `0` を渡す
- [x] 2.4 `registry.test.ts` などのスナップショットが変わるなら、意図した変更として更新する（期待値を仕様 ID のために変えない）— 省略可能な引数は固定していないので、変わらなかった

## 3. 確かめる

- [x] 3.1 `TEST_FONT_PATH` 無しと有りの両方で `npm test` が通る
- [x] 3.2 CI の一覧（`check:engines`・`check`・`typecheck`・`build`・`check:public-types`）が終了コード 0
- [x] 3.3 変更前と変更後の `dist` を stdio で起動し、`tools/list` の差が生成 3 ツールの `drawTitle` と `title` の説明だけであることを確かめる
- [x] 3.4 `SOURCE_DATE_EPOCH` を固定し、`drawTitle` を渡さない生成の出力が変更前と 1 バイトも変わらないことを確かめる
- [x] 3.5 `README.md`・`README.ja.md` の生成ツールの引数の説明に `drawTitle` を足す。`CHANGELOG.md`（英語）の `[Unreleased]` に書く
- [x] 3.6 `npx openspec validate --all && npx spec-ids check` が通る

## 4. 手元での確認（人）

- [x] 4.1 `drawTitle: false`・`tagged: true` の Markdown の出力を pdf-verify-mcp の `validate_conformance`（`pdfua-1`、veraPDF）にかけ、COMPLIANT であることを確かめる — エージェントがお手元の Mac の veraPDF 1.30.0 で 2 検体とも 106/106 を確かめた

## 5. archive（承認の後）

- [ ] 5.1 proposal.md の `approved`・`pr` が埋まっていることを確かめる
- [ ] 5.2 `openspec archive draw-title-option --yes`（create-title は既存の capability なので、front matter の書き足しは要らない）
- [ ] 5.3 `npx openspec validate --all`・`npx spec-ids check`・`npx spec-ids pr-scope` を通して commit
