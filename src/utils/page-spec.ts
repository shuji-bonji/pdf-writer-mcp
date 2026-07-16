/**
 * Page Spec Parser
 * "1,3-5,8-" のような 1 始まりのページ指定文字列を解釈する。
 *
 * 文法:
 *   - "3"    : 単一ページ
 *   - "2-5"  : 範囲（両端含む）
 *   - "6-"   : 6 ページから最終ページまで
 *   - "-3"   : 先頭から 3 ページまで
 *   - カンマ区切りで複数指定。重複は除去し、指定順を保持する
 */

const CHUNK_RE = /^(?:(\d+)|(\d*)-(\d*))$/;

export function parsePageSpec(spec: string, pageCount: number, fieldName = 'pages'): number[] {
  if (typeof spec !== 'string' || spec.trim().length === 0) {
    throw new Error(`${fieldName} must be a non-empty string like "1,3-5,8-"`);
  }

  const result: number[] = [];
  const seen = new Set<number>();

  const push = (n: number): void => {
    if (!seen.has(n)) {
      seen.add(n);
      result.push(n);
    }
  };

  for (const raw of spec.split(',')) {
    const chunk = raw.trim();
    const m = CHUNK_RE.exec(chunk);
    if (!m) {
      throw new Error(
        `${fieldName} contains an invalid chunk "${chunk}" (expected forms: "3", "2-5", "6-", "-3")`,
      );
    }

    let from: number;
    let to: number;
    if (m[1] !== undefined) {
      from = to = Number(m[1]);
    } else {
      // "a-b" / "a-" / "-b"（"-" 単独は from/to とも空で不正）
      if (m[2] === '' && m[3] === '') {
        throw new Error(`${fieldName} contains an invalid chunk "${chunk}"`);
      }
      from = m[2] === '' ? 1 : Number(m[2]);
      to = m[3] === '' ? pageCount : Number(m[3]);
    }

    if (from < 1 || to > pageCount) {
      throw new Error(
        `${fieldName} chunk "${chunk}" is out of range (document has ${pageCount} page(s))`,
      );
    }
    if (from > to) {
      throw new Error(`${fieldName} chunk "${chunk}" is reversed (from > to)`);
    }
    for (let n = from; n <= to; n++) push(n);
  }

  return result;
}
