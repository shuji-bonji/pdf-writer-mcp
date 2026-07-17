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
>
> ### ✅ 再照合の結果（2026-07-18・下の「Phase 2 照合結果」に詳細）
>
> **警告は正しかったが、結論はほぼ無傷だった。**
> - 欠けていた Table 166 の 4 行（`ca`/`CA`/`BM`/`Lang`）は**全て Optional / PDF 2.0** で影響なし
> - Table 182 の QuadPoints は判断を変えず、**表現のみ**「事実上適合」→「既知の意図的逸脱」に訂正
> - **`get_requirements` が表を走査しなかった件は当たり**だった — 表由来要件で走査して
>   **新規の shall 違反を 1 件発見**（§12.5.6.2: 段落区切りが LF のまま）
>
> つまり「根拠が欠けていた」のは事実だが、**手で表を読んだ Phase 1 の判断は堅かった**。
> 危うかったのは「**探していない領域**」の方だった。

## 方針

- タグ付き出力（PDF/UA-1）は veraPDF 106 規則が事実上の条文照合器 → 対象外
- verify の native 規則は clause ID 付き実装 + veraPDF が権威 → 対象外
- **本丸はタグ無し出力と編集系の辞書構造** — 機械検証を通らないため条文照合が唯一の検査

## Phase 1 照合結果（編集系）

| 対象 | 条項 | 判定 | 対応 |
|------|------|------|------|
| add_annotation 共通エントリ（Subtype/Rect/Contents/M/F/C/P） | §12.5.2 Table 166 | 適合（M は §7.9.4 日付文字列、C は RGB 3 成分） | — |
| **add_annotation /AP** | Table 166 AP | **違反（shall）** — 「writer は書き込み時に外観辞書を含めなければならない。例外は退化 Rect と Popup/Projection/Link のみ」。32000-1 では Optional だったため見逃していた（PDF/UA-1 = 32000-1 ベースの veraPDF では検出されない） | **v0.9.2 是正**: text（付箋アイコン）/ highlight（Multiply ブレンド）/ square（枠 + 塗り）の Form XObject を生成。veraPDF ua1 106/106 維持・poppler での描画を目視確認 |
| add_annotation QuadPoints（highlight） | §12.5.6.10 Table 182 | ~~事実上適合~~ → **既知の意図的逸脱**（Phase 2 で表現を訂正）。実装は業界慣行の Z 順（左上→右上→左下→右下）。ISO は counterclockwise を **shall** で要求する（R-12.5.6.10-5。新正典で表由来要件として可視化）が、全主要ビューアが Z 順を要求する業界公知の齟齬であり、条文どおりに書くと**実際に表示が壊れる** | 現状維持（相互運用を優先した意図的逸脱であることを明示） |
| text の /Name（アイコン名） | §12.5.6.4 **Table 175**（Phase 1 は「Table 177」と誤記。Phase 2 で訂正） | 適合（R-12.5.6.4-7 の標準 7 名 Comment/Key/Note/Help/NewParagraph/Paragraph/Insert のみ受け付け） | — |
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
| 単一文書内の操作（extract / delete / reorder / split） | catalog の文書レベル辞書（Metadata / Names / AF / ~~MarkInfo~~）を**引き継ぐ**。StructTreeRoot は「残ページに対応する構造要素だけ」の再構築が要るため、初版は**警告 + 破棄**（`copyPages` の限界を明示） |
| `merge_pdfs` | 複数文書の構造木マージは重い（ParentTree のキー空間統合）。初版は**警告 + 破棄**。添付は名前衝突の解決込みで引き継ぎ可 |
| 共通 | 「入力がタグ付き / 添付付き / XMP 持ちだったが、出力では失われた」を **warnings で必ず報告**する（最優先・低コスト）→ **B-10a として実装済み**（2026-07-18・未リリース） |

> [!IMPORTANT]
> ### ⚠️ 上の初版計画は一部が誤り（B-10b の実装時に判明・2026-07-18）
>
> **「MarkInfo を引き継ぐ」はそのまま実行できない。** `MarkInfo/Marked=true` は
> 「この文書はタグ付き PDF である」という**宣言**であり、StructTreeRoot（B-10c 待ち）を
> 運べない段階でこれだけ運ぶと、**構造木の無いタグ付き文書**という矛盾した出力になる。
>
> **XMP も同じ理由で条件付き。** `pdfuaid:part=1` を含む XMP を運ぶと、出力は PDF/UA 準拠を
> **偽る**ことになる。しかもこれは「黙って落とす」より**悪化**する — 準拠宣言があると
> veraPDF はその flavour で検証しに行き、**落ちる**（今は宣言が無いので「未宣言」で済む）。
> **偽の準拠主張は、準拠の消失より有害。**
>
> → B-10b の選定基準は「**引き継げるか**」ではなく「**引き継いで嘘にならないか**」に改めた。
> 詳細は下の「B-10b 実装結果」。

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

## Phase 2 照合結果（新正典 pdf-spec 0.4.1 での再照合・2026-07-18）

冒頭の警告への回答。**Phase 1 / 1.5 の結論は、1 件を除いて新正典でも維持された**。
焦点は「旧正典に見えなかったもの」＝ `get_requirements` が返す `source: "table"` の要件。

### 欠けていた行の答え合わせ（冒頭の表に対応）

| 旧正典で欠けていたもの | 新正典で確認した結果 |
|---|---|
| **Table 166 が 16 行**（`ca` / `CA` / `BM` / `Lang` 欠落） | **19 行を全数確認 → 影響なし**。4 行とも Optional で、`BM` / `Lang` は PDF 2.0（writer は 1.7 出力）。`ca`/`CA` の shall（"The specified value shall not be used if the annotation has an appearance stream"）は**読み手への要求**。Phase 1 の結論は維持 |
| **Table 182 の QuadPoints 行が丸ごと欠落** | 行を確認。counterclockwise は **R-12.5.6.10-5 の shall** として可視化された。判断は変えない（全ビューアが Z 順を要求し、条文どおりだと表示が壊れる）が、**「事実上適合」→「既知の意図的逸脱」と表現を訂正**（上の表） |
| **`get_requirements` が表の shall を 1 件も返さない** | 表由来要件で走査した結果、**新たに 1 件の違反を発見**（下記 §12.5.6.2）。「系統的には探せていなかった」という懸念は当たっていた |

### 🔴 新規発見: 注釈テキストの段落区切りが LF のまま（is-a shall 違反）

| 対象 | 条項 | 判定 | 対応 |
|------|------|------|------|
| **add_annotation `/Contents`** | §12.5.6.2（**R-12.5.6.2-7**・shall） | **違反** — 「段落を区切るときは CARRIAGE RETURN (0Dh) を使わなければならず、例えば LINE FEED (0Ah) を使ってはならない」。MCP の引数は JSON なので利用者が書くのは `\n` であり、`PDFHexString.fromText` がそれを **000A のまま**書いていた（実測: `<FEFF...0031**000A**006C...>`） | **是正**: `normalizeAnnotationText()` で `\r\n` / `\n` / `\r` → `\r` に正規化（CRLF は CR 1 つに畳む）。`spec-audit.test.ts` で固定 |

**なぜ veraPDF で見つからなかったか**: PDF/UA-1 の 106 規則は**文字列の中身までは見ない**。
辞書構造と存在は見るが「/Contents の中の改行コード」は対象外。
**条文照合でしか見つからない類**であり、SPEC-AUDIT の存在意義そのもの。

### 実測で否定した仮説（＝対応不要）

条文から「違反しているのでは」と疑い、実測して**シロだった**もの。記録して再調査を防ぐ。

| 疑い | 条項 | 実測結果 |
|---|---|---|
| `extract_pages "1,1"` が同一ページへの複数参照を作る | **R-7.7.3.3-3**（shall not: "A page tree shall not contain multiple indirect references to the same page object"） | **適合**。pdf-lib の `copyPages(src, [0,0])` は**別オブジェクトを 2 つ作る**（`/Kids = [4 0 R, 5 0 R]`）。参照は共有されない |
| highlight の Multiply を AP 内 ExtGState でやるのは誤りで、注釈の `/BM` を使うべき | §12.5.5（R-12.5.5-10 / -12） | **適合**。AP に `/Group` が無い → **非隔離グループ**として扱われ（R-12.5.5-10）、初期バックドロップにページ内容を継承するため、group 内の Multiply が下のテキストに効く。注釈の `/BM` は **PDF 2.0** であり 1.7 出力では使えない。ExtGState 方式が唯一かつ正しい手段（Phase 1 の pdftoppm 目視とも一致） |
| writer が空の `/Contents` 配列を作る | **R-7.7.3.3-26**（shall not: "PDF writers shall not create a Contents array containing no elements"） | **適合**。`ensure_tagged` は BDC + EMC の 2 要素を必ず入れ、他は配列を新設しない |

### 変更なしを確認したもの

| 対象 | 条項 | 判定 |
|---|---|---|
| `add_bookmarks`（/Count 可視数・ルート省略・Parent/Prev/Next/First/Last） | §12.3.3 R-12.3.3-13 / -16 / -21 ほか表由来 18 件 | 適合（v0.9.2 の是正が新正典でも正しい） |
| `rotate_pages` /Rotate | §7.7.3.3 **R-7.7.3.3-28**（"The value shall be a multiple of 90"） | 適合（mod 360 正規化・入力は 90/180/270 のみ） |
| text 注釈の /Name | §12.5.6.4 R-12.5.6.4-7 | 適合（標準 7 名） |
| square 注釈の /IC・inscribed 描画 | §12.5.6.8 R-12.5.6.8-3 / -6 | 適合（`rectangle(lw/2, lw/2, w-lw, h-lw)` で Rect 内に収まる・IC は 0.0〜1.0 の 3 成分） |
| `/AP` の /N が単一ストリーム（/AS 不要） | Table 166 `AS`（"Required if the appearance dictionary AP contains one or more subdictionaries"） | 適合（subdictionary ではないので /AS は不要） |

## Phase 3 照合結果（フォーム §12.7 / 添付 §7.11・§14.13・2026-07-18）

Phase 2 で残した 2 領域。**新たに 2 件の shall 違反を発見・是正**。
どちらも「pdf-lib が書いてくれる」と信じて**中身を見ていなかった**箇所だった。

### 🔴 新規発見 1: 添付の `/Params` の日時が「PDF の生成時刻」だった

| 対象 | 条項 | 判定 | 対応 |
|------|------|------|------|
| **attach_file `/Params`** | Table 45 + **R-14.13.2-2**（shall） | **違反** — Table 45 は `ModDate` を「**埋め込まれたファイル**が最後に変更された日時」と定義し（AF では**必須**）、§14.13.2 は「ModDate の値は**ソースファイルの最終更新日時**でなければならない」と明示する。writer は `outputDate()`（＝ PDF 生成時刻）を両方に焼き込んでいた。**実測**: mtime が `2020-03-04` のファイルを添付 → `/Params << /CreationDate (D:20260717212926Z) /ModDate (D:20260717212926Z) >>` | **是正**: `attachmentDates()` が `stat()` で mtime / birthtime を読む |

**実害**: PDF/A-3・電帳法では**添付データの更新日時そのものが証跡**。「この CSV は PDF を
作った瞬間に更新された」という嘘を全添付に書いていた。

**E-6（決定論）との緊張と、その解き方**: ソースの mtime を使うと git checkout ごとに
バイト列が変わる（git は mtime を保存しない）。`SOURCE_DATE_EPOCH` は
**「再現性を正確さより優先する」という明示的な opt-in** なので、**設定時のみ固定値で上書き**する。
reproducible-builds.org の慣習は `min(mtime, epoch)` の clamp だが、それだと `mtime < epoch` のとき
出力が checkout 依存のままになり、config.ts が約束する「同一入力 → 同一バイト列」を守れない。

### 🔴 新規発見 2: `/DA` が参照するフォントを `/DR` から解決できない

| 対象 | 条項 | 判定 | 対応 |
|------|------|------|------|
| **fill_form / flatten_form の外観再生成** | **R-12.7.4.3-7**（shall）+ Table 224 `DR` | **違反** — 「`/DA` が指定するフォント値は `/DR` から参照される既定リソース辞書の Font エントリのリソース名と**一致しなければならない**」。Table 224 の `/DR` は「**最低限 Font エントリを含まなければならない**」。pdf-lib の `updateFieldAppearances` は `/DA` を書くが **`/DR` を作らない**。**実測**: 終端フィールド `/DA (0 0 0 rg /NotoSansJP-Regular 18 Tf)` に対し AcroForm は `<< /Fields [7 0 R] >>` のみ → 参照先が存在せず shall は**充足不可能** | **是正**: `ensureDefaultResources()` が `/DR /Font` に埋め込みフォントを登録（同名は残す＝R-12.7.4.3-13） |

**実害（落とし穴 0-a のビューア版）**: 外観ストリームは自前で作ってあるので普通に開く分には
描画される。しかし**ビューアが外観を再生成**すると `/DA` のフォント名を解決できず既定フォント
（Helvetica）に落ち、**日本語が豆腐になる**。CLAUDE.md 落とし穴 0-a は「pdf-lib に再生成させるな」
だったが、**再生成の主体はビューアでもありうる**という抜けだった。

**なぜ検知できなかったか**: `form.test.ts` は「値が入るか」「抽出できるか」「タグ付きが壊れないか」を
見ていたが、**AcroForm 辞書そのものを一度も検査していなかった**。veraPDF ua1 も COMPLIANT を返す
（PDF/UA は /DR を要求しない）。

### 変更なしを確認したもの（Phase 3）

| 対象 | 条項 | 判定 |
|---|---|---|
| 添付 `/Subtype` の MIME | **R-7.11.4.1-11**（"characters not permitted in names shall use the 2-character hexadecimal code format"） | 適合。**実測**: `text/csv` → `/text#2Fcsv` と `/` が `#2F` にエスケープされている（pdf-lib の `PDFName` が処理） |
| 添付の MIME 既定 | **R-14.13.2-4**（"If the MIME type is not known, the value \"application/octet-stream\" shall be used"） | 適合（`DEFAULT_MIME`） |
| 添付 `/Params` の存在 | **R-7.11.4.1-12**（AF では必須） | 適合（pdf-lib が書く。中身の日時は上記のとおり是正） |
| フィールド `/TU` | R-12.7.4.1-12 | 適合（`tag_form_fields` が人間可読名を入れる） |
| `NeedAppearances` | Table 224（"A PDF writer shall include this key, with a value of true, if it has not provided appearance streams for all visible widget annotations"） | 適合 — writer は**全 Widget の外観を必ず自前生成する**ので、この key を書く条件に当たらない。2.0 で deprecated でもある |
| チェックボックス / ラジオの `/DA (… /dummy__noop 0 Tf)` | R-12.7.4.3-7 の**射程外** | 対応不要。pdf-lib はチェック印を**字形でなくベクタで描く**ためフォントを渡さず、`font?.name ?? 'dummy__noop'`（appearances.js）でプレースホルダを書く。解決先の無いフォント名だが、**§12.7.4.3 は "Variable text" の節**であり Table 228 も「可変テキストを含むフィールドの共通エントリ」。Btn は可変テキストではないので /DA を要求する条項が無く、解決先も要らない。**回帰テストの対象も Tx / Ch に限定している**（手心ではなく条文の射程） |

## B-10b 実装結果（引き継ぎ・2026-07-18）

選定基準は「**引き継いで嘘にならないか**」（上の IMPORTANT 参照）。`services/doc-level.ts` の
`carryDocumentLevel`。オブジェクト複製は pdf-lib の `PDFObjectCopier` に委譲する
（参照グラフを辿るので、添付ストリームのような間接参照の塊も 1 回で運べる）。

| catalog キー | 引き継ぐ | 理由 |
|---|:---:|---|
| `Names` /EmbeddedFiles | ✅ | **最大の収穫** — PDF/A-3 の機械可読データ（電帳法）が生き残る。実測: `extract_pages` 後も添付名・`/AFRelationship`・**中身のバイト列**まで一致 |
| `AF` | ✅ | 添付との対 |
| `Lang` | ✅ | ページ参照に依存しない |
| `ViewerPreferences` | ✅ | 同上 |
| `OutputIntents` | ✅ | 同上（PDF/A・PDF/X の色特性） |
| `Metadata`(XMP) | **条件付き** | 準拠宣言（`pdfuaid`/`pdfaid`）を**含まない場合のみ**。含む場合は運ばず、理由を warnings で説明する |
| `StructTreeRoot` / `MarkInfo` | ❌ | 構造木の再構築が要る（B-10c）。MarkInfo だけ運ぶと嘘になる |
| `AcroForm` | ❌ | `/Fields` が元のフィールド辞書を指す。複製後オブジェクトへの張り替えが要る |
| `OCProperties` | ❌ | `/OCGs` が元の OCG を指す。同上 |
| `PageLabels` / `Dests` / `OpenAction` / `Outlines` | ❌ | **ページ番号・ページ参照に依存する**。extract / delete / reorder / merge はページ集合と順序を変えるため、そのまま運ぶと宙吊りか誤った位置を指す |

- **B-10a の警告は実測ベースなので、引き継いだ要素については自動的に黙る**。設計の狙いどおり
  （「copyPages は落とす」を前提に焼き込んでいたら、ここで嘘の警告が残っていた）

### 実装中に見つけた自分の穴: 先勝ちが黙って捨てていた

`merge_pdfs` は**先勝ち**（先頭ファイルの文書レベル要素を採る）。当初これを
「2 件目以降で落ちたものは B-10a の警告が実測して報告する」と書いたが、**これは誤り**だった。

`docLevelLossWarnings` は「**その機能が出力にあるか**」しか見ない。つまり
**入力 1 の添付さえ運ばれていれば `embeddedFiles` は「有り」**と判定され、
**入力 2 の添付が消えても黙る**。機能単位であってファイル単位ではないため、
「引き継ぎを増やしたことで、かえって警告が消えた」という**退行**を作りかけていた。

→ `carryDocumentLevel` が `skipped`（入力は持っていたが出力に既にあったので採らなかったキー）を
返し、`merge_pdfs` が `firstWinsWarning` で**どのファイルの何を採らなかったか名指しで報告**する。
`doc-level.test.ts` の「2 件目以降の添付を採らなかったことを黙らせない」が回帰ガード。

**教訓**: 「壊すなら明示する」は**引き継ぎを実装したあとの方が破りやすい**。
「運べた」ことに満足すると、運べなかった分の報告が抜ける。
なお添付の**本当のマージ**（名前衝突の解決込み・監査の初版計画にあった）は未実装で、
B-10c 以降の課題として残っている。

## 未実施（Phase 5 以降）

- reader の観測ロジック照合（§9 フォント = inspect_fonts バグ修正と同時に）
- verify native 規則の条文再確認（低優先・veraPDF が権威）
- create 系レイアウト（コンテンツストリーム演算子）— veraPDF 済みのため低優先

## Phase 4 照合結果（§12.7.5 フィールド種別ごとの表・2026-07-18）

Phase 3 で残した最後の領域。**違反なし。** 3 件とも実測で確認した。

| 対象 | 条項 | 実測 |
|---|---|---|
| checkbox の `/V` と `/AS` | **R-12.7.5.2.3-5**（"The value of the V key shall also be the value of the AS key"） | 適合 — `/V /Yes` に対し widget `/AS /Yes` |
| radio の `/V` と `/AS` | **R-12.7.5.2.4-3**（同上） | 適合 — `/V /1` に対し選択側 widget が `/AS /1`、非選択側が `/AS /Off`（各 widget の AS が自分の状態を選ぶ、という標準的な読み） |
| optionlist（複数選択）の `/I` | **R-12.7.5.4-18**（"This entry shall be used … when the value of the choice field is an array"） | 適合 — `/V [a c]` に対し **`/I [0 2]`** が入る（pdf-lib が設定する） |
