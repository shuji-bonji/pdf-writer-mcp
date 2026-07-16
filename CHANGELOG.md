# Changelog

All notable changes to this project will be documented in this file.

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
