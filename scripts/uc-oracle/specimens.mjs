/**
 * UC 検体行列 — Phase 3 の差分オラクルが測る対象。
 *
 * **軸で作る。** フィクスチャが 1 形しか作らない軸は永久に測られない
 * （実例: 既存テストが全部 origin = 0 で書かれていたため、`startxref` を絶対位置として
 * 扱う欠陥 B-22 が 0.19.0 まで生き延びた）。だから検体は「ツールごと」ではなく
 * **軸の組み合わせ**で並べ、`axes` に何を変えたかを書く。
 *
 * 軸:
 *   pdfVersion  1.7 / 2.0
 *   font        std14（埋め込まない）/ cff（.otf）/ truetype（.ttf）
 *   tagged      false / true
 *   inputXref   なし / table / stream
 *   origin      0 / >0
 *   signed      false / true（増分更新の経路）
 *   attachment  false / true
 *   form        なし / fill / flatten / tag
 *
 * 入力が手元に無い検体は `unavailable` として記録する。**緑にも赤にもしない** —
 * 測れなかったものを合格に数えると、下手な実装ほど失敗が減る
 * （[[undecided-is-not-innocent]]）。
 */

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(here, '..', '..');
export const stackRoot = join(repoRoot, '..', '..');

/** 埋め込み CFF フォント（リポジトリ同梱） */
export const FONT_CFF = process.env.TEST_FONT_PATH ?? join(repoRoot, 'NotoSansJP-Regular.otf');

/**
 * 埋め込み TrueType フォント。
 * **手元に 1 本も無い**（2026-08-13 実測: `pdf-agent-stack` 配下に `.ttf` が 0 件）。
 * W-2（CFF を `CIDFontType2 + FontFile2` で埋めていた = R-9.9.1-33/-34 違反）は
 * **まさにこの軸の欠落で生き延びた**欠陥なので、TrueType 検体を足すまで
 * 「フォント辞書型が正しく分岐する」ことは測れていない。
 */
export const FONT_TTF = process.env.TEST_FONT_TTF ?? null;

const specimen = (path) => join(stackRoot, 'docs', 'specimens', path);
const pdf20 = (name) => join(stackRoot, 'lib', 'normativepdf', 'corpus', 'pdf20examples', name);

/** 入力ファイルの実在確認は 1 箇所に閉じる */
export const resolveInput = (p) => (p !== null && existsSync(p) ? p : null);

const MARKDOWN = `# Invoice

Total: **1200 JPY**

- Item A
- Item B

| key | value |
| --- | ----- |
| date | 2026-07-28 |
`;

/**
 * 検体定義。
 * `steps` は writer の MCP ツールを順に呼ぶ。`{{prev}}` は直前の出力、
 * `{{id:step}}` は他検体の出力を指す（out ディレクトリ内の相対名で解決する）。
 */
export const SPECIMENS = [
  // ---- A 群: 生成（入力なし）
  {
    id: 'create-text-std14-17',
    uc: 'UC-2',
    axes: { pdfVersion: '1.7', font: 'std14', tagged: false },
    steps: [
      {
        tool: 'create_text_pdf',
        args: { text: 'Invoice for July 2026.\n\nTotal: 1200 JPY', title: 'Invoice' },
      },
    ],
  },
  {
    id: 'create-text-cff-17',
    uc: 'UC-2',
    axes: { pdfVersion: '1.7', font: 'cff', tagged: false },
    steps: [
      {
        tool: 'create_text_pdf',
        args: { text: '請求書 2026 年 7 月\n\n合計: 1200 円', title: '請求書', font: 'cff' },
      },
    ],
  },
  {
    id: 'create-text-cff-20',
    uc: 'UC-2',
    axes: { pdfVersion: '2.0', font: 'cff', tagged: false },
    steps: [
      {
        tool: 'create_text_pdf',
        args: { text: 'PDF 2.0 body', title: 'Two', font: 'cff', pdfVersion: '2.0' },
      },
    ],
  },
  {
    id: 'create-text-cff-17-tagged',
    uc: 'UC-2',
    axes: { pdfVersion: '1.7', font: 'cff', tagged: true },
    steps: [
      {
        tool: 'create_text_pdf',
        args: { text: 'Tagged body text', title: 'Tagged', font: 'cff', tagged: true, lang: 'en' },
      },
    ],
  },
  {
    id: 'create-text-ttf-17-tagged',
    uc: 'UC-2',
    axes: { pdfVersion: '1.7', font: 'truetype', tagged: true },
    // W-2 の軸。TrueType の実体が無いので現状は unavailable として記録される
    requiresFont: 'truetype',
    steps: [
      {
        tool: 'create_text_pdf',
        args: { text: 'TrueType body', title: 'TTF', font: 'truetype', tagged: true, lang: 'en' },
      },
    ],
  },
  {
    id: 'create-markdown-cff-17-tagged',
    uc: 'UC-2',
    axes: { pdfVersion: '1.7', font: 'cff', tagged: true, content: 'markdown' },
    steps: [
      {
        tool: 'create_markdown_pdf',
        args: { markdown: MARKDOWN, title: 'MD', font: 'cff', tagged: true, lang: 'en' },
      },
    ],
  },
  {
    id: 'create-markdown-cff-20',
    uc: 'UC-2',
    // tagged + 2.0 は writer が意図的に拒否する（PDF/UA-1 は 1.7 基盤・UA-2 は未実装）。
    // その拒否自体は下の `refusals` で測る
    axes: { pdfVersion: '2.0', font: 'cff', tagged: false, content: 'markdown' },
    steps: [
      {
        tool: 'create_markdown_pdf',
        args: { markdown: MARKDOWN, title: 'MD20', font: 'cff', pdfVersion: '2.0' },
      },
    ],
  },
  {
    id: 'create-table-cff-17-tagged',
    uc: 'UC-2',
    axes: { pdfVersion: '1.7', font: 'cff', tagged: true, content: 'table' },
    steps: [
      {
        tool: 'create_table_pdf',
        args: {
          headers: ['date', 'item', 'amount'],
          rows: [
            ['2026-07-01', 'Item A', '800'],
            ['2026-07-02', 'Item B', '400'],
          ],
          title: 'Table',
          font: 'cff',
          tagged: true,
          lang: 'en',
        },
      },
    ],
  },

  // ---- B 群: 編集（A 群の出力を入力にする = 入力の xref 形式は writer 自身の形）
  {
    id: 'edit-merge',
    uc: 'UC-2',
    axes: { op: 'merge', font: 'cff' },
    steps: [
      {
        tool: 'merge_pdfs',
        args: { inputPaths: ['{{create-text-cff-17}}', '{{create-table-cff-17-tagged}}'] },
      },
    ],
  },
  {
    id: 'edit-page-ops',
    uc: 'UC-2',
    axes: { op: 'page-ops' },
    steps: [
      { tool: 'rotate_pages', args: { inputPath: '{{edit-merge}}', rotation: 90 } },
      { tool: 'reorder_pages', args: { inputPath: '{{prev}}', order: [2, 1] } },
      { tool: 'extract_pages', args: { inputPath: '{{prev}}', pages: '1' } },
    ],
  },
  {
    id: 'edit-watermark',
    uc: 'UC-2',
    axes: { op: 'watermark', font: 'cff' },
    steps: [
      {
        tool: 'add_watermark',
        args: { inputPath: '{{create-text-cff-17-tagged}}', text: 'DRAFT', font: 'cff' },
      },
    ],
  },
  {
    id: 'edit-page-numbers',
    uc: 'UC-2',
    axes: { op: 'page-number', font: 'cff' },
    steps: [
      {
        tool: 'stamp_page_numbers',
        args: { inputPath: '{{edit-merge}}', format: '{n} / {total}', font: 'cff' },
      },
    ],
  },
  {
    id: 'edit-bookmarks-annotation-metadata',
    uc: 'UC-2',
    axes: { op: 'doc-level' },
    steps: [
      {
        tool: 'add_bookmarks',
        args: {
          inputPath: '{{create-markdown-cff-17-tagged}}',
          bookmarks: [{ title: 'Top', page: 1 }],
        },
      },
      {
        tool: 'add_annotation',
        args: {
          inputPath: '{{prev}}',
          page: 1,
          type: 'text',
          rect: { x1: 72, y1: 700, x2: 300, y2: 720 },
          contents: 'review me',
          alt: 'review note',
        },
      },
      {
        tool: 'set_metadata',
        args: { inputPath: '{{prev}}', title: 'Reviewed', author: 'oracle' },
      },
    ],
  },

  // ---- C 群: 適合宣言（UC-4 の鎖）
  {
    id: 'conformance-attach-pdfa3b',
    uc: 'UC-4',
    axes: { attachment: true, flavour: 'pdfa-3b', font: 'cff', tagged: true },
    attachCsv: true,
    steps: [
      {
        tool: 'attach_file',
        args: {
          inputPath: '{{create-markdown-cff-17-tagged}}',
          attachmentPath: '{{csv}}',
          relationship: 'Data',
        },
      },
      { tool: 'ensure_pdfa', args: { inputPath: '{{prev}}', flavour: 'pdfa-3b' } },
    ],
    verify: [{ flavour: 'pdfa-3b', expect: 'compliant' }],
  },
  {
    id: 'conformance-attach-pdfa4f',
    uc: 'UC-4',
    axes: { attachment: true, flavour: 'pdfa-4f', pdfVersion: '2.0', font: 'cff', tagged: false },
    attachCsv: true,
    steps: [
      {
        tool: 'attach_file',
        args: {
          inputPath: '{{create-markdown-cff-20}}',
          attachmentPath: '{{csv}}',
          relationship: 'Data',
        },
      },
      { tool: 'ensure_pdfa', args: { inputPath: '{{prev}}', flavour: 'pdfa-4f' } },
    ],
    verify: [{ flavour: 'pdfa-4f', expect: 'compliant' }],
  },
  {
    id: 'conformance-attach-pdfa4-bare',
    uc: 'UC-4',
    axes: { attachment: true, flavour: 'pdfa-4', pdfVersion: '2.0', font: 'cff', tagged: false },
    attachCsv: true,
    steps: [
      {
        tool: 'attach_file',
        args: {
          inputPath: '{{create-markdown-cff-20}}',
          attachmentPath: '{{csv}}',
          relationship: 'Data',
        },
      },
      { tool: 'ensure_pdfa', args: { inputPath: '{{prev}}', flavour: 'pdfa-4' } },
    ],
    // 素の -4 は添付を許さない。**落ちることが正しい**検体（緑を作らない検体を 1 本入れる）
    verify: [{ flavour: 'pdfa-4', expect: 'non-compliant' }],
  },
  {
    id: 'conformance-ensure-tagged-ua1',
    uc: 'UC-2',
    axes: { tagged: 'repaired', font: 'cff', flavour: 'pdfua-1' },
    steps: [
      {
        tool: 'ensure_tagged',
        args: { inputPath: '{{create-text-cff-17}}', title: 'Repaired', lang: 'en' },
      },
    ],
    verify: [{ flavour: 'pdfua-1', expect: 'compliant' }],
  },
  {
    id: 'conformance-tagged-ua1',
    uc: 'UC-2',
    axes: { tagged: true, font: 'cff', flavour: 'pdfua-1' },
    steps: [{ tool: 'add_bookmarks', args: { inputPath: '{{create-markdown-cff-17-tagged}}', bookmarks: [{ title: 'Top', page: 1 }] } }],
    verify: [{ flavour: 'pdfua-1', expect: 'compliant' }],
  },

  // ---- D 群: フォーム
  {
    id: 'form-fill',
    uc: 'UC-2',
    axes: { form: 'fill', font: 'cff' },
    inputFile: () => join(here, 'inputs', 'form-basic.pdf'),
    steps: [
      {
        tool: 'fill_form',
        args: { inputPath: '{{input}}', fields: { 'user.name': '山田太郎', agree: true }, font: 'cff' },
      },
    ],
  },
  {
    id: 'form-tag-then-flatten',
    uc: 'UC-2',
    axes: { form: 'tag+flatten', font: 'cff' },
    inputFile: () => join(here, 'inputs', 'form-basic.pdf'),
    steps: [
      { tool: 'ensure_tagged', args: { inputPath: '{{input}}', title: 'Form', lang: 'en' } },
      {
        tool: 'tag_form_fields',
        args: { inputPath: '{{prev}}', labels: { 'user.name': 'Name', agree: 'Agree' } },
      },
      { tool: 'flatten_form', args: { inputPath: '{{prev}}', font: 'cff', allowBreakingTags: true } },
    ],
  },

  // ---- E 群: 入力ファイルの形（writer が作った形以外を食わせる）
  {
    id: 'input-origin-nonzero',
    uc: 'UC-2',
    // B-22 が生き延びた軸。origin > 0（%PDF- がファイル先頭に無い）
    axes: { origin: '>0', inputXref: 'table', pdfVersion: '2.0' },
    inputFile: () => pdf20('PDF 2.0 with offset start.pdf'),
    steps: [
      {
        tool: 'add_annotation',
        args: {
          inputPath: '{{input}}',
          page: 1,
          type: 'text',
          rect: { x1: 72, y1: 700, x2: 300, y2: 720 },
          contents: 'origin > 0',
        },
      },
    ],
  },
  {
    id: 'input-incremental-save',
    uc: 'UC-2',
    axes: { inputXref: 'chain', pdfVersion: '2.0' },
    inputFile: () => pdf20('PDF 2.0 via incremental save.pdf'),
    steps: [{ tool: 'set_metadata', args: { inputPath: '{{input}}', title: 'Chained' } }],
  },
  {
    id: 'input-signed-preserve',
    uc: 'UC-7',
    // 増分更新の経路。署名を壊さないことは verify 側で測る（下記 verifySignatures）
    axes: { signed: true, inputXref: 'stream', op: 'annotate' },
    inputFile: () => specimen('selfmade-pades-lta.pdf'),
    steps: [
      {
        tool: 'add_annotation',
        args: {
          inputPath: '{{input}}',
          page: 1,
          type: 'text',
          rect: { x1: 72, y1: 700, x2: 300, y2: 720 },
          contents: 'appended after signing',
          preserveSignatures: true,
        },
      },
    ],
    verifySignatures: { expectValid: 2 },
  },
  {
    id: 'input-signed-5sigs',
    uc: 'UC-7',
    axes: { signed: true, revisions: 8, op: 'annotate' },
    inputFile: () => specimen('dss-pades-5sigs-doctimestamp.pdf'),
    steps: [
      {
        tool: 'add_annotation',
        args: {
          inputPath: '{{input}}',
          page: 1,
          type: 'text',
          rect: { x1: 72, y1: 700, x2: 300, y2: 720 },
          contents: 'appended after signing',
          preserveSignatures: true,
        },
      },
    ],
    verifySignatures: { expectValid: 5 },
  },
];

/** 軸ごとに「何形あるか」を数える。1 形しか無い軸は測れていない */
export function axisCoverage(specimens = SPECIMENS) {
  const axes = new Map();
  for (const s of specimens) {
    for (const [k, v] of Object.entries(s.axes ?? {})) {
      if (!axes.has(k)) axes.set(k, new Map());
      const shapes = axes.get(k);
      shapes.set(String(v), (shapes.get(String(v)) ?? 0) + 1);
    }
  }
  return Object.fromEntries(
    [...axes].map(([k, shapes]) => [
      k,
      { shapes: Object.fromEntries([...shapes].sort()), distinct: shapes.size },
    ]),
  );
}
