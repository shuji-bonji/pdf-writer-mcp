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

import { PDFDict, type PDFDocument, PDFName, PDFRawStream, PDFString } from 'pdf-lib';
import { outputDate, PACKAGE_INFO } from '../config.js';

export interface XmpOptions {
  title?: string;
  author?: string;
  /** PDF/UA 宣言を含める場合の part（1 | 2） */
  pdfuaPart?: number;
  /** dc:language */
  lang?: string;
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
  // SOURCE_DATE_EPOCH（E-6）設定時は Info 辞書側と同じ固定時刻になる
  const now = outputDate()
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z');
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

  parts.push(
    `    <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/">\n` +
      `      <xmp:CreatorTool>${escapeXml(`${PACKAGE_INFO.name}/${PACKAGE_INFO.version}`)}</xmp:CreatorTool>\n` +
      `      <xmp:CreateDate>${now}</xmp:CreateDate>\n` +
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
  const packet = buildXmpPacket(opts);
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
