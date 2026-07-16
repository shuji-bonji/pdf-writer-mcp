/**
 * AcroForm
 *
 * 既存 PDF の対話フォーム（AcroForm）にフィールド値を流し込み、必要ならフラット化する。
 *
 * 設計の要点:
 *   - **フォント**: pdf-lib は save() のとき既定で全フィールドの外観を作り直す。その際に使う
 *     フォントは `form.getDefaultFont()` ＝ Helvetica なので、日本語の値は WinAnsi で
 *     エンコードできず例外になる。そこで
 *       1. 自前で `form.updateFieldAppearances(ourFont)` を呼び、
 *       2. `save({ updateFieldAppearances: false })` で pdf-lib の再生成を止める
 *     という手順を踏む。flatten() も内部で同じことをするため同様に止める。
 *   - **サブセット**: 外観に描かれるのは TextField / Dropdown / OptionList の文字だけ
 *     （CheckBox・RadioGroup の印は pdf-lib がパス描画する）。値を適用した後の
 *     「実際に描かれる文字」を集めてサブセットの入力にする（collectRenderedTexts）。
 *   - **タグ付き PDF**: PDF/UA-1 7.18.4 は「Widget は Form タグに入れる」ことを要求する。
 *     値を入れるだけなら構造木は変わらないので準拠は保たれるが、flatten は Widget ごと
 *     消して外観を素のページ内容に焼き込むため、Form 構造要素が宙に浮き準拠が壊れる。
 *     そのため flatten はタグ付き文書では既定で拒否する。
 */

import {
  PDFArray,
  PDFButton,
  PDFCheckBox,
  PDFDict,
  type PDFDocument,
  PDFDropdown,
  type PDFField,
  type PDFFont,
  type PDFForm,
  PDFName,
  PDFOptionList,
  PDFRadioGroup,
  PDFRef,
  PDFSignature,
  PDFStream,
  PDFTextField,
} from 'pdf-lib';

/** フィールドに設定できる値 */
export type FieldValue = string | number | boolean | string[];

export type FieldKind =
  | 'text'
  | 'checkbox'
  | 'dropdown'
  | 'optionlist'
  | 'radio'
  | 'button'
  | 'signature'
  | 'unknown';

export interface FormFieldInfo {
  name: string;
  kind: FieldKind;
  /** 現在値（checkbox は 'true'/'false'、複数選択は配列） */
  value?: string | string[] | boolean;
  /** 選択肢（dropdown / optionlist / radio） */
  options?: string[];
  readOnly: boolean;
  required: boolean;
}

export function kindOf(field: PDFField): FieldKind {
  if (field instanceof PDFTextField) return 'text';
  if (field instanceof PDFCheckBox) return 'checkbox';
  if (field instanceof PDFDropdown) return 'dropdown';
  if (field instanceof PDFOptionList) return 'optionlist';
  if (field instanceof PDFRadioGroup) return 'radio';
  if (field instanceof PDFSignature) return 'signature';
  if (field instanceof PDFButton) return 'button';
  return 'unknown';
}

/** フィールドを 1 件、値・選択肢つきで説明する */
export function describeField(field: PDFField): FormFieldInfo {
  const info: FormFieldInfo = {
    name: field.getName(),
    kind: kindOf(field),
    readOnly: field.isReadOnly(),
    required: field.isRequired(),
  };
  if (field instanceof PDFTextField) {
    info.value = field.getText() ?? '';
  } else if (field instanceof PDFCheckBox) {
    info.value = field.isChecked();
  } else if (field instanceof PDFDropdown) {
    info.value = field.getSelected();
    info.options = field.getOptions();
  } else if (field instanceof PDFOptionList) {
    info.value = field.getSelected();
    info.options = field.getOptions();
  } else if (field instanceof PDFRadioGroup) {
    info.value = field.getSelected() ?? '';
    info.options = field.getOptions();
  }
  return info;
}

export function listFields(doc: PDFDocument): FormFieldInfo[] {
  return doc.getForm().getFields().map(describeField);
}

/** 「見つからないフィールド名」を、実在する名前つきで伝えるためのエラー */
function unknownFieldError(name: string, form: PDFForm): Error {
  const available = form
    .getFields()
    .map((f) => `${f.getName()} (${kindOf(f)})`)
    .join(', ');
  return new Error(
    available.length > 0
      ? `Form field "${name}" not found. Available fields: ${available}`
      : `Form field "${name}" not found — this PDF has no AcroForm fields.`,
  );
}

function typeError(name: string, kind: FieldKind, expected: string, got: FieldValue): Error {
  return new Error(
    `Form field "${name}" is a ${kind} field and expects ${expected}, got ${JSON.stringify(got)}`,
  );
}

/**
 * 値を 1 件適用する。フィールド種別と値の型が合わなければエラー。
 */
export function applyFieldValue(form: PDFForm, name: string, value: FieldValue): void {
  const field = form.getFieldMaybe(name);
  if (!field) throw unknownFieldError(name, form);
  const kind = kindOf(field);

  if (field instanceof PDFTextField) {
    if (typeof value !== 'string' && typeof value !== 'number') {
      throw typeError(name, kind, 'a string or number', value);
    }
    field.setText(String(value));
    return;
  }

  if (field instanceof PDFCheckBox) {
    // MCP 越しに "true"/"false" が来ることもあるため文字列も受ける
    const on =
      typeof value === 'boolean'
        ? value
        : value === 'true'
          ? true
          : value === 'false'
            ? false
            : undefined;
    if (on === undefined) throw typeError(name, kind, 'a boolean', value);
    if (on) field.check();
    else field.uncheck();
    return;
  }

  if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
    const selection =
      typeof value === 'string' ? [value] : Array.isArray(value) ? value : undefined;
    if (!selection) throw typeError(name, kind, 'a string or array of strings', value);
    const options = field.getOptions();
    for (const s of selection) {
      if (!options.includes(s)) {
        throw new Error(
          `Form field "${name}" has no option "${s}". Available options: ${options.join(', ')}`,
        );
      }
    }
    field.clear();
    field.select(selection);
    return;
  }

  if (field instanceof PDFRadioGroup) {
    if (typeof value !== 'string') throw typeError(name, kind, 'a string', value);
    const options = field.getOptions();
    if (!options.includes(value)) {
      throw new Error(
        `Form field "${name}" has no option "${value}". Available options: ${options.join(', ')}`,
      );
    }
    field.select(value);
    return;
  }

  throw new Error(
    `Form field "${name}" is a ${kind} field and cannot be filled by fill_form.` +
      (kind === 'signature'
        ? ' Digital signing is out of scope for pdf-writer-mcp.'
        : ' Only text, checkbox, dropdown, optionlist and radio fields are fillable.'),
  );
}

/**
 * 外観生成で実際に描画されうる文字を集める（＝サブセットに含めるべき文字）。
 *
 * CheckBox / RadioGroup の印は pdf-lib がパスで描くためフォント不要。
 * 値を適用した後に呼ぶこと。
 */
export function collectRenderedTexts(form: PDFForm): string[] {
  const texts: string[] = [];
  for (const field of form.getFields()) {
    if (field instanceof PDFTextField) {
      const t = field.getText();
      if (t) texts.push(t);
    } else if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
      // 選択肢は編集可能ドロップダウンで描かれうるため全部入れる
      texts.push(...field.getSelected(), ...field.getOptions());
    }
  }
  return texts;
}

/** 読み取り専用フィールドへの書き込みを警告として拾う */
export function readOnlyWarnings(form: PDFForm, names: string[]): string[] {
  const warnings: string[] = [];
  for (const name of names) {
    const field = form.getFieldMaybe(name);
    if (field?.isReadOnly()) {
      warnings.push(`Field "${name}" is marked read-only (/Ff bit 1); its value was set anyway.`);
    }
  }
  return warnings;
}

/**
 * 解決できない間接参照（宙吊り参照）を全オブジェクトから取り除く。
 *
 * なぜ必要か: pdf-lib の `PDFForm.flatten()` は内部で `removeField` を呼ぶが、
 * ページの `/Annots` から消しているのは **外観ストリームの参照**（findWidgetAppearanceRef）と
 * フィールド辞書自身の参照だけである。`addToPage` で作られたウィジェットは
 * フィールドの `/Kids` に置かれた**別オブジェクト**なので、その参照が `/Annots` に残る。
 * 結果、削除済みオブジェクトを指す参照が残り、poppler が `Invalid XRef entry` を出す。
 *
 * 宙吊り参照は解決すると undefined になるだけで意味を持たないため、取り除いて問題ない。
 * 戻り値は取り除いた参照の数。
 */
export function pruneDanglingRefs(doc: PDFDocument): number {
  const context = doc.context;
  const alive = new Set(context.enumerateIndirectObjects().map(([ref]) => ref.toString()));
  const isDangling = (v: unknown): boolean => v instanceof PDFRef && !alive.has(v.toString());

  let removed = 0;
  const seen = new Set<unknown>();
  const walk = (obj: unknown): void => {
    if (obj instanceof PDFRef || obj === undefined) return;
    if (seen.has(obj)) return;
    seen.add(obj);

    if (obj instanceof PDFStream) {
      walk(obj.dict);
      return;
    }
    if (obj instanceof PDFArray) {
      // 後ろから削ることで添字のずれを避ける
      for (let i = obj.size() - 1; i >= 0; i--) {
        const v = obj.get(i);
        if (isDangling(v)) {
          obj.remove(i);
          removed++;
        } else {
          walk(v);
        }
      }
      return;
    }
    if (obj instanceof PDFDict) {
      for (const [key, value] of obj.entries()) {
        if (isDangling(value)) {
          obj.delete(key);
          removed++;
        } else {
          walk(value);
        }
      }
    }
  };

  for (const [, obj] of context.enumerateIndirectObjects()) walk(obj);
  return removed;
}

/**
 * フラット化後の後始末。
 * フィールドが 1 つも残っていなければ AcroForm 自体を落とし、宙吊り参照を掃除する。
 */
export function cleanUpAfterFlatten(doc: PDFDocument): number {
  if (doc.getForm().getFields().length === 0) {
    // 対話要素が無くなった以上、空の AcroForm を残す意味はない
    doc.catalog.delete(PDFName.of('AcroForm'));
  }
  return pruneDanglingRefs(doc);
}

/**
 * 全フィールドの外観を、指定フォントで作り直す。
 * pdf-lib は dirty なフィールドのみ再生成するため、触っていないフィールドの
 * 既存外観（＝元のフォント）はそのまま残る。
 */
export function refreshAppearances(form: PDFForm, font: PDFFont): void {
  form.updateFieldAppearances(font);
}
