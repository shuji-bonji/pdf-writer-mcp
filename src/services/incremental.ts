/**
 * Incremental update — 署名を保持する末尾追記（Tier C PoC・ADR-11）
 *
 * pdf-lib の save() はファイル全体を再構築するため既存署名を必ず壊す。
 * 本モジュールは**元のバイト列に一切触れず**、変更・追加されたオブジェクトだけを
 * ISO 32000-1 §7.5.6 の増分更新として末尾に追記する。署名の /ByteRange は
 * 元ファイル範囲のみを覆うため、前方バイトが同一なら署名は有効なまま残る。
 *
 * 方式（Issue #2 の 3 ハードルへの対応）:
 *   1. バイトオフセット — 追記部分は自前で組み立てるため、全オフセットを
 *      「元ファイル長 + 追記内の相対位置」として厳密に計算できる
 *   2. オブジェクトの直列化 — pdf-lib のパース済みオブジェクトを
 *      sizeInBytes / copyBytesInto でそのまま直列化する（自前トークナイザを持たない）
 *   3. xref の形式追随 — 元ファイルが古典テーブルなら xref テーブル + trailer を、
 *      相互参照ストリーム（PDF 1.5+）なら /Type /XRef ストリームを追記する
 *      （形式の混在は仕様違反）
 *
 * 制約（PoC）:
 *   - 暗号化 PDF は対象外（loadForEdit が先に拒否する）
 *   - 削除（free エントリ）は扱わない — 追加と再定義のみ
 */

import {
  PDFArray,
  type PDFDict,
  type PDFDocument,
  PDFName,
  PDFNumber,
  type PDFObject,
  PDFRef,
} from 'pdf-lib';
import { PdfWriterError } from '../errors.js';

/** 元ファイル末尾から startxref を読む */
export function readStartXref(original: Uint8Array): number {
  // startxref は末尾近傍にある（仕様上は最終 1024 バイト内が慣例。余裕を見て 2048）
  const tail = Buffer.from(original.subarray(Math.max(0, original.length - 2048))).toString(
    'latin1',
  );
  const idx = tail.lastIndexOf('startxref');
  if (idx < 0) {
    throw new PdfWriterError(
      'Cannot find "startxref" near the end of the file — not a valid PDF trailer.',
      'INVALID_PDF',
    );
  }
  const m = /startxref\s+(\d+)/.exec(tail.slice(idx));
  if (!m) {
    throw new PdfWriterError('Malformed "startxref" entry in the PDF trailer.', 'INVALID_PDF');
  }
  return Number(m[1]);
}

/** 元ファイルの相互参照が古典テーブルか、相互参照ストリームかを判定する */
export function detectXrefStyle(original: Uint8Array, startxref: number): 'table' | 'stream' {
  if (startxref < 0 || startxref >= original.length) {
    throw new PdfWriterError(
      `startxref points outside the file (${startxref}) — corrupted PDF.`,
      'INVALID_PDF',
    );
  }
  const head = Buffer.from(original.subarray(startxref, startxref + 32))
    .toString('latin1')
    .trimStart();
  return head.startsWith('xref') ? 'table' : 'stream';
}

/**
 * 元ファイルが実際に使っている最大オブジェクト番号を context に予約する。
 *
 * **増分更新の前に必ず呼ぶこと。** pdf-lib はオブジェクトストリームの「容器」と
 * 相互参照ストリーム自身を indirect object として登録しないため、
 * `largestObjectNumber` が実際より小さくなる。そのまま `register()` すると
 * 新規オブジェクトが**容器と同じ番号を再利用**し、/Prev 連鎖上で
 * 「obj N は圧縮ストリーム」⇔「obj N は注釈辞書」が衝突して読者が壊れる
 * （qpdf: "supposed object stream N is not a stream" を実測）。
 *
 * 真の最大番号は有効な trailer の /Size（= 最大番号 + 1。ISO 32000-1 §7.5.5）から取る。
 */
export function reserveExistingObjectNumbers(doc: PDFDocument, original: Uint8Array): void {
  const startxref = readStartXref(original);
  // startxref の指す位置からファイル末尾まで（テーブル形式ではエントリ列の後に
  // trailer 辞書が来る。エントリは数字のみなので /Size の誤検出はない）
  const region = Buffer.from(original.subarray(startxref)).toString('latin1');
  const m = /\/Size\s+(\d+)/.exec(region);
  if (!m) {
    throw new PdfWriterError(
      'Cannot determine /Size from the active trailer — refusing to allocate object numbers ' +
        'that might collide with existing objects.',
      'INVALID_PDF',
    );
  }
  const maxUsed = Number(m[1]) - 1;
  if (maxUsed > doc.context.largestObjectNumber) {
    doc.context.largestObjectNumber = maxUsed;
  }
}

export interface IncrementalUpdateOptions {
  /** 元ファイルのバイト列（一切変更しない） */
  original: Uint8Array;
  /** original から load 済みの文書（メモリ上で変更済み） */
  doc: PDFDocument;
  /** 再定義する既存オブジェクトの参照（変更したもの） */
  dirtyRefs: PDFRef[];
  /** 変更前の largestObjectNumber。これより大きい番号はすべて新規として追記する */
  sinceObjectNumber: number;
}

export interface IncrementalUpdateResult {
  bytes: Uint8Array;
  /** 追記したオブジェクト数（xref ストリーム自身は含まない） */
  objectsWritten: number;
  /** 追記した相互参照の形式 */
  xrefStyle: 'table' | 'stream';
}

interface Entry {
  num: number;
  gen: number;
  offset: number;
}

/** 連続する番号の並びを xref のサブセクション（[開始, 個数]）へまとめる */
function contiguousRuns(entries: Entry[]): Array<{ start: number; items: Entry[] }> {
  const runs: Array<{ start: number; items: Entry[] }> = [];
  for (const e of entries) {
    const last = runs[runs.length - 1];
    if (last && e.num === last.start + last.items.length) {
      last.items.push(e);
    } else {
      runs.push({ start: e.num, items: [e] });
    }
  }
  return runs;
}

function serializeObject(obj: PDFObject): Uint8Array {
  const buf = new Uint8Array(obj.sizeInBytes());
  obj.copyBytesInto(buf, 0);
  return buf;
}

function latin1(s: string): Uint8Array {
  return Uint8Array.from(Buffer.from(s, 'latin1'));
}

/**
 * 増分更新を構築して「元バイト列 + 追記部」を返す。
 * 戻り値の先頭 original.length バイトは入力と同一であることが保証される。
 */
export function buildIncrementalUpdate(opts: IncrementalUpdateOptions): IncrementalUpdateResult {
  const { original, doc, sinceObjectNumber } = opts;
  const context = doc.context;

  const prevStartXref = readStartXref(original);
  const style = detectXrefStyle(original, prevStartXref);

  // --- 書き出すオブジェクトを収集（新規 = snapshot より大きい番号、+ dirty） ---
  const toWrite = new Map<number, { ref: PDFRef; obj: PDFObject }>();
  for (const [ref, obj] of context.enumerateIndirectObjects()) {
    if (ref.objectNumber > sinceObjectNumber) toWrite.set(ref.objectNumber, { ref, obj });
  }
  for (const ref of opts.dirtyRefs) {
    const obj = context.lookup(ref);
    if (!obj) {
      throw new PdfWriterError(
        `Dirty object ${ref.objectNumber} ${ref.generationNumber} R is not present in the document.`,
        'INTERNAL_ERROR',
      );
    }
    toWrite.set(ref.objectNumber, { ref, obj });
  }
  if (toWrite.size === 0) {
    throw new PdfWriterError('Incremental update has nothing to write.', 'INTERNAL_ERROR');
  }

  const sorted = [...toWrite.values()].sort((a, b) => a.ref.objectNumber - b.ref.objectNumber);

  // --- 本体オブジェクトの直列化（オフセットは 元ファイル長 + 相対位置） ---
  const chunks: Uint8Array[] = [];
  let cursor = original.length;
  const push = (bytes: Uint8Array): void => {
    chunks.push(bytes);
    cursor += bytes.length;
  };

  // 元ファイルが改行で終わらない場合に備え、必ず改行から始める
  push(latin1('\n'));

  const entries: Entry[] = [];
  for (const { ref, obj } of sorted) {
    entries.push({ num: ref.objectNumber, gen: ref.generationNumber, offset: cursor });
    push(latin1(`${ref.objectNumber} ${ref.generationNumber} obj\n`));
    push(serializeObject(obj));
    push(latin1('\nendobj\n'));
  }

  // --- trailer に引き継ぐ共通エントリ ---
  const ti = context.trailerInfo;
  if (!(ti.Root instanceof PDFRef)) {
    throw new PdfWriterError(
      'The document trailer has no /Root reference — cannot build an incremental update.',
      'INVALID_PDF',
    );
  }

  if (style === 'table') {
    // --- 古典 xref テーブル + trailer ---
    const xrefOffset = cursor;
    let table = 'xref\n';
    for (const run of contiguousRuns(entries)) {
      table += `${run.start} ${run.items.length}\n`;
      for (const e of run.items) {
        // 各エントリは厳密に 20 バイト（10 桁 + SP + 5 桁 + SP + 種別 + CRLF）
        table += `${String(e.offset).padStart(10, '0')} ${String(e.gen).padStart(5, '0')} n\r\n`;
      }
    }
    push(latin1(table));

    const trailer = context.obj({}) as PDFDict;
    trailer.set(PDFName.of('Size'), PDFNumber.of(context.largestObjectNumber + 1));
    trailer.set(PDFName.of('Prev'), PDFNumber.of(prevStartXref));
    trailer.set(PDFName.of('Root'), ti.Root);
    if (ti.Info instanceof PDFRef) trailer.set(PDFName.of('Info'), ti.Info);
    if (ti.ID instanceof PDFArray) trailer.set(PDFName.of('ID'), ti.ID);

    push(latin1('trailer\n'));
    push(serializeObject(trailer));
    push(latin1(`\nstartxref\n${xrefOffset}\n%%EOF`));
  } else {
    // --- 相互参照ストリーム（/Type /XRef。自分自身のエントリも含める） ---
    const xrefNum = context.largestObjectNumber + 1;
    const xrefOffset = cursor;
    const all: Entry[] = [...entries, { num: xrefNum, gen: 0, offset: xrefOffset }].sort(
      (a, b) => a.num - b.num,
    );

    // W = [1, 4, 2]: type 1 バイト / offset 4 バイト / gen 2 バイト（無圧縮）
    const data = new Uint8Array(all.length * 7);
    for (const [i, e] of all.entries()) {
      const at = i * 7;
      data[at] = 1; // type 1 = 使用中・非圧縮
      data[at + 1] = (e.offset >>> 24) & 0xff;
      data[at + 2] = (e.offset >>> 16) & 0xff;
      data[at + 3] = (e.offset >>> 8) & 0xff;
      data[at + 4] = e.offset & 0xff;
      data[at + 5] = (e.gen >>> 8) & 0xff;
      data[at + 6] = e.gen & 0xff;
    }

    const index: number[] = [];
    for (const run of contiguousRuns(all)) {
      index.push(run.start, run.items.length);
    }

    const dict = context.obj({}) as PDFDict;
    dict.set(PDFName.of('Type'), PDFName.of('XRef'));
    dict.set(PDFName.of('Size'), PDFNumber.of(xrefNum + 1));
    dict.set(PDFName.of('W'), context.obj([1, 4, 2]) as PDFArray);
    dict.set(PDFName.of('Index'), context.obj(index) as PDFArray);
    dict.set(PDFName.of('Length'), PDFNumber.of(data.length));
    dict.set(PDFName.of('Prev'), PDFNumber.of(prevStartXref));
    dict.set(PDFName.of('Root'), ti.Root);
    if (ti.Info instanceof PDFRef) dict.set(PDFName.of('Info'), ti.Info);
    if (ti.ID instanceof PDFArray) dict.set(PDFName.of('ID'), ti.ID);

    push(latin1(`${xrefNum} 0 obj\n`));
    push(serializeObject(dict));
    push(latin1('\nstream\n'));
    push(data);
    push(latin1(`\nendstream\nendobj\nstartxref\n${xrefOffset}\n%%EOF`));
  }

  // --- 結合（先頭 original.length バイトは常に入力と同一） ---
  let total = original.length;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  out.set(original, 0);
  let at = original.length;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }

  return { bytes: out, objectsWritten: sorted.length, xrefStyle: style };
}
