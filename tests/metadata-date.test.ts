/**
 * W-5: Info 辞書と XMP の日時は「fully equivalent」でなければならない
 *
 * **R-14.3.4-2 / -5**（shall）: 作成日時・更新日時を Info と XMP の両方に書く場合、
 * 両者は完全に等価であること。
 *
 * v0.13.1 までは Info 側（`output.ts`）と XMP 側（`xmp.ts`）が**別々に** `outputDate()` を
 * 呼んでいた。固定値（`SOURCE_DATE_EPOCH`）では常に一致するので、テストも実測も通っていたが、
 * 素の実行で 2 回の呼び出しが**秒境界を跨ぐと不一致**になる。
 *
 * 「低い確率でだけ shall を破る」は、起きたときに再現できない類の不具合なので、
 * **確率に頼らない形で固定する**必要がある。ここでは 2 段構えにした:
 *
 * 1. `documentDate()` が「1 文書 = 1 インスタンス」を返すことの単体検査。
 *    これが担保されていれば、どの経路から取っても同じ瞬間になる（決定的に検証できる）。
 * 2. 生成した PDF で Info と XMP を突き合わせる結合検査。こちらは秒境界を跨がないと
 *    修正前でも通ってしまう＝**単体検査の方が本体**であることを承知の上で、
 *    「1 と 2 を繋ぐ配線が外れていないか」を見るために置いている。
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDict, PDFDocument, PDFName, PDFRawStream, PDFString } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { documentDate } from '../src/config.js';
import {
  handleCreateTextPdf,
  handleEnsurePdfa,
  handleEnsureTagged,
  handleSetMetadata,
} from '../src/tools/handlers.js';

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pwm-metadate-'));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Info の CreationDate / ModDate と、XMP の xmp:CreateDate / xmp:ModifyDate を取り出す */
async function readDates(base64: string): ReturnType<typeof readDatesFromBytes> {
  return readDatesFromBytes(Buffer.from(base64, 'base64'));
}

async function readDatesFromBytes(bytes: Uint8Array): Promise<{
  info: { creation?: Date; modification?: Date };
  xmp: { create?: string; modify?: string };
}> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const metadata = doc.catalog.lookup(PDFName.of('Metadata'));
  const packet =
    metadata instanceof PDFRawStream ? new TextDecoder().decode(metadata.contents) : '';
  return {
    info: { creation: doc.getCreationDate(), modification: doc.getModificationDate() },
    xmp: {
      create: /<xmp:CreateDate>([^<]+)<\/xmp:CreateDate>/.exec(packet)?.[1],
      modify: /<xmp:ModifyDate>([^<]+)<\/xmp:ModifyDate>/.exec(packet)?.[1],
    },
  };
}

/** PDF の日時（Date）を XMP と同じ「秒まで・UTC」の ISO 8601 に揃える */
function toXmpForm(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

const FONT = process.env.TEST_FONT_PATH;

describe('W-5: 文書ごとに時刻を 1 つだけ決める', () => {
  it('同じ文書からは常に同一インスタンスが返る', async () => {
    const doc = await PDFDocument.create();
    const first = documentDate(doc);
    const second = documentDate(doc);
    // 値が等しいだけでなく**同一インスタンス**であること。
    // 「たまたま同じ秒だった」では通らないので、修正前の実装では落ちる
    expect(second).toBe(first);
  });

  it('別の文書には別の時刻を決める（文書を跨いで固定しない）', async () => {
    const a = await PDFDocument.create();
    const b = await PDFDocument.create();
    // 別文書が同じ瞬間を名乗る方が嘘になるので、共有しないことを固定する
    expect(documentDate(b)).not.toBe(documentDate(a));
  });
});

describe('W-5: Info と XMP の日時が一致する（R-14.3.4-2/-5）', () => {
  it('SOURCE_DATE_EPOCH 無しでも一致する — 秒境界を跨いでも壊れない', async () => {
    const previous = process.env.SOURCE_DATE_EPOCH;
    // 固定値があると「別々に取っても一致する」ので、ここでは必ず外す
    delete process.env.SOURCE_DATE_EPOCH;
    try {
      // 秒境界を跨ぐ確率を上げるために繰り返す（結合検査なので確率的なのは承知の上）
      for (let attempt = 0; attempt < 12; attempt++) {
        const result = await handleCreateTextPdf({
          text: `Timestamp ${attempt}`,
          title: 'Metadata date',
          tagged: true,
          lang: 'en',
          fontPath: FONT,
          returnBase64: true,
        });
        const { info, xmp } = await readDates(result.base64 as string);

        expect(xmp.create, 'the tagged output should carry XMP').toBeDefined();
        expect(info.creation).toBeDefined();
        expect(toXmpForm(info.creation as Date)).toBe(xmp.create);
        expect(toXmpForm(info.modification as Date)).toBe(xmp.modify);
      }
    } finally {
      if (previous === undefined) delete process.env.SOURCE_DATE_EPOCH;
      else process.env.SOURCE_DATE_EPOCH = previous;
    }
  });

  it('W-6: ensure_pdfa の XMP 新設で Info /CreationDate を引き継ぐ（R-14.3.4-4）', async () => {
    // 過去の固定日時にするのが本体 — now フォールバック（修正前の挙動）では絶対に一致しない。
    // 発見経緯 = 制約テーブル PoC CT-META-4（_constraint-table-poc/REPORT.md §6.2）
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    doc.setCreationDate(new Date('2020-01-02T03:04:05Z'));
    const inputPath = join(dir, 'w6-info-only.pdf');
    await writeFile(inputPath, await doc.save({ useObjectStreams: false }));

    const outputPath = join(dir, 'w6-info-only-out.pdf');
    await handleEnsurePdfa({ inputPath, outputPath });
    const { info, xmp } = await readDatesFromBytes(await readFile(outputPath));

    expect(xmp.create).toBe('2020-01-02T03:04:05Z');
    // Info 側は不変で、両者は同一時点（R-14.3.4 の等価はインスタント一致）
    expect(toXmpForm(info.creation as Date)).toBe(xmp.create);
  });

  it('W-6: タイムゾーン付き Info 日付も同一時点として引き継ぐ（表記でなくインスタント）', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    const info = doc.context.lookup(doc.context.trailerInfo.Info, PDFDict);
    info.set(PDFName.of('CreationDate'), PDFString.of("D:20200102120000+09'00'"));
    const inputPath = join(dir, 'w6-tz.pdf');
    await writeFile(inputPath, await doc.save({ useObjectStreams: false }));

    const outputPath = join(dir, 'w6-tz-out.pdf');
    await handleEnsurePdfa({ inputPath, outputPath });
    const { xmp } = await readDatesFromBytes(await readFile(outputPath));

    // +09:00 の 12:00 は UTC の 03:00。XMP は Z 表記になるが同一時点
    expect(Date.parse(xmp.create as string)).toBe(Date.parse('2020-01-02T03:00:00Z'));
  });

  it('W-6: 既存 XMP に xmp:CreateDate が無ければ syncXmpWithInfo が Info から補う', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    doc.setCreationDate(new Date('2020-01-02T03:04:05Z'));
    // xmp:CreateDate を持たない最小の XMP を手組みで持たせる（setXmpMetadata は W-6 是正後
    // Info から補ってしまうので、このテストの入力には使えない）
    const packet =
      '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>\n' +
      '<x:xmpmeta xmlns:x="adobe:ns:meta/">\n' +
      '  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n' +
      '    <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/">\n' +
      '      <xmp:ModifyDate>2020-01-02T03:04:05Z</xmp:ModifyDate>\n' +
      '    </rdf:Description>\n' +
      '  </rdf:RDF>\n' +
      '</x:xmpmeta>\n' +
      '<?xpacket end="w"?>';
    const bytes = new TextEncoder().encode(packet);
    const stream = PDFRawStream.of(
      doc.context.obj({ Type: 'Metadata', Subtype: 'XML', Length: bytes.length }) as PDFDict,
      bytes,
    );
    doc.catalog.set(PDFName.of('Metadata'), doc.context.register(stream));
    const inputPath = join(dir, 'w6-xmp-no-createdate.pdf');
    await writeFile(inputPath, await doc.save({ useObjectStreams: false }));

    const outputPath = join(dir, 'w6-xmp-no-createdate-out.pdf');
    await handleSetMetadata({ inputPath, title: 'W-6 backfill', outputPath });
    const { xmp } = await readDatesFromBytes(await readFile(outputPath));

    expect(xmp.create).toBe('2020-01-02T03:04:05Z');
  });

  it('W-6: ensure_tagged の XMP 書き換えでも Info /CreationDate を引き継ぐ', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    doc.setCreationDate(new Date('2020-01-02T03:04:05Z'));
    doc.setTitle('W-6 tagged');
    const inputPath = join(dir, 'w6-tagged.pdf');
    await writeFile(inputPath, await doc.save({ useObjectStreams: false }));

    const outputPath = join(dir, 'w6-tagged-out.pdf');
    await handleEnsureTagged({ inputPath, outputPath, lang: 'en' });
    const { xmp } = await readDatesFromBytes(await readFile(outputPath));

    expect(xmp.create).toBe('2020-01-02T03:04:05Z');
  });

  it('SOURCE_DATE_EPOCH 設定時は固定値になる（E-6 の決定論を壊していない）', async () => {
    const previous = process.env.SOURCE_DATE_EPOCH;
    process.env.SOURCE_DATE_EPOCH = '1700000000';
    try {
      const result = await handleCreateTextPdf({
        text: 'Fixed timestamp',
        title: 'Metadata date',
        tagged: true,
        lang: 'en',
        fontPath: FONT,
        returnBase64: true,
      });
      const { info, xmp } = await readDates(result.base64 as string);
      const fixed = new Date(1_700_000_000 * 1000);
      expect(info.creation?.getTime()).toBe(fixed.getTime());
      expect(xmp.create).toBe(toXmpForm(fixed));
      expect(xmp.modify).toBe(toXmpForm(fixed));
    } finally {
      if (previous === undefined) delete process.env.SOURCE_DATE_EPOCH;
      else process.env.SOURCE_DATE_EPOCH = previous;
    }
  });
});
