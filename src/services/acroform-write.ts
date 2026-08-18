/**
 * フィールドに値を書く —— Phase 3 の L4′.2（フォーム組の受け皿 #2）。
 *
 * | 要件 | 何をするか |
 * |---|---|
 * | R-12.7.5.2.3-4 / -5 | チェックボックスの `/V` は状態の**名前**で、`/AS` も同じ値にする |
 * | R-12.7.5.2.4-3 | ラジオも同じ。`/V` と `/AS` が食い違ったら `/AS` が使われる（-4） |
 * | Table 234 `/I` | 複数選択のとき、`/Opt` の中の位置を昇順で持つ |
 * | Table 229 bit 17 | プッシュボタンは値を持たない（R-12.7.5.2.2-2） |
 *
 * 🔴 **チェックボックス・ラジオの `/AP` は作り直さない。** R-12.7.5.2.3-2 は
 * 「各状態の外観は appearance dictionary に定義される」と言っており、値を入れる操作で
 * 変わるのは `/V` と `/AS` だけである。旧実装（pdf-lib の `updateFieldAppearances`）は
 * 値を入れたフィールドの外観を描き直すので、**文書作成者が用意した印の絵を上書きしていた**。
 */

import { type CosObject, type CosRef, dictGetRaw, type PdfDocumentEditor } from 'normativepdf';
import {
  type AcroField,
  type AcroForm,
  choiceOptions,
  type FieldValue,
  FF_MULTI_SELECT,
  FF_READ_ONLY,
  hasFlag,
  unknownFieldError,
} from './acroform-read.js';
import { textOf } from './cos-read.js';
import { arr, int, name, textString } from './cos.js';

function typeError(field: AcroField, expected: string, got: FieldValue): Error {
  return new Error(
    `Form field "${field.name}" is a ${field.kind} field and expects ${expected}, got ${JSON.stringify(got)}`,
  );
}

/** 辞書を 1 つ書き換える小物。読み直してから足すので、同じ相手を続けて触れる */
async function patch(
  editor: PdfDocumentEditor,
  ref: CosRef,
  changes: Iterable<readonly [string, CosObject]>,
): Promise<void> {
  const current = await editor.resolve(ref);
  if (current.kind !== 'dict') return;
  const entries = new Map<string, CosObject>(current.entries);
  for (const [key, value] of changes) entries.set(key, value);
  editor.set(ref.objectNumber, { kind: 'dict', entries }, ref.generationNumber);
}

/** 値を 1 件適用する。フィールド種別と値の型が合わなければエラー */
export async function applyFieldValue(
  editor: PdfDocumentEditor,
  form: AcroForm,
  fieldName: string,
  value: FieldValue,
): Promise<AcroField> {
  const field = form.fields.find((f) => f.name === fieldName);
  if (field === undefined) throw unknownFieldError(fieldName, form);

  switch (field.kind) {
    case 'text':
      if (typeof value !== 'string' && typeof value !== 'number') {
        throw typeError(field, 'a string or number', value);
      }
      await patch(editor, field.ref, [['V', textString(String(value))]]);
      return field;

    case 'checkbox': {
      // MCP 越しに "true" / "false" が来ることもあるため文字列も受ける
      const on =
        typeof value === 'boolean'
          ? value
          : value === 'true'
            ? true
            : value === 'false'
              ? false
              : undefined;
      if (on === undefined) throw typeError(field, 'a boolean', value);
      await setButtonState(editor, field, on ? (field.widgets[0]?.onState ?? null) : null);
      return field;
    }

    case 'dropdown':
    case 'optionlist': {
      const selection =
        typeof value === 'string' ? [value] : Array.isArray(value) ? value : undefined;
      if (selection === undefined) throw typeError(field, 'a string or array of strings', value);
      const options = await choiceOptions(editor, field);
      const indices: number[] = [];
      for (const wanted of selection) {
        const index = options.findIndex((o) => o.display === wanted);
        if (index < 0) {
          throw new Error(
            `Form field "${field.name}" has no option "${wanted}". Available options: ${options
              .map((o) => o.display)
              .join(', ')}`,
          );
        }
        indices.push(index);
      }
      const changes: [string, CosObject][] = [
        [
          'V',
          selection.length === 1
            ? textString(selection[0] as string)
            : arr(selection.map((s) => textString(s))),
        ],
      ];
      // Table 234 `/I`: 複数選択のときだけ、位置を昇順で持つ
      if (selection.length > 1 && hasFlag(field.flags, FF_MULTI_SELECT)) {
        changes.push(['I', arr([...indices].sort((a, b) => a - b).map((i) => int(i)))]);
      }
      await patch(editor, field.ref, changes);
      return field;
    }

    case 'radio': {
      if (typeof value !== 'string') throw typeError(field, 'a string', value);
      const options = await radioOptionNames(editor, field);
      const index = options.findIndex((o) => o === value);
      if (index < 0) {
        throw new Error(
          `Form field "${field.name}" has no option "${value}". Available options: ${options.join(', ')}`,
        );
      }
      await setButtonState(editor, field, field.widgets[index]?.onState ?? null);
      return field;
    }

    default:
      throw new Error(
        `Form field "${field.name}" is a ${field.kind} field and cannot be filled by fill_form.` +
          (field.kind === 'signature'
            ? ' Digital signing is out of scope for pdf-writer-mcp.'
            : ' Only text, checkbox, dropdown, optionlist and radio fields are fillable.'),
      );
  }
}

/**
 * ボタン系の状態を立てる。
 *
 * `/V` は選んだ状態の名前、各 Widget の `/AS` は「自分がその状態なら同じ名前、
 * そうでなければ `Off`」（R-12.7.5.2.3-5 / R-12.7.5.2.4-3）。
 * `on` が null なら全部 `Off`。
 */
async function setButtonState(
  editor: PdfDocumentEditor,
  field: AcroField,
  on: string | null,
): Promise<void> {
  await patch(editor, field.ref, [['V', name(on ?? 'Off')]]);
  for (const widget of field.widgets) {
    const state = on !== null && widget.onState === on ? on : 'Off';
    await patch(editor, widget.ref, [['AS', name(state)]]);
  }
}

/** ラジオの選択肢名（`/Opt` があればそれ、無ければ各 Widget の「入」状態） */
async function radioOptionNames(
  editor: PdfDocumentEditor,
  field: AcroField,
): Promise<string[]> {
  const raw = dictGetRaw(field.dict, 'Opt');
  if (raw !== undefined && raw.kind !== 'null') {
    const resolved = await editor.resolve(raw);
    if (resolved.kind === 'array') {
      const out: string[] = [];
      for (const item of resolved.items) {
        const value = await editor.resolve(item);
        out.push(textOf(value) ?? '');
      }
      return out;
    }
  }
  return field.widgets.map((w) => w.onState ?? '');
}

/** 読み取り専用フィールドへの書き込みを警告として拾う（Table 227 bit 1） */
export function readOnlyWarnings(form: AcroForm, names: readonly string[]): string[] {
  const warnings: string[] = [];
  for (const fieldName of names) {
    const field = form.fields.find((f) => f.name === fieldName);
    if (field !== undefined && hasFlag(field.flags, FF_READ_ONLY)) {
      warnings.push(
        `Field "${fieldName}" is marked read-only (/Ff bit 1); its value was set anyway.`,
      );
    }
  }
  return warnings;
}
