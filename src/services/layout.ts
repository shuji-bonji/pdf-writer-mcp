/**
 * Layout Engine
 * pdf-lib の低レベル API の上に、テキスト折り返し・改ページ・カーソル管理を載せる薄い層。
 * 座標は「上端(top)基準」で管理し、見出し・本文・表でサイズが変わっても一貫して積み上げる。
 */

import { COLORS, type Rgb } from './color.js';
import type { WriterFont } from './font-embed.js';
import type { TextMetrics } from './metrics.js';
import type { StructTreeBuilder } from './struct-tree.js';
import type { WriterDocument, WriterPage } from './writer-doc.js';

/** ベースライン近似係数（グリフ上端からベースラインまで ≒ size * この値） */
const ASCENT_RATIO = 0.8;

export interface LayoutOptions {
  pageWidth: number;
  pageHeight: number;
  margin: number;
  font: WriterFont;
  fontSize: number;
  lineHeight: number;
  /**
   * タグ付き PDF の構造木ビルダー。
   * 指定すると全描画が BDC/EMC で囲まれる（PDF/UA 7.1-3）。
   */
  struct?: StructTreeBuilder;
}

export interface DrawTextOptions {
  font?: WriterFont;
  size?: number;
  color?: Rgb;
  lineHeight?: number;
  /** 左インデント（pt） */
  leftIndent?: number;
  /** 段落末尾に追加する余白（pt） */
  spaceAfter?: number;
}

/**
 * WinAnsi で表現できない文字（コードポイント > 0xFF）が含まれるか。
 * 標準フォントでは日本語などが描画できないため、事前判定に使う。
 */
export function hasNonLatin1(text: string): boolean {
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp !== undefined && cp > 0xff) return true;
  }
  return false;
}

const CJK_RE = /[\u2E80-\u9FFF\u3000-\u303F\uFF00-\uFFEF\u3400-\u4DBF]/;

/**
 * 折り返し用トークン分割：
 * - 空白は ' ' マーカー
 * - CJK は 1 文字ずつ（どこでも改行可）
 * - それ以外（ラテン単語など）は連続した塊
 */
function splitTokens(line: string): string[] {
  const tokens: string[] = [];
  let buf = '';
  for (const ch of line) {
    if (/\s/.test(ch)) {
      if (buf) {
        tokens.push(buf);
        buf = '';
      }
      tokens.push(' ');
    } else if (CJK_RE.test(ch)) {
      if (buf) {
        tokens.push(buf);
        buf = '';
      }
      tokens.push(ch);
    } else {
      buf += ch;
    }
  }
  if (buf) tokens.push(buf);
  return tokens;
}

/** 1 トークンが maxWidth を超える場合に文字単位で強制分割 */
function breakLongToken(
  token: string,
  metrics: TextMetrics,
  size: number,
  maxWidth: number,
): string[] {
  const parts: string[] = [];
  let cur = '';
  for (const ch of token) {
    const trial = cur + ch;
    if (cur && metrics.widthOfTextAtSize(trial, size) > maxWidth) {
      parts.push(cur);
      cur = ch;
    } else {
      cur = trial;
    }
  }
  if (cur) parts.push(cur);
  return parts;
}

/**
 * テキストを maxWidth に収まる行配列に折り返す。
 * 明示的な \n は改行として尊重し、空行も保持する。
 *
 * 幅は `TextMetrics`（`metrics.ts`）に訊く。`PDFFont` はこの型を構造的に満たすので
 * 呼び出し側は今までどおりフォントを渡せるが、**この関数が pdf-lib を知ることはもう無い**。
 */
export function wrapText(
  text: string,
  metrics: TextMetrics,
  size: number,
  maxWidth: number,
): string[] {
  const out: string[] = [];
  for (const rawLine of text.split('\n')) {
    if (rawLine.trim() === '') {
      out.push('');
      continue;
    }
    const tokens = splitTokens(rawLine);
    let line = '';
    for (const tk of tokens) {
      if (tk === ' ' && line === '') continue; // 行頭空白は捨てる
      const candidate = line + tk;
      if (line !== '' && metrics.widthOfTextAtSize(candidate, size) > maxWidth) {
        out.push(line.replace(/\s+$/, ''));
        line = tk === ' ' ? '' : tk;
      } else {
        line = candidate;
      }
      // 単一トークンだけで既に幅超過 → 強制分割
      if (line !== '' && metrics.widthOfTextAtSize(line, size) > maxWidth) {
        const parts = breakLongToken(line, metrics, size, maxWidth);
        for (let i = 0; i < parts.length - 1; i++) out.push(parts[i]);
        line = parts[parts.length - 1] ?? '';
      }
    }
    out.push(line.replace(/\s+$/, ''));
  }
  return out;
}

export class LayoutEngine {
  readonly doc: WriterDocument;
  private opts: LayoutOptions;
  private _page: WriterPage;
  private _top: number;

  constructor(doc: WriterDocument, opts: LayoutOptions) {
    this.doc = doc;
    this.opts = opts;
    this._page = doc.addPage(opts.pageWidth, opts.pageHeight);
    this._top = opts.pageHeight - opts.margin;
  }

  get page(): WriterPage {
    return this._page;
  }
  get leftX(): number {
    return this.opts.margin;
  }
  get bottomY(): number {
    return this.opts.margin;
  }
  get contentWidth(): number {
    return this.opts.pageWidth - this.opts.margin * 2;
  }
  /**
   * 描画に渡すフォント。**L3' で自前の型になった。**
   * L1.5 で `defaultFont`（描画）と `defaultMetrics`（測定）を用途で分けたのは、
   * 描画が pdf-lib に残っている間の措置だった。両方こちらへ来たので同じ値を返すが、
   * **呼び出し側が用途で呼び分けている形はそのまま残す** —— 測定だけを別の実装に
   * 差し替える余地（L5' の標準 14 の幅表）が消えないように。
   */
  get defaultFont(): WriterFont {
    return this.opts.font;
  }
  /**
   * 幅を訊く先。`defaultFont` と同じ値だが、**用途が違うので型を分けてある** ——
   * 測定は L1.5 で writer の関心として切り出し済み、描画は L4 まで pdf-lib に残る。
   * 分けておかないと、描画が外れるまで測定も動かせない形になる。
   */
  get defaultMetrics(): TextMetrics {
    return this.opts.font;
  }
  get defaultSize(): number {
    return this.opts.fontSize;
  }
  get cursorTop(): number {
    return this._top;
  }
  set cursorTop(v: number) {
    this._top = v;
  }
  /** タグ付き生成のとき構造木ビルダーを返す（未指定なら undefined） */
  get struct(): StructTreeBuilder | undefined {
    return this.opts.struct;
  }

  /**
   * 実コンテンツの描画。タグ付きなら BDC/EMC で囲む。
   * 構造要素の begin/end は呼び出し側（renderer）が行う。
   * page へ直接描画する renderer（表・コード等）はこれを経由すること。
   */
  drawTaggedContent(draw: () => void): void {
    if (this.opts.struct) {
      this.opts.struct.markContent(this._page, draw);
    } else {
      draw();
    }
  }

  /** 意味を持たない描画（罫線・背景）。タグ付きなら Artifact で囲む */
  drawArtifact(draw: () => void): void {
    if (this.opts.struct) {
      this.opts.struct.markArtifact(this._page, draw);
    } else {
      draw();
    }
  }

  newPage(): void {
    this._page = this.doc.addPage(this.opts.pageWidth, this.opts.pageHeight);
    this._top = this.opts.pageHeight - this.opts.margin;
  }

  /** height 分の余白が下端まで残っていなければ改ページ */
  ensureSpace(height: number): void {
    if (this._top - height < this.bottomY) {
      this.newPage();
    }
  }

  moveDown(amount: number): void {
    this._top -= amount;
  }

  /** 折り返し + 改ページしながら段落を描画。消費した高さ分 cursorTop が下がる。 */
  drawParagraph(text: string, options: DrawTextOptions = {}): void {
    const font = options.font ?? this.opts.font;
    const size = options.size ?? this.opts.fontSize;
    const lineHeight = options.lineHeight ?? this.opts.lineHeight;
    const color = options.color ?? COLORS.bodyText;
    const leftIndent = options.leftIndent ?? 0;
    const leading = size * lineHeight;
    const maxWidth = this.contentWidth - leftIndent;

    const lines = wrapText(text, font, size, maxWidth);
    for (const line of lines) {
      this.ensureSpace(leading);
      if (line !== '') {
        const y = this._top - size * ASCENT_RATIO;
        this.drawTaggedContent(() => {
          this._page.drawText(line, {
            x: this.leftX + leftIndent,
            y,
            size,
            font,
            color,
          });
        });
      }
      this._top -= leading;
    }
    if (options.spaceAfter) this._top -= options.spaceAfter;
  }

  /** 水平線 */
  drawRule(
    options: { color?: Rgb; thickness?: number; spaceBefore?: number; spaceAfter?: number } = {},
  ): void {
    const thickness = options.thickness ?? 0.75;
    const color = options.color ?? COLORS.rule;
    const spaceBefore = options.spaceBefore ?? 4;
    const spaceAfter = options.spaceAfter ?? 8;
    this.moveDown(spaceBefore);
    this.ensureSpace(thickness + spaceAfter);
    // 水平線は意味を持たない装飾 → Artifact（PDF/UA 7.1-3）
    this.drawArtifact(() => {
      this._page.drawLine({
        start: { x: this.leftX, y: this._top },
        end: { x: this.leftX + this.contentWidth, y: this._top },
        thickness,
        color,
      });
    });
    this.moveDown(spaceAfter);
  }
}
