/**
 * 編集パスの入口 — Phase 3（pdf-lib 撤去）の L4′.1。
 *
 * `editor.ts` の `loadForEdit` に対応する。**分けたのは、返す器が違うから**である ——
 * `loadForEdit` は pdf-lib の `PDFDocument` を返し、これは normativepdf の
 * `PdfDocumentEditor` を返す。移行のあいだは 2 本を並べ、サービスを 1 つずつ
 * こちらへ寄せる。両方が無くなるのは L4′.7（`pdf-lib` を dependencies から外すとき）。
 *
 * **旧入口には無く、ここにあるもの:**
 *
 * 1. **暗号化の拒否。** 旧入口は pdf-lib が投げる例外の文言を `/encrypt/i` で見ていた
 *    （`editor.ts`）。normativepdf は `/Encrypt` があっても**オブジェクトストリームを
 *    読むときにしか**断らないので、古典 xref の暗号化文書は素通りする（実測: コーパスの
 *    暗号化 4 本のうち 2 本が `open` も `save` も通った）。ここで trailer を見て断る。
 * 2. **回復読み。** `/Prev` の鎖が切れている文書は、最新の節しか xref に載らない
 *    （§7.5.6:「増分更新の相互参照節は変更・置換・削除されたオブジェクトの項目だけを含む」）。
 *    その結果ページツリーに届かず、`pages()` が**例外を投げずに 0 件を返す**。
 *    ファイル全体から `startxref` を拾って節を重ね、届く形にしてから返す。
 *
 * **回復は仕様ではない。** ISO 32000-2 に「壊れた相互参照表を走査で回復せよ」という条文は
 * 無い（`damaged` / `reconstruct` を引いても該当が無い）。だから回復は writer の方針であり、
 * normativepdf には持ち込まない（handoff §6）。ライブラリ側は `PdfDocument` の構築子と
 * `readXrefSectionAt` と `PdfDocumentEditor.of` を公開しているので、部品は揃っている。
 *
 * 🔴 **重ね方は推量である。** §7.5.6 が言う「最新のコピー」は**鎖の順**であって
 * バイト位置の順ではない。鎖が切れている文書ではその順が読めないので、
 * ここでは「オフセットの昇順 = 古い順」と見なしている。推量であることは 2 つの形で表す:
 *
 * - 返り値の `xref.kind` が `'recovered'` になり、拾えた節と拾えなかった節を名前で持つ
 * - `chainStop` を**そのまま引き継ぐ**ので、`PdfDocumentEditor.save()`（全書き直し）は
 *   引き続き `TruncatedHistoryError` で断る。**推量を出力に焼き付けない**ためで、
 *   回復した文書に書けるのは増分更新（元のバイト列を残す）だけである
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  dictGet,
  PdfDocument,
  PdfDocumentEditor,
  readXrefSectionAt,
  type XrefEntry,
} from 'normativepdf';
import { LIMITS } from '../constants.js';
import { NEXT_ACTIONS, PdfWriterError } from '../errors.js';
import type { CommonEditOptions } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { containsSignature } from './signature-scan.js';

const CTX = 'EditOpen';

/** 回復読みで拾えた節 1 つ */
export interface RecoveredSection {
  /** ファイル先頭からのバイト位置（`origin` を足した絶対位置） */
  readonly offset: number;
  /** その節が載せていた項目数 */
  readonly entries: number;
}

/** 回復読みで拾えなかった節 1 つ */
export interface UnreadableSection {
  readonly offset: number;
  readonly reason: string;
}

/**
 * xref をどう組んだか。
 *
 * `'chain'` = 文書が `/Prev` で繋いだ順に歩き切れた（normativepdf が組んだもの）。
 * `'recovered'` = 鎖が切れていたので `startxref` を走査して重ねた **推量**。
 */
export type XrefSource =
  | { readonly kind: 'chain' }
  | {
      readonly kind: 'recovered';
      /** 鎖が止まった理由（`prev-zero` / `unreadable` / `cyclic` / `malformed`） */
      readonly stop: string;
      /** 重ねた節（オフセット昇順 = 古い順と**見なした**順） */
      readonly sections: readonly RecoveredSection[];
      /** 読めなかった節 */
      readonly unreadable: readonly UnreadableSection[];
      /** 鎖だけで届いた項目数 → 重ねたあとの項目数 */
      readonly entriesBefore: number;
      readonly entriesAfter: number;
    };

/**
 * 入力が使っていた相互参照の形。**書き戻すときはこれに合わせる。**
 *
 * 全書き直しは中身を変えない操作なので、**構造の形も変えない**のが既定であるべきである。
 * 相互参照ストリーム（§7.5.8）の文書を古典テーブル（§7.5.4）で書き戻すのは条文には
 * 反しないが、`/Type /XRef` を期待する読み手と、圧縮オブジェクトを使えるという
 * 性質を黙って落とす。実測でも、旧実装（pdf-lib）との差はここだけで
 * **オブジェクト数が 2 減る**（ObjStm 1 + XRef 1）形で出た。
 */
export interface SourceForm {
  /** 最新の節が `/Type /XRef` を持っていたか（§7.5.8.1） */
  readonly xref: 'table' | 'stream';
  /** 圧縮オブジェクト（§7.5.7）が 1 つでもあったか */
  readonly objectStreams: boolean;
}

export interface OpenedForEdit {
  readonly editor: PdfDocumentEditor;
  readonly absPath: string;
  readonly bytes: Uint8Array;
  readonly xref: XrefSource;
  /** 入力が使っていた形。`saveOpened` の既定になる */
  readonly form: SourceForm;
}

/** 入力が使っていた相互参照の形を読み取る */
function readSourceForm(base: PdfDocument): SourceForm {
  // 相互参照ストリームの文書では、`base.trailer` はそのストリームの辞書そのもの
  const type = dictGet(base.trailer, 'Type');
  let objectStreams = false;
  for (const entry of base.xref.values()) {
    if (entry.type === 'compressed') {
      objectStreams = true;
      break;
    }
  }
  return {
    xref: type?.kind === 'name' && type.value === 'XRef' ? 'stream' : 'table',
    objectStreams,
  };
}

/** `startxref` が指している位置を、ファイル全体から拾う（重複は畳む） */
function scanStartxrefOffsets(bytes: Uint8Array): number[] {
  // latin1 で文字列にするのはバイト長を保つため（UTF-8 だと位置がずれる）
  const text = Buffer.from(bytes).toString('latin1');
  const found = new Set<number>();
  for (const m of text.matchAll(/startxref\s+(\d+)/g)) {
    const value = Number(m[1]);
    if (Number.isSafeInteger(value) && value > 0) found.add(value);
  }
  return [...found].sort((a, b) => a - b);
}

/**
 * 鎖が切れている文書の xref を組み直す。
 *
 * 重ねる順は「オフセットの昇順」だが、**最後に鎖で歩けた分を上から置く** ——
 * 鎖で届いた項目は「最新である」と文書自身が言っているもので、
 * 走査で拾った節はその隙間を埋めるだけにする。
 */
async function recoverXref(
  base: PdfDocument,
  bytes: Uint8Array,
): Promise<{
  merged: Map<number, XrefEntry>;
  sections: RecoveredSection[];
  unreadable: UnreadableSection[];
}> {
  const merged = new Map<number, XrefEntry>();
  const sections: RecoveredSection[] = [];
  const unreadable: UnreadableSection[] = [];

  for (const offset of scanStartxrefOffsets(bytes)) {
    try {
      const section = await readXrefSectionAt(bytes, offset, base.origin);
      sections.push({ offset, entries: section.entries.size });
      for (const [num, entry] of section.entries) merged.set(num, entry);
    } catch (error) {
      unreadable.push({ offset, reason: error instanceof Error ? error.message : String(error) });
    }
  }

  // 鎖で歩けた分が勝つ
  for (const [num, entry] of base.xref) merged.set(num, entry);

  return { merged, sections, unreadable };
}

/**
 * 編集のために PDF を開く。署名ガード・サイズ上限・暗号化ガードを通し、
 * 鎖が切れていれば回復読みをしてから返す。
 */
export async function openForEdit(
  filePath: string,
  opts: CommonEditOptions & { preserveSignatures?: boolean },
): Promise<OpenedForEdit> {
  const absPath = resolve(filePath);
  let bytes: Uint8Array;
  try {
    bytes = await readFile(absPath);
  } catch {
    throw new PdfWriterError(`Cannot read PDF file: ${absPath}`, 'DOC_NOT_FOUND', {
      next_actions: [NEXT_ACTIONS.checkFilePath(absPath)],
    });
  }

  if (bytes.byteLength > LIMITS.INPUT_PDF_MAX_BYTES) {
    throw new PdfWriterError(
      `"${absPath}" is too large (${Math.round(bytes.byteLength / 1024 / 1024)}MB, ` +
        `max ${LIMITS.INPUT_PDF_MAX_BYTES / 1024 / 1024}MB)`,
      'FILE_TOO_LARGE',
    );
  }

  if (containsSignature(bytes) && !opts.allowBreakingSignatures && !opts.preserveSignatures) {
    throw new PdfWriterError(
      `"${absPath}" appears to be digitally signed (/ByteRange found). ` +
        'Rewriting the whole file will invalidate existing signatures.',
      'SIGNED_PDF',
      {
        retryable: true,
        next_actions: [NEXT_ACTIONS.preserveSignatures(), NEXT_ACTIONS.allowBreakingSignatures()],
      },
    );
  }

  let editor: PdfDocumentEditor;
  try {
    editor = await PdfDocumentEditor.open(bytes);
  } catch (e) {
    const cause = e instanceof Error ? e.message : String(e);
    // normativepdf はオブジェクトストリームを読む段でだけ暗号化を名指しする
    const encrypted = /encrypt/i.test(cause);
    throw new PdfWriterError(
      `Failed to parse PDF "${absPath}" (${encrypted ? 'encrypted' : 'corrupted?'}): ${cause}`,
      encrypted ? 'ENCRYPTED_PDF' : 'INVALID_PDF',
      encrypted
        ? { hint: 'Decrypt the PDF first — pdf-writer-mcp cannot edit encrypted files.' }
        : {},
    );
  }

  // 🔴 暗号化は「読めたかどうか」では決まらない。§7.5.5 Table 15 の /Encrypt が
  // あれば、ストリームは暗号文のままなので、書き戻すと中身が壊れる
  if (dictGet(editor.base.trailer, 'Encrypt') !== undefined) {
    throw new PdfWriterError(
      `"${absPath}" is encrypted (trailer /Encrypt is present; ISO 32000-2 §7.5.5 Table 15). ` +
        'Its streams are ciphertext and cannot be edited.',
      'ENCRYPTED_PDF',
      { hint: 'Decrypt the PDF first — pdf-writer-mcp cannot edit encrypted files.' },
    );
  }

  const form = readSourceForm(editor.base);
  const stop = editor.base.chainStop;
  if (stop.kind === 'complete') {
    return { editor, absPath, bytes, xref: { kind: 'chain' }, form };
  }

  // --- 回復読み ---
  const entriesBefore = editor.base.xref.size;
  const { merged, sections, unreadable } = await recoverXref(editor.base, bytes);
  const recoveredBase = new PdfDocument(
    bytes,
    editor.base.origin,
    editor.base.headerVersion,
    editor.base.version,
    editor.base.trailer,
    merged,
    stop, // 引き継ぐ = save() は引き続き断る
  );
  const recovered = PdfDocumentEditor.of(recoveredBase);

  const tree = await recovered.pageTree();
  if (!tree.reached) {
    throw new PdfWriterError(
      `"${absPath}" has a broken /Prev chain (${stop.kind}) and its page tree could not be reached ` +
        `even after scanning ${sections.length} cross-reference section(s).`,
      'INVALID_PDF',
      {
        hint: 'The file is missing the revisions that define its page tree; there is nothing to edit.',
      },
    );
  }

  logger.info(
    CTX,
    `Recovered a broken /Prev chain (${stop.kind}) in ${absPath}: ` +
      `${sections.length} section(s) scanned, ${unreadable.length} unreadable, ` +
      `xref ${entriesBefore} -> ${merged.size} entries, ${tree.pages.length} page(s) reached`,
  );

  return {
    editor: recovered,
    absPath,
    bytes,
    form,
    xref: {
      kind: 'recovered',
      stop: stop.kind,
      sections,
      unreadable,
      entriesBefore,
      entriesAfter: merged.size,
    },
  };
}
