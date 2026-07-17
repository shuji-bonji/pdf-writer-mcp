# SPEC-AUDIT — ISO 32000-2 条文照合記録

| 項目 | 内容 |
|------|------|
| 目的 | writer が書き出す構造を ISO 32000-2 の条文と照合し、veraPDF の目が届かない領域（タグ無し出力・編集系の辞書構造）の shall 違反を洗い出す |
| 手段 | pdf-spec-mcp（get_section / get_tables / search_spec）+ 実測（qpdf / pdftoppm / veraPDF） |
| Phase 1 | 編集系ツール群（2026-07-17 実施・是正は v0.9.2） |
| Phase 1.5 | **全 19 ツールの再照合**（2026-07-17。Phase 1 で未照合だったページ操作系・create 系・v0.9〜v0.12 の新規分） |
| 先行 | 増分更新は v0.9.1 で照合済み（§7.5.5 / §7.5.6 / §7.5.8.1 / §14.4 / §12.8.2.2） |

> [!WARNING]
> ## ⚠️ Phase 1 / 1.5 は「欠けた正典」に対して行われた（2026-07-18 判明）
>
> 照合手段の pdf-spec-mcp は当時 **v0.3.2** で、翌日に判明した抽出バグを抱えていた。
> **結論が誤りとは限らないが、根拠にした表に行が足りていなかった**ことは事実。
>
> | 下で照合した対象 | 当時 pdf-spec が見せていたもの | 実際 |
> |---|---|---|
> | add_annotation 共通エントリ → **Table 166** | **16 行**（`CA` / `BM` / `Lang` が欠落） | 19 行 |
> | add_annotation QuadPoints → **Table 182** | **1 行**（`QuadPoints` 行が丸ごと欠落） | 2 行 |
> | （全般）`get_requirements` | **表の中の shall を 1 件も返さない** | 2739 件（+46%） |
>
> - 当時の `search_spec("QuadPoints")` は「**12.5.6.11 Caret annotations**」と誤報告していた
>   （正しくは 12.5.6.10 の Table 182）。**この誤帰属は 0.4.1 でも未修正**（pdf-spec の S-8）。
>   search_spec の結果は節の当たりを付ける用途に留め、**必ず get_section / get_tables で裏を取る**こと
> - 5 件の違反は**表を手で読んで**見つけたもの。当時 `get_requirements` は表を走査していなかったので、
>   **系統的には探せていなかった**。ISO の表は要件語の宝庫であり（先頭 260 セクションの表 106 個中
>   301 セルが "shall"）、writer が扱うのはまさに Table 166 / 182 / 150 / 151 のような辞書エントリの表
>
> **→ pdf-spec 0.4.1 以降で再照合する価値が高い**（`get_requirements` が `source: "table"` /
> `table` / `key` 付きで表の要件を返すようになった）。焦点は「**旧正典に見えなかったもの**」。

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
| set_metadata | §14.3.3 | 留意 2 件: ①Info 辞書は PDF 2.0 で deprecated（本サーバは 1.7 出力のため適合。2.0 対応時は XMP 主体へ） ②**ギャップ**: XMP を持つ文書（tagged 出力等）で Info のみ更新すると dc:title 等と不整合になる | ②は **v0.10.0 で是正**（`syncXmpWithInfo`。pdfuaid/言語/作成日時は保持、同一 ref 差し替え。veraPDF ua1 維持を実測） |
| フォント埋め込み（ToUnicode/W/CIDFont） | §9.6–9.10 | 機械照合済み扱い — veraPDF 7.21.x（タグ付き経路）+ render/extract 回帰テストが同一コードパスを固定 | — |
| 決定論（E-6・内部規約） | — | 漏れ 2 件 — 注釈 /M と添付日時が `new Date()` 直書き | **v0.9.2 是正**: `outputDate()` に統一 + 再現性テスト |

## 是正の検証（v0.9.2）

- 回帰テスト `tests/spec-audit.test.ts`（AP 3 種・/Count 可視数とルート省略・名前ツリーソート・決定論）
- veraPDF ua1: タグ付き文書への注釈（新 AP 付き）で **COMPLIANT (106/106)** 維持
- qpdf --check クリーン・pdftoppm で AP の描画を目視確認（AP 無し時代は poppler で不可視だった）

## Phase 1.5 照合結果（全 19 ツール・2026-07-17）

Phase 1 は「編集系」を名乗りつつ**ページ操作系の文書レベルオブジェクトの扱いを見ていなかった**
（rotate の /Rotate しか見ていない）。全ツールを対象に再照合した結果、**重大な欠落を 1 件発見**。

### 🔴 重大: ページ操作系が文書レベルオブジェクトを黙って破棄する（v0.12.0 時点の実測）

| ツール | 実装 | StructTreeRoot | MarkInfo | XMP | 添付(/Names) |
|--------|------|:---:|:---:|:---:|:---:|
| `rotate_pages` | in-place（loadForEdit → 保存） | ✅ 保持 | ✅ | ✅ | ✅ |
| `merge_pdfs` | `PDFDocument.create()` + copyPages | ❌ **消失** | ❌ | ❌ | ❌ |
| `split_pdf` | 同上 | ❌ | ❌ | ❌ | ❌ |
| `extract_pages` | 同上 | ❌ | ❌ | ❌ | ❌ |
| `delete_pages` | 同上 | ❌ | ❌ | ❌ | ❌ |
| `reorder_pages` | 同上 | ❌ **消失**（実測確認） | ❌ | ❌ | ❌ |

**原因**: pdf-lib の `copyPages()` は**ページ内容のみ**を複製し、catalog 配下の文書レベル辞書
（StructTreeRoot / MarkInfo / Metadata / Names /AF）を運ばない。`copyDocumentInfo` は
Info 辞書だけを引き継いでいたが、それ以外は誰も引き継いでいなかった。

**仕様上の位置づけ**（重要な区別）:

- 出力が「タグ無し PDF」になること自体は**仕様違反ではない**（タグ無し PDF は合法）。
  §14.8.1 の「タグ付き PDF は MarkInfo/Marked=true を持つ shall」は、タグ付きを名乗る文書への要求
- **問題は「黙って落とす」こと**。writer の設計原則（署名ガード・flatten のタグ拒否＝
  「壊すなら明示する」）が、ページ操作にだけ適用されていない**内部不整合**
- 実害:
  1. **PDF/UA 準拠文書を merge/extract すると準拠が消える**（利用者は知らない）
  2. **PDF/A-3 の添付（電帳法の機械可読データ）が消える** — §6.8 の AFRelationship ごと
  3. XMP（pdfuaid / dc:title）が消え、Info だけ残るので **B-9 で直した Info↔XMP 整合が逆流**
  4. pdf-publish Skill が「create(tagged) → extract_pages → verify」の順で組むと **COMPLIANT が落ちる**

**対応方針（B-10 として起票）**:

| 対象 | 方針 |
|------|------|
| 単一文書内の操作（extract / delete / reorder / split） | catalog の文書レベル辞書（Metadata / Names / AF / MarkInfo）を**引き継ぐ**。StructTreeRoot は「残ページに対応する構造要素だけ」の再構築が要るため、初版は**警告 + 破棄**（`copyPages` の限界を明示） |
| `merge_pdfs` | 複数文書の構造木マージは重い（ParentTree のキー空間統合）。初版は**警告 + 破棄**。添付は名前衝突の解決込みで引き継ぎ可 |
| 共通 | 「入力がタグ付き / 添付付き / XMP 持ちだったが、出力では失われた」を **warnings で必ず報告**する（最優先・低コスト）→ **B-10a として実装済み**（2026-07-18・未リリース） |

#### B-10a 実施時の追加発見（2026-07-18・pdf-spec 0.4.1 の Table 29 で照合）

上の表は 4 要素（StructTreeRoot / MarkInfo / XMP / Names）を挙げていたが、Table 29
（§7.7.2 Document catalog dictionary・全 32 行）と突き合わせたところ**落ちているのは
それだけではなかった**。特に:

| 追加で判明した消失 | 条項 | 実害 |
|---|---|---|
| **`/AcroForm`** | §12.7.3 | Widget 注釈はページと一緒に複製されるが**フォーム辞書が消えるため孤児になる**。フィールドとして到達できず記入不可・値が描画されないことがある |
| **`/OCProperties`** | §8.11.4.2 | **損失ではなく仕様違反になりうる唯一の項目**。R-8.11.4.2-2 は「This dictionary **shall** be present if the PDF file contains any optional content」と要求する。複製ページが OC を参照したまま辞書だけ落ちると、プロセッサは光学的内容を無視する（＝隠すべき層が出る／出すべき層が消える）。実装は `usesOptionalContent()` で複製ページの OC 使用を実測し、使っていれば shall 違反として報告する |
| `/OutputIntents` | §14.11.5 | PDF/A・PDF/X が要求する出力インテントが消える |
| `/Lang` | §14.9.2 | 言語が unknown になる（PDF/UA-1 7.2） |
| `/ViewerPreferences` | §12.2 | DisplayDocTitle が消える（PDF/UA-1 7.1） |
| `/PageLabels` / `/Dests` / `/OpenAction` / `/Outlines` | §12.4.2 / §12.3.2.4 / §12.6.2 / §12.3.3 | ページ番号ラベル・名前付き宛先・開き先・しおりが消える |

**教訓（Phase 1 / 1.5 の警告と同型）**: Phase 1.5 は「実測でツールを 1 つずつ見る」形で
やったため、**catalog にあり得るものの全体像（＝表）と突き合わせていなかった**。
条文の表を正典として引くと、実測で気づいた 4 件の外側に 9 件あった。

### 他ツールの照合結果（Phase 1.5・追加分）

| 対象 | 条項 | 判定 |
|------|------|------|
| create 系 3（Tier 0） | §7.7.3（ページツリー）/ §9.6–9.10（フォント）/ §14.8（タグ） | 適合 — veraPDF ua1 106/106 が継続的に担保。`tagged` 時のフォント埋め込み警告も v0.8.0 で追加済み |
| `rotate_pages` | §7.7.3.3 Table 31 | 適合（mod 360・90 の倍数・in-place で catalog 保持） |
| `ensure_tagged`（v0.12.0） | §14.8.2（BDC/EMC・MCID）/ §14.7.4.4（ParentTree）/ §14.8.1 | 適合 — veraPDF 実測 COMPLIANT。P で包む設計判断（Artifact 不採用）も §14.8.2.2 の趣旨に合致 |
| 増分更新（v0.9〜v0.12） | §7.5.5 / §7.5.6 / §7.5.8.1 / §14.4 / §12.8.2.2 | 適合（v0.9.1 で是正済み。v0.11.1 で stream 形式の trailer 引き継ぎも修正） |
| `fill_form` / `flatten_form` / `tag_form_fields` | §12.7 / §14.8.4（Form）/ Table 166 | 適合（Phase 1 + v0.8.0 で照合済み） |

### DocMDP 解釈の family 内整合（verify Issue #5 との突き合わせ）

verify #5 が「**§12.8.2.2 は P=1 でも DSS / 文書タイムスタンプの増分更新を例外として認める**」と指摘。
writer の `assertDocMdpAllows` は注釈・メタデータ・構造・描画の追記を拒否するのみで **DSS/DTS を扱わない**ため
実害は無いが、条文解釈を family で揃えるためコメントに例外の存在を明記する（B-11）。

## ツール側へのフィードバック

- **pdf-spec-mcp**: ページ跨ぎの表の行が抽出から欠落する（Table 182 の QuadPoints 行、p.507→508）。
  `docs/family-standards-alignment.md`（pdf-spec 側）に記録

## 未実施（Phase 2 以降）

- reader の観測ロジック照合（§9 フォント = inspect_fonts バグ修正と同時に）
- verify native 規則の条文再確認（低優先・veraPDF が権威）
- create 系レイアウト（コンテンツストリーム演算子）— veraPDF 済みのため低優先
