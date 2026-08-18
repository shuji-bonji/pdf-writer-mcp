/**
 * フォームの焼き込み（flatten）—— Phase 3 の L4′.2（フォーム組の受け皿 #5 / #6）。
 *
 * 各 Widget の外観をページ内容へ描き、Widget 注釈と `/AcroForm` を取り除いて
 * 非対話にする。
 *
 * | 要件 | 何をするか |
 * |---|---|
 * | R-12.5.5-2 | 外観ストリームは Form XObject で、注釈の矩形の中に描かれる |
 * | R-12.5.5-3〜-6 | `/BBox` を `/Matrix` で変換した外接矩形を `/Rect` に合わせる行列 A を作る |
 * | R-12.5.5-19 | `/AP /N` は状態の副辞書のことがある。`/AS` で選ぶ |
 * | R-12.5.5-23 | `/AS` が指す状態の外観が無ければ**何も描かない** |
 * | §12.5.3 Table 167 | Hidden（bit 2）/ NoView（bit 6）の注釈は描かない |
 *
 * 🔴 **参照を外すだけでは消えない。** `/Annots` と `/AcroForm` から外しても、
 * オブジェクト自体はファイルに残る（`save()` は入力の全オブジェクトを書き直す）。
 * 非対話にするのが目的なのに Widget とフィールド辞書が読める形で残るのでは足りないので、
 * `editor.delete` で明示的に消す（§7.5.4 の free 項目になる）。
 *
 * 🔴 **`Do` の前に置く行列は A であって AA ではない。** AA = Matrix × A のうち
 * Matrix の側は `Do` が Form XObject の `/Matrix` として自分で掛ける（§8.10.1）。
 * ここで AA を書くと Matrix が 2 回掛かる。
 */

import {
  ContentStreamBuilder,
  type CosDict,
  type CosObject,
  type CosRef,
  dictGetRaw,
  type PdfDocumentEditor,
} from 'normativepdf';
import type { AcroForm } from './acroform-read.js';
import { name, num } from './cos.js';
import { pruneRefsTo } from './cos-prune.js';
import { freshResourceName, resourcesWith } from './page-resources.js';
import { detachStructElements, structParentOf } from './struct-detach.js';

/** §12.5.3 Table 167 の注釈フラグ（ビットは 1 始まり） */
const F_HIDDEN = 1 << 1;
const F_NO_VIEW = 1 << 5;

export interface FlattenOutcome {
  /** ページ内容へ描いた Widget の数 */
  readonly baked: number;
  /** 外観が無くて描けなかった Widget のフィールド名 */
  readonly withoutAppearance: string[];
}

/** 4 つの数を素の配列にする。無ければ null */
async function numbers(
  editor: PdfDocumentEditor,
  value: CosObject | undefined,
  count: number,
): Promise<number[] | null> {
  if (value === undefined || value.kind === 'null') return null;
  const resolved = await editor.resolve(value);
  if (resolved.kind !== 'array' || resolved.items.length < count) return null;
  const out: number[] = [];
  for (const item of resolved.items) {
    const n = await editor.resolve(item);
    out.push(n.kind === 'integer' || n.kind === 'real' ? n.value : 0);
  }
  return out;
}

/** 行列 [a b c d e f] で点を写す */
const apply = (m: number[], x: number, y: number): [number, number] => [
  (m[0] as number) * x + (m[2] as number) * y + (m[4] as number),
  (m[1] as number) * x + (m[3] as number) * y + (m[5] as number),
];

/**
 * §12.5.5 の手順 1〜2。`/BBox` を `/Matrix` で変換した外接矩形を `/Rect` に合わせる行列 A。
 *
 * 変換後の箱が潰れている（幅か高さが 0）ときは、その軸の倍率を 1 にする ——
 * 0 除算で NaN を書くより、等倍で置く方が読み手にとって害が小さい。
 */
export function alignMatrix(
  bbox: readonly number[],
  matrix: readonly number[],
  rect: readonly number[],
): number[] {
  const m = [...matrix];
  const corners: [number, number][] = [
    apply(m, bbox[0] as number, bbox[1] as number),
    apply(m, bbox[2] as number, bbox[1] as number),
    apply(m, bbox[2] as number, bbox[3] as number),
    apply(m, bbox[0] as number, bbox[3] as number),
  ];
  const tx1 = Math.min(...corners.map((c) => c[0]));
  const tx2 = Math.max(...corners.map((c) => c[0]));
  const ty1 = Math.min(...corners.map((c) => c[1]));
  const ty2 = Math.max(...corners.map((c) => c[1]));

  const rx1 = Math.min(rect[0] as number, rect[2] as number);
  const rx2 = Math.max(rect[0] as number, rect[2] as number);
  const ry1 = Math.min(rect[1] as number, rect[3] as number);
  const ry2 = Math.max(rect[1] as number, rect[3] as number);

  const sx = tx2 - tx1 === 0 ? 1 : (rx2 - rx1) / (tx2 - tx1);
  const sy = ty2 - ty1 === 0 ? 1 : (ry2 - ry1) / (ty2 - ty1);
  return [sx, 0, 0, sy, rx1 - sx * tx1, ry1 - sy * ty1];
}

/** `/AP /N` から実際に描くストリームの参照を選ぶ（R-12.5.5-19 / -23） */
async function normalAppearanceRef(
  editor: PdfDocumentEditor,
  widget: CosDict,
): Promise<CosRef | null> {
  const apRaw = dictGetRaw(widget, 'AP');
  if (apRaw === undefined) return null;
  const ap = await editor.resolve(apRaw);
  if (ap.kind !== 'dict') return null;
  const nRaw = dictGetRaw(ap, 'N');
  if (nRaw === undefined) return null;
  const normal = await editor.resolve(nRaw);
  if (normal.kind === 'stream') return nRaw.kind === 'ref' ? nRaw : null;
  if (normal.kind !== 'dict') return null;

  // 状態の副辞書。`/AS` が指す状態を選ぶ。無ければ何も描かない
  const asRaw = dictGetRaw(widget, 'AS');
  if (asRaw === undefined) return null;
  const as = await editor.resolve(asRaw);
  if (as.kind !== 'name') return null;
  const chosen = dictGetRaw(normal, as.value);
  return chosen !== undefined && chosen.kind === 'ref' ? chosen : null;
}

/**
 * `/AP` の下にあるストリーム参照をすべて集める（`/N` `/R` `/D` と状態の副辞書）。
 * 焼き込んだ 1 本以外は誰も指さなくなるので、消す候補になる。
 */
async function appearanceRefs(editor: PdfDocumentEditor, widget: CosDict): Promise<CosRef[]> {
  const apRaw = dictGetRaw(widget, 'AP');
  if (apRaw === undefined) return [];
  const ap = await editor.resolve(apRaw);
  if (ap.kind !== 'dict') return [];
  const out: CosRef[] = [];
  if (apRaw.kind === 'ref') out.push(apRaw);
  for (const value of ap.entries.values()) {
    if (value.kind === 'ref') {
      const resolved = await editor.resolve(value);
      if (resolved.kind === 'stream') {
        out.push(value);
        continue;
      }
      out.push(value);
      if (resolved.kind === 'dict') {
        for (const state of resolved.entries.values()) if (state.kind === 'ref') out.push(state);
      }
      continue;
    }
    const resolved = await editor.resolve(value);
    if (resolved.kind === 'dict') {
      for (const state of resolved.entries.values()) if (state.kind === 'ref') out.push(state);
    }
  }
  return out;
}

/** Hidden か NoView の注釈は描かない（§12.5.3 Table 167） */
async function isInvisible(editor: PdfDocumentEditor, widget: CosDict): Promise<boolean> {
  const raw = dictGetRaw(widget, 'F');
  if (raw === undefined) return false;
  const value = await editor.resolve(raw);
  if (value.kind !== 'integer') return false;
  return (value.value & (F_HIDDEN | F_NO_VIEW)) !== 0;
}

/**
 * フォームをページ内容へ焼き込み、Widget と `/AcroForm` を取り除く。
 *
 * `/Annots` から Widget を消すのは**焼き込んだ後**である。先に消すと
 * どのページに載っていたかが分からなくなる。
 */
export async function flattenForm(
  editor: PdfDocumentEditor,
  form: AcroForm,
): Promise<FlattenOutcome> {
  const widgetOwners = new Map<string, string>();
  for (const field of form.fields) {
    for (const widget of field.widgets) {
      widgetOwners.set(`${widget.ref.objectNumber} ${widget.ref.generationNumber}`, field.name);
    }
  }

  const outcome: FlattenOutcome = { baked: 0, withoutAppearance: [] };
  let baked = 0;
  /** ページ資源として残す外観。これ以外の `/AP` の中身は消してよい */
  const keptAppearances = new Set<string>();
  /** 消す相手（Widget 辞書とその使わない外観） */
  const doomed = new Map<string, CosRef>();
  const mark = (ref: CosRef): void => {
    doomed.set(`${ref.objectNumber} ${ref.generationNumber}`, ref);
  };
  /** 消す Widget が構造木に結ばれていたときの `/StructParent` */
  const structParents: number[] = [];

  for (const page of await editor.pages()) {
    if (page.ref === null) continue;
    const annotsRaw = dictGetRaw(page.dict, 'Annots');
    if (annotsRaw === undefined || annotsRaw.kind === 'null') continue;
    const annots = await editor.resolve(annotsRaw);
    if (annots.kind !== 'array') continue;

    const kept: CosObject[] = [];
    const content = new ContentStreamBuilder();
    const xObjects: Record<string, CosObject> = {};
    let drew = false;

    for (const item of annots.items) {
      const key = item.kind === 'ref' ? `${item.objectNumber} ${item.generationNumber}` : null;
      const owner = key === null ? undefined : widgetOwners.get(key);
      if (owner === undefined) {
        kept.push(item);
        continue;
      }
      // ここからは Widget。描けても描けなくても `/Annots` からは外す
      const widget = await editor.resolve(item);
      if (widget.kind !== 'dict') continue;
      if (item.kind === 'ref') {
        mark(item);
        for (const ref of await appearanceRefs(editor, widget)) mark(ref);
        const key = await structParentOf(editor, widget);
        if (key !== undefined) structParents.push(key);
      }
      if (await isInvisible(editor, widget)) continue;

      const apRef = await normalAppearanceRef(editor, widget);
      if (apRef === null) {
        if (!outcome.withoutAppearance.includes(owner)) outcome.withoutAppearance.push(owner);
        continue;
      }
      const stream = await editor.resolve(apRef);
      if (stream.kind !== 'stream') continue;

      const bbox = (await numbers(editor, dictGetRaw(stream.dict, 'BBox'), 4)) ?? [0, 0, 0, 0];
      const matrix = (await numbers(editor, dictGetRaw(stream.dict, 'Matrix'), 6)) ?? [
        1, 0, 0, 1, 0, 0,
      ];
      const rect = (await numbers(editor, dictGetRaw(widget, 'Rect'), 4)) ?? [0, 0, 0, 0];
      const a = alignMatrix(bbox, matrix, rect);

      const resourceName = await freshResourceName(
        editor,
        page,
        'XObject',
        `PWFW${Object.keys(xObjects).length}_`,
      );
      xObjects[resourceName] = apRef;
      keptAppearances.add(`${apRef.objectNumber} ${apRef.generationNumber}`);

      content.op('q');
      content.op('cm', ...a.map((v) => num(round(v))));
      content.op('Do', name(resourceName));
      content.op('Q');
      drew = true;
      baked += 1;
    }

    if (!drew && kept.length === annots.items.length) continue;

    const entries = new Map<string, CosObject>(page.dict.entries);
    if (drew) {
      const added = await editor.allocate({
        kind: 'stream',
        dict: { kind: 'dict', entries: new Map() },
        raw: content.finish(),
      });
      entries.set('Contents', await contentsWith(editor, page.dict, added));
      entries.set('Resources', await resourcesWith(editor, page, { XObject: xObjects }));
    }
    // 焼き込んだ後に外す（R-7.7.3.3 Table 31 の `/Annots` は Optional なので空なら消す）
    if (kept.length > 0) entries.set('Annots', { kind: 'array', items: kept });
    else entries.delete('Annots');
    editor.set(page.ref.objectNumber, { kind: 'dict', entries }, page.ref.generationNumber);
  }

  await removeAcroForm(editor);

  // §14.7.4.3 Table 324: OBJR の `/Obj` は Required。指す先を消す以上、
  // OBJR を持つ構造要素ごと外す（`/Obj` だけ消すと Required が欠ける）
  for (const ref of await detachStructElements(editor, structParents)) mark(ref);

  // 参照を外し終えてから消す。ページ資源に残した外観は消さない
  const removed: CosRef[] = [];
  for (const [key, ref] of doomed) {
    if (keptAppearances.has(key)) continue;
    removed.push(ref);
  }
  // フィールド辞書は非終端も含めて消す（`/AcroForm` を消したので誰も指していない）
  for (const ref of form.nodes) {
    const key = `${ref.objectNumber} ${ref.generationNumber}`;
    if (keptAppearances.has(key) || doomed.has(key)) continue;
    removed.push(ref);
  }

  // 🔴 消す前に、消す相手を指している参照を取り除く。入力に元から孤児が居て
  // 消す相手を指していることがある（`form-basic.pdf` は `/T user` の辞書を 2 つ持つ）
  await pruneRefsTo(editor, removed);
  for (const ref of removed) editor.delete(ref.objectNumber, ref.generationNumber);
  return { ...outcome, baked };
}

const round = (value: number): number => Math.round(value * 1000000) / 1000000;

/** 焼き込んだ内容を `/Contents` の**末尾**に足す（既存の描画の上に載せる） */
async function contentsWith(
  editor: PdfDocumentEditor,
  pageDict: CosDict,
  added: CosRef,
): Promise<CosObject> {
  const raw = dictGetRaw(pageDict, 'Contents');
  let existing: readonly CosObject[] = [];
  if (raw !== undefined && raw.kind !== 'null') {
    const resolved = await editor.resolve(raw);
    if (resolved.kind === 'array') existing = resolved.items;
    else if (raw.kind === 'ref') existing = [raw];
    else existing = [await editor.allocate(resolved)];
  }
  return { kind: 'array', items: [...existing, added] };
}

/**
 * 対話要素が無くなった以上、`/AcroForm` を残す意味はない。
 *
 * catalog から鍵を消すだけでなく、**辞書のオブジェクトも消す** ——
 * 残すと `/Fields` が消したフィールドを指したままになる。
 * `/DR` が指すフォントは別オブジェクトなので、外観ストリーム側から今も使える。
 */
async function removeAcroForm(editor: PdfDocumentEditor): Promise<void> {
  const rootRaw = dictGetRaw(editor.trailer(), 'Root');
  if (rootRaw === undefined || rootRaw.kind !== 'ref') return;
  const catalog = await editor.resolve(rootRaw);
  if (catalog.kind !== 'dict') return;
  const acroRaw = dictGetRaw(catalog, 'AcroForm');
  if (acroRaw === undefined) return;
  const entries = new Map<string, CosObject>(catalog.entries);
  entries.delete('AcroForm');
  editor.set(rootRaw.objectNumber, { kind: 'dict', entries }, rootRaw.generationNumber);
  if (acroRaw.kind === 'ref') editor.delete(acroRaw.objectNumber, acroRaw.generationNumber);
}
