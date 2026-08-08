# Changelog

All notable changes to this project will be documented in this file.

## [0.18.0] - 2026-08-08

### Changed

- **All tool and parameter descriptions are now English (B-22).** pdf-writer was the only server
  in the family whose `tools/list` spoke Japanese; the repository convention (English-first for
  public repos) and the site's generated reference both expect English as the source of truth.
  Japanese now lives where the other three servers keep it: the site's translation memory
  (`pdf-agent-stack/scripts/i18n/pdf-writer.ja.json`), which the reference generator applies to
  the ja pages. The original Japanese descriptions were carried over there verbatim, so no
  wording was lost — only its home changed.

  Behaviour, schemas, error codes and validation are untouched: this release changes only the
  `description` strings in `tools/definitions.ts` and `utils/validation.ts`. Two incidental
  fixes rode along: the `tag_form_fields` description no longer says "wait for a future
  ensure_tagged" (it exists), and CJK-specific notes now say "CJK" where they said 日本語 while
  keeping Japanese examples (社外秘, 氏名) that illustrate real usage.

## [0.17.0] - 2026-07-28

### Added

- **`ensure_pdfa` now says when the claim it just wrote is already known to be false (B-21).**
  The result carries `declarationRisks`, and the first — and so far only — risk it reports is
  `FONT_NOT_EMBEDDED`: PDF/A requires every font to be embedded, `ensure_pdfa` does not embed
  fonts, and a document drawn with the standard 14 faces therefore fails validation no matter
  how correct its document-level structure is.

  The tool already warned that conformance had not been checked. That warning is prose, and it
  covers everything from encryption to LZW — it cannot distinguish "we did not look" from **"we
  looked and it will fail."** The second one is worth naming, because it is observable at the
  moment of writing.

  The declaration is still written. Refusing would break existing callers, and the family's
  position is that the verdict belongs to veraPDF — not to the writer. What changed is that the
  report can now branch on the risk instead of parsing English.

  Found while building `scripts/verify-published.mjs`: the specimen used Helvetica, veraPDF
  returned 108/109, and the failing rule was the font-embedding one. The specimen was at fault,
  not the writer — but the same audit this family ran against another library
  (`pdfnative-audit` F-1: *a PDF/A claim over unembedded fonts*) had listed "enforce embedding,
  or refuse to write the claim" as a lesson to bring home. It had not been brought home.

- **`scripts/verify-published.mjs`** (`npm run verify:published`) — acceptance check for a
  published release: clean install from the registry, the electronic-bookkeeping chain end to
  end, structural measurement, `qpdf --check`, and the PDF/A verdict via pdf-verify-mcp.
  It skips the verdict rather than guessing when veraPDF or an embeddable font is missing.

## [0.16.0] - 2026-07-27

### Added

- **PDF/A-4 and PDF/A-4f: `ensure_pdfa(flavour: "pdfa-4" | "pdfa-4f")` (B-20).** veraPDF judges
  both COMPLIANT at 109/109. The default is still `"pdfa-3b"`, whose output is unchanged.

  PDF/A-4 is not PDF/A-3b with a different number in the XMP. veraPDF's -4 profile asked for
  four things the -3b path never had to supply, and each was found by writing a file and
  reading the complaint rather than by reasoning about the standard — **ISO 19005-4 is outside
  this family's corpus (T2), so the rule ids below are the entirety of the primary evidence**:

  - `6.1.2-1` — the header must be `%PDF-2.n`. Supplied by B-16.
  - `6.1.3-4` / `6.1.3-5` — **the Info dictionary must not be present at all** unless the catalog
    has `/PieceInfo`, and even then it may hold only `ModDate`. This is stricter than ISO 32000-2
    §14.3.3, which B-16 followed: §14.3.3 lets `CreationDate` stay, and PDF/A-4 does not. The
    creation date lives in `xmp:CreateDate`.
  - `6.7.3-5` — `pdfaid:rev` must be `2020`, and PDF/A-4 carries no `pdfaid:conformance`. That
    the value is the year of publication was a guess; it was confirmed by building a specimen
    with the `rev` line blanked out to the same byte length and watching veraPDF fail exactly
    that one rule.
  - `6.9-3` — under plain PDF/A-4, **every embedded file must itself be PDF/A**. Attaching a
    CSV or JSON — the whole point of the electronic-bookkeeping use case — makes the document
    non-conformant. That is what `"pdfa-4f"` is for; it sets `pdfaid:conformance` to `F`
    (`6.7.3-3`) and the embedded-file rule no longer applies. Measured: the same document is
    108/109 as `pdfa-4` and 109/109 as `pdfa-4f`, with `/AF` and the embedded file intact in a
    qpdf read-back.

  `preserveSignatures` with a PDF/A-4 flavour is **refused** unless the input is already PDF 2.0.
  An incremental update appends; it cannot rewrite byte 0 of the file, and rewriting it anyway
  would move the signed range out from under the signature. Failing loudly beats producing a
  file whose header and signature disagree.

  Regressions measured on the same veraPDF 1.30.0: PDF/A-3b **146/146**, PDF/UA-1 **106/106**.
  The electronic-bookkeeping chain was then run end to end through the MCP itself — create a 2.0
  document, attach a CSV, declare `pdfa-4f`, validate — and came back 109/109.


- **PDF 2.0 output on the create tools: `pdfVersion: "2.0"` (B-16).** The three create tools
  could only write PDF 1.7, which put PDF/A-4 out of reach — it is built on ISO 32000-2, so
  there was no file to validate in the first place.

  **Writing `%PDF-2.0` is the small part.** ISO 32000-2 attaches two obligations to the version
  itself, and a header without them is a file that misstates what it is:

  - **trailer `/ID` becomes Required** (Table 15 — in 1.7 it is required only alongside
    `/Encrypt`). The identifier is the one `ensure_pdfa` already computes, so it stays
    deterministic under `SOURCE_DATE_EPOCH`, and both elements are equal on a first write
    (R-14.4-6).
  - **the Info dictionary is deprecated except for `CreationDate` and `ModDate`** (§14.3.3);
    everything else should live in a metadata stream. So the 2.0 path writes XMP first — with
    `dc:title`, `dc:creator` and `pdf:Producer` — and only then strips Info back to the two
    dates. Order matters: strip first and the title would have nowhere left to be. The dates
    stay in both places and equal, which is what §14.3.4 requires of them.

  Stripping means *deleting*: pdf-lib puts `/Producer` and `/Creator` into Info at
  `PDFDocument.create()` time, so not writing them is not enough.

  **`tagged: true` is refused in combination with `pdfVersion: "2.0"`.** The only accessibility
  declaration this server can write is PDF/UA-1 (ISO 14289-1), which is built on PDF 1.7.
  Putting `pdfuaid:part=1` in a 2.0 container would be this server writing a claim it cannot
  measure — the same mistake `ensure_pdfa` warns about. PDF/UA-2 output is not implemented, so
  the combination errors instead of quietly producing a file that misdescribes itself.

  **The 1.7 default is byte-identical to 0.15.2.** Verified by building the previous commit
  alongside and comparing hashes of the same document, not by reading the diff.

  Two things the plan got wrong, both found by measuring rather than by reasoning:

  - `context.header` is a public field on pdf-lib's `PDFContext`, and the task assumed
    replacing it would change the output. It does not: `PDFWriter#computeBufferSize()` and
    `PDFStreamWriter#computeBufferSize()` each construct `PDFHeader.forVersion(1, 7)` on the
    spot and never read `this.context.header`. The version is therefore written into the saved
    bytes afterwards. `%PDF-1.7` and `%PDF-2.0` are both 8 bytes, so no cross-reference offset
    moves (byte offsets count from the `%`, R-7.5.2-1); the code refuses to rewrite anything
    whose header is not the exact 8 bytes it expects, rather than risk shifting the file.
  - `PDFDocument.load()` **adds `/Producer` and `/Creator` to the Info dictionary by default**
    (`updateMetadata` defaults to `true`). Reading a saved file back with pdf-lib therefore
    reports metadata the file does not contain — which first looked like the stripping had
    failed. Inspection now passes `{ updateMetadata: false }`, and qpdf is used as the
    independent reader for the version itself.

## [0.15.2] - 2026-07-26

### Documentation

- **README (en/ja) restructured for readability.** The editing-tools table was interrupted
  mid-table by a blockquote, so everything after `rotate_pages` rendered as one dense
  paragraph instead of table rows. The table is now split into "page operations" and
  "adding to and repairing documents", the notes moved out of the table and converted to
  GitHub alerts (`[!NOTE]` / `[!WARNING]` / `[!IMPORTANT]` / `[!TIP]`), the longest cells
  trimmed (signature details consolidated into the signatures note; `ensure_pdfa` got its
  own section next to `ensure_tagged`'s). The stale poppler "Mismatch" note now says the
  warning was a W-2 symptom fixed in v0.14.0. GitHub renders the alerts; npm shows them as
  plain blockquotes with a literal `[!NOTE]` marker, which degrades acceptably.

### Fixed

- **W-6: XMP written for an existing document now inherits the creation date from the Info
  dictionary (ISO 32000-2, 14.3.4).** When `ensure_pdfa` or `ensure_tagged` wrote an XMP
  stream for a document that had an Info `/CreationDate`, the new `xmp:CreateDate` was set to
  the current time instead of the document's actual creation date. The same fallback existed
  in `syncXmpWithInfo` when the existing XMP lacked `xmp:CreateDate`. These paths now resolve
  the creation date as: existing XMP `xmp:CreateDate` → Info `/CreationDate` (converted with
  pdf-lib's timezone-aware date parser; equivalence is instant-equality, not string equality)
  → current time. Writing a non-equivalent date into the second location violates the
  condition of R-14.3.4-4 — "may add the information to the other, **as long as both are
  fully equivalent**".

  The backfill deliberately lives at the *callers that read an existing PDF*
  (`declarePdfa` / `ensure_tagged` / `syncXmpWithInfo`), **not** inside `setXmpMetadata`:
  in the creation flow, pdf-lib's `PDFDocument.create()` auto-fills Info `/CreationDate`
  with the real clock, so a general backfill would override the document's single `documentDate`
  (W-5) and break `SOURCE_DATE_EPOCH` determinism (E-6) — the first attempt did exactly that
  and was caught by the E-6 test.

  Found by the constraint-table PoC (pdf-spec-mcp#12): the mapped clause CT-META-4 fired on
  `ensure_pdfa`'s own output. Regression tests (4) read the output back independently (raw XMP
  text vs the Info dictionary) and pin **past** dates, so the pre-fix "now" fallback can
  never satisfy them; the unpatched build was confirmed to fail them, and a veraPDF A/B
  showed no conformance change from the fix.

### Documentation

- **The server now sends `instructions` on `initialize`.** Written for one specific misreading
  that `ensure_pdfa` (v0.15.0) made easy to fall into: that this server can *produce* a PDF/A or
  PDF/UA file.

  It cannot. `ensure_pdfa` and `ensure_tagged` write `pdfaid` / `pdfuaid` into the XMP, which is
  a **declaration** — the document saying of itself that it follows a standard. Applying either
  to a file that does not conform yields a file that lies about itself, which is worse than one
  that claims nothing. Both tools already return a warning saying exactly that; the instructions
  make the rule general: **write a declaration, measure it** with
  `validate_conformance` (`pdfua-1` for `ensure_tagged`, `pdfa-3b` for `ensure_pdfa`) — and if
  you cannot measure it, do not write the declaration.

  The signing / `outputPath` / structured-error rules are restated there too, since they are the
  ones most often discovered the expensive way.

  Behaviour is unchanged; no tool was added, removed or altered.

## [0.15.0] - 2026-07-25

### Added

- **`ensure_pdfa` — PDF/A-3b conformance scaffolding (B-8).** The PDF/A counterpart of
  `ensure_tagged`: it supplies the *document-level* requirements a file needs before it can
  claim PDF/A, and touches neither the content streams nor the structure tree.

  Three things are added, each verified against the UC-4 sample that previously scored
  **143/146** under veraPDF:

  - **`/ID` in the trailer.** Two byte strings, identical on first write
    (ISO 32000-1 **R-14.4-7 / -11**), computed with MD5 over the document date and every entry
    of the Info dictionary. §14.4 lists the file size and pathname as inputs too, but both are
    dropped on purpose: the size is not known before `save()`, and mixing in the pathname would
    change the bytes merely because the same content was written elsewhere. Both are `should`,
    and the NOTE in §14.4 states the calculation "need not be reproducible" — so
    **determinism (E-6) wins**: with `SOURCE_DATE_EPOCH` set, the same input yields the same `/ID`.
  - **An sRGB output intent (`GTS_PDFA1`) with the ICC profile embedded.** Rather than
    setting a `DefaultRGB`, which **R-8.6.5.7** places in *each page's* `/Resources`
    (and would therefore be missed by `add_watermark` / `merge_pdfs` and friends), the intent
    goes in the catalog — one place, harder to break. Table 365 makes `DestOutputProfile`
    optional when the condition identifier names a registered condition, but it is embedded
    anyway: veraPDF asks for an intent that *contains* an RGB destination profile, and relying
    on an external registry would defeat the self-containment PDF/A exists for.
  - **`pdfaid:part` / `pdfaid:conformance` in the XMP.** `syncXmpWithInfo` now carries the
    PDF/A declaration across metadata updates, so `set_metadata` cannot silently un-PDF/A a file.

  The sRGB ICC profile is **generated** (`services/srgb-icc.ts`, 548 bytes) rather than shipped
  as a binary asset or downloaded: no redistribution licence to check, works offline, and the
  byte sequence is fixed so E-6 holds. Its TRC approximates sRGB with a single gamma of 2.2 —
  the true transfer function is piecewise, so this is a **known simplification**, documented in
  the module and swappable for a 1024-entry table if precision ever becomes a requirement.

  Measured on `_pdf-family-e2e/invoice-with-data.pdf`: veraPDF **146/146 COMPLIANT** for
  `pdfa-3b`, **106/106** still COMPLIANT for `pdfua-1`, `qpdf --check` clean, and the embedded
  attachment (`/AF` + `/EmbeddedFiles`) survives — so the electronic-bookkeeping flow
  (`attach_file` **then** `ensure_pdfa`) holds together.

  **This tool does not make a PDF conform.** Unembedded fonts, transparency and encryption are
  untouched; it only removes the document-level obstacles. Whether the result conforms is for
  `pdf-verify-mcp`'s `validate_conformance(flavour: "pdfa-3b")` to say — the verdict comes from
  veraPDF, because ISO 19005 is outside the family's corpus and cannot be quoted.
  PDF/A-4 is deliberately out of scope (it needs PDF 2.0 output and a verify-side flavour
  extension first); it is tracked as **B-20**.

## [0.14.1] - 2026-07-23

### Fixed

- **🔴 `create_markdown_pdf` no longer deletes underscores from `snake_case` (B-17).**
  `stripInline()` stripped `_`-emphasis without checking whether the delimiter was intraword,
  so any line containing an even number of `_` lost them:
  `identify_conformance and validate_conformance` came out as
  `identifyconformance and validateconformance`. It happened with **exit 0 and no warnings**,
  and **backticks did not help** — code spans were restored *after* `_` handling, so
  `` `identify_conformance` `` was mangled too. There was no workaround available to callers.

  CommonMark permits intraword emphasis with `*` but not with `_`, precisely to protect
  `snake_case`. The spec repository's `changelog.txt` (0.17) records the rule and its history:

  > To prevent intra-word emphasis, we used to check to see if the delimiter was
  > followed/preceded by an ASCII alphanumeric. We now do something more elegant:
  > whereas an opening `*` must be left-flanking, an opening `_` must be
  > left-flanking *and not right-flanking*.

  The fix takes the earlier ASCII-alphanumeric formulation but **widens it to Unicode**
  (`/[\p{L}\p{N}_]/u`). The same changelog entry notes that the ASCII-only test misfired on
  Cyrillic words containing `_`; Japanese identifiers such as `日本語_変数名` break for the
  same reason. Code spans are now extracted before any decoration handling and restored last,
  with NUL-delimited placeholders so that ordinary text like `第 3 章` cannot be mistaken for one.

  This is a deliberately conservative approximation of the flanking rules rather than a full
  implementation. Erring on the conservative side leaves a literal `_` visible; erring the other
  way deletes a character. **Visible artefact beats silent data loss.**

  `*` behaviour is unchanged. Regression tests in `tests/strip-inline.test.ts` (16 cases);
  the pre-fix implementation fails 6 of them.

## [0.14.0] - 2026-07-20

**B-14: embedded fonts now conform to ISO 32000-2.** All four items below are things
**veraPDF cannot see** — PDF/UA-1 does not check that a font program matches the format its
dictionary claims — which is why the output kept validating 106/106 while being wrong.
They were found by re-auditing against the specification (`docs/SPEC-REAUDIT-2026-07-19.md`),
not by any validator.

### Fixed

- **🔴 CFF (`.otf`) fonts are no longer embedded as TrueType (W-2).** This tool pre-subsets with
  harfbuzz and hands the result to pdf-lib, whose `isCFF()` check does not recognise an OTTO
  container — so a font program whose first four bytes are literally `OTTO` was written as
  `/Subtype /CIDFontType2` with `/FontFile2`. **Table 124** requires a `FontFile2` program to
  conform to the TrueType Reference Manual and to include `glyf`, `head`, `hhea`, `hmtx`,
  `loca` and `maxp` (R-9.9.1-33 / -34); a CFF-based OpenType font has neither `glyf` nor `loca`.
  **R-9.7.4.2-3** additionally requires the `FontFile3` of a CIDFont embedding CFF to be
  `CIDFontType0C` or `OpenType`.

  Such fonts are now written as `/Subtype /CIDFontType0` + `/FontFile3` with
  `/Subtype /OpenType`, per the Table 124 entry for OpenType ("a CIDFontType0 CIDFont
  dictionary, if the embedded font program contains a `CFF ` table … in addition to the
  `CFF ` table, the font program shall include the `cmap` table" — harfbuzz keeps `cmap`, and
  its absence is now reported rather than silently claimed). `/CIDToGIDMap` is dropped, since
  Table 115 defines it for CIDFontType2 only.

  **This also fixes the glyph mapping, which is the part that could have broken rendering.**
  CIDFontType0 selects glyphs through `CID → charset → GID` (R-9.7.4.2-4), not `CID → GID`.
  Subsetting a CID-keyed CFF leaves a charset that maps new GIDs back to the *original* GIDs
  (measured on Noto Sans JP: gid1→cid1, gid2→cid18, … gid9→cid1478), while pdf-lib writes
  `CID = GID` into the content stream. Renaming the dictionary alone would therefore have made
  conformant processors draw **different glyphs**. The CFF charset is rewritten to the identity
  mapping (verified safe: the font declares the `Adobe-Identity-0` collection, where CID values
  carry no meaning beyond glyph order), and the sfnt checksums are recomputed.

  Side effect: poppler's long-standing `Syntax Warning: Mismatch between font type and embedded
  font file` is gone. It was recorded in `docs/TASKS.md` as *"harmless, no action needed"* —
  it was in fact the symptom of this violation.

- **Subset font names now carry the required tag (W-3).** **R-9.9.2-2 / -3** require the
  `BaseFont` and `FontName` of a subset to be "a tag followed by a plus sign followed by the
  PostScript name of the font from which the subset was created", where the tag is
  **exactly six uppercase letters** and distinct subsets in one file get distinct tags.
  pdf-lib appends a random numeric suffix instead (`NotoSansJP-Regular-7572`), which is both
  the wrong shape and a corrupted original name. Names are now `ABCDEF+NotoSansJP-Regular`,
  with the tag derived from a hash of the font program — deterministic, so identical input
  still yields identical bytes (`SOURCE_DATE_EPOCH`, E-6).

- **`FontFile2` streams now carry `Length1` (W-4).** Table 125 marks it **Required** for
  TrueType font programs; pdf-lib never writes it. Applies to `.ttf` input.

- **The Info dictionary and XMP can no longer disagree about time (W-5).** **R-14.3.4-2 / -5**
  require the two to be "fully equivalent" (shall). Both sides called `outputDate()`
  *separately*, so a document generated across a second boundary got mismatched timestamps —
  a violation that reproduces only by luck. A single timestamp is now resolved once per
  document and shared by both paths.

### Notes

- The correction runs just before `save()` (`services/font-conformance.ts`), because pdf-lib
  writes font dictionaries only when the document is flushed. It re-opens what pdf-lib wrote
  rather than trusting it — the same habit that Phase 3 of the spec audit established.
- Regression tests read the output back with **qpdf** and **poppler**, not pdf-lib: the checks
  here are precisely the ones a self-consistent reader cannot make. A first draft of the test
  file gated every case on a flag set in `beforeAll`, which `skipIf` evaluates too early — all
  seven cases skipped and the suite still reported green. Fixed, and the reason is recorded in
  the test.

## [0.13.1] - 2026-07-19

Hotfix for a v0.13.0 regression that produces **broken PDFs**. If you are on 0.13.0,
upgrade before running any page operation on a PDF that came from outside this tool.

### Fixed

- **Page operations no longer corrupt the output when the input carries XMP metadata
  (W-1).** `carryDocumentLevel` / `carryXmp` resolved the catalog reference with
  `lookup()` *before* handing it to pdf-lib's `PDFObjectCopier.copy()`. `copy()` returns
  the same kind of object it is given, so the copy of a resolved stream is a **stream
  value, not a new indirect reference** — and that value was then written straight into
  the catalog. This violates **R-7.3.8.1-5** ("All streams shall be indirect objects")
  and **R-7.7.2-22** (Table 29 `Metadata`: shall be an indirect reference), and in
  practice it breaks the file: when the catalog lives inside an object stream, the
  embedded stream bytes destroy the parse of the whole object stream, so `qpdf` reports
  `unable to find /Root dictionary` (exit 2).

  Affected: `merge_pdfs` / `split_pdf` / `extract_pages` / `delete_pages` /
  `reorder_pages` on any input whose XMP does **not** declare PDF/UA or PDF/A
  conformance — i.e. **most PDFs produced by Word, LibreOffice, scanners and browsers**.
  This tool's own tagged output declares conformance and is therefore not carried, which
  is why in-house testing never hit it.

  The fix passes the **reference** to `copy()` (and registers the copy when the input
  held a direct object), so every carried catalog entry is now indirect.

- **Regression tests now read the output back with an independent implementation.** The
  existing test "XMP without a conformance claim is carried" was green throughout,
  because it verified the output with pdf-lib only — pdf-lib's parser is lenient enough
  to report `/Metadata` as present in a catalog that qpdf and poppler refuse to read.
  The doc-level tests now assert that the carried entries are `PDFRef`s and run
  `qpdf --check` over the output of every carry path (skipped when qpdf is unavailable).

## [0.13.0] - 2026-07-18

Page operations stop destroying document-level information silently (B-10a) and start
carrying over what they safely can (B-10b). Re-auditing against the corrected ISO
corpus (pdf-spec-mcp 0.4.1) turned up **three shall violations that veraPDF cannot
see**, all now fixed. **19 tools** (unchanged).

### Added

- **Page operations now carry over the document-level information they safely can (B-10b).**
  `carryDocumentLevel` copies `/Names /EmbeddedFiles`, `/AF`, `/Lang`,
  `/ViewerPreferences` and `/OutputIntents` from the input catalog, delegating object
  duplication to pdf-lib's `PDFObjectCopier`. **Attachments surviving is the headline**:
  the machine-readable payload of a PDF/A-3 document (an invoice CSV/XML kept for
  statutory e-bookkeeping) is no longer destroyed by `extract_pages` or `merge_pdfs`.

  **What is deliberately *not* carried, and why.** The selection criterion is not "can
  this be copied" but **"is copying it still true"**:
  - `/MarkInfo` is **not** carried. `Marked true` declares "this is a Tagged PDF"; with
    no `/StructTreeRoot` (that needs B-10c) the output would claim to be tagged while
    having no structure tree.
  - `/Metadata` (XMP) is carried **only when it declares no conformance**. Copying XMP
    with `pdfuaid`/`pdfaid` into a document that lost its structure tree would assert
    PDF/UA or PDF/A conformance it does not have — and that is *worse* than losing the
    claim, because a validator then checks the file against that flavour and fails it.
    When the claim is present the XMP is dropped and the reason is reported.
  - `/AcroForm` and `/OCProperties` reference objects in the source document and need
    their references rewired (B-10c).
  - `/PageLabels`, `/Dests`, `/OpenAction` and `/Outlines` depend on page numbers or
    page references, which these operations change.

  `merge_pdfs` takes the first input's values and **says so**, naming the files whose
  values it did not merge. That report is not optional bookkeeping: the B-10a warnings
  ask "is this feature present in the output", so once the first input's attachments are
  carried, they would happily stay silent about the second input's attachments being
  dropped — carrying more would have *removed* a warning that mattered. Truly merging
  attachments across inputs (with name-collision handling) is still future work.

  Because the B-10a warnings measure the output rather than assuming what page copying
  destroys, they fell silent for the newly carried entries on their own.

- **`assertDocMdpAllows` now documents the DSS/DTS exception (B-11).** verify's issue #5
  was right, and the exception is broader than the issue implied: it applies to **every**
  `P` value, not just `P=1`. Table 257 states before the list of choices that incremental
  updates containing only the data needed to add a DSS or a document timestamp *"shall
  not be considered as changes to the document"* (R-12.8.2.2.2-5), and the `P=1` prose
  repeats it (R-12.8.2.2.1-6). This server writes neither DSS nor DTS, so nothing changes
  functionally — the note exists so the family does not drift into two readings of the
  same clause, which would make trust's verdicts disagree.

- **Page operations now report the document-level information they drop (B-10a).**
  `merge_pdfs`, `split_pdf`, `extract_pages`, `delete_pages` and `reorder_pages`
  build a new document with pdf-lib's `copyPages()`, which copies *pages only* —
  everything hanging off the catalog (ISO 32000-2 Table 29) is left behind. Until
  now only the Info dictionary was carried over and the rest disappeared silently.

  **Symptom**: a PDF/UA-1 conforming document stopped conforming after
  `extract_pages`; a PDF/A-3 attachment (the machine-readable payload kept for
  statutory e-bookkeeping) vanished on `merge_pdfs`; the XMP fixed in 0.10.0 was
  undone, leaving `Info` and `dc:title` inconsistent again. The tools reported
  success in every case.

  **Cause**: `copyPages()` walks the page tree. `copyDocumentInfo` carried the Info
  dictionary; nothing carried `/StructTreeRoot`, `/MarkInfo`, `/Metadata`,
  `/Names /EmbeddedFiles`, `/AF`, `/AcroForm`, `/Outlines`, `/OCProperties`,
  `/OutputIntents`, `/Lang`, `/ViewerPreferences`, `/PageLabels`, `/Dests`,
  `/OpenAction` or the smaller Table 29 entries.

  **Why it went unnoticed**: producing an untagged PDF is not a spec violation, so
  veraPDF has nothing to say about the *output* — it only knows what it is handed.
  The regression is only visible by comparing input and output, which no test did.
  The real defect was an internal inconsistency: writer refuses to break signatures
  and refuses to flatten a tagged form without an explicit flag ("if we break it, we
  say so"), but page operations broke things silently.

  Carrying the objects over is B-10b/c; **saying so is this change**. New
  `services/doc-level.ts` surveys the input catalog and then *measures the output*,
  reporting only what is actually missing — so the warnings will fall silent by
  themselves once carry-over lands. Tool descriptions state the limitation and point
  at the recovery path (`attach_file` / `ensure_tagged` / `add_bookmarks` /
  `set_metadata` re-applied to the output). `rotate_pages` edits in place and is
  unaffected.

  One case is reported as a **specification violation** rather than data loss:
  §8.11.4.2 requires `/OCProperties` to "be present if the PDF file contains any
  optional content" (R-8.11.4.2-2). If the copied pages still reference optional
  content, dropping the dictionary makes the output non-conforming, so the warning
  says so explicitly.

### Changed

- `split_pdf` results now carry a `warnings` field. All parts come from the same
  input, so the loss is reported once for the whole result rather than per file.

### Fixed

- **Attachment `/Params` dates described the PDF, not the attached file (SPEC-AUDIT
  Phase 3).** ISO 32000-2 Table 45 defines `ModDate` as *"the date and time when the
  embedded file was last modified"* and makes it **required** for associated files;
  §14.13.2 (R-14.13.2-2) is explicit that it *"shall be the latest modification date
  of the source file"*. `attach_file` burned in the PDF generation time instead.
  Measured: attaching a file whose mtime is 2020-03-04 produced
  `/Params << /CreationDate (D:20260717212926Z) /ModDate (D:20260717212926Z) >>`.

  This matters: under PDF/A-3 and Japanese e-bookkeeping rules the attachment's
  modification date *is* evidence about the data. Every attachment carried the
  claim "this CSV was last modified the instant the PDF was made".

  Dates now come from `stat()` on the source file. `SOURCE_DATE_EPOCH` still
  overrides them with the fixed value — it is an explicit opt-in to prefer
  reproducibility over accuracy, and clamping (the reproducible-builds convention)
  would leave the output dependent on checkout mtimes and break the
  "same input → same bytes" guarantee this server documents.

- **Form `/DA` referenced a font that `/DR` could not resolve (SPEC-AUDIT Phase 3).**
  R-12.7.4.3-7 (shall): the font named in `/DA` *"shall match a resource name in the
  Font entry of the default resource dictionary (referenced from the DR entry)"*, and
  Table 224 says `/DR` *"shall contain a Font entry"*. pdf-lib's
  `updateFieldAppearances` writes `/DA` but never creates `/DR`. Measured: a terminal
  field carrying `/DA (0 0 0 rg /NotoSansJP-Regular 18 Tf)` while the AcroForm was
  just `<< /Fields [7 0 R] >>` — nothing for the name to match, so the requirement
  was unsatisfiable.

  **Symptom this would cause**: the appearance streams are generated here, so the
  document renders fine when merely opened. But when a *viewer* regenerates an
  appearance (e.g. the user edits the field), it cannot resolve the font, falls back
  to Helvetica, and Japanese text turns into tofu — the viewer-side twin of the
  known pdf-lib pitfall.

  `refreshAppearances` now registers the embedded font in `/DR /Font` under the same
  resource name `/DA` uses, leaving any existing same-named resource intact
  (R-12.7.4.3-13).

  **Why it went unnoticed**: `form.test.ts` checked that values apply, extract and
  keep tags intact, but never inspected the AcroForm dictionary itself. veraPDF is no
  help either — PDF/UA does not require `/DR`, so the file validates as COMPLIANT.

- **Annotation text used LF where the spec requires CR (SPEC-AUDIT Phase 2).**
  ISO 32000-2 §12.5.6.2 (R-12.5.6.2-7): *"When separating text into paragraphs, a
  CARRIAGE RETURN (0Dh) shall be used and not, for example, a LINE FEED character
  (0Ah)."* MCP arguments arrive as JSON, so a caller naturally writes `\n`, and
  `add_annotation` wrote that straight into `/Contents` as `000A` (measured:
  `<FEFF…0031000A006C…>`). `normalizeAnnotationText()` now folds `\r\n`/`\n`/`\r`
  into a single `\r`.

  **Why it went unnoticed**: veraPDF's 106 PDF/UA rules do not inspect the *inside*
  of text strings — they check dictionaries and presence. Nothing but reading the
  clause would have found this.

  Found by re-auditing against pdf-spec-mcp 0.4.1, whose `get_requirements` now
  returns requirements sourced from tables (2,739 of them) — the previous canon
  returned none, so this class of requirement had never been searched
  systematically.

- **`rotate_pages` was uncallable from some MCP clients (B-13).** Passing
  `rotation: 90` always failed with `invalid_union`, so the tool could not be used
  at all from Claude Desktop.

  **This server was not at fault.** `rotation` was declared as
  `z.union([z.literal(90), z.literal(180), z.literal(270)])`, which the SDK
  correctly published as `anyOf: [{type: number, const: 90}, …]` — verified by
  spawning the built server and reading `tools/list`. The client dropped the
  `anyOf`, lost the type information, and sent the string `"90"`; the runtime Zod
  check then correctly rejected it.

  `rotation` is now `z.literal([90, 180, 270])`, which publishes the flat and
  equivalent `{type: 'number', enum: [90, 180, 270]}` — no `anyOf` to drop. **Runtime
  strictness is unchanged**: `90`/`180`/`270` are accepted and `"90"` is still
  rejected (fixed by `validation.test.ts`). Enumerating values with `enum` rather
  than `anyOf` is also the more natural JSON Schema. `fill_form`'s `fields` keeps its
  `anyOf` — that is a genuine heterogeneous union (`string|number|boolean|string[]`)
  where `anyOf` is the correct representation, and the property itself is typed
  `object`.

  **Why it went unnoticed**: `registry.test.ts` snapshotted tool names, required
  fields and annotations, but never the property schemas themselves. Note that the
  obvious invariant ("every property has `type`/`enum`/`anyOf`") would *not* have
  caught this — the schema had `anyOf` all along. The regression added is narrower:
  no property may enumerate constants via `anyOf`.

## [0.12.0] - 2026-07-17

Tier C continues: the last incremental-update gaps close (B-7b'') and
`ensure_tagged` lands (B-7c). **19 tools.**

### Added

- **`ensure_tagged`** — put an existing PDF into the PDF/UA-1 *container*.
  - Already tagged: the structure tree is **left untouched**; only missing
    document-level requirements are repaired (`MarkInfo/Marked`, `/Lang`,
    `ViewerPreferences/DisplayDocTitle`, XMP `pdfuaid:part` + `dc:title`).
  - Untagged: a minimal scaffold is created — each page's content is wrapped
    in `/P <</MCID 0>> BDC … EMC` and hung under `Document > P`, with a
    ParentTree and `/StructParents` per page. Measured: an untagged
    two-page document becomes veraPDF ua1 **COMPLIANT (106/106)**.
  - **Honest about its limits.** Machine tagging cannot infer meaning:
    headings, lists, tables, reading order and figure alt text are *not*
    produced, and the result is reported as a scaffold — not an accessible
    document — with a warning saying so. Wrapping the content in `Artifact`
    (which would also pass veraPDF) was deliberately rejected: it hides the
    body from assistive technology, i.e. conformance theatre. A `P` at
    least gets the text read out.
  - Supports `preserveSignatures` (approval signatures only).
- **`preserveSignatures` for `attach_file`, `stamp_page_numbers` and
  `add_watermark` (B-7b'')** — completes the incremental-update rollout
  across the editing tools. New dirty-tracking helpers cover the two
  remaining shapes: page content (`/Contents` array + `/Resources`, which
  pdf-lib normalises onto the page object) and the catalog name tree
  (`/Names /EmbeddedFiles`, `/AF`). DocMDP: drawing onto page content and
  adding attachments are not permitted change types at any certification
  level, so certified documents are refused.

## [0.11.1] - 2026-07-17

### Fixed

- **Trailer carry-over silently degraded on cross-reference-stream files** —
  found by live-testing v0.11.0 over MCP. `parsePreviousTrailer()` checked
  the parsed object against `PDFDict`, but for xref-stream files pdf-lib's
  `parseObject()` returns a `PDFRawStream` (dictionary *and* stream), so the
  §7.5.6 full carry-over introduced in v0.10.0 never actually ran on
  stream-style files (which includes this writer's own output) and every
  incremental update emitted a spurious "previous trailer could not be
  parsed" warning while falling back to the standard entries. The stream's
  dictionary is now used. Classic-table files were unaffected. Pinned by a
  regression assertion in both xref-style test lanes.

## [0.11.0] - 2026-07-17

Incremental updates learn tagged PDFs (B-7b'): dirty tracking generalised.

### Added

- **`preserveSignatures` now works on tagged PDFs** — the v0.9.0 limitation
  is lifted. The structure-tree appender (`struct-append.ts`) now *reports
  which existing indirect objects it mutates* (StructTreeRoot, the parent
  element whose `/K` grows, the ParentTree — or whichever object holds its
  `/Nums` array — and the page carrying `/Tabs`), and the incremental
  writer includes exactly those in the appended revision. Adding an
  annotation to a signed *and* tagged PDF keeps both properties: measured
  **veraPDF ua1 COMPLIANT (106/106)** on the incremental output and
  `verify_signatures: VALID` on a really-signed fixture. Stacked increments
  keep `ParentTreeNextKey` continuous across revisions.
- **`tag_form_fields` supports `preserveSignatures`** — PDF/UA form repair
  on signed documents without invalidating approval signatures. `/TU`
  writes are redefinitions of *existing* field dictionaries, so
  `tagWidgets` also reports its dirtied refs. Certification signatures
  (DocMDP) are refused at every permission level — structure (tagging)
  changes are not among the permitted change types of §12.8.2.2. Measured:
  a tagged-but-untagged-form document repaired via an incremental update is
  **veraPDF ua1 COMPLIANT (106/106)** with a byte-identical prefix.

### Notes

- The groundwork is deliberate: precise dirty tracking over the structure
  tree is the mechanism `ensure_tagged` (Tier C) will build on.

## [0.10.0] - 2026-07-17

Incremental updates grow up (B-7b) and `set_metadata` learns XMP (B-9).

### Added

- **`preserveSignatures` for `set_metadata` and `add_bookmarks`** — the
  signature-preserving incremental writer introduced in v0.9.0 for
  annotations is now shared plumbing (`saveWithPreservedSignatures`) and
  wired into two more tools. Measured against a really-signed PDF: two
  stacked increments (metadata update, then bookmarks) keep
  `verify_signatures: VALID` with byte-identical prefixes at every step.
  DocMDP note: per ISO 32000-2 §12.8.2.2, metadata/outline changes are not
  a permitted change type at *any* certification level, so certified
  documents are always refused (annotations remain allowed at P=3).
- **`set_metadata` now keeps XMP in sync (B-9)** — on documents that carry
  `/Metadata` (e.g. tagged output), updating the Info dictionary used to
  leave `dc:title` etc. stale (found in SPEC-AUDIT Phase 1, §14.3.3). The
  XMP packet is now regenerated from the updated Info values while
  preserving the PDF/UA declaration (`pdfuaid:part`), `dc:language` and
  `xmp:CreateDate`. The stream is replaced at the *same object ref*, so the
  catalog stays untouched and the change rides incremental updates
  naturally. New XMP fields: `dc:description` (Subject) and `pdf:Keywords`.
  Measured: a tagged PDF re-titled via `set_metadata` stays veraPDF
  **COMPLIANT (106/106)**.

### Fixed

- **§7.5.6 trailer carry-over** — the incremental trailer now includes
  *all* entries of the previous trailer (except position-dependent and
  recomputed keys), not just Root/Info/ID: the previous trailer is parsed
  from the original bytes with pdf-lib's `PDFObjectParser`, closing the
  known v0.9.x gap (rare keys such as second-class names survive updates;
  hybrid `XRefStm` is deliberately not carried). If the previous trailer
  cannot be parsed, a warning is reported instead of failing.

## [0.9.2] - 2026-07-17

SPEC-AUDIT Phase 1: the editing tools were audited clause-by-clause against
ISO 32000-2 with pdf-spec-mcp (see `docs/SPEC-AUDIT.md` for the full table).
Three shall-violations and two determinism leaks were found and fixed.

### Fixed

- **Annotations now carry appearance streams (`/AP /N`)** — ISO 32000-2
  Table 166 obliges the *writer* to include an appearance dictionary (the
  only exceptions are degenerate rects and Popup/Projection/Link). This was
  optional in ISO 32000-1, which is why veraPDF (PDF/UA-1 is 32000-1-based)
  never flagged it. `add_annotation` now generates Form XObjects: a note
  icon for `text`, a Multiply-blended bar for `highlight` (so underlying
  text shows through), and a stroked/filled rectangle for `square`.
  Practical win: poppler-based viewers previously rendered nothing for
  these annotations. Verified: veraPDF ua1 still COMPLIANT (106/106) on
  tagged documents; rendering visually confirmed via pdftoppm.
- **Outline `/Count` semantics (§12.3.3)** — item counts now follow the
  spec's recursive *visible descendants* procedure (children inside a
  collapsed branch are not counted; previously the total descendant count
  was used), and the root `/Count` is omitted when the outline has no open
  entries (it is written only when required, and never negative).
- **Embedded-files name tree is sorted (§7.9.6)** — name tree keys shall be
  lexically ordered, but pdf-lib's `attach()` appends in insertion order
  (and materialises the tree lazily, so sorting requires `flush()` first).
  Attaching a second file used to produce an out-of-order tree.

- **Determinism leaks (E-6)** — the annotation `/M` date and attachment
  creation/modification dates bypassed `SOURCE_DATE_EPOCH` via bare
  `new Date()`. Both now go through `outputDate()`; pinned by a
  byte-identity regression test covering annotate + attach.

### Audit notes

- Confirmed conforming: annotation common entries (Table 166), text icon
  names (Table 177), outline linking (§12.3.3), embedded-file structure
  (§7.11.3–4, §14.13), form filling (§12.7, appearances self-generated so
  the Widget AP obligation is met, no `NeedAppearances`), page rotation
  (Table 31, normalised multiples of 90).
- QuadPoints order: implementation keeps the industry-standard Z-order
  (TL, TR, BL, BR). The ISO prose says "counterclockwise", a well-known
  spec/reality divergence — every major viewer requires Z-order.
- New gap tracked as **B-9**: `set_metadata` updates the Info dictionary
  only; on documents that carry XMP (e.g. tagged output) this can leave
  `dc:title` etc. inconsistent (§14.3.3 deprecates Info in PDF 2.0).
- Tooling feedback: pdf-spec-mcp drops table rows that cross a page break
  (Table 182's QuadPoints row) — recorded in pdf-spec's alignment doc.

## [0.9.1] - 2026-07-17

Clause-by-clause audit of the v0.9.0 incremental writer against ISO 32000-2,
performed with pdf-spec-mcp. Two gaps were found and fixed:

### Fixed

- **§14.4 (file identifiers)**: the second `/ID` byte string *shall* change
  on every update, but v0.9.0 copied the `/ID` array unchanged. It is now
  recomputed as an MD5 of the file contents — content-based, so
  `SOURCE_DATE_EPOCH` reproducibility is unaffected; the first element
  stays permanent as required.

### Added

- **§12.8.2.2 (DocMDP) guard**: annotations are only a permitted change at
  P=3 (default when P is absent is 2). `preserveSignatures` now refuses
  certified documents with P=1 (document final) or P=2 (form fill-in only)
  with a `SIGNED_PDF` error — the incremental update would be byte-legal,
  but validators would flag it as a disallowed change.
  `findDocMdpPermission()` walks the AcroForm dictionaries directly
  (pdf-lib's `getForm()` would create an AcroForm on documents without one).

### Audit notes

- Confirmed conforming: §7.5.6 (append-only, changed-objects-only xref,
  `/Prev`, per-update `%%EOF`), §7.5.5 (`/Size` = highest object number + 1
  — the basis of `reserveExistingObjectNumbers`), §7.5.8.1 (files using
  cross-reference streams shall not use `xref`/`trailer` keywords — hence
  the style-following writer).
- Known remaining gap (tracked as B-7b): §7.5.6 requires carrying over
  *all* previous-trailer entries; pdf-lib only surfaces
  Root/Encrypt/Info/ID, so rare keys (hybrid `XRefStm`, second-class names)
  are dropped.
- Re-verified after the fixes: 251 tests, `qpdf --check` clean for both
  xref styles, and the really-signed fixture still reports
  `verify_signatures: VALID`.

## [0.9.0] - 2026-07-17

First Tier C milestone: **signature-preserving incremental updates** (ADR-11).

### Added

- **`add_annotation` `preserveSignatures: true`** — add an annotation to a
  digitally signed PDF **without invalidating its signatures**. Instead of
  pdf-lib's full-file rewrite, the new `services/incremental.ts` appends an
  ISO 32000-1 §7.5.6 incremental update: the original bytes are byte-for-byte
  untouched (so every signature's `/ByteRange` still verifies), and only the
  new/changed objects plus a cross-reference section are appended.

  - Follows the original file's xref style — classic table *and*
    cross-reference stream (PDF 1.5+) are both supported; mixing styles in
    one file is a spec violation.
  - Objects are serialised with pdf-lib's own `copyBytesInto` (no hand-rolled
    tokenizer); offsets are exact by construction (`original length +
    relative position`).
  - Minimal diff: when `/Annots` is an indirect array only that array is
    redefined, leaving the page object untouched.
  - Tagged PDFs are rejected (`UNSUPPORTED_PDF_FEATURE`) for now — nesting
    the annotation into the structure tree rewrites structure objects this
    first milestone does not track.
  - The `SIGNED_PDF` guard error now suggests `retry_with_preserveSignatures`
    ahead of `allowBreakingSignatures`.
  - Results carry `incremental: true`.

  **Measured acceptance** (Issue #2's milestone): a really-signed PDF
  (CMS/ETSI.CAdES.detached) annotated with `preserveSignatures` still
  verifies — pdf-verify-mcp reports `verify_signatures: VALID` (digest
  match, cryptographically verified) and `verify_integrity: 2 revisions,
  1 legal incremental update`. `qpdf --check` is clean for both xref styles.

### Fixed (during development, never released broken)

- Incremental object numbering could collide with object-stream containers:
  pdf-lib does not register the container stream / old xref stream as
  indirect objects, so `largestObjectNumber` under-reports on
  `useObjectStreams` files and a new annotation would reuse the container's
  number (qpdf: "supposed object stream N is not a stream"). Fixed by
  `reserveExistingObjectNumbers()`, which reads the active trailer's `/Size`
  before allocating. Pinned by a regression test.

## [0.8.0] - 2026-07-17

### Added

- **`tag_form_fields`** — repair the form inside an already-tagged PDF so it
  conforms to PDF/UA-1 (B-6). A tagged PDF that merely *contains* an AcroForm
  fails validation; this tool retrofits the three requirements:

  - **7.18.4-1**: every Widget annotation is nested in a `Form` structure
    element (`OBJR` + `/StructParent` + ParentTree registration — the same
    machinery `add_annotation` uses for `Annot` elements, now generalised in
    `struct-append.ts`).
  - **7.18.3-1**: pages carrying widgets get `/Tabs /S`.
  - **7.18.1-3**: every field gets a `/TU` (alternate name). Pass `labels`
    with human-readable names (`{"user.name": "氏名"}`); fields without a
    label fall back to the field name and are reported via `warnings`,
    because screen readers announce `/TU` and "user.name" reads poorly.

  Idempotent: widgets that already have `/StructParent` are skipped, so
  running it twice never duplicates structure elements. Untagged documents
  are rejected (`INVALID_ARGUMENT`) — creating a structure tree from scratch
  is the create tools' job (`tagged: true`) or future Tier C `ensure_tagged`.
  Handles both widget forms pdf-lib produces (`/Kids` children) and merged
  field/widget dictionaries from other producers.

  **Measured with veraPDF** (`--flavour ua1`): a tagged PDF with an untagged
  form fails exactly 7.18.1-3 / 7.18.3-1 / 7.18.4-1; after `tag_form_fields`
  it is **COMPLIANT (106/106)**.

- **Warning for `tagged: true` with the standard font** — found while
  verifying the above: Helvetica is never embedded, so a tagged PDF built
  without `fontPath` always fails PDF/UA-1 7.21.4.1-1. The create tools now
  warn that the output will not validate and point at `fontPath` /
  `PDF_WRITER_FONT`.

## [0.7.0] - 2026-07-17

コードレビュー（2026-07-17）と TASKS.md E 系（コード衛生・family 整合）への
一括対応。**ツール名・必須フィールド・成功時の出力形式は不変**。エラー応答の
形式のみ family 契約に揃えて変わった（minor バンプの理由）。

### Changed

- **McpServer + Zod へ移行（E-5）** — 低レベル `Server` + 手書き JSON Schema
  （definitions.ts 553 行）+ asserts 検査（validation.ts 502 行）の二重管理を解消。
  Zod スキーマ（validation.ts）が公開スキーマと実行時検証の単一情報源になった。
  reader / verify と同じ `registerTool` パターン。`server.ts` の `buildServer()`
  はテストから `InMemoryTransport` で検証され、`registry.test.ts` が 17 ツールの
  名前・必須フィールド・annotations を外部仕様スナップショットとして固定する。
- **構造化エラー（E-2）** — `{error: message}` から reader v0.6.0 と同じ
  `code` / `hint` / `next_actions` / `retryable` 形式へ。writer 固有のガードは
  すべて「解除フラグ付きで再試行可能」として表現される:
  `SIGNED_PDF` (allowBreakingSignatures) / `TAGGED_PDF` (allowBreakingTags) /
  `FONT_REQUIRED` (fontPath) / `MISSING_GLYPH` (onMissingGlyph)。ほかに
  `DOC_NOT_FOUND` / `FILE_TOO_LARGE` / `ENCRYPTED_PDF` / `INVALID_PDF` /
  `UNSUPPORTED_PDF_FEATURE` (XFA) / `FONT_NOT_FOUND` / `INVALID_ARGUMENT`。
- **ページ操作を page-ops.ts へ分離** — merge / split / extract / delete /
  reorder / rotate を editor.ts（20.6kB → 16.1kB）から切り出し。mergePdfs が
  文書情報の引き継ぎのために先頭ファイルを二重読込していた無駄も解消。

### Added

- **パス検査の強化（E-1）** — すべてのパス引数（inputPath / inputPaths[] /
  outputPath / outputDir / fontPath / attachmentPath）に絶対パスを強制し、
  `..` セグメントを拒否。入力 PDF に 100MB のサイズ上限を新設
  （verify の `MAX_FILE_SIZE` と同水準）。
- **stdout ガード（E-3）** — `marked` / `subset-font` 等の依存が `console.log`
  を吐いても stdio の JSON-RPC を汚染しないよう、side-effect-first の
  `stdout-guard.ts` を導入（reader / verify と同パターン）。
- **tool annotations（E-4）** — 全 17 ツールに `readOnlyHint` /
  `destructiveHint` / `idempotentHint` / `openWorldHint` を付与。
  `destructiveHint: true` は情報が失われる `delete_pages` と `flatten_form` のみ。
- **決定論的出力（E-6）** — 環境変数 `SOURCE_DATE_EPOCH`（UNIX 秒、
  reproducible-builds.org の慣習）設定時に CreationDate / ModificationDate /
  XMP の日時を固定し、同一入力 → 同一バイト列を保証。学習データ工場の
  差分検証・キャッシュ・再現テスト用。不正値は黙殺せずエラー。
- 依存に `zod ^4.4.3` を追加。

## [0.6.0] - 2026-07-16

### Added

- **`fill_form`** — fill AcroForm fields: text, checkbox, dropdown, optionlist,
  radio. Values are validated against the field's type and, for choice fields,
  against its options; both errors name what the document actually offers.
  Naming a field that does not exist lists the real field names, which is how a
  caller discovers the form without a separate listing tool.

  - Values are rendered with an **embedded font**, so Japanese works. pdf-lib
    would otherwise regenerate every appearance with Helvetica on `save()` and
    fail on `WinAnsi cannot encode "山"`; the font goes through the same
    font-manager as the create tools (ADR-7/8).
  - `flatten: true` fills and flattens in one pass.
  - Filling does **not** touch the structure tree, so a tagged PDF keeps whatever
    conformance it came in with.

- **`flatten_form`** — flatten an AcroForm so the filled values become static
  content, for fixing values before distribution.

  - **Refuses tagged PDFs by default.** Flattening removes the Widget
    annotations that the `Form` structure elements point to and bakes their
    appearance in as untagged content. Measured, not assumed: veraPDF reports
    `7.1-3 Content shall be marked as Artifact or tagged as real content`.
    `allowBreakingTags: true` overrides and reports a warning.
  - Drops the now-empty `/AcroForm` and prunes the dangling references that
    pdf-lib's `flatten()` leaves behind in `/Annots` and `/Kids` (poppler
    otherwise reports `Invalid XRef entry`).

- **`add_watermark`** — overlay a diagonal watermark ("社外秘" / "DRAFT" /
  "COPY") at the centre of each page.

  - `text`, `fontSize` (60), `color` (`#808080`), `opacity` (0.15), `angle` (45),
    `behind` (true), `pages`.
  - **Behind the body content by default.** pdf-lib can only append to a content
    stream, so the watermark is drawn and then moved to the front of the
    `/Contents` array; each stream is self-contained in `q`/`Q`, so reordering is
    safe.
  - **Becomes an artifact on tagged PDFs** (PDF/UA-1 7.1-3). Verified: veraPDF
    `ua1` 106/106.

- **`stamp_page_numbers`** — stamp page numbers onto an existing PDF.

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

### Changed

- **biome adopted** for linting and formatting, matching the rest of the family
  (same `biome.json`, same scripts). `npm run check` now runs in CI and in the
  publish workflow. Existing sources were reformatted; the suite is clean.
- The version is pinned to an exact `2.5.4` rather than a caret range. Biome's
  formatting output changes between minor releases, so a range lets a local
  `npm install` drift ahead of CI and produce spurious diffs.

### Fixed

- `parsePageSpec` reported an open-ended chunk past the end (`"2-"` on a 1-page
  document) as *reversed* rather than *out of range* — the open end collapses to
  `pageCount`, which made `from > to` trigger first.
- `handleCreateTablePdf` duplicated the Latin-1 check as a regex containing
  control characters; it now reuses the existing `hasNonLatin1` helper.
- `src/config.ts` imports `node:module` rather than the bare `module` specifier.


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
