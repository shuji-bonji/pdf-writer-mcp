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
import { PDFDocument, PDFName, PDFRef } from 'pdf-lib';
import { outputDate } from '../config.js';
import { LIMITS, STAMP_DEFAULTS, WATERMARK_DEFAULTS } from '../constants.js';
import { invalidArg, NEXT_ACTIONS, PdfWriterError } from '../errors.js';
import type {
  AddAnnotationArgs,
  AddBookmarksArgs,
  AddWatermarkArgs,
  AttachFileArgs,
  AttachResult,
  CommonEditOptions,
  EditResult,
  FillFormArgs,
  FlattenFormArgs,
  FormResult,
  SetMetadataArgs,
  StampPageNumbersArgs,
  StampResult,
  TagFormFieldsArgs,
  TagFormFieldsResult,
  WatermarkResult,
} from '../types/index.js';
import { logger } from '../utils/logger.js';
import { parsePageSpec } from '../utils/page-spec.js';
import { addAnnotation as addAnnotationDict, parseHexColor } from './annotation.js';
import { attachFile, listEmbeddedFiles } from './attachment.js';
import { applyMissingGlyphPolicy, embedFontFor, openFont } from './font-manager.js';
import {
  applyFieldValue,
  cleanUpAfterFlatten,
  collectRenderedTexts,
  listFields,
  readOnlyWarnings,
  refreshAppearances,
  tagWidgets,
} from './form.js';
import {
  buildIncrementalUpdate,
  findDocMdpPermission,
  reserveExistingObjectNumbers,
} from './incremental.js';
import { countBookmarks, setBookmarks } from './outline.js';
import { saveEdited, saveRawBytes } from './output.js';
import { formatPageNumber, stampPage } from './page-number.js';
import { assertRenderable } from './renderers/text.js';
import { appendAnnotationToStructTree, isTagged, markArtifactOnPage } from './struct-append.js';
import { watermarkPage } from './watermark.js';

/** 入力バイト列に電子署名（/ByteRange）が含まれるかの軽量検査 */
export function containsSignature(bytes: Uint8Array): boolean {
  // "/ByteRange" の ASCII 検索（署名辞書は非圧縮で現れるのが通例）
  const needle = [0x2f, 0x42, 0x79, 0x74, 0x65, 0x52, 0x61, 0x6e, 0x67, 0x65]; // "/ByteRange"
  outer: for (let i = 0; i <= bytes.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (bytes[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

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
// Tier A ツール本体（ページ操作は page-ops.ts へ）
// ---------------------------------------------------------------------------

export async function setMetadata(args: SetMetadataArgs): Promise<EditResult> {
  const { doc } = await loadForEdit(args.inputPath, args);
  if (args.title !== undefined) doc.setTitle(args.title);
  if (args.author !== undefined) doc.setAuthor(args.author);
  if (args.subject !== undefined) doc.setSubject(args.subject);
  if (args.keywords !== undefined) doc.setKeywords(args.keywords);
  if (args.creator !== undefined) doc.setCreator(args.creator);
  return saveEdited(doc, args);
}

export async function addBookmarks(args: AddBookmarksArgs): Promise<EditResult> {
  const total = countBookmarks(args.bookmarks);
  if (total > LIMITS.BOOKMARK_MAX_TOTAL) {
    throw invalidArg(`too many bookmarks (${total}, max ${LIMITS.BOOKMARK_MAX_TOTAL})`);
  }
  const { doc } = await loadForEdit(args.inputPath, args);
  const added = setBookmarks(doc, args.bookmarks);
  logger.info('Editor', `Set ${added} bookmark(s)`);
  return saveEdited(doc, args);
}

export async function addAnnotation(args: AddAnnotationArgs): Promise<EditResult> {
  const { doc, bytes } = await loadForEdit(args.inputPath, args);

  // --- 署名保持モード（Tier C・ADR-11）: 元バイト列に触れず増分更新で追記する ---
  if (args.preserveSignatures) {
    if (isTagged(doc)) {
      throw new PdfWriterError(
        'preserveSignatures on a tagged PDF is not supported yet: nesting the annotation in ' +
          'an Annot structure element (PDF/UA 7.18.1-1) rewrites existing structure objects ' +
          'that the incremental writer does not track in this first milestone.',
        'UNSUPPORTED_PDF_FEATURE',
        {
          hint:
            'Tagged + signature-preserving annotation is a later Tier C milestone. ' +
            'If invalidating the signature is acceptable, retry with "allowBreakingSignatures": true.',
        },
      );
    }

    // 認証署名（DocMDP）の許可レベル検査（ISO 32000-2 §12.8.2.2）:
    // 注釈の追加が許されるのは P=3 のみ。P=1（変更禁止）/ P=2（フォームまで）では
    // 増分更新が合法でも認証署名の検証が「許可されない変更」として失敗する。
    const docMdpP = findDocMdpPermission(doc);
    if (docMdpP !== undefined && docMdpP < 3) {
      throw new PdfWriterError(
        `This PDF carries a certification signature (DocMDP) with permission level P=${docMdpP} — ` +
          (docMdpP === 1
            ? 'the author declared the document final; any change (except DSS/DTS) invalidates it.'
            : 'only form fill-in and signing are permitted; annotations are not.') +
          ' Even a signature-preserving incremental update would be flagged as a disallowed change.',
        'SIGNED_PDF',
        {
          retryable: true,
          hint: 'ISO 32000-2 §12.8.2.2: annotation changes require DocMDP P=3.',
          next_actions: [NEXT_ACTIONS.allowBreakingSignatures()],
        },
      );
    }

    // 容器ストリーム等の「登録されない番号」との衝突を防いでから採番を始める
    reserveExistingObjectNumbers(doc, bytes);
    const since = doc.context.largestObjectNumber;
    const added = addAnnotationDict(doc, args);

    // 再定義が必要な既存オブジェクトを特定する:
    //   /Annots が間接配列 → その配列オブジェクトだけを再定義（ページ辞書は元のまま）
    //   /Annots が直接配列 or 新設 → ページオブジェクトを再定義
    const annotsRaw = added.page.node.get(PDFName.of('Annots'));
    const dirtyRefs: PDFRef[] = [annotsRaw instanceof PDFRef ? annotsRaw : added.page.ref];

    // ModificationDate の更新も増分に含める（Info が既存なら再定義、無ければ新規扱い）
    doc.setModificationDate(outputDate());
    const info = doc.context.trailerInfo.Info;
    if (info instanceof PDFRef && info.objectNumber <= since) dirtyRefs.push(info);

    const update = buildIncrementalUpdate({
      original: bytes,
      doc,
      dirtyRefs,
      sinceObjectNumber: since,
    });
    logger.info(
      'Editor',
      `Added annotation via incremental update (${update.objectsWritten} object(s), ` +
        `${update.xrefStyle} xref, +${update.bytes.length - bytes.length} bytes); signatures preserved`,
    );
    const saved = await saveRawBytes(update.bytes, doc.getPageCount(), args);
    return { ...saved, incremental: true };
  }

  const added = addAnnotationDict(doc, args);

  // タグ付き PDF なら構造木にも結び付ける（PDF/UA 7.18.1-1 / 7.18.3-1）。
  // タグ無し文書では何もしない — 注釈のためだけに構造木を作り始めない。
  const warnings: string[] = [];
  const linked = appendAnnotationToStructTree(doc, added.page, added.ref, args.alt);
  if (linked.tagged && !args.alt) {
    warnings.push(
      'The document is tagged and the annotation was nested in an Annot structure element. ' +
        'Pass "alt" to give assistive technology a description of it.',
    );
  }

  const result = await saveEdited(doc, args);
  if (warnings.length > 0) result.warnings = warnings;
  return result;
}

export async function attachFileToPdf(args: AttachFileArgs): Promise<AttachResult> {
  const { doc } = await loadForEdit(args.inputPath, args);
  const attached = await attachFile(doc, {
    filePath: args.attachmentPath,
    name: args.name,
    description: args.description,
    mimeType: args.mimeType,
    relationship: args.relationship,
  });

  const warnings: string[] = [];
  if (!args.relationship) {
    warnings.push(
      'No "relationship" given, so the attachment is marked Unspecified. ' +
        'PDF/A-3 requires a meaningful AFRelationship — use "Data" for machine-readable ' +
        'counterparts of the document (e.g. an invoice CSV/XML) or "Source" for the data it came from.',
    );
  }

  logger.info(
    'Editor',
    `Attached ${attached.name} (${attached.bytes} bytes, ${attached.mimeType})`,
  );
  const saved = await saveEdited(doc, args);
  return {
    ...saved,
    warnings: warnings.length > 0 ? warnings : undefined,
    attachment: attached,
    attachments: listEmbeddedFiles(doc).map((f) => f.name),
  };
}

export async function stampPageNumbers(args: StampPageNumbersArgs): Promise<StampResult> {
  const { doc } = await loadForEdit(args.inputPath, args);
  const total = doc.getPageCount();

  const format = args.format ?? STAMP_DEFAULTS.format;
  const position = args.position ?? STAMP_DEFAULTS.position;
  const margin = args.margin ?? STAMP_DEFAULTS.margin;
  const fontSize = args.fontSize ?? STAMP_DEFAULTS.fontSize;
  const startAt = args.startAt ?? STAMP_DEFAULTS.startAt;
  const color = parseHexColor(args.color ?? STAMP_DEFAULTS.color);

  const targets = args.pages
    ? parsePageSpec(args.pages, total)
    : Array.from({ length: total }, (_, i) => i + 1);

  // 刻むテキストを先に確定させる。フォントのサブセットは「実際に描く文字」に依存するため
  // （ADR-7/8）、番号を振り終えてから埋め込む必要がある。
  const stamps = targets.map((pageNo, i) => ({
    page: doc.getPage(pageNo - 1),
    text: formatPageNumber(format, startAt + i, total),
  }));

  const source = await openFont(args.fontPath);
  const texts = stamps.map((s) => s.text);
  for (const t of texts) assertRenderable(t, source);
  const applied = applyMissingGlyphPolicy(texts, source, 'error');
  const loaded = await embedFontFor(doc, source, applied.texts);

  const tagged = isTagged(doc);
  for (const [i, stamp] of stamps.entries()) {
    stampPage(stamp.page, applied.texts[i], {
      font: loaded.font,
      fontSize,
      color,
      position,
      margin,
      // タグ付き PDF ではページ番号を Artifact にする（PDF/UA 7.1-3）
      markArtifact: tagged ? (page, draw) => markArtifactOnPage(doc, page, draw) : undefined,
    });
  }

  logger.info(
    'Editor',
    `Stamped ${stamps.length} page(s)${tagged ? ' as artifacts (tagged PDF)' : ''}`,
  );
  const saved = await saveEdited(doc, args);
  return { ...saved, stamped: stamps.length, artifact: tagged };
}

export async function addWatermark(args: AddWatermarkArgs): Promise<WatermarkResult> {
  const { doc } = await loadForEdit(args.inputPath, args);
  const total = doc.getPageCount();

  const fontSize = args.fontSize ?? WATERMARK_DEFAULTS.fontSize;
  const opacity = args.opacity ?? WATERMARK_DEFAULTS.opacity;
  const angle = args.angle ?? WATERMARK_DEFAULTS.angle;
  const behind = args.behind ?? WATERMARK_DEFAULTS.behind;
  const color = parseHexColor(args.color ?? WATERMARK_DEFAULTS.color);

  const targets = args.pages
    ? parsePageSpec(args.pages, total)
    : Array.from({ length: total }, (_, i) => i + 1);

  // 透かし文字も create 系と同じ font-manager を通す（harfbuzz サブセット・グリフ検査）
  const source = await openFont(args.fontPath);
  assertRenderable(args.text, source);
  const applied = applyMissingGlyphPolicy([args.text], source, 'error');
  const loaded = await embedFontFor(doc, source, applied.texts);

  const tagged = isTagged(doc);
  for (const pageNo of targets) {
    watermarkPage(doc.getPage(pageNo - 1), applied.texts[0], {
      font: loaded.font,
      fontSize,
      color,
      opacity,
      angle,
      behind,
      // タグ付き PDF では透かしを Artifact にする（PDF/UA 7.1-3）
      markArtifact: tagged ? (page, draw) => markArtifactOnPage(doc, page, draw) : undefined,
    });
  }

  logger.info(
    'Editor',
    `Watermarked ${targets.length} page(s)${behind ? ' behind content' : ''}${tagged ? ' as artifacts' : ''}`,
  );
  const saved = await saveEdited(doc, args);
  return { ...saved, watermarked: targets.length, artifact: tagged };
}

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
  const loaded = await embedFontFor(doc, source, applied.texts);
  refreshAppearances(form, loaded.font);
  return { warnings: applied.warnings };
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

/**
 * タグ付き PDF のフォームを PDF/UA-1 準拠へ修復する（B-6）。
 *
 * fill_form は「入力が準拠していれば出力も準拠」（構造木に触らない）だが、
 * タグ付き PDF に AcroForm が**あるだけ**では PDF/UA-1 に通らない。本ツールが
 * 7.18.4-1（Widget を Form 構造要素に内包）/ 7.18.3-1（/Tabs S）/
 * 7.18.1-3（フィールドに /TU）を後付けで満たす。
 *
 * タグ無し文書は対象外（フォームのためだけに構造木を作り始めない —
 * ゼロからのタグ付けは create 系の tagged: true、既存文書の完全なタグ付けは
 * Tier C の ensure_tagged の領分）。
 */
export async function tagFormFields(args: TagFormFieldsArgs): Promise<TagFormFieldsResult> {
  const { doc } = await loadForEdit(args.inputPath, args);

  if (!isTagged(doc)) {
    throw new PdfWriterError(
      `"${args.inputPath}" is not a tagged PDF, so there is no structure tree to repair. ` +
        'tag_form_fields fixes forms inside already-tagged PDFs (PDF/UA-1 7.18.4).',
      'INVALID_ARGUMENT',
      {
        hint:
          'To produce a tagged PDF from scratch, use the create tools with "tagged": true. ' +
          'Full tagging of an existing untagged PDF (ensure_tagged) is a future Tier C feature.',
      },
    );
  }

  const form = doc.getForm();
  if (form.hasXFA()) {
    throw new PdfWriterError(
      'This PDF uses XFA forms, which pdf-writer-mcp does not support.',
      'UNSUPPORTED_PDF_FEATURE',
    );
  }
  if (form.getFields().length === 0) {
    throw invalidArg(`"${args.inputPath}" has no AcroForm fields to tag.`);
  }

  const outcome = tagWidgets(doc, args.labels ?? {});

  const warnings: string[] = [];
  if (outcome.unlabeled.length > 0) {
    warnings.push(
      `No label given for ${outcome.unlabeled.length} field(s); the field name was used as /TU ` +
        `(${outcome.unlabeled.join(', ')}). Pass "labels" with human-readable names — ` +
        'screen readers announce /TU, and "user.name" reads poorly.',
    );
  }
  if (outcome.orphaned.length > 0) {
    warnings.push(
      `${outcome.orphaned.length} widget(s) were not found in any page's /Annots and were left ` +
        `untouched (${outcome.orphaned.join(', ')}).`,
    );
  }

  logger.info(
    'Editor',
    `Tagged ${outcome.tagged} widget(s) into Form structure elements` +
      (outcome.skipped > 0 ? `, ${outcome.skipped} already tagged` : ''),
  );

  // 値は変えないので pdf-lib の外観再生成（Helvetica）を走らせない
  const saved = await saveEdited(doc, args, { updateFieldAppearances: false });
  return {
    ...saved,
    taggedWidgets: outcome.tagged,
    skippedWidgets: outcome.skipped,
    fields: listFields(doc),
    warnings: warnings.length > 0 ? warnings : undefined,
  };
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
