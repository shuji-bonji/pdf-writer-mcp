/**
 * MCP Tool 定義（E-5: McpServer + Zod 移行後のレジストリ）
 *
 * 入力スキーマ（shape）は utils/validation.ts の Zod スキーマから導出する —
 * 公開スキーマと実行時検証の情報源は一つ。実装は handlers.ts。
 *
 * description は英語が正典（B-21）。日本語はサイト側の翻訳メモリ
 * （pdf-agent-stack/scripts/i18n/pdf-writer.ja.json）が持つ。
 *
 * annotations（E-4）:
 *   - readOnlyHint: writer は全ツールがファイルを書くため常に false
 *   - destructiveHint: 情報が失われる操作（delete_pages / flatten_form）のみ true
 *   - idempotentHint: 同一引数の再実行が同じ結果になるため true
 *   - openWorldHint: ローカルファイルのみを扱うため false
 */

import type { ZodRawShape } from 'zod';
import {
  addAnnotationShape,
  addBookmarksShape,
  addWatermarkShape,
  attachFileShape,
  createMarkdownShape,
  createTableShape,
  createTextShape,
  deletePagesShape,
  ensurePdfaShape,
  ensureTaggedShape,
  extractPagesShape,
  fillFormShape,
  flattenFormShape,
  mergePdfsShape,
  reorderPagesShape,
  rotatePagesShape,
  setMetadataShape,
  splitPdfShape,
  stampPageNumbersShape,
  tagFormFieldsShape,
} from '../utils/validation.js';

export interface ToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  shape: ZodRawShape;
  annotations: ToolAnnotations;
}

const base: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

/**
 * ページ複製で新規文書を組み立てるツール（merge / split / extract / delete / reorder）の共通注意（B-10a）。
 * rotate_pages は in-place なので該当しない。
 */
const PAGE_COPY_NOTE =
  'Pages are copied into a new document, so document-level information (tagged structure, ' +
  'XMP, attachments, AcroForm, bookmarks, etc.) is not carried over. Anything lost is reported ' +
  'in warnings; follow up on the output with attach_file / ensure_tagged / add_bookmarks / ' +
  'set_metadata as needed.';

export const tools: ToolDefinition[] = [
  {
    name: 'create_text_pdf',
    title: 'Create PDF from Plain Text',
    description:
      'Create a PDF from plain text. Honours line breaks (\\n) and treats blank lines as paragraph breaks. Long lines wrap automatically.',
    shape: createTextShape,
    annotations: base,
  },
  {
    name: 'create_markdown_pdf',
    title: 'Create PDF from Markdown',
    description:
      'Create a PDF from Markdown. Supports headings, paragraphs, bullet/numbered lists, code blocks, quotes, horizontal rules and tables. ' +
      'Inline decoration markers are stripped and the text rendered plain (single font).',
    shape: createMarkdownShape,
    annotations: base,
  },
  {
    name: 'create_table_pdf',
    title: 'Create Table PDF',
    description:
      'Create a ruled table PDF from headers and row data. Column widths are computed from the content, cells wrap, and the header row is redrawn after page breaks.',
    shape: createTableShape,
    annotations: base,
  },
  {
    name: 'set_metadata',
    title: 'Set PDF Metadata',
    description:
      "Update an existing PDF's metadata (the Info dictionary). Only the given fields change; the rest are preserved. " +
      'At least one of title / author / subject / keywords / creator is required. ' +
      'In documents with XMP (/Metadata), dc:title etc. are synchronized to prevent divergence. ' +
      'For signed PDFs, preserveSignatures: true updates while keeping the signatures intact.',
    shape: setMetadataShape,
    annotations: base,
  },
  {
    name: 'merge_pdfs',
    title: 'Merge PDFs',
    description:
      'Merge multiple PDFs into one, in the given order. Document metadata is carried over from the first file. ' +
      PAGE_COPY_NOTE,
    shape: mergePdfsShape,
    annotations: base,
  },
  {
    name: 'split_pdf',
    title: 'Split PDF',
    description:
      'Split a PDF into multiple files by page range. Each element of ranges becomes one file, ' +
      'named "<prefix>1.pdf", "<prefix>2.pdf", and so on. ' +
      PAGE_COPY_NOTE,
    shape: splitPdfShape,
    annotations: base,
  },
  {
    name: 'extract_pages',
    title: 'Extract Pages',
    description:
      'Create a new PDF containing only the given pages. The given order is preserved, so extraction doubles as reordering. ' +
      PAGE_COPY_NOTE,
    shape: extractPagesShape,
    annotations: base,
  },
  {
    name: 'delete_pages',
    title: 'Delete Pages',
    description: `Create a new PDF with the given pages removed. Deleting every page is an error. ${PAGE_COPY_NOTE}`,
    shape: deletePagesShape,
    annotations: { ...base, destructiveHint: true },
  },
  {
    name: 'reorder_pages',
    title: 'Reorder Pages',
    description: `Reorder pages. order must list every page exactly once, in the new order. ${PAGE_COPY_NOTE}`,
    shape: reorderPagesShape,
    annotations: base,
  },
  {
    name: 'add_bookmarks',
    title: 'Add Bookmarks (Outline)',
    description:
      'Set the bookmarks (outline) of a PDF. Existing bookmarks are replaced. Nest with children. ' +
      'For signed PDFs, preserveSignatures: true sets them while keeping the signatures intact.',
    shape: addBookmarksShape,
    annotations: base,
  },
  {
    name: 'add_annotation',
    title: 'Add Annotation',
    description:
      'Add one annotation to a page: sticky note (text), highlight, or rectangle (square). ' +
      'Coordinates are in PDF space (origin bottom-left, pt). ' +
      'For signed PDFs, preserveSignatures: true appends an incremental update without invalidating existing signatures ' +
      '(in tagged documents the enclosure in an Annot structure element rides the same update, preserving PDF/UA conformance).',
    shape: addAnnotationShape,
    annotations: { ...base, idempotentHint: false },
  },
  {
    name: 'stamp_page_numbers',
    title: 'Stamp Page Numbers',
    description:
      'Stamp a page number on each page. In tagged PDFs the stamp is wrapped as an Artifact, preserving PDF/UA conformance. ' +
      'Formats containing CJK text need fontPath or the PDF_WRITER_FONT environment variable.',
    shape: stampPageNumbersShape,
    annotations: base,
  },
  {
    name: 'add_watermark',
    title: 'Add Watermark',
    description:
      'Overlay a diagonal watermark across the middle of each page ("社外秘" / "DRAFT" / "COPY", etc.). ' +
      'Drawn faintly behind the content by default. In tagged PDFs it is wrapped as an Artifact, preserving PDF/UA conformance. ' +
      'CJK watermarks need fontPath or the PDF_WRITER_FONT environment variable.',
    shape: addWatermarkShape,
    annotations: base,
  },
  {
    name: 'fill_form',
    title: 'Fill Form (AcroForm)',
    description:
      "Fill field values into an existing PDF's interactive form (AcroForm). " +
      'If you do not know the field names, pass a nonexistent one — the error lists every field name and type. ' +
      'CJK values need fontPath or the PDF_WRITER_FONT environment variable. ' +
      'flatten: true makes the form non-interactive after filling, but on a tagged PDF that breaks PDF/UA conformance ' +
      'and additionally requires allowBreakingTags: true. XFA forms are not supported.',
    shape: fillFormShape,
    annotations: base,
  },
  {
    name: 'flatten_form',
    title: 'Flatten Form',
    description:
      "Flatten an existing PDF's interactive form (AcroForm), keeping the filled appearance while removing interactivity. " +
      'Use it to freeze values before distribution. If existing values contain CJK text, set fontPath or ' +
      'PDF_WRITER_FONT in case appearances must be regenerated. ' +
      'On tagged PDFs, Widget annotations disappear and Form structure elements are left dangling, ' +
      'so it refuses by default (allowBreakingTags: true to force).',
    shape: flattenFormShape,
    annotations: { ...base, destructiveHint: true },
  },
  {
    name: 'tag_form_fields',
    title: 'Tag Form Fields (PDF/UA repair)',
    description:
      "Repair a tagged PDF's form to PDF/UA-1: enclose Widget annotations in Form structure elements " +
      '(7.18.4-1), set /Tabs S on the affected pages (7.18.3-1), and give fields alternate names /TU ' +
      '(7.18.1-3). Pass human-readable names for screen readers via labels. ' +
      'Widgets already bound to the structure tree are skipped, so it is safe to run repeatedly. ' +
      "Untagged documents are out of scope (rebuild with the create tools' tagged: true, or run ensure_tagged first). " +
      'For signed PDFs, preserveSignatures: true repairs while keeping the signatures intact (approval signatures only; certification signatures are refused).',
    shape: tagFormFieldsShape,
    annotations: base,
  },
  {
    name: 'ensure_tagged',
    title: 'Ensure Tagged (PDF/UA scaffold & repair)',
    description:
      'Put an existing PDF onto the PDF/UA-1 "vessel". If it is already tagged, the structure tree is untouched and ' +
      'only missing document-level requirements are supplied (MarkInfo / Lang / DisplayDocTitle / XMP pdfuaid:part and dc:title). ' +
      'For untagged documents, a minimal structure tree (each page = one P element) is created so the content ' +
      'becomes reachable by assistive technology. ' +
      '**IMPORTANT**: machines cannot infer meaning — headings, tables, lists, reading order and figure alt text are ' +
      'NOT created. The new tree is a scaffold, not an accessible document; it needs human review. ' +
      "If you can build the structure right from the start, use the create tools' tagged: true. " +
      'For signed PDFs, preserveSignatures: true (approval signatures only; certification signatures are refused).',
    shape: ensureTaggedShape,
    annotations: base,
  },
  {
    name: 'ensure_pdfa',
    title: 'Ensure PDF/A (archival conformance scaffold)',
    description:
      'Put an existing PDF onto the PDF/A "vessel" (the PDF/A counterpart of ensure_tagged). ' +
      'Choose the flavour: "pdfa-3b" (default) / "pdfa-4" / "pdfa-4f". ' +
      'Supplies only the missing document-level requirements: the trailer /ID (ISO 32000-1 14.4), ' +
      'an sRGB OutputIntent (GTS_PDFA1; an ICC profile is generated and embedded), and XMP pdfaid. ' +
      '**The -4 flavours additionally set the header to PDF 2.0 and delete the Info dictionary** ' +
      '(-4 forbids Info unless the catalog has /PieceInfo — stricter than ISO 32000-2 14.3.3). ' +
      '**Content, structure tree and fonts are never touched.** ' +
      '**Documents with attachments must use "pdfa-4f"** — plain "pdfa-4" requires every attachment to be ' +
      'PDF/A itself, so bundling CSV or JSON (the Japanese e-bookkeeping-law pattern) would not conform. ' +
      '**IMPORTANT**: this is preparation for claiming PDF/A, not a guarantee of conformance. ' +
      'Violations such as unembedded fonts, encryption, JavaScript or LZW are not repaired. ' +
      '**Writing pdfaid into XMP is the document claiming "I am PDF/A"** — applied to a non-conforming ' +
      'document it produces **a PDF that lies about itself** (which is why a warning is always returned). ' +
      "Always confirm with pdf-verify-mcp's validate_conformance (flavour: the same value) — the verdict is " +
      'veraPDF\'s, and since ISO 19005 clauses cannot be quoted, the strongest statement is "veraPDF judged it so". ' +
      'In the e-bookkeeping-law context, apply it **after** attaching machine-readable data with attach_file. ' +
      'For signed PDFs, preserveSignatures: true (approval signatures only; certification signatures are refused). ' +
      'However, **the -4 flavours combined with preserveSignatures are refused unless the input is already PDF 2.0** ' +
      '(an incremental update cannot rewrite the file header, and rewriting it would break the signatures).',
    shape: ensurePdfaShape,
    annotations: base,
  },
  {
    name: 'attach_file',
    title: 'Attach File (Embedded File)',
    description:
      'Embed (attach) a file into a PDF. Registers it under /Names /EmbeddedFiles and the catalog /AF, ' +
      'with an AFRelationship. For PDF/A-3 (ISO 19005-3) and Japanese e-bookkeeping-law (電子帳簿保存法) workflows ' +
      'that bundle "a human-readable invoice PDF + machine-readable data (CSV/XML)" into one file.',
    shape: attachFileShape,
    annotations: base,
  },
  {
    name: 'rotate_pages',
    title: 'Rotate Pages',
    description: 'Rotate pages clockwise (90/180/270 degrees). All pages when pages is omitted.',
    shape: rotatePagesShape,
    annotations: base,
  },
];
