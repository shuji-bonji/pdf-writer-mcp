/**
 * 結果の `output` —— 書いたファイルの版と、そのファイルが名乗っている規格
 * （SPEC-WRITER-OUTPUT-VERSION-005。#28）。
 *
 * **書いた後のバイト列から読む。** 引数（`pdfVersion` や `flavour`）から推測すると、
 * 書く途中で版や宣言が変わった経路（`ensure_pdfa(pdfa-4)` がヘッダーを 2.0 にする、
 * `merge_pdfs` が XMP を運ばない、など）で、結果がファイルと食い違う。
 *
 * 版は §7.5.2 のとおりヘッダーと catalog の `/Version` のうち新しいほう
 * （normativepdf の `PdfDocument.version`）。宣言は XMP の `pdfuaid:part` と
 * `pdfaid:part` + `pdfaid:conformance`（自称であって適合ではない）。
 */

import { PdfDocumentEditor } from 'normativepdf';
import type { OutputDescription } from '../types/index.js';
import { readXmpDeclarations } from './pdfa-cos.js';

export async function describeOutput(bytes: Uint8Array): Promise<OutputDescription> {
  const editor = await PdfDocumentEditor.open(bytes);
  const declared = await readXmpDeclarations(editor);
  const declares: OutputDescription['declares'] = {};
  if (declared.pdfuaPart !== null) declares.pdfua = declared.pdfuaPart;
  if (declared.pdfa !== null) {
    declares.pdfa = `${declared.pdfa.part}${(declared.pdfa.conformance ?? '').toLowerCase()}`;
  }
  return { pdfVersion: editor.base.version, declares };
}
