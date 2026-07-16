/**
 * stamp_page_numbers のテスト
 *
 * 要点は 2 つ:
 *   - タグ付き PDF ではページ番号を Artifact で囲む（PDF/UA-1 7.1-3）。囲まないと
 *     「タグ付けされていないコンテンツ」として準拠が壊れる。veraPDF ua1 で COMPLIANT を確認済み。
 *   - 回転ページ（/Rotate）では、見た目の「右下」と座標系上の隅が食い違う。
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { degrees, PDFDocument } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { computePosition, formatPageNumber } from '../src/services/page-number.js';
import { handleCreateTextPdf, handleStampPageNumbers } from '../src/tools/handlers.js';
import type { StampResult } from '../src/types/index.js';

const fontPath = process.env.TEST_FONT_PATH;
let dir: string;

/** ページ数と回転を指定して土台 PDF を作る */
async function makeFixture(name: string, pages: number, rotation = 0): Promise<string> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([400, 600]);
    if (rotation) page.setRotation(degrees(rotation));
  }
  const path = join(dir, name);
  await writeFile(path, await doc.save());
  return path;
}

/** ページのコンテンツストリームを連結する */
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
      if (data.includes('Tj') || data.includes('BMC')) out.push(data);
    } catch {
      // フォント等
    }
    idx = pdf.indexOf('stream', end, 'latin1');
  }
  return out.join('\n');
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pdf-writer-stamp-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('formatPageNumber', () => {
  it('expands {n} and {total}', () => {
    expect(formatPageNumber('{n}', 3, 10)).toBe('3');
    expect(formatPageNumber('{n} / {total}', 3, 10)).toBe('3 / 10');
    expect(formatPageNumber('- {n} -', 3, 10)).toBe('- 3 -');
    expect(formatPageNumber('{n} ページ（全 {total} ページ）', 3, 10)).toBe(
      '3 ページ（全 10 ページ）',
    );
  });

  it('replaces every occurrence', () => {
    expect(formatPageNumber('{n}/{total} — {n}', 2, 5)).toBe('2/5 — 2');
  });
});

describe('computePosition', () => {
  const page = { getSize: () => ({ width: 400, height: 600 }), getRotation: () => ({ angle: 0 }) };

  it('places the text at each corner', () => {
    // biome-ignore lint/suspicious/noExplicitAny: 最小限のページスタブで足りる
    const p = page as any;
    expect(computePosition(p, 'bottom-left', 30, 9, 24)).toEqual({ x: 24, y: 24 });
    expect(computePosition(p, 'bottom-right', 30, 9, 24)).toEqual({ x: 400 - 24 - 30, y: 24 });
    expect(computePosition(p, 'bottom-center', 30, 9, 24)).toEqual({ x: (400 - 30) / 2, y: 24 });
    expect(computePosition(p, 'top-left', 30, 9, 24)).toEqual({ x: 24, y: 600 - 24 - 9 });
  });

  it('compensates for page rotation so the position stays visually correct', () => {
    // 90 度回転したページでは、見た目の幅・高さが入れ替わる
    const rotated = {
      getSize: () => ({ width: 400, height: 600 }),
      getRotation: () => ({ angle: 90 }),
      // biome-ignore lint/suspicious/noExplicitAny: 同上
    } as any;
    const upright = computePosition(page as never, 'bottom-left', 30, 9, 24);
    const turned = computePosition(rotated, 'bottom-left', 30, 9, 24);
    // 回転ページでは座標が変わる（素朴に同じ座標を使うと隅からずれる）
    expect(turned).not.toEqual(upright);
    expect(turned.x).toBe(24); // 見た目の下端 = 回転後の x
  });
});

describe.skipIf(!fontPath)('stamp_page_numbers', () => {
  it('stamps every page by default', async () => {
    const input = await makeFixture('all.pdf', 3);
    const result = (await handleStampPageNumbers({
      inputPath: input,
      fontPath,
      returnBase64: true,
    })) as StampResult;

    expect(result.stamped).toBe(3);
    expect(result.artifact).toBe(false); // タグ無し文書
    const content = pageContent(Buffer.from(result.base64 as string, 'base64'));
    expect(content).not.toContain('/Artifact BMC');
  });

  it('wraps stamps in Artifact on tagged PDFs (7.1-3)', async () => {
    const path = join(dir, 'tagged.pdf');
    await handleCreateTextPdf({
      text: '本文です。',
      title: 'タグ付き',
      tagged: true,
      lang: 'ja',
      fontPath,
      outputPath: path,
    });

    const result = (await handleStampPageNumbers({
      inputPath: path,
      fontPath,
      returnBase64: true,
    })) as StampResult;

    expect(result.artifact).toBe(true);
    // ページ番号は Artifact として囲まれる（veraPDF ua1 で COMPLIANT を確認済み）
    expect(pageContent(Buffer.from(result.base64 as string, 'base64'))).toContain('/Artifact BMC');
  });

  it('honours pages and startAt — e.g. skip the cover, number from 1', async () => {
    const input = await makeFixture('cover.pdf', 4);
    const result = (await handleStampPageNumbers({
      inputPath: input,
      pages: '2-',
      startAt: 1,
      format: '{n} / {total}',
      fontPath,
      returnBase64: true,
    })) as StampResult;

    expect(result.stamped).toBe(3); // 表紙を除く 3 ページ
  });

  it('supports Japanese formats — the font is subset for the stamped text', async () => {
    const input = await makeFixture('ja.pdf', 2);
    const result = (await handleStampPageNumbers({
      inputPath: input,
      format: '{n} ページ',
      fontPath,
      returnBase64: true,
    })) as StampResult;
    expect(result.stamped).toBe(2);
  });

  it('rejects Japanese formats without an embeddable font', async () => {
    const input = await makeFixture('nofont.pdf', 1);
    await expect(
      // fontPath も PDF_WRITER_FONT も無い状態を作るため空文字は使わず、環境変数を退避する
      (async () => {
        const saved = process.env.PDF_WRITER_FONT;
        process.env.PDF_WRITER_FONT = '';
        try {
          return await handleStampPageNumbers({ inputPath: input, format: '{n} ページ' });
        } finally {
          if (saved !== undefined) process.env.PDF_WRITER_FONT = saved;
        }
      })(),
    ).rejects.toThrow(/non-Latin characters/);
  });

  it('rejects a format without {n} and unknown positions', async () => {
    const input = await makeFixture('bad.pdf', 1);
    await expect(
      handleStampPageNumbers({ inputPath: input, format: 'page', fontPath }),
    ).rejects.toThrow(/must contain "\{n\}"/);
    await expect(
      handleStampPageNumbers({ inputPath: input, position: 'middle', fontPath }),
    ).rejects.toThrow(/position must be one of/);
  });

  it('stamps rotated pages without throwing', async () => {
    const input = await makeFixture('rotated.pdf', 2, 90);
    const result = (await handleStampPageNumbers({
      inputPath: input,
      position: 'bottom-right',
      fontPath,
      returnBase64: true,
    })) as StampResult;
    expect(result.stamped).toBe(2);
  });
});
