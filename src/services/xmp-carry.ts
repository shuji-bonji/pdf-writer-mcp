/**
 * 既存の XMP の値を、書き換えるときに運ぶ（SPEC-WRITER-OUTPUT-VERSION-003。#28）。
 *
 * 0.27.x までの `syncXmpWithInfo` は、パケットを Info の値から作り直していた。
 * 拾っていたのは `dc:title` の最初の `rdf:li` と、宣言（`pdfuaid`・`pdfaid`・`tdm`）と
 * `dc:language`・`xmp:CreateDate` だけで、次が消えていた:
 *
 * - `dc:title` の 2 つ目以降の言語の項目（§14.3.3 の例は `x-default`・`en`・`de`）
 * - `dc:creator` の 2 人目以降（Info の `/Author` の 1 文字列から作り直すため）
 * - 書き手が知らない名前空間の値（`xmpMM:DocumentID` など）
 *
 * ここは XMP の RDF/XML を読んで、`rdf:RDF` の直下の `rdf:Description` が持つ
 * プロパティを 1 つずつ、**書かれていたバイト列のまま**取り出す。運ぶときは
 * プロパティごとに `rdf:Description` を 1 つ作り、中で使っている接頭辞の宣言を付け直す
 * （元の宣言は `rdf:RDF` や `x:xmpmeta` にあることがあり、切り出すと外れる）。
 *
 * XML の解析器は依存に入れない。XMP のパケットは整形式の XML で、
 * 要るのは要素の入れ子と名前空間の解決だけなので、字句を拾う正規表現 1 本で足りる。
 */

export const RDF_NS = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const XML_NS_PREFIXES = new Set(['xml', 'xmlns']);

interface XmlNode {
  /** 要素の修飾名（例 `dc:title`） */
  qname: string;
  /** 名前空間の URI（解決できなければ空文字） */
  uri: string;
  local: string;
  attrs: Array<[string, string]>;
  /** この要素の開始タグの先頭 */
  start: number;
  /** 開始タグの直後 */
  openEnd: number;
  /** 終了タグの先頭（空要素なら openEnd と同じ） */
  closeStart: number;
  /** 終了タグの直後 */
  end: number;
  /** 開始タグの位置で有効な接頭辞 → URI */
  scope: Map<string, string>;
  children: XmlNode[];
}

const TOKEN =
  /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<!DOCTYPE[^>]*>|<\/([^\s>]+)\s*>|<([^\s/>!?]+)((?:\s+[^\s=>/]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
const ATTR = /([^\s=>/]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function splitQName(qname: string): [string, string] {
  const i = qname.indexOf(':');
  return i < 0 ? ['', qname] : [qname.slice(0, i), qname.slice(i + 1)];
}

/** 整形式でなければ `null`（そのときは運ばず、呼び出し側が今までどおり作り直す） */
function parse(xml: string): XmlNode[] | null {
  const roots: XmlNode[] = [];
  const stack: XmlNode[] = [];
  TOKEN.lastIndex = 0;
  for (let m = TOKEN.exec(xml); m !== null; m = TOKEN.exec(xml)) {
    const [whole, closeName, openName, attrText, selfClose] = m;
    if (closeName !== undefined) {
      const node = stack.pop();
      if (node === undefined || node.qname !== closeName) return null;
      node.closeStart = m.index;
      node.end = m.index + whole.length;
      continue;
    }
    if (openName === undefined) continue; // コメント・処理命令・CDATA
    const parent = stack[stack.length - 1];
    const scope = new Map(parent?.scope ?? []);
    const attrs: Array<[string, string]> = [];
    ATTR.lastIndex = 0;
    for (let a = ATTR.exec(attrText ?? ''); a !== null; a = ATTR.exec(attrText ?? '')) {
      const value = a[2] ?? a[3] ?? '';
      if (a[1] === 'xmlns') scope.set('', value);
      else if (a[1].startsWith('xmlns:')) scope.set(a[1].slice(6), value);
      else attrs.push([a[1], value]);
    }
    const [prefix, local] = splitQName(openName);
    const end = m.index + whole.length;
    const node: XmlNode = {
      qname: openName,
      uri: scope.get(prefix) ?? '',
      local,
      attrs,
      start: m.index,
      openEnd: end,
      closeStart: end,
      end,
      scope,
      children: [],
    };
    (parent?.children ?? roots).push(node);
    if (selfClose !== '/') stack.push(node);
  }
  return stack.length === 0 ? roots : null;
}

function find(nodes: XmlNode[], uri: string, local: string): XmlNode[] {
  const out: XmlNode[] = [];
  for (const n of nodes) {
    if (n.uri === uri && n.local === local) out.push(n);
    else out.push(...find(n.children, uri, local));
  }
  return out;
}

/** 運ぶプロパティ 1 つ */
export interface XmpProperty {
  uri: string;
  local: string;
  /** 書かれていたままの要素（属性で書かれていたものは要素の形に直す） */
  xml: string;
  /** `xml` の中で使っている接頭辞の宣言 */
  namespaces: Map<string, string>;
  /** `xml` が `rdf:Alt` のとき、その `rdf:li` の言語（`xml:lang`）と値の範囲 */
  altItems?: Array<{ lang: string | undefined; innerStart: number; innerEnd: number }>;
  /** `pdfaExtension:schemas` のとき、`rdf:Bag` の各 `rdf:li` と、その li が記述する名前空間 */
  schemaItems?: Array<{ namespaceURI: string; xml: string }>;
}

const PREFIX_USE = /<\/?([A-Za-z_][\w.-]*):|\s([A-Za-z_][\w.-]*):[\w.-]+\s*=/g;

function usedNamespaces(xml: string, scope: Map<string, string>): Map<string, string> {
  const out = new Map<string, string>();
  PREFIX_USE.lastIndex = 0;
  for (let m = PREFIX_USE.exec(xml); m !== null; m = PREFIX_USE.exec(xml)) {
    const prefix = m[1] ?? m[2];
    if (prefix === undefined || XML_NS_PREFIXES.has(prefix)) continue;
    const uri = scope.get(prefix);
    if (uri !== undefined) out.set(prefix, uri);
  }
  return out;
}

const EXTENSION_NS = 'http://www.aiim.org/pdfa/ns/extension/';
const SCHEMA_NS = 'http://www.aiim.org/pdfa/ns/schema#';

/**
 * XMP パケットから、`rdf:RDF` の直下の `rdf:Description` が持つプロパティを取り出す。
 * 整形式でなければ `null`。
 */
export function readXmpProperties(xmp: string): XmpProperty[] | null {
  const roots = parse(xmp);
  if (roots === null) return null;
  const props: XmpProperty[] = [];
  for (const rdf of find(roots, RDF_NS, 'RDF')) {
    for (const desc of rdf.children) {
      if (desc.uri !== RDF_NS || desc.local !== 'Description') continue;
      // 属性で書かれたプロパティ（`xmpMM:DocumentID="…"`）。値は属性のまま
      // エスケープされているので、要素の中身にそのまま置ける
      for (const [qname, value] of desc.attrs) {
        const [prefix, local] = splitQName(qname);
        const uri = desc.scope.get(prefix);
        if (prefix === '' || XML_NS_PREFIXES.has(prefix) || uri === undefined || uri === RDF_NS) {
          continue;
        }
        props.push({
          uri,
          local,
          xml: `<${qname}>${value}</${qname}>`,
          namespaces: new Map([[prefix, uri]]),
        });
      }
      for (const p of desc.children) {
        const xml = xmp.slice(p.start, p.end);
        const prop: XmpProperty = {
          uri: p.uri,
          local: p.local,
          xml,
          namespaces: usedNamespaces(xml, p.scope),
        };
        const alt = p.children.find((c) => c.uri === RDF_NS && c.local === 'Alt');
        if (alt !== undefined) {
          prop.altItems = alt.children
            .filter((c) => c.uri === RDF_NS && c.local === 'li')
            .map((li) => ({
              lang: li.attrs.find(([k]) => k === 'xml:lang')?.[1],
              innerStart: li.openEnd - p.start,
              innerEnd: li.closeStart - p.start,
            }));
        }
        if (p.uri === EXTENSION_NS && p.local === 'schemas') {
          const bag = p.children.find((c) => c.uri === RDF_NS && c.local === 'Bag');
          prop.schemaItems = (bag?.children ?? [])
            .filter((c) => c.uri === RDF_NS && c.local === 'li')
            .map((li) => {
              const nsNode = find(li.children, SCHEMA_NS, 'namespaceURI')[0];
              return {
                namespaceURI:
                  nsNode === undefined ? '' : xmp.slice(nsNode.openEnd, nsNode.closeStart).trim(),
                xml: xmp.slice(li.start, li.end),
              };
            });
        }
        props.push(prop);
      }
    }
  }
  return props;
}

/** プロパティを 1 つ持つ `rdf:Description` を書く（接頭辞の宣言を付け直す） */
export function descriptionOf(xml: string, namespaces: Map<string, string>): string {
  const decls = [...namespaces]
    .filter(([prefix, uri]) => !(prefix === 'rdf' && uri === RDF_NS))
    .map(([prefix, uri]) => ` xmlns:${prefix}="${uri}"`)
    .join('');
  return `    <rdf:Description rdf:about=""${decls}>\n      ${xml}\n    </rdf:Description>`;
}

/**
 * `rdf:Alt` の既定の項目（`x-default`、無ければ先頭）を書き換える。項目が 1 つも無ければ足す。
 * 書き換えなかった言語（`xml:lang`）を返す —— 古い値のまま残るので、呼び出し側が伝える。
 */
export function replaceDefaultAltItem(
  prop: XmpProperty,
  escapedValue: string,
): { xml: string; untouched: string[] } {
  const items = prop.altItems ?? [];
  // 既定の項目は x-default。無ければ先頭の項目を既定とみなす（このサーバの判断。生成系は
  // x-default ではなく文書の言語を xml:lang にした項目を 1 つだけ書いており、それを書き換えずに
  // x-default を足すと、同じ文書に 2 つの題名が並ぶ）
  const target = items.find((i) => i.lang === 'x-default') ?? items[0];
  const untouched = items
    .filter((i) => i !== target && i.lang !== undefined)
    .map((i) => i.lang as string);
  if (target !== undefined) {
    return {
      xml: prop.xml.slice(0, target.innerStart) + escapedValue + prop.xml.slice(target.innerEnd),
      untouched,
    };
  }
  const altOpen = /<([\w.-]+:)?Alt\b[^>]*>/.exec(prop.xml);
  if (altOpen === null) return { xml: prop.xml, untouched };
  const liName = `${altOpen[1] ?? ''}li`;
  const at = altOpen.index + altOpen[0].length;
  return {
    xml: `${prop.xml.slice(0, at)}<${liName} xml:lang="x-default">${escapedValue}</${liName}>${prop.xml.slice(at)}`,
    untouched,
  };
}
