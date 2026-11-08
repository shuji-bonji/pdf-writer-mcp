/**
 * create_markdown_pdf のリストの構造と描き方（openspec/changes/list-labels-and-nesting。#12）
 *
 * 0.24.0 までは:
 *   - 記号を本文に入れ、`L > LI > LBody` だけを作っていた（#12・F-14）
 *   - 番号付きリストの `L` に ListNumbering が無かった（ISO 14289-1 §7.6 R-7.6-4 の shall）
 *   - 入れ子のリストを親の項目の文字に畳んでいた（「• Alpha - Beta - Gamma」）
 *
 * 構造木は pdf-lib で辿り、各要素の文字はコンテンツストリームの `/<tag> <</MCID n>> BDC … EMC`
 * の中の `<hex> Tj` から取る。検体は ASCII の本文なので TEST_FONT_PATH が無くても走る。
 */

import { inflateSync } from 'node:zlib';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { handleCreateMarkdownPdf } from '../src/tools/handlers.js';

interface Shown {
  x: number;
  y: number;
  text: string;
}

interface Node {
  role: string;
  attrs: Map<string, string>;
  kids: Node[];
  /** この要素の直下の MCID の中身（子の要素の分は含まない） */
  shown: Shown[];
}

const hexText = (hex: string) =>
  Buffer.from(hex.length % 2 ? `${hex}0` : hex, 'hex').toString('latin1');

/** MCID → その marked content の中に描かれた文字（位置つき） */
function marked(doc: PDFDocument): Map<number, Shown[]> {
  const out = new Map<number, Shown[]>();
  for (const page of doc.getPages()) {
    const contents = page.node.lookup(PDFName.of('Contents'));
    const streams =
      contents instanceof PDFArray
        ? contents.asArray().map((r) => doc.context.lookup(r))
        : [contents];
    for (const s of streams) {
      if (!(s instanceof PDFRawStream)) continue;
      const raw = Buffer.from(s.getContents());
      let text: string;
      try {
        text = inflateSync(raw).toString('latin1');
      } catch {
        text = raw.toString('latin1');
      }
      for (const m of text.matchAll(/\/\w+ <<\/MCID (\d+)>> BDC([\s\S]*?)EMC/g)) {
        const shown: Shown[] = [];
        for (const t of m[2].matchAll(/1 0 0 1 ([-\d.]+) ([-\d.]+) Tm\s*<([0-9A-Fa-f]*)> Tj/g)) {
          shown.push({ x: Number(t[1]), y: Number(t[2]), text: hexText(t[3]) });
        }
        out.set(Number(m[1]), shown);
      }
    }
  }
  return out;
}

function tree(doc: PDFDocument): Node {
  const mc = marked(doc);
  const root = doc.catalog.lookup(PDFName.of('StructTreeRoot'), PDFDict);
  const walk = (obj: unknown): Node | null => {
    const d = obj instanceof PDFRef ? doc.context.lookup(obj) : obj;
    if (!(d instanceof PDFDict)) return null;
    const role = (d.get(PDFName.of('S')) as PDFName | undefined)?.decodeText() ?? '';
    const attrs = new Map<string, string>();
    const a = d.lookup(PDFName.of('A'));
    if (a instanceof PDFDict) {
      for (const [k, v] of a.entries()) attrs.set(k.decodeText(), String(v).replace(/^\//, ''));
    }
    const node: Node = { role, attrs, kids: [], shown: [] };
    const k = d.lookup(PDFName.of('K'));
    const items = k instanceof PDFArray ? k.asArray() : k === undefined ? [] : [k];
    for (const item of items) {
      if (item instanceof PDFNumber) node.shown.push(...(mc.get(item.asNumber()) ?? []));
      else {
        const child = walk(item);
        if (child) node.kids.push(child);
      }
    }
    return node;
  };
  return walk(root.get(PDFName.of('K'))) as Node;
}

const all = (n: Node, role: string): Node[] => [
  ...(n.role === role ? [n] : []),
  ...n.kids.flatMap((k) => all(k, role)),
];
const textOf = (n: Node) => n.shown.map((s) => s.text).join('');
/** 外側（入れ子でない）の L だけ */
const topLists = (root: Node): Node[] => {
  const out: Node[] = [];
  const visit = (n: Node, insideList: boolean) => {
    if (n.role === 'L' && !insideList) out.push(n);
    for (const k of n.kids) visit(k, insideList || n.role === 'L');
  };
  visit(root, false);
  return out;
};

async function render(markdown: string, pdfVersion?: '2.0'): Promise<Node> {
  const res = await handleCreateMarkdownPdf({
    markdown,
    title: 'Lists',
    lang: 'en',
    tagged: true,
    ...(pdfVersion ? { pdfVersion } : {}),
  });
  return tree(await PDFDocument.load(Buffer.from(res.base64 as string, 'base64')));
}

describe('SPEC-WRITER-CREATE-MARKDOWN-PDF-001 リストの記号を Lbl、本文を LBody で描く', () => {
  it('SPEC-WRITER-CREATE-MARKDOWN-PDF-001 箇条書きの記号は Lbl に入る', async () => {
    const [list] = topLists(await render('- Alpha\n- Bravo\n'));
    const items = list.kids.filter((k) => k.role === 'LI');
    expect(items).toHaveLength(2);
    for (const li of items) expect(li.kids.map((k) => k.role)).toEqual(['Lbl', 'LBody']);
    expect(items.map((li) => textOf(li.kids[1]))).toEqual(['Alpha', 'Bravo']);
    expect(textOf(items[0].kids[0]).trim()).not.toBe('');
  });

  it('SPEC-WRITER-CREATE-MARKDOWN-PDF-001 番号は Lbl に入る', async () => {
    const [list] = topLists(await render('1. One\n2. Two\n'));
    const items = list.kids.filter((k) => k.role === 'LI');
    expect(items.map((li) => textOf(li.kids[0]).trim())).toEqual(['1.', '2.']);
    expect(items.map((li) => textOf(li.kids[1]))).toEqual(['One', 'Two']);
  });
});

describe('SPEC-WRITER-CREATE-MARKDOWN-PDF-002 L に ListNumbering を書く', () => {
  it('SPEC-WRITER-CREATE-MARKDOWN-PDF-002 番号付きリストは Decimal', async () => {
    const [list] = topLists(await render('1. One\n2. Two\n'));
    expect(list.attrs.get('O')).toBe('List');
    expect(list.attrs.get('ListNumbering')).toBe('Decimal');
  });

  it('SPEC-WRITER-CREATE-MARKDOWN-PDF-002 箇条書きは Disc', async () => {
    const [list] = topLists(await render('- Alpha\n- Bravo\n'));
    expect(list.attrs.get('O')).toBe('List');
    expect(list.attrs.get('ListNumbering')).toBe('Disc');
  });
});

describe('SPEC-WRITER-CREATE-MARKDOWN-PDF-003 入れ子のリストは親の項目の LBody の中に置く', () => {
  it('SPEC-WRITER-CREATE-MARKDOWN-PDF-003 箇条書きの中の箇条書き', async () => {
    const root = await render('- Alpha\n  - Beta\n  - Gamma\n- Delta\n');
    const [outer] = topLists(root);
    const items = outer.kids.filter((k) => k.role === 'LI');
    expect(items).toHaveLength(2);
    const alphaBody = items[0].kids.find((k) => k.role === 'LBody') as Node;
    expect(textOf(alphaBody)).toBe('Alpha');
    const inner = alphaBody.kids.find((k) => k.role === 'L');
    expect(inner).toBeDefined();
    const innerItems = (inner as Node).kids.filter((k) => k.role === 'LI');
    expect(innerItems.map((li) => textOf(li.kids.find((k) => k.role === 'LBody') as Node))).toEqual(
      ['Beta', 'Gamma'],
    );
    expect(textOf(items[1].kids.find((k) => k.role === 'LBody') as Node)).toBe('Delta');
    for (const body of all(root, 'LBody')) expect(textOf(body)).not.toMatch(/- /);
  });
});

describe('SPEC-WRITER-CREATE-MARKDOWN-PDF-004 本文は記号の幅だけ右から始め、折り返しもそろえる', () => {
  it('SPEC-WRITER-CREATE-MARKDOWN-PDF-004 折り返した本文の始まりがそろう', async () => {
    const long = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ');
    const [list] = topLists(await render(`- ${long}\n`));
    const [li] = list.kids;
    const label = li.kids.find((k) => k.role === 'Lbl') as Node;
    const body = li.kids.find((k) => k.role === 'LBody') as Node;
    expect(body.shown.length).toBeGreaterThanOrEqual(2);
    expect(body.shown[1].x).toBe(body.shown[0].x);
    expect(body.shown[0].x).toBeGreaterThan(label.shown[0].x);
  });

  it('SPEC-WRITER-CREATE-MARKDOWN-PDF-004 入れ子は 1 段右', async () => {
    const root = await render('- Alpha\n  - Beta\n');
    const labels = all(root, 'Lbl');
    expect(labels).toHaveLength(2);
    expect(labels[1].shown[0].x).toBeGreaterThan(labels[0].shown[0].x);
  });
});

describe('SPEC-WRITER-CREATE-MARKDOWN-PDF-005 PDF/UA-2 では入れ子のリストを親の L の直接の子に置く', () => {
  const md = '- Alpha\n  - Beta\n  - Gamma\n- Delta\n';

  it('SPEC-WRITER-CREATE-MARKDOWN-PDF-005 PDF/UA-2 の箇条書きの中の箇条書き', async () => {
    const [list] = topLists(await render(md, '2.0'));
    expect(list.kids.map((k) => k.role)).toEqual(['LI', 'L', 'LI']);
    const [alpha, nested, delta] = list.kids;
    expect(textOf(alpha.kids[1])).toBe('Alpha');
    expect(alpha.kids[1].kids.filter((k) => k.role === 'L')).toHaveLength(0);
    expect(nested.kids.map((li) => textOf(li.kids[1]))).toEqual(['Beta', 'Gamma']);
    expect(textOf(delta.kids[1])).toBe('Delta');
  });

  it('SPEC-WRITER-CREATE-MARKDOWN-PDF-005 描く位置は PDF/UA-1 と同じ', async () => {
    const xOfBeta = (root: Node) =>
      all(root, 'LBody').find((b) => textOf(b) === 'Beta')?.shown[0]?.x;
    const ua1 = xOfBeta(await render(md));
    const ua2 = xOfBeta(await render(md, '2.0'));
    expect(ua1).toBeDefined();
    expect(ua2).toBe(ua1);
  });
});
