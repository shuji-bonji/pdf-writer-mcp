/**
 * 直前の相互参照セクションの位置と形式を読む —— Phase 3 の L4′.3。
 *
 * `incremental.ts`（pdf-lib 版の増分更新）から、**pdf-lib に依らない部分だけ**を
 * 取り出したもの。増分更新そのものは normativepdf の `appendUpdate` に移った
 * （`incremental-append.ts`）が、「どこにどの形式のセクションがあるか」を答える
 * この部分は writer の関心として残る。
 *
 * セクションの**解析**は normativepdf に委ねる（原点相対のオフセット・古典テーブルと
 * 相互参照ストリームの両方・trailer の構造化）。**位置の特定**はここが持つ ——
 * 同じ切り分けを pdf-verify-mcp の revision-diff でも採っている。
 */

import { dictGet, readXrefSectionAt } from 'normativepdf';
import { PdfWriterError } from '../errors.js';

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
