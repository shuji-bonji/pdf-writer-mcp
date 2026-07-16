# pdf-writer-mcp

[![CI](https://github.com/shuji-bonji/pdf-writer-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/shuji-bonji/pdf-writer-mcp/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@shuji-bonji/pdf-writer-mcp.svg)](https://www.npmjs.com/package/@shuji-bonji/pdf-writer-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

[English](./README.md)

テキスト / Markdown / 表データからの **PDF 生成** と、既存 PDF の **編集**（メタデータ・ページ操作）を行う MCP (Model Context Protocol) サーバです。[pdf-lib](https://pdf-lib.js.org/) をコアに、harfbuzz サブセットによる日本語フォント埋め込みに対応します。

[pdf-reader-mcp](https://github.com/shuji-bonji/pdf-reader-mcp)（構造解析）、[pdf-verify-mcp](https://github.com/shuji-bonji/pdf-verify-mcp)（真正性検証）と同じ PDF family の一員です。`pdf-reader-mcp` が「何があるか」を読み、`pdf-verify-mcp` が「本物か」を検証するのに対し、`pdf-writer-mcp` は「それを書く」役割を担います。

## ツール

### 生成

| ツール | 役割 |
|--------|------|
| `create_text_pdf` | プレーンテキスト — `\n` で改行、空行で段落区切り、長い行は自動折り返し |
| `create_markdown_pdf` | Markdown — 見出し / 段落 / 箇条書き・番号リスト / コードブロック / 引用 / 水平線 / 表 |
| `create_table_pdf` | 罫線付き表 — 列幅の自動算出、セル内折り返し、改ページ時のヘッダ再描画 |

共通オプション: `outputPath` / `returnBase64` / `fontPath` / `fontSize` / `pageSize`（A4/A3/A5/LETTER/LEGAL）/ `margin` / `title` / `author` / `onMissingGlyph` / `tagged` / `lang`。

### タグ付き PDF / PDF/UA（v0.5.0）

`tagged: true` を指定すると、**PDF/UA-1（ISO 14289）準拠のタグ付き PDF**（アクセシブルな PDF）を生成します。veraPDF（`--flavour ua1`）で 106/106 規則の準拠を確認済みです。

```jsonc
{ "markdown": "# 見出し\n\n本文。", "title": "レポート", "tagged": true, "lang": "ja" }
```

Markdown は構造木に対応付けられます。見出し → `H1`〜`H6`、リスト → `L`/`LI`/`LBody`、表 → `Table`/`TR`/`TH`/`TD`（ヘッダには `/Scope`）、引用 → `BlockQuote`、コード → `Code`。水平線・罫線・コード背景は Artifact になります。見出しレベルは「H1 始まり・飛ばさない」よう正規化されるため、Markdown の `# → ###` は構造上 `H1 → H2` になります（見た目のサイズは元のままです）。

PDF/UA はタイトルを要求するため、`tagged: true` では `title` が必須です。`lang`（BCP 47）は省略すると本文から推定し、`warnings` で報告します。**誤った `/Lang` はスクリーンリーダの誤読を招く**ため、分かっている場合は明示してください。

> タグ付けは opt-in です（既定の出力は変わりません）。機械検証は「読み順や代替テキストが**適切か**」までは判定できず、存在の有無しか見られません。人手の確認は依然として必要です。

### 編集

| ツール | 役割 |
|--------|------|
| `set_metadata` | Info 辞書の更新（`title` / `author` / `subject` / `keywords` / `creator`）。指定フィールドのみ変更し、他は保持 |
| `merge_pdfs` | 2〜50 個の PDF を指定順に結合。メタデータは先頭ファイルから引き継ぎ |
| `split_pdf` | ページ範囲ごとに 1 ファイルへ分割 |
| `extract_pages` | 指定順を保持して抽出（並べ替えを兼ねる） |
| `delete_pages` | ページ削除（全ページの削除はエラー） |
| `reorder_pages` | 全ページの順列による並べ替え |
| `rotate_pages` | 時計回りに回転（90/180/270）。既存の回転に加算 |
| `add_bookmarks` | しおり（アウトライン）の設定。`children` で入れ子にでき、既存のしおりは置換 |
| `add_annotation` | 付箋（`text`）/ ハイライト（`highlight`）/ 矩形（`square`）の注釈を追加。タグ付き PDF では `Annot` 構造要素に内包され PDF/UA 準拠を維持する（`alt` で説明を渡す） |
| `attach_file` | ファイルを埋め込む（`/Names /EmbeddedFiles` + catalog `/AF` + `/AFRelationship`）。PDF/A-3 が要求する形式で、機械可読データを文書に同梱する |
| `stamp_page_numbers` | ページ番号を刻む（`{n}` / `{total}`、6 箇所の配置、`pages`、`startAt`）。タグ付き PDF では Artifact になるため準拠を維持する |

共通オプション: `outputPath` / `returnBase64` / `allowBreakingSignatures`。

ページ指定は `"1,3-5,8-"` 形式（1 始まり。`-3` は先頭から 3 ページまで、`8-` は 8 ページから最終まで）。指定順を保持し、重複は除去します。

> **署名について**: pdf-lib は保存時にファイル全体を再構築するため、編集すると既存の電子署名は必ず無効化されます。`/ByteRange` を含む PDF は既定でエラーとし、`allowBreakingSignatures: true` を指定したときのみ続行します。署名を保持する増分更新はロードマップ参照。

## インストール

```json
{
  "mcpServers": {
    "pdf-writer": {
      "command": "npx",
      "args": ["-y", "@shuji-bonji/pdf-writer-mcp@latest"],
      "env": {
        "PDF_WRITER_FONT": "/absolute/path/to/NotoSansJP-Regular.otf"
      }
    }
  }
}
```

`PDF_WRITER_FONT` を設定しておくと、各ツールで `fontPath` を省略しても日本語が出せます。

> **`@latest` を付ける（またはバージョンを固定する）ことを推奨します。** バージョン指定なしの `npx -y <pkg>` は、**最初にキャッシュした版を使い続けます**（`-y` はインストール確認を省くだけで、更新確認はしません）。数か月前の版が動き続けることもあります。`@latest` にすると起動のたびにレジストリを確認します。再現性を優先するなら `@0.5.0` のように固定してください。キャッシュを消すには `rm -rf ~/.npm/_npx`。

## フォント

標準 PDF フォント（Helvetica）は **ASCII のみ** です。日本語など非ラテン文字を描画するには、`fontPath` または `PDF_WRITER_FONT` で埋め込み可能な**単一フェイス**のフォント（`.ttf` / `.otf`）を指定してください。

- 推奨入手先: [Noto Sans JP (SubsetOTF/JP)](https://github.com/notofonts/noto-cjk/tree/main/Sans/SubsetOTF/JP) — 静的・単一フェイス・SIL OFL。
- **`.ttc`（TrueTypeCollection）は非対応**です。検知してエラーにするため、単一フェイスを抽出してください:

  ```bash
  python3 -c "from fontTools.ttLib import TTCollection; \
    TTCollection('NotoSansCJK-Regular.ttc').fonts[0].save('NotoSansCJKjp-Regular.otf')"
  ```

### フォント未収録文字（グリフ欠落）

フォントに存在しない文字（例: Noto Sans JP に無い ✔ U+2714）は、そのままだと `.notdef` として埋め込まれ、無警告で空白になります。`onMissingGlyph` でこの挙動を選べます。

| 値 | 挙動 |
|----|------|
| `error`（既定） | 欠落文字を `"✔" (U+2714)` 形式で列挙してエラー |
| `replace` | 〓 に置換して生成し、`warnings` で報告 |
| `ignore` | 空白のまま生成し、`warnings` で報告 |

## 返り値

```jsonc
{
  "path": "/abs/out.pdf",     // outputPath 指定時
  "base64": "JVBERi0xLj...",  // returnBase64 指定時、または outputPath 省略時
  "pageCount": 3,
  "bytes": 91788,
  "font": "NotoSansJP-Regular.otf",
  "warnings": ["Replaced 1 unsupported character(s) with \"〓\": \"✔\" (U+2714)"]
}
```

編集ツールは `font` を除いた同じ形を返します。`split_pdf` は `{ files: [...], count }` を返します。

## テキスト抽出

生成される PDF はテキストの選択・コピー・全文検索・スクリーンリーダ読み上げが可能です。埋め込みサブセットフォントでも pdf-lib が ToUnicode CMap を出力するためで、この性質は回帰テスト（`extract.test.ts` / `render.test.ts`）で担保しています。

> poppler 系のビューアは、OTF/CFF フォントを CIDFontType0 として埋め込む際に `Mismatch between font type and embedded font file` という警告を表示することがあります。これは無害で、描画・抽出とも正常です。

## 開発

```bash
npm install
npm run build      # dist/ に出力
npm test           # vitest
npm run typecheck  # tsc --noEmit
```

日本語フォント依存のテストは `TEST_FONT_PATH` を指定すると有効になります。

```bash
TEST_FONT_PATH=/path/to/NotoSansJP-Regular.otf npm test
```

## 既知の制約

- **インライン装飾**: 太字・斜体はサイズ / 字面のみで、書体としては反映されません（1 文書につき単一フォントを埋め込むため）。
- **`.ttc` フォント**: 単一フェイスへの抽出が必要です（上記参照）。
- **サブセット名の接頭辞**: 慣習的な `ABCDEF+` を付けないため、一部ツールがサブセットでないと誤認します。描画・抽出には影響せず、PDF/A の厳密対応時のみ問題になります。

## ロードマップ

- [x] 編集系 Tier A 第1波 — メタデータ・ページ操作（v0.2.0）
- [x] 編集系 Tier A 第2波 — しおり・注釈（v0.4.0）
- [x] タグ付き PDF / PDF/UA-1 — veraPDF で準拠を確認（v0.5.0）
- [x] タグ付き出力での注釈の `Annot` タグ内包（v0.5.1）
- [x] 編集系 Tier B — 添付ファイル（v0.6.0）
- [ ] 編集系 Tier B — フォーム記入 / フラット化、透かし、ページ番号スタンプ
- [ ] 画像の代替テキスト（`Figure` + `/Alt`）
- [ ] `.ttc` からのフェイス自動抽出
- [ ] 見出し用と本文用のフォント分け（太字フェイス埋め込み）
- [ ] 画像埋め込み、ヘッダー / フッター
- [ ] Tier C — 署名を保持する増分更新、本文テキスト編集、タグ木の保守
- [ ] PDF/A 変換

## ライセンス

MIT © shuji-bonji
