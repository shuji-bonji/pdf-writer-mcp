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

import { PdfWriterError } from '../errors.js';
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
import { PDFA4_REV } from './pdfa-conformance.js';
import { hasPdfaDeclaration, normalizePdfaConformance, stripInfoForPdfa4 } from './pdfa-cos.js';
import { declarePdfa } from './xmp-cos.js';

export async function ensurePdfa(args: EnsurePdfaArgs): Promise<EnsurePdfaResult> {
  const flavour = args.flavour ?? 'pdfa-3b';
  const isPdfa4 = flavour === 'pdfa-4' || flavour === 'pdfa-4f';
  // -4 の variant。素の -4 では書かない（level ではないが XMP 上の置き場所は同じ）
  const pdfa4Variant = flavour === 'pdfa-4f' ? 'F' : undefined;

  const opened = await openForEdit(args.inputPath, args);
  const preserve = args.preserveSignatures === true;

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
        retryable: true,
      },
    );
  }

  if (preserve) {
    // catalog（/OutputIntents）と trailer を触るので、構造変更と同じ扱いにする
    await assertDocMdpAllows(opened.editor, 'structure');
  }

  const wasDeclared = await hasPdfaDeclaration(opened.editor);
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
    wasDeclared,
    ...(declarationRisks.length > 0 ? { declarationRisks } : {}),
    ...(all.length > 0 ? { warnings: all } : {}),
  };
}
