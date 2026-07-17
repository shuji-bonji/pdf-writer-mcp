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

import { PDFDict, type PDFDocument, PDFName, PDFStream } from 'pdf-lib';

/** catalog にキーが（値の解決なしに）存在するか */
function hasKey(doc: PDFDocument, key: string): boolean {
  return doc.catalog.get(PDFName.of(key)) !== undefined;
}

interface FeatureSpec {
  id: string;
  /** 利用者に見せる名前（catalog キー付き） */
  label: string;
  /** 根拠条項 */
  clause: string;
  /** 失われると何が起きるか */
  impact: string;
  detect(doc: PDFDocument): boolean;
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
    detect: (doc) => hasKey(doc, 'StructTreeRoot') || hasKey(doc, 'MarkInfo'),
  },
  {
    id: 'metadata',
    label: 'XMP metadata (/Metadata)',
    clause: 'ISO 32000-2 §14.3.2',
    impact:
      'only the Info dictionary survives — the pdfuaid/pdfaid identification, dc:title and any ' +
      'PDF/A or PDF/UA claim no longer travel with the file.',
    detect: (doc) => hasKey(doc, 'Metadata'),
  },
  {
    id: 'embeddedFiles',
    label: 'file attachments (/Names /EmbeddedFiles)',
    clause: 'ISO 32000-2 §7.11.4',
    impact:
      'the attached files are gone. For PDF/A-3 (ISO 19005-3 §6.8) that includes the ' +
      'machine-readable payload of the document (e.g. the invoice XML/CSV kept for statutory ' +
      'e-bookkeeping) — the human-readable pages remain but the data does not.',
    detect: (doc) => {
      const names = doc.catalog.lookup(PDFName.of('Names'));
      return names instanceof PDFDict && names.get(PDFName.of('EmbeddedFiles')) !== undefined;
    },
  },
  {
    id: 'af',
    label: 'associated files (catalog /AF)',
    clause: 'ISO 32000-2 §14.13.3',
    impact:
      'the /AFRelationship link between the document and its associated files is gone ' +
      '(PDF/A-3 requires it).',
    detect: (doc) => hasKey(doc, 'AF'),
  },
  {
    id: 'acroForm',
    label: 'interactive form (/AcroForm)',
    clause: 'ISO 32000-2 §12.7.3',
    impact:
      'the form dictionary is gone. The widget annotations were copied with the pages but are no ' +
      'longer reachable as fields, so the form is not fillable and its values may not render.',
    detect: (doc) => hasKey(doc, 'AcroForm'),
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
    detect: (doc) => hasKey(doc, 'OCProperties'),
  },
  {
    id: 'outputIntents',
    label: 'output intents (/OutputIntents)',
    clause: 'ISO 32000-2 §14.11.5',
    impact:
      'the declared colour characteristics are gone; PDF/A and PDF/X require an output intent.',
    detect: (doc) => hasKey(doc, 'OutputIntents'),
  },
  {
    id: 'outlines',
    label: 'bookmarks (/Outlines)',
    clause: 'ISO 32000-2 §12.3.3',
    impact: 'the document outline is gone. Re-create it with add_bookmarks on the output.',
    detect: (doc) => hasKey(doc, 'Outlines'),
  },
  {
    id: 'lang',
    label: 'document language (/Lang)',
    clause: 'ISO 32000-2 §14.9.2',
    impact:
      'the natural language is now unknown, so screen readers fall back to their own default ' +
      'and may mispronounce the text (PDF/UA-1 7.2 requires /Lang).',
    detect: (doc) => hasKey(doc, 'Lang'),
  },
  {
    id: 'viewerPreferences',
    label: 'viewer preferences (/ViewerPreferences)',
    clause: 'ISO 32000-2 §12.2',
    impact:
      'display settings are gone — including DisplayDocTitle, which PDF/UA-1 7.1 requires ' +
      'to be true.',
    detect: (doc) => hasKey(doc, 'ViewerPreferences'),
  },
  {
    id: 'pageLabels',
    label: 'page labels (/PageLabels)',
    clause: 'ISO 32000-2 §12.4.2',
    impact:
      'pages are labelled 1..n again; roman-numeral front matter and other labelling ranges ' +
      'are gone.',
    detect: (doc) => hasKey(doc, 'PageLabels'),
  },
  {
    id: 'dests',
    label: 'named destinations (/Dests)',
    clause: 'ISO 32000-2 §12.3.2.4',
    impact: 'links that resolve through named destinations no longer find their target.',
    detect: (doc) => hasKey(doc, 'Dests'),
  },
  {
    id: 'openAction',
    label: 'open action (/OpenAction)',
    clause: 'ISO 32000-2 §12.6.2',
    impact: 'the document no longer opens at the destination the author chose.',
    detect: (doc) => hasKey(doc, 'OpenAction'),
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
export function surveyDocLevel(doc: PDFDocument): DocLevelSurvey {
  const found: DocLevelSurvey = new Set();
  for (const f of FEATURES) {
    if (f.detect(doc)) found.add(f.id);
  }
  for (const key of MINOR_KEYS) {
    if (hasKey(doc, key)) found.add(`minor:${key}`);
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
export function usesOptionalContent(doc: PDFDocument): boolean {
  const OC = PDFName.of('OC');
  for (const page of doc.getPages()) {
    const res = page.node.lookup(PDFName.of('Resources'));
    if (res instanceof PDFDict) {
      const props = res.lookup(PDFName.of('Properties'));
      if (props instanceof PDFDict) {
        for (const [name] of props.entries()) {
          const entry = props.lookup(name);
          const type = entry instanceof PDFDict ? entry.get(PDFName.of('Type')) : undefined;
          const t = type?.toString();
          if (t === '/OCG' || t === '/OCMD') return true;
        }
      }
      const xobjects = res.lookup(PDFName.of('XObject'));
      if (xobjects instanceof PDFDict) {
        for (const [name] of xobjects.entries()) {
          const x = xobjects.lookup(name);
          if (x instanceof PDFStream && x.dict.get(OC) !== undefined) return true;
        }
      }
    }
    for (const annot of page.node.Annots()?.asArray() ?? []) {
      const dict = page.node.context.lookup(annot);
      if (dict instanceof PDFDict && dict.get(OC) !== undefined) return true;
    }
  }
  return false;
}

export interface DocLevelLossOptions {
  /** 報告に載せるツール名（例: 'merge_pdfs'） */
  tool: string;
  /** 入力側の採取結果（merge は mergeSurveys で合流させたもの） */
  before: DocLevelSurvey;
  /** 実際に組み上がった出力 */
  after: PDFDocument;
}

/**
 * 「入力にあったが出力で失われた」文書レベル要素を warnings にする。
 * 出力を実測するため、引き継ぎを実装した要素については自動的に黙る（B-10b への布石）。
 */
export function docLevelLossWarnings(opts: DocLevelLossOptions): string[] {
  const { tool, before, after } = opts;
  if (before.size === 0) return [];

  const kept = surveyDocLevel(after);
  const warnings: string[] = [];

  for (const f of FEATURES) {
    if (!before.has(f.id) || kept.has(f.id)) continue;
    let impact = f.impact;
    if (f.id === 'ocProperties' && usesOptionalContent(after)) {
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
      'These are lost because page copying rebuilds the document from the pages alone; only the ' +
        'Info dictionary is carried over today. If you need them, apply the page operation first ' +
        'and re-apply the document-level step afterwards (e.g. attach_file / ensure_tagged / ' +
        'add_bookmarks / set_metadata on the output).',
    );
  }
  return warnings;
}
