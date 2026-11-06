/**
 * 字が原因の失敗（`FONT_REQUIRED`・`MISSING_GLYPH`）と warnings で、原因の字を名指す書き方。
 *
 * - 文（`error`・warnings）は `"<字>" (U+XXXX)` を最初の 10 字まで並べ、残りを `and N more` と書く
 * - `detail` は `characters`（`U+XXXX` の配列。最初の `LIMITS.ERROR_DETAIL_MAX_CHARACTERS` 字まで）と
 *   `count`（全体の数）を持つ（SPEC-WRITER-COMMON-ERRORS-007）
 *
 * `detail` に字そのものではなく `U+XXXX` を書くのは、原因の字に制御文字（U+0085 など）が入るから。
 */

import { LIMITS } from '../constants.js';
import type { ErrorDetail } from '../errors.js';

/** 文に名指す字の数 */
const NAMED_IN_MESSAGE = 10;

/** `U+XXXX`（大文字の 16 進。4 桁以上） */
export function codePointLabel(ch: string): string {
  return `U+${(ch.codePointAt(0) as number).toString(16).toUpperCase().padStart(4, '0')}`;
}

/** `"a" (U+0061), "b" (U+0062) and 3 more` */
export function describeCharacters(chars: readonly string[]): string {
  const list = chars
    .slice(0, NAMED_IN_MESSAGE)
    .map((ch) => `"${ch}" (${codePointLabel(ch)})`)
    .join(', ');
  const rest = chars.length - NAMED_IN_MESSAGE;
  return rest > 0 ? `${list} and ${rest} more` : list;
}

/** `detail` に書く `characters` と `count` */
export function characterDetail(
  chars: readonly string[],
): Required<Pick<ErrorDetail, 'characters' | 'count'>> {
  return {
    characters: chars.slice(0, LIMITS.ERROR_DETAIL_MAX_CHARACTERS).map(codePointLabel),
    count: chars.length,
  };
}
