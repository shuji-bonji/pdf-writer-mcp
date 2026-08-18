/**
 * 可変テキストの外観ストリームを書く —— Phase 3 の L4′.2（フォーム組の受け皿 #3 / #4）。
 *
 * 計算は `acroform-layout.ts`（純関数）が持つ。ここは COS への読み書きだけ。
 *
 * | 要件 | 何をするか |
 * |---|---|
 * | R-12.7.4.3-2 | 値が実行時に決まる欄の外観は**書く側が組み立てる** |
 * | R-12.7.4.3-4 / -12 | `/Resources` は `/DR` から持ってくる |
 * | R-12.7.4.3-13 | 同名の資源が既にあれば**残す**。`/Tx BMC` … 対応する `EMC` を差し替える |
 * | R-12.7.4.3-7 | `/DA` が名指すフォント名は `/DR /Font` の資源名と一致する |
 * | R-12.7.4.3-11 | `/DA` に `Tm` が無ければ、`/DA` の後・描画の前に置く |
 * | §12.7.4.3 箇条書き | `/BBox` の左下は (0,0)、右上は `/Rect` の寸法 |
 *
 * 🔴 **既存の外観の背景・枠線・クリップには触らない。** R-12.7.4.3-13 が
 * 「`/Tx BMC` から対応する `EMC` まで」と範囲を限っている。旧実装は外観ストリームを
 * 丸ごと作り直していたので、`/MK` から描いた枠を writer の描き方で上書きしていた。
 */

import {
  type CosDict,
  type CosObject,
  type CosRef,
  decodeStream,
  dictGetRaw,
  type PdfDocumentEditor,
} from 'normativepdf';
import {
  type DefaultAppearance,
  layoutFieldText,
  parseDefaultAppearance,
  replaceDaFont,
  spliceTxMarkedContent,
} from './acroform-layout.js';
import type { AcroField, AcroForm } from './acroform-read.js';
import { FF_COMB, FF_MULTILINE, hasFlag } from './acroform-read.js';
import { dict, int, name, num } from './cos.js';
import { textOf } from './cos-read.js';
import type { WriterFont } from './font-embed.js';

/** 枠の内側に取る余白（pt）。ビューアの慣習に合わせて 2 */
const PADDING = 2;

const decoder = new TextDecoder('latin1');

/** latin1 の 1 バイト 1 文字で文字列とバイト列を往復する（内容ストリームは 8 ビット） */
const toBytes = (text: string): Uint8Array => {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i) & 0xff;
  return out;
};

/** 継承を解いた `/DA`。フィールドに無ければ `/AcroForm` の `/DA`（Table 228 は inheritable） */
export async function defaultAppearanceOf(
  editor: PdfDocumentEditor,
  form: AcroForm,
  field: AcroField,
): Promise<DefaultAppearance> {
  let node: CosDict | undefined = field.dict;
  const seen = new Set<string>();
  while (node !== undefined) {
    const own = dictGetRaw(node, 'DA');
    if (own !== undefined && own.kind !== 'null') {
      const value = await editor.resolve(own);
      const text = textOf(value);
      if (text !== undefined) return parseDefaultAppearance(text);
    }
    const parent = dictGetRaw(node, 'Parent');
    if (parent === undefined || parent.kind !== 'ref') break;
    const mark = `${parent.objectNumber} ${parent.generationNumber}`;
    if (seen.has(mark)) break;
    seen.add(mark);
    const resolved = await editor.resolve(parent);
    node = resolved.kind === 'dict' ? resolved : undefined;
  }
  const formLevel = dictGetRaw(form.dict, 'DA');
  if (formLevel !== undefined && formLevel.kind !== 'null') {
    const text = textOf(await editor.resolve(formLevel));
    if (text !== undefined) return parseDefaultAppearance(text);
  }
  return parseDefaultAppearance('');
}

/** `/Rect` の見た目の幅と高さ（§12.5.2 の `/Rect` は正規化されていないことがある） */
async function rectSize(
  editor: PdfDocumentEditor,
  widget: CosDict,
): Promise<{ width: number; height: number }> {
  const raw = dictGetRaw(widget, 'Rect');
  if (raw === undefined) return { width: 0, height: 0 };
  const value = await editor.resolve(raw);
  if (value.kind !== 'array' || value.items.length < 4) return { width: 0, height: 0 };
  const numbers: number[] = [];
  for (const item of value.items) {
    const n = await editor.resolve(item);
    numbers.push(n.kind === 'integer' || n.kind === 'real' ? n.value : 0);
  }
  const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = numbers;
  return { width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
}

/**
 * `/Tx BMC` … `EMC` の中身を組み立てる。
 *
 * `/DA` をそのまま `BT` の直後に置き（§12.7.4.3 の EXAMPLE）、`Tm` を続ける
 * （R-12.7.4.3-11）。`/DA` が名指すフォント名を writer のものへ差し替えるのは
 * 呼び出し側で、ここには**決まった `/DA` 文字列**が渡ってくる。
 */
function buildTxContent(
  da: string,
  lines: readonly { text: string; x: number; y: number }[],
  font: WriterFont,
  clip: { width: number; height: number },
): string {
  const parts: string[] = ['/Tx BMC', 'q'];
  // 箱からはみ出した文字を切る。§8.5.4 の `W n`
  parts.push(`${PADDING} ${PADDING} ${clip.width - PADDING * 2} ${clip.height - PADDING * 2} re`);
  parts.push('W', 'n', 'BT', da);
  for (const line of lines) {
    parts.push(`1 0 0 1 ${round(line.x)} ${round(line.y)} Tm`);
    parts.push(`${hexOf(font.encode(line.text))} Tj`);
  }
  parts.push('ET', 'Q', 'EMC');
  return parts.join('\n');
}

const round = (value: number): string => String(Math.round(value * 10000) / 10000);

/** `font.encode` が返す文字列オブジェクトを、内容ストリームに書ける字面へ */
function hexOf(object: CosObject): string {
  if (object.kind !== 'string') return '<>';
  let out = '<';
  for (const byte of object.bytes) out += byte.toString(16).padStart(2, '0').toUpperCase();
  return `${out}>`;
}

export interface AppearanceContext {
  readonly form: AcroForm;
  readonly font: WriterFont;
  /** `/DR /Font` に載せる資源名。`/DA` もこれを名指す（R-12.7.4.3-7） */
  readonly fontName: string;
}

/**
 * 可変テキストのフィールド 1 件について、各 Widget の `/AP /N` を作り直す。
 *
 * 値そのものは既に `/V` に書かれている前提（`acroform-write.ts` が先に書く）。
 */
export async function refreshTextAppearance(
  editor: PdfDocumentEditor,
  context: AppearanceContext,
  field: AcroField,
  text: string,
): Promise<void> {
  const existing = await defaultAppearanceOf(editor, context.form, field);
  // R-12.7.4.3-7: `/DA` が名指すフォント名は `/DR /Font` の資源名と一致しなければならない。
  // 向け直すのはフォントだけで、色などの他の演算子はそのまま残す
  const da = replaceDaFont(existing.source, context.fontName, existing.size);
  await patchDict(editor, field.ref, [
    ['DA', { kind: 'string', bytes: toBytes(da), form: 'literal' }],
  ]);

  const maxLen = await inheritedInt(editor, field, 'MaxLen');
  const quadding = clampQuadding(await inheritedInt(editor, field, 'Q'));
  const multiline = hasFlag(field.flags, FF_MULTILINE);
  // Table 231 bit 25: comb は `/MaxLen` があり Multiline が下りているときだけ
  const comb = hasFlag(field.flags, FF_COMB) && !multiline && maxLen > 0 ? maxLen : 0;

  for (const widget of field.widgets) {
    const current = await editor.resolve(widget.ref);
    if (current.kind !== 'dict') continue;
    const size = await rectSize(editor, current);
    const layout = layoutFieldText(text, context.font, {
      width: size.width,
      height: size.height,
      padding: PADDING,
      quadding,
      multiline,
      comb,
      size: existing.size,
    });
    const body = buildTxContent(
      // 自動サイズを解決した値で書く（R-12.7.4.3-8 の 0 は viewer 向けの指示なので、
      // 実際に描くストリームには決まった数を置く）
      replaceDaFont(existing.source, context.fontName, Number(round(layout.size))),
      layout.lines,
      context.font,
      size,
    );
    await writeNormalAppearance(editor, context, widget.ref, current, body, size);
  }
}

/** 既存の `/AP /N` の `/Tx BMC` … `EMC` を差し替える。無ければ Form XObject を作る */
async function writeNormalAppearance(
  editor: PdfDocumentEditor,
  context: AppearanceContext,
  widgetRef: CosRef,
  widget: CosDict,
  body: string,
  size: { width: number; height: number },
): Promise<void> {
  const apRaw = dictGetRaw(widget, 'AP');
  const ap = apRaw === undefined ? undefined : await editor.resolve(apRaw);
  const normalRaw = ap?.kind === 'dict' ? dictGetRaw(ap, 'N') : undefined;
  const normal = normalRaw === undefined ? undefined : await editor.resolve(normalRaw);

  if (normal?.kind === 'stream' && normalRaw?.kind === 'ref') {
    const previous = decoder.decode(await decodeStream(normal));
    const merged = spliceTxMarkedContent(previous, body);
    const entries = new Map<string, CosObject>(normal.dict.entries);
    entries.delete('Filter');
    entries.delete('DecodeParms');
    entries.set('Resources', await resourcesWithFont(editor, context, normal.dict));
    editor.set(
      normalRaw.objectNumber,
      { kind: 'stream', dict: { kind: 'dict', entries }, raw: toBytes(merged) },
      normalRaw.generationNumber,
    );
    return;
  }

  // 外観が無い（または異形）。§12.7.4.3 の箇条書きどおりに Form XObject を新設する
  const created = await editor.allocate({
    kind: 'stream',
    dict: dict([
      ['Type', name('XObject')],
      ['Subtype', name('Form')],
      ['FormType', int(1)],
      ['BBox', { kind: 'array', items: [int(0), int(0), num(size.width), num(size.height)] }],
      ['Resources', await resourcesWithFont(editor, context, undefined)],
    ]),
    raw: toBytes(body),
  });
  const apEntries = new Map<string, CosObject>(ap?.kind === 'dict' ? ap.entries : []);
  apEntries.set('N', created);
  await patchDict(editor, widgetRef, [['AP', { kind: 'dict', entries: apEntries }]]);
}

/**
 * 外観ストリームの `/Resources /Font` に、`/DA` が名指すフォントを載せる。
 * R-12.7.4.3-13: **同名の資源が既にあれば残す。**
 */
async function resourcesWithFont(
  editor: PdfDocumentEditor,
  context: AppearanceContext,
  streamDict: CosDict | undefined,
): Promise<CosObject> {
  const raw = streamDict === undefined ? undefined : dictGetRaw(streamDict, 'Resources');
  const resolved = raw === undefined ? undefined : await editor.resolve(raw);
  const entries = new Map<string, CosObject>(resolved?.kind === 'dict' ? resolved.entries : []);

  const fontsRaw = entries.get('Font');
  const fonts = fontsRaw === undefined ? undefined : await editor.resolve(fontsRaw);
  const fontEntries = new Map<string, CosObject>(fonts?.kind === 'dict' ? fonts.entries : []);
  if (!fontEntries.has(context.fontName)) fontEntries.set(context.fontName, context.font.ref);
  entries.set('Font', { kind: 'dict', entries: fontEntries });
  return { kind: 'dict', entries };
}

/**
 * `/AcroForm /DR /Font` を満たす（受け皿 #4）。
 *
 * Table 224 の `/DR` は「フォームフィールドの外観ストリームが使う既定リソース」で、
 * R-12.7.4.3-7 は「`/DA` が名指すフォント値は `/DR` の `/Font` の資源名と一致する」と
 * 言う。`/DR` が無ければ一致しようがないので、この shall は充足できない。
 *
 * **実害**: 外観ストリーム自体は writer が作るので普通に開く分には描かれる。しかし
 * ビューアが値の変更などで外観を作り直すと、`/DA` のフォント名を `/DR` から解決できず
 * 既定フォントに落ちる —— 日本語なら字が出なくなる。
 *
 * 自分が埋め込んだフォントを入れるだけでは足りない。writer が触っていないフィールドは
 * 入力時代の `/DA`（例: `/Helvetica`）を保つので、その参照先を **Widget の外観ストリームの
 * `/Resources /Font` から `/DR` へ写す**（新たに埋め込まないので見た目は変わらない）。
 * 解決できなかった名前は呼び出し側が警告として報告する。
 */
export async function ensureDefaultResources(
  editor: PdfDocumentEditor,
  form: AcroForm,
  context: AppearanceContext,
): Promise<{ unresolvedDaFonts: string[] }> {
  const acroRef = form.ref;
  const acro = acroRef === null ? form.dict : await editor.resolve(acroRef);
  if (acro.kind !== 'dict') return { unresolvedDaFonts: [] };

  const drRaw = dictGetRaw(acro, 'DR');
  const dr = drRaw === undefined ? undefined : await editor.resolve(drRaw);
  const drEntries = new Map<string, CosObject>(dr?.kind === 'dict' ? dr.entries : []);
  const fontsRaw = drEntries.get('Font');
  const fonts = fontsRaw === undefined ? undefined : await editor.resolve(fontsRaw);
  const fontEntries = new Map<string, CosObject>(fonts?.kind === 'dict' ? fonts.entries : []);

  /** R-12.7.4.3-13: 既存の同名資源は残す */
  const register = (key: string, value: CosObject): void => {
    if (!fontEntries.has(key)) fontEntries.set(key, value);
  };

  // 1. 自分が外観生成に使ったフォント
  register(context.fontName, context.font.ref);

  // 2. writer が触っていないフィールドが引き継いだ `/DA` のフォント
  const unresolvedDaFonts: string[] = [];
  for (const field of form.fields) {
    if (field.kind !== 'text' && field.kind !== 'dropdown' && field.kind !== 'optionlist') continue;
    const da = await defaultAppearanceOf(editor, form, field);
    const wanted = da.fontName;
    if (wanted === null || fontEntries.has(wanted)) continue;
    const found = await findFontRefInWidgets(editor, field, wanted);
    if (found !== null) register(wanted, found);
    else if (!unresolvedDaFonts.includes(wanted)) unresolvedDaFonts.push(wanted);
  }

  drEntries.set('Font', { kind: 'dict', entries: fontEntries });
  const nextDr: CosObject = { kind: 'dict', entries: drEntries };
  if (drRaw !== undefined && drRaw.kind === 'ref') {
    editor.set(drRaw.objectNumber, nextDr, drRaw.generationNumber);
  } else if (acroRef !== null) {
    await patchDict(editor, acroRef, [['DR', nextDr]]);
  }
  return { unresolvedDaFonts };
}

/** Widget の外観ストリームの `/Resources /Font` から、指定名の参照を探す */
async function findFontRefInWidgets(
  editor: PdfDocumentEditor,
  field: AcroField,
  fontName: string,
): Promise<CosObject | null> {
  for (const widget of field.widgets) {
    const apRaw = dictGetRaw(widget.dict, 'AP');
    if (apRaw === undefined) continue;
    const ap = await editor.resolve(apRaw);
    if (ap.kind !== 'dict') continue;
    const nRaw = dictGetRaw(ap, 'N');
    if (nRaw === undefined) continue;
    const normal = await editor.resolve(nRaw);
    if (normal.kind !== 'stream') continue;
    const resourcesRaw = dictGetRaw(normal.dict, 'Resources');
    if (resourcesRaw === undefined) continue;
    const resources = await editor.resolve(resourcesRaw);
    if (resources.kind !== 'dict') continue;
    const fontsRaw = dictGetRaw(resources, 'Font');
    if (fontsRaw === undefined) continue;
    const fonts = await editor.resolve(fontsRaw);
    if (fonts.kind !== 'dict') continue;
    const found = fonts.entries.get(fontName);
    if (found !== undefined && found.kind === 'ref') return found;
  }
  return null;
}

// --------------------------------------------------------------------------- 小物

async function patchDict(
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

async function inheritedInt(
  editor: PdfDocumentEditor,
  field: AcroField,
  key: string,
): Promise<number> {
  let node: CosDict | undefined = field.dict;
  const seen = new Set<string>();
  while (node !== undefined) {
    const own = dictGetRaw(node, key);
    if (own !== undefined && own.kind !== 'null') {
      const value = await editor.resolve(own);
      return value.kind === 'integer' ? value.value : 0;
    }
    const parent = dictGetRaw(node, 'Parent');
    if (parent === undefined || parent.kind !== 'ref') return 0;
    const mark = `${parent.objectNumber} ${parent.generationNumber}`;
    if (seen.has(mark)) return 0;
    seen.add(mark);
    const resolved = await editor.resolve(parent);
    node = resolved.kind === 'dict' ? resolved : undefined;
  }
  return 0;
}

const clampQuadding = (value: number): 0 | 1 | 2 => (value === 1 ? 1 : value === 2 ? 2 : 0);
