---
approved:
pr:
implementation: required
targets: [ensure-pdfa]
---

# Proposal

## Why

PDF/UA-1 を宣言したタグ付きの PDF に `ensure_pdfa` を `flavour: "pdfa-4"` か `"pdfa-4f"` で掛けると、ヘッダーが PDF 2.0 になり、XMP の `pdfuaid:part=1` はそのまま残ります（#9・F-19）。veraPDF は PDF/A-4f では適合、PDF/UA-1 では非適合（`ISO 14289-1:2014 6.1-1`「The file header shall consist of "%PDF-1.n"」）と判定し、writer は警告も `declarationRisks` も返しません。

ISO 14289-1 §6.1（pdf-spec-mcp の `pdfua1` で確認）は「The version number of a file may be any value from 1.0 to 1.7」です。作成系はすでに同じ組み合わせ（`tagged: true` と `pdfVersion: "2.0"`）を `INVALID_ARGUMENT` で断っています（`src/services/builder.ts` の B-16）。`ensure_pdfa` の -4 系だけにこの確認がありません。

`ensure_pdfa` の仕様はまだありません。この変更で capability `ensure-pdfa` の初版を起こし、この拒否だけを書きます。

## What Changes

- 入力の XMP が `pdfuaid:part` を宣言しているときに `flavour: "pdfa-4"`・`"pdfa-4f"` を求められたら、ファイルを書かずに `INVALID_ARGUMENT` を返す。`next_actions` で `flavour: "pdfa-3b"`（ヘッダーを 1.7 のままにするので PDF/UA-1 と両立する）を案内する。

### 変わる振る舞い

- PDF/UA を宣言した入力への `pdfa-4`・`pdfa-4f` がエラー応答になる。

### 変わらない振る舞い

- PDF/UA を宣言していない入力への `pdfa-4`・`pdfa-4f`。PDF/UA を宣言した入力への `pdfa-3b`（PDF/UA の宣言を残す）。
- 作成系の B-16。

### 対象外

- PDF/UA-2 の宣言を書くこと（未実装）。
- pdf-publish Skill の Phase 1 の表（writer の公開の後に PR で直す）。

## Capabilities

- `ensure-pdfa`（新規。`kind: tool`。ADDED: 001）

起こす範囲は、この拒否だけです。補う要件の一覧・PDF/A-4 のヘッダー・Info 辞書の始末は既存のテスト（`tests/pdfa-conformance.test.ts`）が固定していて、この変更では起こしません。

## 人が判断すること

- `next_actions[].action` の値を `retry_with_flavour`、`example` を `{ flavour: "pdfa-3b" }` にすること（既存の `retry_with_*` にそろえた）。この値は Skill が分岐に使う値になります。
- 入力がすでに PDF 2.0 で PDF/UA-1 を宣言している場合も断ること（PDF/A-4 の宣言を重ねると、測れない宣言がもう 1 つ増えるため）。
