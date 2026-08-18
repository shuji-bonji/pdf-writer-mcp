/**
 * `fill_form` / `flatten_form` —— Phase 3 の L4′.2（16〜17 本目）。
 *
 * どちらも「値を確定させてから外観を作り直す」ところを共有する。
 *
 * 🔴 **外観を作り直すのは可変テキスト（`/FT /Tx` と `/FT /Ch`）だけである。**
 * チェックボックスとラジオの外観は R-12.7.5.2.3-2 のとおり文書側にあり、値を入れる
 * 操作で変わるのは `/V` と `/AS` だけ（R-12.7.5.2.3-5）。旧実装は値を入れた
 * フィールドの外観を丸ごと描き直すので、**文書作成者が用意した印の絵を上書きしていた**。
 *
 * 🔴 **サブセットの入力は「実際に描く文字」に限る**（ADR-7/8）。値を適用し終えてから
 * 集める。
 */

import { invalidArg, NEXT_ACTIONS, PdfWriterError } from '../errors.js';
import type {
  FillFormArgs,
  FlattenFormArgs,
  FormResult,
} from '../types/index.js';
import { logger } from '../utils/logger.js';
import {
  type AcroField,
  type AcroForm,
  choiceOptions,
  describeField,
  type FormFieldInfo,
  fieldValue,
  listFields,
  readAcroForm,
  usesXfa,
} from './acroform-read.js';
import { ensureDefaultResources, refreshTextAppearance } from './acroform-appearance.js';
import { flattenForm as bakeForm } from './acroform-flatten.js';
import { applyFieldValue, readOnlyWarnings } from './acroform-write.js';
import { textOf } from './cos-read.js';
import type { OpenedForEdit } from './edit-open.js';
import { openForEdit } from './edit-open.js';
import { EMBEDDED_FONT_OBJECTS, fontHostFor, STANDARD_FONT_OBJECTS } from './font-pool.js';
import { applyMissingGlyphPolicy, embedFontFor, openFont } from './font-manager.js';
import { saveOpened } from './output-edited.js';
import { assertRenderable } from './renderers/text.js';
import { isTaggedDoc } from './tagged-cos.js';

/** 可変テキスト（Table 228 が働くフィールド） */
const isVariableText = (field: AcroField): boolean =>
  field.kind === 'text' || field.kind === 'dropdown' || field.kind === 'optionlist';

/** そのフィールドの外観に実際に描かれる文字 */
async function renderedTextOf(opened: OpenedForEdit, field: AcroField): Promise<string> {
  const value = await fieldValue(opened.editor, field);
  if (field.kind === 'text') return textOf(value) ?? '';
  if (value === undefined) return '';
  if (value.kind === 'string') return textOf(value) ?? '';
  if (value.kind === 'array') {
    const parts: string[] = [];
    for (const item of value.items) {
      const text = textOf(await opened.editor.resolve(item));
      if (text !== undefined) parts.push(text);
    }
    return parts.join(', ');
  }
  return '';
}

/**
 * 外観を作り直す対象を決め、フォントを埋め込み、`/DR` を満たしてから描き直す。
 *
 * `targets` が空でも `/DR` は満たす —— R-12.7.4.3-7 の shall は、writer が
 * 何も描かなくても文書に残る要求である。
 */
async function refreshAppearances(
  opened: OpenedForEdit,
  form: AcroForm,
  targets: readonly AcroField[],
  fontPath: string | undefined,
): Promise<string[]> {
  const fields = targets.filter(isVariableText);
  const texts: string[] = [];
  for (const field of fields) texts.push(await renderedTextOf(opened, field));
  // 編集可能ドロップダウンでは選択肢そのものが描かれうるので、字を集める側には入れる
  for (const field of fields) {
    if (field.kind === 'text') continue;
    for (const option of await choiceOptions(opened.editor, field)) texts.push(option.display);
  }

  const source = await openFont(fontPath);
  for (const text of texts) assertRenderable(text, source);
  const applied = applyMissingGlyphPolicy(texts, source, 'error');
  const host = await fontHostFor(
    opened.editor,
    source.isStandard || !source.bytes ? STANDARD_FONT_OBJECTS : EMBEDDED_FONT_OBJECTS,
  );
  const loaded = await embedFontFor(host, source, applied.texts);
  const context = { form, font: loaded.font, fontName: loaded.font.postScriptName };

  for (const [index, field] of fields.entries()) {
    await refreshTextAppearance(opened.editor, context, field, applied.texts[index] as string);
  }

  const warnings = [...applied.warnings];
  const { unresolvedDaFonts } = await ensureDefaultResources(opened.editor, form, context);
  if (unresolvedDaFonts.length > 0) {
    // 入力が既に壊れているケース（§12.7.4.3 の `/DA` ↔ `/DR` 整合が元から取れていない）
    warnings.push(
      `The /DA of ${unresolvedDaFonts.length} field(s) names a font that is not in the AcroForm ` +
        `/DR resources and could not be found in their appearance streams either ` +
        `(${unresolvedDaFonts.map((f) => `/${f}`).join(', ')}). This came in with the input. ` +
        'ISO 32000-2 §12.7.4.3 requires the /DA font to resolve via /DR; if a viewer regenerates ' +
        "those fields' appearances it will fall back to a default font.",
    );
  }
  return warnings;
}

/** `/AcroForm` を読み、XFA と空フォームを断る */
async function readFillable(opened: OpenedForEdit, inputPath: string): Promise<AcroForm> {
  const form = await readAcroForm(opened.editor);
  if (form !== null && usesXfa(form)) {
    throw new PdfWriterError(
      'This PDF uses XFA forms, which pdf-writer-mcp does not support. ' +
        '(XFA is deprecated in ISO 32000-2 and forbidden by PDF/UA-1 7.15.)',
      'UNSUPPORTED_PDF_FEATURE',
    );
  }
  if (form === null || form.fields.length === 0) {
    throw invalidArg(`"${inputPath}" has no AcroForm fields to fill.`);
  }
  return form;
}

/**
 * フラット化の判断をここに一元化する。
 *
 * flatten は Widget 注釈を消して外観をページ内容に焼き込む。タグ付き文書では
 * `Form` 構造要素の参照先（OBJR）が消えるうえ、焼き込まれた図形はタグの付かない
 * 内容になるため、PDF/UA-1（7.1 / 7.18.4）に反する。
 */
async function assertFlattenAllowed(
  opened: OpenedForEdit,
  allowBreakingTags: boolean | undefined,
  warnings: string[],
): Promise<void> {
  if (!(await isTaggedDoc(opened.editor))) return;
  if (!allowBreakingTags) {
    throw new PdfWriterError(
      'Flattening would break the structure tree of this tagged PDF: it removes the Widget ' +
        'annotations that the Form structure elements point to, and bakes their appearance into ' +
        'the page as untagged content (violating PDF/UA-1 7.1 and 7.18.4). ' +
        'Omit flatten to keep the form interactive.',
      'TAGGED_PDF',
      { retryable: true, next_actions: [NEXT_ACTIONS.allowBreakingTags()] },
    );
  }
  // 文言は旧実装のまま。移行で利用者向けの文字列を変えない
  warnings.push(
    'Flattened a tagged PDF: the Form structure elements now point to removed widgets and the ' +
      'baked-in appearances are untagged. The document is no longer PDF/UA-1 conforming.',
  );
}

export async function fillForm(args: FillFormArgs): Promise<FormResult> {
  const opened = await openForEdit(args.inputPath, args);
  const form = await readFillable(opened, args.inputPath);

  const names = Object.keys(args.fields);
  if (names.length === 0) throw invalidArg('fields must contain at least one field to fill');
  const touched: AcroField[] = [];
  for (const fieldName of names) {
    touched.push(
      await applyFieldValue(opened.editor, form, fieldName, args.fields[fieldName] as never),
    );
  }

  const warnings = readOnlyWarnings(form, names);
  warnings.push(...(await refreshAppearances(opened, form, touched, args.fontPath)));

  // 焼き込む前に説明を採る（`/AcroForm` を消した後では読めない）
  const fields: FormFieldInfo[] = [];
  for (const field of form.fields) fields.push(await describeField(opened.editor, field));

  let flattened = false;
  if (args.flatten) {
    await assertFlattenAllowed(opened, args.allowBreakingTags, warnings);
    const outcome = await bakeForm(opened.editor, form);
    flattened = true;
    warnings.push(...missingAppearanceWarnings(outcome.withoutAppearance));
  }

  logger.info('Editor', `Filled ${names.length} form field(s)${flattened ? ' and flattened' : ''}`);
  const saved = await saveOpened(opened, args);
  return {
    ...saved,
    filled: names.length,
    flattened,
    fields: flattened ? [] : fields,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

export async function flattenFormTool(args: FlattenFormArgs): Promise<FormResult> {
  const opened = await openForEdit(args.inputPath, args);
  const form = await readAcroForm(opened.editor);
  if (form !== null && usesXfa(form)) {
    throw new PdfWriterError(
      'This PDF uses XFA forms, which pdf-writer-mcp does not support.',
      'UNSUPPORTED_PDF_FEATURE',
    );
  }
  if (form === null || form.fields.length === 0) {
    throw invalidArg(`"${args.inputPath}" has no AcroForm fields to flatten.`);
  }

  const warnings: string[] = [];
  // 焼き込む前に外観を今の値へ揃える（入力の外観が値と食い違っていることがある）
  warnings.push(...(await refreshAppearances(opened, form, form.fields, args.fontPath)));
  await assertFlattenAllowed(opened, args.allowBreakingTags, warnings);

  const fieldCount = form.fields.length;
  const outcome = await bakeForm(opened.editor, form);
  warnings.push(...missingAppearanceWarnings(outcome.withoutAppearance));

  logger.info('Editor', `Flattened ${fieldCount} form field(s)`);
  const saved = await saveOpened(opened, args);
  return {
    ...saved,
    filled: 0,
    flattened: true,
    fields: [],
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

/** R-12.5.5-23: `/AS` の指す外観が無ければ何も描かない。黙って消さずに報告する */
function missingAppearanceWarnings(withoutAppearance: readonly string[]): string[] {
  if (withoutAppearance.length === 0) return [];
  return [
    `${withoutAppearance.length} widget(s) had no normal appearance to bake and were removed ` +
      `without drawing anything (${withoutAppearance.join(', ')}). ISO 32000-2 §12.5.5 leaves the ` +
      'appearance of those states undefined, so there was nothing to draw.',
  ];
}

/** 旧経路との互換のため、`listFields` をここからも輸出する */
export { listFields };
