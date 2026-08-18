/**
 * `tag_form_fields` の本体 —— Phase 3 の L4′.2（15 本目）。
 *
 * 既にタグ付きの PDF のフォームを PDF/UA-1（ISO 14289-1）へ合わせる。
 *
 * | 要件 | 何をするか |
 * |---|---|
 * | 7.18.4-1 | 各 Widget を `Form` 構造要素に内包する（OBJR + `/StructParent` + ParentTree） |
 * | 7.18.3-1 | Widget のあるページに `/Tabs /S` を立てる |
 * | 7.18.1-3 | フィールドに `/TU`（代替名）を付ける |
 *
 * 構造木への結び付けは `struct-annot.ts` の `appendObjRefToStructTree(…, 'Form')` が行う
 * —— `add_annotation` が `'Annot'` で使っているのと**同じ関数**である。
 *
 * **冪等**: 既に `/StructParent` を持つ Widget は飛ばすので、二度実行しても
 * 構造要素が重複しない。
 */

import { type CosDict, type CosObject, type CosRef, dictGetRaw } from 'normativepdf';
import { type AcroForm, unknownFieldError } from './acroform-read.js';
import { textString } from './cos.js';
import type { OpenedForEdit } from './edit-open.js';
import { appendObjRefToStructTree } from './struct-annot.js';

export interface TagWidgetsOutcome {
  /** 新たに `Form` 構造要素へ内包した Widget 数 */
  tagged: number;
  /** 既に構造木に結ばれていて何もしなかった Widget 数 */
  skipped: number;
  /** どのページの `/Annots` にも見つからなかった Widget のフィールド名 */
  orphaned: string[];
  /** `/TU` をフィールド名で代用したフィールド名（labels 未指定・既存 `/TU` 無し） */
  unlabeled: string[];
}

/** Widget の参照 → それが載っているページ */
type PageIndex = Map<string, { ref: CosRef; dict: CosDict }>;

const refKey = (ref: CosRef): string => `${ref.objectNumber} ${ref.generationNumber}`;

/** 各ページの `/Annots` を走査して、Widget からページを引ける表を作る */
async function indexAnnots(opened: OpenedForEdit): Promise<PageIndex> {
  const index: PageIndex = new Map();
  for (const page of await opened.editor.pages()) {
    if (page.ref === null) continue;
    const raw = dictGetRaw(page.dict, 'Annots');
    if (raw === undefined || raw.kind === 'null') continue;
    const annots = await opened.editor.resolve(raw);
    if (annots.kind !== 'array') continue;
    for (const item of annots.items) {
      if (item.kind === 'ref') index.set(refKey(item), { ref: page.ref, dict: page.dict });
    }
  }
  return index;
}

export async function tagWidgets(
  opened: OpenedForEdit,
  form: AcroForm,
  labels: Record<string, string>,
): Promise<TagWidgetsOutcome> {
  const { editor } = opened;

  // labels の名前は実在するフィールドでなければならない（誤記の黙殺を防ぐ）
  for (const label of Object.keys(labels)) {
    if (!form.fields.some((f) => f.name === label)) throw unknownFieldError(label, form);
  }

  // 7.18.1-3: `/TU`（代替フィールド名）
  const unlabeled: string[] = [];
  for (const field of form.fields) {
    const label = labels[field.name];
    if (label === undefined && dictGetRaw(field.dict, 'TU') !== undefined) continue;
    if (label === undefined) unlabeled.push(field.name);
    const current = await editor.resolve(field.ref);
    if (current.kind !== 'dict') continue;
    const entries = new Map<string, CosObject>(current.entries);
    entries.set('TU', textString(label ?? field.name));
    editor.set(field.ref.objectNumber, { kind: 'dict', entries }, field.ref.generationNumber);
  }

  // 7.18.4-1 / 7.18.3-1: Widget を `Form` 構造要素へ
  const index = await indexAnnots(opened);
  const outcome: TagWidgetsOutcome = { tagged: 0, skipped: 0, orphaned: [], unlabeled };
  for (const field of form.fields) {
    for (const widget of field.widgets) {
      // 冪等: 既に構造木に結ばれているものは触らない
      const current = await editor.resolve(widget.ref);
      if (current.kind === 'dict' && dictGetRaw(current, 'StructParent') !== undefined) {
        outcome.skipped++;
        continue;
      }
      const page = index.get(refKey(widget.ref));
      if (page === undefined) {
        outcome.orphaned.push(field.name);
        continue;
      }
      const appended = await appendObjRefToStructTree(editor, page, widget.ref, 'Form');
      if (appended.tagged) outcome.tagged++;
    }
  }
  return outcome;
}
