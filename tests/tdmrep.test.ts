/**
 * #4: W3C TDM Reservation Protocol (TDMRep) in XMP, and the PDF/A extension schema.
 *
 * Measured with veraPDF 1.28.2 (2026-10-12): a PDF/A-3B packet carrying tdm:reservation
 * without an extension schema fails ISO 19005-3 6.6.2.3.1 test1 and test2 on both tdm
 * properties; the same packet with the pdfaExtension:schemas description below raises no
 * XMP failure. CI has no veraPDF, so this file pins the packet shape, and the acceptance run
 * is recorded in the CHANGELOG.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildXmpPacket } from '../src/services/xmp-build.js';
import { handleEnsurePdfa, handleSetMetadata } from '../src/tools/handlers.js';
import { SetMetadataSchema } from '../src/utils/validation.js';

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pwm-tdm-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function xmpOf(path: string): Promise<string> {
  const doc = await PDFDocument.load(await readFile(path), { updateMetadata: false });
  const metadata = doc.catalog.lookup(PDFName.of('Metadata'));
  return metadata instanceof PDFRawStream ? new TextDecoder().decode(metadata.contents) : '';
}

async function plainPdf(name: string): Promise<string> {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  doc.setTitle('TDM test');
  const path = join(dir, name);
  await writeFile(path, await doc.save({ updateMetadata: false }));
  return path;
}

const TDM_NS = 'xmlns:tdm="http://www.w3.org/ns/tdmrep/"';
const EXT = '<pdfaSchema:namespaceURI>http://www.w3.org/ns/tdmrep/</pdfaSchema:namespaceURI>';

describe('buildXmpPacket — TDMRep (#4)', () => {
  it('writes tdm:reservation and tdm:policy under the §6.6 namespace, only when asked', () => {
    expect(buildXmpPacket({ title: 'x' })).not.toContain('tdm:');
    const p = buildXmpPacket({ tdmReservation: 1, tdmPolicy: 'https://example.org/p' });
    expect(p).toContain(TDM_NS);
    expect(p).toContain('<tdm:reservation>1</tdm:reservation>');
    expect(p).toContain('<tdm:policy>https://example.org/p</tdm:policy>');
    expect(p).not.toContain('tdmrep#');
  });

  it('describes the schema in pdfaExtension:schemas only when PDF/A is declared', () => {
    const noPdfa = buildXmpPacket({ tdmReservation: 0 });
    expect(noPdfa).toContain('<tdm:reservation>0</tdm:reservation>');
    expect(noPdfa).not.toContain(EXT);

    const pdfa = buildXmpPacket({ tdmReservation: 1, pdfaPart: 3, pdfaConformance: 'B' });
    expect(pdfa).toContain(EXT);
    expect(pdfa).toContain('<pdfaProperty:name>reservation</pdfaProperty:name>');
    expect(pdfa).toContain('<pdfaProperty:valueType>Integer</pdfaProperty:valueType>');
    expect(pdfa).toContain('<pdfaProperty:name>policy</pdfaProperty:name>');
    expect(pdfa).toContain('<pdfaProperty:valueType>URL</pdfaProperty:valueType>');
    // the two schemas (pdfuaid, tdm) each get their own description; both survive together
    const both = buildXmpPacket({
      tdmReservation: 1,
      pdfaPart: 3,
      pdfaConformance: 'B',
      pdfuaPart: 1,
    });
    expect(both).toContain('http://www.aiim.org/pdfua/ns/id/</pdfaSchema:namespaceURI>');
    expect(both).toContain(EXT);
  });

  it('a policy without a reservation is not written (the Report has no such form)', () => {
    expect(buildXmpPacket({ tdmPolicy: 'https://example.org/p' })).not.toContain('tdm:');
  });
});

describe('set_metadata — TDMRep (#4)', () => {
  it('schema: tdmReservation alone satisfies "at least one"; tdmPolicy needs tdmReservation', () => {
    expect(SetMetadataSchema.safeParse({ inputPath: '/a.pdf', tdmReservation: 1 }).success).toBe(
      true,
    );
    const policyOnly = SetMetadataSchema.safeParse({
      inputPath: '/a.pdf',
      tdmPolicy: 'https://x.example/p',
    });
    expect(policyOnly.success).toBe(false);
    expect(SetMetadataSchema.safeParse({ inputPath: '/a.pdf', tdmReservation: 2 }).success).toBe(
      false,
    );
    expect(
      SetMetadataSchema.safeParse({
        inputPath: '/a.pdf',
        tdmReservation: 1,
        tdmPolicy: 'not a url',
      }).success,
    ).toBe(false);
  });

  it('a document without XMP gets one carrying the statement, and says so', async () => {
    const input = await plainPdf('no-xmp.pdf');
    const output = join(dir, 'no-xmp.out.pdf');
    const result = await handleSetMetadata({
      inputPath: input,
      tdmReservation: 1,
      tdmPolicy: 'https://example.org/tdm',
      outputPath: output,
    });
    expect(
      result.warnings?.some((w) => w.includes('no XMP metadata') && w.includes('TDMRep')),
    ).toBe(true);
    const xmp = await xmpOf(output);
    expect(xmp).toContain('<tdm:reservation>1</tdm:reservation>');
    expect(xmp).toContain('<tdm:policy>https://example.org/tdm</tdm:policy>');
    // Info values are carried into the new packet, not just the args
    expect(xmp).toContain('TDM test');
    // not PDF/A → no extension schema
    expect(xmp).not.toContain(EXT);
  });

  it('on a PDF/A document the statement comes with the extension schema', async () => {
    const input = await plainPdf('pdfa.pdf');
    const declared = join(dir, 'pdfa.declared.pdf');
    await handleEnsurePdfa({ inputPath: input, outputPath: declared });
    expect(await xmpOf(declared)).toContain('<pdfaid:part>3</pdfaid:part>');

    const output = join(dir, 'pdfa.tdm.pdf');
    await handleSetMetadata({ inputPath: declared, tdmReservation: 1, outputPath: output });
    const xmp = await xmpOf(output);
    expect(xmp).toContain('<pdfaid:part>3</pdfaid:part>');
    expect(xmp).toContain('<tdm:reservation>1</tdm:reservation>');
    expect(xmp).toContain(EXT);
  });

  it('a later set_metadata (title only) keeps the statement; ensure_pdfa afterwards adds the schema', async () => {
    const input = await plainPdf('keep.pdf');
    const withTdm = join(dir, 'keep.tdm.pdf');
    await handleSetMetadata({
      inputPath: input,
      tdmReservation: 0,
      tdmPolicy: 'https://example.org/p',
      outputPath: withTdm,
    });

    const retitled = join(dir, 'keep.retitled.pdf');
    await handleSetMetadata({ inputPath: withTdm, title: 'Retitled', outputPath: retitled });
    const kept = await xmpOf(retitled);
    expect(kept).toContain('Retitled');
    expect(kept).toContain('<tdm:reservation>0</tdm:reservation>');
    expect(kept).toContain('<tdm:policy>https://example.org/p</tdm:policy>');
    expect(kept).not.toContain(EXT);

    const archived = join(dir, 'keep.pdfa.pdf');
    await handleEnsurePdfa({ inputPath: retitled, outputPath: archived });
    const final = await xmpOf(archived);
    expect(final).toContain('<tdm:reservation>0</tdm:reservation>');
    expect(final).toContain(EXT);
  });

  it('a statement written under the EPUB spelling (…tdmrep#) is carried over in the PDF spelling', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    const xmp = `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:tdm="http://www.w3.org/ns/tdmrep#" tdm:reservation="1" tdm:policy="https://example.org/hash"/>
</rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;
    const stream = doc.context.stream(xmp, { Type: 'Metadata', Subtype: 'XML' });
    doc.catalog.set(PDFName.of('Metadata'), doc.context.register(stream));
    const input = join(dir, 'hash.pdf');
    await writeFile(input, await doc.save({ updateMetadata: false }));

    const output = join(dir, 'hash.out.pdf');
    await handleSetMetadata({ inputPath: input, title: 'Hash spelling', outputPath: output });
    const out = await xmpOf(output);
    expect(out).toContain(TDM_NS);
    expect(out).toContain('<tdm:reservation>1</tdm:reservation>');
    expect(out).toContain('<tdm:policy>https://example.org/hash</tdm:policy>');
  });
});
