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
  /** PDF/UA 宣言を含める場合の part（1 | 2） */
  pdfuaPart?: number;
  /** dc:language */
  lang?: string;
  /** xmp:CreateDate（ISO 8601）。更新時に元の作成日時を保持するために使う。省略時は現在時刻 */
  createDate?: string;
  /**
   * この文書に焼き込む「現在時刻」（W-5）。Info 辞書側と**同一の `Date` を渡すこと**。
   * 省略時は `outputDate()` を独自に呼ぶが、その場合 Info 側と秒境界を跨ぐと
   * R-14.3.4-2/-5 の「fully equivalent」を破りうる。`setXmpMetadata` /
   * `syncXmpWithInfo` は `documentDate(doc)` を渡すので通常は意識しなくてよい。
   */
  now?: Date;
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

  if (opts.keywords) {
    parts.push(
      `    <rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">\n` +
        `      <pdf:Keywords>${escapeXml(opts.keywords)}</pdf:Keywords>\n` +
        `    </rdf:Description>`,
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
 * 保持するもの: pdfuaid:part（PDF/UA 宣言）・dc:language・xmp:CreateDate。
 * 既存 XMP からこれらを読み取り、新しいパケットへ引き継ぐ。
 * 差し替えは**同一 ref への assign**で行い、catalog には触れない（増分更新に優しい）。
 */
export function syncXmpWithInfo(doc: PDFDocument): XmpSyncResult {
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

  const packet = buildXmpPacket({
    title: doc.getTitle(),
    author: doc.getAuthor(),
    subject: doc.getSubject(),
    keywords: doc.getKeywords(),
    pdfuaPart: part !== undefined ? Number(part) : undefined,
    lang,
    createDate,
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
