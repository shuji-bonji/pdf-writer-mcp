# pdf-writer-mcp 設計書

| 項目 | 内容 |
|------|------|
| ドキュメント種別 | 設計書（Design Document） |
| 対象システム | `@shuji-bonji/pdf-writer-mcp` |
| バージョン | 0.13.1（B-10b-fix = carry した catalog エントリを間接参照で書く W-1 hotfix。0.13.0 = B-10a/b + B-13 + SPEC-AUDIT Phase 2-4 の shall 違反 3 件是正。19 ツール） |
| リポジトリ | https://github.com/shuji-bonji/pdf-writer-mcp |
| 最終更新 | 2026-07-19 |
| ステータス | create 系 3（PDF/UA 対応）+ 編集系 15 = **18 ツール**実装済み。add_annotation は `preserveSignatures` で署名済み PDF に増分更新対応 |

> **本書のバージョン行は `package.json` と同期させること。** リリース手順（CLAUDE.md）に
> 「DESIGN.md ヘッダの更新」を含める。v0.3.1→v0.6.0 の間、本書が未更新のまま放置され、
> family 側文書（`mcps/pdf-family-role-architecture.md`）が旧版数を参照する不整合が起きた。

---

## 1. 概要

### 1.1 目的

テキスト・Markdown・表データを入力として **PDF を新規生成** する MCP (Model Context Protocol) サーバを提供する。
LLM エージェント（Claude Desktop 等）から自然言語の指示で、体裁の整った日本語 PDF を生成できることを目標とする。

### 1.2 スコープ

Tier の呼称は PDFfamily specs/05 の体系に従う。create 系は当初どの Tier にも存在しなかったが、
役割分担提案（`mcps/pdf-family-role-architecture.md` M-6）に基づき **Tier 0** として位置づける。

**対象（Tier 0 = create 系。実装済み MVP）**

- プレーンテキスト → PDF
- Markdown → PDF（見出し・段落・リスト・コード・引用・水平線・表）
- 表データ（ヘッダ＋行）→ PDF
- 日本語フォントのサブセット埋め込み
- タグ付き PDF / PDF/UA-1 生成（`tagged: true` で opt-in。v0.5.0）
- ファイル保存 / base64 返却

**対象（編集系 Tier A。v0.2.0 / v0.4.0 実装済み）**

- メタデータ更新（set_metadata）
- ページ操作（merge / split / extract / delete / reorder / rotate）
- しおり（add_bookmarks）・注釈（add_annotation。タグ付き文書では Annot タグ内包 = v0.5.1）
- 署名ガード（/ByteRange 検知時は既定でエラー、明示フラグで続行）

**対象（編集系 Tier B。v0.6.0 実装済み）**

- 添付ファイル（attach_file。PDF/A-3 §6.8 形式）
- 透かし（add_watermark）・ページ番号（stamp_page_numbers）— タグ付き文書では Artifact 化
- フォーム記入・フラット化（fill_form / flatten_form）

**対象外（将来 = Tier C ほか）**

- 本文テキスト編集・タグ木保守（ensure_tagged）・署名を保持する増分更新（Tier C。pdf-engine-core と合流）
- PDF/A 変換
- 電子署名の**付与**（verify との対称性から別 MCP `pdf-signature-mcp` として切り出す案が有力。specs/05 §7-3）
- 画像埋め込み・ヘッダー/フッター、.ttc フェイス自動抽出、見出し/本文のフォント分け

### 1.3 用語

| 用語 | 説明 |
|------|------|
| MCP | Model Context Protocol。LLM とツールを繋ぐプロトコル |
| サブセット埋め込み | フォントから使用グリフのみを抽出して PDF に埋め込む手法 |
| ToUnicode CMap | CID/グリフ番号から Unicode への逆引き表。テキスト抽出・検索に必須 |
| CID フォント | 大規模文字集合（CJK 等）向けのフォント形式 |
| WinAnsi | 標準14フォントが使う Latin-1 系エンコーディング |

---

## 2. 背景とエコシステム上の位置づけ

本サーバは `shuji-bonji` の PDF 系 MCP 群における「生成（write）」担当である。
読み取り・検証は既存サーバが担い、責務を分離する。

```mermaid
graph LR
  subgraph 生成 write
    W[pdf-writer-mcp<br/>text / md / table → PDF]
  end
  subgraph 読取 read
    R[pdf-reader-mcp<br/>抽出・構造検査]
  end
  subgraph 検証 verify
    V[pdf-verify-mcp<br/>署名・準拠性]
  end
  subgraph 仕様 spec
    S[pdf-spec-mcp<br/>ISO 32000 参照]
  end
  W --> R
  R --> V
  S -.仕様根拠.-> W
  S -.仕様根拠.-> V
```

将来 writer は「新規生成（create）」に加え「既存 PDF 編集（edit）」の二面性を持ち、
reader の後段（read → edit → verify）に位置づく想定である（§12 参照）。

---

## 3. 要件

### 3.1 機能要件（FR）

| ID | 要件 |
|----|------|
| FR-1 | テキストから PDF を生成できる（改行・空行段落・自動折り返し・改ページ） |
| FR-2 | Markdown から PDF を生成できる（見出し/リスト/コード/引用/水平線/表） |
| FR-3 | 表データから罫線付き PDF を生成できる（列幅自動・セル折り返し・改ページ時ヘッダ再描画） |
| FR-4 | 日本語を含むテキストを、埋め込みフォントで描画できる |
| FR-5 | 出力をファイル保存、または base64 で返却できる |
| FR-6 | ページサイズ・マージン・フォントサイズ・タイトル・作成者を指定できる |
| FR-7 | 生成 PDF のテキストは抽出・検索・コピーが可能である |

### 3.2 非機能要件（NFR）

| ID | 要件 | 方針 |
|----|------|------|
| NFR-1 | MCP stdio プロトコルを汚染しない | `console.log` 禁止、全ログを stderr へ |
| NFR-2 | 不正入力を早期・明確に拒否する | Zod スキーマ検証＋上限値（v0.7.0〜） |
| NFR-3 | 巨大入力による暴走を防ぐ | テキスト長・表サイズの上限 |
| NFR-4 | フォント埋め込みサイズを抑える | サブセット化（16MB→数十KB） |
| NFR-5 | 保守性・拡張性 | レイヤ分離、ツール追加は Map に1行 |
| NFR-6 | 回帰を防ぐ | vitest による層別テスト |

---

## 4. アーキテクチャ

### 4.1 レイヤ構成（v0.7.0 = McpServer + Zod 移行後）

```mermaid
graph TD
  A[index.ts<br/>stdio 接続のみ<br/>※先頭で stdout-guard を import] --> S[server.ts<br/>buildServer: registerTool 一括登録<br/>try/catch と構造化エラー整形を一元化]
  S --> D[tools/definitions.ts<br/>ツールレジストリ<br/>title / description / shape / annotations]
  S --> B[tools/handlers.ts<br/>ツールハンドラ]
  S --> ER[errors.ts<br/>PdfWriterError / toStructuredError<br/>NEXT_ACTIONS プリセット]
  D --> C[utils/validation.ts<br/>Zod スキーマ = 単一情報源]
  B --> C
  B --> E[services/builder.ts<br/>生成オーケストレーション]
  B --> ED[services/editor.ts<br/>編集オーケストレーション]
  ED --> PO[services/page-ops.ts<br/>ページ操作]
  E --> F[services/font-manager.ts<br/>フォント埋め込み]
  E --> G[services/layout.ts<br/>レイアウトエンジン]
  E --> H[services/renderers/*<br/>text / markdown / table]
  E --> I[services/output.ts<br/>保存・base64・メタデータ]
  H --> G
  B -.型.-> T[types/index.ts]
  F -.log.-> L[utils/logger.ts]
  I -.log.-> L
```

**設計原則**

- `index.ts` は stdio 接続のみ。**あらゆる import より先に `stdout-guard.ts`** を読み込み、
  依存ライブラリの `console.log/warn` による JSON-RPC 汚染を防ぐ（E-3）。
- `server.ts` の `buildServer()` がレジストリ（definitions.ts）を `registerTool` で一括登録し、
  `try/catch` と構造化エラー整形（`toStructuredError`）を一元化。テストからは
  `InMemoryTransport` で同じサーバを検証する（`registry.test.ts`）。
- ハンドラは例外を **throw** する（`{error}` を返さない）。ガード系は `PdfWriterError` に
  `code` / `hint` / `next_actions` / `retryable` を載せて投げる。整形は `server.ts` が担う。
- **入力スキーマの単一情報源は Zod**（validation.ts）。definitions.ts の `shape` も
  handlers.ts の `parseArgs` も同じスキーマから導出する（旧: JSON Schema 553 行 +
  asserts 502 行の二重管理。E-5 で解消）。
- ビジネスロジック（生成）は `services/` に集約し、レンダラは責務ごとに分割。

### 4.2 ディレクトリ構成

```
pdf-writer-mcp/
├── src/
│   ├── index.ts                     # stdio 接続（stdout-guard を先頭 import）
│   ├── server.ts                    # buildServer（registerTool 一括登録・エラー整形の一元化）
│   ├── errors.ts                    # PdfWriterError・toStructuredError・NEXT_ACTIONS（family 契約）
│   ├── config.ts                    # 版数（動的取得）・環境変数キー・既定値
│   ├── constants.ts                 # ページサイズ・上限値・マジックナンバー
│   ├── types/index.ts               # 共有型
│   ├── tools/
│   │   ├── definitions.ts           # ツールレジストリ（title / description / Zod shape / annotations）
│   │   └── handlers.ts              # ハンドラ＋ディスパッチ Map
│   ├── services/
│   │   ├── builder.ts               # 生成フロー共通化
│   │   ├── struct-tree.ts           # タグ付き PDF: 構造木を「ゼロから構築」（create 系）
│   │   ├── struct-append.ts         # タグ付き PDF: 既存構造木へ「追記」（編集系）
│   │   ├── xmp.ts                   # XMP 生成（pdfuaid 宣言・拡張スキーマ・dc:title）
│   │   ├── editor.ts                # 編集系の統括（loadForEdit: 署名ガード込み）
│   │   ├── page-ops.ts              # ページ操作（merge / split / extract / delete / reorder / rotate）
│   │   ├── outline.ts               # しおり（add_bookmarks）
│   │   ├── annotation.ts            # 注釈辞書の構築（add_annotation）
│   │   ├── attachment.ts            # 添付ファイル（attach_file。PDF/A-3 §6.8）
│   │   ├── watermark.ts             # 透かし（add_watermark。背面配置・Artifact 化）
│   │   ├── page-number.ts           # ページ番号（stamp_page_numbers。回転補正・Artifact 化）
│   │   ├── form.ts                  # AcroForm（fill_form / flatten_form。外観再生成の制御）
│   │   ├── font-manager.ts          # 埋め込み・.ttc 検知・フォールバック
│   │   ├── layout.ts                # 折返し・改ページ・描画
│   │   ├── output.ts                # 保存・base64・メタデータ（finalizePdf / saveEdited）
│   │   └── renderers/
│   │       ├── text.ts              # テキスト
│   │       ├── markdown.ts          # Markdown
│   │       └── table.ts             # 表
│   └── utils/
│       ├── logger.ts                # stderr ログ抽象化
│       ├── lang.ts                  # /Lang 推定（tagged 用）
│       ├── page-spec.ts             # "1,3-5,8-" ページ指定パーサ
│       ├── stdout-guard.ts          # console.log/warn を stderr へ差し替え（side-effect first）
│       └── validation.ts            # Zod スキーマ（shape + フルスキーマ + パス/サイズ検査）
├── tests/                           # 19 ファイル（§9 参照）
├── docs/DESIGN.md                   # 本書
├── package.json / tsconfig.json / vitest.config.ts / .gitignore
└── README.md / LICENSE
```

### 4.3 責務分担

| モジュール | 責務 | 依存 |
|-----------|------|------|
| `index.ts` | stdio 接続のみ（stdout-guard を先頭 import） | server, logger |
| `server.ts` | McpServer 構築・registerTool 一括登録・try/catch と構造化エラー整形の一元化 | definitions, handlers, errors |
| `errors.ts` | `PdfWriterError`（code / hint / next_actions / retryable）・`toStructuredError`・`NEXT_ACTIONS` プリセット | （なし） |
| `tools/definitions.ts` | ツールレジストリ（title / description / Zod shape / annotations） | validation |
| `tools/handlers.ts` | `parseArgs`（Zod フルスキーマ検査）→ builder / editor 呼出し | validation, builder, editor, page-ops, renderers |
| `services/builder.ts` | doc生成→フォント→エンジン→描画→保存の統括 | font-manager, layout, output |
| `services/editor.ts` | 編集系の統括（loadForEdit: 署名ガード・サイズ上限） | page-ops ほか編集サービス群 |
| `services/page-ops.ts` | ページ操作（merge / split / extract / delete / reorder / rotate） | pdf-lib, output |
| `services/font-manager.ts` | フォント読込・埋め込み・種別判定 | pdf-lib, fontkit |
| `services/layout.ts` | 座標管理・折返し・改ページ・描画 API | pdf-lib |
| `services/renderers/*` | 各入力を layout API で描画 | layout |
| `services/output.ts` | メタデータ・保存・base64・決定論的日時（SOURCE_DATE_EPOCH） | pdf-lib |
| `utils/validation.ts` | Zod スキーマ（公開 shape と実行時検査の単一情報源）・パス/サイズ検査 | constants, errors |
| `utils/stdout-guard.ts` | console.log/warn の stderr 差し替え（副作用専用） | （なし） |
| `utils/logger.ts` | stderr ログ | （なし） |

---

## 5. 処理フロー

### 5.1 起動とツール呼出しのディスパッチ（v0.7.0）

```mermaid
sequenceDiagram
  participant Client as MCP クライアント
  participant SDK as McpServer(SDK)
  participant S as server.ts
  participant H as handlers
  participant E as errors.ts
  Note over S: 起動時: buildServer() が<br/>レジストリ 17 件を registerTool
  Client->>SDK: ListTools
  SDK-->>Client: tools[]（title / schema / annotations は SDK が応答）
  Client->>SDK: CallTool(name, args)
  SDK->>SDK: Zod shape でスキーマ検査（SDK 層）
  SDK->>S: 登録済みコールバック
  S->>H: handler(args)
  Note over H: parseArgs（Zod フルスキーマ）<br/>※オブジェクト横断の refine はここのみ
  alt 成功
    H-->>S: CreateResult 等
    S-->>Client: content(JSON)
  else throw
    H-->>S: PdfWriterError / Error
    S->>E: toStructuredError(error)
    E-->>S: {error, code, hint?, next_actions?, retryable?}
    S-->>Client: content(JSON), isError:true
  end
```

未知のツール名は登録が無いため SDK 層で拒否される（自前の "Unknown tool" 分岐は廃止）。

### 5.2 PDF 生成フロー

```mermaid
sequenceDiagram
  participant H as handler
  participant V as validation
  participant B as builder
  participant F as font-manager
  participant L as LayoutEngine
  participant Rd as renderer
  participant O as output

  H->>V: parseArgs(CreateXxxSchema, args)
  V-->>H: OK（型が確定）/ throw INVALID_ARGUMENT
  H->>B: buildPdf(opts, render)
  B->>F: loadFont(doc, fontPath)
  F-->>B: LoadedFont{font, name, isStandard}
  B->>L: new LayoutEngine(doc, opts)
  opt title 指定
    B->>L: drawParagraph(title)
  end
  B->>Rd: render(engine, loaded)
  Rd->>L: drawParagraph / drawRule / 表描画
  B->>O: finalizePdf(doc, opts, fontName)
  O-->>B: CreateResult{path?, base64?, pageCount, bytes, font}
  B-->>H: CreateResult
```

---

## 6. ツール仕様

共通オプション: `outputPath` / `returnBase64` / `fontPath` / `fontSize` / `pageSize`(A4/A3/A5/LETTER/LEGAL) / `margin` / `title` / `author` / `onMissingGlyph`(error|replace|ignore)。

| ツール | 固有入力 | 説明 |
|--------|----------|------|
| `create_text_pdf` | `text: string` | 改行・空行段落・自動折り返し |
| `create_markdown_pdf` | `markdown: string` | 見出し/リスト/コード/引用/水平線/表 |
| `create_table_pdf` | `headers: string[]`, `rows: string[][]` | 罫線付き表・改ページ時ヘッダ再描画 |

**返り値（共通）**

```jsonc
{
  "path": "/abs/out.pdf",     // outputPath 指定時
  "base64": "JVBERi0xLj...",  // returnBase64 or outputPath 未指定時
  "pageCount": 3,
  "bytes": 91788,
  "font": "NotoSansJP-Regular.otf"
}
```

### 6.1 編集系ツール

> 本節はフローの説明として Tier A 第1波の表を残す。**全 18 ツールの一覧と説明は README を正とする**
> （しおり・注釈・Tier B 5 ツールを含む。二重管理を避けるため本書では列挙しない）。

共通オプション: `outputPath` / `returnBase64` / `allowBreakingSignatures`。

| ツール | 固有入力 | 説明 |
|--------|----------|------|
| `set_metadata` | `inputPath`, `title?`, `author?`, `subject?`, `keywords?`, `creator?` | 指定フィールドのみ更新、他は保持 |
| `merge_pdfs` | `inputPaths: string[]`（2〜50） | 指定順に結合。メタデータは先頭から引き継ぎ |
| `split_pdf` | `inputPath`, `ranges: string[]`, `outputDir`, `prefix?` | 範囲ごとに連番ファイルへ分割 |
| `extract_pages` | `inputPath`, `pages: string` | 指定順を保持して抽出（並べ替え兼用） |
| `delete_pages` | `inputPath`, `pages: string` | 削除（全ページ削除はエラー） |
| `reorder_pages` | `inputPath`, `order: number[]` | 全ページの順列で並べ替え |
| `rotate_pages` | `inputPath`, `rotation: 90\|180\|270`, `pages?` | 時計回り回転。既存回転に加算 |

ページ指定は `"1,3-5,8-"` 形式（1 始まり、`-3`/`8-` の開端も可、重複除去・指定順保持）。
パーサは `utils/page-spec.ts` に集約。

**編集フロー**（create 系の builder を通らない並列系統）

```mermaid
sequenceDiagram
  participant H as handler
  participant V as validation
  participant E as editor
  participant O as output

  H->>V: validateXxxArgs(args)
  H->>E: setMetadata / mergePdfs / ...
  E->>E: loadForEdit（読込 + 署名ガード）
  Note over E: /ByteRange 検知 かつ<br/>allowBreakingSignatures≠true → throw
  E->>E: ページ操作（copyPages で新規文書へ / in-place）
  E->>O: saveEdited(doc, opts)
  Note over O: ModificationDate のみ更新<br/>既存メタデータは保持
  O-->>H: EditResult{path?, base64?, pageCount, bytes}
```

**署名保全（specs/05 §3-1 対応）**: pdf-lib の save() は全体再構築のため既存署名を必ず無効化する。
入力バイト列の `/ByteRange` を検知したら既定でエラーにし、`allowBreakingSignatures: true` でのみ続行。
署名を保持する増分更新は Tier C（`incremental_save`）で対応する。

**入力上限（constants.ts）**

| 項目 | 値 | 根拠 |
|------|----|------|
| fontSize | 4〜96 pt | 実用範囲・暴走防止 |
| margin | 0〜300 pt | 0=全面、上限で破綻防止 |
| text 最大長 | 500,000 文字 | DoS・巨大PDF防止 |
| 表 最大列/行 | 40 / 5,000 | レイアウト破綻・肥大防止 |

---

## 7. 主要コンポーネント設計

### 7.1 font-manager（フォント戦略）

最重要の設計判断。日本語生成の可否とサイズを左右する。

```mermaid
flowchart TD
  Start[openFont fontPath?] --> R{fontPath or<br/>PDF_WRITER_FONT?}
  R -- なし --> STD[標準フォント Helvetica<br/>isStandard=true / ASCII のみ]
  R -- あり --> Read[ファイル読込]
  Read --> Magic{先頭4byte<br/>= 'ttcf'?}
  Magic -- はい --> ErrTTC[エラー: .ttc 非対応<br/>単一フェイス抽出を促す]
  Magic -- いいえ --> Probe[fontkit でパース<br/>hasGlyph を用意]
  Probe --> Policy[applyMissingGlyphPolicy<br/>欠落文字の error/replace/ignore]
  Policy --> Sub[embedFontFor:<br/>harfbuzz で使用文字のみに subset]
  Sub -- 失敗 --> Full[警告し元フォントを埋め込む<br/>正しさ優先]
  Sub -- 成功 --> Embed[embedFont subset:false<br/>※fontkit の再サブセットは使わない]
  Full --> Embed
  Embed -- 失敗 --> ErrEmbed[エラー: 埋め込み失敗]
  Embed -- 成功 --> OK[LoadedFont<br/>isStandard=false]
```

**確定した方針**（v0.3.0 改訂）

- 単一 `.ttf/.otf` を **harfbuzz（subset-font）で事前サブセット**し、pdf-lib には `subset:false` で
  埋め込む。**pdf-lib（fontkit）のサブセッタは使わない** — CJK グリフを破壊するため（ADR-7・付録 A.1）。
- `.ttc`（TrueTypeCollection）は pdf-lib がサブセット化できず失敗するため、
  マジックバイト `ttcf` で **検知して明示的にエラー**にする（単一フェイス抽出を案内）。
- フォント未指定時は標準 `Helvetica`（`isStandard=true`）。
- 標準フォント × 非 Latin-1 文字（日本語等）は、描画前に **renderer 側で親切なエラー** に変換（§8）。

**グリフ欠落ポリシー（v0.2.1）**

フォント未収録文字（例: Noto Sans JP に無い ✔ U+2714）は pdf-lib が無警告で .notdef（空白）を
埋め込んでしまう。これを防ぐため、埋め込み時に fontkit で二重パースして
`hasGlyphForCodePoint` による照会関数を `LoadedFont.hasGlyph` として保持し、
builder が描画前に全入力テキストを走査する（`applyMissingGlyphPolicy`）。
`onMissingGlyph` は error（既定・欠落文字を列挙して throw）/ replace（〓 置換 + warnings）/
ignore（従来動作 + warnings）。warnings は `CreateResult.warnings` で返却する。
標準フォントは従来どおり `assertRenderable`（Latin-1 検査）が担当。

**GSUB 置換と ToUnicode の不整合（v0.3.1・ADR-8）**

pdf-lib の `CustomFontEmbedder`（subset:false）は 2 つの経路で別々にグリフを求める。

| 用途 | 経路 | 結果 |
|------|------|------|
| 本文に書く CID | `font.layout(text)` | GSUB 適用**後**のグリフ |
| ToUnicode CMap | `font.characterSet` → `glyphForCodePoint` | GSUB 適用**前**のベースグリフ |

Noto Sans JP はラテン文脈の数字を別字形に置換するため（`layout('English 0')` の 0 は
gid 17 ではなく **17460**）、CID と ToUnicode がずれて抽出が壊れる
（`v0.3.0` → `vô.õ.ô`、poppler では欠落。描画は正しいので気づきにくい）。

対策は harfbuzz サブセット時の `noLayoutClosure: true`。置換候補グリフをサブセットに
含めないため置換自体が発生せず、`layout()` == `glyphsForString()` となって両者が一致する。
`render.test.ts` がこの一致を検証する。

> なお `subset:true`（旧実装）は ToUnicode を「実際に描画したグリフ」から作るためこの問題は
> 起きなかった。つまり **v0.3.0 でのみ発生した回帰**であり、旧実装は別の理由（ADR-7）で破綻していた。

**ToUnicode について**（重要な発見）

pdf-lib の `embedFont(subset)` は **ToUnicode CMap を自動付与する**。
そのため生成 PDF は埋め込みフォントでも抽出・検索・コピーが可能。
当初「抽出不可」と誤認していたが、実測（pikepdf）で ToUnicode に `日→U+65E5` 等の正しい逆引きを確認済み。
→ 自前の ToUnicode 付与は **不要**。回帰テスト（§9）で担保する。

### 7.2 LayoutEngine（レイアウトエンジン）

pdf-lib の低レベル API（座標指定 `drawText`）の上に、上端(top)基準のカーソル管理を載せる薄い層。

**座標系**

- pdf-lib は左下原点。本エンジンは「上端 `cursorTop`」を管理し、下方向へ積む。
- ベースライン = `cursorTop - fontSize * ASCENT_RATIO`（`ASCENT_RATIO = 0.8` の近似）。
- 見出し・本文・表でサイズが変わっても top 基準で一貫して積み上がる。

**折り返しアルゴリズム `wrapText`**

```mermaid
flowchart TD
  A[入力テキスト] --> B[改行 \n で行分割<br/>空行は保持]
  B --> C[各行をトークン化]
  C --> D{トークン種別}
  D -- 空白 --> E[行頭なら捨てる]
  D -- CJK文字 --> F[1文字単位]
  D -- ラテン語塊 --> G[連続塊]
  E & F & G --> H{行幅 > maxWidth?}
  H -- はい --> I[確定して改行]
  H -- いいえ --> J[行に追加]
  J --> K{単一トークンが<br/>maxWidth 超?}
  K -- はい --> L[breakLongToken<br/>文字単位で強制分割]
  K -- いいえ --> C
```

- 日英混在に対応（CJK は任意位置改行可、ラテンは単語単位）。
- URL 等の長大トークンは文字単位で強制分割。
- 幅測定は `font.widthOfTextAtSize` を使用（標準/埋め込み両対応）。

**主な公開 API**: `drawParagraph` / `drawRule` / `newPage` / `ensureSpace` / `moveDown` /
アクセサ（`page`, `leftX`, `bottomY`, `contentWidth`, `cursorTop`, `defaultFont`, `defaultSize`）。

### 7.3 renderers

| renderer | 方針 |
|----------|------|
| text | 空行で段落分割し `drawParagraph`。冒頭で標準フォント×非Latin1を検査 |
| markdown | `marked.lexer` でブロックトークン化。heading/paragraph/list/code/blockquote/table/hr/space を描画。インライン記号は除去し字面のみ反映 |
| table | 列幅を内容から自動算出（上限クランプ→比例配分）。セル折返し、ヘッダ背景、罫線、改ページ時ヘッダ再描画 |

markdown の表描画は table renderer を共有（重複実装を排除）。

### 7.4 output

`setTitle/Author/Producer/CreationDate/ModificationDate` を付与 → `doc.save()`。
`outputPath` があれば `mkdir -p` して保存、なければ（または `returnBase64`）base64 を返す。

**決定論的出力（E-6・v0.7.0）**: 環境変数 `SOURCE_DATE_EPOCH`（UNIX 秒。
reproducible-builds.org の慣習）が設定されていると、CreationDate / ModificationDate /
XMP の日時をその値に固定し、**同一入力 → 同一バイト列**を保証する。read-write-verify
ループ（学習データ工場）の差分検証・キャッシュ・再現テスト用。不正値は黙殺せずエラー。

### 7.5 validation（v0.7.0 = Zod 移行後）

**Zod スキーマが公開スキーマと実行時検査の単一情報源**（E-5）。各ツールにつき
`xxxShape`（`ZodRawShape`。definitions.ts 経由で MCP の公開 inputSchema になる）と
`XxxSchema`（`z.object(shape)` + オブジェクト横断の `refine`）を提供し、ハンドラは
`parseArgs(Schema, args)` を必ず通す。閾値は従来どおり `constants.ts` に集約。

パス検査（E-1）: パスを受けるすべての引数（`inputPath` / `inputPaths[]` / `outputPath` /
`outputDir` / `fontPath` / `attachmentPath`）に共通の Zod パーツで**絶対パスを強制**し、
`..` セグメントを拒否（解決結果ではなく指定文字列そのものを検査）。入力 PDF は
`INPUT_PDF_MAX_BYTES`（100MB。verify の MAX_FILE_SIZE と同水準）で上限を課す。

### 7.6 logger

`debug/info/warn/error` すべて `console.error`（stderr）へ。第1引数に `context` を必須化。
MCP の stdio（JSON-RPC）を汚染しないための最重要規約。

---

## 8. エラーハンドリング方針（v0.7.0 = 構造化エラー移行後）

- ハンドラ／サービスは**例外を throw** する。`server.ts` が一元 catch し、
  `toStructuredError` で **family 契約**（reader v0.6.0 と同形）に整形して返す:

  ```jsonc
  {
    "error": "1文の人間可読メッセージ",
    "code": "SIGNED_PDF",             // プログラム判定用の安定コード
    "hint": "追加情報（任意）",
    "next_actions": [                  // LLM / 編成 Skill が次に取る手段
      { "action": "retry_with_allowBreakingSignatures", "reason": "...", "example": { "allowBreakingSignatures": true } }
    ],
    "retryable": true                  // フラグや引数を変えれば再試行できるか
  }
  ```

- **コード体系**（errors.ts の `WriterErrorCode`）: family 共通の部分集合
  （`INVALID_ARGUMENT` / `DOC_NOT_FOUND` / `FONT_NOT_FOUND` / `INVALID_PDF` /
  `ENCRYPTED_PDF` / `UNSUPPORTED_PDF_FEATURE` / `FILE_TOO_LARGE` / `INTERNAL_ERROR`）
  + writer 固有ガード（`SIGNED_PDF` / `TAGGED_PDF` / `FONT_REQUIRED` / `MISSING_GLYPH`）。
  **writer 固有ガードはすべて「解除フラグや引数の追加で再試行可能」**として表現され
  （`retryable: true` + `NEXT_ACTIONS` プリセット）、出力パイプライン Skill
  （PDFfamily specs/07 §5）が自律分岐できる。
- `PdfWriterError` 以外の例外（想定外）は `INTERNAL_ERROR` に落とす。
- ユーザ起因の誤りは**行動可能なメッセージ**にする方針は従来どおり。代表例：
  - 日本語 × フォント未指定 → `FONT_REQUIRED` + `retry_with_fontPath`（PDF_WRITER_FONT 案内込み）
  - フォント未収録文字 → `MISSING_GLYPH` + `retry_with_onMissingGlyph`
  - `.ttc` 指定 → 単一フェイスの抽出手順（fonttools 例つき）
- 標準フォント×非Latin1は、pdf-lib の低レベル例外に頼らず、renderer 冒頭の
  `assertRenderable` で**事前に**検査して明快に弾く。

---

## 9. テスト戦略

| テスト | 対象 | フォント依存 |
|--------|------|:---:|
| `validation.test.ts` | 入力検査の正常/異常系 | 不要 |
| `layout.test.ts` | `wrapText`（折返し/CJK/長語分割）・`hasNonLatin1` | 不要（標準フォント） |
| `generate.test.ts` | 3ツールの生成・ページ数・ガード（日本語×無フォント等） | 一部（skipIf） |
| `extract.test.ts` | 抽出可能性の回帰（標準=hex復号一致、埋込=ToUnicodeに日→65E5） | 一部（skipIf） |
| `glyph.test.ts` | onMissingGlyph の error/replace/ignore | 一部（skipIf） |
| `render.test.ts` | **描画実体の回帰**（埋め込みフォントを取り出し、使用文字のアウトラインが残存するか） | 一部（skipIf） |
| `editor.test.ts` | 編集系・署名ガード | 不要 |
| `page-spec.test.ts` | `"1,3-5,8-"` パーサ | 不要 |
| `outline-annotation.test.ts` | しおり・注釈 | 一部（skipIf） |
| `tagged.test.ts` / `struct-append.test.ts` | 構造木の構築 / 追記（PDF/UA） | 一部（skipIf） |
| `attachment.test.ts` / `watermark.test.ts` / `page-number.test.ts` / `form.test.ts` | Tier B 各ツール（Artifact 化・宙吊り参照の掃除を含む） | 一部（skipIf） |
| `registry.test.ts` | **外部仕様のスナップショット固定**（InMemoryTransport で 18 ツールの名前・必須フィールド・annotations を検証。E-5 移行の非破壊性を担保） | 不要 |
| `form-tagging.test.ts` | `tag_form_fields`（Form 内包・OBJR・/Tabs・/TU・冪等性・タグ無し拒否） | 不要 |
| `errors.test.ts` | 構造化エラー（code / next_actions / retryable の整形） | 不要 |
| `deterministic.test.ts` | SOURCE_DATE_EPOCH による同一入力 → 同一バイト列 | 一部（skipIf） |

> `render.test.ts` の存在理由: v0.2.1 以前のグリフ破損（ADR-7）は ToUnicode が正しかったため
> `extract.test.ts` を素通りした。**抽出できること ≠ 描画できること**。旧実装に戻すと本テストが
> 失敗することを確認済み（バグ捕捉能力の検証）。

- 日本語フォント依存テストは `TEST_FONT_PATH` があるときのみ実行（`describe.skipIf`）。
  CI にフォントが無くても標準フォント分は常に検証される。
- 抽出テストは **外部ツール非依存**（Node の `zlib` でストリーム展開して検証）。

```bash
npm test                                    # 標準フォント分
TEST_FONT_PATH=/path/NotoSansJP.otf npm test  # 日本語 ToUnicode も検証
```

---

## 10. 既知の制約

| 制約 | 内容 | 影響 |
|------|------|------|
| インライン装飾 | 太字/斜体は字面のみ（書体反映なし） | 単一フォント運用のため |
| `.ttc` 非対応 | 単一フェイス抽出が必要 | Node 単体で分解困難 |
| サブセット名接頭辞 | `ABCDEF+` を付けない | 一部ツールが誤認。表示/抽出は無影響、PDF/A 厳密対応時の課題 |
| ~~poppler 警告は無害~~ | ~~`Embedded font file may be invalid`~~ | **誤り（v0.3.0 で訂正）**。この警告は実害ありで、poppler は続けて `Couldn't create a font` を出し全文字が豆腐化していた。原因は fontkit サブセッタのグリフ破損（ADR-7）。harfbuzz 事前サブセットで解消 |
| フォント種別の警告 | `Mismatch between font type and embedded font file` | 無害。OTF(CFF) を CIDFontType0 として埋め込む際の poppler の指摘で、描画・抽出とも正常 |

---

## 11. 設計判断記録（ADR ダイジェスト）

| # | 判断 | 理由 | 却下案 |
|---|------|------|--------|
| ADR-1 | コアに **pdf-lib** を採用 | 依存が軽く Node/ESM 純正、既存 pdf 系と親和 | pdfkit（生成専用だが将来の編集で不利）、puppeteer（Chromium 依存で重い） |
| ADR-2 | ~~フォントは 単一 .ttf/.otf + pdf-lib subset~~ → **harfbuzz で事前サブセット + subset:false 埋め込み**（v0.3.0 改訂） | pdf-lib(fontkit) のサブセッタは CJK グリフを破壊し全ビューアで豆腐化する（下記 ADR-7）。harfbuzz なら小さく・正しい | フルフォント埋め込み（3.9MB 肥大）、fontkit subset（破損） |
| ADR-3 | **.ttc は非対応**（検知して弾く） | pdf-lib が subset 不可、Node 単体分解が困難 | 実行時分解（Python 依存を持ち込むことになる） |
| ADR-4 | ToUnicode の自前付与は**しない** | pdf-lib が既に正しく出力（実測確認） | 独自 CMap 注入（不要かつ二重化リスク） |
| ADR-5 | レイアウトは **自前の薄い層** | Markdown/表の自動組版に必要 | 外部組版ライブラリ（重い・過剰） |
| ADR-6 | 生成フローを **builder に共通化** | 3ツールで doc→font→engine→render→save が同一 | 各ハンドラで重複実装 |
| ADR-7 | **fontkit のサブセッタを使わない**（v0.3.0） | Noto Sans JP で glyph が失われ、poppler/Chrome/Firefox/Acrobat すべてで豆腐・空白になることを実測。ToUnicode は正しいため抽出テストでは検知できず、`render.test.ts` で担保する | pdf-lib `embedFont(subset:true)`（破損）、`subset:false` 単体（3.9MB） |
| ADR-9 | 構造木を **「構築（struct-tree）」と「追記（struct-append）」に分離**（v0.5.1） | create 系はゼロから作れるが、編集系は既存の StructTreeRoot / ParentTree を読んで**続きの番号**で追記する必要がある。両者は入力も不変条件も違うため、無理に共通化しない。追記側は Tier C の `ensure_tagged` の足がかりになる | 単一クラスに両モードを持たせる（分岐が増え、ParentTree の不変条件が曖昧になる） |
| ADR-8 | harfbuzz サブセット時に **`noLayoutClosure: true`** を指定（v0.3.1） | pdf-lib(subset:false) は CID を `font.layout()` の結果から、ToUnicode を cmap 由来のベースグリフから作る。GSUB 置換が起きると両者がずれ、抽出が壊れる（§7.1 参照）。置換候補をサブセットに含めなければ置換自体が起きない。副次効果でサイズも縮小（9.1KB→4.5KB） | ToUnicode の後段パッチ（pdf-lib 内部への侵襲）、GSUB テーブルの手動除去（sfnt 再構築が必要） |
| ADR-10 | **McpServer + Zod へ移行**し、公開スキーマと実行時検査を単一情報源化（v0.7.0・E-5） | JSON Schema（553 行）と asserts（502 行）の二重管理はドリフトの温床。reader / verify と同型になり family の実装パターンが揃う（PDFfamily specs/06）。外部仕様の非破壊性は `registry.test.ts` のスナップショットで担保 | 低レベル `Server` 継続（二重管理が残る）、zod-to-json-schema による片方向生成（SDK が shape を直接受けるため不要） |
| ADR-11 | **増分更新は「pdf-lib で読み、追記だけ自前で書く」ハイブリッド**（v0.9.0・Tier C 第1弾） | 全面自前パーサ/シリアライザ（pdf-engine-core）を作る前に、①オブジェクトの直列化は pdf-lib の `copyBytesInto` を再利用、②末尾追記（オフセット計算・xref・trailer）だけ自前実装、で署名保持を達成できると実証。元バイト列に一切触れないため前方一致 = 署名保持が構成的に保証される。xref は元ファイルの形式（テーブル / ストリーム）に追随。**注意**: pdf-lib はオブジェクトストリーム容器・旧 xref ストリームを登録しないため、採番前に trailer /Size から番号を予約する（`reserveExistingObjectNumbers`。怠ると容器と番号衝突 — qpdf 実測） | Rust/WASM の新規エンジン（学習コスト・ビルド複雑化が先行）、pdf-lib への増分保存パッチ（内部への深い侵襲） |

---

## 12. 拡張設計・ロードマップ

将来 writer は「生成」に「編集」を加えた二面性を持つ。

```mermaid
graph LR
  U[既存PDF] --> R[pdf-reader-mcp<br/>構造把握]
  R --> E[edit系<br/>merge/split/rotate<br/>watermark/page番号/form記入]
  R -.構造情報.-> E
  subgraph writer
    C[create系<br/>text/md/table ※MVP]
    E
  end
  C --> V[pdf-verify-mcp]
  E --> V
```

**Tier 対応表と進捗**（2026-07-17 改訂: specs/05 の Tier 体系に本書ロードマップを対応付け）

| Tier | 内容 | ツール | 状態 |
|------|------|--------|------|
| **Tier 0**（create 系。M-6 で specs/05 に追記） | 新規生成 + タグ付き PDF / PDF/UA-1 生成 | `create_text_pdf` / `create_markdown_pdf` / `create_table_pdf`（`tagged: true`） | ✅ v0.1.0 / v0.5.0 |
| **Tier A** | メタデータ・ページ操作・しおり・注釈 | `set_metadata` / `merge_pdfs` / `split_pdf` / `extract_pages` / `delete_pages` / `reorder_pages` / `rotate_pages` / `add_bookmarks` / `add_annotation` | ✅ v0.2.0 / v0.4.0 |
| **Tier B** | フォーム・透かし・添付・ページ番号 | `attach_file` / `add_watermark` / `stamp_page_numbers` / `fill_form` / `flatten_form` | ✅ v0.6.0 |
| **Tier B+**（PDF/UA 修復） | タグ付きフォームの修復 | `tag_form_fields`（7.18.4-1 / 7.18.3-1 / 7.18.1-3。veraPDF 106/106 実測） | ✅ v0.8.0 |
| **Tier C** | 本文編集・タグ木保守・増分更新 | `ensure_tagged` ✅ / 増分更新（`preserveSignatures` × 7 ツール）✅ / `edit_text` | **ほぼ完了** — 増分更新 ✅ v0.9.0〜v0.12.0（ADR-11。全編集ツール + タグ付き文書対応。実署名 VALID + veraPDF COMPLIANT を実測）、`ensure_tagged` ✅ v0.12.0。**残: `edit_text` のみ**（コンテンツストリーム再生成 = pdf-engine-core の判断点） |

**残りの優先順位**

1. ~~コード衛生・family 整合（TASKS.md §E / PDFfamily specs/06 参照）~~ **v0.7.0 で完了**
   （E-1〜E-6: パス検査・構造化エラー・stdout ガード・annotations・McpServer + Zod・決定論的出力）
2. **出力パイプライン Skill（pdf-publish）の実装**（TASKS.md M-7 / PDFfamily specs/07）—
   前提だった E-2（構造化エラー）が揃ったため、コード分岐ベースで着手可能
3. ~~tag_form_fields~~ **v0.8.0 で完了**。残: 画像の Figure + /Alt（B-4 と一体）
4. `.ttc` フェイス自動抽出、見出し/本文のフォント分け、画像・ヘッダー/フッター
5. Tier C（`edit_text` / `ensure_tagged` / `incremental_save`）= pdf-engine-core と合流。
   着手前に**署名付与の所在（pdf-signature-mcp 別出し案）を決着**させる（specs/05 §7-3）。
   `tag_form_fields` と `struct-append.ts` の一般化（Annot/Form）が ensure_tagged の足がかり
6. PDF/A 変換（サブセット命名の正規化を含む・外部ツール連携）

**受け入れ基準**（2026-07-17 改訂）

タグ付き出力・準拠性に関わる機能の受け入れ基準は **pdf-verify-mcp の `validate_conformance`**
（veraPDF 委譲。`flavour: "pdfua-1"` 等）とする。旧記述の「reader の `validate_tagged` /
`validate_metadata` で検証」は、判定責務の verify への移管（役割分担提案 M-1 完了・M-2 進行中）に
伴い**廃止**。reader は読み戻し（事実の観測）のみに使う。

**命名指針**

- create 系: `create_text_pdf` / `create_markdown_pdf` / `create_table_pdf`
- edit 系: `set_metadata` / `merge_pdfs` / `split_pdf` / `extract_pages` / `delete_pages` /
  `reorder_pages` / `rotate_pages` / `add_bookmarks` / `add_annotation` / `fill_form` /
  `flatten_form` / `add_watermark` / `attach_file` / `stamp_page_numbers`（以上すべて実装済み）

edit 系は「reader が返す構造情報（ページ数・フォームフィールド一覧等）を入力に取る」設計とし、
reader との連携を自然にする。

### 12.1 出力パイプライン（write → read-back → verify）

family の北極星（PDF 専門 LLM）に対して writer が担うのは「演習問題の生成」であり、
その成果物は **reader での読み戻しと verify での機械採点** を経て初めて学習データになる。
このループの編成は Skill が担う（`Document-Note/mcps/PDFfamily/specs/07-pdf-publish-skill.md`）。
writer 側の要件は次の 2 点。

- **合否は verify に委ねる**: writer は warnings（事実の報告）までに留め、準拠判定を自前で返さない
- **エラーを機械可読にする**: Skill が「署名ガードで停止 → `allowBreakingSignatures` を提案」の
  ような分岐をできるよう、構造化エラー（reader v0.6.0 と同じ code / next_actions /
  retryable 形式）を返す（**E-2 として v0.7.0 で実装済み**。§8 参照。ガード系は
  `next_actions` に解除フラグの具体例を同梱する）

---

## 付録 A: フォント埋め込み実測データ

| ケース | 結果 |
|--------|------|
| `.ttc` を直接 embed（subset:true） | 失敗（`createSubset is not a function`） |
| `.ttc` を直接 embed（subset:false） | 失敗（`layout is not a function`） |
| ToUnicode（pikepdf 検査） | 存在。`<0001> <65E5>`（日）等の正しい逆引き |
| `pdffonts` | `uni yes`（ToUnicode 認識）、`emb yes` |
| `qpdf --check` | 構造エラーなし |

### A.1 サブセット方式の比較（v0.3.0・NotoSansJP-Regular.otf 4.5MB / 本文 35 文字）

| 方式 | PDF サイズ | 描画 | 備考 |
|------|-----------|------|------|
| pdf-lib `subset:true`（fontkit） | 24KB | ✗ **全滅**（豆腐） | poppler: `Embedded font file may be invalid` → `Couldn't create a font`。Chrome/Firefox/Acrobat/Claude Desktop でも同様。ToUnicode は正しいため**抽出だけは通る**（検知困難） |
| pdf-lib `subset:false` | 3.9MB | ✓ 正常 | 正しいが実用外のサイズ |
| **harfbuzz(subset-font) + `subset:false`** | **14.5KB** | **✓ 正常** | **採用**。fontkit サブセットより小さく、かつ正しい |

> 注: TTF（可変フォント）でも fontkit サブセットは同様に破損した（一部文字のみ描画）。
> 問題は入力フォントの形式ではなく fontkit のサブセッタにある。

## 付録 B: 参考

- pdf-lib: https://pdf-lib.js.org/
- fontkit: https://github.com/foliojs/fontkit
- Noto Sans JP（SIL OFL）: https://fonts.google.com/noto/specimen/Noto+Sans+JP
- MCP 仕様: https://modelcontextprotocol.io/
