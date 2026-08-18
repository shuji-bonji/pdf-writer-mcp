#!/usr/bin/env node
/**
 * 適合レポート —— Phase 3 §4 の受入 3「リリースごとの veraPDF レポート同梱」。
 *
 * **測るのはこのスクリプトではない。** 判定は `scripts/uc-oracle/run.mjs --verify` が
 * pdf-verify-mcp 経由で veraPDF に下させ、`uc-oracle.lock.json` に固定してある。
 * ここはその固定値を人が読める形に写すだけである —— **数字の出所を 1 つにする**ため。
 *
 * 使い方:
 *   node scripts/conformance-report.mjs           # docs/CONFORMANCE.md を書き出す
 *   node scripts/conformance-report.mjs --check   # 内容が古ければ exit 1（publish 前の検査）
 *
 * veraPDF の版は lock の `tooling.verapdf` から来る。`validate_conformance` が
 * 応答に載せるようになったので（pdf-verify-mcp 0.15.1）、判定を出したビルドが
 * そのまま記録される —— **実行パスは版の代わりにならない**（実測: Homebrew の
 * 置き場が `1.30.2` で veraPDF 自身が `1.30.0`）。
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const LOCK = join(here, 'uc-oracle', 'uc-oracle.lock.json');
const OUT = join(root, 'docs', 'CONFORMANCE.md');

const lock = JSON.parse(readFileSync(LOCK, 'utf8'));

if (lock.verifyRan !== true) {
  console.error(
    'uc-oracle.lock.json was captured without --verify, so it holds no veraPDF verdict. ' +
      'Run `npm run oracle:update` on a host that has veraPDF first.',
  );
  process.exit(2);
}

/** 判定を 1 行にする。`expect` と食い違っていたらそれも書く（黙って通さない） */
function row(id, v) {
  const verdict = v.compliant ? 'COMPLIANT' : 'NON-COMPLIANT';
  const asExpected = (v.expect === 'compliant') === v.compliant;
  const note = asExpected
    ? v.expect === 'non-compliant'
      ? '意図した不適合（検知できることを測る検体）'
      : ''
    : `⚠️ 期待 ${v.expect} と食い違う`;
  const violations = v.violations.length > 0 ? v.violations.join(', ') : '—';
  return `| \`${id}\` | ${v.flavour} | **${verdict}** | ${v.passedRules} / ${v.checkedRules} | ${violations} | ${note} |`;
}

const conformance = [];
const signatures = [];
for (const [id, s] of Object.entries(lock.specimens)) {
  for (const v of s.verify ?? []) {
    if (v.status !== 'decided') continue;
    conformance.push(row(id, v));
  }
  const sig = s.signatures;
  if (sig && sig.status === 'decided') {
    const asExpected = sig.valid === sig.expectValid;
    signatures.push(
      `| \`${id}\` | ${sig.count} | ${sig.valid} | ${sig.digestMatches} | ${
        asExpected ? '' : `⚠️ 期待 ${sig.expectValid} と食い違う`
      } |`,
    );
  }
}

const report = `# 適合レポート

**この表は生成物である。** 元データは \`scripts/uc-oracle/uc-oracle.lock.json\` で、
判定は \`npm run oracle:update\`（\`--verify\` 付き）が pdf-verify-mcp 経由で
**veraPDF に下させたもの**である。手で書き換えないこと ——
\`npm run report:conformance\` で作り直す。

| | |
|---|---|
| writer の版 | ${lock.writerVersion} |
| 採取 | ${lock.capturedAt} |
| 構造の読み手 | qpdf ${lock.tooling?.qpdf ?? '—'} |
| 適合の判定 | ${lock.tooling?.verapdf ? `veraPDF ${lock.tooling.verapdf}` : 'veraPDF（版が記録されていない採取）'} |

## 適合宣言（veraPDF）

| 検体 | flavour | 判定 | 通過 / 検査 | 違反 | 備考 |
|---|---|---|---:|---|---|
${conformance.join('\n')}

## 電子署名

| 検体 | 署名数 | 有効 | ダイジェスト一致 | 備考 |
|---|---:|---:|---:|---|
${signatures.join('\n')}

## この表が答えないこと

- **機械が判定できない事柄**。veraPDF 自身が
  「代替テキストと読み上げ順が意味として適切かは機械には判定できない」と注記する。
  PDF/UA-1 が 106/106 でも、人の確認は要る
- **測っていない軸**。\`npm run oracle\` は「1 形しか無い軸」を毎回報告する。
  そこに挙がっている軸は、比較の相手が無いという意味で測れていない
  （2026-08-18 時点では 0 件）
`;

if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(OUT, 'utf8');
  } catch {
    current = '';
  }
  if (current !== report) {
    console.error(
      `docs/CONFORMANCE.md is out of date with uc-oracle.lock.json. Run \`npm run report:conformance\`.`,
    );
    process.exit(1);
  }
  console.log('docs/CONFORMANCE.md is up to date.');
  process.exit(0);
}

writeFileSync(OUT, report);
console.log(`wrote ${OUT} (${conformance.length} conformance rows, ${signatures.length} signature rows)`);
