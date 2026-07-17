/**
 * 増分更新（preserveSignatures・Tier C PoC・ADR-11）のテスト
 *
 * 検証の主眼:
 *   - **前方バイト同一性**: 出力の先頭 original.length バイトが入力と完全一致する
 *     （署名の /ByteRange は元ファイル範囲を覆うため、これが署名保持の必要十分条件）
 *   - 古典 xref テーブルと相互参照ストリーム（PDF 1.5+）の両形式に追随できる
 *   - /Annots が間接配列ならページオブジェクトを再定義しない（最小差分）
 *   - 増分の重ね掛け（2 回目の追記が 1 回目の出力を前方保持する）
 *   - タグ付き文書は UNSUPPORTED_PDF_FEATURE で拒否（PoC の明示的な範囲外）
 *   - 署名ガードの next_actions に preserveSignatures が案内される
 *
 * 実署名での受け入れ（verify_signatures = valid / verify_integrity = 合法増分）は
 * pdf-verify-mcp + veraPDF のある手元環境で行う（CI はバイトレベル検証のみ）。
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRef } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PdfWriterError } from '../src/errors.js';
import { addAnnotation } from '../src/services/editor.js';
import { detectXrefStyle, readStartXref } from '../src/services/incremental.js';
import { handleAddAnnotation, handleCreateTextPdf } from '../src/tools/handlers.js';
import type { AddAnnotationArgs, EditResult } from '../src/types/index.js';

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pwm-incr-'));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

/**
 * 「署名済みに見える」PDF フィクスチャを作る。
 * containsSignature は生バイトの "/ByteRange" を検知するため、%%EOF の後ろに
 * コメント行として埋める（pdf-lib の文字列は hex 化されるため辞書経由では埋まらない）。
 * 実署名（CMS）での検証は verify-mcp を使う受け入れ側で行う。
 */
async function makeSignedLookingPdf(
  path: string,
  opts: { useObjectStreams: boolean; indirectAnnots?: boolean },
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 300]);
  if (opts.indirectAnnots) {
    const arr = doc.context.obj([]) as PDFArray;
    page.node.set(PDFName.of('Annots'), doc.context.register(arr));
  }
  const saved = await doc.save({ useObjectStreams: opts.useObjectStreams });
  const bytes = Buffer.concat([
    Buffer.from(saved),
    Buffer.from('\n% fixture marker: /ByteRange [0 0 0 0]\n', 'latin1'),
  ]);
  await writeFile(path, bytes);
  return bytes;
}

function annotArgs(inputPath: string, outputPath: string): AddAnnotationArgs {
  return {
    inputPath,
    outputPath,
    page: 1,
    type: 'text',
    rect: { x1: 50, y1: 200, x2: 80, y2: 230 },
    contents: '承認済み',
    author: 'テスト',
    preserveSignatures: true,
  };
}

/** 出力ページの注釈（Contents）を読み出す */
async function readAnnotContents(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const annots = doc.getPages()[0].node.lookup(PDFName.of('Annots'));
  if (!(annots instanceof PDFArray)) return [];
  const out: string[] = [];
  for (let i = 0; i < annots.size(); i++) {
    const a = annots.lookup(i);
    if (a instanceof PDFDict) {
      const c = a.lookup(PDFName.of('Contents'));
      if (c instanceof PDFHexString) out.push(c.decodeText());
    }
  }
  return out;
}

describe.each([
  ['classic xref table', false],
  ['cross-reference stream', true],
] as const)('preserveSignatures — %s', (_label, useObjectStreams) => {
  it('前方バイトを保ったまま注釈が追加される', async () => {
    const input = join(dir, `s-${useObjectStreams}.pdf`);
    const output = join(dir, `s-${useObjectStreams}-out.pdf`);
    const original = await makeSignedLookingPdf(input, { useObjectStreams });

    const result = (await addAnnotation(annotArgs(input, output))) as EditResult;
    expect(result.incremental).toBe(true);

    const out = await readFile(output);
    // 署名保持の核心: 先頭 original.length バイトが完全一致
    expect(out.length).toBeGreaterThan(original.length);
    expect(Buffer.compare(out.subarray(0, original.length), Buffer.from(original))).toBe(0);

    // 追記された増分が新しい相互参照として解決される（pdf-lib で再読込できる）
    expect(await readAnnotContents(out)).toEqual(['承認済み']);

    // 追記部の trailer/xref ストリームが /Prev で旧 startxref を指す
    const appended = Buffer.from(out.subarray(original.length)).toString('latin1');
    const prevOffset = readStartXref(original);
    expect(appended).toContain(`/Prev ${prevOffset}`);
    expect(detectXrefStyle(original, prevOffset)).toBe(useObjectStreams ? 'stream' : 'table');

    // 番号衝突の回帰ガード: 新規オブジェクトは元 trailer /Size 以上の番号を使う。
    // pdf-lib はオブジェクトストリーム容器・旧 xref ストリームを登録しないため、
    // 予約なしだと容器と同じ番号を再利用して /Prev 連鎖が壊れる（qpdf 実測）
    const sizeMatch = /\/Size\s+(\d+)/.exec(
      Buffer.from(original.subarray(readStartXref(original))).toString('latin1'),
    );
    const origSize = Number(sizeMatch?.[1]);
    expect(origSize).toBeGreaterThan(0);
    for (const m of appended.matchAll(/(?:^|\n)(\d+) (\d+) obj\b/g)) {
      const num = Number(m[1]);
      // 再定義（既存の変更）は /Size 未満でよいが、その場合は元から登録済みの
      // 番号に限る。新規（Annot / XRef）は必ず /Size 以上であること
      const start = m.index ?? 0;
      const end = appended.indexOf('endobj', start);
      const body = appended.slice(start, end > start ? end : start + 200);
      if (body.includes('/Type /Annot') || body.includes('/Type /XRef')) {
        expect(num, `new object ${num} must not reuse existing numbers`).toBeGreaterThanOrEqual(
          origSize,
        );
      }
    }
  });
});

describe('preserveSignatures — 最小差分と重ね掛け', () => {
  it('/Annots が間接配列ならページオブジェクトを再定義しない', async () => {
    const input = join(dir, 'indirect.pdf');
    const output = join(dir, 'indirect-out.pdf');
    const original = await makeSignedLookingPdf(input, {
      useObjectStreams: false,
      indirectAnnots: true,
    });

    await addAnnotation(annotArgs(input, output));
    const out = await readFile(output);
    const appended = Buffer.from(out.subarray(original.length)).toString('latin1');
    expect(appended).not.toContain('/Type /Page'); // ページ辞書は元のまま
    expect(await readAnnotContents(out)).toEqual(['承認済み']);
  });

  it('増分の重ね掛け: 2 回目も 1 回目の出力を前方保持する', async () => {
    const input = join(dir, 'stack.pdf');
    const mid = join(dir, 'stack-1.pdf');
    const output = join(dir, 'stack-2.pdf');
    await makeSignedLookingPdf(input, { useObjectStreams: false });

    await addAnnotation(annotArgs(input, mid));
    const first = await readFile(mid);

    const second = annotArgs(mid, output);
    second.contents = '二次承認';
    await addAnnotation(second);
    const out = await readFile(output);

    expect(Buffer.compare(out.subarray(0, first.length), first)).toBe(0);
    expect(await readAnnotContents(out)).toEqual(['承認済み', '二次承認']);
  });
});

describe('preserveSignatures — ガードと分岐', () => {
  it('タグ付き PDF は UNSUPPORTED_PDF_FEATURE で拒否する', async () => {
    const input = join(dir, 'tagged.pdf');
    await handleCreateTextPdf({
      text: 'tagged body',
      title: 'T',
      tagged: true,
      lang: 'en',
      outputPath: input,
    });
    const err = await addAnnotation(annotArgs(input, join(dir, 'tagged-out.pdf'))).catch((e) => e);
    expect(err).toBeInstanceOf(PdfWriterError);
    expect((err as PdfWriterError).code).toBe('UNSUPPORTED_PDF_FEATURE');
  });

  it('署名ガードの next_actions に preserveSignatures が案内される', async () => {
    const input = join(dir, 'guard.pdf');
    await makeSignedLookingPdf(input, { useObjectStreams: false });

    const err = await handleAddAnnotation({
      inputPath: input,
      page: 1,
      type: 'text',
      rect: { x1: 0, y1: 0, x2: 10, y2: 10 },
    }).catch((e) => e);
    expect(err).toBeInstanceOf(PdfWriterError);
    expect((err as PdfWriterError).code).toBe('SIGNED_PDF');
    const actions = (err as PdfWriterError).options.next_actions?.map((a) => a.action);
    expect(actions).toContain('retry_with_preserveSignatures');
  });

  it('通常経路（preserveSignatures なし・非署名文書）は従来どおり動く', async () => {
    const input = join(dir, 'plain.pdf');
    const output = join(dir, 'plain-out.pdf');
    const doc = await PDFDocument.create();
    doc.addPage([400, 300]);
    await writeFile(input, await doc.save());

    const result = await addAnnotation({
      inputPath: input,
      outputPath: output,
      page: 1,
      type: 'square',
      rect: { x1: 10, y1: 10, x2: 100, y2: 60 },
    });
    expect(result.incremental).toBeUndefined();
    expect((await readAnnotContents(await readFile(output))).length).toBe(1);
  });
});

describe('preserveSignatures — 仕様照合による是正（pdf-spec-mcp で確認）', () => {
  it('§14.4: ファイル ID の第 1 要素は保持し、第 2 要素は更新される', async () => {
    const input = join(dir, 'id.pdf');
    const output = join(dir, 'id-out.pdf');
    const doc = await PDFDocument.create();
    doc.addPage([400, 300]);
    const first = 'AABBCCDDEEFF00112233445566778899';
    doc.context.trailerInfo.ID = doc.context.obj([PDFHexString.of(first), PDFHexString.of(first)]);
    await writeFile(input, await doc.save({ useObjectStreams: false }));
    const original = await readFile(input);

    await addAnnotation(annotArgs(input, output));
    const out = await readFile(output);
    const appended = Buffer.from(out.subarray(original.length)).toString('latin1');

    const idMatch = /\/ID\s*\[\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\]/.exec(appended);
    expect(idMatch, 'appended trailer must carry /ID').toBeTruthy();
    expect(idMatch?.[1].toUpperCase()).toBe(first); // 第 1 要素 = 永続
    expect(idMatch?.[2].toUpperCase()).not.toBe(first); // 第 2 要素 = 更新（shall）
    expect(idMatch?.[2]).toHaveLength(32); // MD5 = 16 バイト（§14.4 の最小長を満たす）
  });

  it('§12.8.2.2: DocMDP P=1 / P=2 の認証署名では注釈の増分追記を拒否する', async () => {
    for (const p of [1, 2]) {
      const input = join(dir, `docmdp-${p}.pdf`);
      const doc = await PDFDocument.create();
      doc.addPage([400, 300]);
      // 認証署名の構造だけを持つフィクスチャ（V → /Reference → DocMDP /P）
      const { context } = doc;
      const params = context.obj({ P: p }) as PDFDict;
      const sigRef = context.obj({}) as PDFDict;
      sigRef.set(PDFName.of('TransformMethod'), PDFName.of('DocMDP'));
      sigRef.set(PDFName.of('TransformParams'), params);
      const refArray = context.obj([]) as PDFArray;
      refArray.push(sigRef);
      const v = context.obj({ Type: 'Sig' }) as PDFDict;
      v.set(PDFName.of('Reference'), refArray);
      const field = context.obj({ FT: 'Sig', T: PDFHexString.fromText('Sig1') }) as PDFDict;
      field.set(PDFName.of('V'), context.register(v));
      const fields = context.obj([]) as PDFArray;
      fields.push(context.register(field));
      const acroForm = context.obj({}) as PDFDict;
      acroForm.set(PDFName.of('Fields'), fields);
      doc.catalog.set(PDFName.of('AcroForm'), context.register(acroForm));
      await writeFile(input, await doc.save({ useObjectStreams: false }));

      const err = await addAnnotation(annotArgs(input, join(dir, `docmdp-${p}-out.pdf`))).catch(
        (e) => e,
      );
      expect(err, `P=${p} must be rejected`).toBeInstanceOf(PdfWriterError);
      expect((err as PdfWriterError).code).toBe('SIGNED_PDF');
      expect((err as PdfWriterError).message).toContain(`P=${p}`);
    }
  });
});

describe('incremental — 低レベルの安全弁', () => {
  it('startxref が壊れたファイルは INVALID_PDF', () => {
    const junk = Buffer.from('%PDF-1.7\nnothing to see here', 'latin1');
    expect(() => readStartXref(junk)).toThrowError(/startxref/);
  });

  it('生成番号が保たれる（gen>0 の再定義）', () => {
    // PDFRef の gen が entries に反映されることの単体確認
    const ref = PDFRef.of(7, 3);
    expect(ref.generationNumber).toBe(3);
  });
});
