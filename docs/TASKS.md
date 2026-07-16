# pdf-writer-mcp 残タスクリスト

| 項目 | 内容 |
|------|------|
| 作成日 | 2026-07-16 |
| 最終更新 | 2026-07-16（v0.3.1 時点） |
| 基準 | `docs/DESIGN.md` §12（ロードマップ）／ `Document-Note/mcps/PDFfamily/specs/05-pdf-writer-mcp.md`（Tier 体系）／ `mcps/pdf-family-role-architecture.md`（責務分担提案） |
| 現状 | create 系 3 + 編集系 9 = **12 ツール**・**100 passed**・typecheck OK・npm 公開済み |

## 現状サマリ

- ✅ create 系: `create_text_pdf` / `create_markdown_pdf` / `create_table_pdf`
- ✅ 編集系 Tier A 第1波: `set_metadata` / `merge_pdfs` / `split_pdf` / `extract_pages` / `delete_pages` / `reorder_pages` / `rotate_pages`
- ✅ 日本語フォント埋め込み（**harfbuzz 事前サブセット + subset:false**。ADR-7 / ADR-8）
- ✅ グリフ欠落ポリシー（`onMissingGlyph`: error / replace / ignore）
- ✅ 署名ガード（`/ByteRange` 検知 → 既定エラー）
- ✅ vitest 8 ファイル（validation / layout / generate / extract / **render** / glyph / editor / page-spec）
- ✅ CI（typecheck + test、日本語フォント取得込み）・npm Trusted Publisher 公開

## A. 運用系

- [x] **A-1. docs のコミット & push**（2026-07-16）
- [x] **A-2. CI 整備（GitHub Actions）** — typecheck + vitest（Node 20/22）+ build。Noto Sans JP を取得し `TEST_FONT_PATH` を設定
- [x] **A-3. npm 公開** — v0.3.1 公開済み（Trusted Publisher / OIDC・provenance 付き）
- [ ] **A-4. コミット署名の運用決定** — サンドボックス経由のコミット 4 件が未署名（署名鍵は手元のみ）。方針: ①AI は stage のみ・手元で `git commit -S`（推奨）／②後で `git rebase --exec ... -S`（force push・provenance が指すコミットが消える点に注意）／③許容
- [ ] **A-5. 壊れたバージョンの deprecate** — 手元での実行待ち（下記コマンド）。0.2.0 の deprecate 文が「0.3.0 以降を」と壊れた版を案内しているため要修正
- [ ] **A-6. biome 導入の検討** — family 標準（verify 等）は `npm run check` を CI に含むが writer は未導入

## B. 機能系

> 優先順位メモ（2026-07-16）: DESIGN.md 旧版は「タグ付き PDF が優先1位」としていたが、
> **verify 側に PDF/UA 判定が無く受け入れ基準を機械検証できない**ため、
> Tier A 編集系を先行する方針に変更済み（`mcps/pdf-family-role-architecture.md` M-1 参照）。

- [x] **B-5a. 編集系 Tier A 第1波**（v0.2.0）
- [x] **B-5b. 編集系 Tier A 第2波**（v0.4.0）: `add_bookmarks` / `add_annotation`
- [ ] **B-5c. 編集系 Tier B**: `fill_form` / `flatten_form` / `add_watermark` / `attach_file`（PDF/A-3・電帳法）/ `stamp_page_numbers`
- [ ] **B-1. タグ付き PDF / PDF/UA** ← **前提（M-1）が揃ったので次の第一候補**
  - **受け入れ基準**: `validate_conformance` の `flavour: "pdfua-1"` が **veraPDF エンジンで違反 0 件**
    （shuji 環境には veraPDF が導入済み（`/opt/homebrew/bin/verapdf`）で、106 規則の権威ある判定が得られる。
    native の 12 規則通過は必要条件にすぎない）
  - **実測（writer v0.4.0 の出力を veraPDF ua1 で判定 = 10 違反）** — これがそのまま実装項目:

    | ISO 14289-1 条項 | 内容 | 対応 | native も検出 |
    |------------------|------|------|:---:|
    | 6.2-1 | MarkInfo /Marked = true | catalog に付与 | ✅ |
    | 7.1-11 | StructTreeRoot による論理構造 | 構造木の構築 | ✅ |
    | 7.1-8 | Metadata（/Type /Metadata・/Subtype /XML） | XMP 自前生成（pdf-lib に API 無し） | ✅ |
    | 7.1-10 | ViewerPreferences /DisplayDocTitle = true | catalog に付与 | ✅ |
    | **7.1-3** | **全コンテンツを Artifact かタグ付き実コンテンツに**（14 件 = 本文の全描画） | **BDC/EMC でのマーク付け。レイアウトエンジンの改修が必要 = B-1 の本丸** | ✗ |
    | **7.2-34** | **ページ内容の自然言語の決定** | `/Lang` は catalog だけでなく**構造要素単位**でも要求される | ✗（catalog のみ検査） |
    | **7.18.1-1** | **注釈は Annot タグで包む**（Widget/PrinterMark/Link 以外） | **`add_annotation` はタグ付き PDF では単体では不十分** | ✗ |
    | **7.18.3-1** | **注釈のあるページは /Tabs = /S** | ページ辞書に付与 | ✗ |
    | 7.2-2 | Outline エントリの自然言語 | しおりにも言語情報 | ✗ |
    | 7.2-24 | 注釈 /Contents の自然言語 | 同上 | ✗ |

  - Markdown の見出し / リスト / 表 → 構造タグへのマッピング（`ua-heading-hierarchy` / `ua-table-headers` も満たすこと）
  - ※ specs/05 ではタグ木の**保守**（`ensure_tagged`）は Tier C。新規生成時の付与はそれより軽い
  - ※ 太字の 4 件は M-1 の native 規則では検出できない（veraPDF でのみ判明）。
    native は「pdf-lib だけで検査できる範囲」に絞る設計なので、これは想定内の役割分担。
    ただし **7.18.1-1 は B-5b の add_annotation に後付けの課題を残した**点に注意
- [ ] **B-2. `.ttc` フェイス自動抽出** — Node 単体で完結（現状は検知してエラー）
- [ ] **B-3. 見出し / 本文のフォント分け** — 太字フェイス埋め込み。制約「インライン装飾は字面のみ」の解消
- [ ] **B-4. 画像埋め込み・ヘッダー / フッター**（ページ番号は B-5c の `stamp_page_numbers` に統合）
- [ ] **B-7. Tier C** — `edit_text` / `ensure_tagged` / `incremental_save`（署名保持）。pdf-engine-core と合流
- [ ] **B-6. PDF/A 変換** — サブセット名 `ABCDEF+` 接頭辞の正規化を含む（外部ツール連携検討）

## C. 既知の制約との対応

| 制約 | 対応タスク |
|------|-----------|
| インライン装飾が字面のみ | B-3 |
| `.ttc` 非対応 | B-2 |
| サブセット名接頭辞なし | B-6 |
| 署名済み PDF の編集で署名が無効化 | B-7（`incremental_save`）。暫定は署名ガードで防御済み |
| poppler の `Mismatch between font type` 警告 | 無害。対応不要 |

## D. family 連携（`mcps/pdf-family-role-architecture.md` 由来・writer 外だが writer に影響）

- [x] **M-1. verify に PDF/UA flavour 追加**（pdf-verify-mcp v0.6.0・2026-07-16）
  - `validate_conformance` に `flavour: "pdfua-1" / "pdfua-2"` を追加。veraPDF 委譲（`--flavour ua1`）＋ネイティブ 12 規則
  - reader の `validate_tagged` の上位互換（Figure の `/Alt` 実在・Link の `/Contents` は reader が見ていない）
  - **B-1 の受け入れ基準が機械検証可能になった**（上記 B-1 の表を参照）
  - **veraPDF 委譲が実環境で稼働確認済み**（106 規則）。native の 6 指摘は veraPDF の指摘と矛盾せず、
    ネイティブ規則の妥当性が裏付けられた。同時に native では届かない 4 項目も判明（B-1 の表の太字）
- [ ] **M-2. reader の `validate_tagged` / `validate_metadata` の deprecation 予告** — verify へ移管済みのため description で誘導 → 次メジャーで削除
- [ ] **M-6. specs/05 に Tier 0（create 系）を追記** — 実装済み MVP が上位仕様の Tier 体系に存在しない

## 依存関係

```mermaid
graph LR
  B5a[B-5a Tier A 第1波<br/>✅ v0.2.0] --> B5b[B-5b Tier A 第2波<br/>しおり・注釈]
  B5b --> B5c[B-5c Tier B<br/>フォーム・透かし・添付]
  M1[M-1 verify に PDF/UA 判定] --> B1[B-1 タグ付き生成]
  B5c --> B7[B-7 Tier C]
  B1 --> B7
  B7 --> B6[B-6 PDF/A]
  B2[B-2 .ttc 自動抽出] --> B3[B-3 フォント分け]
  B1 -.検証連携.-> V[pdf-verify-mcp]
  B5b -.構造情報入力.-> R[pdf-reader-mcp]
```
