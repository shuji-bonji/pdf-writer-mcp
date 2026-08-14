/**
 * Table Renderer
 * ヘッダ + 行データを罫線付きの表として描画。
 * 列幅は内容から自動算出し、セル内は折り返す。改ページ時はヘッダを再描画する。
 */

import { COLORS, toPdfLibColor } from '../color.js';
import { type LayoutEngine, wrapText } from '../layout.js';
import type { TextMetrics } from '../metrics.js';

const PAD_X = 5;
const PAD_Y = 4;
const CELL_LINE_HEIGHT = 1.3;

export function renderTable(engine: LayoutEngine, headers: string[], rows: string[][]): void {
  const font = engine.defaultFont;
  // 列幅の算出は測定であって描画ではない。同じ値でも経路を分ける（metrics.ts）
  const metrics: TextMetrics = engine.defaultMetrics;
  const size = Math.max(6, engine.defaultSize - 1);
  const leading = size * CELL_LINE_HEIGHT;
  const cols = headers.length;
  const tableWidth = engine.contentWidth;

  const measure = (s: string) => metrics.widthOfTextAtSize(s, size);

  // 希望列幅（内容の最大幅）を上限でクランプ
  const maxColW = tableWidth * 0.6;
  const desired = headers.map((h, i) => {
    let w = measure(h);
    for (const r of rows) {
      w = Math.max(w, measure(r[i] ?? ''));
    }
    return Math.min(w + PAD_X * 2, maxColW);
  });

  const total = desired.reduce((a, b) => a + b, 0);
  let colWidths: number[];
  if (total <= tableWidth) {
    const extra = (tableWidth - total) / cols;
    colWidths = desired.map((w) => w + extra);
  } else {
    colWidths = desired.map((w) => (w * tableWidth) / total);
  }

  const drawRow = (cells: string[], isHeader: boolean): void => {
    const cellLines = colWidths.map((w, i) =>
      wrapText(cells[i] ?? '', font, size, Math.max(4, w - PAD_X * 2)),
    );
    const rowLines = Math.max(1, ...cellLines.map((l) => l.length || 1));
    const rowHeight = rowLines * leading + PAD_Y * 2;

    // 改ページ判定（ヘッダは呼び出し側で先に置くのでここではデータ行のみ再描画対象）
    if (engine.cursorTop - rowHeight < engine.bottomY) {
      engine.newPage();
      if (!isHeader) drawRow(headers, true);
    }

    const topY = engine.cursorTop;
    let x = engine.leftX;
    // 行は TR、セルはヘッダなら TH / データなら TD（PDF/UA 7.5）
    engine.struct?.begin('TR');
    for (let i = 0; i < cols; i++) {
      const w = colWidths[i];
      // TH には /Scope が必須（PDF/UA 7.5-1）。本レンダラのヘッダは列見出しなので Column
      engine.struct?.begin(isHeader ? 'TH' : 'TD', isHeader ? { scope: 'Column' } : {});
      // 背景・罫線は意味を持たない装飾 → Artifact
      engine.drawArtifact(() => {
        if (isHeader) {
          engine.page.drawRectangle({
            x,
            y: topY - rowHeight,
            width: w,
            height: rowHeight,
            color: toPdfLibColor(COLORS.tableHeaderBackground),
          });
        }
        engine.page.drawRectangle({
          x,
          y: topY - rowHeight,
          width: w,
          height: rowHeight,
          borderColor: toPdfLibColor(COLORS.tableBorder),
          borderWidth: 0.5,
        });
      });
      let ty = topY - PAD_Y - size * 0.8;
      for (const ln of cellLines[i]) {
        if (ln !== '') {
          const y = ty;
          engine.drawTaggedContent(() => {
            engine.page.drawText(ln, {
              x: x + PAD_X,
              y,
              size,
              font,
              color: toPdfLibColor(COLORS.tableText),
            });
          });
        }
        ty -= leading;
      }
      engine.struct?.end();
      x += w;
    }
    engine.struct?.end();
    engine.moveDown(rowHeight);
  };

  engine.struct?.begin('Table');
  drawRow(headers, true);
  for (const row of rows) {
    drawRow(row, false);
  }
  engine.struct?.end();
}
