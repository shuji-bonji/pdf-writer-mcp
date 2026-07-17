/**
 * SPEC-AUDIT Phase 1（ISO 32000-2 条文照合）で発見した違反の回帰テスト
 *
 *   1. Table 166（§12.5.2）: writer は注釈に外観辞書 /AP を含めなければならない（shall）
 *   2. §12.3.3: /Count は「可視な」子孫数（閉じた枝の中身は数えない）。
 *      ルートの /Count は開いた項目が無ければ省略しなければならない
 *   3. §7.9.6: 名前ツリーのキーは辞書順でなければならない
 *   4. E-6 決定論: 注釈 /M と添付の日時は SOURCE_DATE_EPOCH に従う
 *
 * 詳細は docs/SPEC-AUDIT.md を参照。
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addAnnotation, addBookmarks, attachFileToPdf } from '../src/services/editor.js';
import type { AddAnnotationArgs, EditResult } from '../src/types/index.js';

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pwm-audit-'));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function makePlainPdf(path: string): Promise<void> {
  const doc = await PDFDocument.create();
  doc.addPage([400, 300]);
  await writeFile(path, await doc.save());
}

async function load(result: EditResult): Promise<PDFDocument> {
  return PDFDocument.load(Buffer.from(result.base64 as string, 'base64'), {
    updateMetadata: false,
  });
}

function firstAnnot(doc: PDFDocument): PDFDict {
  const annots = doc.getPages()[0].node.lookup(PDFName.of('Annots'));
  expect(annots).toBeInstanceOf(PDFArray);
  const a = (annots as PDFArray).lookup(0);
  expect(a).toBeInstanceOf(PDFDict);
  return a as PDFDict;
}

describe('Table 166: 注釈は /AP（通常外観）を持つ', () => {
  it.each(['text', 'highlight', 'square'] as const)('%s に /AP /N が付く', async (type) => {
    const input = join(dir, `ap-${type}.pdf`);
    await makePlainPdf(input);

    const args: AddAnnotationArgs = {
      inputPath: input,
      page: 1,
      type,
      rect: { x1: 20, y1: 20, x2: 120, y2: 60 },
      contents: 'audit',
    };
    if (type === 'square') args.interiorColor = '#ffeeee';
    const doc = await load((await addAnnotation(args)) as EditResult);

    const ap = firstAnnot(doc).lookup(PDFName.of('AP'));
    expect(ap, `${type} must carry /AP`).toBeInstanceOf(PDFDict);
    const n = (ap as PDFDict).lookup(PDFName.of('N'));
    // /N は Form XObject（stream）。辞書に BBox を持つ
    const streamDict = (n as { dict?: PDFDict }).dict;
    expect(streamDict).toBeInstanceOf(PDFDict);
    expect(streamDict?.lookup(PDFName.of('Subtype'))?.toString()).toBe('/Form');
    const bbox = streamDict?.lookup(PDFName.of('BBox'));
    expect(bbox).toBeInstanceOf(PDFArray);
    expect((bbox as PDFArray).lookup(2, PDFNumber).asNumber()).toBe(100); // w
    expect((bbox as PDFArray).lookup(3, PDFNumber).asNumber()).toBe(40); // h
  });
});

describe('§12.3.3: /Count は可視子孫数・ルートは開項目なしで省略', () => {
  it('開いた親の下の閉じた枝は数えない', async () => {
    const input = join(dir, 'oc1.pdf');
    await makePlainPdf(input);

    // A(open) > B(closed) > C ・ D — A の可視子孫は B のみ（C,D は隠れている）
    const result = await addBookmarks({
      inputPath: input,
      bookmarks: [
        {
          title: 'A',
          page: 1,
          open: true,
          children: [
            {
              title: 'B',
              page: 1,
              open: false,
              children: [
                { title: 'C', page: 1 },
                { title: 'D', page: 1 },
              ],
            },
          ],
        },
      ],
    });
    const doc = await load(result);
    const outlines = doc.catalog.lookup(PDFName.of('Outlines')) as PDFDict;
    const a = outlines.lookup(PDFName.of('First')) as PDFDict;
    const b = a.lookup(PDFName.of('First')) as PDFDict;

    expect((a.lookup(PDFName.of('Count')) as PDFNumber).asNumber()).toBe(1); // B のみ（旧実装は 3）
    expect((b.lookup(PDFName.of('Count')) as PDFNumber).asNumber()).toBe(-2); // 閉: 開けば C,D
    // ルート: 可視 = A + B = 2
    expect((outlines.lookup(PDFName.of('Count')) as PDFNumber).asNumber()).toBe(2);
  });

  it('開いた項目が 1 つも無ければルート /Count を省略する', async () => {
    const input = join(dir, 'oc2.pdf');
    await makePlainPdf(input);

    const result = await addBookmarks({
      inputPath: input,
      bookmarks: [
        {
          title: 'A',
          page: 1,
          open: false,
          children: [{ title: 'B', page: 1 }],
        },
        { title: 'C', page: 1 }, // 子なし（open/closed の概念なし）
      ],
    });
    const doc = await load(result);
    const outlines = doc.catalog.lookup(PDFName.of('Outlines')) as PDFDict;
    expect(outlines.get(PDFName.of('Count'))).toBeUndefined();
    // 項目自体の /Count（閉じた A = -1）は維持される
    const a = outlines.lookup(PDFName.of('First')) as PDFDict;
    expect((a.lookup(PDFName.of('Count')) as PDFNumber).asNumber()).toBe(-1);
  });
});

describe('§7.9.6: 名前ツリーのキーは辞書順', () => {
  it('挿入順が逆でも /Names がソートされる', async () => {
    const input = join(dir, 'nt.pdf');
    const mid = join(dir, 'nt-1.pdf');
    await makePlainPdf(input);
    const fileB = join(dir, 'b.txt');
    const fileA = join(dir, 'a.txt');
    await writeFile(fileB, 'b');
    await writeFile(fileA, 'a');

    await attachFileToPdf({ inputPath: input, attachmentPath: fileB, outputPath: mid });
    const result = await attachFileToPdf({ inputPath: mid, attachmentPath: fileA });

    const doc = await load(result);
    const names = doc.catalog.lookup(PDFName.of('Names')) as PDFDict;
    const ef = names.lookup(PDFName.of('EmbeddedFiles')) as PDFDict;
    const arr = ef.lookup(PDFName.of('Names')) as PDFArray;
    const keys: string[] = [];
    for (let i = 0; i + 1 < arr.size(); i += 2) {
      keys.push((arr.lookup(i) as { decodeText(): string }).decodeText());
    }
    expect(keys).toEqual(['a.txt', 'b.txt']);
  });
});

describe('E-6: 注釈・添付の日時が SOURCE_DATE_EPOCH に従う', () => {
  it('同一入力から同一バイト列（注釈 + 添付）', async () => {
    const prev = process.env.SOURCE_DATE_EPOCH;
    process.env.SOURCE_DATE_EPOCH = '1700000000';
    try {
      const input = join(dir, 'det.pdf');
      await makePlainPdf(input);
      const att = join(dir, 'det.txt');
      await writeFile(att, 'data');

      const run = async (out: string): Promise<Buffer> => {
        const mid = join(dir, `${out}-mid.pdf`);
        await addAnnotation({
          inputPath: input,
          outputPath: mid,
          page: 1,
          type: 'text',
          rect: { x1: 10, y1: 10, x2: 40, y2: 40 },
        });
        const final = join(dir, `${out}.pdf`);
        await attachFileToPdf({ inputPath: mid, attachmentPath: att, outputPath: final });
        return readFile(final);
      };

      const one = await run('det-1');
      const two = await run('det-2');
      expect(Buffer.compare(one, two)).toBe(0);
    } finally {
      if (prev === undefined) delete process.env.SOURCE_DATE_EPOCH;
      else process.env.SOURCE_DATE_EPOCH = prev;
    }
  });
});
