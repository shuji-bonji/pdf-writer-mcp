/**
 * Structure tree — appending to an existing tree.
 *
 * StructTreeBuilder（services/struct-tree.ts）は「ゼロから構築する」担当。
 * こちらは**既にタグ付けされた PDF を読み込み、要素を追記する**担当で、
 * 編集系ツール（add_annotation 等）が使う。
 *
 * PDF/UA-1 の該当要件:
 *   - 7.18.1-1: Widget / PrinterMark / Link 以外の注釈は Annot タグに内包する
 *   - 7.18.3-1: 注釈のあるページは /Tabs を /S にする
 *
 * ParentTree（§14.7.4.4）は「キー昇順の番号ツリー」であり、追記には
 *   1. /ParentTreeNextKey から次のキーを取る
 *   2. /Nums に [key, value] を**昇順を保って**挿入する
 *   3. 注釈側に /StructParent（単数形）で同じキーを書く
 * が要る。ページの /StructParents（複数形）とはキー空間を共有する別物なので注意。
 */

import {
  PDFArray,
  PDFDict,
  type PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  type PDFPage,
  type PDFRef,
} from 'pdf-lib';

/** 既にタグ付けされた文書か（StructTreeRoot と MarkInfo/Marked の両方が要る） */
export function isTagged(doc: PDFDocument): boolean {
  const root = doc.catalog.lookup(PDFName.of('StructTreeRoot'));
  if (!(root instanceof PDFDict)) return false;
  const markInfo = doc.catalog.lookup(PDFName.of('MarkInfo'));
  if (!(markInfo instanceof PDFDict)) return false;
  const marked = markInfo.lookup(PDFName.of('Marked'));
  return marked?.toString() === 'true';
}

function structTreeRoot(doc: PDFDocument): PDFDict | null {
  const root = doc.catalog.lookup(PDFName.of('StructTreeRoot'));
  return root instanceof PDFDict ? root : null;
}

/**
 * ParentTree の /Nums を得る。
 * 番号ツリーは /Kids で分割されることもあるが、本サーバが書く木も一般的な生成物も
 * 平坦な /Nums なので、そこだけを対象にする（/Kids 形式なら null を返す）。
 */
function parentTreeNums(root: PDFDict): PDFArray | null {
  const pt = root.lookup(PDFName.of('ParentTree'));
  if (!(pt instanceof PDFDict)) return null;
  const nums = pt.lookup(PDFName.of('Nums'));
  return nums instanceof PDFArray ? nums : null;
}

/** 次に使える ParentTree キーを取る（/ParentTreeNextKey が無ければ実データから算出） */
function nextParentTreeKey(root: PDFDict): number {
  const declared = root.lookup(PDFName.of('ParentTreeNextKey'));
  if (declared instanceof PDFNumber) return declared.asNumber();

  const nums = parentTreeNums(root);
  if (!nums) return 0;
  let max = -1;
  for (let i = 0; i < nums.size(); i += 2) {
    const key = nums.lookup(i);
    if (key instanceof PDFNumber) max = Math.max(max, key.asNumber());
  }
  return max + 1;
}

/**
 * /Nums にキー昇順を保って [key, value] を挿入する。
 * PDFArray に insert があるのでそれを使う（末尾追加だと昇順が崩れうる）。
 */
function insertIntoNums(nums: PDFArray, key: number, value: PDFRef): void {
  let insertAt = nums.size();
  for (let i = 0; i < nums.size(); i += 2) {
    const k = nums.lookup(i);
    if (k instanceof PDFNumber && k.asNumber() > key) {
      insertAt = i;
      break;
    }
  }
  nums.insert(insertAt, PDFNumber.of(key));
  nums.insert(insertAt + 1, value);
}

/** StructTreeRoot 直下の実質的なルート要素（通常は Document）を返す */
function documentElement(root: PDFDict): PDFDict | null {
  const k = root.lookup(PDFName.of('K'));
  if (k instanceof PDFDict) return k;
  if (k instanceof PDFArray) {
    for (let i = 0; i < k.size(); i++) {
      const kid = k.lookup(i);
      if (kid instanceof PDFDict && kid.lookup(PDFName.of('S')) instanceof PDFName) return kid;
    }
  }
  return null;
}

/** 要素の /K に子を追加する（単一値・配列・未設定のいずれにも対応） */
function appendKid(doc: PDFDocument, parent: PDFDict, kid: PDFRef): void {
  const existing = parent.get(PDFName.of('K'));
  if (existing === undefined) {
    parent.set(PDFName.of('K'), kid);
    return;
  }
  const resolved = parent.lookup(PDFName.of('K'));
  if (resolved instanceof PDFArray) {
    resolved.push(kid);
    return;
  }
  // 単一値だった → 配列に昇格
  const arr = doc.context.obj([]) as PDFArray;
  arr.push(existing);
  arr.push(kid);
  parent.set(PDFName.of('K'), arr);
}

export interface AppendAnnotResult {
  /** 追記できたか（タグ無し文書なら false） */
  tagged: boolean;
  /** 付与した ParentTree のキー */
  structParent?: number;
}

/**
 * 既存のタグ付き PDF に注釈を構造木へ結び付ける。
 *
 * `Annot` 要素を Document 直下に足し、その /K に OBJR（注釈への参照）を置く。
 * タグ無し文書では何もしない（false を返す）ので、呼び出し側で判断できる。
 */
export function appendAnnotationToStructTree(
  doc: PDFDocument,
  page: PDFPage,
  annotRef: PDFRef,
  alt?: string,
): AppendAnnotResult {
  if (!isTagged(doc)) return { tagged: false };

  const root = structTreeRoot(doc);
  if (!root) return { tagged: false };
  const parent = documentElement(root) ?? root;
  const { context } = doc;

  // Annot 構造要素。/P は親への間接参照でなければならない
  const parentRef =
    parent === root ? doc.catalog.get(PDFName.of('StructTreeRoot')) : refOf(doc, parent);
  if (!parentRef) {
    // 親が間接オブジェクトとして登録されていない異形。無理に壊さず諦める
    return { tagged: false };
  }

  const elemRef = context.nextRef();
  const elem = context.obj({}) as PDFDict;
  elem.set(PDFName.of('Type'), PDFName.of('StructElem'));
  elem.set(PDFName.of('S'), PDFName.of('Annot'));
  elem.set(PDFName.of('P'), parentRef);
  elem.set(PDFName.of('Pg'), page.ref);
  if (alt) elem.set(PDFName.of('Alt'), PDFHexString.fromText(alt));

  // OBJR（注釈オブジェクトへの参照）
  const objr = context.obj({}) as PDFDict;
  objr.set(PDFName.of('Type'), PDFName.of('OBJR'));
  objr.set(PDFName.of('Obj'), annotRef);
  objr.set(PDFName.of('Pg'), page.ref);
  elem.set(PDFName.of('K'), context.register(objr));

  context.assign(elemRef, elem);
  appendKid(doc, parent, elemRef);

  // ParentTree に登録し、注釈側へ /StructParent を書く
  const key = nextParentTreeKey(root);
  const nums = parentTreeNums(root);
  if (nums) {
    insertIntoNums(nums, key, elemRef);
  } else {
    // ParentTree が無い（または /Kids 形式）なら平坦な /Nums を新設する
    const created = context.obj([]) as PDFArray;
    created.push(PDFNumber.of(key));
    created.push(elemRef);
    const pt = context.obj({}) as PDFDict;
    pt.set(PDFName.of('Nums'), created);
    root.set(PDFName.of('ParentTree'), context.register(pt));
  }
  root.set(PDFName.of('ParentTreeNextKey'), PDFNumber.of(key + 1));

  const annot = context.lookup(annotRef);
  if (annot instanceof PDFDict) {
    annot.set(PDFName.of('StructParent'), PDFNumber.of(key));
  }

  // 7.18.3-1: 注釈のあるページは /Tabs /S（タブ順を構造順に）
  page.node.set(PDFName.of('Tabs'), PDFName.of('S'));

  return { tagged: true, structParent: key };
}

/** 辞書オブジェクトの間接参照を逆引きする（既存要素の /P を正しく指すため） */
function refOf(doc: PDFDocument, dict: PDFDict): PDFRef | undefined {
  for (const [ref, object] of doc.context.enumerateIndirectObjects()) {
    if (object === dict) return ref;
  }
  return undefined;
}
