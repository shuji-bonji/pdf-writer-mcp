/**
 * タグ付き PDF（PDF/UA-1）のテスト
 *
 * 受け入れ基準そのもの（veraPDF `--flavour ua1` で違反 0）は CI に veraPDF が無いため
 * ここでは検証できない。代わりに、veraPDF が実際に指摘した規則を構造レベルで固定する:
 *   6.2-1   MarkInfo/Marked
 *   7.1-11  StructTreeRoot
 *   7.1-8/9 Metadata（pdfuaid + dc:title、UTF-8）
 *   7.1-10  DisplayDocTitle
 *   7.2(1)  /Lang
 *   7.1-3   コンテンツの BDC / Artifact
 *   7.4.2   見出し階層
 *   7.5-1   TH の /Scope
 *   7.21.8-1 .notdef 参照の禁止
 */

import { inflateSync } from 'node:zlib';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import {
  handleCreateMarkdownPdf,
  handleCreateTablePdf,
  handleCreateTextPdf,
} from '../src/tools/handlers.js';
import type { CreateResult } from '../src/types/index.js';

const fontPath = process.env.TEST_FONT_PATH;

async function load(result: CreateResult): Promise<PDFDocument> {
  return PDFDocument.load(Buffer.from(result.base64 as string, 'base64'), {
    updateMetadata: false,
  });
}

/** catalog の /Metadata を UTF-8 文字列として取り出す */
function readXmp(doc: PDFDocument): string {
  const meta = doc.catalog.lookup(PDFName.of('Metadata'));
  expect(meta, 'no /Metadata in catalog').toBeInstanceOf(PDFRawStream);
  return Buffer.from((meta as PDFRawStream).getContents()).toString('utf8');
}

/** ページのコンテンツストリームを連結して返す */
function pageContent(pdf: Buffer): string {
  const out: string[] = [];
  let idx = pdf.indexOf('stream', 0, 'latin1');
  while (idx !== -1) {
    if (pdf.subarray(idx - 3, idx).toString('latin1') === 'end') {
      idx = pdf.indexOf('stream', idx + 6, 'latin1');
      continue;
    }
    let start = idx + 6;
    if (pdf[start] === 0x0d) start++;
    if (pdf[start] === 0x0a) start++;
    const end = pdf.indexOf('endstream', start, 'latin1');
    if (end === -1) break;
    try {
      const data = inflateSync(pdf.subarray(start, end)).toString('latin1');
      if (data.includes('BDC') || data.includes('Tj')) out.push(data);
    } catch {
      // 非圧縮 or フォント等
    }
    idx = pdf.indexOf('stream', end, 'latin1');
  }
  return out.join('\n');
}

/**
 * 構造木を走査して StructElem を集める。
 * pdf-lib は既定でオブジェクトストリーム（圧縮）を使うため、生バイト列の文字列検索では
 * 構造辞書を見つけられない。必ずパースして辿ること。
 */
function collectStructElems(doc: PDFDocument): PDFDict[] {
  const root = doc.catalog.lookup(PDFName.of('StructTreeRoot'));
  if (!(root instanceof PDFDict)) return [];
  const out: PDFDict[] = [];
  const seen = new Set<PDFDict>();
  const visit = (node: PDFDict): void => {
    if (seen.has(node)) return;
    seen.add(node);
    if (node.lookup(PDFName.of('S')) instanceof PDFName) out.push(node);
    const k = node.lookup(PDFName.of('K'));
    if (k instanceof PDFDict) visit(k);
    else if (k instanceof PDFArray) {
      for (let i = 0; i < k.size(); i++) {
        const kid = k.lookup(i);
        if (kid instanceof PDFDict) visit(kid);
      }
    }
  };
  visit(root);
  return out;
}

const tagOf = (e: PDFDict): string => (e.lookup(PDFName.of('S')) as PDFName).decodeText();

/** 本文の Tj オペランドに CID 0（.notdef）が現れないこと */
function hasNotdefReference(content: string): boolean {
  for (const m of content.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) {
    const hex = m[1];
    for (let i = 0; i + 4 <= hex.length; i += 4) {
      if (Number.parseInt(hex.slice(i, i + 4), 16) === 0) return true;
    }
  }
  return false;
}

describe.skipIf(!fontPath)('tagged PDF (PDF/UA-1)', () => {
  it('sets the catalog entries PDF/UA requires', async () => {
    const result = (await handleCreateTextPdf({
      text: 'タグ付きの本文です。',
      title: 'タグ付き文書',
      tagged: true,
      lang: 'ja',
      fontPath,
      returnBase64: true,
    })) as CreateResult;
    const doc = await load(result);

    // 6.2-1 MarkInfo/Marked
    const markInfo = doc.catalog.lookup(PDFName.of('MarkInfo')) as PDFDict;
    expect(markInfo.lookup(PDFName.of('Marked'))?.toString()).toBe('true');
    // 7.1-11 StructTreeRoot
    expect(doc.catalog.lookup(PDFName.of('StructTreeRoot'))).toBeInstanceOf(PDFDict);
    // 7.2(1) /Lang
    expect(doc.catalog.lookup(PDFName.of('Lang'))?.toString()).toContain('ja');
    // 7.1-10 DisplayDocTitle
    const vp = doc.catalog.lookup(PDFName.of('ViewerPreferences')) as PDFDict;
    expect(vp.lookup(PDFName.of('DisplayDocTitle'))?.toString()).toBe('true');
  });

  it('writes XMP as UTF-8 with the pdfuaid declaration and extension schema', async () => {
    const result = (await handleCreateTextPdf({
      text: '本文',
      title: 'タイトルの日本語',
      tagged: true,
      lang: 'ja',
      fontPath,
      returnBase64: true,
    })) as CreateResult;
    const xmp = readXmp(await load(result));

    // 5 / 5-1: 宣言と拡張スキーマ記述の両方が要る
    expect(xmp).toContain('<pdfuaid:part>1</pdfuaid:part>');
    expect(xmp).toContain('pdfaExtension:schemas');
    // 7.1-9: dc:title。UTF-8 で書かないと日本語が壊れる（context.stream は 1byte/char）
    expect(xmp).toContain('タイトルの日本語');
  });

  it('marks every drawn line as content or artifact (7.1-3)', async () => {
    const result = (await handleCreateMarkdownPdf({
      markdown: '# 見出し\n\n本文です。\n\n---\n',
      title: 'マーク付き検証',
      tagged: true,
      lang: 'ja',
      fontPath,
      returnBase64: true,
    })) as CreateResult;
    const pdf = Buffer.from(result.base64 as string, 'base64');
    const content = pageContent(pdf);

    // 本文は MCID 付き BDC、水平線は Artifact
    expect(content).toMatch(/\/(H1|H2|P) <<\/MCID \d+>> BDC/);
    expect(content).toContain('/Artifact BMC');
    // BDC/BMC と EMC の数が一致する（入れ子が閉じている）
    const opens = (content.match(/\b(BDC|BMC)\b/g) ?? []).length;
    const closes = (content.match(/\bEMC\b/g) ?? []).length;
    expect(opens).toBe(closes);
  });

  it('normalizes heading levels so none are skipped (7.4.2)', async () => {
    // Markdown が H1 -> H3 と飛んでも、構造タグはレベルを飛ばさないようクランプされる。
    // タイトルが H1、`#` が H1、`###` は H2 になる（H3 に飛ばない）。
    const result = (await handleCreateMarkdownPdf({
      markdown: '# 第1章\n\n### 飛んだ見出し\n\n本文。',
      title: '見出し検証',
      tagged: true,
      lang: 'ja',
      fontPath,
      returnBase64: true,
    })) as CreateResult;
    const doc = await load(result);

    const levels = collectStructElems(doc)
      .map(tagOf)
      .filter((t) => /^H[1-6]$/.test(t));
    expect(levels).toEqual(['H1', 'H1', 'H2']);

    // レベルは 1 から始まり、隣接差は 1 以下
    const nums = levels.map((t) => Number(t[1]));
    expect(nums[0]).toBe(1);
    for (let i = 1; i < nums.length; i++) {
      expect(nums[i] - nums[i - 1]).toBeLessThanOrEqual(1);
    }
  });

  it('gives table headers a Scope attribute (7.5-1)', async () => {
    const result = (await handleCreateTablePdf({
      headers: ['項目', '値'],
      rows: [['A', '1']],
      title: '表の検証',
      tagged: true,
      lang: 'ja',
      fontPath,
      returnBase64: true,
    })) as CreateResult;
    const elems = collectStructElems(await load(result));

    const tags = elems.map(tagOf);
    expect(tags).toContain('Table');
    expect(tags).toContain('TR');
    expect(tags).toContain('TH');
    expect(tags).toContain('TD');

    // すべての TH に /A << /O /Table /Scope /Column >> があること
    const ths = elems.filter((e) => tagOf(e) === 'TH');
    expect(ths.length).toBe(2);
    for (const th of ths) {
      const attrs = th.lookup(PDFName.of('A')) as PDFDict;
      expect(attrs, 'TH has no /A attribute dictionary').toBeInstanceOf(PDFDict);
      expect((attrs.lookup(PDFName.of('Scope')) as PDFName).decodeText()).toBe('Column');
      expect((attrs.lookup(PDFName.of('O')) as PDFName).decodeText()).toBe('Table');
    }
  });

  it('never references .notdef — renderer-added glyphs are subset in (7.21.8-1)', async () => {
    // 回帰: Markdown の `- item` は原文に中黒を含まないが、レンダラが '•' を描く。
    // サブセットに含めないと .notdef になり、豆腐で描画される（v0.3.0〜v0.4.0 の不具合）。
    const result = (await handleCreateMarkdownPdf({
      markdown: '- 箇条書きA\n- 箇条書きB',
      title: '箇条書き検証',
      tagged: true,
      lang: 'ja',
      fontPath,
      returnBase64: true,
    })) as CreateResult;
    const pdf = Buffer.from(result.base64 as string, 'base64');
    expect(hasNotdefReference(pageContent(pdf))).toBe(false);
  });

  it('requires a title, since PDF/UA mandates one', async () => {
    await expect(handleCreateTextPdf({ text: '本文', tagged: true, fontPath })).rejects.toThrow(
      /requires "title"/,
    );
  });

  it('infers the language and reports it when lang is omitted', async () => {
    const ja = (await handleCreateTextPdf({
      text: 'かなを含む日本語の本文。',
      title: 'テスト',
      tagged: true,
      fontPath,
      returnBase64: true,
    })) as CreateResult;
    expect(ja.warnings?.join(' ')).toMatch(/Inferred document language as "ja"/);

    // 漢字のみは中国語の可能性があるため断定しない旨を警告する
    const han = (await handleCreateTextPdf({
      text: '漢字文書',
      title: '漢字',
      tagged: true,
      fontPath,
      returnBase64: true,
    })) as CreateResult;
    expect(han.warnings?.join(' ')).toMatch(/could also be Chinese/);
  });

  it('leaves untagged output unchanged by default', async () => {
    const result = (await handleCreateTextPdf({
      text: '本文',
      fontPath,
      returnBase64: true,
    })) as CreateResult;
    const doc = await load(result);
    expect(doc.catalog.lookup(PDFName.of('StructTreeRoot'))).toBeUndefined();
    expect(doc.catalog.lookup(PDFName.of('MarkInfo'))).toBeUndefined();
  });
});
