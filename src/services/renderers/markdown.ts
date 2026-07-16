/**
 * Markdown Renderer
 * marked でブロックトークン化し、pdf-lib で描画する。
 * インライン装飾（太字/斜体）は単一フォントのため字面のみ反映（記号は除去）。
 */

import { marked } from 'marked';
import { rgb } from 'pdf-lib';
import { DEFAULTS } from '../../config.js';
import type { LoadedFont } from '../font-manager.js';
import { type LayoutEngine, wrapText } from '../layout.js';
import type { StructTag } from '../struct-tree.js';
import { assertRenderable } from './text.js';

const HEADING_SIZE: Record<number, number> = { 1: 20, 2: 16, 3: 13, 4: 12, 5: 11, 6: 11 };
const BLOCK_GAP = 6;

/** インラインのマークダウン記号を除去して字面だけ残す */
function stripInline(s: string): string {
  return s
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .trim();
}

function renderCodeBlock(engine: LayoutEngine, code: string): void {
  const font = engine.defaultFont;
  const size = engine.defaultSize - 1;
  const leading = size * 1.4;
  const padX = 6;
  const src = code.replace(/\n$/, '');

  const wrapped: string[] = [];
  for (const raw of src.split('\n')) {
    const parts = wrapText(raw, font, size, engine.contentWidth - padX * 2);
    wrapped.push(...(parts.length ? parts : ['']));
  }

  engine.moveDown(2);
  engine.struct?.begin('Code');
  for (const line of wrapped) {
    engine.ensureSpace(leading);
    // 背景は意味を持たない装飾 → Artifact（PDF/UA 7.1-3）
    engine.drawArtifact(() => {
      engine.page.drawRectangle({
        x: engine.leftX,
        y: engine.cursorTop - leading,
        width: engine.contentWidth,
        height: leading,
        color: rgb(0.95, 0.95, 0.96),
      });
    });
    if (line !== '') {
      engine.drawTaggedContent(() => {
        engine.page.drawText(line, {
          x: engine.leftX + padX,
          y: engine.cursorTop - size * 0.8,
          size,
          font,
          color: rgb(0.15, 0.15, 0.2),
        });
      });
    }
    engine.moveDown(leading);
  }
  engine.struct?.end();
  engine.moveDown(BLOCK_GAP);
}

/**
 * 見出しレベルの正規化器。
 *
 * PDF/UA 7.4.2 は「H1 から始まり、レベルを飛ばさない」ことを要求する。
 * Markdown 側は `# → ###` のように飛ぶことがあるため、構造タグに落とす際に
 * 「直前のレベル + 1」を上限にクランプする。見た目のフォントサイズは元の depth の
 * ままなので、視覚表現は変えずに構造だけを正す。
 *
 * builder がタイトルを H1 として描画済みのため、開始レベルは 1 とみなす。
 */
function createHeadingNormalizer(startLevel = 1) {
  let last = startLevel;
  return {
    normalize(depth: number): number {
      const wanted = Number.isFinite(depth) ? Math.min(Math.max(Math.trunc(depth), 1), 6) : 1;
      const level = Math.min(wanted, last + 1);
      last = level;
      return level;
    },
  };
}

export function renderMarkdown(engine: LayoutEngine, markdown: string, loaded: LoadedFont): void {
  assertRenderable(markdown, loaded);

  const headings = createHeadingNormalizer();
  const tokens = marked.lexer(markdown);

  for (const token of tokens) {
    // biome-ignore lint/suspicious/noExplicitAny: marked のトークン型は緩いため境界で any を許容
    const t = token as any;
    switch (t.type) {
      case 'heading': {
        const size = HEADING_SIZE[t.depth] ?? 12;
        engine.moveDown(t.depth <= 2 ? 8 : 5);
        // \u898b\u51fa\u3057\u30ec\u30d9\u30eb\u306f\u6b63\u898f\u5316\u3057\u3066\u304b\u3089\u4f7f\u3046\uff08PDF/UA 7.4.2: H1 \u59cb\u307e\u308a\u30fb\u30ec\u30d9\u30eb\u98db\u3070\u3057\u7981\u6b62\uff09
        const level = headings.normalize(Number(t.depth));
        engine.struct?.begin(`H${level}` as StructTag);
        engine.drawParagraph(stripInline(t.text), {
          size,
          color: rgb(0.05, 0.05, 0.05),
          lineHeight: 1.25,
          spaceAfter: 4,
        });
        engine.struct?.end();
        break;
      }
      case 'paragraph': {
        engine.struct?.begin('P');
        engine.drawParagraph(stripInline(t.text), { spaceAfter: DEFAULTS.paragraphGap });
        engine.struct?.end();
        break;
      }
      case 'list': {
        let idx = typeof t.start === 'number' && t.start > 0 ? t.start : 1;
        engine.struct?.begin('L');
        for (const item of t.items) {
          const marker = t.ordered ? `${idx}. ` : '\u2022 ';
          const body = stripInline(String(item.text)).replace(/\s*\n\s*/g, ' ');
          // L > LI > LBody\uff08Lbl \u306f marker \u3092\u672c\u6587\u306b\u542b\u3081\u3066\u3044\u308b\u305f\u3081\u4f5c\u3089\u306a\u3044\uff09
          engine.struct?.begin('LI');
          engine.struct?.begin('LBody');
          engine.drawParagraph(marker + body, { leftIndent: 14, spaceAfter: 2 });
          engine.struct?.end();
          engine.struct?.end();
          idx++;
        }
        engine.struct?.end();
        engine.moveDown(BLOCK_GAP);
        break;
      }
      case 'code': {
        renderCodeBlock(engine, String(t.text));
        break;
      }
      case 'blockquote': {
        engine.struct?.begin('BlockQuote');
        engine.drawParagraph(stripInline(String(t.text)), {
          leftIndent: 16,
          color: rgb(0.4, 0.4, 0.4),
          spaceAfter: BLOCK_GAP,
        });
        engine.struct?.end();
        break;
      }
      case 'table': {
        const headers = (t.header as { text: string }[]).map((c) => stripInline(c.text));
        const rows = (t.rows as { text: string }[][]).map((r) => r.map((c) => stripInline(c.text)));
        // 遅延 import を避けるため関数を直接呼ぶ
        renderTableInline(engine, headers, rows);
        engine.moveDown(BLOCK_GAP);
        break;
      }
      case 'hr': {
        engine.drawRule();
        break;
      }
      case 'space': {
        engine.moveDown(4);
        break;
      }
      default: {
        if (typeof t.text === 'string' && t.text.trim() !== '') {
          engine.drawParagraph(stripInline(t.text), { spaceAfter: DEFAULTS.paragraphGap });
        }
      }
    }
  }
}

// markdown 内の表描画は table renderer と共通ロジックを使う（循環 import 回避のため関数注入）
import { renderTable as renderTableInline } from './table.js';
