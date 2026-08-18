/**
 * XMP パケットを組み立てる —— Phase 3 の L4′.3。
 *
 * `xmp.ts`（pdf-lib の文書に XMP を書き込むもの）から、**文字列を作る部分だけ**を
 * 取り出した。書き込みは `xmp-cos.ts` が COS の上で行う。
 *
 * §14.3.2: XMP は XML のパケットで、`/Metadata` ストリームの中身になる。
 * 文字列の組み立てに PDF のオブジェクトモデルは要らない。
 */

import { outputDate, PACKAGE_INFO } from '../config.js';

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
