/**
 * `ensure_pdfa` — Phase 3（pdf-lib 撤去）の L4′.2 で新経路へ移した 5 本目のツール。
 *
 * **本ツールが作るのは「宣言」だけで、適合は保証しない**（`specs/09 §4`）。
 * 埋め込まれていないフォント・暗号化・JavaScript・LZW は直さない。判定は veraPDF が下す。
 *
 * 🔴 **PDF/A-4 は `removeTrailerEntry`（normativepdf 0.6.0）を使う。**
 * 6.1.3-4 は文書情報辞書を持たないことを求める。`/Info` に null を書くのでは足りない ——
 * §7.3.7 は値が null の項目を無いものとして扱うが、鍵はバイト列に残り、
 * 「在るか」を見る側には見える。
 */

import { invalidArg, PdfWriterError } from '../errors.js';
import type {
  EditResult,
  EnsurePdfaArgs,
  EnsurePdfaResult,
  PdfaDeclarationRisk,
} from '../types/index.js';
import { logger } from '../utils/logger.js';
import { assertDocMdpAllows } from './doc-mdp.js';
import { openForEdit } from './edit-open.js';
import { findNonEmbeddedFonts } from './font-read.js';
import { appendOpened } from './incremental-append.js';
import { saveOpened } from './output-edited.js';
import {
  normalizePdfaConformance,
  PDFA4_REV,
  readXmpDeclarations,
  stripInfoForPdfa4,
} from './pdfa-cos.js';
import { declarePdfa } from './xmp-cos.js';

export async function ensurePdfa(args: EnsurePdfaArgs): Promise<EnsurePdfaResult> {
  const flavour = args.flavour ?? 'pdfa-3b';
  const isPdfa4 = flavour === 'pdfa-4' || flavour === 'pdfa-4f';
  // -4 の variant。素の -4 では書かない（level ではないが XMP 上の置き場所は同じ）
  const pdfa4Variant = flavour === 'pdfa-4f' ? 'F' : undefined;

  const opened = await openForEdit(args.inputPath, args);
  const preserve = args.preserveSignatures === true;
  const declared = await readXmpDeclarations(opened.editor);
  // SPEC-WRITER-OUTPUT-VERSION-006: 版を理由に断るときは、入力の版と宣言を名指す
  const inputVersion = opened.editor.base.version;
  const inputIs = describeInput(inputVersion, declared.pdfuaPart, declared.pdfa);

  // SPEC-WRITER-ENSURE-PDFA-001（#9・F-19）: PDF/A-4 はヘッダーを %PDF-2.0 にし、
  // PDF/UA-1 は ISO 14289-1 §6.1 で版を 1.0〜1.7 とする。両方を名乗るファイルは片方の
  // 検査で必ず落ちる（veraPDF ISO 14289-1:2014 6.1-1）。作成系と同じく断る。
  // PDF/UA-2（ISO 14289-2 §6.1: 版は 2.0）は PDF/A-4 と両立するので断らない（#26）
  if (isPdfa4 && declared.pdfuaPart !== null && declared.pdfuaPart !== 2) {
    const err = invalidArg(
      `${inputIs}. ${flavour} would set the header to PDF 2.0, which PDF/UA-${declared.pdfuaPart} does not allow (ISO 14289-1 §6.1: version 1.0 to 1.7). The file would then fail one of its two declarations.`,
    );
    throw new PdfWriterError(err.message, 'INVALID_ARGUMENT', {
      hint: 'Use flavour "pdfa-3b": it keeps the PDF 1.7 header, so PDF/A-3b and PDF/UA-1 can both hold. To combine PDF/A-4 with accessibility, create the document as PDF/UA-2 (tagged: true with pdfVersion: "2.0").',
      next_actions: [
        {
          action: 'retry_with_flavour',
          reason:
            'PDF/A-3b keeps the PDF 1.7 header and can stand together with the PDF/UA-1 declaration. Call again with flavour "pdfa-3b".',
          example: { flavour: 'pdfa-3b' },
        },
      ],
    });
  }

  // SPEC-WRITER-ENSURE-PDFA-003（#26）: 逆向きの組み合わせ。PDF/UA-2 は版 2.0 を求め
  // （ISO 14289-2 §6.1）、PDF/A-3 はヘッダーを %PDF-1.n（n は 0〜7）に限る
  // （veraPDF ISO 19005-3:2012 6.1.2-1、実測 2026-11-09）。ensure_pdfa はヘッダーを下げない
  if (!isPdfa4 && declared.pdfuaPart === 2) {
    throw new PdfWriterError(
      `${inputIs}. PDF/UA-2 requires PDF 2.0 (ISO 14289-2 §6.1), and ${flavour} requires a PDF 1.x header (%PDF-1.n). The file would then fail one of its two declarations.`,
      'INVALID_ARGUMENT',
      {
        hint: 'Use flavour "pdfa-4" (or "pdfa-4f"): PDF/A-4 is based on PDF 2.0, so PDF/A-4 and PDF/UA-2 can both hold.',
        next_actions: [
          {
            action: 'retry_with_flavour',
            reason:
              'PDF/A-4 keeps the PDF 2.0 header and can stand together with the PDF/UA-2 declaration. Call again with flavour "pdfa-4".',
            example: { flavour: 'pdfa-4' },
          },
        ],
      },
    );
  }

  // SPEC-WRITER-ENSURE-PDFA-004（#28）: PDF/UA の宣言が無くても、PDF 2.0 の入力に PDF/A-3b を
  // 名乗らせると、ヘッダーが 2.0 のまま残り PDF/A-3 のヘッダーの規則（%PDF-1.n、n は 0〜7。
  // veraPDF ISO 19005-3:2012 6.1.2-1）で必ず落ちる。ensure_pdfa はヘッダーを下げない
  // （版を下げると PDF 2.0 にしか無い機能を持つ文書が 1.x を名乗る）
  if (!isPdfa4 && Number.parseFloat(inputVersion) >= 2) {
    throw new PdfWriterError(
      `${inputIs}. ${flavour} requires a PDF 1.x header (%PDF-1.n, n from 0 to 7), and ensure_pdfa does not lower the version of its input. The file would claim PDF/A-3b with a PDF ${inputVersion} header and fail.`,
      'INVALID_ARGUMENT',
      {
        hint: 'Use flavour "pdfa-4" (or "pdfa-4f"): PDF/A-4 is based on PDF 2.0.',
        next_actions: [
          {
            action: 'retry_with_flavour',
            reason: `PDF/A-4 keeps the PDF ${inputVersion} header. Call again with flavour "pdfa-4".`,
            example: { flavour: 'pdfa-4' },
          },
        ],
      },
    );
  }

  // PDF/A-4 は PDF 2.0 基盤で、ヘッダが `%PDF-2.n` であることを要求する
  // （veraPDF `ISO 19005-4:2020 6.1.2-1`）。増分更新は**元ファイルの先頭を書き換えられない** —
  // 書き換えれば署名の対象バイトが変わって署名が壊れる。だから黙って版を上げず、断る。
  const alreadyPdf20 = String.fromCharCode(...opened.bytes.subarray(0, 8)) === '%PDF-2.0';
  if (isPdfa4 && preserve && !alreadyPdf20) {
    throw new PdfWriterError(
      'PDF/A-4 requires a PDF 2.0 header, but preserveSignatures appends an incremental update and cannot rewrite the header of a signed file without breaking the signature.',
      'SIGNED_PDF',
      {
        hint: 'Start from a document that is already PDF 2.0, or drop preserveSignatures and re-sign afterwards.',
      },
    );
  }

  if (preserve) {
    // catalog（/OutputIntents）と trailer を触るので、構造変更と同じ扱いにする
    await assertDocMdpAllows(opened.editor, 'structure');
  }

  // SPEC-WRITER-ENSURE-PDFA-002（#11・F-31）: 0.23.x の wasDeclared（真偽値）は、
  // 求めた flavour と同じ宣言だったのかを分けていなかった。宣言そのものを返す
  const previousDeclaration = declared.pdfa;
  const addedRequirements: string[] = [];
  const warnings: string[] = [];

  const normalized = await normalizePdfaConformance(opened.editor);
  addedRequirements.push(...normalized.added);
  warnings.push(...normalized.notes);

  // -4 は conformance level を持たない。level の代わりに rev（版の年）を名乗り、
  // variant（-4f）だけが pdfaid:conformance を使う
  const xmp = isPdfa4
    ? await declarePdfa(opened.editor, 4, pdfa4Variant, PDFA4_REV)
    : await declarePdfa(opened.editor, 3, 'B', undefined);
  if (xmp.updated) {
    addedRequirements.push(
      isPdfa4
        ? `XMP pdfaid (part 4${pdfa4Variant ? `, conformance ${pdfa4Variant}` : ''}, rev ${PDFA4_REV})`
        : 'XMP pdfaid (part 3, conformance B)',
    );
  }
  warnings.push(...xmp.warnings);

  // **宣言を書いた以上、検査していない事実は必ず伝える。**
  const label = isPdfa4 ? (pdfa4Variant ? 'PDF/A-4f' : 'PDF/A-4') : 'PDF/A-3b';
  const claim = isPdfa4
    ? `pdfaid:part=4${pdfa4Variant ? `, conformance=${pdfa4Variant}` : ''}, rev=${PDFA4_REV}`
    : 'pdfaid:part=3, conformance=B';
  warnings.push(
    `This file now CLAIMS ${label} (${claim}), but conformance was NOT ` +
      'checked here. Only document-level requirements were supplied; unembedded fonts, ' +
      'encryption, JavaScript, LZW compression and similar violations are left as they are. ' +
      'If the document does not actually conform, that claim is now false. ' +
      `Verify before relying on it: pdf-verify-mcp validate_conformance(flavour: "${flavour}") — ` +
      'and note that a PDF/A verdict comes from veraPDF, not from quoted ISO 19005 text.',
  );

  // **B-21: 「測ると落ちる」と既に分かっている宣言は、そう名指しする。**
  // ただし**宣言は書く**（破壊的変更を避ける）— 判定を下すのは veraPDF の役目。
  const declarationRisks: PdfaDeclarationRisk[] = [];
  const nonEmbedded = await findNonEmbeddedFonts(opened.editor);
  if (nonEmbedded.length > 0) {
    const affected = nonEmbedded.map((f) => `${f.baseFont} (${f.subtype})`);
    declarationRisks.push({
      code: 'FONT_NOT_EMBEDDED',
      detail:
        `${nonEmbedded.length} font(s) have no embedded font program, so this ${label} claim ` +
        'will fail validation. PDF/A requires every font to be embedded, and ensure_pdfa does ' +
        'not embed fonts — re-create the document with fontPath (or PDF_WRITER_FONT) set, ' +
        'rather than relying on the standard 14 faces.',
      affected,
      ...(isPdfa4 ? { measuredRuleId: 'ISO 19005-4:2020 6.2.10.4.1-1' } : {}),
    });
    warnings.push(
      `Known to fail: ${affected.join(', ')} — no embedded font program (see declarationRisks).`,
    );
  }

  logger.info(
    'Editor',
    `Applied ${label} document requirements (${addedRequirements.length} item(s))`,
  );

  const saved: EditResult = preserve
    ? await appendOpened(opened, args)
    : await saveOpened(opened, args, {
        // Info の始末は `/ModDate` の更新の**後**でなければ意味が無い
        ...(isPdfa4
          ? {
              beforeSave: async (editor) => {
                const note = await stripInfoForPdfa4(editor);
                if (note) addedRequirements.push(note);
              },
            }
          : {}),
        write: {
          xref: opened.form.xref,
          objectStreams: opened.form.objectStreams,
          ...(isPdfa4 ? { version: '2.0' as const } : {}),
        },
      });

  const all = [...(saved.warnings ?? []), ...warnings];
  return {
    ...saved,
    flavour: isPdfa4 ? (pdfa4Variant ? '4f' : '4') : '3b',
    addedRequirements,
    previousDeclaration,
    ...(declarationRisks.length > 0 ? { declarationRisks } : {}),
    ...(all.length > 0 ? { warnings: all } : {}),
  };
}

/**
 * SPEC-WRITER-OUTPUT-VERSION-006: 断る理由が版のとき、エラーの文の頭に置く入力の版と宣言。
 * 例「The input is PDF 2.0 and declares PDF/UA-2 (pdfuaid:part in XMP)」
 */
function describeInput(
  version: string,
  pdfuaPart: number | null,
  pdfa: { part: number; conformance: string | null } | null,
): string {
  const claims: string[] = [];
  if (pdfuaPart !== null) claims.push(`PDF/UA-${pdfuaPart} (pdfuaid:part in XMP)`);
  if (pdfa !== null) {
    claims.push(`PDF/A-${pdfa.part}${(pdfa.conformance ?? '').toLowerCase()} (pdfaid in XMP)`);
  }
  return `The input is PDF ${version}${claims.length > 0 ? ` and declares ${claims.join(' and ')}` : ' and declares no PDF/UA or PDF/A conformance'}`;
}
