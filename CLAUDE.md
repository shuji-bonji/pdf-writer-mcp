# pdf-writer-mcp - 開発ガイド

## プロジェクト概要

テキスト / Markdown / 表データから **PDF を生成**し、既存 PDF を**編集**する MCP サーバ。
PDF family（[reader](https://github.com/shuji-bonji/pdf-reader-mcp) = 何があるか / [verify](https://github.com/shuji-bonji/pdf-verify-mcp) = 本物か / [spec](https://github.com/shuji-bonji/pdf-spec-mcp) = 仕様は何を要求するか）における「**書く**」担当。

- 設計書: [`docs/DESIGN.md`](./docs/DESIGN.md)（ADR とフォント戦略の実測データは必読）
- 残タスク: [`docs/TASKS.md`](./docs/TASKS.md)
- 上位仕様: `Document-Note/mcps/PDFfamily/specs/05-pdf-writer-mcp.md`（Tier A/B/C 体系）
- 責務分担の提案: `mcps/pdf-family-role-architecture.md`

## ツール一覧（19）

| 系統 | ツール |
|------|--------|
| 生成（Tier 0） | `create_text_pdf` / `create_markdown_pdf` / `create_table_pdf`（`tagged: true` で PDF/UA-1） |
| 編集 Tier A | `set_metadata` / `merge_pdfs` / `split_pdf` / `extract_pages` / `delete_pages` / `reorder_pages` / `rotate_pages` / `add_bookmarks` / `add_annotation` |
| 編集 Tier B | `attach_file` / `add_watermark` / `stamp_page_numbers` / `fill_form` / `flatten_form` / `tag_form_fields`（PDF/UA 修復・v0.8.0） |
| Tier C | `ensure_tagged`（タグ付けの足場・修復・v0.12.0）+ 全編集ツールの `preserveSignatures` |

## アーキテクチャの要点（v0.7.0 = McpServer + Zod）

生成系と編集系は**並列の系統**であり、共通化されていない。

```
起動: index.ts（stdout-guard を先頭 import）→ server.ts buildServer() が definitions.ts のレジストリを registerTool
生成: handler → parseArgs(Zod) → builder → openFont → glyph policy → embedFontFor → LayoutEngine → renderers → finalizePdf
編集: handler → parseArgs(Zod) → editor → loadForEdit（署名ガード・100MB 上限）→ 各操作（ページ操作は page-ops.ts）→ saveEdited
```

- `server.ts` が `try/catch` を一元化し、`errors.ts` の `toStructuredError` で family 契約
  （`code` / `hint` / `next_actions` / `retryable`）に整形して `isError:true` を返す
- ハンドラは例外を **throw** する（`{error}` を返さない）。ガード系は `PdfWriterError` に
  `NEXT_ACTIONS` プリセット（解除フラグの具体例）を載せる
- **ツール追加は 3 箇所**: ① `utils/validation.ts` に Zod スキーマ（`xxxShape` + `XxxSchema`）、
  ② `tools/definitions.ts` のレジストリに 1 エントリ（title / description / shape / annotations）、
  ③ `tools/handlers.ts` に `handleXxx` + `toolHandlers` に 1 行。
  **公開スキーマと実行時検査の情報源は Zod ただ一つ**（JSON Schema の手書きは廃止済み）。
  外部仕様は `registry.test.ts` がスナップショット固定しているので、意図した変更ならテストも更新する
- パス引数は絶対パス強制・`..` 拒否（validation.ts の共通 Zod パーツ。緩めないこと）
- 閾値・上限は `constants.ts` に集約（`shuji-mcp-patterns` スキルの鉄則に準拠）
- `console.log` 禁止（stdio 汚染）。ログは `utils/logger.ts` 経由で stderr へ。
  保険として `stdout-guard.ts` が依存ライブラリの `console.log/warn` も stderr へ差し替える
- `SOURCE_DATE_EPOCH` 設定時は日時が固定され再現ビルドになる（`deterministic.test.ts`）

## 鉄則: 仕様ファースト（実装仕様を決める前に ISO 原文を読む）

**機能の可否・設計を判断する前に、必ず `pdf-spec-mcp` で ISO 32000-2 / 14289 の原文を確認すること。**
ライブラリ（pdf-lib）の制約と**仕様の制約**を混同しない — 前者は実装で回避できるが、後者はできない。

- 「仕様上できない」「情報が残っていない」と言う前に `search_spec` / `get_section` / `get_tables` で条項を引く
- 実測は「その入力・その経路での事実」であり一般化しない（**タグ付き / タグ無しで前提が変わる**）
- 結論には根拠条項を残す（specs / ADR / CHANGELOG / docs/SPEC-AUDIT.md）

> 実例（2026-07-17）: B-7d で「PDF は組版結果しか持たないためリフローは原理的に不可能」と結論しかけたが、
> **§14.8.1 は "Automatic reflow of page contents" を Tagged PDF の意図された用途として明記**しており、
> **§14.8.2.5 は logical content order を「構造木の深さ優先走査」で定義している（shall）**。
> タグ**無し** PDF の実測（Tj が並ぶだけ）をタグ付きにも一般化した誤りだった。
> 加えて「リフロー = 元レイアウトの再現」も誤解で、正しくは「論理順序を保った**新規**レイアウト」
> （＝ 元の折り返し規則は不要）。条文を読めば防げた。
> 条文照合の実績は v0.9.1（§14.4 / §12.8.2.2 の shall 違反を是正）・v0.9.2（SPEC-AUDIT Phase 1）にもある。

## 落とし穴（過去に踏んだもの・再発させないこと）

### 0-a. フォーム系は pdf-lib の「勝手な外観再生成」を必ず止める（v0.6.0）

`doc.save()` は既定で `updateFieldAppearances: true`、`form.flatten()` も同様。どちらも
`form.getDefaultFont()` ＝ **Helvetica** で外観を作り直すため、日本語の値は
`WinAnsi cannot encode "山"` で落ちる。順序を守ること:

1. 値を適用する
2. 描画される文字を集める（`collectRenderedTexts`）
3. その字だけサブセットしたフォントで `form.updateFieldAppearances(font)`
4. `save({ updateFieldAppearances: false })` / `flatten({ updateFieldAppearances: false })`

フォント埋め込みを先にやると、後から入れた値の字がサブセットに無く豆腐になる。

### 0-b. pdf-lib の `flatten()` は宙吊り参照を残す（v0.6.0）

`PDFForm.removeField` がページの `/Annots` から消しているのは **外観ストリームの参照**
（`findWidgetAppearanceRef`）とフィールド辞書自身の参照だけ。`addToPage` が作るウィジェットは
`/Kids` 配下の別オブジェクトなので、その参照が `/Annots` に残り poppler が
`Invalid XRef entry` を出す。`pruneDanglingRefs`（form.ts）で掃除している。
テスト `tests/form.test.ts` の「宙吊り参照の掃除」がこれを固定しているので弱めないこと。

### 1. フォントのサブセットは fontkit を使わない（ADR-7 / v0.3.0）

pdf-lib の `embedFont(subset: true)` は **CJK フォントのグリフを破壊**する。
poppler の `Embedded font file may be invalid` → `Couldn't create a font` が出て、
Chrome / Firefox / Acrobat / Claude Desktop の**全ビューアで文字が豆腐**になる。

→ harfbuzz（`subset-font`）で事前サブセットし、`embedFont(subset: false)` で埋め込む。

### 2. `noLayoutClosure: true` を外さない（ADR-8 / v0.3.1）

pdf-lib は CID を `font.layout()`（GSUB 適用**後**）から、ToUnicode を `characterSet`
（適用**前**）から作る。Noto Sans JP はラテン文脈の数字を別字形に置換する
（`layout('English 0')` の 0 は gid 17 → **17460**）ため、両者がずれて**抽出が壊れる**
（`v0.3.0` → `vô.õ.ô`）。置換候補をサブセットに含めなければ置換自体が起きない。

### 3. 「抽出できる ≠ 描画できる」、その逆も真

上記 2 つのバグは、**片方のテストだけでは検知できなかった**。

| バグ | 描画 | 抽出 | 素通りしたテスト |
|------|------|------|------------------|
| ADR-7（v0.2.x） | ✗ | ✓ | `extract.test.ts` |
| ADR-8（v0.3.0） | ✓ | ✗ | `render.test.ts` の初期版 |

→ **`render.test.ts` を消さない・弱めない**。埋め込みフォントを PDF から取り出し、
グリフのアウトライン残存と CID/ToUnicode の一致を検証している。
フォント周りを触ったら、**必ずビューアで実際の描画を目視する**（`pdftoppm` で PNG 化 → 確認）。

### 4. フォント未収録文字は無警告で空白になる

`.notdef` が埋め込まれるだけでエラーにならない（例: ✔ U+2714 は Noto Sans JP に無い）。
`onMissingGlyph`（既定 `error`）でガードしている。既定を緩めないこと。

### 5. PDF/UA の受け入れ基準は veraPDF で測る

タグ付き PDF（B-1）に着手するときは、**pdf-verify-mcp の `validate_conformance`
（`flavour: "pdfua-1"`）を受け入れ基準にする**。開発環境には veraPDF が導入済みで、
106 規則の権威ある判定が返る。verify のネイティブ 12 規則は pdf-lib で届く範囲に限定されており、
コンテンツストリーム解析が要る要件（7.1-3 / 7.2-34 / 7.18.1-1 / 7.18.3-1）は検出できない。
**native 通過は必要条件にすぎない。** 実装項目の一覧は `docs/TASKS.md` の B-1 の表にある。

> 補足: 7.18.1-1「注釈は Annot タグで包む」より、v0.4.0 の `add_annotation` は
> タグ付き PDF では単体では不十分。B-1 で構造木への接続が必要になる。

### 6. 編集は署名を壊す（増分更新を除く）

pdf-lib の `save()` はファイル全体を再構築するため、既存署名は必ず無効化される。
`/ByteRange` 検知時は既定でエラー（`allowBreakingSignatures` で明示的に続行）。
**`preserveSignatures: true` で増分更新（末尾追記）に対応**し、署名を保持したまま編集できる
（ADR-11 / `services/incremental.ts`）。対応: **文書に追加する編集ツールすべて**
（add_annotation（タグ付き可）/ set_metadata / add_bookmarks / tag_form_fields /
ensure_tagged / attach_file / stamp_page_numbers / add_watermark）。
dirty 追跡は 3 形態: 構造木（struct-append / tagWidgets の `dirtiedRefs`）、
ページ内容（`pageContentDirtyRefs`）、名前ツリー（`catalogNamesDirtyRefs`）。
DocMDP の許可レベル検査（`assertDocMdpAllows`: 注釈 = P=3 のみ / メタデータ・しおり・
構造タグ付け = 全レベル不可）を必ず通すこと。
**タグ付き文書の増分は dirty 追跡が命**: struct-append / tagWidgets が返す `dirtiedRefs` を
必ず増分の dirtyRefs に合成する。構造木を触る処理を追加したら dirtiedRefs の報告も足すこと
（漏れると増分後の構造木が壊れる — `tagged-incremental.test.ts` が回帰ガード）。

### 7. 増分更新の採番は trailer /Size から予約する（v0.9.0）

pdf-lib は**オブジェクトストリームの容器と旧 xref ストリームを indirect object として
登録しない**ため、`useObjectStreams` なファイルでは `largestObjectNumber` が実際より小さい。
そのまま `register()` すると新規オブジェクトが容器と同じ番号を再利用し、/Prev 連鎖上で
「圧縮ストリーム」⇔「注釈辞書」が衝突して qpdf が
`supposed object stream N is not a stream` を出す（実測）。増分更新の前に必ず
`reserveExistingObjectNumbers()`（有効な trailer の /Size を読む）を通すこと。
`incremental.test.ts` の番号衝突回帰ガードを弱めないこと。

### 8. `copyPages()` は catalog を運ばない（B-10a・2026-07-18）

pdf-lib の `copyPages()` が複製するのは**ページツリー配下だけ**。catalog の文書レベル
エントリ（ISO 32000-2 Table 29）は 1 つも運ばれず、`copyDocumentInfo` が Info 辞書を
引き継いでいたので**気づきにくい**。ページ複製で新規文書を作る 5 ツール
（merge / split / extract / delete / reorder）が該当する（rotate は in-place なので無傷）。

タグ無し PDF になること自体は合法なので **veraPDF は何も言わない**（出力しか見ないため）。
入出力を比べないと分からず、実際 v0.12.0 まで誰も比べていなかった。

- 現状は `services/doc-level.ts` が**失われたものを warnings で報告**する（引き継ぎは B-10b/c）。
  判定は**出力の実測**なので、引き継ぎを実装すれば警告は自動で消える。この設計を
  「copyPages は落とす」という決め打ちに書き換えないこと
- `/OCProperties` だけは損失ではなく**仕様違反**になりうる（§8.11.4.2 の shall）。
  複製ページの OC 使用を実測して判定している
- **ページ複製系にツールを足すときは `saveWithDocLevelWarnings` を通すこと**

## テスト

```bash
npm test                                          # 標準フォント分のみ（フォント依存は skip）
TEST_FONT_PATH=/path/NotoSansJP-Regular.otf npm test  # 全件
```

**テストを追加したら必ず両モードで実行すること。** 日本語を「描画」するテスト
（create 系・タグ付き生成）はフォント必須なので `describe.skipIf(!fontPath)` に入れるか、
描画部分を ASCII にする（メタデータ・しおり・注釈 contents は描画されないため日本語可）。
TEST_FONT_PATH 付きでしか回さないと、フォント無し環境（素の `npm test`）での
FONT_REQUIRED 落ちを見逃す（v0.10.0 開発時に実際に起きた）。

25 ファイル。特に重要なもの:

| ファイル | 対象 |
|----------|------|
| `registry.test.ts` | **外部仕様のスナップショット**（19 ツールの名前・必須フィールド・annotations。InMemoryTransport 経由） |
| `render.test.ts` | **描画実体**（グリフのアウトライン・CID/ToUnicode 一致） |
| `extract.test.ts` | ToUnicode（抽出可能性） |
| `validation.test.ts` | Zod スキーマ検査（パス検査・上限値含む） |
| `errors.test.ts` | 構造化エラー（code / next_actions / retryable） |
| `deterministic.test.ts` | SOURCE_DATE_EPOCH の再現性 |
| `layout.test.ts` / `generate.test.ts` / `glyph.test.ts` | 折り返し / 生成 3 ツール / onMissingGlyph |
| `editor.test.ts` / `page-spec.test.ts` | 編集・署名ガード / ページ指定パーサ |
| `tagged.test.ts` / `struct-append.test.ts` / `outline-annotation.test.ts` | PDF/UA 構造木（構築 / 追記）・しおり・注釈 |
| `attachment.test.ts` / `watermark.test.ts` / `page-number.test.ts` / `form.test.ts` | Tier B（Artifact 化・宙吊り参照の掃除を含む） |
| `form-tagging.test.ts` | `tag_form_fields`（Form 内包・/Tabs・/TU・冪等性） |
| `incremental.test.ts` | **増分更新**（前方バイト同一性・両 xref 形式・番号衝突回帰・重ね掛け） |
| `spec-audit.test.ts` | **条文照合の回帰**（/AP 生成・/Count 可視数・名前ツリーソート・決定論。docs/SPEC-AUDIT.md 対応） |
| `doc-level.test.ts` | **B-10a**（ページ複製で失われた文書レベル要素の報告・rotate は無傷・OCProperties の shall 違反判定） |
| `preserve-v10.test.ts` | preserveSignatures の展開（set_metadata / add_bookmarks・trailer 全引き継ぎ・XMP 同期・DocMDP 拒否） |
| `tagged-incremental.test.ts` | **タグ付き文書の増分**（dirty 追跡・ParentTree 連番・tag_form_fields 保持・DocMDP 構造拒否） |
| `ensure-tagged.test.ts` | `ensure_tagged`（構造木新設・BDC/EMC の包み・温存の冪等性・正直な警告）+ attach/stamp/watermark の増分 |

テスト用フォントは [notofonts/noto-cjk の SubsetOTF/JP](https://github.com/notofonts/noto-cjk/tree/main/Sans/SubsetOTF/JP)（単一フェイス・SIL OFL）。
`.ttc` は非対応なので OS 同梱フォントは使えない。

## リリース

1. `package.json` の version を上げる
2. `CHANGELOG.md` に追記（英語）
3. `docs/DESIGN.md` ヘッダのバージョン行を同期する（放置すると family 側文書が旧版数を参照する）
4. コミット → push
5. `git tag vX.Y.Z && git push origin vX.Y.Z` → `publish.yml` が Trusted Publisher (OIDC) で公開

タグと `package.json` の version が一致しないと publish workflow が停止する。

## ドキュメント方針

- `README.md` = **英語**（メイン）、`README.ja.md` = 日本語。両者を同時に更新する
- `CHANGELOG.md` = 英語。バグ修正は**症状・原因・なぜ検知できなかったか**まで書く
- `docs/DESIGN.md` = 日本語。判断は ADR として残し、**誤りが判明したら訂正して経緯も残す**
  （§10 の「poppler 警告は無害」は誤りだったため v0.3.0 で訂正済み）
