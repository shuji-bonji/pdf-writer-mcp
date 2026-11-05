/**
 * 出力のファイルを書く（出口 3 本で共通）。
 *
 * 親のフォルダーを作ってから書く。どちらで失敗しても、ファイルシステムのエラーとして
 * `INVALID_ARGUMENT` を返す（SPEC-WRITER-COMMON-ERRORS-006・`outputWriteError`）。
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { outputWriteError } from '../errors.js';

export async function writeOutputFile(absPath: string, bytes: Uint8Array): Promise<void> {
  try {
    await mkdir(dirname(absPath), { recursive: true });
    await writeFile(absPath, bytes);
  } catch (error) {
    throw outputWriteError(absPath, error);
  }
}
