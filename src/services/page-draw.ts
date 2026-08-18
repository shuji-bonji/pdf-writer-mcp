/**
 * 開いた文書のページへ描き足す —— Phase 3 の L4′.2（フォント組の受け皿）。
 *
 * `add_watermark` / `stamp_page_numbers` が使う。旧実装は pdf-lib の
 * `page.drawText` と `pushOperators` だった。
 *
 * | 要件 | 何を言っているか |
 * |---|---|
 * | R-7.7.3.3-22 / -23 | `/Contents` は単一ストリームか配列。配列は**連結して 1 本**として扱う |
 * | R-7.7.3.3-8 | ページに資源が要るなら `/Resources` は空でない辞書 |
 * | §9.4.1 | テキストは `BT` … `ET` で囲む |
 * | R-14.6.1-4 | `BMC` … `EMC` が marked-content の並びを囲む |
 * | §14.8.2.2 | 本文の意味を持たない描画は **Artifact**（PDF/UA-1 7.1-3） |
 *
 * 🔴 **既存の内容ストリームのバイト列には触らない。** 足すのは `/Contents` 配列の
 * 前か後ろに 1 本だけである（`ensure_tagged` と同じ判断・§3.20.2）。
 * 各ストリームが `q` … `Q` で自己完結しているので、前に置いても後ろに置いても
 * 既存の描画のグラフィックス状態は変わらない。
 */

import {
  COS_NULL,
  ContentStreamBuilder,
  type CosDict,
  type CosObject,
  type CosRef,
  dictGetRaw,
  type PageEntry,
  type PdfDocumentEditor,
} from 'normativepdf';
import { PdfWriterError } from '../errors.js';
import type { Rgb } from './color.js';
import { dict, name, num, real } from './cos.js';
import type { WriterFont } from './font-embed.js';

/** ページ資源に載せるときの名前。既存の名前とぶつからないものを選ぶ */
const FONT_KEY = 'PWMF0';
const GS_KEY = 'PWMGS0';

/**
 * 書き出す桁数。
 *
 * §7.3.3 は実数の桁を縛らず、Annex C Table C.1 が「IEEE 754 の単精度か倍精度」と
 * 言うだけである。だから JS の `String(value)` をそのまま書いても条文には反しない。
 * ただし `Math.cos(Math.PI / 2)` は 6.123233995736766e-17 になるので、丸めずに書くと
 * 90 度回転の行列が `0.00000000000000006123233995736766 1.0 -1.0 …` という並びになる。
 * 単精度の有効桁（約 7 桁）より下は読み手に届かないので、ここで落とす。
 *
 * 行列成分は無次元で絶対値 1 以下。6 桁なら 1000 pt の文字でも誤差 0.001 pt 未満。
 * 座標と大きさは pt なので 4 桁（0.0001 pt ＝ 約 0.000035 mm）で足りる。
 * 色成分は 0〜1 で、8 bit の階調（1/255 ≒ 0.0039）より細かい 5 桁にする。
 */
const MATRIX_DIGITS = 6;
const COORD_DIGITS = 4;
const COLOR_DIGITS = 5;

/** 指定桁で丸める。整数になったものは `num` が整数として書く（§7.3.3） */
function round(value: number, digits: number): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

export interface DrawTextOnPage {
  text: string;
  x: number;
  y: number;
  size: number;
  color: Rgb;
  /** 反時計回りの角度（度）。0 なら回さない */
  angle?: number;
  /** 0（透明）〜1（不透明）。1 未満のときだけ `/ExtGState` を作る */
  opacity?: number;
}

export interface DrawOptions {
  /** タグ付き文書なら Artifact で囲む（PDF/UA-1 7.1-3） */
  artifact: boolean;
  /** true なら既存の内容の**前**に置く（＝背面に敷く） */
  behind: boolean;
}

/**
 * ページに文字を 1 つ描き足す。
 *
 * 戻り値は書いた内容ストリームの参照（呼び出し側が数えられるように）。
 */
export async function drawTextOnPage(
  editor: PdfDocumentEditor,
  page: PageEntry,
  font: WriterFont,
  text: DrawTextOnPage,
  options: DrawOptions,
): Promise<CosRef> {
  if (page.ref === null) {
    throw new PdfWriterError(
      'this page is a direct object, so its content cannot be replaced (§7.7.3.3)',
      'INVALID_PDF',
    );
  }

  const content = new ContentStreamBuilder();
  const opacity = text.opacity ?? 1;

  // §14.8.2.2: 本文でない描画は Artifact。`BMC` は属性リストを持たない形（Table 352）
  if (options.artifact) content.op('BMC', name('Artifact'));

  content.op('q');
  if (opacity < 1) content.op('gs', name(GS_KEY));
  content.op('BT');
  content.op(
    'rg',
    num(round(text.color.r, COLOR_DIGITS)),
    num(round(text.color.g, COLOR_DIGITS)),
    num(round(text.color.b, COLOR_DIGITS)),
  );
  content.op('Tf', name(FONT_KEY), num(round(text.size, COORD_DIGITS)));
  // §9.4.2 Tm: 回転は行列で表す。角度 0 なら単位行列
  const radians = ((text.angle ?? 0) * Math.PI) / 180;
  const cos = round(Math.cos(radians), MATRIX_DIGITS);
  const sin = round(Math.sin(radians), MATRIX_DIGITS);
  content.op(
    'Tm',
    num(cos),
    num(sin),
    num(-sin),
    num(cos),
    num(round(text.x, COORD_DIGITS)),
    num(round(text.y, COORD_DIGITS)),
  );
  content.op('Tj', font.encode(text.text));
  content.op('ET');
  content.op('Q');
  if (options.artifact) content.op('EMC');

  const added = await editor.allocate({
    kind: 'stream',
    dict: dict([]),
    raw: content.finish(),
  });

  const entries = new Map<string, CosObject>(page.dict.entries);
  entries.set('Contents', await contentsWith(editor, page.dict, added, options.behind));
  entries.set('Resources', await resourcesWith(editor, page, font.ref, opacity));
  editor.set(page.ref.objectNumber, { kind: 'dict', entries }, page.ref.generationNumber);
  return added;
}

/** `/Contents` に 1 本足した配列を返す（前か後ろか）。 */
async function contentsWith(
  editor: PdfDocumentEditor,
  pageDict: CosDict,
  added: CosRef,
  behind: boolean,
): Promise<CosObject> {
  const raw = dictGetRaw(pageDict, 'Contents');
  let existing: readonly CosObject[] = [];
  if (raw !== undefined && raw.kind !== 'null') {
    const resolved = await editor.resolve(raw);
    if (resolved.kind === 'array') {
      existing = resolved.items;
    } else if (raw.kind === 'ref') {
      existing = [raw];
    } else {
      // 直接オブジェクトのストリーム（R-7.3.8.1-5 に反する形）。番号を与えてから並べる
      existing = [await editor.allocate(resolved)];
    }
  }
  const items = behind ? [added, ...existing] : [...existing, added];
  return { kind: 'array', items };
}

/**
 * `/Resources` にフォント（と必要なら `/ExtGState`）を載せた辞書を返す。
 *
 * 資源は §7.7.3.4 で祖先から継承される。ページ自身に `/Resources` を書くと
 * その継承は以後使われないので、**継承していた値をページに書き写してから**足す ——
 * そうしないと既存の内容ストリームが使っている資源名が解決できなくなる。
 */
async function resourcesWith(
  editor: PdfDocumentEditor,
  page: PageEntry,
  fontRef: CosRef,
  opacity: number,
): Promise<CosObject> {
  const raw = await editor.pageAttribute(page.index, 'Resources');
  const resolved = raw === undefined ? COS_NULL : await editor.resolve(raw);
  const entries = new Map<string, CosObject>(resolved.kind === 'dict' ? resolved.entries : []);

  const fonts = await editor.resolve(entries.get('Font') ?? COS_NULL);
  const fontEntries = new Map<string, CosObject>(fonts.kind === 'dict' ? fonts.entries : []);
  fontEntries.set(FONT_KEY, fontRef);
  entries.set('Font', { kind: 'dict', entries: fontEntries });

  if (opacity < 1) {
    const states = await editor.resolve(entries.get('ExtGState') ?? COS_NULL);
    const stateEntries = new Map<string, CosObject>(states.kind === 'dict' ? states.entries : []);
    // Table 57: `/ca` は塗り、`/CA` は線の alpha
    stateEntries.set(
      GS_KEY,
      dict([
        ['Type', name('ExtGState')],
        ['ca', real(opacity)],
        ['CA', real(opacity)],
      ]),
    );
    entries.set('ExtGState', { kind: 'dict', entries: stateEntries });
  }

  return { kind: 'dict', entries };
}
