/**
 * Input Validation
 * asserts 型述語で narrowing しつつ検査。閾値は constants.ts に集約。
 */

import { LIMITS, PAGE_SIZES, type PageSizeName } from '../constants.js';
import type {
  CreateTextArgs,
  CreateMarkdownArgs,
  CreateTableArgs,
  CommonCreateOptions,
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
