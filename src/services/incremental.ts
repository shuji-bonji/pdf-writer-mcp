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
 *
 * **直前セクションの解析は normativepdf に委譲する**（B-22）。以前はバイトを覗いて
 * 形式を推測し、startxref の値を**絶対位置として**扱っていた。ISO 32000-2 §7.5.2 は
 * 「バイトオフセットは %PDF- の PERCENT SIGN から計算する」と定めており、ヘッダ前に
 * バイトが並ぶ合法なファイル（PDF Association の `PDF 2.0 with offset start.pdf`）では
 * **形式を誤判定し、追記後のファイルを qpdf が "file is damaged" と判定していた**。
 *
 * ただし委譲するのは**セクション 1 つの解析だけ**で、チェーンの走査はしない
 * （`readPreviousSection` を参照）。位置の特定と回復方針は本モジュールが持つ。
 * 直列化も pdf-lib のまま — 置き換えたのは読み側の一部だけ。
 *
 * 制約（PoC）:
 *   - 暗号化 PDF は対象外（loadForEdit が先に拒否する）
 *   - 削除（free エントリ）は扱わない — 追加と再定義のみ
 */

import { createHash } from 'node:crypto';
import { dictGet, readXrefSectionAt } from 'normativepdf';
import {
  PDFArray,
  type PDFContext,
  PDFDict,
  type PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  type PDFObject,
  PDFObjectParser,
  type PDFPage,
  PDFRawStream,
  PDFRef,
} from 'pdf-lib';
import { PdfWriterError } from '../errors.js';

/**
 * 直前の相互参照セクションについて、増分更新に必要な事実。
 *
 * セクションの**解析**は normativepdf に委ねる（原点相対のオフセット・古典テーブルと
 * 相互参照ストリームの両方・trailer の構造化）。**位置の特定**は本モジュールが持つ —
 * 同じ切り分けを pdf-verify-mcp の revision-diff でも採っている（`readXrefSectionAt`
 * の doc コメントが「回復方針は消費者側に残す」と宣言している）。
 */
export interface PreviousSection {
  /** §7.5.2 — `%PDF-` の PERCENT SIGN の位置。全オフセットの原点 */
  readonly origin: number;
  /** 直前セクションの位置。**origin 相対**（trailer の /Prev に書く値） */
  readonly startxref: number;
  /** 追記するセクションの形式を決める。hybrid は古典テーブルとして扱う（§7.5.8.4） */
  readonly style: 'table' | 'stream';
  /** 直前 trailer の /Size。オブジェクト番号の予約に使う */
  readonly size: number;
}

/** §7.5.2 — オフセットの原点。ヘッダがファイル先頭に無いファイルは合法 */
function findOrigin(original: Uint8Array): number {
  const at = Buffer.from(original.subarray(0, 4096)).toString('latin1').indexOf('%PDF-');
  if (at < 0) {
    throw new PdfWriterError(
      'No "%PDF-" header found near the start of the file (ISO 32000-2 §7.5.2).',
      'INVALID_PDF',
    );
  }
  return at;
}

/** §7.5.5 — ファイル末尾の startxref が持つ値（origin 相対） */
function readStartxrefValue(original: Uint8Array): number {
  // 末尾近傍を見る。§7.5.5 は「PDF プロセッサは末尾から読むべき」としか言っておらず、
  // %%EOF の後ろにバイトがあるファイルも実在する（normativepdf 0.3.1 の降格根拠）。
  const tail = Buffer.from(original.subarray(Math.max(0, original.length - 2048))).toString(
    'latin1',
  );
  const at = tail.lastIndexOf('startxref');
  if (at < 0) {
    throw new PdfWriterError(
      'Cannot find "startxref" near the end of the file — not a valid PDF trailer.',
      'INVALID_PDF',
    );
  }
  const m = /startxref\s+(\d+)/.exec(tail.slice(at));
  if (!m?.[1]) {
    throw new PdfWriterError('Malformed "startxref" entry in the PDF trailer.', 'INVALID_PDF');
  }
  return Number(m[1]);
}

/**
 * 直前の相互参照セクションを読む（§7.5.2 / §7.5.5 / §7.5.8）。
 *
 * 🔴 **チェーン全体は歩かない。** 増分更新に要るのは最新セクションだけで、`/Prev` の
 * 先が読めるかどうかは関係ない。`readXrefChain` で全体を歩いた版では、追えない
 * `/Prev 0` を持つ**実物の 5 署名 PDF**（`docs/specimens/dss-pades-5sigs-doctimestamp.pdf`）
 * が巻き添えで拒否された — 署名保持のための経路が、まさに署名付き文書で使えなくなる。
 * 必要のない検査を通したことによる後退で、実測でリポジトリ内 PDF 2987 件中 4 件が
 * これに当たっていた。
 *
 * セクション自体が読めなければ拒否する。構造を取り違えたまま進むと、オフセットの
 * 狂った——つまり壊れた——ファイルを作ることになる（B-22）。
 */
export async function readPreviousSection(original: Uint8Array): Promise<PreviousSection> {
  const origin = findOrigin(original);
  const startxref = readStartxrefValue(original);

  let section: Awaited<ReturnType<typeof readXrefSectionAt>>;
  try {
    section = await readXrefSectionAt(original, startxref, origin);
  } catch (error) {
    throw new PdfWriterError(
      `Cannot read the cross-reference section the file's startxref points at, so an incremental ` +
        `update would have to guess its format and offsets: ${error instanceof Error ? error.message : String(error)}`,
      'INVALID_PDF',
    );
  }

  const size = dictGet(section.trailer, 'Size');
  if (size === undefined || size.kind !== 'integer') {
    throw new PdfWriterError(
      'The active trailer has no integer /Size entry (ISO 32000-2 §7.5.5 Table 15) — refusing to ' +
        'allocate object numbers that might collide with existing objects.',
      'INVALID_PDF',
    );
  }
  return {
    origin,
    startxref,
    // §7.5.8.4: hybrid はテーブルに XRefStm がぶら下がった形で、セクション本体は
    // 古典テーブル。追記もテーブルで揃える。
    style: section.kind === 'stream' ? 'stream' : 'table',
    size: size.value,
  };
}

/**
 * 既存オブジェクト番号を予約する（新規採番が既存と衝突しないように）。
 *
 * /Size は**パース済みの trailer から**取る。以前は startxref 以降のバイトを
 * latin1 にして `/\/Size\s+(\d+)/` で拾っていたが、その region の起点が絶対位置
 * だったため、origin > 0 のファイルでは無関係なバイト列を走査していた。
 */
export async function reserveExistingObjectNumbers(
  doc: PDFDocument,
  original: Uint8Array,
): Promise<void> {
  const { size } = await readPreviousSection(original);
  const maxUsed = size - 1;
  if (maxUsed > doc.context.largestObjectNumber) {
    doc.context.largestObjectNumber = maxUsed;
  }
}

/**
 * 認証署名（DocMDP）の許可レベル P を返す（ISO 32000-2 §12.8.2.2）。
 *
 * P=1: 文書は最終（DSS/DTS を除く一切の変更で署名無効）
 * P=2: フォーム記入・署名追加まで（Table 257 の既定値）
 * P=3: + 注釈の作成・削除・変更
 *
 * 注釈の増分追記が許されるのは P=3 のみ。DocMDP の無い承認署名なら undefined を返す
 * （変更は署名を無効化しないが「署名後の変更あり」として表示される — 合法）。
 *
 * pdf-lib の getForm() は AcroForm が無いとき勝手に作る（文書を汚す）ため、
 * ここでは辞書を直接歩く。
 */
export function findDocMdpPermission(doc: PDFDocument): number | undefined {
  const acroForm = doc.catalog.lookup(PDFName.of('AcroForm'));
  if (!(acroForm instanceof PDFDict)) return undefined;
  const fields = acroForm.lookup(PDFName.of('Fields'));
  if (!(fields instanceof PDFArray)) return undefined;

  const visit = (fieldDict: PDFDict): number | undefined => {
    const v = fieldDict.lookup(PDFName.of('V'));
    if (v instanceof PDFDict) {
      const reference = v.lookup(PDFName.of('Reference'));
      if (reference instanceof PDFArray) {
        for (let i = 0; i < reference.size(); i++) {
          const sigRef = reference.lookup(i);
          if (!(sigRef instanceof PDFDict)) continue;
          const method = sigRef.lookup(PDFName.of('TransformMethod'));
          if (method instanceof PDFName && method.decodeText() === 'DocMDP') {
            const params = sigRef.lookup(PDFName.of('TransformParams'));
            if (params instanceof PDFDict) {
              const p = params.lookup(PDFName.of('P'));
              if (p instanceof PDFNumber) return p.asNumber();
            }
            return 2; // Table 257: P 省略時の既定値
          }
        }
      }
    }
    const kids = fieldDict.lookup(PDFName.of('Kids'));
    if (kids instanceof PDFArray) {
      for (let i = 0; i < kids.size(); i++) {
        const kid = kids.lookup(i);
        if (kid instanceof PDFDict) {
          const found = visit(kid);
          if (found !== undefined) return found;
        }
      }
    }
    return undefined;
  };

  for (let i = 0; i < fields.size(); i++) {
    const f = fields.lookup(i);
    if (f instanceof PDFDict) {
      const found = visit(f);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

/**
 * ページへの描画追記（透かし・ページ番号）で変更される既存オブジェクトを集める（B-7b''）。
 *
 * pdf-lib は load 時に /Contents を直接配列へ正規化し、そこへ新規ストリームを push する。
 * /Resources も直接辞書であることが多く、いずれもページ辞書自身の変更になる。
 * 間接参照で保持されている異形（/Contents が参照の配列、/Resources が参照）にも備え、
 * 見つかったものは併せて dirty にする（重複は呼び出し側の Map で除去される）。
 */
export function pageContentDirtyRefs(page: PDFPage): PDFRef[] {
  const refs: PDFRef[] = [page.ref];
  const contents = page.node.get(PDFName.of('Contents'));
  if (contents instanceof PDFRef) refs.push(contents);
  const resources = page.node.get(PDFName.of('Resources'));
  if (resources instanceof PDFRef) refs.push(resources);
  return refs;
}

/**
 * catalog 配下の名前ツリー（/Names /EmbeddedFiles）と /AF の変更で dirty になる
 * 既存オブジェクトを集める（B-7b''・attach_file 用）。
 * 各段が間接参照なら、その最深部までを対象にする。
 */
export function catalogNamesDirtyRefs(doc: PDFDocument): PDFRef[] {
  const refs: PDFRef[] = [];
  const root = doc.context.trailerInfo.Root;
  if (root instanceof PDFRef) refs.push(root); // /Names /AF の追加は catalog の変更

  const namesRaw = doc.catalog.get(PDFName.of('Names'));
  if (namesRaw instanceof PDFRef) {
    refs.push(namesRaw);
    const names = doc.catalog.lookup(PDFName.of('Names'));
    if (names instanceof PDFDict) {
      const efRaw = names.get(PDFName.of('EmbeddedFiles'));
      if (efRaw instanceof PDFRef) {
        refs.push(efRaw);
        const ef = names.lookup(PDFName.of('EmbeddedFiles'));
        if (ef instanceof PDFDict) {
          const arrRaw = ef.get(PDFName.of('Names'));
          if (arrRaw instanceof PDFRef) refs.push(arrRaw);
        }
      }
    }
  }
  const afRaw = doc.catalog.get(PDFName.of('AF'));
  if (afRaw instanceof PDFRef) refs.push(afRaw);
  return refs;
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
  /** 呼び出し側の結果に載せるべき注意事項 */
  warnings: string[];
}

/**
 * 有効な trailer 辞書を元バイト列から自前でパースする。
 *
 * §7.5.6:「追記する trailer は前 trailer の（Prev を除く）**全エントリ**を含まなければ
 * ならない」。pdf-lib の trailerInfo は Root / Encrypt / Info / ID しか保持しないため、
 * 稀なキー（hybrid の XRefStm、second-class name 等）を落とさないよう原文から読む。
 * パースできなくても致命ではない（標準エントリは trailerInfo から書ける）ので null を返す。
 */
function parsePreviousTrailer(
  doc: PDFDocument,
  original: Uint8Array,
  startxref: number,
  style: 'table' | 'stream',
  origin: number,
): PDFDict | null {
  try {
    // startxref は origin 相対なので、バイト列を切り出すときに原点を足す（§7.5.2）。
    //
    // ⚠️ この 1 行は条文的には正しいが、**効果を観測できていない**。origin を足さない
    // 版と出力を突き合わせた実測（origin > 0 × table / stream の 4 通り、稀な trailer
    // キーを注入した検体を含む）では、どのケースでも出力が同一だった。table 形式は
    // `trailer` キーワードを前方検索するので起点が小さすぎても届き、stream 形式で
    // 誤った辞書を拾っても、その中身は TRAILER_EXCLUDE で落ちるため。
    // **「直したが、それが効く場面を作れていない」**という状態で置いてある。
    const region = original.subarray(origin + startxref);
    const text = Buffer.from(region).toString('latin1');
    let dictStart: number;
    if (style === 'table') {
      const at = text.indexOf('trailer');
      if (at < 0) return null;
      dictStart = text.indexOf('<<', at);
    } else {
      // "N G obj" に続く相互参照ストリームの辞書部
      dictStart = text.indexOf('<<');
    }
    if (dictStart < 0) return null;
    const parser = PDFObjectParser.forBytes(region.subarray(dictStart), doc.context);
    const obj = parser.parseObject();
    if (obj instanceof PDFDict) return obj;
    // 相互参照ストリームでは parseObject が「辞書 + ストリーム」を返す
    // （v0.10.0 は PDFDict 検査で弾いてしまい、stream 形式で常に縮退していた —
    //  v0.11.0 の実機試用で発見・是正）
    if (obj instanceof PDFRawStream) return obj.dict;
    return null;
  } catch {
    return null;
  }
}

/**
 * 引き継がない trailer キー。
 * Prev / XRefStm は位置依存（§7.5.6 が Prev の除外を明示）。
 * Size / Root / Info / ID は本モジュールが明示的に書き直す。
 * Type / W / Index / Length / Filter / DecodeParms / DL は相互参照ストリームの
 * ストリーム固有キーであり、trailer エントリとして引き継ぐものではない。
 * Encrypt は暗号化 PDF 自体を上流で拒否している。
 */
const TRAILER_EXCLUDE = new Set([
  'Prev',
  'XRefStm',
  'Size',
  'Root',
  'Info',
  'ID',
  'Encrypt',
  'Type',
  'W',
  'Index',
  'Length',
  'Filter',
  'DecodeParms',
  'DL',
]);

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
 * ファイル ID の更新（ISO 32000-2 §14.4）。
 * 第 1 要素は永続識別子として**変えず**、第 2 要素は「更新時点の内容に基づく
 * 変化する識別子」で**なければならない**（shall）。追記内容のハッシュから導出するため、
 * SOURCE_DATE_EPOCH 下でも決定論的（同一入力 → 同一 ID）に保たれる。
 */
function updateFileId(
  context: PDFContext,
  id: PDFObject | undefined,
  original: Uint8Array,
  appendedSoFar: Uint8Array[],
): PDFArray | undefined {
  if (!(id instanceof PDFArray) || id.size() < 1) return undefined;
  const hash = createHash('md5'); // §14.4 が例示するダイジェスト（暗号用途ではない）
  hash.update(original);
  for (const c of appendedSoFar) hash.update(c);
  const updated = context.obj([]) as PDFArray;
  updated.push(id.get(0)); // 第 1 要素は永続
  updated.push(PDFHexString.of(hash.digest('hex').toUpperCase()));
  return updated;
}

/**
 * 増分更新を構築して「元バイト列 + 追記部」を返す。
 * 戻り値の先頭 original.length バイトは入力と同一であることが保証される。
 */
export async function buildIncrementalUpdate(
  opts: IncrementalUpdateOptions,
): Promise<IncrementalUpdateResult> {
  const { original, doc, sinceObjectNumber } = opts;
  const context = doc.context;

  const { origin, startxref: prevStartXref, style } = await readPreviousSection(original);

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
  // §7.5.2: オフセットの原点は %PDF- の PERCENT SIGN。ヘッダ前にバイトがあるファイル
  // では絶対位置と origin 相対位置がずれる（B-22 の欠陥はここだった）。
  let cursor = original.length - origin;
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
  // 注: §7.5.6 は「前 trailer の全エントリ（Prev 以外）を引き継ぐ」ことを要求するが、
  // pdf-lib の trailerInfo が保持するのは Root / Encrypt / Info / ID のみ。
  // 稀な追加キー（hybrid の XRefStm、second-class name）は落ちる — B-7b の課題として記録済み。
  const ti = context.trailerInfo;
  if (!(ti.Root instanceof PDFRef)) {
    throw new PdfWriterError(
      'The document trailer has no /Root reference — cannot build an incremental update.',
      'INVALID_PDF',
    );
  }
  // §14.4: ID 第 2 要素は更新のたびに変えなければならない（shall）
  const updatedId = updateFileId(context, ti.ID, original, chunks);

  // §7.5.6: 前 trailer の全エントリ（除外リスト以外）を引き継ぐ
  const warnings: string[] = [];
  const prevTrailer = parsePreviousTrailer(doc, original, prevStartXref, style, origin);
  const carryOver: Array<[PDFName, PDFObject]> = [];
  if (prevTrailer) {
    for (const [key, value] of prevTrailer.entries()) {
      if (!TRAILER_EXCLUDE.has(key.decodeText())) carryOver.push([key, value]);
    }
  } else {
    warnings.push(
      'The previous trailer could not be parsed; only the standard entries ' +
        '(Size/Prev/Root/Info/ID) were carried into the incremental update (ISO 32000-2 §7.5.6).',
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
    for (const [key, value] of carryOver) trailer.set(key, value);
    trailer.set(PDFName.of('Size'), PDFNumber.of(context.largestObjectNumber + 1));
    trailer.set(PDFName.of('Prev'), PDFNumber.of(prevStartXref));
    trailer.set(PDFName.of('Root'), ti.Root);
    if (ti.Info instanceof PDFRef) trailer.set(PDFName.of('Info'), ti.Info);
    if (updatedId) trailer.set(PDFName.of('ID'), updatedId);

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
    for (const [key, value] of carryOver) dict.set(key, value);
    dict.set(PDFName.of('Type'), PDFName.of('XRef'));
    dict.set(PDFName.of('Size'), PDFNumber.of(xrefNum + 1));
    dict.set(PDFName.of('W'), context.obj([1, 4, 2]) as PDFArray);
    dict.set(PDFName.of('Index'), context.obj(index) as PDFArray);
    dict.set(PDFName.of('Length'), PDFNumber.of(data.length));
    dict.set(PDFName.of('Prev'), PDFNumber.of(prevStartXref));
    dict.set(PDFName.of('Root'), ti.Root);
    if (ti.Info instanceof PDFRef) dict.set(PDFName.of('Info'), ti.Info);
    if (updatedId) dict.set(PDFName.of('ID'), updatedId);

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

  return { bytes: out, objectsWritten: sorted.length, xrefStyle: style, warnings };
}
