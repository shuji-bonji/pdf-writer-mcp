/**
 * PDF/UA-2 の出力（openspec/changes/pdfua2-output・ensure-pdfua2。#26）
 *
 * 0.26.x までは `tagged: true` と `pdfVersion: "2.0"` の組み合わせを INVALID_ARGUMENT で断り、
 * `ensure_tagged` は PDF 2.0 の入力を断っていた。適合の判定は veraPDF（pdf-verify-mcp）の仕事で、
 * ここでは書いたものを pdf-lib（独立した読み手）で読み戻して、宣言・名前空間・構造の形を確かめる。
 * 検体は ASCII の本文なので TEST_FONT_PATH が無くても走る（標準フォントの警告は出る）。
 */

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFString,
} from 'pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  handleAddBookmarks,
  handleCreateMarkdownPdf,
  handleCreateTextPdf,
  handleEnsurePdfa,
  handleEnsureTagged,
  handleSetMetadata,
} from '../src/tools/handlers.js';

const PDF20_NS = 'http://iso.org/pdf2/ssn';

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'writer-pdfua2-'));
});

const headerOf = (bytes: Uint8Array) => Buffer.from(bytes.subarray(0, 8)).toString('latin1');

async function load(path: string): Promise<{ doc: PDFDocument; bytes: Uint8Array }> {
  const bytes = new Uint8Array(readFileSync(path));
  return { doc: await PDFDocument.load(bytes, { updateMetadata: false }), bytes };
}

function xmpOf(doc: PDFDocument): string {
  const meta = doc.catalog.lookup(PDFName.of('Metadata'));
  if (!(meta instanceof PDFRawStream)) return '';
  const bytes = meta.dict.has(PDFName.of('Filter'))
    ? decodePDFRawStream(meta).decode()
    : meta.contents;
  return new TextDecoder().decode(bytes);
}

interface Elem {
  role: string;
  /** `/NS` が指す名前空間辞書の `/NS` の文字列。`/NS` が無ければ undefined */
  ns: string | undefined;
  kids: Elem[];
}

function nsName(doc: PDFDocument, d: PDFDict): string | undefined {
  const raw = d.get(PDFName.of('NS'));
  if (raw === undefined) return undefined;
  const nsDict = raw instanceof PDFRef ? doc.context.lookup(raw) : raw;
  if (!(nsDict instanceof PDFDict)) return 'not-a-dict';
  const s = nsDict.get(PDFName.of('NS'));
  return s instanceof PDFString ? s.decodeText() : String(s);
}

function structTree(doc: PDFDocument): { root: PDFDict; top: Elem[] } {
  const root = doc.catalog.lookup(PDFName.of('StructTreeRoot'), PDFDict);
  const walk = (obj: unknown): Elem | null => {
    const d = obj instanceof PDFRef ? doc.context.lookup(obj) : obj;
    if (!(d instanceof PDFDict)) return null;
    const role = (d.get(PDFName.of('S')) as PDFName | undefined)?.decodeText() ?? '';
    const k = d.lookup(PDFName.of('K'));
    const items = k instanceof PDFArray ? k.asArray() : k === undefined ? [] : [k];
    const kids = items.map(walk).filter((e): e is Elem => e !== null);
    return { role, ns: nsName(doc, d), kids };
  };
  const k = root.lookup(PDFName.of('K'));
  const items = k instanceof PDFArray ? k.asArray() : [k];
  return { root, top: items.map(walk).filter((e): e is Elem => e !== null) };
}

const flat = (e: Elem): Elem[] => [e, ...e.kids.flatMap(flat)];

const BASE = { title: 'Report', lang: 'en' } as const;

async function createUa2Text(name: string): Promise<string> {
  const outputPath = join(dir, name);
  await handleCreateTextPdf({
    ...BASE,
    text: 'body text',
    tagged: true,
    pdfVersion: '2.0',
    outputPath,
  });
  return outputPath;
}

describe('SPEC-WRITER-PDFUA2-001 タグ付きの PDF 2.0 は PDF/UA-2 を宣言する', () => {
  it('SPEC-WRITER-PDFUA2-001 tagged と pdfVersion 2.0 で PDF/UA-2 の宣言を書く', async () => {
    const { doc, bytes } = await load(await createUa2Text('ua2.pdf'));
    expect(headerOf(bytes)).toBe('%PDF-2.0');
    const xmp = xmpOf(doc);
    expect(xmp).toMatch(/<pdfuaid:part>2<\/pdfuaid:part>/);
    expect(xmp).toMatch(/<pdfuaid:rev>2024<\/pdfuaid:rev>/);
    expect(xmp).toMatch(/<pdfaProperty:name>rev<\/pdfaProperty:name>/);
  });

  it('SPEC-WRITER-PDFUA2-001 既定の版では PDF/UA-1 のまま', async () => {
    const outputPath = join(dir, 'ua1.pdf');
    await handleCreateTextPdf({ ...BASE, text: 'body text', tagged: true, outputPath });
    const { doc, bytes } = await load(outputPath);
    expect(headerOf(bytes)).toBe('%PDF-1.7');
    const xmp = xmpOf(doc);
    expect(xmp).toMatch(/<pdfuaid:part>1<\/pdfuaid:part>/);
    expect(xmp).not.toMatch(/pdfuaid:rev/);
  });
});

describe('SPEC-WRITER-PDFUA2-002 PDF/UA-2 の構造要素は PDF 2.0 の名前空間に置く', () => {
  const markdown = '# Head\n\nPara.\n\n> Quote\n\n```\ncode\n```\n';

  it('SPEC-WRITER-PDFUA2-002 Document と見出しは PDF 2.0 の名前空間、BlockQuote と Code は既定のまま', async () => {
    const outputPath = join(dir, 'ns.pdf');
    await handleCreateMarkdownPdf({
      ...BASE,
      markdown,
      tagged: true,
      pdfVersion: '2.0',
      outputPath,
    });
    const { doc } = await load(outputPath);
    const { root, top } = structTree(doc);
    const namespaces = root.lookup(PDFName.of('Namespaces'), PDFArray);
    expect(namespaces.size()).toBe(1);
    const nsDict = namespaces.lookup(0, PDFDict);
    expect((nsDict.get(PDFName.of('NS')) as PDFString).decodeText()).toBe(PDF20_NS);

    const elems = top.flatMap(flat);
    const byRole = (role: string) => elems.filter((e) => e.role === role);
    for (const role of ['Document', 'H1', 'P']) {
      expect(byRole(role).length).toBeGreaterThan(0);
      for (const e of byRole(role)) expect(e.ns).toBe(PDF20_NS);
    }
    for (const role of ['BlockQuote', 'Code']) {
      expect(byRole(role)).toHaveLength(1);
      expect(byRole(role)[0].ns).toBeUndefined();
    }
  });

  it('SPEC-WRITER-PDFUA2-002 PDF/UA-1 では名前空間を書かない', async () => {
    const outputPath = join(dir, 'ns-ua1.pdf');
    await handleCreateMarkdownPdf({ ...BASE, markdown, tagged: true, outputPath });
    const { doc } = await load(outputPath);
    const { root, top } = structTree(doc);
    expect(root.has(PDFName.of('Namespaces'))).toBe(false);
    for (const e of top.flatMap(flat)) expect(e.ns).toBeUndefined();
  });
});

describe('SPEC-WRITER-PDFUA2-003 PDF/UA-2 では描く題名を Title にする', () => {
  it('SPEC-WRITER-PDFUA2-003 題名は Title になる', async () => {
    const { doc } = await load(await createUa2Text('title.pdf'));
    const { top } = structTree(doc);
    expect(top.map((e) => e.role)).toEqual(['Document']);
    expect(top[0].kids[0].role).toBe('Title');
    expect(top.flatMap(flat).filter((e) => e.role === 'H1')).toHaveLength(0);
  });
});

describe('SPEC-WRITER-PDFUA2-004 PDF/UA-2 では見出しの段を Markdown のまま使う', () => {
  it('SPEC-WRITER-PDFUA2-004 飛んだ見出しを飛んだまま書く', async () => {
    const outputPath = join(dir, 'headings.pdf');
    await handleCreateMarkdownPdf({
      ...BASE,
      markdown: '# A\n\n### B\n',
      tagged: true,
      pdfVersion: '2.0',
      outputPath,
    });
    const { doc } = await load(outputPath);
    const headings = structTree(doc)
      .top.flatMap(flat)
      .map((e) => e.role)
      .filter((r) => /^H\d$/.test(r));
    expect(headings).toEqual(['H1', 'H3']);
  });
});

describe('SPEC-WRITER-PDFUA2-005 編集で XMP を作り直しても PDF/UA-2 の宣言と dc:title を残す', () => {
  it('SPEC-WRITER-PDFUA2-005 set_metadata で author だけを変える', async () => {
    const input = await createUa2Text('meta-in.pdf');
    const outputPath = join(dir, 'meta-out.pdf');
    await handleSetMetadata({ inputPath: input, author: 'someone', outputPath });
    const xmp = xmpOf((await load(outputPath)).doc);
    expect(xmp).toMatch(/<pdfuaid:part>2<\/pdfuaid:part>/);
    expect(xmp).toMatch(/<pdfuaid:rev>2024<\/pdfuaid:rev>/);
    expect(xmp).toMatch(/<dc:title>[\s\S]*Report[\s\S]*<\/dc:title>/);
  });

  it('SPEC-WRITER-PDFUA2-005 数値文字参照で書かれた題名を二重に符号化しない', async () => {
    // 他のツールが書いた XMP を模して、dc:title を数値文字参照に書き換える
    const base = await createUa2Text('meta-ncr-base.pdf');
    const doc = await PDFDocument.load(readFileSync(base), { updateMetadata: false });
    const xmp = xmpOf(doc).replace('>Report<', '>A &#x2014; B<');
    expect(xmp).toContain('A &#x2014; B');
    const replaced = doc.context.stream(new TextEncoder().encode(xmp), {
      Type: 'Metadata',
      Subtype: 'XML',
    });
    doc.catalog.set(PDFName.of('Metadata'), doc.context.register(replaced));
    const input = join(dir, 'meta-ncr.pdf');
    writeFileSync(input, await doc.save({ useObjectStreams: false }));

    const outputPath = join(dir, 'meta-ncr-out.pdf');
    await handleSetMetadata({ inputPath: input, author: 'someone', outputPath });
    const out = xmpOf((await load(outputPath)).doc);
    expect(out).toMatch(/<dc:title>[\s\S]*A \u2014 B[\s\S]*<\/dc:title>/);
    expect(out).not.toContain('&amp;#x2014;');
  });
});

/** 最初のしおりの項目 */
function firstOutlineItem(doc: PDFDocument): PDFDict {
  const outlines = doc.catalog.lookup(PDFName.of('Outlines'), PDFDict);
  return outlines.lookup(PDFName.of('First'), PDFDict);
}

/** 題名がこれのしおりの項目 */
function outlineItem(doc: PDFDocument, title: string): PDFDict {
  let item: PDFDict | undefined = firstOutlineItem(doc);
  while (item) {
    const t = item.lookup(PDFName.of('Title'));
    if ((t as PDFString).decodeText() === title) return item;
    const next = item.lookup(PDFName.of('Next'));
    item = next instanceof PDFDict ? next : undefined;
  }
  throw new Error(`no bookmark "${title}"`);
}

const pageNumberOf = (doc: PDFDocument, ref: unknown): number =>
  doc.getPages().findIndex((p) => p.ref === ref) + 1;

/** ISO 32000-2 §12.3.2.3 の手順で、構造要素が指すページの参照（writer とは別の実装で辿る） */
function pageOfElement(doc: PDFDocument, element: PDFDict): PDFRef | undefined {
  const own = element.get(PDFName.of('Pg'));
  const k = element.get(PDFName.of('K'));
  const kidsRaw = k instanceof PDFArray ? k.asArray() : k === undefined ? [] : [k];
  for (const raw of kidsRaw) {
    const kid = raw instanceof PDFRef ? doc.context.lookup(raw) : raw;
    if (kid instanceof PDFNumber) {
      if (own instanceof PDFRef) return own;
      continue;
    }
    if (!(kid instanceof PDFDict)) continue;
    const type = (kid.get(PDFName.of('Type')) as PDFName | undefined)?.decodeText();
    if (type === 'MCR' || type === 'OBJR') {
      const pg = kid.get(PDFName.of('Pg')) ?? own;
      if (pg instanceof PDFRef) return pg;
      continue;
    }
    const found = pageOfElement(doc, kid);
    if (found) return found;
  }
  return undefined;
}

describe('SPEC-WRITER-PDFUA2-006 PDF/UA-2 の文書に足すしおりは structure destination で書く', () => {
  it('SPEC-WRITER-PDFUA2-006 PDF/UA-2 の文書にしおりを足す', async () => {
    const input = await createUa2Text('bm-in.pdf');
    const outputPath = join(dir, 'bm-out.pdf');
    const result = await handleAddBookmarks({
      inputPath: input,
      bookmarks: [{ title: 'Top', page: 1 }],
      outputPath,
    });
    expect((result.warnings ?? []).some((w) => w.includes('8.8'))).toBe(false);
    const { doc } = await load(outputPath);
    const item = firstOutlineItem(doc);
    expect(item.has(PDFName.of('Dest'))).toBe(false);
    const action = item.lookup(PDFName.of('A'), PDFDict);
    expect((action.get(PDFName.of('S')) as PDFName).decodeText()).toBe('GoTo');
    const d = action.lookup(PDFName.of('D'), PDFArray);
    expect(pageNumberOf(doc, d.get(0))).toBe(1);
    const sd = action.lookup(PDFName.of('SD'), PDFArray);
    const element = doc.context.lookup(sd.get(0), PDFDict);
    expect((element.get(PDFName.of('Type')) as PDFName).decodeText()).toBe('StructElem');
    expect(pageNumberOf(doc, pageOfElement(doc, element))).toBe(1);
  });

  it('SPEC-WRITER-PDFUA2-006 前のページから続く要素は選ばない', async () => {
    const input = join(dir, 'bm-long.pdf');
    const sentence = 'This sentence fills the page so that the paragraph runs on. ';
    await handleCreateTextPdf({
      ...BASE,
      text: `${sentence.repeat(120)}\n\n${sentence.repeat(20)}`,
      tagged: true,
      pdfVersion: '2.0',
      outputPath: input,
    });
    expect((await load(input)).doc.getPageCount()).toBeGreaterThanOrEqual(2);
    const outputPath = join(dir, 'bm-long-out.pdf');
    await handleAddBookmarks({
      inputPath: input,
      bookmarks: [{ title: 'Second', page: 2 }],
      outputPath,
    });
    const { doc } = await load(outputPath);
    const action = outlineItem(doc, 'Second').lookup(PDFName.of('A'), PDFDict);
    const element = doc.context.lookup(action.lookup(PDFName.of('SD'), PDFArray).get(0), PDFDict);
    expect(pageNumberOf(doc, pageOfElement(doc, element))).toBe(2);
  });

  it('SPEC-WRITER-PDFUA2-006 構造要素の内容が無いページ', async () => {
    const ua2 = await createUa2Text('bm-blank-base.pdf');
    const base = await PDFDocument.load(readFileSync(ua2), { updateMetadata: false });
    base.addPage();
    const input = join(dir, 'bm-blank.pdf');
    writeFileSync(input, await base.save({ useObjectStreams: false }));

    const outputPath = join(dir, 'bm-blank-out.pdf');
    const result = await handleAddBookmarks({
      inputPath: input,
      bookmarks: [
        { title: 'Text', page: 1 },
        { title: 'Blank', page: 2 },
      ],
      outputPath,
    });
    const warning = (result.warnings ?? []).find((w) => w.includes('8.8'));
    expect(warning).toBeDefined();
    expect(warning).toContain('Blank');
    expect(warning).not.toContain('"Text"');
    const { doc } = await load(outputPath);
    const blank = outlineItem(doc, 'Blank');
    expect(pageNumberOf(doc, blank.lookup(PDFName.of('Dest'), PDFArray).get(0))).toBe(2);
    expect(outlineItem(doc, 'Text').has(PDFName.of('A'))).toBe(true);
  });

  it('SPEC-WRITER-PDFUA2-006 PDF/UA-1 の文書は今までどおり', async () => {
    const input = join(dir, 'bm-ua1.pdf');
    await handleCreateTextPdf({ ...BASE, text: 'body text', tagged: true, outputPath: input });
    const outputPath = join(dir, 'bm-ua1-out.pdf');
    const result = await handleAddBookmarks({
      inputPath: input,
      bookmarks: [{ title: 'Top', page: 1 }],
      outputPath,
    });
    expect((result.warnings ?? []).some((w) => w.includes('8.8'))).toBe(false);
    const item = firstOutlineItem((await load(outputPath)).doc);
    expect(item.has(PDFName.of('Dest'))).toBe(true);
    expect(item.has(PDFName.of('A'))).toBe(false);
  });
});

describe('SPEC-WRITER-ENSURE-TAGGED-004 PDF/UA-2 で測ると落ちる既存の構造木を名指す', () => {
  it('SPEC-WRITER-ENSURE-TAGGED-004 名前空間の無い Document を持つ PDF 2.0 の文書', async () => {
    // PDF/UA-1 で作った構造木（/NS が無い）を持つ文書の版を 2.0 にする（catalog の /Version。
    // ISO 32000-2 §7.7.2 Table 29 はヘッダーより後の版を catalog で示すことを許す）
    const ua1 = join(dir, 'tree-ua1.pdf');
    await handleCreateTextPdf({ ...BASE, text: 'body text', tagged: true, outputPath: ua1 });
    const doc = await PDFDocument.load(readFileSync(ua1), { updateMetadata: false });
    doc.catalog.set(PDFName.of('Version'), PDFName.of('2.0'));
    const input = join(dir, 'tree-ua1-v20.pdf');
    writeFileSync(input, await doc.save({ useObjectStreams: false }));

    const result = await handleEnsureTagged({
      inputPath: input,
      ...BASE,
      outputPath: join(dir, 'tree-out.pdf'),
    });
    expect(result.warnings.some((w) => w.includes('8.2.5.2'))).toBe(true);
  });

  it('SPEC-WRITER-ENSURE-TAGGED-004 PDF/UA-2 で作った文書には書かない', async () => {
    const input = await createUa2Text('tree-ua2.pdf');
    const result = await handleEnsureTagged({
      inputPath: input,
      ...BASE,
      outputPath: join(dir, 'tree-ua2-out.pdf'),
    });
    expect(result.warnings.some((w) => w.includes('8.2.5.2'))).toBe(false);
  });
});

describe('SPEC-WRITER-ENSURE-PDFA-001 PDF/UA を宣言した入力に PDF/A-4 を名乗らせない', () => {
  it('SPEC-WRITER-ENSURE-PDFA-001 PDF/UA-2 の入力に pdfa-4', async () => {
    const input = await createUa2Text('pdfa4-in.pdf');
    const outputPath = join(dir, 'pdfa4-out.pdf');
    await handleEnsurePdfa({ inputPath: input, flavour: 'pdfa-4', outputPath });
    const xmp = xmpOf((await load(outputPath)).doc);
    expect(xmp).toMatch(/<pdfaid:part>4<\/pdfaid:part>/);
    expect(xmp).toMatch(/<pdfuaid:part>2<\/pdfuaid:part>/);
    expect(xmp).toMatch(/<pdfuaid:rev>2024<\/pdfuaid:rev>/);
  });
});

describe('SPEC-WRITER-ENSURE-PDFA-003 PDF/UA-2 を宣言した入力に PDF/A-3b を名乗らせない', () => {
  it('SPEC-WRITER-ENSURE-PDFA-003 PDF/UA-2 の入力に pdfa-3b', async () => {
    const input = await createUa2Text('pdfa3b-in.pdf');
    const outputPath = join(dir, 'pdfa3b-out.pdf');
    await expect(
      handleEnsurePdfa({ inputPath: input, flavour: 'pdfa-3b', outputPath }),
    ).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      options: { next_actions: [{ example: { flavour: 'pdfa-4' } }] },
    });
    expect(existsSync(outputPath)).toBe(false);
  });
});
