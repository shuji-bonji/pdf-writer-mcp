/**
 * 生成パスの器 — Phase 3（pdf-lib 撤去）の L3'。
 *
 * **何をここに置き、何を置かないか。**
 * ADR-0007 §1 は文書モデルを 3 つに割り、(a) グラフ容器と (b) ページツリーの意味規定を
 * normativepdf に、(c) オーサリング API を writer に置いた。このファイルが (c) である。
 * `PdfDocumentEditor.create()`（2026-08-14 に (a) へ足した空からの入口）を包み、
 * 「ページを足す・そこに描く」という writer だけの関心を載せる。
 *
 * **番号は writer が持つ。** `PdfDocumentEditor.allocate` は非同期である
 * （初回に全参照を走査して、定義の無い番号を配らないようにする）。空から作った文書には
 * 走査すべき参照が無く、一方 `StructObjectSink.reserve()` と `FontObjectSink.allocate()` は
 * **同期**を要求する。だからここでは自前の採番器を持ち、
 * **`editor.allocate()` は呼ばない** — 2 つの採番器が同じ文書に対して動くと、
 * どちらも相手の配った番号を知らないまま重複を配る。
 * 下限は `PdfDocumentEditor.rootPagesRef` の次（= 3）で、これは create() が
 * catalog に 1・根ノードに 2 を使うと決めていることに従う。
 *
 * **ページの同一性。** 旧実装は `PDFPage` オブジェクトそのものを `Map` の鍵にしていた
 * （`struct-tree.ts` の 3 つの Map）。COS には同一性が無いので、ここでは `WriterPage`
 * インスタンスが鍵を担い、その `ref` が文書内の住所を担う。**2 つを混ぜない** ——
 * `ref` を鍵にすると、まだ書かれていないページを指せなくなる。
 */

import {
  ContentStreamBuilder,
  type CosObject,
  type CosRef,
  PdfDocumentEditor,
  type TaggedStream,
  type WriteFileOptions,
} from 'normativepdf';
import type { Rgb } from './color.js';
import { arr, dict, int, name, num, rect, stream } from './cos.js';
import type { WriterFont } from './font-embed.js';

/** `drawText` の引数。**旧実装（pdf-lib の `PDFPage.drawText`）と同じ形にしてある** */
export interface DrawTextArgs {
  x: number;
  y: number;
  size: number;
  font: WriterFont;
  color: Rgb;
  /** `TL` に書く行送り。旧実装は既定 24 を常に書いていたので、既定値もそれに合わせる */
  lineHeight?: number;
}

export interface DrawRectangleArgs {
  x: number;
  y: number;
  width: number;
  height: number;
  /** 塗り色。省略すると塗らない */
  color?: Rgb;
  /** 線色。省略すると描かない */
  borderColor?: Rgb;
  borderWidth?: number;
}

export interface DrawLineArgs {
  start: { x: number; y: number };
  end: { x: number; y: number };
  thickness?: number;
  color?: Rgb;
}

export class WriterPage {
  /** ページ辞書の住所。構造木の `/Pg`・注釈の `/P` が指す先 */
  readonly ref: CosRef;
  readonly width: number;
  readonly height: number;

  /** リソース名 → フォント。**1 フォント 1 エントリ**（下記） */
  readonly #fonts = new Map<string, WriterFont>();
  readonly #content = new ContentStreamBuilder();
  /** タグ付き生成のときだけ立つ。`markContent` / `markArtifact` がここへ書く */
  #tagged: TaggedStream | null = null;

  /** @internal */
  constructor(ref: CosRef, width: number, height: number) {
    this.ref = ref;
    this.width = width;
    this.height = height;
  }

  /** @internal タグ付き生成の宛先を差し込む（`StructTreeBuilder` が作る） */
  attachTaggedStream(tagged: TaggedStream): void {
    this.#tagged = tagged;
  }

  /** @internal */
  get taggedStream(): TaggedStream | null {
    return this.#tagged;
  }

  /** @internal 現在の書き込み先。タグ付きなら構造木が持つビルダと同じ実体 */
  get content(): ContentStreamBuilder {
    return this.#tagged?.content ?? this.#content;
  }

  /**
   * フォントをこのページのリソースに載せ、`Tf` に書く名前を返す。
   *
   * 🔴 **同じフォントは 1 エントリにまとめる。** 旧実装（pdf-lib）は `drawText` の
   * たびに `setFont` を通り、そのたびに乱数サフィックス付きの新しい鍵を作っていた
   * （実測: 1 ページの見出し + 本文で `/NotoSansJP-Regular-7098480789` と
   * `-9742682568` の 2 エントリが同じフォントを指す）。同じものに違う名前を配ると、
   * 読み手はそれが同じフォントだと**ファイルからは分からない**。
   */
  fontResource(font: WriterFont): string {
    for (const [key, known] of this.#fonts) {
      if (known === font) return key;
    }
    const key = `F${this.#fonts.size + 1}`;
    this.#fonts.set(key, font);
    return key;
  }

  // ------------------------------------------------------------------ 描画

  /**
   * §9.4 のテキストオブジェクト 1 つ。
   *
   * 演算子の並びは旧実装と同じにしてある（`q BT rg Tf TL Tm Tj T* ET Q`）。
   * 意味の無い並びを真似しているのではなく、**この並びがそのまま §9.4.1 の
   * 「BT で始まり ET で終わる」形**だからで、差分オラクルの読みやすさは副産物である。
   * 文脈検査は `ContentStreamBuilder` が持つので、`Tj` を `BT` の外に書くことはできない。
   */
  drawText(text: string, options: DrawTextArgs): void {
    const key = this.fontResource(options.font);
    const c = this.content;
    c.op('q');
    c.op('BT');
    c.op('rg', num(options.color.r), num(options.color.g), num(options.color.b));
    c.op('Tf', name(key), num(options.size));
    c.op('TL', num(options.lineHeight ?? DEFAULT_LEADING));
    c.op('Tm', int(1), int(0), int(0), int(1), num(options.x), num(options.y));
    c.op('Tj', options.font.encode(text));
    c.op('T*');
    c.op('ET');
    c.op('Q');
  }

  /**
   * 矩形（§8.5.2 `re` + §8.5.3 の塗り／線）。
   *
   * ⚠️ **旧実装との意図した差**: pdf-lib は `translate → rotate(0) → skew(0)` の
   * `cm` を 3 つ書いてから `m`/`l` を 4 本並べていた。回転も傾斜も無い矩形に
   * 単位行列の `cm` を 2 つ書くのは、**何もしない演算子**である。
   * `re`（Table 58）が同じ図形を 1 演算子で表すので、そちらを書く。
   */
  drawRectangle(options: DrawRectangleArgs): void {
    const { color, borderColor } = options;
    const borderWidth = options.borderWidth ?? 0;
    if (color === undefined && borderColor === undefined) return;

    const c = this.content;
    c.op('q');
    if (color !== undefined) c.op('rg', num(color.r), num(color.g), num(color.b));
    if (borderColor !== undefined) {
      c.op('RG', num(borderColor.r), num(borderColor.g), num(borderColor.b));
      c.op('w', num(borderWidth));
    }
    c.op('re', num(options.x), num(options.y), num(options.width), num(options.height));
    // Table 59。塗りと線の両方があるなら B（塗ってから描く）
    if (color !== undefined && borderColor !== undefined) c.op('B');
    else if (color !== undefined) c.op('f');
    else c.op('S');
    c.op('Q');
  }

  /** 直線（§8.5.2 `m`/`l` + §8.5.3 `S`）。 */
  drawLine(options: DrawLineArgs): void {
    const c = this.content;
    c.op('q');
    if (options.color !== undefined) {
      c.op('RG', num(options.color.r), num(options.color.g), num(options.color.b));
    }
    c.op('w', num(options.thickness ?? 1));
    c.op('m', num(options.start.x), num(options.start.y));
    c.op('l', num(options.end.x), num(options.end.y));
    c.op('S');
    c.op('Q');
  }

  /** @internal リソース辞書の `/Font`。空でも辞書は置く（R-7.7.3.3-8） */
  fontEntries(): ReadonlyMap<string, WriterFont> {
    return this.#fonts;
  }
}

/** 旧実装が `TL` に常に書いていた値。§9.3.5 の行送りで、既定が無いので明示する */
const DEFAULT_LEADING = 24;

export class WriterDocument {
  readonly editor: PdfDocumentEditor;
  readonly #pages: WriterPage[] = [];
  /** 次に配る番号。create() が 1（catalog）と 2（根ノード）を使っている */
  #next = PdfDocumentEditor.rootPagesRef.objectNumber + 1;
  /** ページごとの `/StructParents`。構造木を閉じたあとに書き込む */
  readonly #structParents = new Map<WriterPage, number>();

  private constructor(editor: PdfDocumentEditor) {
    this.editor = editor;
  }

  static create(version: string): WriterDocument {
    return new WriterDocument(PdfDocumentEditor.create({ version }));
  }

  /**
   * 番号を予約する（中身はまだ無い）。構造木のように `/P` が上を・`/K` が下を指す
   * 循環したグラフは、どちらかの端が「まだ存在しないもの」を名指す必要がある。
   */
  reserve(): CosRef {
    const objectNumber = this.#next;
    this.#next += 1;
    return { kind: 'ref', objectNumber, generationNumber: 0 };
  }

  /** 予約済みの番号に中身を入れる。 */
  write(target: CosRef, object: CosObject): void {
    this.editor.set(target.objectNumber, object, target.generationNumber);
  }

  /** 予約して同時に書く。 */
  allocate(object: CosObject): CosRef {
    const target = this.reserve();
    this.write(target, object);
    return target;
  }

  get pages(): readonly WriterPage[] {
    return this.#pages;
  }

  /**
   * ページを 1 枚足す。
   *
   * `/Count` はここでは触らない —— R-7.7.3.2-8 を writer の義務と名指したうえで
   * **導出値として再計算する**のは `PdfDocumentEditor.save()` の仕事である
   * （ADR-0007 §6）。ここで数えると、数え手が 2 つになる。
   */
  addPage(width: number, height: number): WriterPage {
    const page = new WriterPage(this.reserve(), width, height);
    this.#pages.push(page);
    return page;
  }

  /** @internal 構造木が決めた `/StructParents` を控える（ページ辞書を組むのは save 時） */
  setStructParents(page: WriterPage, key: number): void {
    this.#structParents.set(page, key);
  }

  /** catalog に足す（`/StructTreeRoot`・`/MarkInfo`・`/Lang` など）。 */
  async updateCatalog(entries: Iterable<readonly [string, CosObject]>): Promise<void> {
    const catalog = await this.editor.getCatalog();
    if (catalog.kind !== 'dict') {
      throw new Error('the catalog of a created document shall be a dictionary (§7.7.2 Table 29)');
    }
    const merged = new Map(catalog.entries);
    for (const [key, value] of entries) merged.set(key, value);
    this.editor.set(PdfDocumentEditor.catalogRef.objectNumber, {
      kind: 'dict',
      entries: merged,
    });
  }

  /**
   * ページ辞書とコンテンツストリームを書き出し、根ノードの `/Kids` を繋いでから直列化する。
   *
   * `/Contents` は**配列にしない**。R-7.7.3.3-26 は空の配列を禁じており、
   * 1 本しかないストリームを 1 要素の配列で包む理由が無い（Table 31 は
   * ストリームそのものも許す）。
   */
  async save(
    options: WriteFileOptions & {
      /**
       * トレーラに載せるエントリ（§7.5.5 Table 15）。`/Info` と `/ID` はここに来る ——
       * 何も無いところから作る文書は両方を自分で書くしかなく、`/ID` は PDF 2.0 で
       * Required である（normativepdf 0.5.0 の `setTrailerEntry`）。
       */
      readonly trailer?: Iterable<readonly [string, CosObject]>;
    } = {},
  ): Promise<Uint8Array> {
    const { trailer, ...writeOptions } = options;
    for (const [key, value] of trailer ?? []) {
      this.editor.setTrailerEntry(key, value);
    }
    const kids: CosObject[] = [];
    for (const page of this.#pages) {
      const contents = this.allocate(stream([], page.content.finish()));

      const fonts = page.fontEntries();
      const fontDict = dict([...fonts].map(([key, font]) => [key, font.ref] as const));
      const entries: [string, CosObject][] = [
        ['Type', name('Page')],
        ['Parent', PdfDocumentEditor.rootPagesRef],
        ['MediaBox', rect(0, 0, page.width, page.height)],
        // R-7.7.3.3-8: リソースが不要でも値は空辞書とする（省略ではない）
        ['Resources', dict([['Font', fontDict]])],
        ['Contents', contents],
      ];
      const key = this.#structParents.get(page);
      if (key !== undefined) entries.push(['StructParents', int(key)]);

      this.write(page.ref, dict(entries));
      kids.push(page.ref);
    }

    this.editor.set(PdfDocumentEditor.rootPagesRef.objectNumber, {
      kind: 'dict',
      entries: new Map<string, CosObject>([
        ['Type', name('Pages')],
        ['Kids', arr(kids)],
        // 入力として置くだけ。正しい値は save が R-7.7.3.2-8 に従って入れ直す
        ['Count', int(this.#pages.length)],
      ]),
    });

    return this.editor.save(writeOptions);
  }
}
