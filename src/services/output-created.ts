/**
 * 生成パスの出口 — Phase 3（pdf-lib 撤去）の L3'。
 *
 * `output.ts` の `finalizePdf` に対応する。**分けたのは、入口が違うから**である ——
 * `saveEdited` は読み込んだ文書の既存メタデータを尊重して `ModDate` だけ更新するのに対し、
 * こちらは何も無いところから Info を組む。同じ関数に両方を通すと、
 * 「既存を尊重するか上書きするか」の分岐が全エントリに散る。
 *
 * **旧実装から消えたもの:**
 * - `patchHeaderVersion`。pdf-lib は保存時に `%PDF-1.7` を決め打ちで書くので、
 *   2.0 を名乗らせるにはバイト列を後から書き換えるしかなく、
 *   「長さが同じでなければ xref の全オフセットがずれる」という制約付きだった。
 *   `PdfDocumentEditor.create({ version })` はヘッダを最初から書く
 * - `normalizeEmbeddedFonts`。pdf-lib が書いた辞書を後から是正するものだった（B-14）。
 *   `buildType0Font` はバイト列から辞書の型を導くので、**是正すべき誤りが作れない**
 */

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { CosObject } from 'normativepdf';
import { documentDate, PACKAGE_INFO } from '../config.js';
import type { CommonCreateOptions, CreateResult } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { arr, dict, hex, name, stream, textString } from './cos.js';
import { pdfDate } from './pdf-date.js';
import { DEFAULT_PDF_VERSION } from './pdf-version.js';
import type { WriterDocument } from './writer-doc.js';
import { buildXmpPacket } from './xmp-build.js';

/**
 * `/ID`（§14.4 Table 15）。
 *
 * §14.4 は「ファイルサイズとパス名を混ぜよ」と *should* で言うが、どちらも使えない ——
 * サイズは save 前に確定せず、パス名を混ぜると**同じ内容を別のパスに書くだけで
 * バイト列が変わる**。同じ NOTE が「計算は再現可能である必要はない」と明言しており、
 * 再現可能にすることは禁じていないので、E-6（`SOURCE_DATE_EPOCH`）を優先して
 * **文書の時刻と Info の中身**から決める。旧実装（`ensureFileIdentifier`）と同じ方針。
 *
 * 新規作成なので第 1 要素（permanent）と第 2 要素は同値にする（R-14.4-11）。
 */
function fileIdentifier(when: Date, info: ReadonlyMap<string, string>): ReturnType<typeof hex> {
  const digest = createHash('md5');
  digest.update(when.toISOString());
  for (const [key, value] of info) {
    digest.update(key);
    digest.update(value);
  }
  const bytes = new Uint8Array(Buffer.from(digest.digest('hex').toUpperCase(), 'latin1'));
  return hex(bytes);
}

export interface FinalizeCreatedOptions {
  /** 表示用フォント名（`CreateResult.font` に返る） */
  readonly fontName: string;
  /** タグ付き生成なら PDF/UA-1 を名乗るための言語。未指定なら宣言しない */
  readonly uaLang?: string;
}

/**
 * Info・XMP・`/ID` を書いて保存する。
 *
 * 順序に意味がある（旧実装から引き継いだ B-16 の順序）:
 * ① メタデータの置き場所を XMP に移す → ② Info を版に応じて削る → ③ `/ID` を作る。
 * ③ が最後なのは、**消えるキーを混ぜて digest を取らない**ため。
 */
export async function finalizeCreated(
  doc: WriterDocument,
  opts: CommonCreateOptions,
  extra: FinalizeCreatedOptions,
): Promise<CreateResult> {
  const version = opts.pdfVersion ?? DEFAULT_PDF_VERSION;
  const producer = `${PACKAGE_INFO.name}/${PACKAGE_INFO.version}`;
  const now = documentDate(doc);

  // --- Info（Table 349）。PDF 2.0 では §14.3.3 が document level metadata を
  // Info で表すことを非推奨にしているので、日付 2 つだけ残す
  const info = new Map<string, string>();
  if (version !== '2.0') {
    if (opts.title !== undefined) info.set('Title', opts.title);
    if (opts.author !== undefined) info.set('Author', opts.author);
    info.set('Producer', producer);
  }
  info.set('CreationDate', pdfDate(now));
  info.set('ModDate', pdfDate(now));

  const infoRef = doc.allocate(dict([...info].map(([k, v]) => [k, textString(v)] as const)));

  // --- XMP。2.0 では Info を削るので**先に書く**（書かずに削ると題名がどこにも残らない）。
  // タグ付き（PDF/UA-1）の宣言は uaLang があるときだけ載せる
  const needsXmp = version === '2.0' || extra.uaLang !== undefined;
  if (needsXmp) {
    // ⚠️ **producer は 2.0 のときだけ XMP に載せる。**
    // 旧実装は 2 つの経路を持っており、渡すものが違った:
    //   applyPdfuaCatalog（タグ付き 1.7）→ title / author / pdfuaPart / lang（producer 無し）
    //   finalizePdf の 2.0 分岐         → title / author / producer / lang
    // 1.7 では Producer は Info に載るので、XMP にも入れると置き場所が 2 つになる。
    // 版に関係なく渡していたら、差分オラクルが XMP の要素の並び（shape）で捕まえた。
    const packet = buildXmpPacket({
      now,
      ...(opts.title !== undefined ? { title: opts.title } : {}),
      ...(opts.author !== undefined ? { author: opts.author } : {}),
      ...(version === '2.0' ? { producer } : {}),
      ...(extra.uaLang !== undefined ? { pdfuaPart: 1, lang: extra.uaLang } : {}),
    });
    const bytes = new TextEncoder().encode(packet);
    const metadata = doc.allocate(
      stream(
        [
          ['Type', name('Metadata')],
          ['Subtype', name('XML')],
        ],
        bytes,
      ),
    );
    await doc.updateCatalog([['Metadata', metadata]]);
  }

  // 🔴 /ID は 2.0 のときだけ書く。Table 15 は PDF 2.0 で Required としているが、
  // **1.7 では `/Encrypt` があるときだけ Required** である。旧実装も
  // `ensureFileIdentifier` を 2.0 の分岐でしか呼んでいなかった。版に関係なく書くと
  // 「1.7 では付けない」という既存の挙動が変わり、`ensure_pdfa` が
  // 「trailer /ID を足した」と報告できなくなる（それが後段の適合宣言の根拠になっている）。
  const trailer: [string, CosObject][] = [['Info', infoRef]];
  if (version === '2.0') {
    const id = fileIdentifier(now, info);
    // 新規作成なので permanent と changing は同値（R-14.4-11）
    trailer.push(['ID', arr([id, id])]);
  }

  const bytes = await doc.save({ trailer });

  const result: CreateResult = {
    pageCount: doc.pages.length,
    bytes: bytes.length,
    font: extra.fontName,
  };

  if (opts.outputPath) {
    const abs = resolve(opts.outputPath);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, bytes);
    result.path = abs;
    logger.info('Output', `Saved PDF: ${abs} (${bytes.length} bytes, ${result.pageCount} pages)`);
  }

  if (opts.returnBase64 || !opts.outputPath) {
    result.base64 = Buffer.from(bytes).toString('base64');
  }

  return result;
}
