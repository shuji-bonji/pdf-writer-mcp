/**
 * B-17 の回帰テスト — `stripInline` が装飾でない文字を消さないこと
 *
 * 背景: `create_markdown_pdf` は「インライン装飾の記号を除去して字面だけ残す」仕様だが、
 * `_` の処理が語中かどうかを見ていなかったため、1 行に `_` が偶数個あると
 * `snake_case` の識別子が壊れた（`identify_conformance と validate_conformance`
 * → `identifyconformance と validateconformance`）。
 * **exit 0・warnings なし**で起きるため、読み戻して照合しない限り気づけない。
 * さらにコードスパンの復元が `_` 処理より後にあり、バッククォートで囲んでも防げなかった。
 *
 * 根拠: CommonMark は `*` の語中強調を許すが `_` は許さない（`snake_case` を守るため）。
 * 仕様リポジトリの changelog 0.17:
 *   "To prevent intra-word emphasis, we used to check to see if the delimiter was
 *    followed/preceded by an ASCII alphanumeric. We now do something more elegant:
 *    whereas an opening `*` must be left-flanking, an opening `_` must be
 *    left-flanking *and not right-flanking*."
 *
 * 実装は flanking の完全再現ではなく、その前身の「隣が語構成文字なら強調でない」を
 * Unicode 対応で採っている。0.17 の changelog が言うとおり ASCII 限定だと
 * キリル文字の語中 `_` を誤って強調扱いするため（同じ理由で日本語の識別子も壊れる）。
 *
 * 負の対照（2026-07-21 実測）: 修正前の実装（`__`/`_` を無条件に剥がし、
 * コードスパンの復元を最後に置いた版）に本ファイルの 16 ケースを通すと **6 件が落ちる**。
 * 内訳は snake_case 2 件・日本語識別子・キリル文字・コードスパン保護・`__foo_bar__`。
 * テストが空振りしていないことをこの形で確認している。
 */

import { describe, expect, it } from 'vitest';
import { stripInline } from '../src/services/renderers/markdown.js';

describe('stripInline — 装飾でない `_` を消さない（B-17）', () => {
  it.each([
    ['`_` が 1 個だけなら手を触れない', 'a_b', 'a_b'],
    [
      '1 行に snake_case が 2 つあっても壊さない（B-17 の実測ケース）',
      'identify_conformance と validate_conformance',
      'identify_conformance と validate_conformance',
    ],
    ['1 語に `_` が 2 つでも壊さない', 'extract_structured_text', 'extract_structured_text'],
    [
      '日本語の識別子も壊さない（ASCII 限定にしない理由）',
      '日本語_変数名_です',
      '日本語_変数名_です',
    ],
    [
      'キリル文字の語中 `_`（changelog 0.17 が名指ししたケース）',
      'слово_слово_слово',
      'слово_слово_слово',
    ],
  ])('%s', (_name, input, expected) => {
    expect(stripInline(input)).toBe(expected);
  });

  it('コードスパンの中身は装飾解釈の対象外（バッククォートが効く）', () => {
    expect(stripInline('`identify_conformance` と `validate_conformance`')).toBe(
      'identify_conformance と validate_conformance',
    );
  });

  it('コードスパンの退避が本文の「空白 + 数字 + 空白」を巻き込まない', () => {
    // プレースホルダに ` 0 ` のような形を使うと、この入力の「第 3 章」が復元対象に化ける
    expect(stripInline('`code` の第 3 章')).toBe('code の第 3 章');
  });
});

describe('stripInline — 強調の除去自体は従来どおり動く', () => {
  it.each([
    ['`*` の強調', 'これは *強調* です', 'これは 強調 です'],
    ['`**` の強調', 'これは **強め** です', 'これは 強め です'],
    ['`_` の強調（語中でない）', '_em_', 'em'],
    ['`__` の強調（語中でない）', '__strong__', 'strong'],
    ['`__` の内側の語中 `_` は残す', '__foo_bar__', 'foo_bar'],
    ['閉じ側が記号に隣接する場合（changelog 0.19 のケース）', '_(bar)_.', '(bar).'],
    ['`*` は語中でも強調になる（CommonMark どおり・`_` との違い）', 'foo*bar*baz', 'foobarbaz'],
    ['打ち消し線', '~~消す~~', '消す'],
    ['リンクは字面 + URL', '[題名](https://example.com)', '題名 (https://example.com)'],
  ])('%s', (_name, input, expected) => {
    expect(stripInline(input)).toBe(expected);
  });
});
