---
approved: 2026-11-05
pr: 15
implementation: required
targets: [common-errors]
---

# Proposal

## Why

PDF family のエラー応答の規約（pdf-agent-stack `docs/specs/06` §2.3。2026-11-04 改訂、pdf-agent-stack#48）は、ツール結果の本文を平らな JSON（`error` 英語の文・`code`・`retryable` が必須、`hint`・`next_actions`・`detail` が任意）にし、文の項目（`error`・`hint`・`next_actions[].reason`）を英語で書くと定めました。

0.23.2 の writer は、この規約に 2 点で反しています。

1. **`retryable` を書かないエラーがある**（#14）。書くかどうかが、エラーを作る場所ごとに決まっています。`SIGNED_PDF`・`TAGGED_PDF`・`FONT_REQUIRED`・`MISSING_GLYPH` と `builder.ts` の `INVALID_ARGUMENT` 1 か所は `retryable: true` を書き、ほかは書きません。pdf-agent-stack `eval/e2e/tests/s6-error-contract.test.mjs` で `rotate_pages` に渡した 3 件（存在しないパス `DOC_NOT_FOUND`・PDF でないファイル `INVALID_PDF`・0 バイトのファイル `INVALID_PDF`）は、3 件とも `retryable` が無いことで落ちます。
2. **`next_actions[].reason` が日本語**（#13・F-10）。`src/errors.ts` の `NEXT_ACTIONS` の 6 件（`preserveSignatures`・`allowBreakingSignatures`・`allowBreakingTags`・`provideFontPath`・`changeMissingGlyphPolicy`・`checkFilePath`）です。`error` と `hint` は英語なので、1 つの応答の中で言語が切り替わります。

`code` の名前と形は、すでに規約どおりです（S6 で `code` の食い違いは出ていない）。

エラーの振る舞いを固定している仕様はまだありません。20 ツールに共通する振る舞いなので、共通の capability `common-errors`（`kind: common`）として初版を起こします。verify（0.33.0）・spec（0.12.0）・reader（同時に提案）と同じ形です。

## What Changes

- `retryable` を常に書く。値は `code` ごとに 1 つに決め、エラーを作る箇所では選ばせない（design.md の表）。型の `retryable` を必須にする。
- `next_actions[].reason` 6 件を英語にする。`next_actions[].action` と `example` の値は変えない（pdf-publish Skill の `references/error-codes.md` が読んでいる）。

### 変わる振る舞い

- エラーの本文に、これまで書いていなかったエラーにも `retryable` が加わる。
- `next_actions[].reason` の文言が英語に変わる。

### 変わらない振る舞い

- 成功したときの出力（20 ツールとも）。
- どの入力がエラーになるか。`code` の名前。`error` と `hint` の文言。
- `next_actions[].action` と `example` の値。
- すでに `retryable: true` を書いていたエラーの値（`SIGNED_PDF`・`TAGGED_PDF`・`FONT_REQUIRED`・`MISSING_GLYPH`、`builder.ts` の `INVALID_ARGUMENT`）。
- `isError: true` で返すこと。SDK が前段で落とす入力検証の失敗（相対パス・宣言に無いキーなど）は、SDK の文言のまま返す（§2.11。2026-08-27 決定、#48 で再確認）。

### 対象外

- `detail` を足すこと（writer はいま `detail` を返していない。規約では任意）。
- エラーを作る箇所の `code` の選び方の見直し（たとえば `output-edited.ts` が書き出しの失敗を `INVALID_PDF` で返している件）。別の Issue で扱う。
- pdf-publish Skill の `references/error-codes.md` の書き直し（pdf-agent-stack#48 で追う）。

## Capabilities

- `common-errors`（新規。`kind: common`。ADDED: 001〜003）

## 人が判断すること

- 版。`code` と `action` は変わらず、`retryable` が加わるのと文言が変わるだけなので、patch（0.23.3）でもよいと考えます。reader と同じく minor（0.24.0）にそろえるかを決めてください。
- `retryable` の値（design.md の表）。`DOC_NOT_FOUND` を `false`（verify 0.33.0 と §2.3 の例に合わせる）にすることは 2026-11-05 に本人が決めた。#14 の目安（`true`）とはここだけ違う。`FONT_NOT_FOUND` は `true`（別のフォントのパスを渡せば同じ文書を処理できる）。
