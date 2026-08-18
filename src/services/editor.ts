/**
 * Editor
 * 既存 PDF の編集の共通基盤（loadForEdit / saveEdited）と、ページ操作以外の
 * 編集ツール（メタデータ・しおり・注釈・添付・スタンプ・透かし・フォーム）。
 * ページ単位の操作（merge / split / extract / delete / reorder / rotate）は
 * page-ops.ts に分離した。
 *
 * create 系（builder → font → layout → renderer）とはフローが異なり、
 *   読込（loadForEdit: 署名ガード込み）→ 操作 → 保存（saveEdited）
 * の 3 段で完結する。
 *
 * 署名保全について（specs/05 §3-1）:
 *   pdf-lib の save() はファイル全体を再構築するため、既存の電子署名は必ず無効化される。
 *   署名（/ByteRange）を検知した場合は既定でエラーとし、明示フラグ
 *   allowBreakingSignatures: true があるときのみ続行する。
 *   署名を保持する増分更新（incremental_save）は Tier C の課題。
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { LIMITS } from '../constants.js';
import { invalidArg, NEXT_ACTIONS, PdfWriterError } from '../errors.js';
import type {
  CommonEditOptions,
  FillFormArgs,
  FlattenFormArgs,
  FormResult,
} from '../types/index.js';
import { logger } from '../utils/logger.js';
import { applyMissingGlyphPolicy, openFont } from './font-manager.js';
import { embedFontIntoPdfLib } from './font-manager-pdflib.js';
import {
  applyFieldValue,
  cleanUpAfterFlatten,
  collectRenderedTexts,
  listFields,
  readOnlyWarnings,
  refreshAppearances,
} from './form.js';
import { saveEdited } from './output.js';
import { assertRenderable } from './renderers/text.js';
import { containsSignature } from './signature-scan.js';
import { isTagged } from './struct-append.js';

// 署名検知は `signature-scan.ts` へ移した（L4′.1 = 新しい入口と共有するため）。
// ここから再輸出しているのは `tests/editor.test.ts` が この経路で import しているから。
export { containsSignature } from './signature-scan.js';

/** PDF を読み込み、署名ガード・サイズ上限を通す（page-ops.ts と共用） */
export async function loadForEdit(
  filePath: string,
  opts: CommonEditOptions & { preserveSignatures?: boolean },
): Promise<{ doc: PDFDocument; absPath: string; bytes: Uint8Array }> {
  const absPath = resolve(filePath);
  let bytes: Uint8Array;
  try {
    bytes = await readFile(absPath);
  } catch {
    throw new PdfWriterError(`Cannot read PDF file: ${absPath}`, 'DOC_NOT_FOUND', {
      next_actions: [NEXT_ACTIONS.checkFilePath(absPath)],
    });
  }

  // 入力サイズ上限（E-1）: pdf-lib は全体をメモリに載せるため verify と同水準で防御
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
        'Editing will invalidate existing signatures because pdf-lib rewrites the whole file.',
      'SIGNED_PDF',
      {
        retryable: true,
        next_actions: [NEXT_ACTIONS.preserveSignatures(), NEXT_ACTIONS.allowBreakingSignatures()],
      },
    );
  }

  let doc: PDFDocument;
  try {
    // updateMetadata: false — 読込時に Producer/ModDate を書き換えない
    doc = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (e) {
    const cause = e instanceof Error ? e.message : String(e);
    const encrypted = /encrypt/i.test(cause);
    throw new PdfWriterError(
      `Failed to parse PDF "${absPath}" (${encrypted ? 'encrypted' : 'corrupted?'}): ${cause}`,
      encrypted ? 'ENCRYPTED_PDF' : 'INVALID_PDF',
      encrypted
        ? { hint: 'Decrypt the PDF first — pdf-writer-mcp cannot edit encrypted files.' }
        : {},
    );
  }
  return { doc, absPath, bytes };
}

// ---------------------------------------------------------------------------
// 増分更新（preserveSignatures）の共通部品
// ---------------------------------------------------------------------------

/**
 * フォーム系の共通前処理。
 * 「値を適用 → 描画される文字を集める → その字だけサブセットしたフォントで外観を作り直す」
 * という順番が重要。先にフォントを埋め込むと、後から入れた値の字がサブセットに無く豆腐になる。
 */
async function prepareFormAppearances(
  doc: PDFDocument,
  fontPath: string | undefined,
): Promise<{ warnings: string[] }> {
  const form = doc.getForm();
  // 値を適用した後の「実際に描かれる文字」だけをサブセットの入力にする
  const texts = collectRenderedTexts(form);
  const source = await openFont(fontPath);
  for (const t of texts) assertRenderable(t, source);
  const applied = applyMissingGlyphPolicy(texts, source, 'error');
  const loaded = await embedFontIntoPdfLib(doc, source, applied.texts);
  const { unresolvedDaFonts } = refreshAppearances(form, loaded.font);

  const warnings = [...applied.warnings];
  if (unresolvedDaFonts.length > 0) {
    // 入力が既に壊れているケース（§12.7.4.3 の /DA ↔ /DR 整合が元から取れていない）。
    // writer は自分が使ったフォントと、Widget の外観から辿れるフォントは /DR に載せたが、
    // 実体が見つからないものは黙って直せない
    warnings.push(
      `The /DA of ${unresolvedDaFonts.length} field(s) names a font that is not in the AcroForm ` +
        `/DR resources and could not be found in their appearance streams either ` +
        `(${unresolvedDaFonts.map((f) => `/${f}`).join(', ')}). This came in with the input. ` +
        'ISO 32000-2 §12.7.4.3 requires the /DA font to resolve via /DR; if a viewer regenerates ' +
        "those fields' appearances it will fall back to a default font.",
    );
  }
  return { warnings };
}

export async function fillForm(args: FillFormArgs): Promise<FormResult> {
  const { doc } = await loadForEdit(args.inputPath, args);
  const form = doc.getForm();

  if (form.hasXFA()) {
    throw new PdfWriterError(
      'This PDF uses XFA forms, which pdf-writer-mcp does not support. ' +
        '(XFA is deprecated in ISO 32000-2 and forbidden by PDF/UA-1 7.15.)',
      'UNSUPPORTED_PDF_FEATURE',
    );
  }

  const names = Object.keys(args.fields);
  if (names.length === 0) throw invalidArg('fields must contain at least one field to fill');
  for (const name of names) applyFieldValue(form, name, args.fields[name]);

  const warnings = readOnlyWarnings(form, names);
  const prepared = await prepareFormAppearances(doc, args.fontPath);
  warnings.push(...prepared.warnings);

  let flattened = false;
  if (args.flatten) {
    flattened = flattenAndWarn(doc, args.allowBreakingTags, warnings);
  }

  logger.info('Editor', `Filled ${names.length} form field(s)${flattened ? ' and flattened' : ''}`);
  // pdf-lib の既定の外観再生成（Helvetica）を止める。上で自前のフォントで作り済み
  const saved = await saveEdited(doc, args, { updateFieldAppearances: false });
  return {
    ...saved,
    filled: names.length,
    flattened,
    fields: listFields(doc),
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

/**
 * フラット化の本体。タグ付き PDF での破壊をここで一元的に判断する。
 *
 * flatten は Widget 注釈を消して外観 XObject をページ内容に焼き込む。タグ付き文書では
 * Form 構造要素の参照先（OBJR）が消えるうえ、焼き込まれた図形はタグの付かない内容になるため、
 * PDF/UA-1（7.1 の「全内容はタグか Artifact」/ 7.18.4 の Form タグ）に反する。
 */
function flattenAndWarn(
  doc: PDFDocument,
  allowBreakingTags: boolean | undefined,
  warnings: string[],
): boolean {
  if (isTagged(doc) && !allowBreakingTags) {
    throw new PdfWriterError(
      'Flattening would break the structure tree of this tagged PDF: it removes the Widget ' +
        'annotations that the Form structure elements point to, and bakes their appearance into ' +
        'the page as untagged content (violating PDF/UA-1 7.1 and 7.18.4). ' +
        'Omit flatten to keep the form interactive.',
      'TAGGED_PDF',
      { retryable: true, next_actions: [NEXT_ACTIONS.allowBreakingTags()] },
    );
  }
  if (isTagged(doc)) {
    warnings.push(
      'Flattened a tagged PDF: the Form structure elements now point to removed widgets and the ' +
        'baked-in appearances are untagged. The document is no longer PDF/UA-1 conforming.',
    );
  }
  // 外観は prepareFormAppearances で生成済みなので、pdf-lib に Helvetica で作り直させない
  doc.getForm().flatten({ updateFieldAppearances: false });
  // pdf-lib の flatten は /Annots・/Kids に宙吊り参照を残す（form.ts の pruneDanglingRefs 参照）
  const pruned = cleanUpAfterFlatten(doc);
  if (pruned > 0) {
    logger.info('Editor', `Pruned ${pruned} dangling reference(s) left by pdf-lib's flatten()`);
  }
  return true;
}

export async function flattenForm(args: FlattenFormArgs): Promise<FormResult> {
  const { doc } = await loadForEdit(args.inputPath, args);
  const form = doc.getForm();

  if (form.hasXFA()) {
    throw new PdfWriterError(
      'This PDF uses XFA forms, which pdf-writer-mcp does not support.',
      'UNSUPPORTED_PDF_FEATURE',
    );
  }
  const fieldCount = form.getFields().length;
  if (fieldCount === 0) {
    throw invalidArg(`"${args.inputPath}" has no AcroForm fields to flatten.`);
  }

  const warnings: string[] = [];
  const prepared = await prepareFormAppearances(doc, args.fontPath);
  warnings.push(...prepared.warnings);
  flattenAndWarn(doc, args.allowBreakingTags, warnings);

  logger.info('Editor', `Flattened ${fieldCount} form field(s)`);
  const saved = await saveEdited(doc, args, { updateFieldAppearances: false });
  return {
    ...saved,
    filled: 0,
    flattened: true,
    fields: [],
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}
