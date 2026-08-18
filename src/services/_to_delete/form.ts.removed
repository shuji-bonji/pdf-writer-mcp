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
  PDFHexString,
  PDFName,
  PDFOptionList,
  type PDFPage,
  PDFRadioGroup,
  PDFRef,
  PDFSignature,
  PDFStream,
  PDFTextField,
} from 'pdf-lib';
import { appendWidgetToStructTree } from './struct-append.js';

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
export function unknownFieldError(name: string, form: PDFForm): Error {
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
export function refreshAppearances(form: PDFForm, font: PDFFont): { unresolvedDaFonts: string[] } {
  form.updateFieldAppearances(font);
  return ensureDefaultResources(form, font);
}

/** /DA の `… /<name> <size> Tf` からフォント名を取り出す */
function daFontName(da: string | undefined): string | null {
  const m = da ? /\/([^\s/]+)\s+[\d.]+\s+Tf/.exec(da) : null;
  return m ? m[1] : null;
}

/** 可変テキストを含むフィールドか（Tx / Ch）。/DA と /DR の要件はこれらにだけ働く */
function isVariableTextField(field: PDFField): boolean {
  return (
    field instanceof PDFTextField || field instanceof PDFDropdown || field instanceof PDFOptionList
  );
}

/**
 * フィールドの Widget の外観ストリームの `/Resources /Font` から、指定名のフォント参照を探す。
 * 見つかればそれを `/DR` へ写せる（**同じオブジェクトを指すので見た目は一切変わらない**）。
 */
function findFontRefInWidgets(field: PDFField, name: string): PDFRef | null {
  const key = PDFName.of(name);
  for (const widget of field.acroField.getWidgets()) {
    const ap = widget.dict.lookup(PDFName.of('AP'));
    if (!(ap instanceof PDFDict)) continue;
    const normal = widget.dict.context.lookup(ap.get(PDFName.of('N')));
    if (!(normal instanceof PDFStream)) continue;
    const resources = normal.dict.lookup(PDFName.of('Resources'));
    if (!(resources instanceof PDFDict)) continue;
    const fonts = resources.lookup(PDFName.of('Font'));
    if (!(fonts instanceof PDFDict)) continue;
    const ref = fonts.get(key);
    if (ref instanceof PDFRef) return ref;
  }
  return null;
}

/**
 * AcroForm の `/DR /Font` を、可変テキストの `/DA` が参照する全フォントで満たす（SPEC-AUDIT Phase 3）。
 *
 * `updateFieldAppearances(font)` は各フィールドの `/DA` を
 * `(0 0 0 rg /NotoSansJP-Regular 18 Tf)` のように書くが、pdf-lib は **`/DR` を作らない**
 * （実測: AcroForm が `<< /Fields [7 0 R] >>` だけになる）。
 *
 * ISO 32000-2:
 *   - Table 224 `DR`: 「フォームフィールドの外観ストリームが使う既定リソース。
 *     **最低限 Font エントリを含まなければならない**」
 *   - **R-12.7.4.3-7（shall）**: 「`/DA` が指定するフォント値は、`/DR` から参照される
 *     既定リソース辞書の Font エントリのリソース名と**一致しなければならない**」
 *   → `/DR` が無ければ一致しようがなく、この shall は充足不可能になる。
 *
 * **実害**（落とし穴 0-a のビューア版）: 外観ストリーム自体は自前で作ってあるので普通に開く分には
 * 描画される。しかしビューアが値の変更などで**外観を再生成**すると、`/DA` のフォント名を
 * `/DR` から解決できず既定フォント（Helvetica）に落ち、**日本語が豆腐になる**。
 *
 * 自分が埋め込んだフォントを入れるだけでは足りない。`updateFieldAppearances` は
 * **dirty なフィールドしか更新しない**ため、writer が触っていないフィールドは入力時代の
 * `/DA`（例: `/Helvetica`）を保つ。それらの参照先は **Widget の外観ストリームの
 * `/Resources /Font` に既にある**ので、そこから `/DR` へ**同じ参照を写す**
 * （新たに埋め込まないので見た目は変わらない）。
 *
 * R-12.7.4.3-13 に従い、同名のリソースが既にあれば**残す**（上書きしない）。
 * 解決できなかった名前は呼び出し側が warnings で報告する — 入力が既に壊れているケースであり、
 * writer が黙って直せるものではない（「壊れているなら明示する」）。
 */
function ensureDefaultResources(form: PDFForm, font: PDFFont): { unresolvedDaFonts: string[] } {
  const acro = form.acroForm.dict;
  const context = acro.context;

  let dr = acro.lookup(PDFName.of('DR'));
  if (!(dr instanceof PDFDict)) {
    dr = context.obj({}) as PDFDict;
    acro.set(PDFName.of('DR'), dr);
  }
  let fonts = (dr as PDFDict).lookup(PDFName.of('Font'));
  if (!(fonts instanceof PDFDict)) {
    fonts = context.obj({}) as PDFDict;
    (dr as PDFDict).set(PDFName.of('Font'), fonts);
  }
  const drFonts = fonts as PDFDict;

  /** 既存の同名リソースは残す（R-12.7.4.3-13） */
  const register = (name: string, ref: PDFRef): void => {
    const key = PDFName.of(name);
    if (drFonts.get(key) === undefined) drFonts.set(key, ref);
  };

  // 1. 自分が外観生成に使ったフォント
  register(font.name, font.ref);

  // 2. writer が触っていないフィールドが引き継いだ /DA のフォント
  const unresolvedDaFonts: string[] = [];
  for (const field of form.getFields()) {
    if (!isVariableTextField(field)) continue;
    const name = daFontName(field.acroField.getDefaultAppearance());
    if (!name || drFonts.get(PDFName.of(name)) !== undefined) continue;
    const ref = findFontRefInWidgets(field, name);
    if (ref) register(name, ref);
    else if (!unresolvedDaFonts.includes(name)) unresolvedDaFonts.push(name);
  }
  return { unresolvedDaFonts };
}

// ---------------------------------------------------------------------------
// tag_form_fields（PDF/UA-1 7.18.4-1 / 7.18.3-1 / 7.18.1-3）
// ---------------------------------------------------------------------------

/** フィールド 1 件が持つ Widget 注釈の情報 */
interface WidgetInfo {
  fieldName: string;
  widgetRef: PDFRef;
  /** Widget が載っているページ。/Annots から見つからなければ undefined（孤児） */
  page: PDFPage | undefined;
  /** 既に /StructParent を持つ（＝構造木に結ばれている）か */
  hasStructParent: boolean;
}

/**
 * 終端フィールドの Widget 注釈を列挙する。
 *
 * pdf-lib のフィールドは 2 形態ある:
 *   - `addToPage` で作られたもの: Widget は /Kids 配下の別オブジェクト
 *   - フィールド辞書自身が Widget を兼ねる「マージ形」: /Kids が無い
 * どちらも扱えるよう、/Kids があればその参照を、無ければフィールド自身の参照を使う。
 */
function enumerateWidgets(doc: PDFDocument): WidgetInfo[] {
  const out: WidgetInfo[] = [];
  const pages = doc.getPages();

  // ページ /Annots に参照を持つページを逆引きする
  const pageOf = (ref: PDFRef): PDFPage | undefined => {
    for (const page of pages) {
      const annots = page.node.lookup(PDFName.of('Annots'));
      if (!(annots instanceof PDFArray)) continue;
      for (let i = 0; i < annots.size(); i++) {
        const v = annots.get(i);
        if (v instanceof PDFRef && v.toString() === ref.toString()) return page;
      }
    }
    return undefined;
  };

  const widgetInfo = (fieldName: string, ref: PDFRef): WidgetInfo => {
    const dict = doc.context.lookup(ref);
    const hasStructParent =
      dict instanceof PDFDict && dict.get(PDFName.of('StructParent')) !== undefined;
    return { fieldName, widgetRef: ref, page: pageOf(ref), hasStructParent };
  };

  for (const field of doc.getForm().getFields()) {
    const kids = field.acroField.dict.lookup(PDFName.of('Kids'));
    if (kids instanceof PDFArray) {
      for (let i = 0; i < kids.size(); i++) {
        const kid = kids.get(i);
        if (kid instanceof PDFRef) out.push(widgetInfo(field.getName(), kid));
      }
    } else {
      // マージ形: フィールド辞書自身が Widget
      out.push(widgetInfo(field.getName(), field.ref));
    }
  }
  return out;
}

export interface TagWidgetsOutcome {
  /** 新たに Form 構造要素へ内包した Widget 数 */
  tagged: number;
  /** 既に構造木に結ばれていて何もしなかった Widget 数 */
  skipped: number;
  /** どのページの /Annots にも見つからなかった Widget のフィールド名 */
  orphaned: string[];
  /** /TU をフィールド名で代用したフィールド名（labels 未指定・既存 /TU 無し） */
  unlabeled: string[];
  /** 変更した既存の間接オブジェクト（B-7b' = 増分更新の dirty 追跡） */
  dirtiedRefs: PDFRef[];
}

/**
 * タグ付き PDF のフォームを PDF/UA-1 準拠へ修復する本体。
 *
 *   - 7.18.4-1: 各 Widget を `Form` 構造要素に内包する（OBJR + /StructParent + ParentTree）
 *   - 7.18.3-1: Widget のあるページに /Tabs /S を立てる（appendWidgetToStructTree が行う）
 *   - 7.18.1-3: フィールドに /TU（代替名）を付与する。labels に無く既存 /TU も無い
 *     フィールドはフィールド名で代用し、unlabeled として報告する
 *
 * 冪等: 既に /StructParent を持つ Widget はスキップするため、二度実行しても
 * 構造要素が重複しない。呼び出し側で isTagged を確認してから呼ぶこと。
 */
export function tagWidgets(doc: PDFDocument, labels: Record<string, string>): TagWidgetsOutcome {
  const form = doc.getForm();

  // labels の名前は実在するフィールドでなければならない（誤記の黙殺を防ぐ）
  for (const name of Object.keys(labels)) {
    if (!form.getFieldMaybe(name)) throw unknownFieldError(name, form);
  }

  const dirtied = new Map<string, PDFRef>();
  const markDirty = (ref: PDFRef): void => {
    dirtied.set(ref.toString(), ref);
  };

  // 7.18.1-3: /TU（代替フィールド名）
  const unlabeled: string[] = [];
  for (const field of form.getFields()) {
    const name = field.getName();
    const dict = field.acroField.dict;
    const label = labels[name];
    if (label !== undefined) {
      dict.set(PDFName.of('TU'), PDFHexString.fromText(label));
      markDirty(field.ref); // 既存フィールド辞書の変更
    } else if (dict.get(PDFName.of('TU')) === undefined) {
      dict.set(PDFName.of('TU'), PDFHexString.fromText(name));
      unlabeled.push(name);
      markDirty(field.ref);
    }
  }

  // 7.18.4-1 / 7.18.3-1: Widget を Form 構造要素へ
  const outcome: TagWidgetsOutcome = {
    tagged: 0,
    skipped: 0,
    orphaned: [],
    unlabeled,
    dirtiedRefs: [],
  };
  for (const w of enumerateWidgets(doc)) {
    if (w.hasStructParent) {
      outcome.skipped++;
      continue;
    }
    if (!w.page) {
      outcome.orphaned.push(w.fieldName);
      continue;
    }
    const appended = appendWidgetToStructTree(doc, w.page, w.widgetRef);
    if (appended.tagged) {
      outcome.tagged++;
      for (const ref of appended.dirtiedRefs) markDirty(ref);
    }
  }
  outcome.dirtiedRefs = [...dirtied.values()];
  return outcome;
}
