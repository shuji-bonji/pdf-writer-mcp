# Design

## 引数

`commonCreateShape`（`src/utils/validation.ts`）に `drawTitle: z.boolean().optional()` を足す。生成 3 ツールのスキーマはこれを展開しているので、3 ツールに同時に入る。公開スキーマと実行時検査はどちらもこの Zod が情報源（CLAUDE.md）。

`title` の説明を「メタデータに書く。`drawTitle` が `false` でなければ本文の先頭にも見出しとして描く」に直す。

## builder（`src/services/builder.ts`）

`const drawTitle = opts.title !== undefined && opts.drawTitle !== false` を 1 か所で決め、次の 3 つをこれで分ける。

1. フォントの検査: `assertRenderable(opts.title, …)` と `applyMissingGlyphPolicy` の入力に `title` を入れるのは `drawTitle` のときだけ。描かないときは `opts.title` をそのままメタデータに渡す。
2. サブセット: 描かない題名の文字はサブセットに入れない（入れても害は無いが、使わないグリフを埋め込まない）。
3. 描画: 題名の H1 を構造木に開き、`drawParagraph` で描くのは `drawTitle` のときだけ。

`tagged: true` の `title` 必須の検査は `opts.title` で行う（006）。今は検査が `applied.texts[0]` 由来の `title`（描く題名）を見ているので、題名を描かないと必ず落ちる。`opts.title` を見るように変える。

メタデータへの書き込み（`finalizeCreated`）は変えない。今も `opts.title`（`onMissingGlyph: replace` で置換する前の元の文字列）を書いていて、描くかどうかに関わらず同じ値になる。（提案を書いた時点では「描くときは置換後の title」と書いていたが、コードを読んで誤りと分かったので直した。）

## 見出しの数え始め（`src/services/renderers/markdown.ts`）

`createHeadingNormalizer(startLevel = 1)` は「題名の H1 が描かれている」前提で `last = 1` から始める。`renderMarkdown` に `headingStartLevel`（`1` か `0`）を渡せるようにし、題名を描かないときは `0` にする。`0` から始めると、最初の見出しは `min(wanted, 0 + 1) = 1` で H1 になる。見た目の文字の大きさは今と同じく Markdown のレベルのまま（構造だけを正す既存の方針）。

`handleCreateMarkdownPdf` は、`a.title !== undefined && a.drawTitle !== false` のとき `1`、それ以外は `0` を渡す。タグ無しでは構造木が無いので、この値は出力に影響しない。`title` が無いタグ無しの文書でも `0` になるが、構造木が無いので出力は変わらない。

## ライブラリの制約と仕様の制約

- 仕様（ISO 14289-1 §7.1）: タグ付きでは Metadata ストリームに `dc:title` が要る。本文の題名は要らない。§7.4.2: 見出しを使うなら最初は H1。
- 仕様（ISO 32000-2 §7.9.2.2）: Info 辞書・XMP の題名はテキスト文字列で、フォントのグリフを要さない。
- ライブラリ: 制約は無い。

## タグ付きとタグ無し

| | タグ無し | タグ付き |
| --- | --- | --- |
| `drawTitle` 省略 | 今と同じ（本文に描く・Info `/Title`） | 今と同じ（最初の H1 が題名・`dc:title`） |
| `drawTitle: false` | 本文に描かない・Info `/Title` | 本文に描かない・題名の H1 を置かない・本文の最初の見出しが H1・`dc:title` |

## 署名

生成ツールは新しい文書を作るので、署名の保持（`preserveSignatures`）は関係しない。

## 既定の出力が変わらないことの確かめ方

`SOURCE_DATE_EPOCH` を固定し、変更前と変更後の `dist` で、`drawTitle` を渡さない生成 3 ツールの出力を 1 バイトずつ比べる（タグ付き・タグ無し、フォント有り・無し）。
