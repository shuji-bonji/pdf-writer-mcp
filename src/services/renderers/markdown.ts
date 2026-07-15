/**
 * Markdown Renderer
 * marked でブロックトークン化し、pdf-lib で描画する。
 * インライン装飾（太字/斜体）は単一フォントのため字面のみ反映（記号は除去）。
 */

import { marked } from 'marked';
import { rgb } from 'pdf-lib';
import { LayoutEngine, wrapText } from '../layout.js';
import type { LoadedFont } from '../font-manager.js';
import { assertRenderable } from './text.js';
import { DEFAULTS } from '../../config.js';

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
  for (const line of wrapped) {
    engine.ensureSpace(leading);
    engine.page.drawRectangle({
      x: engine.leftX,
      y: engine.cursorTop - leading,
      width: engine.contentWidth,
      height: leading,
      color: rgb(0.95, 0.95, 0.96),
    });
    if (line !== '') {
      engine.page.drawText(line, {
        x: engine.leftX + padX,
        y: engine.cursorTop - size * 0.8,
        size,
        font,
        color: rgb(0.15, 0.15, 0.2),
      });
    }
    engine.moveDown(leading);
  }
  engine.moveDown(BLOCK_GAP);
}

export function renderMarkdown(engine: LayoutEngine, markdown: string, loaded: LoadedFont): void {
  assertRenderable(markdown, loaded);

  const tokens = marked.lexer(markdown);

  for (const token of tokens) {
    // marked のトークン型は緩いため境界で any を許容
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const t = token as any;
    switch (t.type) {
      case 'heading': {
        const size = HEADING_SIZE[t.depth] ?? 12;
        engine.moveDown(t.depth <= 2 ? 8 : 5);
        engine.drawParagraph(stripInline(t.text), {
          size,
          color: rgb(0.05, 0.05, 0.05),
          lineHeight: 1.25,
          spaceAfter: 4,
        });
        break;
      }
      case 'paragraph': {
        engine.drawParagraph(stripInline(t.text), { spaceAfter: DEFAULTS.paragraphGap });
        break;
      }
      case 'list': {
        let idx = typeof t.start === 'number' && t.start > 0 ? t.start : 1;
        for (const item of t.items) {
          const marker = t.ordered ? `${idx}. ` : '\u2022 ';
          const body = stripInline(String(item.text)).replace(/\s*\n\s*/g, ' ');
          engine.drawParagraph(marker + body, { leftIndent: 14, spaceAfter: 2 });
          idx++;
        }
        engine.moveDown(BLOCK_GAP);
        break;
      }
      case 'code': {
        renderCodeBlock(engine, String(t.text));
        break;
      }
      case 'blockquote': {
        engine.drawParagraph(stripInline(String(t.text)), {
          leftIndent: 16,
          color: rgb(0.4, 0.4, 0.4),
          spaceAfter: BLOCK_GAP,
        });
        break;
      }
      case 'table': {
        const headers = (t.header as { text: string }[]).map((c) => stripInline(c.text));
        const rows = (t.rows as { text: string }[][]).map((r) =>
          r.map((c) => stripInline(c.text))
        );
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
