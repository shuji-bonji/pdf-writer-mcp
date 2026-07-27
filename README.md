# pdf-writer-mcp

[![CI](https://github.com/shuji-bonji/pdf-writer-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/shuji-bonji/pdf-writer-mcp/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@shuji-bonji/pdf-writer-mcp.svg)](https://www.npmjs.com/package/@shuji-bonji/pdf-writer-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

[日本語](./README.ja.md)

MCP server that **creates** PDFs from text, Markdown, or tabular data and **edits** existing ones (metadata and page operations). Built on [pdf-lib](https://pdf-lib.js.org/), with CJK font embedding via harfbuzz subsetting.

Part of the PDF family alongside [pdf-reader-mcp](https://github.com/shuji-bonji/pdf-reader-mcp) (structure analysis) and [pdf-verify-mcp](https://github.com/shuji-bonji/pdf-verify-mcp) (authenticity verification). Where `pdf-reader-mcp` tells you *what is in* a PDF and `pdf-verify-mcp` tells you *whether it is genuine*, `pdf-writer-mcp` is the one that *writes it*.

## Tools

> [!IMPORTANT]
> **All file paths must be absolute** (since v0.7.0). Relative paths and paths containing `..` are rejected — a relative path would resolve against the MCP host's working directory, which is not the directory you think it is. This applies to `inputPath`, `inputPaths`, `outputPath`, `outputDir`, `fontPath` and `attachmentPath`. Input PDFs larger than 100 MB are also rejected.

### Creation

| Tool | Purpose |
|------|---------|
| `create_text_pdf` | Plain text — honours `\n`, blank lines separate paragraphs, long lines wrap |
| `create_markdown_pdf` | Markdown — headings, paragraphs, bullet/ordered lists, code blocks, quotes, rules, tables |
| `create_table_pdf` | Ruled tables — automatic column widths, cell wrapping, headers repeated across page breaks |

Shared options: `outputPath`, `returnBase64`, `fontPath`, `fontSize`, `pageSize` (A4/A3/A5/LETTER/LEGAL), `margin`, `title`, `author`, `onMissingGlyph`, `tagged`, `lang`, `pdfVersion`.

### PDF 2.0 output (v0.16.0)

Pass `pdfVersion: "2.0"` to write an ISO 32000-2 file. The default stays `"1.7"`, and its bytes are unchanged.

The version is not only a header. ISO 32000-2 attaches two obligations to it, and both are met:

- **trailer `/ID`** becomes Required (Table 15). Both elements are equal on a first write (R-14.4-6), and the value stays deterministic under `SOURCE_DATE_EPOCH`.
- **the Info dictionary** keeps only `CreationDate` and `ModDate` (§14.3.3); the title, author and producer move to the XMP metadata stream, where PDF 2.0 says document metadata belongs.

```jsonc
{ "text": "Body.", "title": "Report", "pdfVersion": "2.0" }
```

`tagged: true` cannot be combined with it. The only accessibility declaration this server writes is PDF/UA-1 (ISO 14289-1), which is built on PDF 1.7 — putting it in a 2.0 file would be a claim nothing could measure. PDF/UA-2 output is not implemented, so the combination is refused rather than silently produced.

### Tagged PDF / PDF/UA (v0.5.0)

Pass `tagged: true` to produce an accessible, tagged PDF conforming to **PDF/UA-1 (ISO 14289)**. Output is verified compliant by veraPDF (`--flavour ua1`, 106/106 rules).

```jsonc
{ "markdown": "# Title\n\nBody.", "title": "Report", "tagged": true, "lang": "en" }
```

Markdown maps onto the structure tree: headings → `H1`–`H6`, lists → `L`/`LI`/`LBody`, tables → `Table`/`TR`/`TH`/`TD` (headers get `/Scope`), quotes → `BlockQuote`, code → `Code`. Rules, borders and code backgrounds become artifacts. Heading levels are normalised so they start at H1 and never skip — a Markdown `# → ###` jump becomes `H1 → H2` in the structure, while visual sizes stay as authored.

PDF/UA mandates a document title, so `tagged: true` requires `title`. `lang` (BCP 47) is inferred from the text when omitted and reported via `warnings` — pass it explicitly when you know it, since a wrong `/Lang` makes screen readers mispronounce the text.

> [!NOTE]
> Tagging is opt-in — default output is unchanged.
>
> Machine validation (veraPDF) only sees whether things *exist*. It cannot judge whether reading order or alt text are *appropriate* — human review still matters.

### Editing — page operations

| Tool | Purpose |
|------|---------|
| `merge_pdfs` | Concatenate 2–50 PDFs in order; metadata inherited from the first file |
| `split_pdf` | One output file per page range |
| `extract_pages` | Extract pages in the requested order (doubles as reordering) |
| `delete_pages` | Remove pages (deleting every page is rejected) |
| `reorder_pages` | Reorder by an explicit permutation of all pages |
| `rotate_pages` | Rotate clockwise (90/180/270), accumulating over existing rotation. Edits in place, so the warning below does not apply |

> [!WARNING]
> **The five tools other than `rotate_pages` rebuild the document from its pages.**
>
> - Carried over: attachments (`/Names /EmbeddedFiles`, `/AF`), `/Lang`, `/ViewerPreferences`, `/OutputIntents`
> - Not carried over: the tagged structure tree, XMP, and anything tied to page numbers or page references (bookmarks, page labels, named destinations)
> - Whatever is lost is reported in `warnings` — nothing disappears silently

Page specs use `"1,3-5,8-"` (1-based; `-3` means up to page 3, `8-` means page 8 to the end). Order is preserved and duplicates are removed.

### Editing — adding to and repairing documents

| Tool | Purpose |
|------|---------|
| `set_metadata` | Update Info dictionary fields (`title` / `author` / `subject` / `keywords` / `creator`), preserving the rest. On documents carrying XMP, `dc:title` etc. are kept in sync (PDF/UA and PDF/A declarations preserved) |
| `add_bookmarks` | Set the outline (bookmarks); nestable via `children`, replaces any existing outline |
| `add_annotation` | Add a sticky note (`text`), `highlight`, or `square` annotation. On tagged PDFs the annotation is nested in an `Annot` element and stays PDF/UA conformant — pass `alt` to describe it |
| `attach_file` | Embed a file (`/Names /EmbeddedFiles` + catalog `/AF` + `/AFRelationship`) — the PDF/A-3 shape |
| `stamp_page_numbers` | Stamp page numbers (`{n}` / `{total}`, six positions, `pages`, `startAt`). Becomes an artifact on tagged PDFs, so conformance holds |
| `fill_form` | Fill AcroForm fields. Japanese values via an embedded font; can flatten in the same pass |
| `flatten_form` | Flatten a form into static content. Refuses tagged PDFs by default (breaks PDF/UA) |
| `tag_form_fields` | Repair the form inside a tagged PDF for PDF/UA-1 (nest widgets in `Form`, set `/Tabs S`, add `/TU` alternate names; pass `labels` for human-readable names). Idempotent |
| `ensure_tagged` | Put an existing PDF into the PDF/UA-1 container → [Scaffolding an untagged PDF](#scaffolding-an-untagged-pdf-ensure_tagged) |
| `ensure_pdfa` | Put an existing PDF into the **PDF/A-3b / PDF/A-4 / PDF/A-4f** container (`flavour`) → [The archival container](#the-archival-container-ensure_pdfa) |
| `add_watermark` | Overlay a diagonal watermark ("社外秘" / "DRAFT"). Behind the body content by default; artifact on tagged PDFs |

Shared options: `outputPath`, `returnBase64`, `allowBreakingSignatures`.

> [!IMPORTANT]
> **Editing signed PDFs**: pdf-lib rewrites the whole file on save, so editing normally invalidates existing signatures. PDFs containing `/ByteRange` are rejected by default.
>
> - `preserveSignatures: true` — appends an ISO 32000 incremental update that **keeps every signature valid** (the original bytes are untouched). Supported by every editing tool that adds to a document: `add_annotation`, `set_metadata`, `add_bookmarks`, `tag_form_fields`, `ensure_tagged`, `attach_file`, `stamp_page_numbers`, `add_watermark` (on tagged PDFs the structure-tree changes ride the same increment)
> - `allowBreakingSignatures: true` — proceed destructively, invalidating signatures
> - Certified documents (DocMDP) are refused when the change type is not permitted by the certification level (§12.8.2.2)
>
> Measured: stacked increments on a really-signed PDF keep pdf-verify-mcp reporting **VALID**, and incremental structure updates on tagged PDFs stay veraPDF **COMPLIANT (106/106)**.

### Scaffolding an untagged PDF (`ensure_tagged`)

`ensure_tagged` puts an existing PDF into the PDF/UA-1 container. On tagged input the structure tree is left untouched and only missing document-level requirements are repaired (`MarkInfo`, `/Lang`, `DisplayDocTitle`, XMP). On a document that never had a structure tree, a **minimal scaffold** is created — each page's content wrapped in a single `P` element, which makes the text reachable by assistive technology and passes veraPDF (measured: 106/106).

> [!WARNING]
> **This is a scaffold, not accessibility.** A machine cannot infer meaning, so headings, lists, tables, reading order and figure alt text are *not* produced. The tool says so in its `warnings`. (Wrapping the content in `Artifact` would also pass veraPDF while hiding the body from screen readers — conformance theatre, deliberately not implemented.) Where you control the source, `create_*` with `tagged: true` produces real structure; `ensure_tagged` is for documents you were handed.

### The archival container (`ensure_pdfa`)

`ensure_pdfa` is the archival (PDF/A-3b) counterpart of `ensure_tagged`. It adds only the document-level requirements:

- trailer `/ID` (ISO 32000-1 §14.4)
- an sRGB output intent (`GTS_PDFA1`; ICC profile generated and embedded)
- the XMP `pdfaid` declaration (the creation date is inherited from Info `/CreationDate`)

> [!WARNING]
> Content streams, fonts and the structure tree are untouched — so this **does not make a PDF conform**. Write the declaration, then measure it: verify with pdf-verify-mcp's `validate_conformance(flavour: "pdfa-3b")`. Measured on the electronic-bookkeeping sample: veraPDF **146/146 COMPLIANT**, PDF/UA-1 still **106/106**, attachment preserved.

#### PDF/A-4 (v0.16.0)

`flavour: "pdfa-4"` targets ISO 19005-4 instead. It is built on PDF 2.0, so on top of the three items above it rewrites the header to 2.0 and **removes the Info dictionary** — PDF/A-4 does not allow one unless the catalog has `/PieceInfo`, which is stricter than ISO 32000-2 §14.3.3. `pdfaid:rev` is written and `pdfaid:conformance` is not, because PDF/A-4 has no conformance level.

**If the document carries attachments, use `"pdfa-4f"`.** Plain PDF/A-4 requires every embedded file to be PDF/A itself, so attaching a CSV or JSON — the electronic-bookkeeping case — makes it non-conformant. `"pdfa-4f"` is the variant for exactly that.

Measured with veraPDF 1.30.0: `pdfa-4` **109/109 COMPLIANT**, and the same document with a CSV attached is 108/109 as `pdfa-4` but **109/109 as `pdfa-4f`**.

`preserveSignatures` is refused with a PDF/A-4 flavour unless the input is already PDF 2.0: an incremental update cannot rewrite byte 0 of the file, and doing so anyway would break the signature it was meant to preserve.

## Install

```json
{
  "mcpServers": {
    "pdf-writer": {
      "command": "npx",
      "args": ["-y", "@shuji-bonji/pdf-writer-mcp@latest"],
      "env": {
        "PDF_WRITER_FONT": "/absolute/path/to/NotoSansJP-Regular.otf"
      }
    }
  }
}
```

`PDF_WRITER_FONT` lets every tool omit `fontPath` and still render CJK text.

> [!TIP]
> **Use `@latest` (or pin a version).** `npx -y <pkg>` without a version keeps running whatever it cached the first time — `-y` only skips the install prompt, it does not check for updates. A bare specifier will happily run a months-old release. `@latest` makes npx check the registry on each start; pin `@0.5.0` instead if you want reproducibility. To clear a stale cache: `rm -rf ~/.npm/_npx`.

## Fonts

The standard PDF font (Helvetica) covers **ASCII only**. To render Japanese or any non-Latin text, point `fontPath` or `PDF_WRITER_FONT` at an embeddable **single-face** font (`.ttf` / `.otf`).

- Recommended source: [Noto Sans JP (SubsetOTF/JP)](https://github.com/notofonts/noto-cjk/tree/main/Sans/SubsetOTF/JP) — static, single-face, SIL OFL.
- **`.ttc` (TrueType Collection) is not supported** — the file is detected and rejected. Extract a single face first:

  ```bash
  python3 -c "from fontTools.ttLib import TTCollection; \
    TTCollection('NotoSansCJK-Regular.ttc').fonts[0].save('NotoSansCJKjp-Regular.otf')"
  ```

### Missing glyphs

Characters absent from the font (e.g. ✔ U+2714, which Noto Sans JP does not include) would otherwise be embedded as `.notdef` and render as silent blanks. `onMissingGlyph` controls this:

| Value | Behaviour |
|-------|-----------|
| `error` (default) | Fail, listing the offending characters as `"✔" (U+2714)` |
| `replace` | Substitute 〓 and report via `warnings` |
| `ignore` | Render as blanks and report via `warnings` |

## Result

```jsonc
{
  "path": "/abs/out.pdf",     // when outputPath is given
  "base64": "JVBERi0xLj...",  // when returnBase64, or outputPath is omitted
  "pageCount": 3,
  "bytes": 91788,
  "font": "NotoSansJP-Regular.otf",
  "warnings": ["Replaced 1 unsupported character(s) with \"〓\": \"✔\" (U+2714)"]
}
```

Editing tools return the same shape without `font`; `split_pdf` returns `{ files: [...], count }`.

## Errors (v0.7.0)

Errors are structured, following the same contract as `pdf-reader-mcp`: a stable `code` for programs, plus `next_actions` an LLM agent can act on. Writer-specific guards are all expressed as *retryable with an explicit flag*:

```jsonc
{
  "error": "\"/in/signed.pdf\" appears to be digitally signed (/ByteRange found). …",
  "code": "SIGNED_PDF",
  "retryable": true,
  "next_actions": [
    {
      "action": "retry_with_allowBreakingSignatures",
      "reason": "Only if invalidating the signature is acceptable…",
      "example": { "allowBreakingSignatures": true }
    }
  ]
}
```

Codes: `INVALID_ARGUMENT`, `DOC_NOT_FOUND`, `FONT_NOT_FOUND`, `INVALID_PDF`, `ENCRYPTED_PDF`, `UNSUPPORTED_PDF_FEATURE` (XFA), `FILE_TOO_LARGE`, `INTERNAL_ERROR`, and the writer guards `SIGNED_PDF` (`allowBreakingSignatures`), `TAGGED_PDF` (`allowBreakingTags`), `FONT_REQUIRED` (`fontPath`), `MISSING_GLYPH` (`onMissingGlyph`).

## Deterministic output (v0.7.0)

Set the `SOURCE_DATE_EPOCH` environment variable (UNIX seconds, per the [reproducible-builds.org](https://reproducible-builds.org/docs/source-date-epoch/) convention) to pin `CreationDate`, `ModificationDate` and XMP timestamps. The same input then yields byte-identical output — useful for diffing, caching, and reproducible tests. Invalid values raise an error rather than being ignored.

## Text extraction

Generated PDFs are selectable, copyable, searchable, and screen-reader accessible: pdf-lib emits a ToUnicode CMap even for embedded subset fonts. This is covered by regression tests (`extract.test.ts`, `render.test.ts`).

> [!NOTE]
> Output from v0.13.x and earlier could make poppler-based viewers print `Mismatch between font type and embedded font file`. That was a symptom of a real conformance defect (W-2: CFF fonts embedded via `FontFile2`), **fixed in v0.14.0** — current output produces no such warning.

## Development

```bash
npm install
npm run build      # emits dist/
npm test           # vitest
npm run typecheck  # tsc --noEmit
```

Font-dependent tests activate when `TEST_FONT_PATH` points at a CJK font:

```bash
TEST_FONT_PATH=/path/to/NotoSansJP-Regular.otf npm test
```

## Known limitations

- **Inline styling**: bold/italic affect size and glyph text only, not typeface — a single font is embedded per document.
- **`.ttc` fonts** require extracting a single face (see above).
- **`title` and the first body heading both become H1** (B-19). This satisfies PDF/UA 7.4.2 (start at H1, skip no levels) and passes veraPDF, but headings duplicate if you read the structure tree back and regenerate.
- **List `/Lbl` is not emitted** (B-18). Bullets and numbers are baked into the body text. ISO 32000-2 §14.8.4.8.2 makes `Lbl` a NOTE (`often include`), not a requirement, so this conforms — but regenerating from a read-back duplicates the markers.

> **Resolved**:
> - The subset name prefix (`ABCDEF+`) **is applied as of v0.14.0 (W-3)**. The earlier limitation stating otherwise no longer holds.
> - Underscores in `snake_case` being dropped (B-17) was **fixed on 2026-07-21** (ships in the next release). `_` emphasis now requires a non-intraword position and code spans are protected first, so non-ASCII identifiers such as `日本語_変数名` survive too.

## Roadmap

- [x] Editing Tier A wave 1 — metadata and page operations (v0.2.0)
- [x] Editing Tier A wave 2 — bookmarks and annotations (v0.4.0)
- [x] Tagged PDF / PDF/UA-1 — verified by veraPDF (v0.5.0)
- [x] Annotations nested in `Annot` tags on tagged output (v0.5.1)
- [x] Editing Tier B — file attachments, form filling/flattening, watermarks, page-number stamping (v0.6.0)
- [x] Code hygiene / family alignment — McpServer + Zod, structured errors, absolute-path enforcement, stdout guard, tool annotations, deterministic output (v0.7.0)
- [x] `tag_form_fields` — PDF/UA repair for forms in tagged PDFs, verified COMPLIANT by veraPDF (v0.8.0)
- [x] Tier C first milestone — signature-preserving incremental updates for `add_annotation`, verified by pdf-verify-mcp against a real CMS signature (v0.9.0)
- [x] Incremental updates extended to `set_metadata` / `add_bookmarks`, full trailer carry-over (§7.5.6), XMP kept in sync with Info (v0.10.0)
- [x] Incremental updates on tagged PDFs — generalised dirty tracking over the structure tree; `tag_form_fields` gains `preserveSignatures` (v0.11.0)
- [x] Incremental updates across every editing tool, and `ensure_tagged` — PDF/UA scaffold & repair (v0.12.0)
- [x] Page operations report and carry over document-level information; three shall violations found by re-auditing against ISO 32000-2 (v0.13.0)
- [ ] Carrying the structure tree through page operations (which also unlocks MarkInfo, conformance-declaring XMP, `/AcroForm` and merging attachments across inputs)
- [ ] Tier C remainder — `edit_text` (body text editing/reflow)
- [ ] Publish-pipeline skill (write → read back with pdf-reader → gate with pdf-verify)
- [ ] Images with alt text (`Figure` + `/Alt`)
- [ ] Automatic face extraction from `.ttc`
- [ ] Separate faces for headings and body (bold face embedding)
- [ ] Image embedding, headers/footers
- [ ] Tier C — signature-preserving incremental updates, body text editing, tag tree maintenance
- [ ] PDF/A conversion

## License

MIT © shuji-bonji
