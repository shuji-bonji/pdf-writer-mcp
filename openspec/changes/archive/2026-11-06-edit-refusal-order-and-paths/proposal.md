---
approved: 2026-11-06
pr: 16
implementation: required
targets: [common-errors]
---

# Proposal

## Why

編集系のツールが入力を拒否するとき、理由の順序と文面に 3 つの問題があります（#10・F-21・F-08・F-23）。

1. **署名付きで暗号化された PDF に、案内どおり再試行させてから別の理由で断る**（F-21）。`src/services/edit-open.ts` は `/ByteRange` の有無を trailer の `/Encrypt` より先に見るので、1 回目は `SIGNED_PDF`（`next_actions` が `preserveSignatures: true` を案内）、案内どおりの 2 回目は `ENCRYPTED_PDF` になります。暗号化された文書は `preserveSignatures` の有無にかかわらず編集できないので、案内した再試行は必ず失敗します。
2. **鍵を導ける暗号化文書と導けない暗号化文書に、同じ文面を返す**（F-08）。どちらにも `hint: "Decrypt the PDF first — pdf-writer-mcp cannot edit encrypted files."` だけを返し、family の中に復号する手段はありません。
3. **書き出しの失敗で入力のパスを名指す**（F-23）。`/Resources` の無いページ（ISO 32000-2 §7.7.3.3 Table 31 で Required; inheritable）を持つ PDF を別の `outputPath` に書かせると、`Failed to write "<inputPath>": ...` になります（`src/services/output-edited.ts`）。入力は書いておらず、出力のパスはどこにも出ません。また、出力先に書けない（`EACCES`・`ENOTDIR` など）ときは、`writeFile` の例外が素通りして `INTERNAL_ERROR` になります。

ファイルシステムのエラーの扱いは、family 全体で決めました（2026-11-06）: 入力を読めない・出力を書けないは `INVALID_ARGUMENT`（`retryable: true`）にし、`detail.cause` に元の文を入れます。共通のコードは足しません。pdf-reader-mcp#49（入力側）と文面・`detail.reason` の値をそろえます。

## What Changes

- 編集の入口は、暗号化を署名より先に確かめる（`/Encrypt` は trailer だけで分かる。ISO 32000-2 §7.5.5 Table 15）。
- `ENCRYPTED_PDF` の `detail.keyDerived` に、空の利用者パスワードで鍵を導けたか（`true` / `false`）を書き、`hint` を分ける。導ける文書には「writer の外で復号すれば編集できる（例: `qpdf --decrypt`）。読むだけなら pdf-reader-mcp・pdf-verify-mcp がそのまま読める」、導けない文書には「利用者パスワードで復号してから渡す。pdf-verify-mcp は `password` を渡せば読める」と書く。
- 出力先に書けないときは `INVALID_ARGUMENT` にし、文に**出力のパス**を名指す（`Cannot write the output file "<outputPath>": permission denied (EACCES)`）。`detail` は `{ reason, path, cause }`。`reason` は `PERMISSION_DENIED`（`EACCES`・`EPERM`）・`NOT_A_DIRECTORY`（`ENOTDIR`）・`IS_A_DIRECTORY`（`EISDIR`）・`READ_ONLY_FILESYSTEM`（`EROFS`）・`NO_SPACE`（`ENOSPC`）・`FILESYSTEM_ERROR`（それ以外）。対象は書き出しの 3 か所（全書き直し・増分更新・作成）。
- 全書き直しで入力を組み直せなかったとき（`PageTreeError` など）の文を `Cannot rewrite "<inputPath>" into "<outputPath>": ...` にし、`detail` に `inputPath`・`outputPath` を書く。`code` は今までどおり `INVALID_PDF`（文書が条文に反している）。

### 変わる振る舞い

- 署名付きの暗号化文書の `code` が `SIGNED_PDF` から `ENCRYPTED_PDF` になる。
- `ENCRYPTED_PDF` の `hint` の文と、`detail` の追加。
- 書き出しの失敗の `code`（`INTERNAL_ERROR` → `INVALID_ARGUMENT`）・文・`detail`。
- 全書き直しの失敗の文と `detail`。

### 変わらない振る舞い

- 暗号化された文書を編集しないこと。`ENCRYPTED_PDF` の `retryable: false`（writer には `password` 引数が無い）。
- 暗号化されていない署名付き文書の `SIGNED_PDF` と、その `next_actions`。
- 入力が無いときの `DOC_NOT_FOUND`。

### 対象外

- 暗号化された文書を編集できるようにすること。
- 入力を読めない（`EACCES`）ときの扱い。writer の入口は `DOC_NOT_FOUND` に畳んでいるので、reader#49 と同じ形にそろえるのは別の変更にする（人が判断すること）。

## Capabilities

- `common-errors`（ADDED: 004・005・006）

## 人が判断すること

- `detail.reason` の値（上の 6 つ）。pdf-reader-mcp#49 と同じ値にする。
- `ENCRYPTED_PDF` の区別を `detail.keyDerived`（真偽値）で書くこと。
- `hint` に外部の道具（`qpdf`）の名前を例として書くこと。
- 入力を読めないとき（`EACCES`）の扱いを、この変更に入れないこと。
