# record: family-error-contract

PDF family の OpenSpec + spec-ids 導入（pdf-agent-stack `docs/specs/31`）のもとでの、pdf-writer-mcp の記録です。書式は計画 §8 です。時刻は JST です。

| 項目 | 記録 |
| --- | --- |
| 版 | OpenSpec 1.14.1 / spec-ids（`npx spec-ids`）/ pdf-writer-mcp 0.23.2 → 0.23.3（人が決めた。`code`・`action`・`example` が変わらないので patch）/ Claude（claude.ai、モデル claude-opus-5-5）/ 2026-11-05 |
| きっかけ | pdf-agent-stack#48 でエラー応答の規約（`docs/specs/06` §2.3）を平らな形に書き直し、S6 の契約テストで writer の 3 件が落ちた。Issue は #14（`retryable`）・#13（`next_actions[].reason` が日本語・F-10） |
| PR の切り方 | 1 本（計画 §6.3）。ブランチ `fix/family-error-contract`。提案の commit の後、人がチャットで承認し（13:52）、同じブランチで実装した。`approved`・`pr` の記入と archive は PR を出した後に行う |
| 仕様を書いた時間 | 約 10 分（reader の提案と同じ時間帯に書いた。調べた事柄の大半は reader と共通） |
| 実装した時間 | 約 10 分（13:53〜14:03。reader と並べて進めた） |
| 人が判断した箇所 | (1) `DOC_NOT_FOUND` の `retryable` を `false`（verify 0.33.0 に合わせる。#14 の目安は `true`）。(2) 版を patch（0.23.3）にする。(3) 提案の承認 |
| 仕様と実装のずれ | 0 件。design.md と tasks.md が「`retryable: true` を書いている箇所は 7 か所」と書いていたが、型検査が挙げたのは 8 か所だった（`handlers.ts` の `create_table_pdf` の `FONT_REQUIRED` を数え漏らしていた）。仕様（Requirement）には数を書いていないので、design.md と tasks.md の数だけを直した |
| エージェントが仕様に無い振る舞いを実装した件数 | 0 件 |
| 実装後に仕様を読み返した回数 | 0 回 |
| テスト | `TEST_FONT_PATH` 無しの `npm test` 422 → 432 件（55 skip）、有りで 487 件（skip 0）。受入テストは `tests/common-errors.test.ts`（10 件）。変更前の `src/` で 10 件中 8 件が落ちた（通った 2 件は、すでに `true` だった `FONT_REQUIRED` の `retryable` と、変えない `action`・`example` を固定するもの）。既存の `tests/errors.test.ts`（4 か所）と `tests/form.test.ts`（1 か所）を新しい形に書き換えた（期待の意味は変えていない）。check:engines・check・typecheck・build・check:public-types は終了コード 0（Node 22） |
| tools/list の比較 | 変更前（`78ac7a6`）と変更後の `dist` を `pdf-agent-stack/scripts/tools-list-snapshot.mjs` で比べた。20 ツールとも差 0 件 |
| S6（pdf-agent-stack `eval/e2e`） | 公開版で 18 件中 11 件。このブランチの writer と reader を差し替えて 18 件とも通った。writer の相対パスは SDK の前段で落ちる（§2.3 の対象外）ことも同じ走りで確かめた |
| 維持の手間 | 仕様だけを変えた変更: 0 件 |

## 分かったこと

1. **値を作る箇所に任せると、書き忘れが「書かない」に化ける。** 0.23.2 はガードのコードだけ `retryable: true` を書き、ほかは何も書かなかった。値を code ごとの表（`Record<WriterErrorCode, boolean>`）にし、`PdfWriterError` から `retryable` の引数を外したので、コードを足して値を書き忘れると型検査で落ちる。数え漏らした 8 か所目も、この型検査で見つかった。
