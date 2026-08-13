# UC 差分オラクル

Phase 3（生成パス移行 = pdf-lib 撤去）で「壊していない」を測るための計器。
判断の根拠は [`normativepdf/docs/adr/0006-phase3-differential-acceptance.md`](../../../../lib/normativepdf/docs/adr/0006-phase3-differential-acceptance.md)。

## なぜ要るのか

撤去は直列化ごと建て直す作業なので、**バイト一致は最初から成立しない**。
そして旧実装の出力は、撤去してしまえば二度と作れない。
verify の `revision-diff.ts` 置換では、旧実装との A/B だけが差 13 件を出し、
**ユニットテストは前後とも全緑で 1 件も出さなかった**。

だから **pdf-lib 版 0.19.0 の出力を先に固定する**。それがこのディレクトリの中身である。

## 使い方

```bash
npm run oracle            # ゴールデンと突き合わせる（差があれば exit 1）
npm run oracle:verify     # veraPDF / 署名検証も回す（ホスト専用）
npm run oracle:update     # ゴールデンを採り直す（--verify 込み）

node scripts/uc-oracle/run.mjs --filter input-signed --keep /tmp/x   # 1 件だけ・生成物を残す
```

`--filter` は**依存する先行検体も一緒に選ぶ**。名前だけで切ると先行検体が回らず、
調べたい検体が「入力が無い」= 測定なしで素通りする。

## 何を測るか（4 面）

| 面 | 中身 | 判定者 |
|---|---|---|
| 構造 | 意味的構造ダイジェスト（`digest.mjs`） | qpdf |
| 応答 | MCP ツールの応答 JSON（**警告文を含む**） | writer |
| 可読性 | `qpdf --check` の苦情 | qpdf |
| 適合 | veraPDF `pdfa-3b` / `pdfua-1` / `pdfa-4f` / 署名 | veraPDF |

**読み手を qpdf に限る**のは、自分の出力を自分のパーサで読み戻すと
書きの誤りと読みの誤りが打ち消し合うため（GUARDS T-2）。
撤去後は writer も reader も normativepdf の上に乗るので、family 内にオラクルは残らない。

`compare_structure`（pdf-reader-mcp）は**使わない**。実測で 11 プロパティしか見ておらず、
そのうち 4 つは直列化方式が変われば必ず differ になる。ADR-0006 §3。

## ファイル

| ファイル | 役割 |
|---|---|
| `specimens.mjs` | 検体行列。**軸**（pdfVersion / フォント / tagged / origin / 署名 / 添付 / フォーム）で並べる |
| `digest.mjs` | qpdf `--json` から意味的ダイジェストを作る。正規化する項目の一覧は先頭の JSDoc |
| `run.mjs` | 採取と突き合わせ |
| `make-inputs.mjs` | **pdf-lib がまだ在るうちに**入力検体を凍結する（1 回だけ実行済み） |
| `inputs/form-basic.pdf` | 凍結済みの AcroForm 検体。再生成しない |
| `uc-oracle.lock.json` | ゴールデン（sha256 / 応答 / 判定 / 軸の被覆） |
| `golden/*.json` | ダイジェストの本体。差が出たとき人が読む先 |

## 規律

- **実装変更と lock 更新を同じコミットに入れない**（基準を動かしながら測ることになる）
- **判定不能は緑に数えない**。veraPDF が無い実行は `undecided` として本数を固定し、
  「測れていたものが測れなくなった」は赤にする
- **1 面が測れないことを検体ごとの失敗にしない**。qpdf が構造を読めない検体でも、
  署名・ツール応答・`qpdf --check` は測れている。読めないときは**入力も同じ読み手に通し**、
  `inputReadable: false` なら writer の後退ではないと記録に残す
  （実例: `dss-pades-5sigs-doctimestamp.pdf` は入力の時点で page tree ノードに `/Type /Page` が無く、
  qpdf 10 は override して進み qpdf 12 は拒む）
- **読み手（qpdf）の版が違えば警告が出る**。差が実装のものか読み手のものか切り分けられないため
- **1 形しか無い軸は毎回警告が出る**。フォント種別の軸は 2026-08-14 に埋めた
  （`fonts/LiberationSans-Regular.ttf` = SIL OFL 1.1・同梱の `.LICENSE.txt` に出所と全文。
  公開パッケージには入らない）。`.otf` は `CIDFontType0 + FontFile3`、`.ttf` は
  `CIDFontType2 + FontFile2` と**別の辞書になることを実測してから**足している
- **計器自身も T-3 を通す**。実際、初版はページの中身を 1 バイトも見ておらず、
  色を変えても差が出なかった
