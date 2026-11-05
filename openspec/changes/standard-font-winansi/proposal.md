---
approved:
pr:
implementation: required
targets: [standard-font-encoding]
---

# Proposal

## Why

`fontPath` を渡さずに（標準フォント Helvetica で）描くと、文字を WinAnsiEncoding ではなく Latin-1 の下位 1 バイトで書いています（#19）。

- 標準フォントの辞書は `/Encoding /WinAnsiEncoding` を宣言しています（`src/services/font-embed.ts` の `embedStandardFont`）。一方、`encode` は `text.charCodeAt(i) & 0xff` を書きます。
- 箇条書きの記号「•」（U+2022）は `0x22` で書かれ、WinAnsiEncoding の `0x22` は `quotedbl` です。**紙面にも抽出にも `"` が出ます。** 正しい符号は ISO 32000-1 Annex D.2 Table D.2 の WinAnsiEncoding 欄の 225（8 進）= `0x95` です。
- 入力に U+0001・U+007F・U+0080〜U+009F があると、そのまま `encode` まで届きます（`create_text_pdf`・`create_markdown_pdf`・`create_table_pdf` の全経路で実測）。いまはこれらを WinAnsiEncoding の別の字として描きます（U+0085 → `…`、U+007F → `•`）。Table D.2 にこれらの文字の符号はありません。

さらに、標準フォントの幅（`widthOfTextAtSize`）は AFM を文字そのもので引いています。AFM はグリフ名（`space`・`period`・`one`・`bullet`）で引くので、名前が文字と同じ英字以外は幅 0 になります。`Invoice 2026-11-06: total 1,234.56 USD (paid).` は正しい幅の 44% と測られ、折り返しが遅れて**本文がページの外まで描かれます**（画像で確認）。この誤りは実装中に見つけたので、003 として同じ変更に入れました（#19 の本文の「1 を直せば幅も一致する」は誤りでした）。

符号と幅の誤りは、どちらも標準フォントを pdf-lib から外したコミット 2eb87ea（v0.20.1 から）で入りました。

`encode` のコメントは「範囲外は `assertRenderable` が先に弾いている」としていますが、`assertRenderable` が見るのは入力の文字列だけで、レンダラが後から足す「•」（`RENDERER_GENERATED_CHARS`）を見ていません。また `assertRenderable` の判定（`hasNonLatin1`）は U+0100 以上だけを弾くので、U+0080〜U+009F は通ります。

## What Changes

- 標準フォントの `encode` を、Table D.2 の WinAnsiEncoding 欄から起こした表で引く。
- 標準フォントの幅は、書いた符号が指すグリフの名前（`@pdf-lib/standard-fonts` の WinAnsi から引く）で AFM を引く。
- 標準フォントにも「グリフがあるか」の照会（`hasGlyph`）を持たせ、WinAnsiEncoding に符号の無い文字を `onMissingGlyph` に乗せる（2026-11-06 に人が決定）。埋め込みフォントで「グリフが無い」文字と同じ扱いになる。
  - 既定（`error`）では `MISSING_GLYPH` で失敗し、文字を名指す。
  - `replace` では `?` に置き換え、warnings で名指す（`〓` は WinAnsiEncoding に無いので、既存の規則どおり `?` になる）。
  - `ignore` では空白として描き、warnings で名指す。
  - 編集系（`add_watermark`・`stamp_page_numbers`・`fill_form`）はいまも `error` 固定なので、`MISSING_GLYPH` で失敗する。
- `encode` は、WinAnsiEncoding に符号の無い文字の下位 1 バイトを書かない。そうした文字が `encode` に届くのは `ignore` のときだけで、そのときは空白の符号（`0x20`）を書く。
- 改行・タブなどの空白の制御文字（U+0009〜U+000D）は、グリフがあるものとして扱う。描く前に空白へ変わるので、`encode` には届かない（実測）。

### 変わる振る舞い

- 標準フォントで描いた箇条書きの記号が「•」になる（コンテンツストリームでは `<95>`）。
- 標準フォントの文字幅を、空白・数字・句読点・アクセント付きの字・記号も含めて測る。折り返しが早くなり、本文が右余白の内側に収まる（行数が増える）。
- 標準フォントで、入力に U+0000〜U+0008・U+000E〜U+001F・U+007F〜U+009F があると、既定では `MISSING_GLYPH` で失敗する。いまは別の字として描いている。

### 変わらない振る舞い

- U+0100 以上の文字を標準フォントに渡したときの `FONT_REQUIRED`（`assertRenderable`）。`“` `”` `–` `—` `€` `…` のように WinAnsiEncoding で書ける字も、いまどおり断る。
- WinAnsiEncoding と Latin-1 で符号が同じ字（U+0020〜U+007E・U+00A0〜U+00FF）の書き方。
- 埋め込みフォントの経路（Identity-H）。
- `tools/list`（引数と説明）。

### 対象外

- `assertRenderable` の判定を「WinAnsiEncoding で書けるか」に変え、`“` `”` `–` `—` `€` `…` などを標準フォントで受け付けること。受け付ける入力が増えるので、別の変更にする。
- 編集系ツールに `onMissingGlyph` の引数を足すこと。

## Capabilities

- `standard-font-encoding`（新規。`kind: common`。ADDED: 001〜003）

標準フォントで文字を描くのは、生成 3 ツールと編集系 3 ツール（`add_watermark`・`stamp_page_numbers`・`fill_form`）です。どれも `font-embed.ts` の同じ `encode` を通るので、ツールごとではなく共通の capability に置きます。起こす範囲は、標準フォントで描く文字の符号・符号の無い文字の扱い・文字幅の 3 つだけです。

## 人が判断すること

- 版。紙面に出る不具合の修正なので 0.25.1（patch）を提案します。ただし、U+0001 などを含む入力が既定で `MISSING_GLYPH` になる点と、標準フォントの行の折り返し位置が変わる点は、出力の変更です。
- 標準フォントで描いた出力を、手元のビューアで目で見ること（この環境の確認は画像化までです）。
