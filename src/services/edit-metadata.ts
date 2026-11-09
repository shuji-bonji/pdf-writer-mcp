/**
 * `set_metadata` — Phase 3（pdf-lib 撤去）の L4′.2 で新経路へ移した 3 本目のツール。
 *
 * 旧実装（`editor.ts` の `setMetadata`）との違い:
 * - Info への書き込みが `setInfoEntries` の 1 か所に寄る（`/Info` が間接参照か直接かの
 *   分岐が 1 つだけになる）
 * - dirty 参照の申告が要らない。旧は同期した `/Metadata` の ref と catalog の
 *   `/Root` を手で積んでいたが、`editor.set` を通ったものがそのまま書く集合になる
 * - `reserveExistingObjectNumbers` が要らない（`allocate` が定義の無い番号まで走査する）
 *
 * 🔴 **意図して変えた 1 点: 文字列の符号化。** 旧実装は pdf-lib の
 * `PDFHexString.fromText` で**常に** UTF-16BE の 16 進文字列を書いていた。
 * ここは `cos.ts` の `textString` を使うので、**ASCII の題名はリテラル文字列**になる
 * （§7.9.2.2 はどちらも許す）。しおり（§3.15.4）と同じ差である。
 * 日本語は旧実装と同じく UTF-16BE（BOM 付き）になる。
 */

import type { EditResult, SetMetadataArgs } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { textString } from './cos.js';
import { assertDocMdpAllows } from './doc-mdp.js';
import { openForEdit } from './edit-open.js';
import { appendOpened } from './incremental-append.js';
import { infoKeys, removeInfoEntriesExcept, setInfoEntries } from './info-dict.js';
import { saveOpened } from './output-edited.js';
import { readXmpDeclarations } from './pdfa-cos.js';
import { createXmpFromInfo, syncXmpWithInfo, type XmpInstructed } from './xmp-cos.js';

export async function setMetadata(args: SetMetadataArgs): Promise<EditResult> {
  const opened = await openForEdit(args.inputPath, args);
  const preserve = args.preserveSignatures === true;
  if (preserve) {
    // §12.8.2.2 Table 257: 文書情報の変更は P=2 でも許される範囲だが、
    // P=1（一切の変更を認めない）では断る
    await assertDocMdpAllows(opened.editor, 'metadata-or-outline');
  }

  const instructed: XmpInstructed = {
    ...(args.title !== undefined ? { title: args.title } : {}),
    ...(args.author !== undefined ? { author: args.author } : {}),
    ...(args.subject !== undefined ? { subject: args.subject } : {}),
    // 旧実装（pdf-lib の `setKeywords`）と同じく空白 1 つで繋ぐ
    ...(args.keywords !== undefined ? { keywords: args.keywords.join(' ') } : {}),
    ...(args.creator !== undefined ? { creator: args.creator } : {}),
  };
  const infoValues: Array<readonly [string, string | undefined]> = [
    ['Title', instructed.title],
    ['Author', instructed.author],
    ['Subject', instructed.subject],
    ['Keywords', instructed.keywords],
    ['Creator', instructed.creator],
  ];

  // SPEC-WRITER-OUTPUT-VERSION-002（#28）: PDF 2.0 では Info の文書メタデータは
  // CreationDate・ModDate 以外が非推奨（§14.3.3・Table 349）。値は XMP に書き、Info に
  // 新しい鍵を足さない。既にある鍵は、PDF/UA-2 の文書では XMP に移して除き
  // （ISO 14289-2 §6.2 should not）、それ以外では同じ値に揃えて残す
  const pdf20 = Number.parseFloat(opened.editor.base.version) >= 2;
  const ua2 = pdf20 && (await readXmpDeclarations(opened.editor)).pdfuaPart === 2;
  const present = new Set(pdf20 ? await infoKeys(opened.editor) : []);
  await setInfoEntries(
    opened.editor,
    infoValues
      .filter(([key]) => !pdf20 || (!ua2 && present.has(key)))
      .map(([key, value]) => [key, value === undefined ? undefined : textString(value)] as const),
  );

  // B-9: XMP を持つ文書では Info と `/Metadata` を同期させる（§14.3.3）。
  // #4: TDMRep は XMP にしか書けない。既存 XMP があれば上書き指定として渡し、
  // 無ければ Info の値と一緒に新設する（XMP を持たない文書で黙って落とさない）。
  const tdm =
    args.tdmReservation !== undefined
      ? {
          tdmReservation: args.tdmReservation,
          ...(args.tdmPolicy !== undefined ? { tdmPolicy: args.tdmPolicy } : {}),
        }
      : undefined;
  const sync = await syncXmpWithInfo(opened.editor, tdm, instructed);
  const warnings = [...sync.warnings];
  if (sync.updated) {
    warnings.push(
      'The document carries XMP metadata (/Metadata); it was rewritten with the given values ' +
        '(dc:title etc.), and XMP values you did not pass were carried over as written.',
    );
  } else if (sync.warnings.length === 0 && (tdm !== undefined || pdf20)) {
    // Info は上で更新済みなので、ここから引き継げば args と既存の値の両方が XMP に載る。
    // PDF 2.0 では Info に書かなかった値を instructed で渡す
    await createXmpFromInfo(opened.editor, tdm ?? {}, instructed);
    warnings.push(
      tdm !== undefined
        ? 'The document had no XMP metadata (/Metadata); one was created to carry the TDMRep ' +
            'statement (tdm:reservation), which has no place in the Info dictionary.'
        : 'The document had no XMP metadata (/Metadata); one was created, because PDF 2.0 ' +
            'deprecates document metadata in the Info dictionary (ISO 32000-2 §14.3.3).',
    );
  }

  if (ua2) {
    const removed = await removeInfoEntriesExcept(opened.editor, ['CreationDate', 'ModDate']);
    if (removed.length > 0) {
      warnings.push(
        `The document declares PDF/UA-2, which should not contain features deprecated in PDF 2.0 ` +
          `(ISO 14289-2 §6.2). The Info entries ${removed.join(', ')} were moved to XMP and ` +
          'removed from the Info dictionary (ISO 32000-2 §14.3.3).',
      );
    }
  }

  const result = preserve ? await appendOpened(opened, args) : await saveOpened(opened, args);
  if (warnings.length > 0) result.warnings = [...(result.warnings ?? []), ...warnings];
  if (preserve) {
    logger.info(
      'Editor',
      `Updated metadata via incremental update (+${result.bytes - opened.bytes.length} bytes); ` +
        'signatures preserved',
    );
  }
  return result;
}
