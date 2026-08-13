#!/usr/bin/env node
/**
 * UC 差分オラクル — 採取と突き合わせ。
 *
 * Phase 3（pdf-lib 撤去）は「消す」作業ではなく「生成パスを建て直す」作業なので、
 * バイト一致は最初から成立しない。だから **旧実装（pdf-lib 版 0.19.0）の出力を
 * 意味的ダイジェストとして先に固定し**、建て直した後の出力をそれと突き合わせる。
 *
 * この形が要る理由は実測にある: verify の `revision-diff.ts` を normativepdf に
 * 置き換えたとき、**ユニットテストは前後とも全緑で何も出さず**、旧実装との A/B だけが
 * 差 13 件（うち重大 2 件）を出した（[[ab-old-implementation-from-git]]）。
 * writer は 24 ファイル 7,178 行なので git から旧実装を復元する形は取れない。
 * **撤去に着手する前に採取しておく**ことがこのスクリプトの主目的である。
 *
 * 使い方:
 *   node scripts/uc-oracle/run.mjs --update      # ゴールデンを採取して lock に固定
 *   node scripts/uc-oracle/run.mjs               # lock と突き合わせる（差があれば exit 1）
 *   node scripts/uc-oracle/run.mjs --verify      # veraPDF / 署名検証も回す（ホスト専用）
 *   node scripts/uc-oracle/run.mjs --keep /tmp/x # 生成物を残す（原因調査用）
 *
 * 終了コード: 0 = 一致 / 1 = 差あり・後退 / 2 = 実施できなかった
 */

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digestPdf, qpdfIdentity } from './digest.mjs';
import { axisCoverage, FONT_CFF, FONT_TTF, repoRoot, SPECIMENS } from './specimens.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const LOCK = join(here, 'uc-oracle.lock.json');
const GOLDEN_DIR = join(here, 'golden');

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const UPDATE = flag('--update');
const WITH_VERIFY = flag('--verify');
const FILTER = opt('--filter', null);
const KEEP = opt('--keep', null);
const QPDF = opt('--qpdf', 'qpdf');
const VERIFY_SERVER = process.env.PDF_VERIFY_SERVER ?? null;

// ---------------------------------------------------------------- MCP クライアント

/** MCP を stdio で起動する最小クライアント（`scripts/verify-published.mjs` と同型） */
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
        /* サーバの人間向けログ */
      }
    }
  });
  child.stderr.resume();
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
    call: async (name, args) => {
      const res = await send('tools/call', { name, arguments: args });
      const text = res.result?.content?.map((c) => c.text).join('\n') ?? res.error?.message ?? '';
      let parsed = {};
      try {
        parsed = JSON.parse(text);
      } catch {
        /* 構造化 JSON でない = 入口の検証エラー */
      }
      return { ...parsed, isError: res.result?.isError === true, raw: text };
    },
  };
}

async function handshake(client, name) {
  const init = await client.send('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name, version: '0' },
  });
  client.notify('notifications/initialized');
  return init.result?.serverInfo?.version ?? null;
}

// ---------------------------------------------------------------- 引数の解決

/**
 * ツール応答から、実装が変われば必ず変わる値を落とす。
 * `path` と `bytes` は落とす（バイト数は圧縮方式で変わる）が、
 * **`warnings` は残す** — 「宣言を書いたら測れ」の警告が消えることは後退である。
 */
function normalizeResponse(res) {
  const { path: _p, bytes: _b, raw: _r, ...rest } = res;
  const strip = (v) =>
    typeof v === 'string' ? v.replace(/\/[^\s"']*\/(?=[^/\s"']+\.(pdf|csv|otf|ttf))/g, '<dir>/') : v;
  return JSON.parse(JSON.stringify(rest, (_k, v) => strip(v)));
}

class Unavailable extends Error {}

/**
 * `--filter` は依存ごと選ぶ。
 * 検体は前の検体の出力を入力にするので、名前だけで切ると先行検体が回らず
 * **「入力が無い」= unavailable として緑にも赤にもならない**。
 * それは調査したい検体を測らずに済ませているだけである（実測でこれを踏んだ）。
 */
function selectWithDependencies(filter) {
  const ids = new Set(SPECIMENS.map((s) => s.id));
  const byId = new Map(SPECIMENS.map((s) => [s.id, s]));
  if (filter === null) return ids;
  const selected = new Set();
  const add = (id) => {
    if (selected.has(id)) return;
    selected.add(id);
    const spec = byId.get(id);
    for (const token of JSON.stringify(spec?.steps ?? []).matchAll(/\{\{([^}]+)\}\}/g)) {
      if (ids.has(token[1])) add(token[1]);
    }
  };
  for (const s of SPECIMENS) if (s.id.includes(filter)) add(s.id);
  return selected;
}

function resolveArgs(args, ctx) {
  const out = {};
  for (const [key, value] of Object.entries(args)) {
    if (key === 'font') {
      const path = value === 'cff' ? FONT_CFF : value === 'truetype' ? FONT_TTF : null;
      if (path === null || !existsSync(path)) {
        throw new Unavailable(`フォントが無い: ${value}`);
      }
      out.fontPath = path;
      continue;
    }
    out[key] = JSON.parse(
      JSON.stringify(value, (_k, v) => (typeof v === 'string' ? substitute(v, ctx) : v)),
    );
  }
  return out;
}

function substitute(value, ctx) {
  return value.replace(/\{\{([^}]+)\}\}/g, (_m, token) => {
    if (token === 'prev') return ctx.prev ?? '';
    if (token === 'input') return ctx.input ?? '';
    if (token === 'csv') return ctx.csv;
    const produced = ctx.produced.get(token);
    if (!produced) throw new Unavailable(`先行検体の出力が無い: ${token}`);
    return produced;
  });
}

// ---------------------------------------------------------------- 採取

async function capture() {
  const work = KEEP ?? mkdtempSync(join(tmpdir(), 'uc-oracle-'));
  mkdirSync(work, { recursive: true });
  const csv = join(work, 'invoice.csv');
  writeFileSync(csv, 'date,amount\n2026-07-28,1200\n');

  const serverPath = join(repoRoot, 'dist', 'index.js');
  if (!existsSync(serverPath)) {
    throw new Error(`dist が無い。先に npm run build（${serverPath}）`);
  }
  const writer = createClient(serverPath);
  const writerVersion = await handshake(writer, 'uc-oracle');

  let verify = null;
  if (WITH_VERIFY) {
    const path = VERIFY_SERVER ?? findVerifyServer();
    if (path === null) {
      console.warn('  ! pdf-verify-mcp が見つからない — 判定は行わない（緑にも数えない）');
    } else {
      verify = createClient(path);
      await handshake(verify, 'uc-oracle');
    }
  }

  const produced = new Map();
  const records = {};
  const selected = selectWithDependencies(FILTER);

  for (const spec of SPECIMENS) {
    if (!selected.has(spec.id)) continue;
    const record = { uc: spec.uc, axes: spec.axes ?? {} };
    try {
      const input = spec.inputFile ? spec.inputFile() : null;
      if (input !== null && !existsSync(input)) {
        throw new Unavailable(`入力が無い: ${input}`);
      }
      const ctx = { produced, csv, input, prev: null };
      const responses = [];
      let last = null;
      for (const [i, step] of spec.steps.entries()) {
        const outputPath = join(work, `${spec.id}--${i}-${step.tool}.pdf`);
        const args = { ...resolveArgs(step.args, ctx), outputPath };
        const res = await writer.call(step.tool, args);
        if (res.isError === true) {
          throw new Error(`${step.tool} が拒否した: ${String(res.raw).slice(0, 200)}`);
        }
        responses.push({ tool: step.tool, response: normalizeResponse(res) });
        ctx.prev = outputPath;
        last = outputPath;
      }
      produced.set(spec.id, last);

      record.status = 'measured';
      record.responses = responses;
      record.qpdfCheck = qpdfCheck(last);

      // 構造の面だけは読み手（qpdf）が拒むことがある。**そのとき残りの面まで捨てない** —
      // 署名やツール応答は測れているのに、1 面の測定不能で検体ごと落とすと
      // 「測っていない」が「失敗」に化ける。
      // 拒まれたら**入力も同じ読み手に通して原因を機械で切り分ける**。
      // 入力から読めないなら、それは writer の後退ではなく検体と読み手の相性である
      // （実測: `dss-pades-5sigs-doctimestamp.pdf` は入力の時点で page tree ノードに
      //  `/Type /Page` が無く obj 56 が null。qpdf 10 は override して進み、qpdf 12 は拒む）
      try {
        const { tree, sha256, meta } = digestPdf(last, { qpdf: QPDF });
        record.structure = { status: 'measured' };
        record.sha256 = sha256;
        record.meta = meta;
        record.tree = tree;
      } catch (error) {
        record.structure = {
          status: 'unreadable',
          reason: String(error?.message ?? error)
            .split('\n')
            .filter((l) => l.includes('qpdf:'))
            .join(' | ')
            .replace(new RegExp(work.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '<dir>')
            .slice(0, 300),
          // 入力も読めないなら writer の出力のせいではない
          inputReadable: input === null ? null : canQpdfJson(input),
        };
      }

      if (verify !== null && spec.verify) {
        record.verify = [];
        for (const v of spec.verify) {
          const r = await verify.call('validate_conformance', {
            file_path: last,
            flavour: v.flavour,
            response_format: 'json',
          });
          record.verify.push(
            r.isError === true || r.engine !== 'verapdf'
              ? { flavour: v.flavour, status: 'undecided', engine: r.engine ?? 'error' }
              : {
                  flavour: v.flavour,
                  status: 'decided',
                  compliant: r.compliant === true,
                  passedRules: r.passedRules,
                  checkedRules: r.checkedRules,
                  violations: (r.violations ?? []).map((x) => x.ruleId).sort(),
                  expect: v.expect,
                },
          );
        }
      } else if (spec.verify) {
        record.verify = spec.verify.map((v) => ({ flavour: v.flavour, status: 'undecided' }));
      }

      if (verify !== null && spec.verifySignatures) {
        const r = await verify.call('verify_signatures', { file_path: last, response_format: 'json' });
        // **実測した形に合わせる**: verify_signatures は署名の**配列をそのまま**返す
        // （`{signatures: [...]}` ではない）。推量で `r.signatures` を読んでいた初版は
        // 5 署名の検体を「署名 0 本」と記録した — 嘘の baseline を固定するところだった
        const payload = (() => {
          try {
            return JSON.parse(r.raw);
          } catch {
            return null;
          }
        })();
        const sigs = Array.isArray(payload) ? payload : (payload?.signatures ?? null);
        record.signatures =
          r.isError === true || sigs === null
            ? { status: 'undecided', reason: String(r.raw).slice(0, 120) }
            : {
                status: 'decided',
                count: sigs.length,
                valid: sigs.filter((s) => s.verdict === 'valid').length,
                digestMatches: sigs.filter((s) => s.cms?.digestMatches === true).length,
                expectValid: spec.verifySignatures.expectValid,
              };
      } else if (spec.verifySignatures) {
        record.signatures = { status: 'undecided' };
      }
    } catch (error) {
      record.status = error instanceof Unavailable ? 'unavailable' : 'failed';
      record.reason = error instanceof Error ? error.message : String(error);
    }
    const mark =
      record.status === 'measured' ? '  ok  ' : record.status === 'unavailable' ? ' SKIP ' : ' FAIL ';
    console.log(`${mark} ${spec.id}${record.reason ? ` — ${record.reason}` : ''}`);
    records[spec.id] = record;
  }

  writer.child.kill();
  verify?.child.kill();
  if (KEEP === null) rmSync(work, { recursive: true, force: true });

  return { writerVersion, records };
}

function qpdfCheck(path) {
  try {
    execFileSync(QPDF, ['--check', path], { stdio: 'pipe' });
    return 'clean';
  } catch (error) {
    const out = `${error.stdout ?? ''}${error.stderr ?? ''}`;
    // qpdf は警告でも非 0 を返す。苦情の中身を残す（数字だけでは原因が切り分けられない）
    return out
      .split('\n')
      .map((l) => l.replace(path, '<file>').trim())
      .filter(Boolean)
      .join(' | ')
      .slice(0, 400);
  }
}

/** その読み手（qpdf）でオブジェクトグラフを取れるか。原因の帰属に使う */
function canQpdfJson(path) {
  try {
    execFileSync(QPDF, ['--json=1', '--json-key=objects', path], {
      stdio: 'pipe',
      maxBuffer: 512 * 1024 * 1024,
    });
    return true;
  } catch {
    return false;
  }
}

function findVerifyServer() {
  const candidates = [
    join(repoRoot, '..', 'pdf-verify-mcp', 'dist', 'index.js'),
    join(repoRoot, 'node_modules', '@shuji-bonji', 'pdf-verify-mcp', 'dist', 'index.js'),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

// ---------------------------------------------------------------- 突き合わせ

/** ツリーの差を「どこが」まで出す。数字だけでは原因が切り分けられない */
function diffTrees(a, b, path = '', out = [], limit = 40) {
  if (out.length >= limit) return out;
  if (JSON.stringify(a) === JSON.stringify(b)) return out;
  const isObj = (v) => v !== null && typeof v === 'object';
  if (!isObj(a) || !isObj(b) || Array.isArray(a) !== Array.isArray(b)) {
    out.push({ path, golden: clip(a), current: clip(b) });
    return out;
  }
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  for (const k of keys) diffTrees(a[k], b[k], `${path}/${k}`, out, limit);
  return out;
}

const clip = (v) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s === undefined ? '<absent>' : s.length > 160 ? `${s.slice(0, 160)}…` : s;
};

function compare(lock, current) {
  const problems = [];
  const ids = [...new Set([...Object.keys(lock.specimens), ...Object.keys(current.records)])].sort();

  for (const id of ids) {
    const g = lock.specimens[id];
    const c = current.records[id];
    if (!g) {
      problems.push({ id, kind: 'new-specimen', detail: 'lock に無い検体。--update で採り直す' });
      continue;
    }
    if (!c) continue; // --filter で回していない
    if (g.status !== c.status) {
      problems.push({ id, kind: 'status', detail: `${g.status} → ${c.status}: ${c.reason ?? ''}` });
      continue;
    }
    if (c.status !== 'measured') continue;

    // 構造の面が「読めていた → 読めない」に落ちるのは後退。逆向き（読めるようになった）も
    // 黙って通さない — baseline を改善に置き去りにすると、滑り戻りを検知しなくなる
    const gStruct = g.structure?.status ?? 'measured';
    const cStruct = c.structure?.status ?? 'measured';
    if (gStruct !== cStruct) {
      problems.push({
        id,
        kind: 'structure-readability',
        detail:
          `${gStruct} → ${cStruct}` +
          (c.structure?.inputReadable === false
            ? '（入力もこの読み手で読めない = writer の後退ではない）'
            : c.structure?.inputReadable === true
              ? '（入力は読める = 出力側の問題）'
              : '') +
          (c.structure?.reason ? ` — ${c.structure.reason}` : ''),
      });
      continue;
    }
    if (cStruct !== 'measured') continue;

    if (g.sha256 !== c.sha256) {
      const goldenTree = readGolden(id);
      const diffs = goldenTree === null ? [] : diffTrees(goldenTree, c.tree);
      problems.push({ id, kind: 'structure', detail: g.sha256.slice(0, 12), diffs });
    }
    if (JSON.stringify(g.responses) !== JSON.stringify(c.responses)) {
      problems.push({
        id,
        kind: 'tool-response',
        diffs: diffTrees(g.responses, c.responses),
      });
    }
    if (g.qpdfCheck !== c.qpdfCheck) {
      problems.push({ id, kind: 'qpdf', detail: `${g.qpdfCheck} → ${c.qpdfCheck}` });
    }
    for (const [i, gv] of (g.verify ?? []).entries()) {
      const cv = (c.verify ?? [])[i];
      if (!cv) continue;
      if (gv.status === 'decided' && cv.status !== 'decided') {
        // 測れていたものが測れなくなるのは後退。判定不能は無罪ではない
        problems.push({ id, kind: 'verify-undecided', detail: `${gv.flavour}` });
      } else if (gv.status === 'decided' && JSON.stringify(gv) !== JSON.stringify(cv)) {
        problems.push({
          id,
          kind: 'verify',
          detail: `${gv.flavour}: ${gv.passedRules}/${gv.checkedRules} → ${cv.passedRules}/${cv.checkedRules}`,
          diffs: diffTrees(gv, cv),
        });
      }
    }
    if (g.signatures?.status === 'decided' && JSON.stringify(g.signatures) !== JSON.stringify(c.signatures)) {
      problems.push({ id, kind: 'signatures', diffs: diffTrees(g.signatures, c.signatures) });
    }
  }
  return problems;
}

function readGolden(id) {
  const p = join(GOLDEN_DIR, `${id}.json`);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
}

// ---------------------------------------------------------------- 本体

try {
  const identity = qpdfIdentity(QPDF);
  console.log(`# UC 差分オラクル（qpdf ${identity.qpdf}${WITH_VERIFY ? ' + verify' : ''}）`);
  const { writerVersion, records } = await capture();

  const counts = { measured: 0, unavailable: 0, failed: 0, structureUnreadable: 0 };
  for (const r of Object.values(records)) {
    counts[r.status] += 1;
    if (r.structure?.status === 'unreadable') counts.structureUnreadable += 1;
  }
  console.log(
    `\n測定 ${counts.measured} / 測れず ${counts.unavailable} / 失敗 ${counts.failed}` +
      `（うち構造を読めなかった検体 ${counts.structureUnreadable}）` +
      '（測れなかったものは緑に数えない）',
  );

  const coverage = axisCoverage();
  const thinAxes = Object.entries(coverage).filter(([, v]) => v.distinct < 2);
  if (thinAxes.length > 0) {
    console.log(`! 1 形しか無い軸（測れていない）: ${thinAxes.map(([k]) => k).join(', ')}`);
  }

  // 検体が宣言した期待（適合するはず / 署名は生き残るはず）を、採取時点で突き合わせる。
  // **期待に反した出力をゴールデンに固定すると、以後その嘘が基準になる。**
  // 実測でこれを踏みかけた: 応答の形を推量していて、5 署名の検体を「署名 0 本」と記録した
  const expectationViolations = [];
  for (const [id, r] of Object.entries(records)) {
    for (const v of r.verify ?? []) {
      if (v.status !== 'decided') continue;
      const ok = v.expect === 'compliant' ? v.compliant === true : v.compliant === false;
      if (!ok) expectationViolations.push(`${id}: ${v.flavour} は ${v.expect} のはず`);
    }
    const s = r.signatures;
    if (s?.status === 'decided' && s.valid < s.expectValid) {
      expectationViolations.push(`${id}: 有効な署名 ${s.valid} 本 < 期待 ${s.expectValid} 本`);
    }
  }
  if (expectationViolations.length > 0) {
    console.log('\n検体の期待に反した出力:');
    for (const v of expectationViolations) console.log(`  - ${v}`);
  }

  if (UPDATE) {
    if (expectationViolations.length > 0) {
      console.error('\n期待に反する出力はゴールデンにしない。原因を潰してから採り直すこと');
      process.exit(1);
    }
    mkdirSync(GOLDEN_DIR, { recursive: true });
    const specimens = {};
    for (const [id, r] of Object.entries(records)) {
      const { tree, ...rest } = r;
      specimens[id] = rest;
      if (tree) writeFileSync(join(GOLDEN_DIR, `${id}.json`), `${JSON.stringify(tree, null, 1)}\n`);
    }
    const lock = {
      $comment:
        'pdf-lib 版 writer の出力を固定したゴールデン。Phase 3（生成パス移行）の A/B の相手。' +
        '実装変更と同じコミットで更新しない — 基準を動かしながら測ることになる。' +
        'veraPDF / 署名の判定は --verify を付けたホスト実行でしか入らない（undecided のまま固定しない）。',
      // 日付だけだと「どの日に測ったか」が時差で 1 日ずれる（実測: JST 8/14 00:07 の採取が
      // 2026-08-13 と記録された）。測った時刻は基準の身元なので丸めない
      capturedAt: new Date().toISOString(),
      writerVersion,
      tooling: identity,
      verifyRan: WITH_VERIFY,
      counts,
      axisCoverage: coverage,
      specimens,
    };
    writeFileSync(LOCK, `${JSON.stringify(lock, null, 1)}\n`);
    console.log(`\nゴールデンを固定した: ${LOCK}`);
    process.exit(counts.failed > 0 ? 1 : 0);
  }

  if (!existsSync(LOCK)) {
    console.error('\nlock が無い。先に --update で採取する');
    process.exit(2);
  }
  const lock = JSON.parse(readFileSync(LOCK, 'utf8'));
  if (lock.tooling?.qpdf !== identity.qpdf) {
    console.warn(
      `! qpdf の版が違う（採取 ${lock.tooling?.qpdf} / 今 ${identity.qpdf}）— ` +
        '差が実装のものか読み手のものか切り分けられない',
    );
  }
  if (lock.verifyRan === true && !WITH_VERIFY) {
    console.warn('! ゴールデンは --verify 付きで採ってある。判定面を測らずに緑を名乗らないこと');
  }

  const problems = compare(lock, { records });
  if (problems.length === 0) {
    console.log('\n差なし。');
    process.exit(counts.failed > 0 ? 1 : 0);
  }
  console.log(`\n差 ${problems.length} 件:`);
  for (const p of problems) {
    console.log(`  [${p.kind}] ${p.id}${p.detail ? ` — ${p.detail}` : ''}`);
    for (const d of (p.diffs ?? []).slice(0, 12)) {
      console.log(`      ${d.path}: ${d.golden} → ${d.current}`);
    }
  }
  process.exit(1);
} catch (error) {
  console.error(`\n実施できなかった: ${error instanceof Error ? error.stack : error}`);
  process.exit(2);
}
