/**
 * B-10a: ページ複製系が文書レベルオブジェクトを黙って捨てないことの回帰テスト
 *
 * SPEC-AUDIT Phase 1.5 で「merge / split / extract / delete / reorder が
 * StructTreeRoot / MarkInfo / XMP / 添付を黙って破棄する」ことを実測した。
 * 引き継ぎ（B-10b/c）の前に、まず**明示する**ことをここで固定する。
 *
 * 判定は「出力を実測して、入力にあったものが無ければ報告」なので、
 * B-10b で引き継ぎを実装したら該当の警告は自然に消える（＝ここのテストは
 * 「引き継いだのに警告する」退行も同時に防いでいる）。
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import {
  type PDFArray,
  type PDFDict,
  PDFDocument,
  type PDFHexString,
  PDFName,
  type PDFRawStream,
  PDFString,
} from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { surveyDocLevel, usesOptionalContent } from '../src/services/doc-level.js';
import { addBookmarks, attachFileToPdf, ensureTagged } from '../src/services/editor.js';
import {
  deletePages,
  extractPages,
  mergePdfs,
  reorderPages,
  rotatePages,
  splitPdf,
} from '../src/services/page-ops.js';

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pwm-doclevel-'));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** 何も文書レベル要素を持たない素の PDF */
async function makePlainPdf(path: string, pages = 2): Promise<string> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([400, 300]);
  await writeFile(path, await doc.save());
  return path;
}

/** タグ付き（StructTreeRoot + MarkInfo + XMP + Lang + ViewerPreferences）な PDF */
async function makeTaggedPdf(name: string): Promise<string> {
  const plain = await makePlainPdf(join(dir, `${name}-src.pdf`));
  const out = join(dir, `${name}.pdf`);
  await ensureTagged({ inputPath: plain, outputPath: out, title: 'Tagged', lang: 'ja' });
  return out;
}

/** 添付（/Names /EmbeddedFiles + /AF）を持つ PDF */
async function makeAttachedPdf(name: string): Promise<string> {
  const plain = await makePlainPdf(join(dir, `${name}-src.pdf`));
  const payload = join(dir, `${name}-payload.csv`);
  await writeFile(payload, 'date,amount\n2026-07-18,1000\n');
  const out = join(dir, `${name}.pdf`);
  await attachFileToPdf({
    inputPath: plain,
    attachmentPath: payload,
    outputPath: out,
    relationship: 'Data',
  });
  return out;
}

const joined = (warnings: string[] | undefined): string => (warnings ?? []).join('\n');

async function loadPdf(path: string): Promise<PDFDocument> {
  return PDFDocument.load(await readFile(path), { updateMetadata: false });
}

describe('surveyDocLevel: 文書レベル要素の採取', () => {
  it('素の PDF は何も持たない', async () => {
    const doc = await loadPdf(await makePlainPdf(join(dir, 'bare.pdf')));
    expect(surveyDocLevel(doc).size).toBe(0);
  });

  it('タグ付き PDF は tagged / metadata / lang / viewerPreferences を持つ', async () => {
    const doc = await loadPdf(await makeTaggedPdf('survey-tagged'));
    const survey = surveyDocLevel(doc);
    expect([...survey].sort()).toEqual(['lang', 'metadata', 'tagged', 'viewerPreferences']);
  });

  it('添付付き PDF は embeddedFiles / af を持つ', async () => {
    const doc = await loadPdf(await makeAttachedPdf('survey-attach'));
    const survey = surveyDocLevel(doc);
    expect(survey.has('embeddedFiles')).toBe(true);
    expect(survey.has('af')).toBe(true);
  });
});

describe('B-10a: ページ複製で失われたものを warnings で報告する', () => {
  it('extract_pages: タグ付き入力の構造木・XMP の消失を報告する', async () => {
    const input = await makeTaggedPdf('extract-tagged');
    const result = await extractPages(input, '1', { returnBase64: true });
    const text = joined(result.warnings);

    expect(text).toMatch(/extract_pages did not carry over the tagged structure/);
    expect(text).toMatch(/§14\.7\.2/);
    expect(text).toMatch(/no longer PDF\/UA-1 conforming|PDF\/UA-1 conformance/);
    expect(text).toMatch(/XMP metadata/);
    // 出力が実際にタグ無しであることも確かめる（警告が事実に基づくこと）。
    // B-10b 以降、Lang / ViewerPreferences は引き継がれるので「catalog が空」ではない
    const out = await PDFDocument.load(Buffer.from(result.base64 as string, 'base64'), {
      updateMetadata: false,
    });
    const survey = surveyDocLevel(out);
    expect(survey.has('tagged')).toBe(false);
    expect(survey.has('metadata')).toBe(false);
  });

  it('delete_pages / reorder_pages も同じく報告する', async () => {
    const input = await makeTaggedPdf('mutate-tagged');
    const del = await deletePages(input, '2', { returnBase64: true });
    expect(joined(del.warnings)).toMatch(/delete_pages did not carry over the tagged structure/);

    const re = await reorderPages(input, [2, 1], { returnBase64: true });
    expect(joined(re.warnings)).toMatch(/reorder_pages did not carry over the tagged structure/);
  });

  it('merge_pdfs: 全入力の損失を合流して報告する', async () => {
    const tagged = await makeTaggedPdf('merge-tagged');
    const attached = await makeAttachedPdf('merge-attach');
    const result = await mergePdfs([tagged, attached], { returnBase64: true });
    const text = joined(result.warnings);

    // 1 件目のタグ付き構造は失われる
    expect(text).toMatch(/merge_pdfs did not carry over the tagged structure/);
    // 2 件目の添付は引き継がれるので、もう「消えた」とは言わない
    expect(text).not.toMatch(/did not carry over the file attachments/);
    const out = await PDFDocument.load(Buffer.from(result.base64 as string, 'base64'), {
      updateMetadata: false,
    });
    expect(surveyDocLevel(out).has('embeddedFiles')).toBe(true);
  });

  /**
   * **先勝ちの穴**。`docLevelLossWarnings` は「その機能が出力にあるか」しか見ないので、
   * 入力 1 の添付が運ばれていれば `embeddedFiles` は「有り」になり、入力 2 の添付が
   * 消えても黙ってしまう（機能単位であってファイル単位ではない）。
   * `carryDocumentLevel` の `skipped` を報告することで塞ぐ。
   */
  it('merge_pdfs: 2 件目以降の添付を採らなかったことを黙らせない', async () => {
    const a = await makeAttachedPdf('merge-skip-a');
    const b = await makeAttachedPdf('merge-skip-b');
    const result = await mergePdfs([a, b], { returnBase64: true });
    const text = joined(result.warnings);

    expect(text).toMatch(/kept the .* of the first input and did not merge/);
    expect(text).toMatch(/merge-skip-b/); // どのファイルが採られなかったか名指しする
    expect(text).toMatch(/embedded data is gone/);
    expect(text).toMatch(/attach_file/); // 復旧手段を案内する
  });

  it('split_pdf: 結果全体に 1 度だけ載せる', async () => {
    const input = await makeTaggedPdf('split-tagged');
    const result = await splitPdf(input, ['1', '2'], dir, 'split-tagged-part', {});
    expect(result.count).toBe(2);
    const text = joined(result.warnings);
    expect(text).toMatch(/split_pdf did not carry over the tagged structure/);
    // パートごとに重複しない（全パートが同じ入力から出るので損失も共通）
    expect(text.match(/split_pdf did not carry over the tagged structure/g)).toHaveLength(1);
  });

  it('bookmarks（/Outlines）の消失も報告する', async () => {
    const plain = await makePlainPdf(join(dir, 'outline-src.pdf'));
    const withOutline = join(dir, 'outline.pdf');
    await addBookmarks({
      inputPath: plain,
      outputPath: withOutline,
      bookmarks: [{ title: 'Chapter 1', page: 1 }],
    });

    const result = await extractPages(withOutline, '1', { returnBase64: true });
    const text = joined(result.warnings);
    expect(text).toMatch(/bookmarks \(\/Outlines\)/);
    expect(text).toMatch(/add_bookmarks/); // 復旧手段を案内する
  });

  it('Table 29 の細かなエントリはまとめて名前だけ報告する', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([400, 300]);
    doc.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'));
    doc.catalog.set(PDFName.of('PageLayout'), PDFName.of('OneColumn'));
    const path = join(dir, 'minor.pdf');
    await writeFile(path, await doc.save());

    const result = await extractPages(path, '1', { returnBase64: true });
    const text = joined(result.warnings);
    expect(text).toMatch(/also dropped these document-level catalog entries/);
    expect(text).toMatch(/\/PageMode/);
    expect(text).toMatch(/\/PageLayout/);
  });
});

/**
 * B-10b: 引き継ぎ。
 *
 * **「引き継げるもの」ではなく「引き継いで嘘にならないもの」を運ぶ**のがこの実装の要。
 * MarkInfo（= タグ付き宣言）と準拠宣言つき XMP は、構造木を運べない今の段階で運ぶと
 * 「タグ付き / PDF/UA 準拠を名乗るが実体が無い」文書になるため意図的に運ばない。
 */
describe('B-10b: 嘘にならない文書レベル要素を引き継ぐ', () => {
  it('添付（/Names /EmbeddedFiles + /AF）が中身ごと生き残る — 電帳法データの消失を防ぐ', async () => {
    const input = await makeAttachedPdf('carry-attach');
    const result = await extractPages(input, '1', { returnBase64: true });

    const out = await PDFDocument.load(Buffer.from(result.base64 as string, 'base64'), {
      updateMetadata: false,
    });
    const survey = surveyDocLevel(out);
    expect(survey.has('embeddedFiles'), 'attachments must survive').toBe(true);
    expect(survey.has('af'), '/AF must survive').toBe(true);

    // 中身まで生きていること（参照だけ運んで実体が欠ける事故を防ぐ）
    const names = out.catalog.lookup(PDFName.of('Names')) as PDFDict;
    const ef = names.lookup(PDFName.of('EmbeddedFiles')) as PDFDict;
    const arr = ef.lookup(PDFName.of('Names')) as PDFArray;
    expect((arr.lookup(0) as PDFHexString).decodeText()).toBe('carry-attach-payload.csv');
    const spec = arr.lookup(1) as PDFDict;
    expect(spec.lookup(PDFName.of('AFRelationship'))?.toString()).toBe('/Data');
    const efDict = spec.lookup(PDFName.of('EF')) as PDFDict;
    const stream = out.context.lookup(efDict.get(PDFName.of('F'))) as PDFRawStream;
    let bytes = Buffer.from(stream.getContents());
    try {
      bytes = inflateSync(bytes);
    } catch {
      /* 非圧縮ならそのまま */
    }
    expect(bytes.toString()).toBe('date,amount\n2026-07-18,1000\n');

    // 引き継いだので、もう添付の消失は報告されない
    expect(joined(result.warnings)).not.toMatch(/did not carry over the file attachments/);
  });

  it('merge_pdfs でも添付が生き残る（先勝ち）', async () => {
    const attached = await makeAttachedPdf('carry-merge-attach');
    const plain = await makePlainPdf(join(dir, 'carry-merge-plain.pdf'));
    const result = await mergePdfs([attached, plain], { returnBase64: true });

    const out = await PDFDocument.load(Buffer.from(result.base64 as string, 'base64'), {
      updateMetadata: false,
    });
    expect(surveyDocLevel(out).has('embeddedFiles')).toBe(true);
    expect(out.getPageCount()).toBe(4);
  });

  it('/Lang と /ViewerPreferences も引き継ぐ', async () => {
    const input = await makeTaggedPdf('carry-lang');
    const result = await extractPages(input, '1', { returnBase64: true });

    const out = await PDFDocument.load(Buffer.from(result.base64 as string, 'base64'), {
      updateMetadata: false,
    });
    const survey = surveyDocLevel(out);
    expect(survey.has('lang')).toBe(true);
    expect(survey.has('viewerPreferences')).toBe(true);
  });

  it('MarkInfo は引き継がない — 構造木が無いのに「タグ付きだ」と名乗らせないため', async () => {
    const input = await makeTaggedPdf('carry-no-lie');
    const result = await extractPages(input, '1', { returnBase64: true });

    const out = await PDFDocument.load(Buffer.from(result.base64 as string, 'base64'), {
      updateMetadata: false,
    });
    // tagged = StructTreeRoot か MarkInfo のどちらかがあれば true。両方無いことを要求する
    expect(surveyDocLevel(out).has('tagged'), 'must not claim to be tagged without a tree').toBe(
      false,
    );
    expect(out.catalog.get(PDFName.of('MarkInfo'))).toBeUndefined();
    expect(out.catalog.get(PDFName.of('StructTreeRoot'))).toBeUndefined();
    // 失われたことは引き続き報告する
    expect(joined(result.warnings)).toMatch(/did not carry over the tagged structure/);
  });

  it('準拠宣言つき XMP は運ばず、理由を説明する（偽の準拠主張は消失より有害）', async () => {
    const input = await makeTaggedPdf('carry-xmp-claim'); // pdfuaid:part を含む XMP
    const result = await extractPages(input, '1', { returnBase64: true });

    const out = await PDFDocument.load(Buffer.from(result.base64 as string, 'base64'), {
      updateMetadata: false,
    });
    expect(surveyDocLevel(out).has('metadata'), 'XMP claiming PDF/UA must not be copied').toBe(
      false,
    );
    const text = joined(result.warnings);
    expect(text).toMatch(/declares conformance/);
    expect(text).toMatch(/worse than losing the claim/);
  });

  it('準拠宣言の無い XMP は引き継ぐ', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([400, 300]);
    const xmp = doc.context.stream(
      '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>' +
        '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF ' +
        'xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
        '<rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/">' +
        '<dc:title><rdf:Alt><rdf:li xml:lang="x-default">Plain</rdf:li></rdf:Alt></dc:title>' +
        '</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>',
      { Type: 'Metadata', Subtype: 'XML' },
    );
    doc.catalog.set(PDFName.of('Metadata'), doc.context.register(xmp));
    const path = join(dir, 'carry-xmp-plain.pdf');
    await writeFile(path, await doc.save());

    const result = await extractPages(path, '1', { returnBase64: true });
    const out = await PDFDocument.load(Buffer.from(result.base64 as string, 'base64'), {
      updateMetadata: false,
    });
    expect(surveyDocLevel(out).has('metadata')).toBe(true);
    expect(joined(result.warnings)).not.toMatch(/XMP metadata/);
  });
});

describe('B-10a: 黙らせるべきときは黙る', () => {
  it('素の PDF では警告を出さない', async () => {
    const input = await makePlainPdf(join(dir, 'quiet.pdf'));
    const result = await extractPages(input, '1', { returnBase64: true });
    expect(result.warnings).toBeUndefined();
  });

  it('rotate_pages は in-place なので catalog を保ち、警告も出ない', async () => {
    const input = await makeTaggedPdf('rotate-tagged');
    const result = await rotatePages(input, 90, undefined, { returnBase64: true });
    expect(result.warnings).toBeUndefined();

    const out = await PDFDocument.load(Buffer.from(result.base64 as string, 'base64'), {
      updateMetadata: false,
    });
    // 実測: 回転しても構造木・XMP は残っている（SPEC-AUDIT Phase 1.5 の表と一致）
    expect(surveyDocLevel(out).has('tagged')).toBe(true);
    expect(surveyDocLevel(out).has('metadata')).toBe(true);
  });
});

describe('§8.11.4.2: /OCProperties の消失は「損失」ではなく「違反」になりうる', () => {
  /** 1 ページ目に OCG を参照する /Properties を持たせた文書 */
  async function makeOptionalContentPdf(path: string): Promise<string> {
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 300]);
    const { context } = doc;

    const ocg = context.obj({ Type: 'OCG', Name: PDFString.of('Layer 1') });
    const ocgRef = context.register(ocg);

    const resources = page.node.lookup(PDFName.of('Resources')) as PDFDict;
    const props = context.obj({}) as PDFDict;
    props.set(PDFName.of('MC0'), ocgRef);
    resources.set(PDFName.of('Properties'), props);

    const ocgs = context.obj([]) as PDFArray;
    ocgs.push(ocgRef);
    doc.catalog.set(
      PDFName.of('OCProperties'),
      context.obj({ OCGs: ocgs, D: context.obj({ Order: context.obj([]) }) }),
    );

    await writeFile(path, await doc.save());
    return path;
  }

  it('OC を使うページを複製すると shall 違反として報告する', async () => {
    const input = await makeOptionalContentPdf(join(dir, 'oc.pdf'));
    const result = await extractPages(input, '1', { returnBase64: true });
    const text = joined(result.warnings);

    expect(text).toMatch(/optional content configuration/);
    expect(text).toMatch(/§8\.11\.4\.2/);
    expect(text).toMatch(/The copied pages DO use optional content, so this output violates/);
  });

  it('usesOptionalContent: OC を使わない文書では false', async () => {
    const doc = await loadPdf(await makePlainPdf(join(dir, 'no-oc.pdf')));
    expect(usesOptionalContent(doc)).toBe(false);
  });
});
