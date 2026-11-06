---
approved: 2026-11-06
pr: 24
implementation: required
targets: [standard-font-encoding, common-errors]
---

# Proposal

## Why

`fontPath` を渡さずに（標準フォント Helvetica で）描くと、WinAnsiEncoding で書ける字でも `FONT_REQUIRED` で断ります（#22）。0.25.1 の公開版で、`“Quoted” — 5 € … ™`・`It’s`・`- – dash` の 3 つがどれも `FONT_REQUIRED` になりました。

- 入力の判定 `hasNonLatin1`（`src/services/layout.ts`）は、U+0100 以上の字を「描けない字」として扱います。これは Latin-1 の範囲で、WinAnsiEncoding の範囲ではありません。
- ISO 32000-1 Annex D.2 Table D.2 の WinAnsiEncoding 欄は、0x80〜0x9F に Latin-1 には無い 27 字（`€` `‚` `ƒ` `„` `…` `†` `‡` `ˆ` `‰` `Š` `‹` `Œ` `Ž` `‘` `’` `“` `”` `•` `–` `—` `˜` `™` `š` `›` `œ` `ž` `Ÿ`）を持っています。ISO 32000-2 Annex D.1 は、Table D.2 の字をすべて Times・Helvetica・Courier の系列でサポートすることを求めています（"All characters listed in D.2 ... shall be supported for the Times, Helvetica, and Courier font families"）。
- 0.25.1（SPEC-WRITER-STANDARD-FONT-ENCODING-001〜003）で、標準フォントの `encode` と幅の計算はこの 27 字を扱えるようになりました。止めているのは入力の判定だけです。
- 曲がった引用符・ダッシュ・`…` は、LLM が書く英文やワープロから写した英文にふつうに入ります。英文だけの文書でもフォントの指定が要る状態です。
- `FONT_REQUIRED` の `error` の文は `The text contains non-Latin characters (e.g. Japanese) but no embeddable font was provided.` で、どの字が原因かを書いていません。日本語を含まない入力にも同じ文が返ります。

## What Changes

- 標準フォントで描くときの入力の判定を、「U+0100 以上か」から「U+0100 以上で、WinAnsiEncoding に符号が無いか」に変える。
  - U+0100 以上で符号の無い字（日本語・`✔`・`ł` など）は、いまどおり `FONT_REQUIRED`。
  - U+0100 未満で符号の無い字（制御文字・U+007F〜U+009F）は、いまどおり `onMissingGlyph`（002）。
- `create_table_pdf` のハンドラにあった独自の検査（`The table contains non-Latin characters …`）を外す。生成 3 ツールは `buildPdf` の中で、表のセルを含むすべての入力に同じ判定（`assertRenderable`）を先に当てているので、この検査には一度も届いていなかった（同じ判定を 2 か所に書いていただけ）。
- `FONT_REQUIRED` の `error` の文で、断った字を `"<字>" (U+XXXX)` の形で名指す（`MISSING_GLYPH` と同じ書き方。最初の 10 字と `and N more`）。"(e.g. Japanese)" を、WinAnsiEncoding に符号の無い字という説明に改める。
- `next_actions[].reason`（`retry_with_fontPath`）の英文を、同じく WinAnsiEncoding に無い字という説明に改める。
- 使われなくなる `hasNonLatin1` を外す。
- README（英語・日本語）の "covers **ASCII only**" を、実際の範囲（WinAnsiEncoding の 218 字）に合わせて直す。

### 変わる振る舞い

- 標準フォントで、WinAnsiEncoding にある U+0100 以上の 27 字を描ける。コンテンツストリームの符号は 001 の表どおり、幅は 003 の AFM のグリフ名で測る。
- `FONT_REQUIRED` の `error` の文と `next_actions[].reason` の英文。

### 変わらない振る舞い

- `FONT_REQUIRED` の `code`・`retryable`（`true`）・`next_actions[].action`（`retry_with_fontPath`）・`example`。エラー契約（pdf-agent-stack `docs/specs/06` §2.3・SPEC-WRITER-COMMON-ERRORS-001〜003）の範囲内で、`error` と `reason` は版で変わる文の項目。
- 日本語を含む入力は、いまどおり `FONT_REQUIRED`。
- 埋め込みフォントの経路（Identity-H）。`tools/list`（引数と説明）。

### 対象外

- 原因の字を `detail` にも機械が読める形で書くこと（#23。変更 `glyph-errors-list-characters`）。

## Capabilities

- `standard-font-encoding`（MODIFIED: 002。ADDED: 004）
- `common-errors`（MODIFIED: 003）。003 は「`error` を英語で書く」を求め、受入テストは日本語の本文を渡したときの `error` にかな・漢字が無いことを確かめていた。`error` が断った字を名指すと、その字（`"日" (U+65E5)` の `日`）が `error` に入る。名指す字は入力を引いたもので文の言語ではないので、003 の対象から外すと書き足す（実装中に受入テストが落ちて見つけた）

## 人が判断すること

- SPEC-WRITER-COMMON-ERRORS-003 の書き足し（上の Capabilities）。字を名指すのをやめて `U+XXXX` だけを書く案もあるが、#22 の決定（`MISSING_GLYPH` と同じ書き方）に合わせて字も書いた

## 決定済み（2026-11-06 に #22 で）

- 版は minor（0.26.0）。
- エラー本文の変更は、エラー契約の範囲内で破壊的変更ではない。文を照合しているテストは writer の `tests/page-number.test.ts`・`tests/generate.test.ts` で、これは直す。
- pdf-publish Skill の `references/error-codes.md` の `FONT_REQUIRED` の行（「非 Latin 文字 × フォント未指定」）は、このリポジトリの外で直す。
