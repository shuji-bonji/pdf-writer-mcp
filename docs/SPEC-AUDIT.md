# SPEC-AUDIT — ISO 32000-2 条文照合記録

| 項目 | 内容 |
|------|------|
| 目的 | writer が書き出す構造を ISO 32000-2 の条文と照合し、veraPDF の目が届かない領域（タグ無し出力・編集系の辞書構造）の shall 違反を洗い出す |
| 手段 | pdf-spec-mcp（get_section / get_tables / search_spec）+ 実測（qpdf / pdftoppm / veraPDF） |
| Phase 1 | 編集系ツール群（2026-07-17 実施・是正は v0.9.2） |
| 先行 | 増分更新は v0.9.1 で照合済み（§7.5.5 / §7.5.6 / §7.5.8.1 / §14.4 / §12.8.2.2） |

## 方針

- タグ付き出力（PDF/UA-1）は veraPDF 106 規則が事実上の条文照合器 → 対象外
- verify の native 規則は clause ID 付き実装 + veraPDF が権威 → 対象外
- **本丸はタグ無し出力と編集系の辞書構造** — 機械検証を通らないため条文照合が唯一の検査

## Phase 1 照合結果（編集系）

| 対象 | 条項 | 判定 | 対応 |
|------|------|------|------|
| add_annotation 共通エントリ（Subtype/Rect/Contents/M/F/C/P） | §12.5.2 Table 166 | 適合（M は §7.9.4 日付文字列、C は RGB 3 成分） | — |
| **add_annotation /AP** | Table 166 AP | **違反（shall）** — 「writer は書き込み時に外観辞書を含めなければならない。例外は退化 Rect と Popup/Projection/Link のみ」。32000-1 では Optional だったため見逃していた（PDF/UA-1 = 32000-1 ベースの veraPDF では検出されない） | **v0.9.2 是正**: text（付箋アイコン）/ highlight（Multiply ブレンド）/ square（枠 + 塗り）の Form XObject を生成。veraPDF ua1 106/106 維持・poppler での描画を目視確認 |
| add_annotation QuadPoints（highlight） | §12.5.6.10 Table 182 | **事実上適合** — 実装は業界慣行の Z 順（左上→右上→左下→右下）。ISO 本文は counterclockwise と書くが、全主要ビューアが Z 順を要求する業界公知の齟齬であり、相互運用上は Z 順が正 | 現状維持（注記のみ） |
| text の /Name（アイコン名） | §12.5.6.4 Table 177 | 適合（標準 7 名のみ受け付け） | — |
| **add_bookmarks /Count** | §12.3.3 Table 150/151 | **違反** — ①項目 /Count は「可視な子孫数」（閉じた枝の中身は数えない）べき所を全子孫数で計算 ②ルート /Count は「開いた項目が無ければ省略しなければならない」のに常時書き込み | **v0.9.2 是正**: Table 151 の再帰手続きどおり可視数を計算。開項目なしでルート /Count 省略 |
| add_bookmarks 構造（Title/Parent/Prev/Next/First/Last/Dest） | §12.3.3 / §12.3.2.2 | 適合（間接参照・双方向リンク・XYZ null） | — |
| **attach_file 名前ツリー** | §7.9.6 | **違反（shall）** — キーは辞書順であるべき所、pdf-lib の attach は挿入順（遅延埋め込みのため実体化前のソートは無効なことも実測） | **v0.9.2 是正**: `doc.flush()` で実体化後にキーをソート |
| attach_file 構造（EF/UF/Params/AF/AFRelationship） | §7.11.3–4 / §14.13 | 適合（pdf-lib 委譲。AFRelationship は有効値の部分集合） | — |
| fill_form / flatten_form | §12.7 | 適合 — /V は型別 setter、外観は自前フォントで再生成（Widget の Table 166 AP 義務も充足）。NeedAppearances（2.0 で非推奨）不使用 | — |
| rotate_pages | §7.7.3.3 Table 31 | 適合（mod 360 正規化済み・90 の倍数） | — |
| set_metadata | §14.3.3 | 留意 2 件: ①Info 辞書は PDF 2.0 で deprecated（本サーバは 1.7 出力のため適合。2.0 対応時は XMP 主体へ） ②**ギャップ**: XMP を持つ文書（tagged 出力等）で Info のみ更新すると dc:title 等と不整合になる | ②は **B-9** としてタスク化（XMP 併記更新） |
| フォント埋め込み（ToUnicode/W/CIDFont） | §9.6–9.10 | 機械照合済み扱い — veraPDF 7.21.x（タグ付き経路）+ render/extract 回帰テストが同一コードパスを固定 | — |
| 決定論（E-6・内部規約） | — | 漏れ 2 件 — 注釈 /M と添付日時が `new Date()` 直書き | **v0.9.2 是正**: `outputDate()` に統一 + 再現性テスト |

## 是正の検証（v0.9.2）

- 回帰テスト `tests/spec-audit.test.ts`（AP 3 種・/Count 可視数とルート省略・名前ツリーソート・決定論）
- veraPDF ua1: タグ付き文書への注釈（新 AP 付き）で **COMPLIANT (106/106)** 維持
- qpdf --check クリーン・pdftoppm で AP の描画を目視確認（AP 無し時代は poppler で不可視だった）

## ツール側へのフィードバック

- **pdf-spec-mcp**: ページ跨ぎの表の行が抽出から欠落する（Table 182 の QuadPoints 行、p.507→508）。
  `docs/family-standards-alignment.md`（pdf-spec 側）に記録

## 未実施（Phase 2 以降）

- reader の観測ロジック照合（§9 フォント = inspect_fonts バグ修正と同時に）
- verify native 規則の条文再確認（低優先・veraPDF が権威）
- create 系レイアウト（コンテンツストリーム演算子）— veraPDF 済みのため低優先
