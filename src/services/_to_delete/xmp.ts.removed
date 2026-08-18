/**
 * XMP metadata
 * pdf-lib は XMP を書く API を持たないため、パケットを自前で組み立てて
 * catalog の /Metadata に流し込む。
 *
 * PDF/UA-1 は次を要求する:
 *   - 5      : pdfuaid:part = 1 の宣言
 *   - 7.1(8) : 文書タイトル（dc:title）と ViewerPreferences /DisplayDocTitle = true
 *   - 7.1(8) : /Metadata の /Type が /Metadata、/Subtype が /XML であること
 */

import {
  decodePDFRawStream,
  PDFDict,
  type PDFDocument,
  PDFName,
  PDFRawStream,
  PDFRef,
  PDFString,
} from 'pdf-lib';
import { documentDate, outputDate, PACKAGE_INFO } from '../config.js';

export interface XmpOptions {
  title?: string;
  author?: string;
  /** dc:description（Info の Subject に対応） */
  subject?: string;
  /** pdf:Keywords（Info の Keywords に対応。空白区切りの 1 文字列） */
  keywords?: string;
  /**
   * pdf:Producer（Info の Producer に対応。Table 349 NOTE 6）。
   *
   * PDF 2.0 出力（B-16）では Info /Producer が非推奨になるため、**この経路が
   * 「PDF を書いた道具」の唯一の記録場所になる**。1.7 出力では Info 側が持つので省略される。
   */
  producer?: string;
  /** PDF/UA 宣言を含める場合の part（1 | 2） */
  pdfuaPart?: number;
  /**
   * PDF/A 宣言を含める場合の part（B-8 では 3）。
   * `pdfaConformance` と対で使う（PDF/A-1〜3 は conformance level を持つ）。
   */
  pdfaPart?: number;
  /**
   * PDF/A の conformance level（`'A'` | `'B'` | `'U'`）。B-8 のターゲットは `'B'`。
   * **PDF/A-4 は conformance level を持たない**ので、-4 では**渡さない**（B-20）。
   */
  pdfaConformance?: string;
  /**
   * `pdfaid:rev` — PDF/A-4 が conformance level の代わりに使う版の年（例 `2020`）。
   * -1〜-3 では使わない。
   */
  pdfaRev?: number;
  /** dc:language */
  lang?: string;
  /**
   * xmp:CreateDate（ISO 8601）。更新時に元の作成日時を保持するために使う。省略時は現在時刻。
   *
   * **既存 PDF を読む経路では省略しないこと**（W-6）: `declarePdfa` / `ensure_tagged` は
   * `infoCreationDateIso()` で Info /CreationDate から補い、`syncXmpWithInfo` は
   * 既存 XMP → Info の順で解決する。**新規作成経路（`applyPdfuaCatalog`）は省略が正しい** —
   * そこで Info を読むと pdf-lib が `create()` 時に自動で入れた実時刻を拾ってしまい、
   * W-5 の documentDate（SOURCE_DATE_EPOCH の決定論を含む）を壊す。
   */
  createDate?: string;
  /**
   * この文書に焼き込む「現在時刻」（W-5）。Info 辞書側と**同一の `Date` を渡すこと**。
   * 省略時は `outputDate()` を独自に呼ぶが、その場合 Info 側と秒境界を跨ぐと
   * R-14.3.4-2/-5 の「fully equivalent」を破りうる。`setXmpMetadata` /
   * `syncXmpWithInfo` は `documentDate(doc)` を渡すので通常は意識しなくてよい。
   */
  now?: Date;
}

/**
 * W-6: Info /CreationDate を xmp:CreateDate 用の ISO 8601 に変換する。
 *
 * XMP を新設・再構築するとき、作成日時の引き継ぎ元が既存 XMP に無くても
 * **Info 辞書には残っている**ことがある（`ensure_pdfa` を既存 PDF に掛ける経路が典型）。
 * ここを見ずに現在時刻へフォールバックすると、Info /CreationDate ≠ xmp:CreateDate の
 * 不等価な文書を自分で作ることになり、R-14.3.4-4「両者が fully equivalent である限り
 * 他方へ追記してよい」の条件に反する（§14.3.4。発見経緯 = 制約テーブル PoC CT-META-4）。
 *
 * 変換は pdf-lib の `getCreationDate()`（タイムゾーン換算・§7.9.4 の既定値規則を実装済み）に
 * 委譲し、UTC の ISO 8601 で返す。等価性は「同一時点」であり表記の一致ではない。
 * 不正な日付文字列は undefined（壊れた値を XMP へ複製しない — その場合は now に落ちる）。
 */
export function infoCreationDateIso(doc: PDFDocument): string | undefined {
  try {
    const date = doc.getCreationDate();
    if (!date || Number.isNaN(date.getTime())) return undefined;
    return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
  } catch {
    return undefined;
  }
}

/** XML の特殊文字をエスケープする（タイトル等に < & " が入りうる） */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * PDF/UA Identification 拡張スキーマ記述（ISO 14289-1 §5 / veraPDF 5-1）。
 * pdfuaid 名前空間は XMP 標準スキーマではないので、使うなら pdfaExtension で
 * 「どんなプロパティを持つスキーマか」を自己記述する必要がある。
 */
const PDFUA_EXTENSION_SCHEMA = `    <rdf:Description rdf:about=""
      xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/"
      xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#"
      xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#">
      <pdfaExtension:schemas>
        <rdf:Bag>
          <rdf:li rdf:parseType="Resource">
            <pdfaSchema:schema>PDF/UA Universal Accessibility Schema</pdfaSchema:schema>
            <pdfaSchema:namespaceURI>http://www.aiim.org/pdfua/ns/id/</pdfaSchema:namespaceURI>
            <pdfaSchema:prefix>pdfuaid</pdfaSchema:prefix>
            <pdfaSchema:property>
              <rdf:Seq>
                <rdf:li rdf:parseType="Resource">
                  <pdfaProperty:name>part</pdfaProperty:name>
                  <pdfaProperty:valueType>Integer</pdfaProperty:valueType>
                  <pdfaProperty:category>internal</pdfaProperty:category>
                  <pdfaProperty:description>Indicates, which part of ISO 14289 standard is followed</pdfaProperty:description>
                </rdf:li>
              </rdf:Seq>
            </pdfaSchema:property>
          </rdf:li>
        </rdf:Bag>
      </pdfaExtension:schemas>
    </rdf:Description>`;

export function buildXmpPacket(opts: XmpOptions): string {
  // W-5: 呼び出し側が渡した Date（= Info 辞書に書くのと同じ瞬間）を使う。
  // SOURCE_DATE_EPOCH（E-6）設定時はどちらの経路でも同じ固定時刻になる
  const now = (opts.now ?? outputDate()).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const parts: string[] = [];

  // B-8: PDF/A Identification（veraPDF `6.6.4-1`「The PDF/A version and conformance level of a
  // file shall be specified using the PDF/A Identification extension schema」）。
  // pdfuaid と違って pdfaExtension での自己記述は要らない — pdfaid は PDF/A 自身が定義する
  // 既知のスキーマであり、拡張スキーマ記述が必要なのは「PDF/A から見て未知の名前空間」の側だから
  if (opts.pdfaPart !== undefined) {
    const conformance =
      opts.pdfaConformance !== undefined
        ? `      <pdfaid:conformance>${escapeXml(opts.pdfaConformance)}</pdfaid:conformance>\n`
        : '';
    // PDF/A-4 は conformance level を持たず、代わりに rev（版の年）を名乗る
    const rev =
      opts.pdfaRev !== undefined ? `      <pdfaid:rev>${opts.pdfaRev}</pdfaid:rev>\n` : '';
    parts.push(
      `    <rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">\n` +
        `      <pdfaid:part>${opts.pdfaPart}</pdfaid:part>\n` +
        conformance +
        rev +
        `    </rdf:Description>`,
    );
  }

  if (opts.pdfuaPart !== undefined) {
    parts.push(
      `    <rdf:Description rdf:about="" xmlns:pdfuaid="http://www.aiim.org/pdfua/ns/id/">\n` +
        `      <pdfuaid:part>${opts.pdfuaPart}</pdfuaid:part>\n` +
        `    </rdf:Description>`,
    );
    // ISO 14289-1 5-1: pdfuaid は XMP の定義済みスキーマではないため、
    // PDF/A 拡張スキーマ記述（pdfaExtension）で宣言しないと準拠と認められない
    parts.push(PDFUA_EXTENSION_SCHEMA);
  }

  const dc: string[] = [];
  if (opts.title) {
    // xml:lang は必須ではないが、付けると読み上げ言語が確定する
    const langAttr = opts.lang ? ` xml:lang="${escapeXml(opts.lang)}"` : ' xml:lang="x-default"';
    dc.push(
      `      <dc:title>\n        <rdf:Alt>\n          <rdf:li${langAttr}>${escapeXml(opts.title)}</rdf:li>\n        </rdf:Alt>\n      </dc:title>`,
    );
  }
  if (opts.author) {
    dc.push(
      `      <dc:creator>\n        <rdf:Seq>\n          <rdf:li>${escapeXml(opts.author)}</rdf:li>\n        </rdf:Seq>\n      </dc:creator>`,
    );
  }
  if (opts.subject) {
    dc.push(
      `      <dc:description>\n        <rdf:Alt>\n          <rdf:li xml:lang="x-default">${escapeXml(opts.subject)}</rdf:li>\n        </rdf:Alt>\n      </dc:description>`,
    );
  }
  if (opts.lang) {
    dc.push(
      `      <dc:language>\n        <rdf:Bag>\n          <rdf:li>${escapeXml(opts.lang)}</rdf:li>\n        </rdf:Bag>\n      </dc:language>`,
    );
  }
  if (dc.length > 0) {
    parts.push(
      `    <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">\n${dc.join('\n')}\n    </rdf:Description>`,
    );
  }

  // pdf: 名前空間は Keywords と Producer を共有する。片方だけでも出す
  const pdfNs: string[] = [];
  if (opts.keywords) {
    pdfNs.push(`      <pdf:Keywords>${escapeXml(opts.keywords)}</pdf:Keywords>`);
  }
  if (opts.producer) {
    pdfNs.push(`      <pdf:Producer>${escapeXml(opts.producer)}</pdf:Producer>`);
  }
  if (pdfNs.length > 0) {
    parts.push(
      `    <rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">\n${pdfNs.join('\n')}\n    </rdf:Description>`,
    );
  }

  parts.push(
    `    <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/">\n` +
      `      <xmp:CreatorTool>${escapeXml(`${PACKAGE_INFO.name}/${PACKAGE_INFO.version}`)}</xmp:CreatorTool>\n` +
      `      <xmp:CreateDate>${escapeXml(opts.createDate ?? now)}</xmp:CreateDate>\n` +
      `      <xmp:ModifyDate>${now}</xmp:ModifyDate>\n` +
      `    </rdf:Description>`,
  );

  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="${escapeXml(PACKAGE_INFO.name)}">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
${parts.join('\n')}
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

/**
 * XMP パケットを doc の catalog に /Metadata として設定する（既存は置換）。
 *
 * XMP は UTF-8。`context.stream(string)` は 1 文字 = 1 バイトとして書くため
 * 日本語が壊れる（実測: 「検証」→ 化け）。UTF-8 バイト列に変換してから渡す。
 * また PDF/UA の XMP は暗号化・圧縮しない慣行に従い、フィルタを掛けない。
 */
export function setXmpMetadata(doc: PDFDocument, opts: XmpOptions): void {
  // W-6 の backfill をここに置いてはいけない: 新規作成経路（applyPdfuaCatalog）では
  // pdf-lib が create() 時に入れた実時刻の Info /CreationDate を拾ってしまい、
  // SOURCE_DATE_EPOCH（E-6）の決定論と W-5 の documentDate 一貫性を壊す（ホストの
  // E-6 テストで実際に落ちた）。既存 PDF を読む呼び出し側が createDate を明示する。
  const packet = buildXmpPacket({ now: documentDate(doc), ...opts });
  const bytes = new TextEncoder().encode(packet);
  const stream = PDFRawStream.of(
    doc.context.obj({
      Type: 'Metadata',
      Subtype: 'XML',
      Length: bytes.length,
    }) as PDFDict,
    bytes,
  );
  doc.catalog.set(PDFName.of('Metadata'), doc.context.register(stream));
}

export interface XmpSyncResult {
  /** XMP を更新したか（/Metadata が無ければ false） */
  updated: boolean;
  /** 同一 ref に差し替えた場合の参照（増分更新の dirty 追跡用） */
  ref?: PDFRef;
  /** catalog 自体を書き換えたか（/Metadata が直接オブジェクトだった場合） */
  catalogTouched: boolean;
  warnings: string[];
}

/**
 * B-9（SPEC-AUDIT Phase 1）: Info 辞書と XMP（/Metadata）の同期。
 *
 * §14.3.3 は Info を PDF 2.0 で非推奨とし、XMP を持つ文書では両者の不整合が
 * dc:title 等の食い違い（スクリーンリーダ・アーカイブ検証の誤り）を生む。
 * Info を更新した後に呼ぶと、Info の現在値で XMP を再生成する。
 *
 * 保持するもの: pdfuaid:part（PDF/UA 宣言）・**pdfaid:part / pdfaid:conformance（PDF/A 宣言・B-8）**・
 * dc:language・xmp:CreateDate。既存 XMP からこれらを読み取り、新しいパケットへ引き継ぐ。
 * xmp:CreateDate が既存 XMP に無い場合は **Info /CreationDate から補う**（W-6。`infoCreationDateIso`）。
 * 差し替えは**同一 ref への assign**で行い、catalog には触れない（増分更新に優しい）。
 *
 * **PDF/A 宣言を落とさないことが B-8 では重要**: `set_metadata` でタイトルを変えただけで
 * pdfaid が消えると、veraPDF `6.6.4-1` に戻る（= PDF/A でなくなる）。
 */
export function syncXmpWithInfo(
  doc: PDFDocument,
  /**
   * 既存 XMP の値より優先して書き込む宣言（B-8 の `ensure_pdfa` 用）。
   * 保持ではなく**上書き**なので、新たに PDF/A を名乗らせるときに使う。
   */
  overrides?: { pdfaPart?: number; pdfaConformance?: string; pdfaRev?: number },
): XmpSyncResult {
  const none: XmpSyncResult = { updated: false, catalogTouched: false, warnings: [] };
  const raw = doc.catalog.get(PDFName.of('Metadata'));
  if (raw === undefined) return none;

  // 既存 XMP の本文を取り出す（Filter 付きならデコード）
  const resolved = doc.catalog.lookup(PDFName.of('Metadata'));
  if (!(resolved instanceof PDFRawStream)) {
    return {
      ...none,
      warnings: [
        'The document has /Metadata but not in a readable form; XMP was left unchanged ' +
          'and may now disagree with the Info dictionary.',
      ],
    };
  }
  let text: string;
  try {
    const bytes = resolved.dict.has(PDFName.of('Filter'))
      ? decodePDFRawStream(resolved).decode()
      : resolved.contents;
    text = new TextDecoder().decode(bytes);
  } catch {
    return {
      ...none,
      warnings: [
        'The existing XMP stream could not be decoded; it was left unchanged ' +
          'and may now disagree with the Info dictionary.',
      ],
    };
  }

  // 引き継ぐべき既存の事実
  const part = /<pdfuaid:part>\s*(\d+)\s*<\/pdfuaid:part>/.exec(text)?.[1];
  const lang = /<dc:language>[\s\S]*?<rdf:li>([^<]*)<\/rdf:li>/.exec(text)?.[1];
  const createDate = /<xmp:CreateDate>([^<]+)<\/xmp:CreateDate>/.exec(text)?.[1];
  // B-8: PDF/A 宣言も引き継ぐ（落とすと veraPDF `6.6.4-1` に逆戻りする）
  const pdfaPart = /<pdfaid:part>\s*(\d+)\s*<\/pdfaid:part>/.exec(text)?.[1];
  const pdfaConformance = /<pdfaid:conformance>\s*([^<\s]+)\s*<\/pdfaid:conformance>/.exec(
    text,
  )?.[1];
  const pdfaRev = /<pdfaid:rev>\s*(\d+)\s*<\/pdfaid:rev>/.exec(text)?.[1];

  // part を上書きするなら、level と rev も**その宣言の一部**として一緒に決まる。
  // 既存値へのフォールバックを残すと、-3b から -4 へ載せ替えたときに
  // `pdfaid:conformance` が生き残り、**conformance level を持たない -4 が level を名乗る**。
  const redeclaring = overrides?.pdfaPart !== undefined;

  const packet = buildXmpPacket({
    title: doc.getTitle(),
    author: doc.getAuthor(),
    subject: doc.getSubject(),
    keywords: doc.getKeywords(),
    pdfuaPart: part !== undefined ? Number(part) : undefined,
    pdfaPart: overrides?.pdfaPart ?? (pdfaPart !== undefined ? Number(pdfaPart) : undefined),
    pdfaConformance: redeclaring ? overrides?.pdfaConformance : pdfaConformance,
    pdfaRev: redeclaring ? overrides?.pdfaRev : pdfaRev !== undefined ? Number(pdfaRev) : undefined,
    lang,
    // W-6: 既存 XMP に xmp:CreateDate が無ければ Info /CreationDate から補う
    createDate: createDate ?? infoCreationDateIso(doc),
    now: documentDate(doc),
  });
  const bytes = new TextEncoder().encode(packet);
  const stream = PDFRawStream.of(
    doc.context.obj({ Type: 'Metadata', Subtype: 'XML', Length: bytes.length }) as PDFDict,
    bytes,
  );

  if (raw instanceof PDFRef) {
    // 同一 ref を差し替え — catalog 不変・増分更新では this ref のみ dirty
    doc.context.assign(raw, stream);
    return { updated: true, ref: raw, catalogTouched: false, warnings: [] };
  }
  // /Metadata が直接オブジェクト（稀）— catalog を書き換えるしかない
  doc.catalog.set(PDFName.of('Metadata'), doc.context.register(stream));
  return { updated: true, catalogTouched: true, warnings: [] };
}

/**
 * B-8: 文書に PDF/A 適合を宣言させる（veraPDF `6.6.4-1`）。
 *
 * 既存 XMP があれば `pdfaid` を**上書き**（他の宣言は `syncXmpWithInfo` が保持する）、
 * 無ければ Info 辞書と `/Lang` から最小の XMP を新規作成する。
 *
 * **`ensure_pdfa` は既存 PDF が対象なので「XMP が無い」経路が普通に起こる** —
 * `syncXmpWithInfo` は /Metadata 不在時に何もしない設計なので、そこを埋めるのが本関数。
 */
export function declarePdfa(
  doc: PDFDocument,
  part: number,
  conformance: string | undefined,
  rev?: number,
): XmpSyncResult {
  if (doc.catalog.get(PDFName.of('Metadata')) === undefined) {
    const lang = doc.catalog.lookup(PDFName.of('Lang'));
    setXmpMetadata(doc, {
      title: doc.getTitle(),
      author: doc.getAuthor(),
      subject: doc.getSubject(),
      keywords: doc.getKeywords(),
      pdfaPart: part,
      pdfaConformance: conformance,
      pdfaRev: rev,
      lang: lang instanceof PDFString ? lang.asString() : undefined,
      // W-6: 既存 PDF に XMP を新設する経路。作成日時は Info /CreationDate から引き継ぐ
      createDate: infoCreationDateIso(doc),
    });
    return { updated: true, catalogTouched: true, warnings: [] };
  }
  return syncXmpWithInfo(doc, { pdfaPart: part, pdfaConformance: conformance, pdfaRev: rev });
}

export interface PdfuaCatalogOptions {
  title: string;
  author?: string;
  lang: string;
}

/**
 * PDF/UA-1 に必要な catalog エントリと XMP を付与する。
 * MarkInfo と StructTreeRoot は StructTreeBuilder.finalize() が設定するため、ここでは扱わない。
 *
 *   - /Lang                            : 7.2 (1)
 *   - /ViewerPreferences /DisplayDocTitle : 7.1 (8)
 *   - /Metadata（pdfuaid:part, dc:title） : 5 / 7.1 (8)
 */
export function applyPdfuaCatalog(doc: PDFDocument, opts: PdfuaCatalogOptions): void {
  const { catalog, context } = doc;
  catalog.set(PDFName.of('Lang'), PDFString.of(opts.lang));

  // 既存の ViewerPreferences があれば DisplayDocTitle だけ足す
  const existing = catalog.lookup(PDFName.of('ViewerPreferences'));
  if (existing instanceof PDFDict) {
    existing.set(PDFName.of('DisplayDocTitle'), context.obj(true));
  } else {
    catalog.set(PDFName.of('ViewerPreferences'), context.obj({ DisplayDocTitle: true }));
  }

  setXmpMetadata(doc, {
    title: opts.title,
    author: opts.author,
    pdfuaPart: 1,
    lang: opts.lang,
  });
}
