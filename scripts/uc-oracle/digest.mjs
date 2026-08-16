/**
 * 意味的構造ダイジェスト — Phase 3（pdf-lib 撤去）の差分オラクルの計器。
 *
 * **なぜ独立実装（qpdf）から作るのか**
 * 出力を自分のパーサで読み戻すと、書きの誤りと読みの誤りが打ち消し合って緑になる
 * （normativepdf `GUARDS.md` T-2 / ADR-0004「二面で測る」）。撤去後は writer も
 * pdf-reader-mcp も normativepdf の上に乗るので、family 内のどのパーサもオラクルに
 * ならない。だから **qpdf --json**（C++ の別実装）を唯一の読み手にする。
 *
 * **なぜ `compare_structure` を使わないのか**
 * 実測（2026-08-13）: 比較するのは 11 プロパティで、うち Total Objects / Stream Count /
 * File Size / Catalog Entries は**直列化方式が変われば必ず differ になる**。
 * 構造木・フォント辞書の型・演算子列はひとつも見ていない。オラクルとしては
 * 「差を運べない面」（[[saturated-faces-cannot-carry-a-difference]]）である。
 *
 * **何を差と見なさないか（正規化）**
 * オブジェクト番号・世代・オフセット・xref 形式・オブジェクトストリーム化・圧縮フィルタ・
 * `/Length`・`/ID`・日付・Producer/Creator・リソース辞書のキー名・実数の表記。
 * これらは「同じ文書の別の書き方」であって、生成パスを建て直せば必ず変わる。
 * 逆に **ここに挙がっていないものは全部差として出る**。
 *
 * 出力は JSON ツリー（人が差分を読める形）と、その正規化 JSON の sha256。
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

/** 圧縮のためだけのフィルタ。意味を持たない = 正規化して落とす */
const COMPRESSION_FILTERS = new Set([
  '/FlateDecode',
  '/LZWDecode',
  '/ASCII85Decode',
  '/ASCIIHexDecode',
  '/RunLengthDecode',
]);

/**
 * 展開しないキー。
 * 逆向きの辺（親・前）は構造を上から辿れば復元できるので、展開すると同じ部分木を
 * 何度も掘ることになる（構造木 → `/Pg` → ページ → リソース … で爆発する）。
 */
const BACK_REFERENCE_KEYS = new Set(['/Parent', '/P', '/Prev', '/Last']);

/** 直列化の都合で必ず変わるキー */
const VOLATILE_KEYS = new Set(['/Length', '/ID', '/ModDate', '/CreationDate']);

/** 値を伏せて「有無」だけを見るキー（実装が変われば必ず変わる） */
const OPAQUE_KEYS = new Set(['/Producer', '/Creator']);

/**
 * 値を伏せるが**有無は見る**キー。
 * `/M`（注釈の更新日時）は実行のたびに変わる — 実測で、同じ入力を 2 回通しただけで
 * ダイジェストが割れた。日付そのものは「同じ文書か」の判断材料にならないが、
 * **キーが消えたら差**なので、落とさずに `<date>` に畳む。
 */
const NORMALIZED_DATE_KEYS = new Set(['/M', '/LastModified']);

/** リソース辞書のうち、キー名が任意（実装が勝手に決める）なカテゴリ */
const RESOURCE_CATEGORIES = [
  '/Font',
  '/XObject',
  '/ExtGState',
  '/Shading',
  '/Pattern',
  '/ColorSpace',
  '/Properties',
];

const REF_RE = /^\d+ \d+ R$/;

/** qpdf の版と JSON スキーマ版。lock に記録して、測った道具を特定できるようにする */
export function qpdfIdentity(qpdf = 'qpdf') {
  const version = execFileSync(qpdf, ['--version'], { encoding: 'utf8' })
    .split('\n')[0]
    .replace(/^qpdf version /, '')
    .trim();
  return { qpdf: version };
}

function runQpdfJson(qpdf, path) {
  const out = execFileSync(qpdf, ['--json=1', '--json-key=objects', path], {
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
  });
  const parsed = JSON.parse(out);
  return { objects: parsed.objects, jsonVersion: parsed.version ?? 1 };
}

/**
 * ストリームの中身。**フィルタを解いた後**のバイト列を取る。
 * 解けないもの（DCTDecode など）は生のまま取り、`basis` にそう書く —
 * 測り方の違う 2 つの数字を同じ列に並べない。
 */
function streamData(qpdf, path, objNum, filters) {
  const semantic = filters.filter((f) => !COMPRESSION_FILTERS.has(f));
  const flag = semantic.length > 0 ? '--raw-stream-data' : '--filtered-stream-data';
  try {
    const buf = execFileSync(qpdf, [`--show-object=${objNum}`, flag, path], {
      maxBuffer: 512 * 1024 * 1024,
    });
    return { bytes: buf, basis: semantic.length > 0 ? 'raw' : 'filtered' };
  } catch {
    return { bytes: null, basis: 'unreadable' };
  }
}

/**
 * コンテンツストリームの演算子列。
 * 実数は 4 桁に丸め（表記の違いを差にしない）、リソース名は正規名に置き換える
 * （`/F1` か `/NotoSansJP-Regular-1848524175` かは実装の勝手）。
 */
function digestContentStream(bytes, renameMap) {
  const text = bytes.toString('latin1');
  const tokens = text.match(/\/[^\s/[\]<>(){}]+|<[^>]*>|\([^)]*\)|[-+0-9.]+|[A-Za-z'"*]+/g) ?? [];
  return tokens
    .map((t) => {
      if (t.startsWith('/')) return renameMap.get(t) ?? t;
      if (/^[-+0-9.]+$/.test(t) && Number.isFinite(Number(t))) {
        return String(Math.round(Number(t) * 1e4) / 1e4);
      }
      if (t.startsWith('(') || t.startsWith('<')) {
        // 文字列リテラルは中身でなく長さと種別だけ（符号化の違いを差にしない）
        return `<str:${t.length}>`;
      }
      return t;
    })
    .join(' ');
}

/** XMP は日付と UUID を伏せ、宣言に効くフィールドだけ拾う */
function digestXmp(bytes) {
  const xml = bytes.toString('utf8');
  const pick = (re) => re.exec(xml)?.[1]?.trim() ?? null;
  return {
    pdfaidPart: pick(/pdfaid:part[>="'\s]*([0-9]+)/),
    pdfaidRev: pick(/pdfaid:rev[>="'\s]*([0-9]+)/),
    pdfaidConformance: pick(/pdfaid:conformance[>="'\s]*([A-Z]+)/),
    pdfuaidPart: pick(/pdfuaid:part[>="'\s]*([0-9]+)/),
    dcTitle: pick(/<dc:title>[\s\S]*?<rdf:li[^>]*>([^<]*)</),
    dcLanguage: pick(/<dc:language>[\s\S]*?<rdf:li[^>]*>([^<]*)</),
    hasCreateDate: /<xmp:CreateDate>/.test(xml),
    hasModifyDate: /<xmp:ModifyDate>/.test(xml),
    // 本文は差し替わりやすいので、要素名の並びだけを形として持つ
    shape: (xml.match(/<([a-zA-Z]+:[a-zA-Z]+)[ >]/g) ?? []).join(',').slice(0, 4000),
  };
}

/**
 * ページオブジェクトに 0 起点の番号を振る。
 * どこからページを指されても `{"@page": i}` に畳めるようにするため。
 */
function indexPages(objects) {
  const index = new Map();
  const root = objects.trailer?.['/Root'];
  const catalog = typeof root === 'string' ? objects[root] : undefined;
  const walk = (ref, seen) => {
    if (typeof ref !== 'string' || !objects[ref] || seen.has(ref)) return;
    seen.add(ref);
    const node = objects[ref];
    if (node['/Type'] === '/Page') {
      index.set(ref, index.size);
      return;
    }
    for (const kid of node['/Kids'] ?? []) walk(kid, seen);
  };
  walk(catalog?.['/Pages'], new Set());
  return index;
}

/**
 * 参照を全部その場で展開する（共有していても複製していても同じ形になる）。
 * 循環は「今スタックに載っているか」だけで切る。
 */
function makeCanonicalizer(ctx) {
  const { objects, pageIndex, qpdf, path } = ctx;

  /**
   * 参照かどうか。qpdf JSON v1 は参照を "N G R" という**文字列**で表すので、
   * 実在するオブジェクトを指しているときだけ参照と見なす。
   * 中身が null のもの（free / 解決できないもの）は参照として扱わない —
   * ここを緩めると `/Resources` を null に読みに行って落ちる（実測: 5 署名検体）。
   */
  const isRef = (v) =>
    typeof v === 'string' &&
    REF_RE.test(v) &&
    objects[v] !== undefined &&
    objects[v] !== null &&
    typeof objects[v] === 'object';

  /** リソース辞書のキー名を、指す先の浅い形から決めた正規名に置き換える */
  function resourceRenames(resources) {
    const map = new Map();
    if (!resources || typeof resources !== 'object') return map;
    for (const cat of RESOURCE_CATEGORIES) {
      const dict = isRef(resources[cat]) ? objects[resources[cat]] : resources[cat];
      if (!dict || typeof dict !== 'object' || Array.isArray(dict)) continue;
      const entries = Object.keys(dict).map((name) => {
        const target = isRef(dict[name]) ? objects[dict[name]] : dict[name];
        const shallow =
          target && typeof target === 'object' && !Array.isArray(target)
            ? JSON.stringify(
                Object.fromEntries(
                  Object.entries(target)
                    .filter(([k]) => !VOLATILE_KEYS.has(k))
                    .map(([k, v]) => [k, isRef(v) ? '<ref>' : v])
                    .sort(([a], [b]) => a.localeCompare(b)),
                ),
              )
            : JSON.stringify(target ?? null);
        return { name, shallow };
      });
      entries.sort((a, b) => a.shallow.localeCompare(b.shallow) || a.name.localeCompare(b.name));
      entries.forEach((e, i) => map.set(e.name, `${cat}#${i}`));
    }
    return map;
  }

  function canon(value, stack, renames, key) {
    if (isRef(value)) {
      if (pageIndex.has(value)) return { '@page': pageIndex.get(value) };
      if (stack.includes(value)) return { '@cycle': true };
      return canonObject(value, stack, renames);
    }
    if (Array.isArray(value)) return value.map((v) => canon(v, stack, renames, key));
    if (value && typeof value === 'object') return canonDict(value, stack, renames);
    if (typeof value === 'string' && value.startsWith('/') && renames.has(value)) {
      return renames.get(value);
    }
    if (typeof value === 'number') return Math.round(value * 1e4) / 1e4;
    return value;
  }

  function canonDict(dict, stack, renames) {
    // リソース辞書に入る前に、そのページ/XObject 用の rename 表を作る
    const localRenames = dict['/Resources']
      ? new Map([
          ...renames,
          ...resourceRenames(isRef(dict['/Resources']) ? objects[dict['/Resources']] : dict['/Resources']),
        ])
      : renames;

    const out = {};
    for (const key of Object.keys(dict).sort()) {
      if (VOLATILE_KEYS.has(key)) continue;
      if (BACK_REFERENCE_KEYS.has(key)) continue;
      if (OPAQUE_KEYS.has(key)) {
        out[key] = '<opaque>';
        continue;
      }
      if (NORMALIZED_DATE_KEYS.has(key)) {
        out[key] = '<date>';
        continue;
      }
      if (key === '/Filter' || key === '/DecodeParms') {
        const filters = [dict['/Filter']].flat().filter((f) => typeof f === 'string');
        const semantic = filters.filter((f) => !COMPRESSION_FILTERS.has(f));
        if (key === '/Filter' && semantic.length > 0) out['/Filter'] = semantic;
        continue;
      }
      if (key === '/ParentTree') {
        out[key] = summarizeNumberTree(dict[key]);
        continue;
      }
      if (RESOURCE_CATEGORIES.includes(key)) {
        const sub = isRef(dict[key]) ? objects[dict[key]] : dict[key];
        if (sub && typeof sub === 'object' && !Array.isArray(sub)) {
          const renamed = {};
          for (const name of Object.keys(sub).sort()) {
            const canonName = localRenames.get(name) ?? name;
            renamed[canonName] = canon(sub[name], stack, localRenames, name);
          }
          out[key] = renamed;
          continue;
        }
      }
      out[key] = canon(dict[key], stack, localRenames, key);
    }
    return out;
  }

  /** ParentTree は構造木の逆引き。中身を展開すると木ごと再帰するので形だけ数える */
  function summarizeNumberTree(node) {
    const resolved = isRef(node) ? objects[node] : node;
    if (!resolved || typeof resolved !== 'object') return { '@numtree': 'absent' };
    let entries = 0;
    const targets = new Map();
    const walk = (n, depth) => {
      if (depth > 32) return;
      const d = isRef(n) ? objects[n] : n;
      if (!d || typeof d !== 'object') return;
      for (const kid of d['/Kids'] ?? []) walk(kid, depth + 1);
      const nums = d['/Nums'] ?? [];
      for (let i = 1; i < nums.length; i += 2) {
        for (const item of [nums[i]].flat()) {
          entries += 1;
          const target = isRef(item) ? objects[item] : item;
          const s = target && typeof target === 'object' ? (target['/S'] ?? '?') : '?';
          targets.set(s, (targets.get(s) ?? 0) + 1);
        }
      }
    };
    walk(resolved, 0);
    return { '@numtree': { entries, targets: Object.fromEntries([...targets].sort()) } };
  }

  function canonObject(ref, stack, renames) {
    const dict = objects[ref];
    const objNum = Number(ref.split(' ')[0]);
    const nextStack = [...stack, ref];
    const body = canonDict(dict, nextStack, renames);

    if (dict['/Length'] === undefined) return body;

    // ストリーム: 中身も測る（辞書だけ見ると「同じ形の空の器」で緑になる）
    const filters = [dict['/Filter']].flat().filter((f) => typeof f === 'string');
    const { bytes, basis } = streamData(qpdf, path, objNum, filters);
    if (bytes === null) {
      body['@stream'] = { basis: 'unreadable' };
      return body;
    }
    const subtype = dict['/Subtype'];
    if (dict['/Type'] === '/Metadata' || subtype === '/XML') {
      body['@stream'] = { basis, kind: 'xmp', xmp: digestXmp(bytes) };
    } else if (isContentStream(ref)) {
      const localRenames = renames;
      body['@stream'] = {
        basis,
        kind: 'content',
        ops: digestContentStream(bytes, localRenames),
      };
    } else {
      body['@stream'] = {
        basis,
        kind: 'binary',
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex').slice(0, 16),
      };
    }
    return body;
  }

  /** どのページの /Contents に載っているか */
  const contentRefs = new Set();
  for (const [ref, obj] of Object.entries(objects)) {
    if (ref === 'trailer' || !obj || typeof obj !== 'object') continue;
    if (obj['/Type'] !== '/Page') continue;
    for (const c of [obj['/Contents']].flat()) if (typeof c === 'string') contentRefs.add(c);
  }
  const isContentStream = (ref) => contentRefs.has(ref);

  return { canon, canonObject, resourceRenames, isRef };
}

/**
 * ヘッダの版（§7.5.2 `%PDF-n.m`）を生バイトから読む。
 * 先頭にゴミがあるファイル（origin > 0）でも、最初の `%PDF-` を探す。
 * @returns {string|null}
 */
function readHeaderVersion(path) {
  const head = readFileSync(path).subarray(0, 1024).toString('latin1');
  const m = /%PDF-(\d\.\d)/.exec(head);
  return m ? m[1] : null;
}

/**
 * PDF 1 本のダイジェストを作る。
 * @returns {{tree: object, sha256: string, meta: object}}
 */
export function digestPdf(path, { qpdf = 'qpdf' } = {}) {
  const { objects } = runQpdfJson(qpdf, path);
  const trailer = objects.trailer ?? {};
  const pageIndex = indexPages(objects);
  const ctx = { objects, pageIndex, qpdf, path };
  const { canonObject, isRef } = makeCanonicalizer(ctx);

  const rootRef = trailer['/Root'];
  const infoRef = trailer['/Info'];
  // ページは**ここで 1 回だけ展開する**。catalog から辿ると `{"@page": i}` に畳まれるので、
  // 畳んだままだとページの中身（リソース・注釈・コンテンツストリーム）が
  // ダイジェストに 1 バイトも入らない。
  // 実測でこれを踏んだ: ページ番号スタンプの色を変えても差が出なかった（T-3 が発火しなかった）。
  const tree = {
    root: isRef(rootRef) ? canonObject(rootRef, [], new Map()) : null,
    pages: [...pageIndex.keys()].map((ref) => canonObject(ref, [], new Map())),
    info: isRef(infoRef) ? canonObject(infoRef, [], new Map()) : null,
    pageCount: pageIndex.size,
    encrypted: trailer['/Encrypt'] !== undefined,
  };

  const canonicalJson = JSON.stringify(tree);
  return {
    tree,
    sha256: createHash('sha256').update(canonicalJson).digest('hex'),
    meta: {
      // 伏せた値は消さずに脇に置く。人が「何が変わったか」を読めるように
      producer: objects[infoRef]?.['/Producer'] ?? null,
      creator: objects[infoRef]?.['/Creator'] ?? null,
      objectCount: Object.keys(objects).length - 1,
      // 🔴 ヘッダの版（§7.5.2）。catalog の `/Version`（Table 29）は `tree.root` に
      // 入っているが、**ヘッダは今までどこにも入っていなかった**。
      // 実測（2026-08-15）: 旧 `rotate_pages` は入力が `%PDF-2.0` でも
      // `%PDF-1.7` を書き、catalog `/Version` も足さないので**実効版が 2.0 → 1.7 に下がる**。
      // オラクルはこれを 1 度も見ていなかった（[[saturated-faces-cannot-carry-a-difference]]）。
      // qpdf を通さず生バイトから読むのは、版が qpdf の実装や版に依らない事実だから
      headerVersion: readHeaderVersion(path),
    },
  };
}
