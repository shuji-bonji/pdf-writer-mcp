# record: draw-title-option

PDF family の OpenSpec + spec-ids 導入（pdf-agent-stack `docs/specs/31`）の Phase 2、pdf-writer-mcp の 1 件目の記録です。書式は計画 §8 です。時刻は JST です。

| 項目 | 記録 |
| --- | --- |
| 版 | OpenSpec 1.14.1 / spec-ids 0.5.0 / pdf-writer-mcp 0.22.0 → 次の版（人が決める。引数が増えるので minor の 0.23.0 を提案）/ Claude（claude.ai、モデル claude-opus-5-5）/ 2026-11-02 |
| きっかけ | Phase 2 の残り（writer への導入）。open の Issue は 0 件だったので、2026-09-16 の Grok Build での実機評価（pdf-agent-stack #26）で見つかり未起票だった「タグ付きの `create_markdown_pdf` で題名と本文の H1 が二重になる」（docs/TASKS.md の B-19）を対象にした |
| PR の切り方 | 3 本。導入 `chore/openspec-init`（実装 PR の名前。verify の #26 の教訓で初版起こしと分けた）→ 初版起こし `spec-init/create-title`（001〜003、既存テスト 3 件の名前の先頭に ID）→ 実装 PR `feat/draw-title-option`（提案・仕様・実装・承認の後に archive）。後の 2 本は 1 PR 運用（人の選択） |
| 正本の置き方 | 生成 3 ツールの共通引数なので、3 ツールの正本を一斉に起こさず、題名の扱いだけを共通の capability `create-title`（`kind: common`）にした。pdf-spec-mcp の `spec-sources` と同じ置き方 |
| 仕様を書いた時間 | 対象の確認と設計の前提（ISO 14289-1 §7.1・§7.4.2 を pdf-spec-mcp `pdfua1` で原文確認・既存テストの洗い出し）は 19:25〜21:14 の間（初版起こしを含む。導入の作業と並行）。`openspec new change` は 21:14、提案一式が strict の validate を通ったのが 21:15 |
| 実装した時間 | 約 5 分（21:15〜21:20。受入テスト・実装・A/B・veraPDF・README・CHANGELOG） |
| 人が判断した箇所 | (1) 直し方（引数を足す / 先頭の H1 と同じなら自動で省く、から引数を選択）。(2) PR の切り方（初版起こし + 1 PR）。(3) 版（未決）。(4) `approved`・`pr` の記入（初版起こしと実装 PR の両方） |
| 仕様と実装のずれ | 1 件。design.md に「メタデータには描くときは置換後の title を書く」と書いたが、コードを読むと `finalizeCreated` は以前から `opts.title`（置換前）を書いていた。design.md を直した。振る舞いは変えていない |
| エージェントが仕様に無い振る舞いを実装した件数 | 0 件 |
| 実装後に仕様を読み返した回数 | 1 回（上のずれ） |
| テスト | `npm test` 469 → 475 件（フォント付き）。フォント無しは 416 通過・53 skip → 420 通過・55 skip。受入テスト 6 件のうち、`drawTitle` を使う 5 件は変更前に落ち、今の振る舞いを固定する 004 は変更前も通った。check:engines・check・typecheck・build・check:public-types は終了コード 0 |
| tools/list の比較 | 変更前と変更後の `dist` を stdio で起動して比べた。20 ツールのうち差は生成 3 ツールの `drawTitle`（追加）と `title` の説明だけ |
| 既定の出力 | `SOURCE_DATE_EPOCH` を固定し、`drawTitle` を渡さない 9 通り（3 ツール・タグ有無・フォント有無・PDF 2.0・`onMissingGlyph: replace`）で、変更前と変更後の出力の sha256 が一致 |
| 適合 | `drawTitle: false`・`tagged: true` の 2 検体（題名と同じ `#` で始まる Markdown／`##` で始まる Markdown）を、お手元の Mac の veraPDF 1.30.0（pdf-verify-mcp の `validate_conformance`、`pdfua-1`）にかけ、2 件とも COMPLIANT・106/106 |
| 承認と archive | 初版起こしは PR #6（`approved: 2026-11-02`）でマージ。実装 PR #7 は main（`1603dba`）に rebase し、proposal.md に `approved: 2026-11-02`・`pr: 7` を書いて push（22:08 に連絡）。エージェントが PR #7 の head を取り込み、渡した commit からの差が承認欄 2 か所だけであることを確かめてから `openspec archive draw-title-option --yes`（+3 / ~2）。`create-title` は既存の capability なので、正本の front matter（`pr: 6`）はそのまま残った |
| 維持の手間 | 仕様だけを変えた変更: 0 件 |

## 分かったこと

1. **「直す前に落ちる」は、この変更でも「引数を知らない」で落ちただけだった。** 5 件とも `Unrecognized key: "drawTitle"` で落ちた。振る舞いの差（題名を描かない・見出しの数え始め・フォントの検査を当てない）は、変更後に通ったことでしか示せていない。新しい引数を足す変更では、受入テストが変更前に落ちることは、ほとんど何も示さない（verify の 1 件目の「分かったこと」3 と同じ形）。
2. **初版起こしは、題名の最も基本の振る舞いを起こせなかった。** 「本文の先頭に題名を描く」と「タグ無しで Info `/Title` に書く」を固定しているテストが 1 件も無く、初版の正本に入らなかった。この変更の 004・005 で初めてテストが付いた。題名の H1 は、見出しの正規化（7.4.2）のテストが副作用として固定していただけだった。
3. **MODIFIED は見出しの文字列で正本と突き合わせる。** 002・003 の題を書き換えた差分は、strict の validate が `Archive would refuse this delta … not found` と INFO で知らせた（エラーにはならない）。題は正本のまま、本文だけを変えて通した。題を変えたいときは、同じ変更の中で RENAMED を使う。
4. **導入と初版起こしを最初から分けた。** verify の #26（導入を初版起こしの PR に載せて pr-scope に止められた）の教訓どおり。導入のブランチは手元の `spec-ids pr-scope` で実装 PR として 21 ファイル範囲内、初版起こしは承認の空欄だけが残ることを確かめた。
5. **CLAUDE.md のツール数が古い。** 「ツール一覧（19）」「registry.test.ts … 19 ツール」と書いてあるが、`tools/list` は 20 ツール（registry.test.ts も「exactly the 20 expected tools」）。この変更では直していない。
6. **正本の Purpose は初版のときの説明のまま残る。** Purpose の「本文の先頭に題名を描くこととタグ無しの `/Title` を固定しているテストは無い」は、この変更の 004・005 で解消したが、archive は要求だけを書き換え、Purpose には触れない。「この初版は」で始まる初版の記録として読めるので、今回は直していない。直すなら新しい変更で行う（実装の係は正本の本文を直接書き換えない決まり）。
