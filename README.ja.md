# pdf-writer-mcp

[![CI](https://github.com/shuji-bonji/pdf-writer-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/shuji-bonji/pdf-writer-mcp/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@shuji-bonji/pdf-writer-mcp.svg)](https://www.npmjs.com/package/@shuji-bonji/pdf-writer-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

[English](./README.md)

テキスト / Markdown / 表データからの **PDF 生成** と、既存 PDF の **編集**（メタデータ・ページ操作）を行う MCP (Model Context Protocol) サーバです。すべての振る舞いを ISO 32000 の条項に紐づけたライブラリ [normativepdf](https://github.com/shuji-bonji/normativepdf) をコアに、harfbuzz サブセットによる日本語フォント埋め込みに対応します。

[pdf-reader-mcp](https://github.com/shuji-bonji/pdf-reader-mcp)（構造解析）、[pdf-verify-mcp](https://github.com/shuji-bonji/pdf-verify-mcp)（真正性検証）と同じ PDF family の一員です。`pdf-reader-mcp` が「何があるか」を読み、`pdf-verify-mcp` が「本物か」を検証するのに対し、`pdf-writer-mcp` は「それを書く」役割を担います。

## ツール

> [!IMPORTANT]
> **ファイルパスはすべて絶対パスで指定してください**（v0.7.0〜）。相対パスと `..` を含むパスは拒否されます — 相対パスは MCP ホストの作業ディレクトリ基準で解決されるため、意図しない場所を指します。対象は `inputPath` / `inputPaths` / `outputPath` / `outputDir` / `fontPath` / `attachmentPath`。100MB を超える入力 PDF も拒否されます。

### 生成

| ツール | 役割 |
|--------|------|
| `create_text_pdf` | プレーンテキスト — `\n` で改行、空行で段落区切り、長い行は自動折り返し |
| `create_markdown_pdf` | Markdown — 見出し / 段落 / 箇条書き・番号リスト / コードブロック / 引用 / 水平線 / 表 |
| `create_table_pdf` | 罫線付き表 — 列幅の自動算出、セル内折り返し、改ページ時のヘッダ再描画 |

共通オプション: `outputPath` / `returnBase64` / `fontPath` / `fontSize` / `pageSize`（A4/A3/A5/LETTER/LEGAL）/ `margin` / `title` / `drawTitle` / `author` / `onMissingGlyph` / `tagged` / `lang` / `pdfVersion`。

### PDF 2.0 出力（v0.16.0）

`pdfVersion: "2.0"` を指定すると ISO 32000-2 の文書を書きます。既定は `"1.7"` のままで、そのバイト列は変わりません。

**版はヘッダだけの話ではありません。** ISO 32000-2 は版そのものに 2 つの義務を紐づけており、両方を満たします。

- **trailer `/ID` が Required** になります（Table 15）。初回書き込みでは 2 要素が同値（R-14.4-6）で、`SOURCE_DATE_EPOCH` 下では決定論的です。
- **Info 辞書は `CreationDate` / `ModDate` だけ**になります（§14.3.3）。タイトル・作成者・Producer は、PDF 2.0 が「文書メタデータの置き場所」とする XMP メタデータストリームへ移ります。

```jsonc
{ "text": "本文。", "title": "レポート", "pdfVersion": "2.0" }
```

`tagged: true` と一緒に渡すと、2.0 の文書は PDF/UA-1 ではなく **PDF/UA-2**（ISO 14289-2）を宣言します。PDF/UA-1 は版を 1.0〜1.7 に限るためです（ISO 14289-1 §6.1）。下の [PDF/UA-2](#pdfua-2v0270) を参照してください。v0.26.x までは、この組み合わせをエラーにしていました。

### タグ付き PDF / PDF/UA（v0.5.0）

`tagged: true` を指定すると、**PDF/UA-1（ISO 14289）準拠のタグ付き PDF**（アクセシブルな PDF）を生成します。veraPDF（`--flavour ua1`）で 106/106 規則の準拠を確認済みです。

```jsonc
{ "markdown": "# 見出し\n\n本文。", "title": "レポート", "tagged": true, "lang": "ja" }
```

Markdown は構造木に対応付けられます。見出し → `H1`〜`H6`、リスト → `L`/`LI`/`LBody`、表 → `Table`/`TR`/`TH`/`TD`（ヘッダには `/Scope`）、引用 → `BlockQuote`、コード → `Code`。水平線・罫線・コード背景は Artifact になります。PDF/UA-1 では見出しレベルを「H1 始まり・飛ばさない」よう正規化するため、Markdown の `# → ###` は構造上 `H1 → H2` になります（見た目のサイズは元のままです。PDF/UA-2 では書いた段のままにします。下を参照）。

PDF/UA はタイトルを要求するため、`tagged: true` では `title` が必須です。`title` は必ずメタデータ（`dc:title`）に書き、既定では本文の最初の `H1` としても描きます。Markdown が自前の `# …` で始まるときは `drawTitle: false` を渡してください。題名はメタデータにだけ入り、本文の最初の見出しが `H1` になります（`## → ###` は `H1 → H2`）。この形でも PDF/UA-1 に適合します（veraPDF 106/106）。`lang`（BCP 47）は省略すると本文から推定し、`warnings` で報告します。**誤った `/Lang` はスクリーンリーダの誤読を招く**ため、分かっている場合は明示してください。

> [!NOTE]
> タグ付けは opt-in です — 既定の出力は変わりません。
>
> 機械検証（veraPDF）が見られるのは**存在の有無**までです。読み順や代替テキストが「適切か」は判定できないため、人手の確認は依然として必要です。

#### PDF/UA-2（v0.27.0）

`tagged: true` に `pdfVersion: "2.0"` を足すと、PDF 2.0 の **PDF/UA-2（ISO 14289-2:2024）** として書きます。既定（1.7・PDF/UA-1）の出力は変わりません。

```jsonc
{ "markdown": "# Title\n\nBody.", "title": "Report", "tagged": true, "pdfVersion": "2.0", "lang": "ja" }
```

PDF/UA-1 の出力との違いと、その根拠の条文です。

| | PDF/UA-1（1.7） | PDF/UA-2（2.0） |
|---|---|---|
| XMP の宣言（§5） | `pdfuaid:part` 1 | `pdfuaid:part` 2 と `pdfuaid:rev` 2024 |
| 名前空間（§8.2.4・§8.2.5.2） | 書かない（既定の PDF 1.7 の名前空間） | `Document` と、PDF 2.0 の名前空間にある型の要素に `/NS`（`http://iso.org/pdf2/ssn`）を付けます。その名前空間に無い `BlockQuote` と `Code` は PDF 1.7 の名前空間のままです |
| 描く題名（§8.2.5.13） | 最初の `H1` | `Title`（見出しにしない） |
| Markdown の見出し（§8.2.5.12） | H1 から始め、段を飛ばさないよう正規化 | 書いた段のまま（`#` → `H1`、`###` → `H3`） |
| 入れ子のリスト | 親の項目の `LBody` の中 | 親の `L` の直接の子で、親の項目の直後（ISO 32000-2 §14.8.4.8.2） |

veraPDF 1.30.0（`pdfua-2`、1,728 規則）で、生成 3 ツールの出力、タグの無い PDF 2.0 に `ensure_tagged` を掛けた出力、PDF/UA-2 の文書に `ensure_pdfa(flavour: "pdfa-4")` を掛けた出力のどれも適合と判定されました。最後のものは PDF/A-4 でも適合です（109/109）。

編集しても宣言は残ります。XMP を作り直すツールは `pdfuaid:rev` を `pdfuaid:part` と一緒に引き継ぎ、Info 辞書に `Title` が無ければ `dc:title` を引き継ぎます（PDF 2.0 の出力は Info に `Title` を置きません）。`add_bookmarks` は、PDF/UA-2 の文書では §8.8 のとおり structure destination で書きます。GoTo アクションの `SD` に、指したページで始まる構造要素を書き、`SD` を読まないビューアのために `D` にページの行き先を残します。構造要素の内容が無いページはページの行き先のまま書き、`warnings` で名指します。

### 版と宣言

編集の出力は入力の版のままです。版を変えるのは明示した変換だけで、`ensure_pdfa` の `flavour: "pdfa-4"`・`"pdfa-4f"`（PDF 2.0 にします）と、`merge_pdfs` の `pdfVersion` です。版を下げることはしません。

- 出力の版や、ファイルが宣言している規格の shall に反するものは `INVALID_ARGUMENT` で断ります。エラーの文に入力の版と宣言を書き、`next_actions` で合う呼び方を示します。例: PDF 2.0 と PDF 1.x の入力を `pdfVersion` なしで渡した `merge_pdfs`、PDF 2.0 の入力への `ensure_pdfa(flavour: "pdfa-3b")`（PDF/A-3 はヘッダーが `%PDF-1.n` でなければなりません）。
- 出力の版で非推奨の書き方は、その版の書き方で書きます。PDF 2.0 の入力への `set_metadata` は XMP に書き、Info に項目を足しません（ISO 32000-2 §14.3.3）。PDF/UA-2 の入力では、既存の Info の項目を XMP に移してから消します（ISO 14289-2 §6.2）。
- 規格が許す混在は書いて、結果で伝えます。PDF/UA-2 のファイルに `add_annotation`・`tag_form_fields` が足す構造要素には `/NS` が無く、PDF 1.7 の名前空間に入ります（§8.2.4 は許します）。そのことを `warnings` に書きます。

どのツールの結果にも、書いたファイルから読み戻した `output` があります。

```json
{ "output": { "pdfVersion": "2.0", "declares": { "pdfua": 2, "pdfa": "4" } } }
```

`declares.pdfua` は `pdfuaid:part`、`declares.pdfa` は `pdfaid:part` と `pdfaid:conformance` をつないだもの（`"3b"`・`"4"`・`"4f"`）です。宣言が無い規格のキーは置きません。宣言は自称なので、pdf-verify-mcp で測ってください。

XMP を書き直すツール（`set_metadata`・`ensure_pdfa`）は、渡されなかった値を書かれていたとおりに運びます。`dc:title` のほかの言語の項目、`dc:creator` の全員、このサーバが知らない名前空間の値が残ります。`title` を変えると `x-default` の項目を書き換え、ほかの言語を `warnings` で名指します。

### 編集 — ページ操作

| ツール | 役割 |
|--------|------|
| `merge_pdfs` | 2〜50 個の PDF を指定順に結合。メタデータは先頭ファイルから引き継ぎ。PDF 2.0 と PDF 1.x が混ざる入力には `pdfVersion: "2.0"` が要ります |
| `split_pdf` | ページ範囲ごとに 1 ファイルへ分割 |
| `extract_pages` | 指定順を保持して抽出（並べ替えを兼ねる） |
| `delete_pages` | ページ削除（全ページの削除はエラー） |
| `reorder_pages` | 全ページの順列による並べ替え |
| `rotate_pages` | 時計回りに回転（90/180/270）。既存の回転に加算。in-place なので下の注意は該当しない |

> [!WARNING]
> **`rotate_pages` 以外の 5 ツールは、ページから文書を組み直します。**
>
> - 引き継ぐもの: 添付（`/Names /EmbeddedFiles`・`/AF`）・`/Lang`・`/ViewerPreferences`・`/OutputIntents`
> - 引き継がないもの: タグ付き構造木・XMP・ページ番号やページ参照に依存するもの（しおり・ページラベル・名前付き宛先）
> - 失われたものは必ず `warnings` で報告します — 黙って消えることはありません

ページ指定は `"1,3-5,8-"` 形式（1 始まり。`-3` は先頭から 3 ページまで、`8-` は 8 ページから最終まで）。指定順を保持し、重複は除去します。

### 編集 — 文書への追加・修復

| ツール | 役割 |
|--------|------|
| `set_metadata` | Info 辞書の更新（`title` / `author` / `subject` / `keywords` / `creator`）。指定フィールドのみ変更。XMP を持つ文書では `dc:title` 等も同期する（PDF/UA・PDF/A 宣言は保持）。`tdmReservation`（0 \| 1）と `tdmPolicy` で W3C **TDMRep** の権利表明を XMP に書く（`tdm:reservation` / `tdm:policy`、名前空間 `http://www.w3.org/ns/tdmrep/`）。XMP の無い文書には XMP を新設し、PDF/A 文書では `pdfaExtension:schemas` にスキーマの記述も同梱するので、veraPDF が ISO 19005-2 6.6.2.3 で落とさない（v0.22.0） |
| `add_bookmarks` | しおり（アウトライン）の設定。`children` で入れ子にでき、既存のしおりは置換 |
| `add_annotation` | 付箋（`text`）/ ハイライト（`highlight`）/ 矩形（`square`）の注釈を追加。タグ付き PDF では `Annot` 構造要素に内包して PDF/UA 準拠を維持（`alt` で説明を渡す） |
| `attach_file` | ファイルを埋め込む（`/Names /EmbeddedFiles` + catalog `/AF` + `/AFRelationship`）。PDF/A-3 が要求する形式 |
| `stamp_page_numbers` | ページ番号を刻む（`{n}` / `{total}`、6 箇所の配置、`pages`、`startAt`）。タグ付き PDF では Artifact になり準拠を維持 |
| `fill_form` | AcroForm に値を記入。日本語は埋め込みフォントで描画。同時にフラット化も可能 |
| `flatten_form` | フォームを静的な内容に焼き込む。タグ付き PDF は既定で拒否（PDF/UA が壊れるため） |
| `tag_form_fields` | タグ付き PDF 内のフォームを PDF/UA-1 準拠へ修復（Widget を `Form` に内包・`/Tabs S`・代替名 `/TU`。`labels` で人間可読名）。冪等 |
| `ensure_tagged` | 既存 PDF を PDF/UA-1 の「器」に載せる → [タグ無し PDF への足場作り](#タグ無し-pdf-への足場作りensure_tagged) |
| `ensure_pdfa` | 既存 PDF を **PDF/A-3b / PDF/A-4 / PDF/A-4f** の「器」に載せる（`flavour`） → [長期保存の器](#長期保存の器ensure_pdfa) |
| `add_watermark` | 斜めの透かしを重ねる（"社外秘" / "DRAFT"）。既定で本文の背面。タグ付き PDF では Artifact になる |

共通オプション: `outputPath` / `returnBase64` / `allowBreakingSignatures`。

> [!IMPORTANT]
> **署名済み PDF の編集**: 通常の保存はファイル全体を書き直すため、通常の編集では既存の電子署名は必ず無効化されます。`/ByteRange` を含む PDF は既定でエラーになります。
>
> - `preserveSignatures: true` — **署名を保持したまま** ISO 32000 の増分更新として末尾追記します（元のバイト列に一切触れません）。対応: 文書に追加する編集ツールすべて（`add_annotation` / `set_metadata` / `add_bookmarks` / `tag_form_fields` / `ensure_tagged` / `attach_file` / `stamp_page_numbers` / `add_watermark`。タグ付き文書では構造木の変更も同じ増分に載ります）
> - `allowBreakingSignatures: true` — 署名を無効化して破壊的に続行します
> - 認証署名（DocMDP）の許可レベルに反する変更は拒否されます（§12.8.2.2）
>
> 実測: 実署名（CMS）PDF への多段の増分後も署名 **VALID**、タグ付き文書への増分構造更新後も veraPDF **COMPLIANT（106/106）**。

### タグ無し PDF への足場作り（`ensure_tagged`）

`ensure_tagged` は既存 PDF を PDF/UA-1 の「器」に載せます。タグ付き入力では構造木を温存し、欠落した文書要件（`MarkInfo` / `/Lang` / `DisplayDocTitle` / XMP）のみ補修します。構造木を持たない文書には、各ページの内容を 1 つの `P` 要素で包む**最小限の足場**を新設します — 本文が支援技術から到達可能になり veraPDF も通ります（実測 106/106）。

> [!WARNING]
> **これは足場であって、アクセシビリティではありません。** 機械は意味を推定できないため、見出し・リスト・表・読み順・図の代替テキストは**作られません**（ツール自身が `warnings` でそう伝えます）。内容を `Artifact` で包む実装も veraPDF は通りますが、本文がスクリーンリーダから隠れる「準拠の体裁だけ」の状態になるため、意図的に採用していません。文書を自分で作れる場合は `create_*` の `tagged: true` が本物の構造を作ります。`ensure_tagged` は「受け取ってしまった文書」のための道具です。

### 長期保存の器（`ensure_pdfa`）

`ensure_pdfa` は `ensure_tagged` の長期保存（PDF/A-3b）版です。補うのは文書レベル要件のみ:

- trailer の `/ID`（ISO 32000-1 §14.4）
- sRGB の OutputIntent（`GTS_PDFA1`。ICC プロファイルを生成して埋め込み）
- XMP の `pdfaid` 宣言（既存の作成日時は Info /CreationDate から引き継ぎ）

> [!WARNING]
> 本文・フォント・構造木には触らないため、**これは適合の保証ではありません**。宣言を書いたら測ること — pdf-verify-mcp の `validate_conformance(flavour: "pdfa-3b")` で確認してください。電帳法の検体で実測: veraPDF **146/146 COMPLIANT**・PDF/UA-1 は **106/106** 維持・添付も生存。

**v0.17.0 から、書いた宣言が「測ると落ちる」と既に分かっている場合は `declarationRisks` に構造化して返します。** 現在報告するのは `FONT_NOT_EMBEDDED` の 1 種で、PDF/A は全フォントの埋め込みを要求する一方 `ensure_pdfa` はフォントを埋め込まないため、標準 14 書体で描かれた文書は文書レベルの構造がどれだけ正しくても検証で落ちます。**宣言そのものは書きます**（判定を下すのは veraPDF の役目）が、呼び出し側は警告文を読まずに分岐できます。

**v0.24.0 から、応答の `wasDeclared` を `previousDeclaration` に置き換えました（破壊的変更）。** 入力がすでに名乗っていた PDF/A を `{ part, conformance }` で、無ければ `null` で返します。`wasDeclared`（真偽値）は、前の宣言が求めた flavour と同じだったかを分けていませんでした。

**v0.24.0 から、PDF/UA-1 を宣言した入力への `pdfa-4`・`pdfa-4f` は断ります。** PDF/A-4 はヘッダーを PDF 2.0 にし、PDF/UA-1 は版を 1.0〜1.7 とする（ISO 14289-1 §6.1）ので、出力は 2 つの宣言の片方で必ず落ちます。エラーは `INVALID_ARGUMENT` で、`next_actions` が `flavour: "pdfa-3b"`（ヘッダーを 1.7 のままにする）を案内します。

v0.27.0 から、**PDF/UA-2** を宣言した入力では逆になります。`pdfa-4`・`pdfa-4f` は通し（どちらも PDF 2.0 基盤です）、`pdfa-3b` は断って `next_actions` で `flavour: "pdfa-4"` を案内します。PDF/A-3 はヘッダーを PDF 1.x に限り（veraPDF の規則 ISO 19005-3:2012 6.1.2-1）、PDF/UA-2 は 2.0 を求めるためです。

#### PDF/A-4（v0.16.0）

`flavour: "pdfa-4"` は ISO 19005-4 を狙います。PDF 2.0 基盤なので、上の 3 項目に加えて**ヘッダを 2.0 にし、Info 辞書を削除**します — PDF/A-4 は catalog に `/PieceInfo` が無い限り Info を許さず、これは ISO 32000-2 §14.3.3 より厳しい要求です。`pdfaid:rev` を書き、`pdfaid:conformance` は書きません（PDF/A-4 は conformance level を持たないため）。

**添付がある文書には `"pdfa-4f"` を使ってください。** 素の PDF/A-4 は**添付ファイル自身が PDF/A であること**を要求するので、CSV や JSON を添える電帳法の使い方では非適合になります。`"pdfa-4f"` はまさにそのための variant です。

veraPDF 1.30.0 で実測: `pdfa-4` **109/109 COMPLIANT**。CSV を添付した同一文書は `pdfa-4` では 108/109、**`pdfa-4f` では 109/109**。

`preserveSignatures` との併用は、入力が既に PDF 2.0 でない限り拒否します。増分更新はファイル先頭のヘッダを書き換えられず、書き換えれば守るはずの署名を壊すためです。

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

> [!TIP]
> **`@latest` を付ける（またはバージョンを固定する）ことを推奨します。** バージョン指定なしの `npx -y <pkg>` は、**最初にキャッシュした版を使い続けます**（`-y` はインストール確認を省くだけで、更新確認はしません）。数か月前の版が動き続けることもあります。`@latest` にすると起動のたびにレジストリを確認します。再現性を優先するなら `@0.5.0` のように固定してください。キャッシュを消すには `rm -rf ~/.npm/_npx`。

## フォント

標準 PDF フォント（Helvetica）で描けるのは、**WinAnsiEncoding の 218 字**（ISO 32000-1 Annex D.2）です。ASCII、Latin-1 の文字と記号、曲がった引用符・ダッシュ・`€`・`…`・`™` などが含まれます。それ以外の U+0100 以上の字（日本語・`ł`・`✔` など）を含む文字列は `FONT_REQUIRED` で断り、エラーの本文で原因の字を名指します。こうした字を描くには、`fontPath` または `PDF_WRITER_FONT` で埋め込み可能な**単一フェイス**のフォント（`.ttf` / `.otf`）を指定してください。

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
| `replace` | 〓 に置換して生成し、`warnings` で報告（フォントに 〓 が無ければ `?`。標準フォントでは常に `?`） |
| `ignore` | 空白を描いて生成し、`warnings` で報告（黙って落とすことはしない） |

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

## エラー応答（v0.7.0）

エラーは `pdf-reader-mcp` と同じ契約の構造化形式で返します。プログラム判定用の安定した `code` に加え、LLM エージェントがそのまま行動できる `next_actions` を含みます。writer 固有のガードはすべて「明示フラグを足せば再試行できる」形で表現されます:

```jsonc
{
  "error": "\"/in/signed.pdf\" appears to be digitally signed (/ByteRange found). …",
  "code": "SIGNED_PDF",
  "retryable": true,
  "next_actions": [
    {
      "action": "retry_with_allowBreakingSignatures",
      "reason": "署名を無効化してよい場合のみ…",
      "example": { "allowBreakingSignatures": true }
    }
  ]
}
```

コード一覧: `INVALID_ARGUMENT` / `DOC_NOT_FOUND` / `FONT_NOT_FOUND` / `INVALID_PDF` / `ENCRYPTED_PDF` / `UNSUPPORTED_PDF_FEATURE`（XFA）/ `FILE_TOO_LARGE` / `INTERNAL_ERROR`、および writer 固有ガードの `SIGNED_PDF`（`allowBreakingSignatures`）/ `TAGGED_PDF`（`allowBreakingTags`）/ `FONT_REQUIRED`（`fontPath`）/ `MISSING_GLYPH`（`onMissingGlyph`）。

v0.23.3 から、どのエラーも `retryable` を持ちます。値は code ごとに 1 つです（PDF family の規約 pdf-agent-stack `docs/specs/06` §2.3）。`INVALID_ARGUMENT`・`FONT_REQUIRED`・`FONT_NOT_FOUND`・`MISSING_GLYPH`・`SIGNED_PDF`・`TAGGED_PDF` は `true`（引数やフラグを変えれば同じ編集が通る）、ほかは `false` です。`error`・`hint`・`next_actions[].reason` は英語で、`next_actions[].action` と `example` の値は変えません。

## 決定論的出力（v0.7.0）

環境変数 `SOURCE_DATE_EPOCH`（UNIX 秒。[reproducible-builds.org](https://reproducible-builds.org/docs/source-date-epoch/) の慣習）を設定すると、CreationDate / ModificationDate / XMP の日時が固定され、**同一入力から同一バイト列**が得られます。差分検証・キャッシュ・再現テストに有用です。不正な値は黙殺せずエラーになります。

## テキスト抽出

生成される PDF はテキストの選択・コピー・全文検索・スクリーンリーダ読み上げが可能です。埋め込みサブセットフォントでも ToUnicode CMap（§9.10.3）を書いているためで、この性質は回帰テスト（`extract.test.ts` / `render.test.ts`）で担保しています。

> [!NOTE]
> v0.13.x 以前の出力では、poppler 系のビューアが `Mismatch between font type and embedded font file` という警告を出すことがありました。これは CFF フォントを `FontFile2` で埋め込んでいた条文違反（W-2）の症状で、**v0.14.0 で是正済み**です（現行の出力では警告は出ません）。

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
- **既定では `title` と本文の先頭見出しが両方 H1 になります**（B-19）。PDF/UA 7.4.2（H1 始まり・レベル飛ばし禁止）を満たすための設計で、veraPDF は通りますが、本文が題名を繰り返すと見出しが重複します。`drawTitle: false` を渡すと、題名はメタデータにだけ入ります。
- **リストの `/Lbl` を出力しません**（B-18）。`•` や `1.` は本文に含めています。ISO 32000-2 §14.8.4.8.2 では `Lbl` は NOTE（`often include`）であり必須ではないため適合しますが、読み戻して再生成すると記号が二重化します。

> **解決済み**:
> - サブセット名の接頭辞（`ABCDEF+`）は **v0.14.0（W-3）で付与するようになりました**。以前の README にあった「接頭辞を付けない」という制約は解消済みです。
> - `snake_case` の `_` が消える不具合（B-17）は **2026-07-21 に修正済み**（次版で反映）。`_` の強調判定に語中条件を入れ、コードスパンを先に保護するようにしました。`日本語_変数名` のような非 ASCII の識別子も保存されます。

## ロードマップ

- [x] 編集系 Tier A 第1波 — メタデータ・ページ操作（v0.2.0）
- [x] 編集系 Tier A 第2波 — しおり・注釈（v0.4.0）
- [x] タグ付き PDF / PDF/UA-1 — veraPDF で準拠を確認（v0.5.0）
- [x] タグ付き出力での注釈の `Annot` タグ内包（v0.5.1）
- [x] 編集系 Tier B — 添付ファイル・フォーム記入 / フラット化・透かし・ページ番号スタンプ（v0.6.0）
- [x] コード衛生・family 整合 — McpServer + Zod、構造化エラー、絶対パス強制、stdout ガード、tool annotations、決定論的出力（v0.7.0）
- [x] `tag_form_fields` — タグ付き PDF 内フォームの PDF/UA 修復。veraPDF で COMPLIANT を確認（v0.8.0）
- [x] Tier C 第1弾 — `add_annotation` の署名保持増分更新。実署名（CMS）で pdf-verify-mcp の VALID を確認（v0.9.0）
- [x] 増分更新を `set_metadata` / `add_bookmarks` へ展開、trailer 全エントリ引き継ぎ（§7.5.6）、XMP と Info の同期（v0.10.0）
- [x] タグ付き文書の増分更新 — 構造木の dirty 追跡を一般化。`tag_form_fields` も `preserveSignatures` 対応（v0.11.0）
- [x] 増分更新を全編集ツールへ展開 + `ensure_tagged`（PDF/UA の足場作り・修復）（v0.12.0）
- [x] ページ操作が文書レベル情報を報告・引き継ぐように。ISO 32000-2 の再照合で shall 違反 3 件を発見・是正（v0.13.0）
- [ ] ページ操作での構造木の引き継ぎ（MarkInfo・準拠宣言つき XMP・`/AcroForm`・複数入力の添付マージも同時に解ける）
- [ ] Tier C の残り — `edit_text`（本文編集・リフロー）
- [ ] 出力パイプライン Skill（write → pdf-reader で読み戻し → pdf-verify で品質ゲート）
- [ ] 画像の代替テキスト（`Figure` + `/Alt`）
- [ ] `.ttc` からのフェイス自動抽出
- [ ] 見出し用と本文用のフォント分け（太字フェイス埋め込み）
- [ ] 画像埋め込み、ヘッダー / フッター
- [ ] Tier C — 署名を保持する増分更新、本文テキスト編集、タグ木の保守
- [ ] PDF/A 変換

## ライセンス

MIT © shuji-bonji
