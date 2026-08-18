/**
 * 独立した読み手としての pdf-lib —— テスト専用。
 *
 * `npm test` の値は「writer が書いたバイト列を**別の実装**で読み戻す」ところにある
 * （ADR-0004「二面で測る」）。ここに置いてあるのは、writer の src からは
 * 使われなくなったが**テストの読み手としては要る** pdf-lib の関数である。
 *
 * 🔴 **src へ戻さないこと。** 戻すと writer が自分の書いたものを自分で読み戻す形になり、
 * 共有の誤りが見えなくなる（GUARDS.md の T-2）。
 */

import {
  PDFArray,
  PDFButton,
  PDFCheckBox,
  PDFDict,
  type PDFDocument,
  PDFDropdown,
  type PDFField,
  PDFName,
  PDFOptionList,
  PDFRadioGroup,
  PDFSignature,
  PDFTextField,
} from 'pdf-lib';

/** タグ付き PDF か（§14.7.1: `/StructTreeRoot` と `/MarkInfo /Marked true`） */
export function isTagged(doc: PDFDocument): boolean {
  const root = doc.catalog.lookup(PDFName.of('StructTreeRoot'));
  if (!(root instanceof PDFDict)) return false;
  const markInfo = doc.catalog.lookup(PDFName.of('MarkInfo'));
  if (!(markInfo instanceof PDFDict)) return false;
  const marked = markInfo.lookup(PDFName.of('Marked'));
  return marked?.toString() === 'true';
}

export interface EmbeddedFileInfo {
  name: string;
  description?: string;
  relationship?: string;
  mimeType?: string;
}

export function listEmbeddedFiles(doc: PDFDocument): EmbeddedFileInfo[] {
  const names = doc.catalog.lookup(PDFName.of('Names'));
  if (!(names instanceof PDFDict)) return [];
  const ef = names.lookup(PDFName.of('EmbeddedFiles'));
  if (!(ef instanceof PDFDict)) return [];
  const arr = ef.lookup(PDFName.of('Names'));
  if (!(arr instanceof PDFArray)) return [];

  const out: EmbeddedFileInfo[] = [];
  // 名前ツリーの /Names は [name1, spec1, name2, spec2, ...]
  for (let i = 0; i + 1 < arr.size(); i += 2) {
    const nameObj = arr.lookup(i);
    const spec = arr.lookup(i + 1);
    const name = decodeName(nameObj);
    if (name === null) continue;

    const info: EmbeddedFileInfo = { name };
    if (spec instanceof PDFDict) {
      const desc = spec.lookup(PDFName.of('Desc'));
      const decoded = decodeName(desc);
      if (decoded) info.description = decoded;
      const rel = spec.lookup(PDFName.of('AFRelationship'));
      if (rel instanceof PDFName) info.relationship = rel.decodeText();
      const efDict = spec.lookup(PDFName.of('EF'));
      if (efDict instanceof PDFDict) {
        const stream = efDict.get(PDFName.of('F'));
        const resolved = stream ? doc.context.lookup(stream) : undefined;
        const subtype =
          resolved && 'dict' in resolved
            ? (resolved as { dict: PDFDict }).dict.get(PDFName.of('Subtype'))
            : undefined;
        if (subtype instanceof PDFName) info.mimeType = subtype.decodeText();
      }
    }
    out.push(info);
  }
  return out;
}

/** PDFString / PDFHexString のいずれでもテキストとして読む */
function decodeName(value: unknown): string | null {
  if (value && typeof value === 'object' && 'decodeText' in value) {
    return (value as { decodeText(): string }).decodeText();
  }
  return null;
}

// --------------------------------------------------------------------------- AcroForm

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
