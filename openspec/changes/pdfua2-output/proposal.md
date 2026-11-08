---
approved:
pr:
implementation: required
targets: [pdfua2, create-title]
---

# Proposal

## Why

生成 3 ツールは `tagged: true` と `pdfVersion: "2.0"` の組み合わせを `INVALID_ARGUMENT` で断っています（B-16）。writer が書けるアクセシビリティの宣言が PDF/UA-1（ISO 14289-1。版は 1.0〜1.7）だけだったためで、PDF 2.0 のアクセシブルな PDF も、PDF/A-4 と両立するアクセシブルな PDF も作れません（#26）。

`pdf-spec-mcp`（`pdfua2` = ISO 14289-2:2024、`iso32000-2`）で確かめた条文（2026-11-09）:

| 条文 | 内容 |
|---|---|
| ISO 14289-2 §5 Table 1 | `pdfuaid:part`（2）と `pdfuaid:rev`（発行年の 4 桁）はどちらも Required |
| ISO 14289-2 §6.1・§6.2 | 版は 2.0。ISO 32000-2 と ISO/TS 32005 に従う |
| ISO 14289-2 §8.2.4 | 構造要素は PDF 1.7・PDF 2.0・MathML の名前空間のどれかに属する。名前空間を持たない要素は PDF 1.7 の型として扱う |
| ISO 14289-2 §8.2.5.2 | 構造木の根は `Document` を唯一の子に持ち、その名前空間は PDF 2.0（shall） |
| ISO 14289-2 §8.2.5.12 | 段が明らかな見出しはその段の構造型にする。段を連続させることは求めない（NOTE 2） |
| ISO 14289-2 §8.2.5.13 | 題名は Title 構造型で示し、見出しとして示さない（shall） |
| ISO 14289-2 §8.8 | 文書内を指す行き先は structure destination にする |
| ISO 14289-2 §8.11 | XMP の `dc:title`、`DisplayDocTitle` は true |
| ISO 32000-2 §14.8.6.1・Table 354〜356 | PDF 2.0 の名前空間名は `http://iso.org/pdf2/ssn`。`StructTreeRoot` の `/Namespaces`、要素の `/NS`、名前空間辞書 |
| ISO 32000-2 Annex M | `BlockQuote`・`Code` は PDF 1.7 の名前空間にしか無い |

手元の veraPDF 1.30.0 は PDF/UA-2 を検査できる（1,728 規則）。変更前の PDF/UA-1 の出力を PDF/UA-2 で測ると、落ちたのは 4 規則（6.1-1 版・5-2 part・5-5 rev・8.2.5.2-2 Document の名前空間）だった。§8.2.5.12・§8.2.5.13 は veraPDF が検査しない。

## What Changes

- 生成 3 ツールで `tagged: true` と `pdfVersion: "2.0"` を併用すると、PDF/UA-2 を宣言する（PDFUA2-001）。
- PDF 2.0 の名前空間辞書を `StructTreeRoot` の `/Namespaces` に置き、PDF 2.0 の名前空間にある型の要素に `/NS` を書く。`BlockQuote`・`Code` は既定の PDF 1.7 の名前空間のまま（PDFUA2-002）。
- 描く題名は `Title`（PDFUA2-003）。`create_markdown_pdf` の見出しは書いた段のまま（PDFUA2-004）。CREATE-TITLE-003 を PDF/UA-1 に限る（MODIFIED）。
- 既存の文書の XMP を作り直す共通の経路（`syncXmpWithInfo`）で、`pdfuaid:rev` を `pdfuaid:part` と一緒に引き継ぎ、Info 辞書に `Title` が無いときは既存の `dc:title` を引き継ぐ（PDFUA2-005）。
- `add_bookmarks` は、PDF/UA-2 の入力ではしおりの行き先を structure destination で書く。`/A << /S /GoTo /D [ページ] /SD [構造要素] >>`（ISO 32000-2 §12.6.4.2 Table 202）。要素はそのページの親配列から §12.3.2.3 の手順で同じページに戻る最初のもの。要素が無いページはページの行き先で書き、warnings で名指す（PDFUA2-006）。
- ツールの説明文（`tagged`・`pdfVersion`・`create_markdown_pdf`）・initialize の instructions・README（英語・日本語）・DESIGN.md・TASKS.md。

### 変わる振る舞い

- `tagged: true` + `pdfVersion: "2.0"`：`INVALID_ARGUMENT` だったものが、PDF/UA-2 の PDF を返す。
- `set_metadata` など XMP を作り直す編集：Info に `Title` が無い文書（PDF 2.0 の出力、PDF/A-4 にした文書）で `dc:title` が残る。0.26.x は消していた。PDF/UA-2 以外の文書にも当たる。
- `add_bookmarks`：PDF/UA-2 の入力では、しおりの項目が `/Dest` ではなく `/A`（GoTo・`D`・`SD`）になる。

### 変わらない振る舞い

- PDF/UA-1（既定の 1.7）とタグ無しの出力。変更前の dist と `SOURCE_DATE_EPOCH` を固定して 28 通りを比べ、25 通りでバイト列も応答も同じ。差は上の「変わる振る舞い」の 2 通りと、`ensure_pdfa` の `hint` の文（変更 `ensure-pdfua2`）の 1 通り。
- 生成系は、PDF/UA-1 と同じく、適合を確かめていないことを warnings に書かない。

### 対象外

- `tag_form_fields`・`add_annotation` など、構造木に要素を足す編集ツールが足した要素に `/NS` を付けること。足した要素は既定の PDF 1.7 の名前空間に入る（§8.2.4 は許す）。`add_annotation` の出力は veraPDF の PDF/UA-2 で適合（2026-11-09）。`tag_form_fields` は測っていない。
- `stamp_page_numbers`・`add_watermark` を `fontPath` なしで使うと、標準フォントが埋め込まれず §8.4.5.5 で落ちる。PDF/UA-1 でも同じ扱い（7.21.4.1）で、変えない。
- Info の `Author`・`Subject`・`Keywords` が無いときに XMP の値を引き継ぐこと、複数の言語の `dc:title` をそのまま運ぶこと。`dc:title` の最初の項目だけを引き継ぐ（PDF/UA が求めるのは `dc:title`）。#28 で扱う。
- 出力の版と宣言をその版の条文に合わせること全般（`merge_pdfs` の版の混在、2.0 の文書の Info への書き込み、タグ無しの 2.0 への `pdfa-3b` など）。#28 で扱う。

## Capabilities

- `pdfua2`（新しい共通 capability。ADDED: 001〜006）
- `create-title`（MODIFIED: 003）

## 人が判断すること

- 引数の形（`tagged` + `pdfVersion: "2.0"`）・名前空間（PDF 2.0 にある型はすべて 2.0）・題名は `Title`・範囲（#20・`ensure_tagged`・`ensure_pdfa` を含める）は 2026-11-09 に本人が決定。
- 版は 0.27.0（2026-11-09 に本人が決定）。
- `add_bookmarks` の structure destination は B 案（GoTo の `D` と `SD`）・PDF/UA-2 を宣言した文書だけ・要素の無いページはページの行き先で書いて警告（2026-11-09 に本人が決定）。
- 🔴 未判断: `dc:title` の引き継ぎを PDF/UA-2 以外の文書にも当てること（PDFUA2-005）。
- 生成系は CLAIMS の warnings を今は出さない（PDF/UA-1 と同じ）。いずれ名乗る版・規格に合わせて出す（2026-11-09 に本人が決定。#28 で扱う）。
