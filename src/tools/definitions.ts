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

const editCommonProperties = {
  outputPath: {
    type: 'string',
    description: '保存先ファイルパス。省略した場合は base64 文字列を返す。',
  },
  returnBase64: {
    type: 'boolean',
    description: 'true の場合、保存に加えて base64 文字列も結果に含める。',
  },
  allowBreakingSignatures: {
    type: 'boolean',
    description:
      '編集対象が電子署名済み(/ByteRange 検知)の場合、既定ではエラーにする。' +
      'true を指定すると署名が無効化されることを承知の上で編集を続行する。',
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
  {
    name: 'set_metadata',
    description:
      '既存 PDF のメタデータ(Info 辞書)を更新する。指定したフィールドのみ変更し、他は保持する。' +
      'title / author / subject / keywords / creator のうち最低 1 つが必要。',
    inputSchema: {
      type: 'object',
      properties: {
        inputPath: { type: 'string', description: '編集対象 PDF の絶対パス。' },
        title: { type: 'string', description: 'タイトル。' },
        author: { type: 'string', description: '作成者。' },
        subject: { type: 'string', description: 'サブタイトル・件名。' },
        keywords: {
          type: 'array',
          items: { type: 'string' },
          description: 'キーワードの配列。',
        },
        creator: { type: 'string', description: '作成アプリケーション名。' },
        ...editCommonProperties,
      },
      required: ['inputPath'],
    },
  },
  {
    name: 'merge_pdfs',
    description: '複数の PDF を指定順に 1 つへ結合する。文書メタデータは先頭ファイルから引き継ぐ。',
    inputSchema: {
      type: 'object',
      properties: {
        inputPaths: {
          type: 'array',
          items: { type: 'string' },
          description: '結合する PDF の絶対パスの配列(結合順・2 件以上)。',
        },
        ...editCommonProperties,
      },
      required: ['inputPaths'],
    },
  },
  {
    name: 'split_pdf',
    description:
      'PDF をページ範囲ごとに複数ファイルへ分割する。ranges の各要素が 1 ファイルになる。' +
      '出力は "<prefix>1.pdf", "<prefix>2.pdf", ... の連番。',
    inputSchema: {
      type: 'object',
      properties: {
        inputPath: { type: 'string', description: '分割対象 PDF の絶対パス。' },
        ranges: {
          type: 'array',
          items: { type: 'string' },
          description:
            'ページ範囲指定の配列。各要素は "1-3" / "5" / "7-" / "-2" 形式(1 始まり)。例: ["1-3", "4-"]。',
        },
        outputDir: { type: 'string', description: '出力先ディレクトリ。' },
        prefix: {
          type: 'string',
          description: '出力ファイル名の接頭辞。既定は "<入力ファイル名>-part"。',
        },
        allowBreakingSignatures: editCommonProperties.allowBreakingSignatures,
      },
      required: ['inputPath', 'ranges', 'outputDir'],
    },
  },
  {
    name: 'extract_pages',
    description:
      '指定ページだけを含む新しい PDF を作る。指定順を保持するため、ページの並べ替えを兼ねた抽出も可能。',
    inputSchema: {
      type: 'object',
      properties: {
        inputPath: { type: 'string', description: '対象 PDF の絶対パス。' },
        pages: {
          type: 'string',
          description: 'ページ指定。"1,3-5,8-" 形式(1 始まり)。指定順が出力順になる。',
        },
        ...editCommonProperties,
      },
      required: ['inputPath', 'pages'],
    },
  },
  {
    name: 'delete_pages',
    description: '指定ページを削除した新しい PDF を作る。全ページの削除はエラー。',
    inputSchema: {
      type: 'object',
      properties: {
        inputPath: { type: 'string', description: '対象 PDF の絶対パス。' },
        pages: {
          type: 'string',
          description: '削除するページ指定。"1,3-5,8-" 形式(1 始まり)。',
        },
        ...editCommonProperties,
      },
      required: ['inputPath', 'pages'],
    },
  },
  {
    name: 'reorder_pages',
    description: 'ページを並べ替える。order には全ページを新しい順序で 1 回ずつ列挙する。',
    inputSchema: {
      type: 'object',
      properties: {
        inputPath: { type: 'string', description: '対象 PDF の絶対パス。' },
        order: {
          type: 'array',
          items: { type: 'number' },
          description: '新しいページ順(1 始まり)。例: 5 ページの逆順は [5,4,3,2,1]。',
        },
        ...editCommonProperties,
      },
      required: ['inputPath', 'order'],
    },
  },
  {
    name: 'rotate_pages',
    description: 'ページを時計回りに回転する(90/180/270 度)。pages 省略時は全ページ。',
    inputSchema: {
      type: 'object',
      properties: {
        inputPath: { type: 'string', description: '対象 PDF の絶対パス。' },
        rotation: {
          type: 'number',
          enum: [90, 180, 270],
          description: '時計回りの回転角(度)。',
        },
        pages: {
          type: 'string',
          description: '対象ページ指定。"1,3-5" 形式(1 始まり)。省略時は全ページ。',
        },
        ...editCommonProperties,
      },
      required: ['inputPath', 'rotation'],
    },
  },
] as const;
