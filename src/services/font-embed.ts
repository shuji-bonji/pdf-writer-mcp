/**
 * フォントを文書に載せる入口 — Phase 3（pdf-lib 撤去）の L3'。
 *
 * §3.5 の受け皿表で ❌ だった 3 つのうちの 1 つ。normativepdf の `buildType0Font` は
 * **バイト列から辞書の型を導く**ところ（W-2 を表現不能にした部分）を持っているが、
 * その手前 —— どのグリフを使うか・何 unit 進むか・Unicode へどう戻すか —— は
 * フォントプログラムが持つ事実で、仕様の管轄ではない。L1.5 の決定
 * 「メトリクスは writer の関心」がそのままここに効く。
 *
 * 🔴 **標準 14 書体（§9.6.2.2）もここに来た。** 段取り表は L5'（メトリクス自前化）を
 * 最後に置いていたが、器が pdf-lib の `PDFDocument` でなくなると
 * `doc.embedFont('Helvetica')` が呼べない。幅は `@pdf-lib/standard-fonts` の AFM から
 * 直接取る（pdf-lib 本体には依存しない・同パッケージは AFM のデータだけを持つ）。
 *
 * **描画と測定を 1 つの型にまとめた。** L1.5 は `PDFFont` が描画（`drawText` の引数）と
 * 測定（`widthOfTextAtSize`）を兼ねていたのを用途で分けたが、それは
 * **描画が pdf-lib に残っている間の措置**だった。両方こちらに来たので、
 * `WriterFont` が `TextMetrics` を満たす形に畳み直す。
 */

import fontkit from '@pdf-lib/fontkit';
import { Font as AfmFont, type FontNames } from '@pdf-lib/standard-fonts';
import { buildType0Font, type CosObject, type CosRef, sniffFontProgram } from 'normativepdf';
import { PdfWriterError } from '../errors.js';
import { logger } from '../utils/logger.js';
import { arr, dict, hex, int, name, num, stream } from './cos.js';
import type { TextMetrics } from './metrics.js';
import { makeSubsetCharsetIdentity } from './sfnt-cff.js';
/**
 * このモジュールが文書に求めるのは「**同期に番号を配れること**」だけである。
 *
 * 生成パスの `WriterDocument` は自前の採番器でこれを満たす。編集パス（開いた文書）は
 * `PdfDocumentEditor.allocate` が非同期なので、**番号を先に確保した池**で満たす
 * （`font-pool.ts`）。型をここまで狭めておくと、器の違いがこのファイルに漏れない。
 */
export interface FontHost {
  allocate(object: CosObject): CosRef;
}

/**
 * 文書に載ったフォント。**描画に必要なものと測定に必要なものが 1 つに揃っている。**
 * `encode` が返すのは `Tj` の被演算子そのもので、符号化の違い
 * （標準フォントの 1 バイト / Identity-H の 2 バイト）は呼び出し側から見えない。
 */
export interface WriterFont extends TextMetrics {
  /** `/Resources /Font` に入れる参照 */
  readonly ref: CosRef;
  /** 表示用の名前（`CreateResult.font` に返る）。ファイル名なので拡張子を含む */
  readonly displayName: string;
  /**
   * フォントの PostScript 名（サブセットのタグは付かない）。
   * `/DA` と `/DR /Font` の資源名に使う（R-12.7.4.3-7）—— ここに
   * `displayName` を使うと `/NotoSansJP-Regular.otf` という資源名になる。
   */
  readonly postScriptName: string;
  /**
   * ベースラインより上（1000 単位のグリフ空間・§9.2.4）。
   * フォーム欄の縦位置を決めるのに要る（`acroform-layout.ts`）。
   */
  readonly ascent: number;
  /** ベースラインより下。**負**で持つ（§9.8.1 Table 122 の `/Descent` と同じ符号） */
  readonly descent: number;
  /** `Tj` に渡す文字列オブジェクト（§9.4.3） */
  encode(text: string): CosObject;
  widthOfTextAtSize(text: string, size: number): number;
}

// ---------------------------------------------------------------- 標準 14 書体

/**
 * §9.6.2.2 の標準 14 書体。**埋め込まない**ので PDF/A では必ず落ちる（writer は
 * それを警告として返している = B-21）。
 *
 * `/Encoding /WinAnsiEncoding` を明示するのは Table 109 の Encoding が Optional
 * だからで、省くとフォント固有の組み込み符号化になり、同じバイトが違う字を指す。
 */
export function embedStandardFont(doc: FontHost, postScriptName: string): WriterFont {
  const afm = AfmFont.load(postScriptName as FontNames);
  const ref = doc.allocate(
    dict([
      ['Type', name('Font')],
      ['Subtype', name('Type1')],
      ['BaseFont', name(postScriptName)],
      ['Encoding', name('WinAnsiEncoding')],
    ]),
  );

  return {
    ref,
    displayName: postScriptName,
    postScriptName,
    // AFM の Ascender / Descender は型上 void を含むので既定値で受ける（§9.2.4 の 1000 単位）
    ascent: typeof afm.Ascender === 'number' ? afm.Ascender : 750,
    descent: typeof afm.Descender === 'number' ? afm.Descender : -250,
    encode(text: string): CosObject {
      // WinAnsi は 1 文字 1 バイト。範囲外は `assertRenderable`（renderers/text.ts）が
      // 先に弾いているので、ここに来る文字列は Latin-1 に収まっている。
      const bytes = new Uint8Array(text.length);
      for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i) & 0xff;
      return hex(bytes);
    },
    widthOfTextAtSize(text: string, size: number): number {
      let total = 0;
      for (const ch of text) total += afm.getWidthOfGlyph(ch) ?? 0;
      // AFM は 1000 単位のグリフ空間（§9.2.4）。pt へ戻す
      return (total * size) / 1000;
    },
  };
}

// ---------------------------------------------------------------- 埋め込みフォント

/**
 * 1000 単位のグリフ空間（§9.2.4）へ揃える。TrueType は unitsPerEm が 2048 のことが多い。
 *
 * ⚠️ **丸めない。** Table 122 の記述子の値は number であって整数ではなく、
 * unitsPerEm が 1000 でないフォント（Liberation Sans = 2048）では
 * `1854 × 1000 / 2048 = 905.2734375` のように端数が出る。旧実装はこの値を
 * そのまま書いていた。丸める理由が無いのに丸めると、**差分オラクルに
 * 「意図した差」でない差が出る**（実測: Ascent / Descent / CapHeight / FontBBox の 6 行）。
 */
const scaled = (value: number, unitsPerEm: number): number => (value * 1000) / unitsPerEm;

/**
 * ⚠️ **幅も丸めない。**
 *
 * 一度 `Math.round` を入れて「旧実装の出力が整数だから」と書いたが、それは
 * unitsPerEm が 1000 のフォント（Noto Sans JP）しか見ていなかった。2048 の
 * Liberation Sans では旧実装は `365.2344` のような値をそのまま書いており、
 * `/W`（R-9.7.4.3-3）も Table 115 も number であって整数ではない。
 *
 * 🔴 **この差は最初から出ていた。** 差分オラクルの表示が 1 検体あたり打ち切られるため、
 * 記述子の丸めを直して 6 行が消えるまで `/W` の行が見えなかった。
 * **「差 6 行」を「差 6 個」と読まないこと。**
 */
const scaledWidth = scaled;

/**
 * サブセット済みのフォントプログラムを埋め込む。
 *
 * サブセットは呼び出し側（`font-manager.ts` の harfbuzz）が済ませている。
 * ここがするのは「その **バイト列から**辞書を組む」ことだけで、
 * CIDFont の `/Subtype` と `/FontFile*` の対応は `buildType0Font` が
 * `sniffFontProgram` の結果から決める —— **呼び出し側は名指しできない**（W-2 の再発防止）。
 */
export function embedFontProgram(
  doc: FontHost,
  programBytes: Uint8Array,
  displayName: string,
): { font: WriterFont; notes: readonly string[] } {
  // 🔴 CID-keyed CFF を harfbuzz でサブセットすると、charset は「新 GID → **元の CID**」の
  // ままになる。CIDFontType0 のグリフ選択は CID → charset → GID（R-9.7.4.2-4）なので、
  // Identity-H で CID = GID を書くこちらとは噛み合わず、条文どおりに解決する処理系が
  // 別のグリフを描く。バイト列を触る仕事なので `buildType0Font`（辞書をバイト列から
  // 導く）では代われない —— 旧実装が `normalizeEmbeddedFonts` の中でやっていた是正の
  // うち、**この 1 つだけは生成パスにも要る**。
  //
  // ⚠️ 寛容なビューアでは気づけない（poppler は正しく描画した）。W-2 と同じ死角。
  if (makeSubsetCharsetIdentity(programBytes)) {
    logger.info(
      'FontManager',
      `Rewrote the CFF charset of ${displayName} to identity (R-9.7.4.2-4)`,
    );
  }

  let fk: ReturnType<typeof fontkit.create>;
  try {
    fk = fontkit.create(Buffer.from(programBytes));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PdfWriterError(`Failed to read font ${displayName}: ${message}`, 'INTERNAL_ERROR');
  }

  const unitsPerEm = fk.unitsPerEm;
  const numGlyphs = fk.numGlyphs;
  const advance = (gid: number): number => {
    try {
      return scaledWidth(fk.getGlyph(gid).advanceWidth, unitsPerEm);
    } catch {
      // グリフが読めないことは「幅が 0」ではない。/DW の既定（1000・§9.7.4.3）へ倒す
      return 1000;
    }
  };

  // --- /W（R-9.7.4.3-3）。CID 0 から連続 1 本で書く。
  // 使ったグリフだけに絞らないのは、サブセット済みのプログラムに入っているグリフは
  // 全部「このファイルが使うもの」だからで、絞ると 2 つの真実（プログラムと /W）ができる。
  const widths: CosObject[] = [];
  for (let gid = 0; gid < numGlyphs; gid += 1) widths.push(num(advance(gid)));

  const descriptor = new Map<string, CosObject>([
    // Table 121 bit 3 = Symbolic。Identity-H は標準的な文字集合に載らないので
    // Nonsymbolic とは言えない（旧実装も同じ値を書いていた）
    ['Flags', int(4)],
    [
      'FontBBox',
      arr([
        num(scaled(fk.bbox.minX, unitsPerEm)),
        num(scaled(fk.bbox.minY, unitsPerEm)),
        num(scaled(fk.bbox.maxX, unitsPerEm)),
        num(scaled(fk.bbox.maxY, unitsPerEm)),
      ]),
    ],
    ['ItalicAngle', int(Math.round(fk.italicAngle ?? 0))],
    ['Ascent', num(scaled(fk.ascent, unitsPerEm))],
    ['Descent', num(scaled(fk.descent, unitsPerEm))],
    ['CapHeight', num(scaled(fk.capHeight ?? fk.ascent, unitsPerEm))],
    // Table 122 は StemV を Required にしているが、値は測れない（グリフの
    // 主要縦ステムの太さで、フォントプログラムに宣言が無い）。0 を書くのは
    // 「測っていない」を意味する慣行で、旧実装も同じだった。
    ['StemV', int(0)],
  ]);
  const xHeight = fk.xHeight;
  if (xHeight) descriptor.set('XHeight', num(scaled(xHeight, unitsPerEm)));

  const built = buildType0Font(
    { allocate: (object: CosObject): CosRef => doc.allocate(object) },
    {
      program: sniffFontProgram(programBytes),
      postScriptName: fk.postscriptName ?? displayName.replace(/\.[^.]+$/, ''),
      descriptor,
      widths: arr([int(0), arr(widths)]),
      toUnicode: buildToUnicode(doc, fk),
    },
  );

  const font: WriterFont = {
    ref: built.font,
    displayName,
    postScriptName: fk.postscriptName ?? displayName.replace(/\.[^.]+$/, ''),
    ascent: scaled(fk.ascent, unitsPerEm),
    descent: scaled(fk.descent, unitsPerEm),
    encode(text: string): CosObject {
      const glyphs = fk.layout(text).glyphs;
      const bytes = new Uint8Array(glyphs.length * 2);
      for (let i = 0; i < glyphs.length; i += 1) {
        const id = glyphs[i]?.id ?? 0;
        bytes[i * 2] = (id >> 8) & 0xff;
        bytes[i * 2 + 1] = id & 0xff;
      }
      return hex(bytes);
    },
    widthOfTextAtSize(text: string, size: number): number {
      let total = 0;
      for (const glyph of fk.layout(text).glyphs) {
        total += scaledWidth(glyph.advanceWidth, unitsPerEm);
      }
      return (total * size) / 1000;
    },
  };

  const notes = built.notes.map(
    (note: { clause: string; message: string }) => `${note.clause}: ${note.message}`,
  );
  return { font, notes };
}

/**
 * `/ToUnicode` CMap（§9.10.3）。
 *
 * これが無いとテキスト抽出が成り立たない —— Identity-H の被演算子はグリフ番号であって
 * 文字ではないので、**読み手にはこの表以外に戻す手段が無い**。
 *
 * ⚠️ 出所は**サブセット後のプログラムの cmap** である。`font-manager.ts` が
 * `noLayoutClosure: true` でサブセットしているのは、まさにここを一致させるため
 * （GSUB の字形置換が起きると、描画に使う GID と cmap 由来の GID が食い違って
 * 数字が化ける）。片方だけ変えると抽出が静かに壊れる。
 */
function buildToUnicode(doc: FontHost, fk: ReturnType<typeof fontkit.create>): CosRef {
  const mapping = new Map<number, number[]>();
  for (const codePoint of fk.characterSet) {
    let gid: number;
    try {
      gid = fk.glyphForCodePoint(codePoint).id;
    } catch {
      continue;
    }
    if (gid === 0) continue;
    const existing = mapping.get(gid);
    // 複数の符号位置が同じグリフに落ちることはある。最初のものを採る ——
    // 抽出は 1 つに決めるしかなく、後勝ちにすると順序で結果が変わる
    if (existing === undefined) mapping.set(gid, [codePoint]);
  }

  const utf16be = (codePoint: number): string => {
    if (codePoint > 0xffff) {
      const v = codePoint - 0x10000;
      return (
        (0xd800 + (v >> 10)).toString(16).padStart(4, '0') +
        (0xdc00 + (v & 0x3ff)).toString(16).padStart(4, '0')
      ).toUpperCase();
    }
    return codePoint.toString(16).padStart(4, '0').toUpperCase();
  };

  const entries = [...mapping.entries()].sort((a, b) => a[0] - b[0]);
  const lines: string[] = [
    '/CIDInit /ProcSet findresource begin',
    '12 dict begin',
    'begincmap',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
    '/CMapName /Adobe-Identity-UCS def',
    '/CMapType 2 def',
    '1 begincodespacerange',
    '<0000> <FFFF>',
    'endcodespacerange',
  ];
  // §9.10.3: bfchar / bfrange は 1 節あたり 100 件まで
  for (let i = 0; i < entries.length; i += 100) {
    const chunk = entries.slice(i, i + 100);
    lines.push(`${chunk.length} beginbfchar`);
    for (const [gid, codePoints] of chunk) {
      const to = codePoints.map(utf16be).join('');
      lines.push(`<${gid.toString(16).padStart(4, '0').toUpperCase()}> <${to}>`);
    }
    lines.push('endbfchar');
  }
  lines.push('endcmap', 'CMapName currentdict /CMap defineresource pop', 'end', 'end', '');

  return doc.allocate(stream([], new TextEncoder().encode(lines.join('\n'))));
}
