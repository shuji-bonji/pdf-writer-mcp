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

共通オプション: `outputPath` / `returnBase64` / `fontPath` / `fontSize` / `pageSize`（A4/A3/A5/LETTER/LEGAL）/ `margin` / `title` / `author` / `onMissingGlyph`。

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

共通オプション: `outputPath` / `returnBase64` / `allowBreakingSignatures`。

ページ指定は `"1,3-5,8-"` 形式（1 始まり。`-3` は先頭から 3 ページまで、`8-` は 8 ページから最終まで）。指定順を保持し、重複は除去します。

> **署名について**: pdf-lib は保存時にファイル全体を再構築するため、編集すると既存の電子署名は必ず無効化されます。`/ByteRange` を含む PDF は既定でエラーとし、`allowBreakingSignatures: true` を指定したときのみ続行します。署名を保持する増分更新はロードマップ参照。

## インストール

```json
{
  "mcpServers": {
    "pdf-writer": {
      "command": "npx",
      "args": ["-y", "@shuji-bonji/pdf-writer-mcp"],
      "env": {
        "PDF_WRITER_FONT": "/absolute/path/to/NotoSansJP-Regular.otf"
      }
    }
  }
}
```

`PDF_WRITER_FONT` を設定しておくと、各ツールで `fontPath` を省略しても日本語が出せます。

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
- [ ] 編集系 Tier A 第2波 — しおり・注釈
- [ ] 編集系 Tier B — フォーム記入 / フラット化、透かし、添付ファイル、ページ番号スタンプ
- [ ] タグ付き PDF / PDF/UA（スクリーンリーダ向けの構造タグ）
- [ ] `.ttc` からのフェイス自動抽出
- [ ] 見出し用と本文用のフォント分け（太字フェイス埋め込み）
- [ ] 画像埋め込み、ヘッダー / フッター
- [ ] Tier C — 署名を保持する増分更新、本文テキスト編集、タグ木の保守
- [ ] PDF/A 変換

## ライセンス

MIT © shuji-bonji
