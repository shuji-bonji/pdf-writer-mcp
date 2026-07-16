# pdf-writer-mcp

[![CI](https://github.com/shuji-bonji/pdf-writer-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/shuji-bonji/pdf-writer-mcp/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@shuji-bonji/pdf-writer-mcp.svg)](https://www.npmjs.com/package/@shuji-bonji/pdf-writer-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

[日本語](./README.ja.md)

MCP server that **creates** PDFs from text, Markdown, or tabular data and **edits** existing ones (metadata and page operations). Built on [pdf-lib](https://pdf-lib.js.org/), with CJK font embedding via harfbuzz subsetting.

Part of the PDF family alongside [pdf-reader-mcp](https://github.com/shuji-bonji/pdf-reader-mcp) (structure analysis) and [pdf-verify-mcp](https://github.com/shuji-bonji/pdf-verify-mcp) (authenticity verification). Where `pdf-reader-mcp` tells you *what is in* a PDF and `pdf-verify-mcp` tells you *whether it is genuine*, `pdf-writer-mcp` is the one that *writes it*.

## Tools

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
| `add_annotation` | Add a sticky note (`text`), `highlight`, or `square` annotation to a page |

Shared options: `outputPath`, `returnBase64`, `allowBreakingSignatures`.

Page specs use `"1,3-5,8-"` (1-based; `-3` means up to page 3, `8-` means page 8 to the end). Order is preserved and duplicates are removed.

> **Signatures**: pdf-lib rewrites the whole file on save, so editing always invalidates existing signatures. PDFs containing `/ByteRange` are rejected by default; pass `allowBreakingSignatures: true` to proceed anyway. Signature-preserving incremental updates are on the roadmap.

## Install

```json
{
  "mcpServers": {
    "pdf-writer": {
      "command": "npx",
      "args": ["-y", "@shuji-bonji/pdf-writer-mcp"],
      "env": {
        "PDF_WRITER_FONT": "/absolute/path/to/NotoSansJP-Regular.otf"
      }
    }
  }
}
```

`PDF_WRITER_FONT` lets every tool omit `fontPath` and still render CJK text.

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
- [ ] Editing Tier B — form filling/flattening, watermarks, attachments, page-number stamping
- [ ] Images with alt text (`Figure` + `/Alt`), annotations nested in `Annot` tags for tagged output
- [ ] Automatic face extraction from `.ttc`
- [ ] Separate faces for headings and body (bold face embedding)
- [ ] Image embedding, headers/footers
- [ ] Tier C — signature-preserving incremental updates, body text editing, tag tree maintenance
- [ ] PDF/A conversion

## License

MIT © shuji-bonji
