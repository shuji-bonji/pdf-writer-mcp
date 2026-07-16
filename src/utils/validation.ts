/**
 * Input Validation
 * asserts 型述語で narrowing しつつ検査。閾値は constants.ts に集約。
 */

import {
  ANNOTATION_ICONS,
  ANNOTATION_TYPES,
  LIMITS,
  PAGE_SIZES,
  ROTATION_ANGLES,
  type PageSizeName,
} from '../constants.js';
import type {
  CreateTextArgs,
  CreateMarkdownArgs,
  CreateTableArgs,
  CommonCreateOptions,
  CommonEditOptions,
  SetMetadataArgs,
  MergePdfsArgs,
  ExtractPagesArgs,
  DeletePagesArgs,
  ReorderPagesArgs,
  RotatePagesArgs,
  SplitPdfArgs,
  AddBookmarksArgs,
  AddAnnotationArgs,
} from '../types/index.js';

export function validateNonEmptyString(
  value: unknown,
  fieldName: string
): asserts value is string {
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} must be a string, got ${typeof value}`);
  }
  if (value.length === 0) {
    throw new Error(`${fieldName} must not be empty`);
  }
}

export function validateTextLength(value: unknown, fieldName: string): asserts value is string {
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} must be a string, got ${typeof value}`);
  }
  if (value.length > LIMITS.TEXT_MAX_LENGTH) {
    throw new Error(
      `${fieldName} is too long (${value.length} chars, max ${LIMITS.TEXT_MAX_LENGTH})`
    );
  }
}

/**
 * common オプション（すべて optional）の検査。
 * 指定されているフィールドのみ検査する。
 */
export function validateCommonOptions(opts: CommonCreateOptions): void {
  if (opts.fontSize !== undefined) {
    if (typeof opts.fontSize !== 'number' || !Number.isFinite(opts.fontSize)) {
      throw new Error(`fontSize must be a number, got ${String(opts.fontSize)}`);
    }
    if (opts.fontSize < LIMITS.FONT_SIZE_MIN || opts.fontSize > LIMITS.FONT_SIZE_MAX) {
      throw new Error(
        `fontSize must be between ${LIMITS.FONT_SIZE_MIN} and ${LIMITS.FONT_SIZE_MAX}, got ${opts.fontSize}`
      );
    }
  }

  if (opts.margin !== undefined) {
    if (typeof opts.margin !== 'number' || !Number.isFinite(opts.margin)) {
      throw new Error(`margin must be a number, got ${String(opts.margin)}`);
    }
    if (opts.margin < LIMITS.MARGIN_MIN || opts.margin > LIMITS.MARGIN_MAX) {
      throw new Error(
        `margin must be between ${LIMITS.MARGIN_MIN} and ${LIMITS.MARGIN_MAX}, got ${opts.margin}`
      );
    }
  }

  if (opts.pageSize !== undefined) {
    validatePageSize(opts.pageSize);
  }

  if (opts.fontPath !== undefined) {
    validateNonEmptyString(opts.fontPath, 'fontPath');
  }

  if (opts.outputPath !== undefined) {
    validateNonEmptyString(opts.outputPath, 'outputPath');
  }

  if (opts.onMissingGlyph !== undefined) {
    if (!['error', 'replace', 'ignore'].includes(opts.onMissingGlyph as string)) {
      throw new Error(
        `onMissingGlyph must be one of error, replace, ignore, got ${String(opts.onMissingGlyph)}`
      );
    }
  }
}

export function validatePageSize(value: unknown): asserts value is PageSizeName {
  if (typeof value !== 'string' || !(value in PAGE_SIZES)) {
    throw new Error(
      `pageSize must be one of ${Object.keys(PAGE_SIZES).join(', ')}, got ${String(value)}`
    );
  }
}

export function validateCreateTextArgs(args: unknown): asserts args is CreateTextArgs {
  if (typeof args !== 'object' || args === null) {
    throw new Error('arguments must be an object');
  }
  const a = args as Record<string, unknown>;
  validateTextLength(a.text, 'text');
  validateCommonOptions(a as CommonCreateOptions);
}

export function validateCreateMarkdownArgs(args: unknown): asserts args is CreateMarkdownArgs {
  if (typeof args !== 'object' || args === null) {
    throw new Error('arguments must be an object');
  }
  const a = args as Record<string, unknown>;
  validateTextLength(a.markdown, 'markdown');
  validateCommonOptions(a as CommonCreateOptions);
}

/** 編集系共通オプションの検査 + オブジェクト形状の確認 */
function asEditArgs(args: unknown): Record<string, unknown> {
  if (typeof args !== 'object' || args === null) {
    throw new Error('arguments must be an object');
  }
  const a = args as Record<string, unknown>;
  const opts = a as CommonEditOptions;
  if (opts.outputPath !== undefined) {
    validateNonEmptyString(opts.outputPath, 'outputPath');
  }
  if (opts.allowBreakingSignatures !== undefined && typeof opts.allowBreakingSignatures !== 'boolean') {
    throw new Error('allowBreakingSignatures must be a boolean');
  }
  return a;
}

export function validateSetMetadataArgs(args: unknown): asserts args is SetMetadataArgs {
  const a = asEditArgs(args);
  validateNonEmptyString(a.inputPath, 'inputPath');
  for (const f of ['title', 'author', 'subject', 'creator'] as const) {
    if (a[f] !== undefined && typeof a[f] !== 'string') {
      throw new Error(`${f} must be a string`);
    }
  }
  if (a.keywords !== undefined) {
    if (!Array.isArray(a.keywords) || a.keywords.some((k) => typeof k !== 'string')) {
      throw new Error('keywords must be an array of strings');
    }
  }
  if (
    a.title === undefined &&
    a.author === undefined &&
    a.subject === undefined &&
    a.keywords === undefined &&
    a.creator === undefined
  ) {
    throw new Error('set_metadata requires at least one of: title, author, subject, keywords, creator');
  }
}

export function validateMergePdfsArgs(args: unknown): asserts args is MergePdfsArgs {
  const a = asEditArgs(args);
  if (!Array.isArray(a.inputPaths) || a.inputPaths.some((p) => typeof p !== 'string' || p.length === 0)) {
    throw new Error('inputPaths must be an array of non-empty strings');
  }
  if (a.inputPaths.length < 2) {
    throw new Error('inputPaths must contain at least 2 files to merge');
  }
  if (a.inputPaths.length > LIMITS.MERGE_MAX_INPUTS) {
    throw new Error(`inputPaths has too many files (max ${LIMITS.MERGE_MAX_INPUTS})`);
  }
}

export function validateExtractPagesArgs(args: unknown): asserts args is ExtractPagesArgs {
  const a = asEditArgs(args);
  validateNonEmptyString(a.inputPath, 'inputPath');
  validateNonEmptyString(a.pages, 'pages');
}

export function validateDeletePagesArgs(args: unknown): asserts args is DeletePagesArgs {
  const a = asEditArgs(args);
  validateNonEmptyString(a.inputPath, 'inputPath');
  validateNonEmptyString(a.pages, 'pages');
}

export function validateReorderPagesArgs(args: unknown): asserts args is ReorderPagesArgs {
  const a = asEditArgs(args);
  validateNonEmptyString(a.inputPath, 'inputPath');
  if (!Array.isArray(a.order) || a.order.length === 0 || a.order.some((n) => typeof n !== 'number')) {
    throw new Error('order must be a non-empty array of page numbers (1-based)');
  }
}

export function validateRotatePagesArgs(args: unknown): asserts args is RotatePagesArgs {
  const a = asEditArgs(args);
  validateNonEmptyString(a.inputPath, 'inputPath');
  if (!ROTATION_ANGLES.includes(a.rotation as (typeof ROTATION_ANGLES)[number])) {
    throw new Error(`rotation must be one of ${ROTATION_ANGLES.join(', ')}, got ${String(a.rotation)}`);
  }
  if (a.pages !== undefined) {
    validateNonEmptyString(a.pages, 'pages');
  }
}

function validateBookmarkTree(items: unknown, path: string): void {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error(`${path} must be a non-empty array of bookmark objects`);
  }
  for (const [i, raw] of items.entries()) {
    const where = `${path}[${i}]`;
    if (typeof raw !== 'object' || raw === null) {
      throw new Error(`${where} must be an object`);
    }
    const b = raw as Record<string, unknown>;
    validateNonEmptyString(b.title, `${where}.title`);
    if (typeof b.page !== 'number' || !Number.isInteger(b.page) || b.page < 1) {
      throw new Error(`${where}.page must be a positive integer (1-based)`);
    }
    if (b.open !== undefined && typeof b.open !== 'boolean') {
      throw new Error(`${where}.open must be a boolean`);
    }
    if (b.children !== undefined) {
      validateBookmarkTree(b.children, `${where}.children`);
    }
  }
}

export function validateAddBookmarksArgs(args: unknown): asserts args is AddBookmarksArgs {
  const a = asEditArgs(args);
  validateNonEmptyString(a.inputPath, 'inputPath');
  validateBookmarkTree(a.bookmarks, 'bookmarks');
}

export function validateAddAnnotationArgs(args: unknown): asserts args is AddAnnotationArgs {
  const a = asEditArgs(args);
  validateNonEmptyString(a.inputPath, 'inputPath');

  if (typeof a.page !== 'number' || !Number.isInteger(a.page) || a.page < 1) {
    throw new Error('page must be a positive integer (1-based)');
  }
  if (!ANNOTATION_TYPES.includes(a.type as (typeof ANNOTATION_TYPES)[number])) {
    throw new Error(`type must be one of ${ANNOTATION_TYPES.join(', ')}, got ${String(a.type)}`);
  }

  if (typeof a.rect !== 'object' || a.rect === null) {
    throw new Error('rect must be an object with x1, y1, x2, y2 (PDF points, origin bottom-left)');
  }
  const r = a.rect as Record<string, unknown>;
  for (const k of ['x1', 'y1', 'x2', 'y2'] as const) {
    if (typeof r[k] !== 'number' || !Number.isFinite(r[k])) {
      throw new Error(`rect.${k} must be a finite number`);
    }
  }
  if ((r.x1 as number) >= (r.x2 as number) || (r.y1 as number) >= (r.y2 as number)) {
    throw new Error('rect must satisfy x1 < x2 and y1 < y2');
  }

  for (const f of ['contents', 'author', 'color', 'interiorColor'] as const) {
    if (a[f] !== undefined && typeof a[f] !== 'string') {
      throw new Error(`${f} must be a string`);
    }
  }
  if (a.icon !== undefined && !ANNOTATION_ICONS.includes(a.icon as (typeof ANNOTATION_ICONS)[number])) {
    throw new Error(`icon must be one of ${ANNOTATION_ICONS.join(', ')}, got ${String(a.icon)}`);
  }
  if (a.open !== undefined && typeof a.open !== 'boolean') {
    throw new Error('open must be a boolean');
  }
}

export function validateSplitPdfArgs(args: unknown): asserts args is SplitPdfArgs {
  const a = asEditArgs(args);
  validateNonEmptyString(a.inputPath, 'inputPath');
  validateNonEmptyString(a.outputDir, 'outputDir');
  if (!Array.isArray(a.ranges) || a.ranges.length === 0 || a.ranges.some((r) => typeof r !== 'string' || r.length === 0)) {
    throw new Error('ranges must be a non-empty array of page-spec strings (e.g. ["1-3", "4-"])');
  }
  if (a.prefix !== undefined) {
    validateNonEmptyString(a.prefix, 'prefix');
  }
}

export function validateCreateTableArgs(args: unknown): asserts args is CreateTableArgs {
  if (typeof args !== 'object' || args === null) {
    throw new Error('arguments must be an object');
  }
  const a = args as Record<string, unknown>;

  if (!Array.isArray(a.headers) || a.headers.some((h) => typeof h !== 'string')) {
    throw new Error('headers must be an array of strings');
  }
  if (a.headers.length === 0) {
    throw new Error('headers must not be empty');
  }
  if (a.headers.length > LIMITS.TABLE_MAX_COLS) {
    throw new Error(`headers has too many columns (max ${LIMITS.TABLE_MAX_COLS})`);
  }

  if (!Array.isArray(a.rows)) {
    throw new Error('rows must be an array');
  }
  if (a.rows.length > LIMITS.TABLE_MAX_ROWS) {
    throw new Error(`rows has too many rows (max ${LIMITS.TABLE_MAX_ROWS})`);
  }
  for (const [i, row] of a.rows.entries()) {
    if (!Array.isArray(row) || row.some((c) => typeof c !== 'string')) {
      throw new Error(`rows[${i}] must be an array of strings`);
    }
  }

  validateCommonOptions(a as CommonCreateOptions);
}
