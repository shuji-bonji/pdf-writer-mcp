# SPEC-REAUDIT 2026-07-19 — pdf-spec-mcp 0.4.4 正典での全ツール再照合

| 項目 | 内容 |
|------|------|
| 目的 | pdf-spec-mcp **0.4.4**（`spec ⇄ reader` / `spec ⇄ verify` の相互検証を経た最新正典）で、writer 全 19 ツールが ISO 32000-2:2020 (EC3) と乖離していないかを再照合する。未着手タスク（B-10c / B-12 / B-2 / B-3 / B-4 / B-8）の計画も仕様と突き合わせる |
| 対象 | pdf-writer-mcp **v0.13.0**（公開済み） |
| 手段 | pdf-spec-mcp 0.4.4（get_requirements / get_tables / get_section / search_spec）+ 実測（実際に生成した PDF を qpdf --qdf で展開して辞書を目視・qpdf --check・pdf-lib ソース読解） |
| 前回 | `docs/SPEC-AUDIT.md` Phase 1〜4（正典は 0.4.1。0.4.2〜0.4.4 の修正は**新規テキストゼロ・重複除去と再帰属のみ**のため、Phase 2〜4 の結論の根拠テキスト自体は変わっていない） |
| 結論 | **Phase 1〜4 の結論は 0.4.4 正典でも維持**。ただし本監査で**新規発見 5 件**（High 2・Medium 2・Low 1）。うち 1 件は条文照合ではなく「正典で当たりをつけて実測で開いた」ことで見つかった**出力破壊バグ**（W-1） |

## 結論サマリ

| ID | 深刻度 | 対象 | 一言で | 条項 |
|----|--------|------|--------|------|
| **W-1** | 🔴 **High（バグ）** | merge/split/extract/delete/reorder（B-10b の carry） | 準拠宣言なしの XMP を持つ入力で、**出力 PDF が壊れる**（qpdf が /Root を解決できない） | R-7.3.8.1-5 / R-7.7.2-22 |
| **W-2** | 🔴 High（適合） | create 系 3 + stamp_page_numbers（フォント埋め込み全経路） | CFF (.otf) を **CIDFontType2 + FontFile2** で埋め込んでいる（中身は OTTO）。既知の「poppler 警告＝無害」の正体で、実は **shall 違反** | R-9.9.1-33 / -34（Table 124） |
| **W-3** | Medium（適合） | 同上 | サブセットフォントの BaseFont/FontName に **`ABCDEF+` タグが無い**（実測: `NotoSansJP-Regular-7572`）。B-8（PDF/A）待ち扱いだったが **32000-2 本体の shall** | R-9.9.2-2 / -3 |
| **W-4** | Medium（適合） | .ttf 入力の埋め込み | FontFile2 に **Length1 が無い**（pdf-lib は書かない。TrueType では Required） | Table 125 `Length1` |
| **W-5** | Low（潜在） | create 系 / set_metadata | Info と XMP の日時が**別々の `outputDate()` 呼び出し**で、秒境界を跨ぐと「fully equivalent」を破りうる | R-14.3.4-2 / -5 |

未着手タスクの計画に**仕様との矛盾は見つからなかった**（B-8 のみ「pdf-spec のコーパス外で検証不能」という但し書きが付く）。詳細は後半。

## 正典差分（0.4.1 → 0.4.4）と再照合の焦点

| 版 | 修正 | writer 監査への影響 |
|----|------|---------------------|
| 0.4.2 | S-8（search の帯誤帰属）/ S-4（表断片の連結） | search で当たりを付けて section で裏取りする流れが正常化。S-4 で変化した表（Table 54/126）は writer 非関連 |
| 0.4.3 | S-9（ページ跨ぎの二重帰属除去）/ S-10（pageRange.end） | 0.4.1 は「過剰に見せる」方向のバグだったため、**前回の結論を無効にする欠落はない** |
| 0.4.4 | SV-1（**親節指定でサブツリー全体を返す**）/ 見出し境界（再帰属 70 件） | **前回のクエリ経路で見えなかったものが見える**ようになった。実証: `get_requirements("12.8.2.2")` が Table 257 の子孫要件（P=1/2/3・DSS/DTS 例外）を返す |

新規テキストはゼロなので、再照合の焦点は「条文が変わったか」ではなく「**前回の引き方では見えていなかった要件が、writer の挙動と矛盾しないか**」。方針は前回と同じく、veraPDF が見ない領域（タグ無し出力・編集系の辞書構造・委譲先が書く辞書）を優先した。

## 新規発見の詳細

### W-1 🔴 carryDocumentLevel が XMP ストリームを catalog に直接埋め込み、出力を破壊する（v0.13.0 リグレッション）

| 項目 | 内容 |
|------|------|
| 条項 | **R-7.3.8.1-5**「All streams **shall** be indirect objects」＋ **R-7.7.2-22**（Table 29 `Metadata`: shall be an indirect reference） |
| 原因 | `services/doc-level.ts` の `carryXmp()`（371 行）と汎用経路（320 行）が、ref を `lookup()` で**解決してから** `PDFObjectCopier.copy()` に渡している。copy は「渡された型と同じ型」を返すため、**新しい間接参照ではなく複製されたストリーム実体**が返り、それを `catalog.set()` している。結果、catalog の `/Metadata` 値が**直接オブジェクトのストリーム**になる |
| 実測 | tagged 出力の XMP から準拠宣言を無効化（バイト長を変えない置換で `pdfuaid` → `pdfuaXX`）した合法な入力（qpdf --check クリーン）に `extract_pages` → 出力は **`qpdf: unable to find /Root dictionary`（exit 2）**。catalog がオブジェクトストリーム内にあるため、埋め込まれたストリームでオブジェクトストリーム全体のパースが崩壊する |
| 影響範囲 | `merge_pdfs` / `split_pdf` / `extract_pages` / `delete_pages` / `reorder_pages` × 「準拠宣言（pdfuaid/pdfaid）を**含まない** XMP を持つ入力」。**Word / LibreOffice / スキャナ等の外部 PDF はほぼ全てこれに該当**する。writer 自身の tagged 出力は宣言持ちで carry されないため、内輪のテストでは踏まない |
| なぜテストが緑か | `doc-level.test.ts`「準拠宣言の無い XMP は引き継ぐ」は読み戻しに **pdf-lib しか使っていない**。pdf-lib のパーサは壊れた catalog を寛容に読んで `/Metadata` の存在を報告してしまう。qpdf / poppler は拒否する。（`green-tests-can-be-vacuous` の再演 — 独立実装での読み戻しが要る） |
| 是正案 | 解決せずに **ref のまま** `copier.copy(raw)` へ渡す（PDFRef を渡せば dst に登録済みの新 ref が返る）。または複製後に `dst.context.register()` して ref を set。回帰テストには **qpdf --check の読み戻し**を追加する |
| 備考 | 汎用経路（320 行）で運ぶ `Names` / `AF` / `Lang` / `ViewerPreferences` / `OutputIntents` は直接オブジェクトでも Table 29 上は合法（indirect 要件なし）で、内部の参照は copier が正しく張り替える。**壊すのはストリームである Metadata だけ**。ただし一貫性のため全キー ref 運搬に揃えるのが自然 |

> [!IMPORTANT]
> **公開中の v0.13.0 が実害のある破損出力を作る**ため、「次は reader」という family の進行順合意より先に **v0.13.1 hotfix** の価値がある。

### W-2 🔴 CFF (.otf) を CIDFontType2 + FontFile2 で埋め込んでいる

| 項目 | 内容 |
|------|------|
| 条項 | **R-9.9.1-33**（Table 124 `FontFile2`: 「font program **shall** conform to the TrueType Reference Manual」）＋ **R-9.9.1-34**（「**shall** include these tables: "glyf", "head", "hhea", "hmtx", "loca", and "maxp"」） |
| 実測 | 同梱 `NotoSansJP-Regular.otf` で create_text_pdf → qpdf --qdf 展開: CIDFont は `/Subtype /CIDFontType2`、FontDescriptor は `/FontFile2 21 0 R`、**ストリーム先頭 4 バイトは `OTTO`**（= CFF 系 OpenType コンテナ。glyf/loca を持たない） |
| 原因 | pdf-lib `CustomFontEmbedder` の `isCFF() ? 'FontFile3' : 'FontFile2'` 分岐が **false 側に落ちている**（harfbuzz 事前サブセット後のバイト列を fontkit がどう分類するかに依存）。かつ CIDFont Subtype も TrueType 系（CIDFontType2）で対になっている |
| 既知事項の格上げ | TASKS.md の既知の制約「poppler の `Mismatch between font type` 警告 = **無害・対応不要**」の正体がこれ。描画・抽出は主要ビューアが実体スニッフィングで救うため壊れないが、**条文上は shall 違反**であり、厳格なプリフライト・アーカイブ検証では指摘対象。veraPDF ua1 が黙るのは PDF/UA-1 が形式一致を検査しないだけ |
| 是正案 | CFF 系入力は **CIDFontType0 + FontFile3**（`/Subtype /OpenType`。R-9.9.1-42: cmap 必須）にする。bare CFF に剥がして `CIDFontType0C` にする道もある（その場合 R-9.9.1-13: 単一 CIDFont のみ）。pdf-lib 側の分岐修正 or 埋め込み後の辞書後処理 |

### W-3 サブセット名に `ABCDEF+` タグが無い

- **R-9.9.2-2**: サブセットの BaseFont / FontName は「**タグ + `+` + 元の PostScript 名**」で始まらなければならない（shall）。**R-9.9.2-3**: タグは**大文字 6 文字ちょうど**、同一フォントの別サブセットは別タグ（shall）。
- 実測: `/BaseFont /NotoSansJP-Regular-7572`（pdf-lib が付ける `-数字` サフィックス。形式不適合）。writer は harfbuzz で**必ず事前サブセット**するため、全埋め込みが該当する。
- 従来この件は「サブセット名接頭辞なし → B-8（PDF/A 対応時に正規化）」として PDF/A の課題に紐づけていたが、**ISO 32000-2 本体の shall** である以上、B-8 を待つ理由がない。是正は埋め込み後に BaseFont / FontName / (CIDSystemInfo との整合) を書き換える後処理で可能。なお **R-9.9.2-4**（.notdef はサブセットに定義されていること）は harfbuzz が glyph 0 を常に保持するため適合。

### W-4 FontFile2 の Length1 欠落（.ttf 入力時）

- Table 125 `Length1`: 「(**Required** for Type 1 and TrueType font programs) The length in bytes of … the entire TrueType font program, after it has been decoded」。
- pdf-lib `CustomFontEmbedder.embedFontStream` は `Subtype`（CFF 時のみ）以外の追加エントリを書かない — **Length1 はコード上どこにも存在しない**（ソース確認）。.otf は W-2 是正後 FontFile3 になり Length1 不要だが、**.ttf 入力の経路には残る**。是正はフォントストリーム辞書への 1 エントリ追加。

### W-5 Info ↔ XMP の日時等価が秒境界レースに依存

- **R-14.3.4-2 / -5**（shall）: 作成日時・更新日時を Info と XMP の両方に書くときは「**fully equivalent**」でなければならない。
- 現状: create 系は `finalizePdf`（output.ts 89–91 行）が `outputDate()` を呼んで Info に書き、`buildXmpPacket`（xmp.ts 80 行）が**別途** `outputDate()` を呼んで XMP に書く。`set_metadata` も `touchModificationDate` と `syncXmpWithInfo` で同型。実測した固定値では一致（`D:20260719091131Z` ⇔ `2026-07-19T09:11:31Z`）するが、2 回の呼び出しが**秒境界を跨ぐと不一致**になる。`SOURCE_DATE_EPOCH` 設定時は常に同値。
- 是正案: 1 つの `Date` を生成して Info / XMP 両経路に貫通させる（数行）。

## 実装済みツールの再照合結果（維持を確認）

前回（Phase 1〜4）の判定が 0.4.4 正典でも成立することを、以下の走査で確認した。

| 領域 | 条項（走査した shall 数） | 判定 |
|------|--------------------------|------|
| 増分更新（preserveSignatures 7 ツール） | §7.5.6（8）/ §7.5.8（29）/ §14.4（5） | ✅ trailer 全引き継ぎ・%%EOF・変更オブジェクトのみの xref・ID 第 2 要素更新、いずれも v0.9.1〜v0.12.0 の実装と一致 |
| DocMDP ガード | §12.8.2.2（12。**SV-1 により親指定で Table 257 の子孫要件まで見える**） | ✅ B-11 のコメント（DSS/DTS 例外は P の全値に効く）と一致。付記: R-12.8.2.2.1-7 が P≥2 に許すフォーム記入を、writer は `fill_form` の preserveSignatures 未実装で活かせていない（**違反ではなく機能ギャップ**。B-15 候補） |
| Document catalog | §7.7.2（36 = Table 29 全 32 行） | ✅ B-10a の 13 要素と突き合わせ、監視対象の欠落なし。新たに可視化された「**Pages / Outlines / Metadata / Dests / Threads は shall be indirect reference**」について実装を確認: `add_bookmarks` のルートは `context.nextRef()` で間接 ✅・XMP は `context.register()` で間接 ✅ — **例外が W-1 の carry 経路** |
| 名前ツリー（添付） | §7.9.6(16) | ✅ v0.9.2 の辞書順ソート維持。単一ルート（Names のみ・Limits なし）は R-7.9.6-6/-7 に適合 |
| 数値ツリー（ParentTree） | §7.9.7(6) | ✅ struct-append の昇順挿入が R-7.9.7-6 に適合 |
| 添付 | §7.11.4(13) / §14.13(10) | ✅ Phase 3 の是正（Params.ModDate = ソース mtime / MIME 既定 / `#2F` エスケープ）維持。`CheckSum` は Optional で不書きは適合 |
| Optional content | §8.11.4.2(3) | ✅ B-10a の `usesOptionalContent` 実測 → shall 違反報告の設計が R-8.11.4.2-2 と一致 |
| しおり | §12.3.3(22) | ✅ /Count 可視数・ルート省略・双方向リンク（v0.9.2）維持 |
| メタデータ | §14.3(13) | ✅ XMP ストリーム辞書の `/Type /Metadata` `/Subtype /XML`（R-14.3.2-6/-7）を実装で確認。`Trapped` は書かない（適合）。§14.3.4 のみ W-5 |
| 注釈・フォーム | §12.5.x / §12.7.x | ✅ 正典テキストが 0.4.1 から不変（0.4.2〜0.4.4 は重複除去のみ）のため Phase 2〜4 の結論（LF→CR 正規化・AP 義務・DA/DR・V/AS 等）がそのまま成立 |

### 実測で否定した仮説（シロ・再調査防止のため記録)

| 疑い | 結果 |
|------|------|
| create 系が trailer `/ID` を書いていないのは違反では | **シロ（1.7 出力の間だけ）**。Table 15 の ID は「**Required in PDF 2.0 and later**, or if an Encrypt entry is present; optional otherwise」。writer は PDF 1.7 出力かつ暗号化を書かないため不書きは適合。ただし **PDF 2.0 出力へ切り替えた瞬間に必須**になる（各バイト列は最低 16 バイト、初回は両要素同値 = R-14.4-6。E-6 の決定論とは `SOURCE_DATE_EPOCH` 由来のハッシュで両立可能） — 2.0 対応タスクの必須項目として記録 |
| `add_bookmarks` が /Outlines を直接オブジェクトで置いていないか | **シロ**。`outline.ts` 48 行 `context.nextRef()` → catalog へは ref（R-7.7.2-16 適合） |
| pdf-spec の `get_requirements("9.9")` が INTERNAL_ERROR | **一過性**（`Cannot read properties of null (reading 'sendWithPromise')`）。リトライで 33 件成功。pdf-spec へのフィードバック事項（下記） |

## 未着手タスクの仕様照合

### B-10c（構造木の引き継ぎ）— 計画は整合。実装時の shall チェックリスト

| 要件 | 条項 |
|------|------|
| StructElem の `/P` は間接参照 | R-14.7.2-21 |
| `/ID` は**文書全体で一意** → merge は衝突リネーム + IDTree 再構築が必須 | R-14.7.2-22 |
| ParentTree のキー = StructParent(s) の値・ページ/オブジェクトごと | R-14.7.2-9〜-12 |
| ParentTreeNextKey は全キーより大きく | R-14.7.2-13 |
| RoleMap / ClassMap を「先勝ち」で落とすと**構造の意味が嘘になる** → マージ必須 | R-14.7.2-14 / -15 |
| PageLabels を再構築するなら **page index 0 のエントリ必須** | R-12.4.2-12 / R-7.7.2-9 |
| OCProperties を張り替えるなら**全 OCG を /OCGs に** | R-8.11.4.2-3 |
| AcroForm /Fields の複製後オブジェクトへの張り替え | §12.7.3 |

### B-12（replace_text）— 整合。追加の制約 2 点

ToUnicode の逆引きは §9.10.3 の bfchar / bfrange（UTF-16BE）の構文どおりで成立する（8 shall 走査・矛盾なし）。ただし: ①**置換後の文字がサブセットに無い場合は拒否**すること（writer の埋め込みは常にサブセット。無いグリフは .notdef になり、タグ付き文書では PDF/UA 7.21.8 系の違反に発展する）②同一フォント・同一コードなら `/W` は不変なので、幅が変わる置換の警告（計画どおり）で足りる。

### B-2（.ttc フェイス抽出）— 現状の「検知してエラー」は適合。抽出は仕様上必須の前処理

Table 124: FontFile2 の値は「TrueType **font program**」であり、コレクション（ttc ヘッダ）はこれに当たらない（R-9.9.1-34 の必須テーブル構成も単一フェイス前提）。抽出実装時は **W-4（Length1）と W-3（サブセットタグ）を同時に満たす**こと。CFF 系コレクションは R-9.9.1-13（埋め込み CFF は正確に 1 フォント/CIDFont）。

### B-3（フォント分け）— 追加の仕様面なし

同じ埋め込み経路のため W-2/3/4 の是正がそのまま効く。R-9.9.2-3「同一フォントの別サブセットは別タグ」にのみ注意（見出し用と本文用で同一フォントを別サブセットにする場合）。

### B-4（画像埋め込み）— 整合

Table 87 の Required（Width / Height / ColorSpace / BitsPerComponent）は pdf-lib の embedJpg / embedPng が書く。PNG のアルファは SMask（R-8.9.5.1-26）。タグ付き経路では Figure + `/Alt`（PDF/UA-1 7.3。B-1 の残課題として計画済み・整合）。

### B-8（PDF/A 変換）— 🔴 pdf-spec では検証不能（コーパス外）

`list_specs` の coverage が明言するとおり **ISO 19005 系はコーパスに無い**。PDF/A 固有要件の条文照合は本 MCP ではできない（「検索 0 件 = 要件なし」ではない）。ただし**サブセット名の正規化（W-3）は 32000-2 本体の義務**なので、B-8 を待たずに切り出して先行できる。

## pdf-spec-mcp へのフィードバック

- `get_requirements("9.9")` が初回呼び出しで `INTERNAL_ERROR: Cannot read properties of null (reading 'sendWithPromise')`。直後のリトライは成功（33 件）。pdfjs ワーカーの初期化競合の疑い。再現性は低いが、リトライで直る旨のエラーメッセージか内部リトライがあると family の自動化が安定する。
- S-8 修正（0.4.2）後の `search_spec` は良好: `"FontFile2 TrueType font program"` → 9.9.1 が先頭、`"subset six uppercase letters"` → 9.9.2 を即答。前回監査時の「当たりを付けてから必ず裏取り」の運用コストが実際に下がった。
- SV-1（0.4.4）の効果を実証: `get_requirements("12.8.2.2")` が子孫の Table 257 要件（DSS/DTS 例外含む）を返し、B-11 の裏取りが親指定 1 回で済むようになった。

## 推奨アクション（優先順）

1. **W-1 修正 + qpdf --check 読み戻しをテストへ追加 → v0.13.1 hotfix**。公開版が外部由来 PDF のページ操作で破損出力を作るため、「次は reader」の合意に対する唯一の例外とする価値がある
2. **W-2 / W-3 / W-4 を新タスク（B-14: フォント埋め込みの条文適合）として TASKS.md に起票**。同じ font-manager 経路なので 1 回で直すのが自然。是正後は poppler の Mismatch 警告消滅が受け入れ確認になる
3. **W-5** は数行の修正（同一 Date の貫通）。B-14 か v0.13.1 に同乗
4. 本レポートの結論を `docs/SPEC-AUDIT.md`（Phase 5 として）と `docs/TASKS.md` の既知の制約表（「poppler 警告 = 無害」の書き換え）へ反映

## 教訓

- **「無害」と分類した警告は、条文で裏を取るまで無害ではない**。poppler の Mismatch 警告は 2 日間「対応不要」の欄に居座っていたが、Table 124 と突き合わせて初めて shall 違反だと判明した（W-2）
- **委譲先が書いた辞書は一度は自分の目で開く**（Phase 3 の鉄則の再演）。Length1 欠落（W-4）もサブセット名（W-3）も pdf-lib の出力を qpdf で展開して初めて確定した
- **読み戻しは独立実装で**。pdf-lib で書いて pdf-lib で読むテストは、pdf-lib の寛容さの分だけ空振りする（W-1）
