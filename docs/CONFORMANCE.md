# 適合レポート

**この表は生成物である。** 元データは `scripts/uc-oracle/uc-oracle.lock.json` で、
判定は `npm run oracle:update`（`--verify` 付き）が pdf-verify-mcp 経由で
**veraPDF に下させたもの**である。手で書き換えないこと ——
`npm run report:conformance` で作り直す。

| | |
|---|---|
| writer の版 | 0.19.0 |
| 採取 | 2026-08-18T10:35:51.402Z |
| 構造の読み手 | qpdf 12.4.0 |
| 適合の判定 | veraPDF（版が記録されていない採取） |

## 適合宣言（veraPDF）

| 検体 | flavour | 判定 | 通過 / 検査 | 違反 | 備考 |
|---|---|---|---:|---|---|
| `conformance-ttf-pdfa3b` | pdfa-3b | **COMPLIANT** | 146 / 146 | — |  |
| `conformance-attach-pdfa3b` | pdfa-3b | **COMPLIANT** | 146 / 146 | — |  |
| `conformance-attach-pdfa4f` | pdfa-4f | **COMPLIANT** | 109 / 109 | — |  |
| `conformance-attach-pdfa4-bare` | pdfa-4 | **NON-COMPLIANT** | 108 / 109 | ISO 19005-4:2020 6.9-3 | 意図した不適合（検知できることを測る検体） |
| `conformance-pdfa4` | pdfa-4 | **COMPLIANT** | 109 / 109 | — |  |
| `conformance-ensure-tagged-ua1` | pdfua-1 | **COMPLIANT** | 106 / 106 | — |  |
| `conformance-tagged-ua1` | pdfua-1 | **COMPLIANT** | 106 / 106 | — |  |

## 電子署名

| 検体 | 署名数 | 有効 | ダイジェスト一致 | 備考 |
|---|---:|---:|---:|---|
| `input-signed-preserve` | 2 | 2 | 2 |  |
| `input-signed-5sigs` | 6 | 5 | 6 |  |

## この表が答えないこと

- **機械が判定できない事柄**。veraPDF 自身が
  「代替テキストと読み上げ順が意味として適切かは機械には判定できない」と注記する。
  PDF/UA-1 が 106/106 でも、人の確認は要る
- **測っていない軸**。`npm run oracle` は「1 形しか無い軸」を毎回報告する。
  そこに挙がっている軸は、比較の相手が無いという意味で測れていない
  （2026-08-18 時点では 0 件）
