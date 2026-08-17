/**
 * Document-level carry-over survey（B-10a）
 *
 * ページ操作系（merge / split / extract / delete / reorder）は pdf-lib の
 * `copyPages()` で新規文書を組み立てる。copyPages は**ページ配下だけ**を複製し、
 * catalog の文書レベルエントリ（ISO 32000-2 Table 29）を運ばない。
 * その結果、タグ付き構造・XMP・添付・フォーム辞書などが**黙って消える**。
 *
 * タグ無し PDF になること自体は仕様違反ではない（§14.8.1 の MarkInfo shall は
 * 「タグ付きを名乗る文書」への要求）。問題は **黙って**落とすことで、
 * writer の原則（署名ガード・flatten のタグ拒否 = 「壊すなら明示する」）に対する
 * 内部不整合だった。本モジュールはその「明示」を担う。
 *
 * 設計: 入力の catalog を採取（surveyDocLevel）し、**出力の catalog を実際に見て**
 * 失われたものだけを報告する（docLevelLossWarnings）。「copyPages は落とす」という
 * 前提を焼き込まないので、B-10b で引き継ぎを実装すれば警告は自動的に消える。
 *
 * 例外的に「損失」ではなく「仕様違反」になるものが 1 件ある:
 *   /OCProperties は §8.11.4.2「This dictionary shall be present if the PDF file
 *   contains any optional content」（R-8.11.4.2-2）が要求する。複製したページが
 *   光学的内容を使ったまま OCProperties だけ落ちると、出力は shall 違反になる
 *   （PDF プロセッサは光学的内容の構造を無視する = 隠すべき内容が出る／出すべき内容が消える）。
 */

import {
  COS_NULL,
  type CosDict,
  type CosObject,
  dictGet,
  dictGetRaw,
  type PdfDocumentEditor,
} from 'normativepdf';
import { type CopyContext, copyCatalogValue } from './cos-copy.js';

/**
 * catalog を 1 回だけ読んで作る「見え方」。
 *
 * 採取は merge のループ内でも呼ばれるので、**毎回 catalog を解決し直さない**ために
 * 一度だけ読んで渡す。`detect` が同期で書けるのもこの形のおかげである。
 */
export interface CatalogView {
  /** catalog にキーが（値の解決なしに）存在するか */
  has(key: string): boolean;
  /** `/Names` の下に `/EmbeddedFiles` があるか */
  embeddedFiles: boolean;
}

/** 文書の catalog を読んで `CatalogView` を作る。 */
export async function catalogView(editor: PdfDocumentEditor): Promise<CatalogView> {
  const rootRaw = dictGetRaw(editor.trailer(), 'Root');
  const catalog = rootRaw === undefined ? COS_NULL : await editor.resolve(rootRaw);
  const entries = catalog.kind === 'dict' ? catalog.entries : new Map<string, CosObject>();

  let embeddedFiles = false;
  if (catalog.kind === 'dict') {
    const names = await editor.resolve(dictGet(catalog, 'Names') ?? COS_NULL);
    embeddedFiles = names.kind === 'dict' && dictGet(names, 'EmbeddedFiles') !== undefined;
  }
  return { has: (key) => entries.has(key), embeddedFiles };
}

interface FeatureSpec {
  id: string;
  /** 利用者に見せる名前（catalog キー付き） */
  label: string;
  /** 根拠条項 */
  clause: string;
  /** 失われると何が起きるか */
  impact: string;
  detect(view: CatalogView): boolean;
}

/**
 * 個別に報告する文書レベル要素（実害の大きい順）。
 * ここに無い catalog エントリは MINOR_KEYS で名前だけまとめて報告する。
 */
const FEATURES: FeatureSpec[] = [
  {
    id: 'tagged',
    label: 'tagged structure (/StructTreeRoot, /MarkInfo)',
    clause: 'ISO 32000-2 §14.7.2 / §14.8.1',
    impact:
      'the output is untagged — PDF/UA-1 conformance, reading order, headings and alt text ' +
      'are gone. Assistive technology now sees an unstructured page.',
    detect: (view) => view.has('StructTreeRoot') || view.has('MarkInfo'),
  },
  {
    id: 'metadata',
    label: 'XMP metadata (/Metadata)',
    clause: 'ISO 32000-2 §14.3.2',
    impact:
      'only the Info dictionary survives — the pdfuaid/pdfaid identification, dc:title and any ' +
      'PDF/A or PDF/UA claim no longer travel with the file.',
    detect: (view) => view.has('Metadata'),
  },
  {
    id: 'embeddedFiles',
    label: 'file attachments (/Names /EmbeddedFiles)',
    clause: 'ISO 32000-2 §7.11.4',
    impact:
      'the attached files are gone. For PDF/A-3 (ISO 19005-3 §6.8) that includes the ' +
      'machine-readable payload of the document (e.g. the invoice XML/CSV kept for statutory ' +
      'e-bookkeeping) — the human-readable pages remain but the data does not.',
    detect: (view) => view.embeddedFiles,
  },
  {
    id: 'af',
    label: 'associated files (catalog /AF)',
    clause: 'ISO 32000-2 §14.13.3',
    impact:
      'the /AFRelationship link between the document and its associated files is gone ' +
      '(PDF/A-3 requires it).',
    detect: (view) => view.has('AF'),
  },
  {
    id: 'acroForm',
    label: 'interactive form (/AcroForm)',
    clause: 'ISO 32000-2 §12.7.3',
    impact:
      'the form dictionary is gone. The widget annotations were copied with the pages but are no ' +
      'longer reachable as fields, so the form is not fillable and its values may not render.',
    detect: (view) => view.has('AcroForm'),
  },
  {
    id: 'ocProperties',
    label: 'optional content configuration (/OCProperties)',
    clause: 'ISO 32000-2 §8.11.4.2',
    impact:
      'the optional content groups lose their configuration. Per §8.11.4.2 this dictionary ' +
      '"shall be present if the PDF file contains any optional content"; without it a PDF ' +
      'processor ignores the optional content structures, so layers that should be hidden may ' +
      'show (or vice versa).',
    detect: (view) => view.has('OCProperties'),
  },
  {
    id: 'outputIntents',
    label: 'output intents (/OutputIntents)',
    clause: 'ISO 32000-2 §14.11.5',
    impact:
      'the declared colour characteristics are gone; PDF/A and PDF/X require an output intent.',
    detect: (view) => view.has('OutputIntents'),
  },
  {
    id: 'outlines',
    label: 'bookmarks (/Outlines)',
    clause: 'ISO 32000-2 §12.3.3',
    impact: 'the document outline is gone. Re-create it with add_bookmarks on the output.',
    detect: (view) => view.has('Outlines'),
  },
  {
    id: 'lang',
    label: 'document language (/Lang)',
    clause: 'ISO 32000-2 §14.9.2',
    impact:
      'the natural language is now unknown, so screen readers fall back to their own default ' +
      'and may mispronounce the text (PDF/UA-1 7.2 requires /Lang).',
    detect: (view) => view.has('Lang'),
  },
  {
    id: 'viewerPreferences',
    label: 'viewer preferences (/ViewerPreferences)',
    clause: 'ISO 32000-2 §12.2',
    impact:
      'display settings are gone — including DisplayDocTitle, which PDF/UA-1 7.1 requires ' +
      'to be true.',
    detect: (view) => view.has('ViewerPreferences'),
  },
  {
    id: 'pageLabels',
    label: 'page labels (/PageLabels)',
    clause: 'ISO 32000-2 §12.4.2',
    impact:
      'pages are labelled 1..n again; roman-numeral front matter and other labelling ranges ' +
      'are gone.',
    detect: (view) => view.has('PageLabels'),
  },
  {
    id: 'dests',
    label: 'named destinations (/Dests)',
    clause: 'ISO 32000-2 §12.3.2.4',
    impact: 'links that resolve through named destinations no longer find their target.',
    detect: (view) => view.has('Dests'),
  },
  {
    id: 'openAction',
    label: 'open action (/OpenAction)',
    clause: 'ISO 32000-2 §12.6.2',
    impact: 'the document no longer opens at the destination the author chose.',
    detect: (view) => view.has('OpenAction'),
  },
];

/**
 * 個別の説明までは持たないが、失われたら名前だけは告げる catalog エントリ（Table 29）。
 * Type / Pages は出力側で作り直される。Perms / DSS / Legal は署名関連で、
 * 署名済み入力は既に署名ガードが止めている。
 */
const MINOR_KEYS = [
  'Version',
  'Extensions',
  'PageLayout',
  'PageMode',
  'Threads',
  'AA',
  'URI',
  'SpiderInfo',
  'PieceInfo',
  'Collection',
  'Requirements',
  'DPartRoot',
  'NeedsRendering',
] as const;

/** 入力 1 文書の文書レベル要素の採取結果（feature id / minor キー名の集合） */
export type DocLevelSurvey = Set<string>;

/** catalog の文書レベル要素を採取する（merge のループ内でも安く呼べるよう軽量に保つ） */
export function surveyDocLevel(view: CatalogView): DocLevelSurvey {
  const found: DocLevelSurvey = new Set();
  for (const f of FEATURES) {
    if (f.detect(view)) found.add(f.id);
  }
  for (const key of MINOR_KEYS) {
    if (view.has(key)) found.add(`minor:${key}`);
  }
  return found;
}

/** 複数入力の採取結果を合流させる（merge_pdfs 用） */
export function mergeSurveys(surveys: DocLevelSurvey[]): DocLevelSurvey {
  const all: DocLevelSurvey = new Set();
  for (const s of surveys) for (const id of s) all.add(id);
  return all;
}

/**
 * ページが光学的内容（optional content）を使っているか。
 * §8.11.4.2 の shall（OCProperties の存在義務）が働くかどうかの判定に使う。
 * 見るのは ①/Resources /Properties に OCG/OCMD がある ②XObject の辞書に /OC がある
 * ③注釈に /OC がある、の 3 経路。
 */
export async function usesOptionalContent(editor: PdfDocumentEditor): Promise<boolean> {
  for (const page of await editor.pages()) {
    const resources = await editor.resolve(dictGet(page.dict, 'Resources') ?? COS_NULL);
    if (resources.kind === 'dict') {
      const properties = await editor.resolve(dictGet(resources, 'Properties') ?? COS_NULL);
      if (properties.kind === 'dict') {
        for (const [, value] of properties.entries) {
          const entry = await editor.resolve(value);
          const type = entry.kind === 'dict' ? dictGet(entry, 'Type') : undefined;
          if (type?.kind === 'name' && (type.value === 'OCG' || type.value === 'OCMD')) return true;
        }
      }
      const xobjects = await editor.resolve(dictGet(resources, 'XObject') ?? COS_NULL);
      if (xobjects.kind === 'dict') {
        for (const [, value] of xobjects.entries) {
          const xobject = await editor.resolve(value);
          if (xobject.kind === 'stream' && dictGet(xobject.dict, 'OC') !== undefined) return true;
        }
      }
    }
    const annots = await editor.resolve(dictGet(page.dict, 'Annots') ?? COS_NULL);
    if (annots.kind === 'array') {
      for (const item of annots.items) {
        const annot = await editor.resolve(item);
        if (annot.kind === 'dict' && dictGet(annot, 'OC') !== undefined) return true;
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// B-10b: 引き継ぎ
// ---------------------------------------------------------------------------

/**
 * ページ複製の出力へ引き継ぐ catalog エントリ（B-10b）。
 *
 * **「引き継げるか」ではなく「引き継いで嘘にならないか」で選んでいる。**
 * 監査（SPEC-AUDIT Phase 1.5）の初版計画は「Metadata / Names / AF / **MarkInfo** を引き継ぐ」
 * だったが、これはそのままでは実行できない — 詳細は `carryDocumentLevel` の注記を参照。
 *
 * ここに**無い**もの（＝意図的に引き継がない）と理由:
 *   - `StructTreeRoot` / `MarkInfo`: 構造木の再構築が要る（B-10c）。MarkInfo だけ運ぶと
 *     「タグ付きだ」と名乗って構造木が無い文書になる（嘘）
 *   - `Metadata`(XMP): 準拠宣言を含むと嘘になるため条件付き。`carryXmp` で別途処理
 *   - `AcroForm`: /Fields が元文書のフィールド辞書を指す。複製後のオブジェクトへの
 *     張り替えが要る（B-10c 相当）
 *   - `OCProperties`: /OCGs が元の OCG を指す。同上
 *   - `PageLabels` / `Dests` / `OpenAction` / `Outlines`: **ページ番号・ページ参照に依存する**。
 *     extract / delete / reorder / merge はページ集合と順序を変えるため、そのまま運ぶと
 *     宙吊りか誤った位置を指す
 */
const CARRIED_KEYS = ['Names', 'AF', 'Lang', 'ViewerPreferences', 'OutputIntents'] as const;

/** XMP パケットが準拠宣言（PDF/UA・PDF/A）を含むか */
function declaresConformance(xmp: string): boolean {
  return /pdfuaid|pdfaid/i.test(xmp);
}

export interface CarryResult {
  /** 引き継いだ catalog キー */
  carried: string[];
  /**
   * **入力は持っていたが、出力に既にあったので採らなかった** catalog キー（merge の 2 件目以降）。
   *
   * これを呼び出し側が報告しないと黙って消える。`docLevelLossWarnings` は
   * 「その機能が出力にあるか」しか見ないため、**入力 1 の添付さえ運ばれていれば
   * 入力 2 の添付が消えても黙ってしまう**（機能単位であってファイル単位ではない）。
   */
  skipped: string[];
  warnings: string[];
}

/**
 * 文書レベルの catalog エントリを src から dst へ引き継ぐ（B-10b）。
 *
 * ページの複写はページツリー配下しか運ばないので、ここで catalog の中身を運ぶ。
 * オブジェクトの複製は `cos-copy.ts` に委ねる（参照グラフを辿って深く複写する）。
 *
 * **設計判断: 引き継げるものを全部引き継ぐのではなく、「引き継いで嘘にならないもの」だけ運ぶ。**
 * `MarkInfo` は運ばない —— `MarkInfo/Marked=true` は「この文書はタグ付き PDF である」という
 * **宣言**であり、StructTreeRoot（B-10c 待ち）が無いまま運ぶと構造木の無いタグ付き文書という
 * 矛盾になる。同じ理由で XMP も、`pdfuaid`/`pdfaid` の準拠宣言を含む場合は運ばない ——
 * 運ぶと veraPDF がその flavour で検証して**落ちるようになり、黙って落とす今より悪化する**
 * （偽の準拠主張は「準拠が消える」より有害）。理由は warnings で説明する。
 *
 * 🔴 **ストリームは間接のまま運ぶ**（R-7.3.8.1-5・Table 29 の `Metadata` は
 * shall be an indirect reference = R-7.7.2-22）。直接オブジェクトとして catalog に
 * 埋めると、catalog がオブジェクトストリームに入る構成で生バイトが埋まり、
 * **出力 PDF が壊れる**（実測: `qpdf: unable to find /Root dictionary`・v0.13.0 の
 * リグレッション。W-1）。`copyCatalogValue` がその格上げを引き受ける。
 */
export async function carryDocumentLevel(ctx: CopyContext): Promise<CarryResult> {
  const carried: string[] = [];
  const skipped: string[] = [];
  const warnings: string[] = [];

  const source = await catalogEntries(ctx.from);
  const destination = await catalogEntries(ctx.to);

  for (const key of CARRIED_KEYS) {
    const value = source.get(key);
    if (value === undefined) continue;
    if (destination.has(key)) {
      // 先勝ち（merge の 2 件目以降）。**呼び出し側が報告しないと黙って消える**
      skipped.push(key);
      continue;
    }
    destination.set(key, await copyCatalogValue(ctx, value));
    carried.push(key);
  }

  const xmp = await carryXmp(ctx, source, destination);
  if (xmp.carried) carried.push('Metadata');
  if (xmp.skipped) skipped.push('Metadata');
  warnings.push(...xmp.warnings);

  await writeCatalog(ctx.to, destination);
  return { carried, skipped, warnings };
}

/** catalog の項目表を読む（値は解決しない —— 参照は参照のまま運ぶため）。 */
async function catalogEntries(editor: PdfDocumentEditor): Promise<Map<string, CosObject>> {
  const rootRaw = dictGetRaw(editor.trailer(), 'Root');
  const catalog = rootRaw === undefined ? COS_NULL : await editor.resolve(rootRaw);
  return new Map<string, CosObject>(catalog.kind === 'dict' ? catalog.entries : []);
}

/** catalog を書き戻す。 */
async function writeCatalog(
  editor: PdfDocumentEditor,
  entries: Map<string, CosObject>,
): Promise<void> {
  const rootRaw = dictGetRaw(editor.trailer(), 'Root');
  const updated: CosDict = { kind: 'dict', entries };
  if (rootRaw !== undefined && rootRaw.kind === 'ref') {
    editor.set(rootRaw.objectNumber, updated, rootRaw.generationNumber);
  } else {
    editor.setTrailerEntry('Root', updated);
  }
}

/**
 * XMP を引き継ぐ。ただし準拠宣言（pdfuaid / pdfaid）を含む場合は運ばず理由を説明する。
 * 構造木も PDF/A の要件も引き継げていない以上、その宣言は偽になるため。
 */
async function carryXmp(
  ctx: CopyContext,
  source: Map<string, CosObject>,
  destination: Map<string, CosObject>,
): Promise<{ carried: boolean; skipped: boolean; warnings: string[] }> {
  const raw = source.get('Metadata');
  if (raw === undefined) return { carried: false, skipped: false, warnings: [] };
  if (destination.has('Metadata')) return { carried: false, skipped: true, warnings: [] };

  const stream = await ctx.from.resolve(raw);
  if (stream.kind !== 'stream') return { carried: false, skipped: false, warnings: [] };

  let packet = '';
  try {
    packet = new TextDecoder().decode(stream.raw);
  } catch {
    return { carried: false, skipped: false, warnings: [] };
  }

  if (declaresConformance(packet)) {
    return {
      carried: false,
      skipped: false,
      warnings: [
        'The input XMP declares conformance (pdfuaid/pdfaid) that this output can no longer ' +
          'meet — the structure tree is not carried over yet — so it was dropped rather than ' +
          'copied. Copying it would make the file claim PDF/UA or PDF/A conformance it does not ' +
          'have, which is worse than losing the claim: a validator would then check it against ' +
          'that flavour and fail. Use ensure_tagged + set_metadata on the output to rebuild an ' +
          'honest declaration.',
      ],
    };
  }

  // 検査は解決した実体で行うが、**複製に渡すのは元の値（通常は ref）**（W-1）
  destination.set('Metadata', await copyCatalogValue(ctx, raw));
  return { carried: true, skipped: false, warnings: [] };
}

/** merge の「先勝ち」で採らなかった要素を報告する（黙って消させない） */
export function firstWinsWarning(tool: string, skipped: string[], inputLabel: string): string {
  return (
    `${tool} kept the ${skipped.map((k) => `/${k}`).join(', ')} of the first input and did not ` +
    `merge the one(s) in ${inputLabel}. Only the first input's values survive. ` +
    "For attachments this means the later files' embedded data is gone — merge them into the " +
    'output with attach_file if you need them.'
  );
}

export interface DocLevelLossOptions {
  /** 報告に載せるツール名（例: 'merge_pdfs'） */
  tool: string;
  /** 入力側の採取結果（merge は mergeSurveys で合流させたもの） */
  before: DocLevelSurvey;
  /** 実際に組み上がった出力の catalog（`catalogView` で読む） */
  after: CatalogView;
  /**
   * 出力のページが光学的内容を使っているか（`usesOptionalContent` の結果）。
   *
   * ここで受け取るのは、判定が**非同期**（ページを辿る）なのに対し、
   * この関数は警告を組み立てるだけの同期処理だからである。
   */
  afterUsesOptionalContent: boolean;
}

/**
 * 「入力にあったが出力で失われた」文書レベル要素を warnings にする。
 * 出力を実測するため、引き継ぎを実装した要素については自動的に黙る（B-10b への布石）。
 */
export function docLevelLossWarnings(opts: DocLevelLossOptions): string[] {
  const { tool, before, after, afterUsesOptionalContent } = opts;
  if (before.size === 0) return [];

  const kept = surveyDocLevel(after);
  const warnings: string[] = [];

  for (const f of FEATURES) {
    if (!before.has(f.id) || kept.has(f.id)) continue;
    let impact = f.impact;
    if (f.id === 'ocProperties' && afterUsesOptionalContent) {
      impact =
        `${impact} The copied pages DO use optional content, so this output ` +
        'violates §8.11.4.2.';
    }
    warnings.push(
      `${tool} did not carry over the ${f.label} that the input had (${f.clause}): ${impact}`,
    );
  }

  const lostMinor = MINOR_KEYS.filter(
    (key) => before.has(`minor:${key}`) && !kept.has(`minor:${key}`),
  );
  if (lostMinor.length > 0) {
    warnings.push(
      `${tool} also dropped these document-level catalog entries present in the input ` +
        `(ISO 32000-2 Table 29): ${lostMinor.map((k) => `/${k}`).join(', ')}.`,
    );
  }

  if (warnings.length > 0) {
    warnings.push(
      'These are lost because page copying rebuilds the document from the pages alone. ' +
        'Attachments, /AF, /Lang, /ViewerPreferences and /OutputIntents are carried over; ' +
        'the rest either need the structure tree (B-10c) or depend on page numbers and ' +
        'page references that these operations change. Re-apply the document-level step to ' +
        'the output if you need them (e.g. ensure_tagged / add_bookmarks / set_metadata).',
    );
  }
  return warnings;
}
