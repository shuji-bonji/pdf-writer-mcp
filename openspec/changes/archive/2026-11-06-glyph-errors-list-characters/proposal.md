---
approved: 2026-11-06
pr: 24
implementation: required
targets: [common-errors]
---

# Proposal

## Why

`FONT_REQUIRED` と `MISSING_GLYPH` の失敗で、原因になった字を書いているのは `error` の文だけです（#23）。

- PDF family のエラー契約（pdf-agent-stack `docs/specs/06` §2.3）は、文の項目（`error`・`hint`・`next_actions[].reason`）は版で変わるとしています。pdf-publish Skill の `references/error-codes.md` も「`error`・`hint` の文を grep して推測しない」と書いています。受け側（Skill や利用者のエージェント）が「どの字が原因か」を利用者に示すには、いまは文を読んで推測するしかありません。
- `error` の文は最初の 10 字で切り、残りを `and N more` と書きます（`applyMissingGlyphPolicy`）。11 字目より後の字は、文からも分かりません。
- 変更 `standard-font-winansi-input`（#22）で、`FONT_REQUIRED` も文で字を名指すようになります。

## What Changes

- `FONT_REQUIRED` と `MISSING_GLYPH` の本文の `detail` に、次の 2 つを書く。
  - `characters`: 原因の字の `U+XXXX`（大文字の 16 進。U+FFFF を超える字は 5〜6 桁）の文字列の配列。重複なしで、出てきた順。
  - `count`: 原因の字の数（重複なし）。
- `characters` には最初の 1,000 字までを入れる（`LIMITS.ERROR_DETAIL_MAX_CHARACTERS`）。日本語の長文を標準フォントに渡すと、原因の字は数千になりうる。`count` は上限に関わらず全体の数なので、`characters.length < count` で切ったことが分かる。
- 字そのものではなく `U+XXXX` を書くのは、原因の字に制御文字（U+0085 など）が入るから。字は `U+XXXX` から一意に戻せる。

### 変わる振る舞い

- 上の 2 つの code の本文に `detail` が付く。

### 変わらない振る舞い

- `error` の文・`code`・`retryable`・`next_actions`（`action`・`reason`・`example`）。
- 最上位の項目（`detail` は SPEC-WRITER-COMMON-ERRORS-001 で認められた任意の項目。キーを足すのは追加で、破壊的変更ではない）。

### 対象外

- `onMissingGlyph: "replace"`・`"ignore"` のときの warnings に、同じ情報を構造化して載せること。warnings は文字列の配列で、構造を持たせるには出力の形を変える必要がある。別の変更にする。
- reader・verify とのキー名のそろえ。reader・verify には、字を原因にして失敗する code が無い（2026-11-06 に両リポジトリの `src` で確認）。

## Capabilities

- `common-errors`（ADDED: 007）

## 人が判断すること

- キーの名前と形（`characters` を `U+XXXX` の文字列の配列にした。`{ char, codePoint }` のオブジェクトの配列にはしなかった）。
- 上限 1,000 字（全件にはしなかった）。
- 版。#22 と同じ 0.26.0 に入れる案。
