/**
 * 入力バイト列の署名検知 — Phase 3（pdf-lib 撤去）の L4′.1。
 *
 * `editor.ts` にあったものをここへ移した。**移した理由は循環依存を作らないため**である ——
 * 新しい入口（`edit-open.ts`）はこの検査を要るが、`editor.ts` は L4′.2 以降で
 * 新しい入口を使う側になるので、`edit-open.ts` → `editor.ts` の向きを作ると輪になる。
 *
 * `editor.ts` は互換のためここから再輸出している（`tests/editor.test.ts` が
 * `../src/services/editor.js` から import しているため。関数を動かすときは
 * tests/ も同じ grep に含める、を今回は再輸出で満たしている）。
 */

/** 入力バイト列に電子署名（/ByteRange）が含まれるかの軽量検査 */
export function containsSignature(bytes: Uint8Array): boolean {
  // "/ByteRange" の ASCII 検索（署名辞書は非圧縮で現れるのが通例）
  const needle = [0x2f, 0x42, 0x79, 0x74, 0x65, 0x52, 0x61, 0x6e, 0x67, 0x65]; // "/ByteRange"
  outer: for (let i = 0; i <= bytes.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (bytes[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}
