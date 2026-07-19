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

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { documentDate } from '../src/config.js';
import { handleCreateTextPdf } from '../src/tools/handlers.js';

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pwm-metadate-'));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Info の CreationDate / ModDate と、XMP の xmp:CreateDate / xmp:ModifyDate を取り出す */
async function readDates(base64: string): Promise<{
  info: { creation?: Date; modification?: Date };
  xmp: { create?: string; modify?: string };
}> {
  const doc = await PDFDocument.load(Buffer.from(base64, 'base64'), { updateMetadata: false });
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
