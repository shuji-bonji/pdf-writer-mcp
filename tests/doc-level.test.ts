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
import { type PDFArray, type PDFDict, PDFDocument, PDFName, PDFString } from 'pdf-lib';
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
    // 出力が実際にタグ無しであることも確かめる（警告が事実に基づくこと）
    const out = await PDFDocument.load(Buffer.from(result.base64 as string, 'base64'), {
      updateMetadata: false,
    });
    expect(surveyDocLevel(out).size).toBe(0);
  });

  it('delete_pages / reorder_pages も同じく報告する', async () => {
    const input = await makeTaggedPdf('mutate-tagged');
    const del = await deletePages(input, '2', { returnBase64: true });
    expect(joined(del.warnings)).toMatch(/delete_pages did not carry over the tagged structure/);

    const re = await reorderPages(input, [2, 1], { returnBase64: true });
    expect(joined(re.warnings)).toMatch(/reorder_pages did not carry over the tagged structure/);
  });

  it('merge_pdfs: 全入力の損失を合流して報告する（2 番目のファイルの添付も見落とさない）', async () => {
    const tagged = await makeTaggedPdf('merge-tagged');
    const attached = await makeAttachedPdf('merge-attach');
    const result = await mergePdfs([tagged, attached], { returnBase64: true });
    const text = joined(result.warnings);

    expect(text).toMatch(/merge_pdfs did not carry over the tagged structure/);
    expect(text).toMatch(/file attachments/);
    expect(text).toMatch(/associated files/);
    // 電帳法データの消失は「実害」として言及する
    expect(text).toMatch(/PDF\/A-3/);
  });

  it('split_pdf: 結果全体に 1 度だけ載せる', async () => {
    const input = await makeAttachedPdf('split-attach');
    const result = await splitPdf(input, ['1', '2'], dir, 'split-attach-part', {});
    expect(result.count).toBe(2);
    const text = joined(result.warnings);
    expect(text).toMatch(/split_pdf did not carry over the file attachments/);
    // 「添付の消失」は 1 回だけ（パートごとに重複しない）
    expect(text.match(/split_pdf did not carry over the file attachments/g)).toHaveLength(1);
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
