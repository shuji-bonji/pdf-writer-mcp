# pdf-writer-mcp - 開発ガイド

## プロジェクト概要

テキスト / Markdown / 表データから **PDF を生成**し、既存 PDF を**編集**する MCP サーバ。
PDF family（[reader](https://github.com/shuji-bonji/pdf-reader-mcp) = 何があるか / [verify](https://github.com/shuji-bonji/pdf-verify-mcp) = 本物か / [spec](https://github.com/shuji-bonji/pdf-spec-mcp) = 仕様は何を要求するか）における「**書く**」担当。

- 設計書: [`docs/DESIGN.md`](./docs/DESIGN.md)（ADR とフォント戦略の実測データは必読）
- 残タスク: [`docs/TASKS.md`](./docs/TASKS.md)
- 上位仕様: `Document-Note/mcps/PDFfamily/specs/05-pdf-writer-mcp.md`（Tier A/B/C 体系）
- 責務分担の提案: `mcps/pdf-family-role-architecture.md`

## ツール一覧

| ツール | 説明 |
|--------|------|
| `create_text_pdf` | プレーンテキスト → PDF |
| `create_markdown_pdf` | Markdown → PDF（見出し/リスト/コード/引用/水平線/表） |
| `create_table_pdf` | 表データ → 罫線付き PDF |
| `set_metadata` | Info 辞書の更新（指定フィールドのみ） |
| `merge_pdfs` / `split_pdf` | 結合 / 分割 |
| `extract_pages` / `delete_pages` / `reorder_pages` / `rotate_pages` | ページ操作 |

## アーキテクチャの要点

生成系と編集系は**並列の系統**であり、共通化されていない。

```
生成: handler → validation → builder → openFont → glyph policy → embedFontFor → LayoutEngine → renderers → finalizePdf
編集: handler → validation → editor  → loadForEdit（署名ガード）→ ページ操作 → saveEdited
```

- `index.ts` は薄いディスパッチャ。`try/catch` を一元化し `isError:true` に整形する
- ハンドラは例外を **throw** する（`{error}` を返さない）
- ツール追加は `tools/definitions.ts` にスキーマ、`tools/handlers.ts` の `toolHandlers` Map に 1 行
- 閾値・上限は `constants.ts` に集約（`shuji-mcp-patterns` スキルの鉄則に準拠）
- `console.log` 禁止（stdio 汚染）。ログは `utils/logger.ts` 経由で stderr へ

## 落とし穴（過去に踏んだもの・再発させないこと）

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

### 5. 編集は署名を壊す

pdf-lib の `save()` はファイル全体を再構築するため、既存署名は必ず無効化される。
`/ByteRange` 検知時は既定でエラー（`allowBreakingSignatures` で明示的に続行）。
署名を保持する増分更新は Tier C の課題。

## テスト

```bash
npm test                                          # 標準フォント分のみ（フォント依存は skip）
TEST_FONT_PATH=/path/NotoSansJP-Regular.otf npm test  # 全 90 件
```

| ファイル | 対象 |
|----------|------|
| `validation.test.ts` | 入力検査 |
| `layout.test.ts` | 折り返し（CJK / 長語分割） |
| `generate.test.ts` | 生成 3 ツール |
| `extract.test.ts` | ToUnicode（抽出可能性） |
| `render.test.ts` | **描画実体**（グリフのアウトライン・CID/ToUnicode 一致） |
| `glyph.test.ts` | `onMissingGlyph` の 3 ポリシー |
| `editor.test.ts` | 編集 7 ツール・署名ガード |
| `page-spec.test.ts` | `"1,3-5,8-"` パーサ |

テスト用フォントは [notofonts/noto-cjk の SubsetOTF/JP](https://github.com/notofonts/noto-cjk/tree/main/Sans/SubsetOTF/JP)（単一フェイス・SIL OFL）。
`.ttc` は非対応なので OS 同梱フォントは使えない。

## リリース

1. `package.json` の version を上げる
2. `CHANGELOG.md` に追記（英語）
3. コミット → push
4. `git tag vX.Y.Z && git push origin vX.Y.Z` → `publish.yml` が Trusted Publisher (OIDC) で公開

タグと `package.json` の version が一致しないと publish workflow が停止する。

## ドキュメント方針

- `README.md` = **英語**（メイン）、`README.ja.md` = 日本語。両者を同時に更新する
- `CHANGELOG.md` = 英語。バグ修正は**症状・原因・なぜ検知できなかったか**まで書く
- `docs/DESIGN.md` = 日本語。判断は ADR として残し、**誤りが判明したら訂正して経緯も残す**
  （§10 の「poppler 警告は無害」は誤りだったため v0.3.0 で訂正済み）
