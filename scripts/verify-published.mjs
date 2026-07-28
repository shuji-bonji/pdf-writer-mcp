#!/usr/bin/env node
/**
 * 公開版の受け入れ検証（[[verify-published-package-by-npx]] の規律）。
 *
 * **なぜ手元のテストでは足りないのか**: テストが全緑でも公開版でだけ壊れることがある。
 * 実例が 2 つある — pdf-spec 0.4.0 のキャッシュ破壊（unpublish に至った）と、
 * writer 0.13.0 の carryXmp（公開版に qpdf exit 2 の破損が実在した）。
 * どちらも「配布された成果物を、依存ごとクリーンに取得して叩く」ことでしか見つからない。
 *
 * 使い方:
 *   node scripts/verify-published.mjs            # package.json の version を検証
 *   node scripts/verify-published.mjs 0.16.0     # 版を明示
 *   PDF_WRITER_FONT=... node scripts/verify-published.mjs   # 日本語検体も作る場合
 *
 * 前提ツール:
 *   - npm（必須）: 公開版をクリーンな一時ディレクトリへ取得する
 *   - qpdf（任意・強く推奨）: 独立実装での読み戻し。pdf-lib は自分の書いた辞書を素直に読むので、
 *     writer 自身の出力を writer の依存で読んでも壊れに気づけない
 *   - veraPDF（任意）: PDF/A の判定。**無ければ判定はスキップし、構造検査だけで PASS を名乗る**。
 *     ここで出る verdict は veraPDF のものであって「ISO 19005 準拠」ではない（T2）。
 *     **呼び出しは pdf-verify-mcp の validate_conformance 経由**（人間向けテキストを読まない。
 *     初版は veraPDF の標準出力を grep していて、JVM の WARNING で誤判定した）
 *
 * 終了コード: 0 = 全 PASS / 1 = 失敗あり / 2 = 検証を実施できなかった
 */

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require_ = createRequire(import.meta.url);
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const version = process.argv[2] ?? require_(join(repoRoot, 'package.json')).version;
const pkg = `@shuji-bonji/pdf-writer-mcp@${version}`;
/** 判定は family の窓口（verify）に通す。@latest なのは「今の判定器」で測るため */
const VERIFY_PKG = process.env.PDF_VERIFY_PKG ?? '@shuji-bonji/pdf-verify-mcp@latest';

/**
 * 検体に埋め込むフォント。
 *
 * **PDF/A はすべてのフォントの埋め込みを要求する。** 指定が無いと writer は
 * StandardFonts.Helvetica（標準 14 書体 = 埋め込まない）で描くので、**その検体は
 * 構造がどれだけ正しくても PDF/A 判定では必ず 1 件落ちる**（実測: `-4f` が 108/109）。
 * 落ちるのは writer の欠陥ではなく検体の欠陥なので、**フォントが無いときは
 * 判定そのものを行わない**（無関係な理由で赤にしない・偽の緑も作らない）。
 */
const FONT_PATH =
  process.env.PDF_WRITER_FONT ??
  process.env.TEST_FONT_PATH ??
  (() => {
    const bundled = join(repoRoot, 'NotoSansJP-Regular.otf');
    return existsSync(bundled) ? bundled : undefined;
  })();

const results = [];
const check = (label, ok, detail = '') => {
  results.push({ label, ok, detail });
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

function has(bin) {
  try {
    execFileSync(bin, ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** MCP を stdio で起動し、tools/call を順に投げる最小クライアント */
function createClient(serverPath) {
  const child = spawn('node', [serverPath], { stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map();
  let buf = '';
  child.stdout.on('data', (chunk) => {
    buf += chunk.toString();
    let i = buf.indexOf('\n');
    while (i >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      i = buf.indexOf('\n');
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id && pending.has(msg.id)) {
          pending.get(msg.id)(msg);
          pending.delete(msg.id);
        }
      } catch {
        /* サーバの人間向けログ。無視する */
      }
    }
  });
  let id = 0;
  const send = (method, params) =>
    new Promise((resolve) => {
      const myId = ++id;
      pending.set(myId, resolve);
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: myId, method, params })}\n`);
    });
  return {
    child,
    send,
    notify: (method) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`),
    /**
     * ツール呼び出し。**入力検証で弾かれた場合も JSON-RPC エラーではなく
     * `isError: true` の結果として返ってくる**（MCP SDK の仕様）ので、
     * 生テキストと isError を必ず一緒に返す。ここを取り違えると
     * 「拒否されたこと」を検出できないまま緑になる。
     */
    call: async (name, args) => {
      const res = await send('tools/call', { name, arguments: args });
      const text = res.result?.content?.map((c) => c.text).join('\n') ?? res.error?.message ?? '';
      let parsed = {};
      try {
        parsed = JSON.parse(text);
      } catch {
        /* 構造化 JSON でない = SDK の検証エラー文言 */
      }
      return { ...parsed, isError: res.result?.isError === true, raw: text };
    },
  };
}

const work = mkdtempSync(join(tmpdir(), 'pdf-writer-verify-'));
console.log(`# 公開版の検証: ${pkg}`);
console.log(`  作業ディレクトリ: ${work}`);

try {
  // ---- 1. クリーンな取得（キャッシュ済みの手元 dist を掴まないこと自体が検証の一部）
  writeFileSync(join(work, 'package.json'), JSON.stringify({ name: 'verify', private: true }));
  execFileSync('npm', ['install', '--no-audit', '--no-fund', '--silent', pkg], {
    cwd: work,
    stdio: 'inherit',
  });
  const installed = join(work, 'node_modules', '@shuji-bonji', 'pdf-writer-mcp');
  const installedVersion = JSON.parse(
    readFileSync(join(installed, 'package.json'), 'utf8'),
  ).version;
  check('取得した版が要求どおり', installedVersion === version, installedVersion);

  const client = createClient(join(installed, 'dist', 'index.js'));
  const init = await client.send('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'verify-published', version: '0' },
  });
  client.notify('notifications/initialized');
  check('ハンドシェイクの版', init.result?.serverInfo?.version === version);
  check(
    'instructions が届く',
    typeof init.result?.instructions === 'string' && init.result.instructions.length > 0,
  );

  const tools = await client.send('tools/list', {});
  check('ツール数 20', tools.result?.tools?.length === 20, `${tools.result?.tools?.length}`);

  // ---- 2. 電帳法チェーン: PDF 2.0 で作る → CSV を添付 → PDF/A-4f を宣言
  const p = (name) => join(work, name);
  writeFileSync(p('invoice.csv'), 'date,amount\n2026-07-28,1200\n');

  console.log(
    FONT_PATH
      ? `  埋め込みフォント: ${FONT_PATH}`
      : '  埋め込みフォント: なし（PDF/A の判定は行わない — 標準 14 書体は埋め込めない）',
  );

  const base20 = await client.call('create_text_pdf', {
    text: 'Invoice for July 2026.\n\nTotal: 1200 JPY',
    outputPath: p('base20.pdf'),
    pdfVersion: '2.0',
    title: 'Invoice',
    ...(FONT_PATH ? { fontPath: FONT_PATH } : {}),
  });
  check('create_text_pdf(pdfVersion 2.0)', base20.path === p('base20.pdf'));
  check(
    'ヘッダが %PDF-2.0（6.1.2-1）',
    readFileSync(p('base20.pdf')).subarray(0, 8).toString() === '%PDF-2.0',
  );

  const base17 = await client.call('create_text_pdf', {
    text: 'legacy document',
    outputPath: p('base17.pdf'),
    ...(FONT_PATH ? { fontPath: FONT_PATH } : {}),
  });
  check(
    '既定は %PDF-1.7 のまま（2.0 は opt-in）',
    base17.path !== undefined &&
      readFileSync(p('base17.pdf')).subarray(0, 8).toString() === '%PDF-1.7',
  );

  const attached = await client.call('attach_file', {
    inputPath: p('base20.pdf'),
    outputPath: p('attached.pdf'),
    attachmentPath: p('invoice.csv'),
    relationship: 'Data',
  });
  check('attach_file が CSV を埋め込む', attached.attachment?.name === 'invoice.csv');

  const a4f = await client.call('ensure_pdfa', {
    inputPath: p('attached.pdf'),
    outputPath: p('pdfa4f.pdf'),
    flavour: 'pdfa-4f',
  });
  check('ensure_pdfa(pdfa-4f)', a4f.flavour === '4f');
  check(
    '宣言を書いたら測れ、という警告が必ず付く',
    (a4f.warnings ?? []).some((w) => /CLAIMS|conformance was NOT checked/i.test(w)),
  );

  const a4 = await client.call('ensure_pdfa', {
    inputPath: p('attached.pdf'),
    outputPath: p('pdfa4.pdf'),
    flavour: 'pdfa-4',
  });
  check('ensure_pdfa(pdfa-4)', a4.flavour === '4');

  // ---- 3. 壊さないことの確認（黙って進まない）
  const refused = await client.call('ensure_pdfa', {
    inputPath: p('base17.pdf'),
    outputPath: p('never.pdf'),
    flavour: 'pdfa-4',
    preserveSignatures: true,
  });
  check(
    '1.7 入力 + preserveSignatures + pdfa-4 は SIGNED_PDF で拒否',
    refused.code === 'SIGNED_PDF',
    refused.code ?? 'エラーにならなかった',
  );

  const bogus = await client.call('ensure_pdfa', {
    inputPath: p('base20.pdf'),
    outputPath: p('never2.pdf'),
    flavour: 'pdfa-4b',
  });
  check(
    '存在しない pdfa-4b は入口（Zod）で拒否',
    bogus.isError === true && /flavour/i.test(bogus.raw),
    bogus.isError ? '' : '通ってしまった',
  );

  client.child.kill();

  // ---- 4. 構造の実測（宣言だけ見ない）
  const { PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } = require_(
    join(repoRoot, 'node_modules', 'pdf-lib'),
  );

  for (const [file, expectConformance] of [
    ['pdfa4f.pdf', 'F'],
    ['pdfa4.pdf', null],
  ]) {
    const doc = await PDFDocument.load(readFileSync(p(file)), { updateMetadata: false });
    const ctx = doc.context;
    const md = ctx.lookup(doc.catalog.get(PDFName.of('Metadata')));
    const xmp =
      md instanceof PDFRawStream
        ? new TextDecoder().decode(
            md.dict.has(PDFName.of('Filter')) ? decodePDFRawStream(md).decode() : md.contents,
          )
        : '';
    const grab = (re) => re.exec(xmp)?.[1] ?? null;
    const names = ctx.lookup(doc.catalog.get(PDFName.of('Names')));

    console.log(`  [${file}]`);
    check(
      `${file}: Info 辞書が無い（6.1.3-4）`,
      ctx.trailerInfo?.Info === undefined || ctx.lookup(ctx.trailerInfo.Info) === undefined,
    );
    check(`${file}: pdfaid:part = 4`, grab(/pdfaid:part[>="'\s]*([0-9]+)/) === '4');
    check(`${file}: pdfaid:rev = 2020（6.7.3-5）`, grab(/pdfaid:rev[>="'\s]*([0-9]+)/) === '2020');
    check(
      `${file}: pdfaid:conformance = ${expectConformance ?? '（無し）'}`,
      grab(/pdfaid:conformance[>="'\s]*([A-Z]+)/) === expectConformance,
    );
    check(`${file}: 作成日時が xmp:CreateDate にある`, grab(/<xmp:CreateDate>([^<]+)</) !== null);
    check(`${file}: trailer /ID`, ctx.trailerInfo?.ID !== undefined);
    check(`${file}: OutputIntent`, doc.catalog.has(PDFName.of('OutputIntents')));
    check(`${file}: catalog /AF`, doc.catalog.has(PDFName.of('AF')));
    check(`${file}: 添付が生存`, names?.has(PDFName.of('EmbeddedFiles')) === true);
  }

  // ---- 5. 独立実装での読み戻し
  if (has('qpdf')) {
    for (const file of ['pdfa4f.pdf', 'pdfa4.pdf', 'base20.pdf']) {
      let ok = true;
      try {
        execFileSync('qpdf', ['--check', p(file)], { stdio: 'ignore' });
      } catch {
        ok = false;
      }
      check(`qpdf --check ${file}`, ok);
    }
  } else {
    console.log('  SKIP  qpdf が無いため独立実装での読み戻しを省略');
  }

  // ---- 6. PDF/A の判定（T2）
  //
  // **veraPDF を直接叩かない。** family の判定窓口である pdf-verify-mcp の
  // validate_conformance を通す。理由は 2 つある:
  //   ① 人間向けテキストを grep すると壊れる。実際に壊れた — veraPDF 1.30.2 は JVM の
  //      WARNING を出すことがあり、初版の `/PASS/ && !/FAIL/` はそれで誤判定した
  //   ② veraPDF の呼び出し方（profile id の対応・flavour の妥当性）は verify が持っている
  //      知識であり、ここで二重に実装すると片方だけ古くなる
  // 判定主体は依然として veraPDF であって、verify でも writer でもない。
  if (has('verapdf') && FONT_PATH) {
    execFileSync('npm', ['install', '--no-audit', '--no-fund', '--silent', VERIFY_PKG], {
      cwd: work,
      stdio: 'inherit',
    });
    const verify = createClient(
      join(work, 'node_modules', '@shuji-bonji', 'pdf-verify-mcp', 'dist', 'index.js'),
    );
    await verify.send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'verify-published', version: '0' },
    });
    verify.notify('notifications/initialized');

    const judge = async (file, flavour) =>
      verify.call('validate_conformance', {
        file_path: p(file),
        flavour,
        response_format: 'json',
      });

    const r4f = await judge('pdfa4f.pdf', 'pdfa-4f');
    if (r4f.isError) {
      // verify がエラーを返したのは「判定できなかった」ではなく「呼び方が間違っている」
      check('validate_conformance の呼び出し', false, r4f.raw.slice(0, 160));
    } else if (r4f.engine !== 'verapdf') {
      // native フォールバックは compliant を出せない（部分集合で適合は証明できない）
      console.log(`  SKIP  veraPDF に到達しなかった（engine=${r4f.engine}）— 判定は未実施`);
    } else {
      check(
        'veraPDF が pdfa4f.pdf を COMPLIANT と判定（ISO 19005 準拠とは言わない）',
        r4f.compliant === true,
        // 落ちたときは規則 ID を出す。数字だけでは原因（検体か writer か）が切り分けられない
        `${r4f.passedRules}/${r4f.checkedRules} rules` +
          (r4f.compliant === true
            ? ''
            : ` — ${(r4f.violations ?? []).map((v) => v.ruleId).join(', ') || '違反 ID なし'}`),
      );

      const r4 = await judge('pdfa4.pdf', 'pdfa-4');
      check(
        '素の pdfa-4 は添付があるので veraPDF が落とす = -4f が意味を持つ証拠',
        r4.compliant === false,
        `${r4.passedRules}/${r4.checkedRules} rules`,
      );
      check(
        'その違反が埋め込みファイル規則（6.9-3）であること',
        (r4.violations ?? []).some((v) => /6\.9/.test(`${v.ruleId ?? ''}${v.clause ?? ''}`)),
        (r4.violations ?? []).map((v) => v.ruleId).join(', ') || '違反が無い',
      );
    }
    verify.child.kill();
  } else {
    const why = has('verapdf')
      ? '埋め込みフォントが無い（PDF_WRITER_FONT / TEST_FONT_PATH / リポジトリ同梱の .otf のいずれかを用意する）'
      : 'veraPDF が PATH に無い';
    console.log(`  SKIP  PDF/A の判定は未実施 — ${why}`);
    console.log('        → この実行は「構造は揃っている」までしか言えない（適合の証明ではない）');
  }
} catch (error) {
  console.error(`\n検証を実施できませんでした: ${error instanceof Error ? error.message : error}`);
  process.exit(2);
} finally {
  rmSync(work, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} PASS`);
if (failed.length > 0) {
  console.log('失敗:');
  for (const f of failed) console.log(`  - ${f.label}${f.detail ? ` (${f.detail})` : ''}`);
}
process.exit(failed.length > 0 ? 1 : 0);
