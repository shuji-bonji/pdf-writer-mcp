/**
 * AcroForm のフィールド木を読む —— Phase 3 の L4′.2（フォーム組の受け皿 #1）。
 *
 * `fill_form` / `flatten_form` / `tag_form_fields` の 3 本が共有する。
 * 旧実装は pdf-lib の `PDFForm` / `PDFField` クラス階層だった。
 *
 * | 要件 | 何を言っているか |
 * |---|---|
 * | R-12.7.4.1-1 | フィールド辞書は**間接オブジェクト**である |
 * | R-12.7.4.1-3 / -4 | Table 226 / 227 で inheritable と書かれた項目は祖先から継ぐ |
 * | R-12.7.4.1-5 | 継承の深さに上限を設けない |
 * | R-12.7.4.1-6 | `/Ff` のビットは 1（下位）から 32（上位）で数える |
 * | R-12.7.4.1-9 | 非終端フィールドの `/Kids` は子**フィールド**を指す |
 * | R-12.7.4.1-10 | 終端フィールドの `/Kids` は Widget 注釈を指す |
 * | R-12.7.4.1-11 | Widget が 1 つでフィールド辞書に併合されているなら `/Kids` は無い |
 * | R-12.7.4.2-2 | 完全修飾名は祖先の部分名を PERIOD で繋ぐ |
 * | R-12.7.4.2-4 | **`/T` を持たない辞書はフィールドではなく Widget である** |
 *
 * 🔴 **終端かどうかは `/Kids` の有無ではなく `/T` の有無で決める。**
 * R-12.7.4.2-4 が判定条件そのものを与えている ——「`/T` を持たない辞書はフィールドとは
 * みなされず、単に Widget 注釈である」。
 *
 * ⚠️ **旧実装（pdf-lib）も同じ規則で動いている**（`core/acroform/utils.js` の
 * `isNonTerminalAcroField`）。ただしその根拠は条文ではなく経験則として書かれている:
 * 「The spec is not entirely clear about how to determine whether a given dictionary
 * represents an acrofield or a widget annotation. So we will assume … `/T` …
 * This isn't a bullet proof solution」。ISO 32000-2 の R-12.7.4.2-4 は
 * **推測ではなく条文としてこれを言っている**ので、こちらは条文を根拠に書く。
 * 振る舞いは同じなので、この移行でオラクルに差は出ない。
 */

import {
  type CosDict,
  type CosObject,
  type CosRef,
  dictGetRaw,
  type PdfDocumentEditor,
} from 'normativepdf';
import { textOf } from './cos-read.js';

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
  /** 現在値（checkbox は真偽、複数選択は配列） */
  value?: string | string[] | boolean;
  /** 選択肢（dropdown / optionlist / radio） */
  options?: string[];
  readOnly: boolean;
  required: boolean;
}

/** 終端フィールドに属する Widget 注釈 1 つ */
export interface AcroWidget {
  readonly ref: CosRef;
  readonly dict: CosDict;
  /**
   * `/AP /N` の鍵のうち `Off` でないもの（＝この Widget の「入」状態の名前）。
   * `/AP /N` がストリーム 1 本（状態を持たない形）なら null。
   */
  readonly onState: string | null;
}

/** 終端フィールド 1 つ */
export interface AcroField {
  /** 完全修飾名（R-12.7.4.2-2） */
  readonly name: string;
  readonly ref: CosRef;
  readonly dict: CosDict;
  readonly kind: FieldKind;
  /** 継承を解決した `/Ff`（R-12.7.4.1-3） */
  readonly flags: number;
  readonly widgets: readonly AcroWidget[];
}

export interface AcroForm {
  readonly ref: CosRef | null;
  readonly dict: CosDict;
  /** `/Fields` の並び順に深さ優先で並べた終端フィールド */
  readonly fields: readonly AcroField[];
  /** 木を歩いて見たフィールド辞書の参照すべて（非終端も含む） */
  readonly nodes: readonly CosRef[];
}

// --------------------------------------------------------------------------- ビット

/** `/Ff` のビット位置（1 始まり）を値へ。R-12.7.4.1-6 */
const bit = (position: number): number => 1 << (position - 1);

/** Table 227（全種別に共通） */
export const FF_READ_ONLY = bit(1);
export const FF_REQUIRED = bit(2);
/** Table 229（ボタン） */
export const FF_RADIO = bit(16);
export const FF_PUSHBUTTON = bit(17);
/** Table 231（テキスト） */
export const FF_MULTILINE = bit(13);
export const FF_COMB = bit(25);
/** Table 233（選択） */
export const FF_COMBO = bit(18);
export const FF_MULTI_SELECT = bit(22);

export const hasFlag = (flags: number, flag: number): boolean => (flags & flag) !== 0;

// --------------------------------------------------------------------------- 読み取り

/** `/AcroForm` を読む。無ければ null */
export async function readAcroForm(editor: PdfDocumentEditor): Promise<AcroForm | null> {
  const rootRaw = dictGetRaw(editor.trailer(), 'Root');
  if (rootRaw === undefined) return null;
  const catalog = await editor.resolve(rootRaw);
  if (catalog.kind !== 'dict') return null;

  const acroRaw = dictGetRaw(catalog, 'AcroForm');
  if (acroRaw === undefined || acroRaw.kind === 'null') return null;
  const acro = await editor.resolve(acroRaw);
  if (acro.kind !== 'dict') return null;

  const fields: AcroField[] = [];
  const nodes: CosRef[] = [];
  const seen = new Set<string>();
  for (const kid of await arrayItems(editor, acro, 'Fields')) {
    await walk(editor, kid, '', fields, seen, nodes);
  }
  return { ref: acroRaw.kind === 'ref' ? acroRaw : null, dict: acro, fields, nodes };
}

/** XFA を使っているか（§12.7.8 / PDF/UA-1 7.15 が禁じる） */
export function usesXfa(form: AcroForm): boolean {
  const xfa = dictGetRaw(form.dict, 'XFA');
  return xfa !== undefined && xfa.kind !== 'null';
}

/**
 * フィールド木を 1 節点降りる。
 *
 * `/T` を持つものだけをフィールドとして扱う（R-12.7.4.2-4）。
 * 子に `/T` を持つものが 1 つでもあれば非終端、無ければ終端である。
 */
async function walk(
  editor: PdfDocumentEditor,
  nodeRaw: CosObject,
  prefix: string,
  out: AcroField[],
  seen: Set<string>,
  nodes: CosRef[],
): Promise<void> {
  if (nodeRaw.kind !== 'ref') return; // R-12.7.4.1-1: 直接オブジェクトのフィールドは無い
  const key = `${nodeRaw.objectNumber} ${nodeRaw.generationNumber}`;
  if (seen.has(key)) return; // 循環しているデータでも止まる
  seen.add(key);

  const node = await editor.resolve(nodeRaw);
  if (node.kind !== 'dict') return;

  const partial = textOf(await resolveMaybe(editor, dictGetRaw(node, 'T')));
  if (partial === undefined) return; // Widget であってフィールドではない
  const name = prefix === '' ? partial : `${prefix}.${partial}`;
  nodes.push(nodeRaw);

  const kids = await arrayItems(editor, node, 'Kids');
  const childFields: CosObject[] = [];
  const widgetRefs: CosRef[] = [];
  for (const kid of kids) {
    if (kid.kind !== 'ref') continue;
    const kidDict = await editor.resolve(kid);
    if (kidDict.kind !== 'dict') continue;
    if (dictGetRaw(kidDict, 'T') !== undefined) childFields.push(kid);
    else widgetRefs.push(kid);
  }

  if (childFields.length > 0) {
    for (const child of childFields) await walk(editor, child, name, out, seen, nodes);
    return;
  }

  // 終端。`/Kids` が無ければフィールド辞書自身が Widget である（R-12.7.4.1-11）
  const refs = widgetRefs.length > 0 ? widgetRefs : [nodeRaw];
  const widgets: AcroWidget[] = [];
  for (const ref of refs) {
    const dict = await editor.resolve(ref);
    if (dict.kind !== 'dict') continue;
    widgets.push({ ref, dict, onState: await onStateOf(editor, dict) });
  }

  const flags = await inheritedNumber(editor, node, 'Ff');
  out.push({
    name,
    ref: nodeRaw,
    dict: node,
    kind: kindOf(await inheritedName(editor, node, 'FT'), flags),
    flags,
    widgets,
  });
}

/** `/FT`（継承済み）と `/Ff` から種別を決める（§12.7.5） */
export function kindOf(fieldType: string | undefined, flags: number): FieldKind {
  switch (fieldType) {
    case 'Btn':
      if (hasFlag(flags, FF_PUSHBUTTON)) return 'button';
      return hasFlag(flags, FF_RADIO) ? 'radio' : 'checkbox';
    case 'Tx':
      return 'text';
    case 'Ch':
      return hasFlag(flags, FF_COMBO) ? 'dropdown' : 'optionlist';
    case 'Sig':
      return 'signature';
    default:
      return 'unknown';
  }
}

/** Widget の「入」状態の名前（`/AP /N` の鍵のうち `Off` でないもの）。R-12.7.5.2.3-3 */
async function onStateOf(editor: PdfDocumentEditor, widget: CosDict): Promise<string | null> {
  const ap = await resolveMaybe(editor, dictGetRaw(widget, 'AP'));
  if (ap === undefined || ap.kind !== 'dict') return null;
  const normal = await resolveMaybe(editor, dictGetRaw(ap, 'N'));
  if (normal === undefined || normal.kind !== 'dict') return null;
  for (const stateName of normal.entries.keys()) {
    if (stateName !== 'Off') return stateName;
  }
  return null;
}

// --------------------------------------------------------------------------- 継承

/**
 * 継承する項目を祖先まで辿って引く（R-12.7.4.1-3 / -4 / -5）。
 * 深さに上限を設けないので、循環しているデータのために辿った参照を覚えておく。
 */
async function inherited(
  editor: PdfDocumentEditor,
  field: CosDict,
  key: string,
): Promise<CosObject | undefined> {
  let node: CosDict | undefined = field;
  const seen = new Set<string>();
  while (node !== undefined) {
    const own = dictGetRaw(node, key);
    if (own !== undefined && own.kind !== 'null') return editor.resolve(own);
    const parent = dictGetRaw(node, 'Parent');
    if (parent === undefined || parent.kind !== 'ref') return undefined;
    const mark = `${parent.objectNumber} ${parent.generationNumber}`;
    if (seen.has(mark)) return undefined;
    seen.add(mark);
    const resolved = await editor.resolve(parent);
    node = resolved.kind === 'dict' ? resolved : undefined;
  }
  return undefined;
}

async function inheritedNumber(
  editor: PdfDocumentEditor,
  field: CosDict,
  key: string,
): Promise<number> {
  const value = await inherited(editor, field, key);
  return value?.kind === 'integer' ? value.value : 0;
}

async function inheritedName(
  editor: PdfDocumentEditor,
  field: CosDict,
  key: string,
): Promise<string | undefined> {
  const value = await inherited(editor, field, key);
  return value?.kind === 'name' ? value.value : undefined;
}

/**
 * 継承を解決した `/V`（R-12.7.4.1-3）。
 *
 * 🔴 **`field.dict` ではなく `field.ref` から読み直す。** `AcroField.dict` は
 * `readAcroForm` を呼んだ時点のスナップショットなので、値を書いた後に使うと
 * **書く前の値が返る**。
 */
export async function fieldValue(
  editor: PdfDocumentEditor,
  field: AcroField,
): Promise<CosObject | undefined> {
  const current = await editor.resolve(field.ref);
  return inherited(editor, current.kind === 'dict' ? current : field.dict, 'V');
}

// --------------------------------------------------------------------------- 値の読み出し

/** フィールドを 1 件、値・選択肢つきで説明する */
export async function describeField(
  editor: PdfDocumentEditor,
  field: AcroField,
): Promise<FormFieldInfo> {
  const info: FormFieldInfo = {
    name: field.name,
    kind: field.kind,
    readOnly: hasFlag(field.flags, FF_READ_ONLY),
    required: hasFlag(field.flags, FF_REQUIRED),
  };
  const value = await fieldValue(editor, field);

  switch (field.kind) {
    case 'text':
      info.value = textOf(value) ?? '';
      break;
    case 'checkbox':
      // R-12.7.5.2.3-4: `/V` は名前で、Widget の「入」状態と一致すれば入っている
      info.value = value?.kind === 'name' && value.value === field.widgets[0]?.onState;
      break;
    case 'dropdown':
    case 'optionlist': {
      const options = await choiceOptions(editor, field);
      info.value = await selectedTexts(editor, value);
      info.options = options.map((o) => o.display);
      break;
    }
    case 'radio': {
      info.value = await radioSelected(editor, field, value);
      info.options = await radioOptions(editor, field);
      break;
    }
    default:
      break;
  }
  return info;
}

export interface ChoiceOption {
  /** 書き出し値（`/Opt` の対の 1 つ目、または文字列そのもの） */
  readonly exportValue: string;
  /** 画面に出す名前（対の 2 つ目。無ければ書き出し値と同じ） */
  readonly display: string;
}

/** 選択フィールドの `/Opt`（Table 234）。文字列と [書き出し値, 表示名] の 2 形を扱う */
export async function choiceOptions(
  editor: PdfDocumentEditor,
  field: AcroField,
): Promise<ChoiceOption[]> {
  const out: ChoiceOption[] = [];
  for (const item of await arrayItems(editor, field.dict, 'Opt')) {
    const resolved = await editor.resolve(item);
    if (resolved.kind === 'string') {
      const text = textOf(resolved) ?? '';
      out.push({ exportValue: text, display: text });
    } else if (resolved.kind === 'array' && resolved.items.length > 0) {
      const first = textOf(await editor.resolve(resolved.items[0] as CosObject)) ?? '';
      const second =
        resolved.items.length > 1
          ? textOf(await editor.resolve(resolved.items[1] as CosObject))
          : undefined;
      out.push({ exportValue: first, display: second ?? first });
    }
  }
  return out;
}

/** 選択フィールドの `/V`。文字列 1 つでも配列でも配列にして返す */
async function selectedTexts(
  editor: PdfDocumentEditor,
  value: CosObject | undefined,
): Promise<string[]> {
  if (value === undefined) return [];
  if (value.kind === 'string') return [textOf(value) ?? ''];
  if (value.kind === 'array') {
    const out: string[] = [];
    for (const item of value.items) {
      const text = textOf(await editor.resolve(item));
      if (text !== undefined) out.push(text);
    }
    return out;
  }
  return [];
}

/**
 * ラジオの選択肢。
 *
 * `/Opt` があればそれ（R-12.7.5.2.4-5 の書き出し値）、無ければ各 Widget の
 * 「入」状態の名前を並べる。`/Opt` があるとき `/AP /N` の鍵は `/0` `/1` のような
 * 位置の名前になりうる（R-12.7.5.2.3-14）ので、この 2 つは別物である。
 */
export async function radioOptions(editor: PdfDocumentEditor, field: AcroField): Promise<string[]> {
  const exports = await exportValues(editor, field);
  if (exports !== null) return exports;
  return field.widgets.map((w) => w.onState).filter((s): s is string => s !== null);
}

/** ラジオの `/Opt`（文字列の配列）。無ければ null */
async function exportValues(editor: PdfDocumentEditor, field: AcroField): Promise<string[] | null> {
  const raw = dictGetRaw(field.dict, 'Opt');
  if (raw === undefined || raw.kind === 'null') return null;
  const out: string[] = [];
  for (const item of await arrayItems(editor, field.dict, 'Opt')) {
    out.push(textOf(await editor.resolve(item)) ?? '');
  }
  return out;
}

/** ラジオの選択値。`/V` が `Off` なら空文字 */
async function radioSelected(
  editor: PdfDocumentEditor,
  field: AcroField,
  value: CosObject | undefined,
): Promise<string> {
  if (value?.kind !== 'name' || value.value === 'Off') return '';
  const exports = await exportValues(editor, field);
  if (exports !== null) {
    const index = field.widgets.findIndex((w) => w.onState === value.value);
    if (index >= 0 && index < exports.length) return exports[index] as string;
  }
  return value.value;
}

/** 全フィールドを説明する（`/Fields` の並び順） */
export async function listFields(editor: PdfDocumentEditor): Promise<FormFieldInfo[]> {
  const form = await readAcroForm(editor);
  if (form === null) return [];
  const out: FormFieldInfo[] = [];
  for (const field of form.fields) out.push(await describeField(editor, field));
  return out;
}

// --------------------------------------------------------------------------- 小物

/** 辞書の指定キーを配列として読む。配列でなければ空 */
async function arrayItems(
  editor: PdfDocumentEditor,
  dict: CosDict,
  key: string,
): Promise<readonly CosObject[]> {
  const raw = dictGetRaw(dict, key);
  if (raw === undefined || raw.kind === 'null') return [];
  const value = await editor.resolve(raw);
  return value.kind === 'array' ? value.items : [];
}

async function resolveMaybe(
  editor: PdfDocumentEditor,
  raw: CosObject | undefined,
): Promise<CosObject | undefined> {
  if (raw === undefined || raw.kind === 'null') return undefined;
  const value = await editor.resolve(raw);
  return value.kind === 'null' ? undefined : value;
}

/** 「見つからないフィールド名」を、実在する名前つきで伝える */
export function unknownFieldError(name: string, form: AcroForm): Error {
  const available = form.fields.map((f) => `${f.name} (${f.kind})`).join(', ');
  return new Error(
    available.length > 0
      ? `Form field "${name}" not found. Available fields: ${available}`
      : `Form field "${name}" not found — this PDF has no AcroForm fields.`,
  );
}
