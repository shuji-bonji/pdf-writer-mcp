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
  onMissingGlyph: {
    type: 'string',
    enum: ['error', 'replace', 'ignore'],
    description:
      'フォントに存在しない文字(例: Noto Sans JP に無い ✔ U+2714)の扱い。' +
      'error(既定)=欠落文字を列挙してエラー / replace=〓 に置換して警告 / ignore=空白のまま描画して警告。',
  },
  tagged: {
    type: 'boolean',
    description:
      'タグ付き PDF(PDF/UA-1・ISO 14289)として生成する。既定 false。' +
      'true にすると構造木・PDF/UA 宣言・/Lang・DisplayDocTitle を付与し、' +
      'スクリーンリーダで読める文書になる。PDF/UA はタイトルを要求するため title が必須。',
  },
  lang: {
    type: 'string',
    description:
      '文書の自然言語(BCP 47。例 "ja" / "en-US")。tagged 時に省略すると本文から推定し、' +
      '推定結果を warnings で報告する。誤った言語宣言はスクリーンリーダの誤読を招くため、' +
      '確実な場合は明示すること。',
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
    name: 'add_bookmarks',
    description:
      'PDF にしおり(アウトライン)を設定する。既存のしおりは置換される。children で入れ子にできる。',
    inputSchema: {
      type: 'object',
      properties: {
        inputPath: { type: 'string', description: '対象 PDF の絶対パス。' },
        bookmarks: {
          type: 'array',
          description:
            'しおりの配列。各要素は { title, page, open?, children? }。' +
            'page は 1 始まり。children で階層化でき、最大 8 階層・合計 2000 件まで。',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: '表示名。' },
              page: { type: 'number', description: '移動先ページ(1 始まり)。' },
              open: {
                type: 'boolean',
                description: '子項目を展開した状態で表示するか。既定 true。',
              },
              children: {
                type: 'array',
                description: '子しおりの配列(同じ形)。',
                items: { type: 'object' },
              },
            },
            required: ['title', 'page'],
          },
        },
        ...editCommonProperties,
      },
      required: ['inputPath', 'bookmarks'],
    },
  },
  {
    name: 'add_annotation',
    description:
      'ページに注釈を 1 つ追加する。付箋(text) / ハイライト(highlight) / 矩形(square) に対応。' +
      '座標は PDF 座標系(左下原点・pt)で指定する。',
    inputSchema: {
      type: 'object',
      properties: {
        inputPath: { type: 'string', description: '対象 PDF の絶対パス。' },
        page: { type: 'number', description: '対象ページ(1 始まり)。' },
        type: {
          type: 'string',
          enum: ['text', 'highlight', 'square'],
          description: 'text=付箋アイコン / highlight=ハイライト / square=矩形。',
        },
        rect: {
          type: 'object',
          description: '注釈の矩形。PDF 座標系(左下原点・pt)。x1<x2 かつ y1<y2 であること。',
          properties: {
            x1: { type: 'number' },
            y1: { type: 'number' },
            x2: { type: 'number' },
            y2: { type: 'number' },
          },
          required: ['x1', 'y1', 'x2', 'y2'],
        },
        contents: { type: 'string', description: '注釈の本文(日本語可)。' },
        author: { type: 'string', description: '作成者名。' },
        alt: {
          type: 'string',
          description:
            '支援技術向けの代替テキスト。タグ付き PDF では注釈が Annot 構造要素に内包される' +
            '(PDF/UA 7.18.1-1)ため、その要素の /Alt になる。タグ無し文書では無視される。',
        },
        color: {
          type: 'string',
          description:
            '#rrggbb 形式。既定は type ごと(text=#ffd400 / highlight=#ffff00 / square=#ff0000)。',
        },
        interiorColor: { type: 'string', description: 'square の塗り色(#rrggbb)。' },
        icon: {
          type: 'string',
          enum: ['Note', 'Comment', 'Key', 'Help', 'NewParagraph', 'Paragraph', 'Insert'],
          description: 'text のアイコン。既定 Note。',
        },
        open: { type: 'boolean', description: 'text を開いた状態にするか。既定 false。' },
        ...editCommonProperties,
      },
      required: ['inputPath', 'page', 'type', 'rect'],
    },
  },
  {
    name: 'attach_file',
    description:
      'PDF にファイルを埋め込む(添付する)。/Names /EmbeddedFiles と catalog /AF に登録し、' +
      'AFRelationship を付与する。PDF/A-3(ISO 19005-3)や電子帳簿保存法の文脈で、' +
      '「人が読む請求書 PDF + 機械可読データ(CSV/XML)」を 1 ファイルに束ねる用途に使う。',
    inputSchema: {
      type: 'object',
      properties: {
        inputPath: { type: 'string', description: '対象 PDF の絶対パス。' },
        attachmentPath: { type: 'string', description: '埋め込むファイルの絶対パス。' },
        name: {
          type: 'string',
          description: 'PDF 内での表示名。省略時は元のファイル名。既存の添付と同名にはできない。',
        },
        description: { type: 'string', description: '添付の説明(/Desc・日本語可)。' },
        mimeType: {
          type: 'string',
          description: 'MIME 型。省略時は拡張子から推定(例 .csv → text/csv)。',
        },
        relationship: {
          type: 'string',
          enum: ['Source', 'Data', 'Alternative', 'Supplement', 'Unspecified'],
          description:
            '本文との関係(PDF/A-3 §6.8)。Data=本文と同じ内容の機械可読データ(請求書の XML/CSV 等) / ' +
            'Source=本文の元データ / Alternative=代替表現 / Supplement=補足資料 / Unspecified=不明(既定)。' +
            'PDF/A-3 では意味のある値が必須のため、省略すると警告する。',
        },
        ...editCommonProperties,
      },
      required: ['inputPath', 'attachmentPath'],
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
