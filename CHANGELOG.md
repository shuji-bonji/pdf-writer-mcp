# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

- **`stamp_page_numbers`** — stamp page numbers onto an existing PDF (Tier B).
  - `format` expands `{n}` and `{total}` (`{n} / {total}`, `- {n} -`, `{n} ページ`).
  - `position` (six corners), `margin`, `fontSize`, `color`, `pages`, `startAt` —
    `pages: "2-"` with `startAt: 1` numbers everything but the cover from 1.
  - **Stamps become artifacts on tagged PDFs** (PDF/UA-1 7.1-3). Page numbers
    carry no meaning for a screen reader, and content that is neither tagged nor
    marked as an artifact breaks conformance. Verified: veraPDF `ua1` 106/106.
  - Rotated pages (`/Rotate`) are compensated for, so "bottom-right" lands where
    the reader sees the bottom right.
  - The first editing tool that needs a font: it goes through the same
    font-manager as the create tools, so harfbuzz subsetting (ADR-7/8) and the
    missing-glyph check apply. Japanese formats need `fontPath` or
    `PDF_WRITER_FONT`.

### Fixed

- `parsePageSpec` reported an open-ended chunk past the end (`"2-"` on a 1-page
  document) as *reversed* rather than *out of range* — the open end collapses to
  `pageCount`, which made `from > to` trigger first.

## [0.6.0] - 2026-07-16

### Added

- **`attach_file`** — embed a file in a PDF (Tier B, first tool). Registers it in
  `/Names /EmbeddedFiles`, references it from the catalog `/AF`, and sets
  `/AFRelationship`. This is the shape PDF/A-3 (ISO 19005-3) requires, and the
  one used to bundle a human-readable invoice with its machine-readable
  counterpart (CSV/XML) in a single file — the 電子帳簿保存法 use case.

  - `relationship`: `Data` (machine-readable counterpart), `Source` (the data the
    document came from), `Alternative`, `Supplement`, `Unspecified` (default).
    Omitting it produces a warning — PDF/A-3 §6.8 wants a meaningful value, and
    `Unspecified` says nothing about why the file is there.
  - `mimeType` is inferred from the extension when omitted (`.csv` → `text/csv`),
    falling back to `application/octet-stream`.
  - `name` renames the attachment inside the PDF; duplicates are rejected because
    name-tree keys must be unique.
  - Attaching to a tagged PDF leaves it conformant (verified: veraPDF `ua1`,
    106/106).

  Descriptions and names round-trip in Japanese, and attached bytes come back
  byte-identical.

## [0.5.1] - 2026-07-16

### Added

- **`add_annotation` keeps tagged PDFs conformant.** When the target document is
  tagged, the annotation is now nested in an `Annot` structure element and the
  page gets `/Tabs /S` — PDF/UA-1 7.18.1-1 and 7.18.3-1. Verified: adding an
  annotation to a tagged document still passes veraPDF `--flavour ua1` (106/106).

  This closes the gap 0.4.0 left behind: `add_annotation` shipped before tagging
  existed, and veraPDF flagged it once 0.5.0 made tagged output possible.

- **`alt` option on `add_annotation`** — the alternate text for the `Annot`
  element. Omitting it on a tagged document produces a `warnings` entry rather
  than silently emitting an annotation assistive technology cannot describe.

### Notes

`services/struct-append.ts` is a new counterpart to `struct-tree.ts`: the latter
*builds* a tree from scratch (create tools), the former *appends* to an existing
one (edit tools). Appending means reading `/ParentTreeNextKey`, inserting into
the number tree while keeping keys ascending, and writing `/StructParent` back
onto the annotation — the mechanics a future `ensure_tagged` (Tier C) will need.

Untagged documents are left untouched: no structure tree is invented just because
an annotation was added.

## [0.5.0] - 2026-07-16

### Added

- **Tagged PDF / PDF/UA-1 (ISO 14289)** via `tagged: true` on the create tools.
  Output is **verified compliant by veraPDF** (`--flavour ua1`, 106/106 rules) for
  text, Markdown, and table documents.

  Opt-in by design: existing behaviour is unchanged unless you ask for tagging.
  PDF/UA mandates a document title, so `tagged: true` requires `title`.

  - Structure tree (`StructTreeRoot`, `StructElem`, `ParentTree`) built from
    pdf-lib's low-level object model — it has no logical-structure API.
  - Every drawn line is wrapped in `/Tag <</MCID n>> BDC … EMC`, and decorations
    (rules, cell borders, code backgrounds) become `/Artifact BMC … EMC` (7.1-3).
  - Markdown maps to structure: headings → `H1`–`H6`, lists → `L`/`LI`/`LBody`,
    tables → `Table`/`TR`/`TH`/`TD`, quotes → `BlockQuote`, code → `Code`.
  - Heading levels are normalised so they start at H1 and never skip (7.4.2).
    A Markdown `# → ###` jump becomes `H1 → H2`; visual sizes are untouched.
  - Table headers carry `/A << /O /Table /Scope /Column >>` (7.5-1).
  - XMP is generated in-house (pdf-lib has no XMP API) with the `pdfuaid`
    declaration **and** the PDF/A extension schema description — veraPDF rejects
    the declaration without it (5-1).
  - `/Lang`, `/ViewerPreferences /DisplayDocTitle`, `/MarkInfo /Marked`.

- **`lang` option** (BCP 47). When omitted under `tagged: true` the language is
  inferred from the text and reported via `warnings`. Inference is conservative:
  kana → `ja`, Hangul → `ko`, Han without kana → `ja` *with a warning that it
  could be Chinese*. A wrong `/Lang` makes screen readers mispronounce text, so
  the guess is always surfaced rather than silently applied.

### Fixed

- **Bullets in unordered lists rendered as `.notdef`** (blank boxes) — a
  regression from 0.3.0. Font subsetting is driven by the *input* text, but the
  Markdown renderer adds characters of its own: `- item` contains no bullet, yet
  `•` is drawn. Those glyphs were missing from the subset. Renderer-generated
  characters are now always subset in (`RENDERER_GENERATED_CHARS`).

  Text extraction was unaffected, which is why no existing test caught it;
  veraPDF's 7.21.8-1 (no `.notdef` references) is what surfaced it.

- XMP metadata is written as UTF-8 bytes. `context.stream(string)` writes one
  byte per character, which mangled Japanese titles.

## [Unreleased]

### Changed

- **biome adopted** for linting and formatting, matching the rest of the family
  (same `biome.json`, same scripts). `npm run check` now runs in CI and in the
  publish workflow. Existing sources were reformatted; the suite is clean.
- The version is pinned to an exact `2.5.4` rather than a caret range. Biome's
  formatting output changes between minor releases, so a range lets a local
  `npm install` drift ahead of CI and produce spurious diffs.

### Fixed

- `handleCreateTablePdf` duplicated the Latin-1 check as a regex containing
  control characters; it now reuses the existing `hasNonLatin1` helper.
- `src/config.ts` imports `node:module` rather than the bare `module` specifier.

## [0.4.0] - 2026-07-16

### Added

- **Editing tools (Tier A, wave 2)**:
  - `add_bookmarks` — set the document outline. Nestable via `children` (up to 8
    levels, 2000 entries). Replaces any existing outline. Titles are written as
    UTF-16BE so CJK round-trips correctly. Open items carry a positive `/Count`,
    collapsed items a negative one, per ISO 32000-1 §12.3.3.
  - `add_annotation` — add a `text` (sticky note), `highlight`, or `square`
    annotation. Coordinates use PDF space (origin bottom-left, points). Colors
    are `#rrggbb`; `contents` and `author` accept CJK.

  pdf-lib exposes no outline or annotation API, so both are built from the
  low-level object model (`services/outline.ts`, `services/annotation.ts`).

## [0.3.1] - 2026-07-16

### Fixed

- **Text extraction broken for digits in Latin context** (regression introduced in
  0.3.0): `subsetFont` is now called with `noLayoutClosure: true`.

  pdf-lib's `CustomFontEmbedder` (used with `subset: false`) derives glyphs
  through two independent paths: the CIDs written into the content stream come
  from `font.layout(text)` — **after** GSUB substitution — while the ToUnicode
  CMap is built from `font.characterSet` → `glyphForCodePoint` — **before**
  substitution. Noto Sans JP substitutes ASCII digits with alternate forms in
  Latin context (`layout('English 0')` yields glyph 17460, not 17), so the two
  disagreed and extraction returned wrong characters (`v0.3.0` → `vô.õ.ô`, and
  poppler dropped the digits entirely). Rendering was correct throughout, which
  made this easy to miss.

  Excluding layout-reachable glyphs from the subset prevents the substitution
  altogether, so `layout()` and `glyphsForString()` agree again. Subsets also got
  smaller as a side effect (9.1 KB → 4.5 KB for a typical page).

### Added

- `render.test.ts` now asserts that the CIDs written to the page match the
  ToUnicode CMap, so this class of regression fails the suite.

## [0.3.0] - 2026-07-16

### Fixed

- **Japanese text rendered as blank boxes in every viewer** (Chrome, Firefox,
  Acrobat, poppler, Claude Desktop). Font subsetting no longer goes through
  pdf-lib's `embedFont(subset: true)`: fonts are now pre-subset with harfbuzz
  ([subset-font](https://github.com/papandreou/subset-font)) and embedded with
  `subset: false`.

  fontkit's subsetter drops glyph outlines for CJK fonts. Because the ToUnicode
  CMap stayed correct, text extraction kept working and the existing tests
  passed while the visible output was broken.

  | Approach | PDF size | Rendering |
  |---|---|---|
  | fontkit `subset: true` (previous) | 24 KB | broken |
  | pdf-lib `subset: false` alone | 3.9 MB | correct |
  | harfbuzz + `subset: false` (current) | 14.5 KB | correct |

- The note in the design doc claiming poppler's `Embedded font file may be
  invalid` warning was harmless is retracted — poppler followed it with
  `Couldn't create a font`, i.e. the warning was the breakage.

### Added

- `render.test.ts`: extracts the embedded font program from generated PDFs and
  verifies that every rendered character retains a real glyph outline. Verified
  to fail against the pre-0.3.0 implementation.
- CI fetches Noto Sans JP and sets `TEST_FONT_PATH`, so the font-dependent tests
  no longer skip.

### Changed

- `loadFont` split into `openFont` (read + glyph coverage) and `embedFontFor`
  (subset + embed). Subsetting depends on the text being drawn, so embedding is
  deferred until the input is final.
- **Dependency added**: `subset-font` (harfbuzz/wasm, no native binaries).

## [0.2.1] - 2026-07-16

### Added

- **`onMissingGlyph` option** for the create tools. Characters absent from the
  font (e.g. ✔ U+2714, which Noto Sans JP does not include) were previously
  embedded as `.notdef` and rendered as silent blanks.
  - `error` (default) — list the offending characters and fail
  - `replace` — substitute 〓 and report via `warnings`
  - `ignore` — render as before and report via `warnings`
- `CreateResult.warnings` reports substituted or ignored characters.

## [0.2.0] - 2026-07-16

### Added

- **Editing tools (Tier A, wave 1)** — the server now edits existing PDFs in
  addition to creating them:
  - `set_metadata` — update Info dictionary fields, preserving the rest
  - `merge_pdfs` — concatenate in order (metadata inherited from the first file)
  - `split_pdf` — one file per page range
  - `extract_pages` — extract in the requested order (doubles as reordering)
  - `delete_pages` — remove pages (deleting all is rejected)
  - `reorder_pages` — reorder by an explicit permutation
  - `rotate_pages` — rotate clockwise, accumulating over existing rotation
- **Signature guard**: editing a PDF with `/ByteRange` fails by default, since
  pdf-lib rewrites the whole file and would invalidate existing signatures.
  Pass `allowBreakingSignatures: true` to proceed anyway.
- Page specs (`"1,3-5,8-"`, 1-based, order-preserving, duplicates removed).
- CI (`ci.yml`) and npm publish via Trusted Publisher / OIDC (`publish.yml`).

## [0.1.0] - 2026-07-15

Initial release.

### Added

- `create_text_pdf` — plain text with paragraph breaks, wrapping, pagination
- `create_markdown_pdf` — headings, lists, code blocks, quotes, rules, tables
- `create_table_pdf` — ruled tables with automatic column widths and repeated
  headers across page breaks
- Japanese font embedding, ToUnicode CMap (extractable/searchable text),
  file or base64 output, `asserts`-based input validation.
