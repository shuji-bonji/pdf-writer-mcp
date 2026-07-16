# pdf-writer-mcp

[![CI](https://github.com/shuji-bonji/pdf-writer-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/shuji-bonji/pdf-writer-mcp/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@shuji-bonji/pdf-writer-mcp.svg)](https://www.npmjs.com/package/@shuji-bonji/pdf-writer-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

[日本語](./README.ja.md)

MCP server that **creates** PDFs from text, Markdown, or tabular data and **edits** existing ones (metadata and page operations). Built on [pdf-lib](https://pdf-lib.js.org/), with CJK font embedding via harfbuzz subsetting.

Part of the PDF family alongside [pdf-reader-mcp](https://github.com/shuji-bonji/pdf-reader-mcp) (structure analysis) and [pdf-verify-mcp](https://github.com/shuji-bonji/pdf-verify-mcp) (authenticity verification). Where `pdf-reader-mcp` tells you *what is in* a PDF and `pdf-verify-mcp` tells you *whether it is genuine*, `pdf-writer-mcp` is the one that *writes it*.

## Tools

> **All file paths must be absolute** (since v0.7.0). Relative paths and paths containing `..` are rejected — a relative path would resolve against the MCP host's working directory, which is not the directory you think it is. This applies to `inputPath`, `inputPaths`, `outputPath`, `outputDir`, `fontPath` and `attachmentPath`. Input PDFs larger than 100 MB are also rejected.

### Creation

| Tool | Purpose |
|------|---------|
| `create_text_pdf` | Plain text — honours `\n`, blank lines separate paragraphs, long lines wrap |
| `create_markdown_pdf` | Markdown — headings, paragraphs, bullet/ordered lists, code blocks, quotes, rules, tables |
| `create_table_pdf` | Ruled tables — automatic column widths, cell wrapping, headers repeated across page breaks |

Shared options: `outputPath`, `returnBase64`, `fontPath`, `fontSize`, `pageSize` (A4/A3/A5/LETTER/LEGAL), `margin`, `title`, `author`, `onMissingGlyph`, `tagged`, `lang`.

### Tagged PDF / PDF/UA (v0.5.0)

Pass `tagged: true` to produce an accessible, tagged PDF conforming to **PDF/UA-1 (ISO 14289)**. Output is verified compliant by veraPDF (`--flavour ua1`, 106/106 rules).

```jsonc
{ "markdown": "# Title\n\nBody.", "title": "Report", "tagged": true, "lang": "en" }
```

Markdown maps onto the structure tree: headings → `H1`–`H6`, lists → `L`/`LI`/`LBody`, tables → `Table`/`TR`/`TH`/`TD` (headers get `/Scope`), quotes → `BlockQuote`, code → `Code`. Rules, borders and code backgrounds become artifacts. Heading levels are normalised so they start at H1 and never skip — a Markdown `# → ###` jump becomes `H1 → H2` in the structure, while visual sizes stay as authored.

PDF/UA mandates a document title, so `tagged: true` requires `title`. `lang` (BCP 47) is inferred from the text when omitted and reported via `warnings` — pass it explicitly when you know it, since a wrong `/Lang` makes screen readers mispronounce the text.

> Tagging is opt-in: default output is unchanged. Machine validation cannot judge whether reading order or alt text are *appropriate*, only that they exist — human review still matters.

### Editing

| Tool | Purpose |
|------|---------|
| `set_metadata` | Update Info dictionary fields (`title` / `author` / `subject` / `keywords` / `creator`), preserving the rest |
| `merge_pdfs` | Concatenate 2–50 PDFs in order; metadata inherited from the first file |
| `split_pdf` | One output file per page range |
| `extract_pages` | Extract pages in the requested order (doubles as reordering) |
| `delete_pages` | Remove pages (deleting every page is rejected) |
| `reorder_pages` | Reorder by an explicit permutation of all pages |
| `rotate_pages` | Rotate clockwise (90/180/270), accumulating over existing rotation |
| `add_bookmarks` | Set the outline (bookmarks); nestable via `children`, replaces any existing outline |
| `add_annotation` | Add a sticky note (`text`), `highlight`, or `square` annotation to a page. On tagged PDFs the annotation is nested in an `Annot` element and stays PDF/UA conformant — pass `alt` to describe it |
| `attach_file` | Embed a file (`/Names /EmbeddedFiles` + catalog `/AF` + `/AFRelationship`) — the PDF/A-3 shape for bundling machine-readable data with a document |
| `stamp_page_numbers` | Stamp page numbers (`{n}` / `{total}`, six positions, `pages`, `startAt`). Becomes an artifact on tagged PDFs, so conformance holds |
| `fill_form` | Fill AcroForm fields. Japanese values via an embedded font; can flatten in the same pass |
| `flatten_form` | Flatten a form into static content. Refuses tagged PDFs by default (breaks PDF/UA) |
| `tag_form_fields` | Repair the form inside a tagged PDF for PDF/UA-1: nest widgets in `Form` structure elements (7.18.4-1), set `/Tabs S` (7.18.3-1), add `/TU` alternate names (7.18.1-3). Pass `labels` with human-readable names; idempotent, so safe to re-run |
| `add_watermark` | Overlay a diagonal watermark ("社外秘" / "DRAFT"). Behind the body content by default; artifact on tagged PDFs |

Shared options: `outputPath`, `returnBase64`, `allowBreakingSignatures`.

Page specs use `"1,3-5,8-"` (1-based; `-3` means up to page 3, `8-` means page 8 to the end). Order is preserved and duplicates are removed.

> **Signatures**: pdf-lib rewrites the whole file on save, so editing always invalidates existing signatures. PDFs containing `/ByteRange` are rejected by default; pass `allowBreakingSignatures: true` to proceed anyway. Signature-preserving incremental updates are on the roadmap.

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

> Some poppler-based viewers print `Mismatch between font type and embedded font file` for OTF/CFF fonts embedded as CIDFontType0. This is harmless — rendering and extraction are both correct.

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
- **Subset name prefix**: the conventional `ABCDEF+` prefix is not applied, so some tools report the font as non-subset. No effect on rendering or extraction; relevant only for strict PDF/A work.

## Roadmap

- [x] Editing Tier A wave 1 — metadata and page operations (v0.2.0)
- [x] Editing Tier A wave 2 — bookmarks and annotations (v0.4.0)
- [x] Tagged PDF / PDF/UA-1 — verified by veraPDF (v0.5.0)
- [x] Annotations nested in `Annot` tags on tagged output (v0.5.1)
- [x] Editing Tier B — file attachments, form filling/flattening, watermarks, page-number stamping (v0.6.0)
- [x] Code hygiene / family alignment — McpServer + Zod, structured errors, absolute-path enforcement, stdout guard, tool annotations, deterministic output (v0.7.0)
- [x] `tag_form_fields` — PDF/UA repair for forms in tagged PDFs, verified COMPLIANT by veraPDF (v0.8.0)
- [ ] Publish-pipeline skill (write → read back with pdf-reader → gate with pdf-verify)
- [ ] Images with alt text (`Figure` + `/Alt`)
- [ ] Automatic face extraction from `.ttc`
- [ ] Separate faces for headings and body (bold face embedding)
- [ ] Image embedding, headers/footers
- [ ] Tier C — signature-preserving incremental updates, body text editing, tag tree maintenance
- [ ] PDF/A conversion

## License

MIT © shuji-bonji
