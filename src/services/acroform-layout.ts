/**
 * 可変テキストの割り付け —— Phase 3 の L4′.2（フォーム組の受け皿 #3 の計算部分）。
 *
 * **入出力とも素の値で、PDF のオブジェクトに触らない。** 単体で測れるようにしてある。
 * COS への書き込みは `acroform-appearance.ts` が行う。
 *
 * | 要件 | 何を言っているか |
 * |---|---|
 * | R-12.7.4.3-5 | `/DA` にはテキストオブジェクト内で許される演算子だけが入る |
 * | R-12.7.4.3-6 | `/DA` は最低でも `Tf` とその 2 つの被演算子を含む |
 * | R-12.7.4.3-8 | `Tf` のサイズ 0 は**自動サイズ**（算出方法は実装依存） |
 * | R-12.7.4.3-9 / -11 | `/DA` の `Tm` は高々 1 つ。無ければ `/DA` の後・描画の前に置く |
 * | R-12.7.4.3-13 | 既存の外観は `/Tx BMC` から対応する `EMC` までを差し替える。無ければ末尾に足す |
 * | R-12.7.4.3-14 | `/Q` は 0=左寄せ / 1=中央 / 2=右寄せ。既定 0 |
 * | Table 231 bit 13 | Multiline |
 * | Table 231 bit 25 | Comb。`/MaxLen` があり Multiline / Password / FileSelect が下りているときだけ |
 * | Table 232 | `/MaxLen`（comb の桝の数になる） |
 */

/** 文字幅を pt で答えるもの（`metrics.ts` の `TextMetrics` と同じ形） */
export interface Measure {
  widthOfTextAtSize(text: string, size: number): number;
}

/** 縦位置の計算に要るフォントの縦方向の寸法。1000 単位のグリフ空間（§9.2.4） */
export interface VerticalMetrics {
  /** ベースラインより上（正） */
  readonly ascent: number;
  /** ベースラインより下（**負**で持つ。§9.8.1 Table 122 の `/Descent` と同じ符号） */
  readonly descent: number;
}

// --------------------------------------------------------------------------- /DA

export interface DefaultAppearance {
  /** `/DA` の文字列そのもの。`BT` の直後にそのまま置く */
  readonly source: string;
  /** `Tf` が名指すフォント名（先頭の `/` は含まない）。見つからなければ null */
  readonly fontName: string | null;
  /** `Tf` のサイズ。**0 は自動サイズ**（R-12.7.4.3-8） */
  readonly size: number;
  /** `Tm` を含むか（R-12.7.4.3-9） */
  readonly hasTm: boolean;
}

/**
 * `/DA` から `Tf` の 2 つの被演算子と `Tm` の有無を読む。
 *
 * 演算子の**直前 2 語**を被演算子として取る。`/DA` は「テキストオブジェクト内で
 * 許される演算子」の並びなので（R-12.7.4.3-5）、この読み方で足りる。
 */
export function parseDefaultAppearance(source: string): DefaultAppearance {
  const tokens = tokenize(source);
  let fontName: string | null = null;
  let size = 0;
  let hasTm = false;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i] as string;
    if (token === 'Tm') hasTm = true;
    if (token !== 'Tf' || i < 2) continue;
    const rawName = tokens[i - 2] as string;
    const rawSize = Number.parseFloat(tokens[i - 1] as string);
    if (rawName.startsWith('/')) fontName = decodeName(rawName.slice(1));
    if (Number.isFinite(rawSize)) size = rawSize;
  }
  return { source, fontName, size, hasTm };
}

/** §7.3.5 の `#xx` を戻す */
function decodeName(raw: string): string {
  return raw.replace(/#([0-9A-Fa-f]{2})/g, (_, hex) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );
}

// --------------------------------------------------------------------------- `/Tx BMC` … `EMC`

/**
 * 既存の外観ストリームの `/Tx BMC` から**対応する** `EMC` までを差し替える
 * （R-12.7.4.3-13）。marked-content が無ければ末尾に足す。
 *
 * 🔴 **入れ子を数える。** 内側に別の `BMC` / `BDC` があると、最初に出てくる `EMC` は
 * 対応する相手ではない。素朴に `indexOf('EMC')` で切ると、外側の marked-content が
 * 閉じないまま残る。
 */
export function spliceTxMarkedContent(existing: string, replacement: string): string {
  const found = findTxSpan(existing);
  if (found === null) {
    const separator = existing.length === 0 || existing.endsWith('\n') ? '' : '\n';
    return `${existing}${separator}${replacement}`;
  }
  return existing.slice(0, found.start) + replacement + existing.slice(found.end);
}

/** `/Tx BMC` の開始位置と、対応する `EMC` の終端位置 */
export function findTxSpan(source: string): { start: number; end: number } | null {
  const tokens = tokenizeWithOffsets(source);
  for (let i = 1; i < tokens.length; i += 1) {
    if (tokens[i]?.text !== 'BMC' || tokens[i - 1]?.text !== '/Tx') continue;
    let depth = 1;
    for (let j = i + 1; j < tokens.length; j += 1) {
      const text = tokens[j]?.text;
      if (text === 'BMC' || text === 'BDC') depth += 1;
      else if (text === 'EMC') {
        depth -= 1;
        if (depth === 0) {
          return { start: tokens[i - 1]?.start as number, end: tokens[j]?.end as number };
        }
      }
    }
    return null; // 閉じていない。触らない方が安全
  }
  return null;
}

// --------------------------------------------------------------------------- 割り付け

/** 割り付けに要る箱と書式 */
export interface FieldLayoutInput {
  /** `/Rect` から得た見た目の幅・高さ */
  readonly width: number;
  readonly height: number;
  /** 枠の内側に取る余白（pt） */
  readonly padding: number;
  /** `/Q`（R-12.7.4.3-14） */
  readonly quadding: 0 | 1 | 2;
  readonly multiline: boolean;
  /** comb の桝の数。comb でなければ 0（Table 231 bit 25 + Table 232） */
  readonly comb: number;
  /** `/DA` の `Tf` サイズ。0 なら自動（R-12.7.4.3-8） */
  readonly size: number;
}

/** 1 行ぶんの描画指示 */
export interface LaidOutLine {
  readonly text: string;
  readonly x: number;
  readonly y: number;
}

export interface FieldLayout {
  /** 実際に使うフォントサイズ（自動サイズを解決した後） */
  readonly size: number;
  readonly lines: readonly LaidOutLine[];
  /** comb のときは 1 文字ずつ置く */
  readonly comb: boolean;
}

/** 自動サイズのときに試す上限と下限（pt） */
const AUTO_MAX = 12;
const AUTO_MIN = 4;
/** 行送りをフォントサイズの何倍にするか */
const LINE_HEIGHT = 1.15;

/**
 * 値を箱に割り付ける。
 *
 * 自動サイズ（`/DA` の `Tf` が 0）の算出方法は R-12.7.4.3-8 が「実装依存」と言う。
 * ここでは **12 pt から 0.5 pt 刻みで下げ、幅と高さの両方に収まる最大**を選ぶ。
 * 下限 4 pt で打ち切り、それでも溢れるならはみ出したまま描く（値を黙って捨てない）。
 */
export function layoutFieldText(
  value: string,
  font: Measure & VerticalMetrics,
  input: FieldLayoutInput,
): FieldLayout {
  const inner = {
    width: Math.max(0, input.width - input.padding * 2),
    height: Math.max(0, input.height - input.padding * 2),
  };

  if (input.comb > 0) {
    const size = input.size > 0 ? input.size : fitCombSize(value, font, inner, input.comb);
    return { size, lines: combLines(value, font, input, inner, size), comb: true };
  }

  const size = input.size > 0 ? input.size : fitSize(value, font, inner, input.multiline);
  const texts = input.multiline ? wrapLines(value, font, size, inner.width) : [oneLine(value)];
  const lineHeight = size * LINE_HEIGHT;

  const lines: LaidOutLine[] = texts.map((text, index) => ({
    text,
    x: input.padding + quadOffset(input.quadding, inner.width, font.widthOfTextAtSize(text, size)),
    y: input.multiline
      ? input.padding + inner.height - lineHeight * (index + 1) + descentOf(font, size)
      : input.padding + centeredBaseline(inner.height, font, size),
  }));
  return { size, lines, comb: false };
}

/** 改行を落として 1 行にする（Multiline が下りているフィールドに複数行の値が来た場合） */
const oneLine = (value: string): string => value.replace(/\r\n|[\r\n]/g, ' ');

/** ベースラインより下の量（pt・正の値） */
const descentOf = (font: VerticalMetrics, size: number): number =>
  (Math.abs(font.descent) * size) / 1000;

/**
 * 1 行を箱の高さの中央に置くベースライン。
 *
 * 文字の縦の広がりは ascent + |descent| なので、余りを上下に等分し、
 * 下の余りぶんだけベースラインを上げる。
 */
function centeredBaseline(innerHeight: number, font: VerticalMetrics, size: number): number {
  const glyphHeight = ((font.ascent + Math.abs(font.descent)) * size) / 1000;
  return (innerHeight - glyphHeight) / 2 + descentOf(font, size);
}

/** `/Q` に応じた行の左端（R-12.7.4.3-14） */
export function quadOffset(quadding: 0 | 1 | 2, innerWidth: number, textWidth: number): number {
  if (quadding === 1) return Math.max(0, (innerWidth - textWidth) / 2);
  if (quadding === 2) return Math.max(0, innerWidth - textWidth);
  return 0;
}

/** 幅と高さの両方に収まる最大のサイズ（0.5 pt 刻み） */
function fitSize(
  value: string,
  font: Measure & VerticalMetrics,
  inner: { width: number; height: number },
  multiline: boolean,
): number {
  for (let size = AUTO_MAX; size >= AUTO_MIN; size -= 0.5) {
    const lines = multiline ? wrapLines(value, font, size, inner.width) : [oneLine(value)];
    const widest = Math.max(0, ...lines.map((l) => font.widthOfTextAtSize(l, size)));
    const needed = multiline
      ? size * LINE_HEIGHT * lines.length
      : ((font.ascent + Math.abs(font.descent)) * size) / 1000;
    if (widest <= inner.width && needed <= inner.height) return size;
  }
  return AUTO_MIN;
}

/** comb は 1 桝に 1 文字なので、桝の幅と箱の高さで決める */
function fitCombSize(
  value: string,
  font: Measure & VerticalMetrics,
  inner: { width: number; height: number },
  comb: number,
): number {
  const cell = inner.width / comb;
  for (let size = AUTO_MAX; size >= AUTO_MIN; size -= 0.5) {
    const widest = Math.max(0, ...[...value].map((c) => font.widthOfTextAtSize(c, size)));
    const needed = ((font.ascent + Math.abs(font.descent)) * size) / 1000;
    if (widest <= cell && needed <= inner.height) return size;
  }
  return AUTO_MIN;
}

/**
 * comb（Table 231 bit 25）: 箱を `/MaxLen` 個の等幅の桝に割り、1 文字ずつ中央に置く。
 * `/MaxLen` を超えた文字は桝が無いので描かない。
 */
function combLines(
  value: string,
  font: Measure & VerticalMetrics,
  input: FieldLayoutInput,
  inner: { width: number; height: number },
  size: number,
): LaidOutLine[] {
  const cell = inner.width / input.comb;
  const y = input.padding + centeredBaseline(inner.height, font, size);
  const chars = [...value].slice(0, input.comb);
  // 桝の並び全体に対しても `/Q` が効く（左寄せなら先頭の桝から）
  const used = chars.length * cell;
  const shift = quadOffset(input.quadding, inner.width, used);
  return chars.map((text, index) => ({
    text,
    x: input.padding + shift + cell * index + (cell - font.widthOfTextAtSize(text, size)) / 2,
    y,
  }));
}

/**
 * Multiline（Table 231 bit 13）の行分け。
 *
 * 値の中の改行で必ず切り、そのうえで幅に収まらない行を折り返す。
 * 空白で切れないほど長い語は 1 文字ずつ詰める（語を丸ごと捨てない）。
 */
export function wrapLines(value: string, font: Measure, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const paragraph of value.split(/\r\n|[\r\n]/)) {
    if (paragraph === '') {
      out.push('');
      continue;
    }
    let line = '';
    for (const chunk of paragraph.match(/\s+|\S+/g) ?? []) {
      const candidate = line + chunk;
      if (line !== '' && font.widthOfTextAtSize(candidate, size) > maxWidth) {
        out.push(line);
        line = /^\s+$/.test(chunk) ? '' : chunk;
      } else {
        line = candidate;
      }
      // 1 語で幅を超える場合は文字単位で割る
      while (line !== '' && font.widthOfTextAtSize(line, size) > maxWidth) {
        let cut = line.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(line.slice(0, cut), size) > maxWidth) cut -= 1;
        out.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    out.push(line);
  }
  // 行末の空白は幅に数えない。数えると中央寄せ・右寄せが空白のぶんずれる
  return out.map((line) => line.replace(/[ \t]+$/, ''));
}

// --------------------------------------------------------------------------- 字句

interface Token {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

const WHITESPACE = new Set([' ', '\t', '\r', '\n', '\f', '\0']);
const DELIMITER = new Set(['(', ')', '<', '>', '[', ']', '{', '}', '/', '%']);

/**
 * 内容ストリームを語に割る（§7.2）。
 * 文字列（`(…)` / `<…>`）とコメントは中身を読まずに 1 語として飛ばす ——
 * その中に `EMC` という並びがあっても演算子ではない。
 */
export function tokenizeWithOffsets(source: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i] as string;
    if (WHITESPACE.has(ch)) {
      i += 1;
      continue;
    }
    const start = i;
    if (ch === '%') {
      while (i < source.length && source[i] !== '\n' && source[i] !== '\r') i += 1;
      continue; // コメントは語にしない
    }
    if (ch === '(') {
      let depth = 0;
      while (i < source.length) {
        const c = source[i] as string;
        if (c === '\\') i += 2;
        else {
          if (c === '(') depth += 1;
          else if (c === ')') {
            depth -= 1;
            if (depth === 0) {
              i += 1;
              break;
            }
          }
          i += 1;
        }
      }
      out.push({ text: source.slice(start, i), start, end: i });
      continue;
    }
    if (ch === '<' && source[i + 1] !== '<') {
      while (i < source.length && source[i] !== '>') i += 1;
      i += 1;
      out.push({ text: source.slice(start, i), start, end: i });
      continue;
    }
    if (ch === '<' || ch === '>') {
      i += source[i + 1] === ch ? 2 : 1;
      out.push({ text: source.slice(start, i), start, end: i });
      continue;
    }
    if (ch === '[' || ch === ']' || ch === '{' || ch === '}') {
      i += 1;
      out.push({ text: ch, start, end: i });
      continue;
    }
    // 名前と、数値・演算子などの素の語
    if (ch === '/') i += 1;
    while (i < source.length) {
      const c = source[i] as string;
      if (WHITESPACE.has(c) || DELIMITER.has(c)) break;
      i += 1;
    }
    out.push({ text: source.slice(start, i), start, end: i });
  }
  return out;
}

/** 語の並びだけが要るとき */
export function tokenize(source: string): string[] {
  return tokenizeWithOffsets(source).map((t) => t.text);
}

/**
 * `/DA` の `Tf` の被演算子だけを差し替え、**それ以外の演算子はそのまま残す**。
 *
 * 🔴 `/DA` は「テキスト状態を決める演算子の並び」で、色（`rg` / `g` / `k`）や
 * 文字間隔（`Tc`）が入っている（R-12.7.4.3-5）。writer が要るのはフォントを
 * 自分が埋め込んだものへ向け直すことだけなので、`/DA` を組み立て直すと
 * **文書作成者が指定した色を黒で上書きする**ことになる。
 *
 * `Tf` が無ければ末尾に足す（R-12.7.4.3-6 は最低でも `Tf` を求めている）。
 */
export function replaceDaFont(source: string, fontName: string, size: number): string {
  const escaped = escapeName(fontName);
  const tokens = tokenizeWithOffsets(source);
  for (let i = tokens.length - 1; i >= 2; i -= 1) {
    if (tokens[i]?.text !== 'Tf') continue;
    const start = tokens[i - 2]?.start as number;
    const end = tokens[i]?.end as number;
    return `${source.slice(0, start)}/${escaped} ${size} Tf${source.slice(end)}`;
  }
  const separator = source.length === 0 || /\s$/.test(source) ? '' : ' ';
  return `${source}${separator}/${escaped} ${size} Tf`;
}

/** §7.3.5: 名前に書けない文字を `#xx` にする（大文字 —— pdf-lib は小文字を復号できない） */
export function escapeName(value: string): string {
  return value.replace(
    /[^\x21-\x7e]|[#()<>[\]{}/%]/g,
    (ch) => `#${ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`,
  );
}
