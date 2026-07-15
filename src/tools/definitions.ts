/**
 * MCP Tool 定義（入力スキーマ）
 * 実装は handlers.ts、型は types/index.ts と対応させる。
 */

const commonProperties = {
  outputPath: {
    type: 'string',
    description: '保存先ファイルパス。省略した場合は base64 文字列を返す。',
  },
  returnBase64: {
    type: 'boolean',
    description: 'true の場合、保存に加えて base64 文字列も結果に含める。',
  },
  fontPath: {
    type: 'string',
    description:
      '埋め込むフォントファイル(.ttf / .otf)の絶対パス。日本語など非ラテン文字を含む場合は必須。' +
      '.ttc(TrueTypeCollection)は非対応。環境変数 PDF_WRITER_FONT でも指定可。',
  },
  fontSize: {
    type: 'number',
    description: '本文フォントサイズ(pt)。既定 11。範囲 4〜96。',
  },
  pageSize: {
    type: 'string',
    enum: ['A4', 'A3', 'A5', 'LETTER', 'LEGAL'],
    description: 'ページサイズ。既定 A4。',
  },
  margin: {
    type: 'number',
    description: '上下左右マージン(pt)。既定 56(≒20mm)。範囲 0〜300。',
  },
  title: {
    type: 'string',
    description: 'PDF タイトル。メタデータに設定し、本文冒頭にも見出しとして描画する。',
  },
  author: {
    type: 'string',
    description: 'PDF 作成者(メタデータ)。',
  },
} as const;

export const tools = [
  {
    name: 'create_text_pdf',
    description:
      'プレーンテキストから PDF を生成する。改行(\\n)を尊重し、空行を段落区切りとして扱う。長い行は自動で折り返す。',
    inputSchema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: '本文テキスト。\\n で改行、空行で段落区切り。',
        },
        ...commonProperties,
      },
      required: ['text'],
    },
  },
  {
    name: 'create_markdown_pdf',
    description:
      'Markdown から PDF を生成する。見出し・段落・箇条書き/番号リスト・コードブロック・引用・水平線・表に対応。' +
      'インライン装飾の記号は除去し字面のみ反映する(単一フォントのため)。',
    inputSchema: {
      type: 'object',
      properties: {
        markdown: {
          type: 'string',
          description: 'Markdown 文字列。',
        },
        ...commonProperties,
      },
      required: ['markdown'],
    },
  },
  {
    name: 'create_table_pdf',
    description:
      'ヘッダと行データから罫線付きの表 PDF を生成する。列幅は内容から自動算出し、セル内は折り返す。改ページ時はヘッダを再描画する。',
    inputSchema: {
      type: 'object',
      properties: {
        headers: {
          type: 'array',
          items: { type: 'string' },
          description: 'ヘッダ行(列見出し)の配列。',
        },
        rows: {
          type: 'array',
          items: { type: 'array', items: { type: 'string' } },
          description: 'データ行の配列。各行は文字列の配列で、headers と同じ列数を推奨。',
        },
        ...commonProperties,
      },
      required: ['headers', 'rows'],
    },
  },
] as const;
