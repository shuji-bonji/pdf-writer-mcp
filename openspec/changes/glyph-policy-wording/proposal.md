---
approved:
pr:
implementation: required
targets: [create-title]
---

# Proposal

## Why

`onMissingGlyph` と `fontPath` について、利用者（LLM）に見せる文が 0.26.0 の振る舞いと食い違っています（#25）。出力の PDF は正しく作られていて、食い違っているのは文の項目だけです。

| 箇所 | いまの文 | 実際の振る舞い |
| --- | --- | --- |
| `MISSING_GLYPH` の `next_actions[].reason`（`src/errors.ts` の `changeMissingGlyphPolicy`） | `replace` は「置き換えの箱を描く」、`ignore` は「黙って落とす」 | `replace` はフォントに `〓`（U+3013）があれば `〓`、無ければ `?`（標準フォントでは必ず `?`。SPEC-WRITER-STANDARD-FONT-ENCODING-002）。`ignore` は落とさず、埋め込みフォントでは `.notdef`、標準フォントでは空白の符号 `0x20` を描き、warnings で名指す |
| `onMissingGlyph` の説明（`tools/list`） | `replace = substitute 〓 with a warning` | 標準フォントでは `?` |
| 生成 3 ツールの `fontPath` の説明（`tools/list`） | `Required for non-Latin text such as Japanese.` | 0.26.0（#22）から、境目は WinAnsiEncoding。`ł`（U+0142）はラテン文字でもフォントが要り、`“` `—` `€` は非ラテンの記号でもフォントが要らない |
| 編集系 4 ツール（`stamp_page_numbers`・`add_watermark`・`fill_form`・`flatten_form`）の `fontPath` の説明（`tools/list`） | `Required for CJK …` | 境目は生成 3 ツールと同じ WinAnsiEncoding（`edit-stamp.ts`・`edit-form.ts` も `assertRenderable` を通る）。CJK は例の 1 つ |
| `MISSING_GLYPH` の `error`（`src/services/font-manager.ts`） | `These characters would render as blank boxes.` | 標準フォントでは「箱」は描かれない |
| 正本 SPEC-WRITER-CREATE-TITLE-002 の本文 | 「標準フォントでの非 Latin-1 の拒否」 | 0.26.0 から、標準フォントが断るのは WinAnsiEncoding に符号の無い U+0100 以上の字（SPEC-WRITER-STANDARD-FONT-ENCODING-004）。`“` は Latin-1 の外でも断らない |

生成 3 ツールの `fontPath` と編集系 4 ツールの `fontPath` は、別の Zod の部品（`src/utils/validation.ts` の 5 か所）でした。

## What Changes

- 上の表の文を、実際の振る舞いどおりに書き直す。
- 正本の SPEC-WRITER-CREATE-TITLE-002 の本文の「非 Latin-1 の拒否」を「WinAnsiEncoding に無い字の `FONT_REQUIRED`」に直す（MODIFIED。Scenario は変えない）。
- README（英語・日本語）の `onMissingGlyph` の表を同じ内容に直す。

### 変わる振る舞い

- `tools/list` の説明文: 生成 3 ツールの `fontPath`・`onMissingGlyph`、編集系 4 ツールの `fontPath`。
- `MISSING_GLYPH` の本文の `error` の最後の 1 文と、`next_actions[].reason`。

### 変わらない振る舞い

- 出力の PDF（描く字・warnings の文）。
- `code`・`retryable`・`next_actions[].action`・`example`・`detail`（SPEC-WRITER-COMMON-ERRORS-003・007）。文の項目は版で変わってよい（pdf-agent-stack `docs/specs/06` §2.3）。
- `inputSchema` の形（型・必須・既定値）。
- 編集系 4 ツールの `description`（「CJK values need fontPath …」）。どれも CJK を例に挙げているだけで、誤りではないので変えない。

### 対象外

- 文を照合するテストを足すこと。文の項目は版で変わる約束なので、受入テストでは固定しない。この変更が触るのは CREATE-TITLE-002 の本文の文言だけで、その Scenario のテストは変えない。
- pdf-publish-skill の `references/error-codes.md` の書き直し。必要かどうかは、この変更を出した後に読み比べて決める。

## Capabilities

- `create-title`（MODIFIED: 002。本文の文言だけ）

## 人が判断すること

- 版。0.26.1（patch）にする（2026-11-08 に本人が決定）。
- OpenSpec の変更を 1 つにまとめる（2026-11-08 に本人が決定）。Requirement は足さない。
- 編集系 4 ツールの `description` を変えないこと。
