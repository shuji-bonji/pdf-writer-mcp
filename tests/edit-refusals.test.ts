/**
 * 編集系の拒否の順序・文面・パス（openspec/changes/edit-refusal-order-and-paths。#10）
 *
 * - F-21: 署名付きの暗号化文書に SIGNED_PDF を返し、案内どおりの再試行で ENCRYPTED_PDF にしていた
 * - F-08: 鍵を導ける暗号化文書と導けない文書に同じ hint を返していた
 * - F-23: 書き出しの失敗で入力のパスを名指し、出力先に書けないときは INTERNAL_ERROR だった
 *
 * ツールは buildServer() の実物を InMemoryTransport 越しに呼び、本文を見る。
 */

import { chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { encryptPdf, writeFile as writeCos } from 'normativepdf';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';

let client: Client;
let dir: string;

// biome-ignore lint/suspicious/noExplicitAny: 応答の形そのものを検査する
type Body = any;

async function call(
  name: string,
  args: Record<string, unknown>,
): Promise<{ isError: boolean; body: Body }> {
  const result = (await client.callTool({ name, arguments: args })) as {
    isError?: boolean;
    content: Array<{ type: string; text?: string }>;
  };
  const text = result.content.find((c) => c.type === 'text')?.text ?? '';
  return { isError: result.isError === true, body: JSON.parse(text) };
}

const name = (value: string) => ({ kind: 'name', value }) as const;
const int = (value: number) => ({ kind: 'integer', value }) as const;
const ref = (objectNumber: number) => ({ kind: 'ref', objectNumber, generationNumber: 0 }) as const;
const dict = (entries: Record<string, unknown>) =>
  ({ kind: 'dict', entries: new Map(Object.entries(entries)) }) as never;

function minimalObjects() {
  return [
    {
      objectNumber: 1,
      generationNumber: 0,
      object: dict({ Type: name('Catalog'), Pages: ref(2) }),
    },
    {
      objectNumber: 2,
      generationNumber: 0,
      object: dict({
        Type: name('Pages'),
        Kids: { kind: 'array', items: [ref(3)] },
        Count: int(1),
      }),
    },
    {
      objectNumber: 3,
      generationNumber: 0,
      object: dict({
        Type: name('Page'),
        Parent: ref(2),
        Resources: dict({}),
        MediaBox: { kind: 'array', items: [int(0), int(0), int(612), int(792)] },
      }),
    },
  ];
}

function encrypted(userPassword: string): Uint8Array {
  let seed = 7;
  const random = (length: number) =>
    Uint8Array.from({ length }, () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed & 0xff;
    });
  return encryptPdf(minimalObjects() as never, dict({ Size: int(4), Root: ref(1) }), {
    method: 'AESV3',
    userPassword: new TextEncoder().encode(userPassword),
    ownerPassword: new TextEncoder().encode('owner'),
    random,
  });
}

const SIG_MARKER = Buffer.from('\n% fixture marker: /ByteRange [0 1 2 3]\n', 'latin1');
const withSigMarker = (bytes: Uint8Array) => Buffer.concat([Buffer.from(bytes), SIG_MARKER]);

/** `/Resources` の無いページ（ISO 32000-2 §7.7.3.3 Table 31 の Required; inheritable に反する） */
function pageWithoutResources(): Buffer {
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n',
  ];
  let body = '%PDF-1.7\n';
  const offsets: number[] = [];
  for (const o of objects) {
    offsets.push(body.length);
    body += o;
  }
  const xref = body.length;
  body += `xref\n0 4\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  body += `trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

const files = {
  encSigned: '',
  encOpen: '',
  encLocked: '',
  plainSigned: '',
  plain: '',
  noResources: '',
  aFile: '',
  lockedDir: '',
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'writer-refusals-'));
  const put = (n: string, bytes: Uint8Array) => {
    const p = join(dir, n);
    writeFileSync(p, bytes);
    return p;
  };
  files.encSigned = put('enc-signed.pdf', withSigMarker(encrypted('')));
  files.encOpen = put('enc-open.pdf', encrypted(''));
  files.encLocked = put('enc-locked.pdf', encrypted('secret'));
  const plain = writeCos(minimalObjects() as never, dict({ Size: int(4), Root: ref(1) }), {
    version: '1.7',
  });
  files.plain = put('plain.pdf', plain);
  files.plainSigned = put('plain-signed.pdf', withSigMarker(plain));
  files.noResources = put('no-resources.pdf', pageWithoutResources());
  files.aFile = put('a-file.txt', Buffer.from('not a folder\n'));
  files.lockedDir = join(dir, 'locked-dir');
  mkdirSync(files.lockedDir);
  chmodSync(files.lockedDir, 0o500);

  const server = buildServer();
  client = new Client({ name: 'edit-refusals-test', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
});

afterAll(async () => {
  chmodSync(files.lockedDir, 0o700);
  await client?.close();
});

const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

describe('SPEC-WRITER-COMMON-ERRORS-004 編集の入口は、暗号化を署名より先に確かめる', () => {
  it('SPEC-WRITER-COMMON-ERRORS-004 署名付きの暗号化文書は ENCRYPTED_PDF', async () => {
    const { isError, body } = await call('set_metadata', {
      inputPath: files.encSigned,
      outputPath: join(dir, 'never-1.pdf'),
      title: 'x',
    });
    expect(isError).toBe(true);
    expect(body.code).toBe('ENCRYPTED_PDF');
    const actions = (body.next_actions ?? []).map((a: { action: string }) => a.action);
    expect(actions).not.toContain('retry_with_preserveSignatures');
  });

  it('SPEC-WRITER-COMMON-ERRORS-004 暗号化されていない署名付き文書は今までどおり SIGNED_PDF', async () => {
    const { body } = await call('set_metadata', {
      inputPath: files.plainSigned,
      outputPath: join(dir, 'never-2.pdf'),
      title: 'x',
    });
    expect(body.code).toBe('SIGNED_PDF');
    expect(body.next_actions[0].action).toBe('retry_with_preserveSignatures');
  });
});

describe('SPEC-WRITER-COMMON-ERRORS-005 暗号化文書の拒否は、鍵を導けたかを分けて返す', () => {
  it('SPEC-WRITER-COMMON-ERRORS-005 鍵を導ける暗号化文書', async () => {
    const { body } = await call('set_metadata', {
      inputPath: files.encOpen,
      outputPath: join(dir, 'never-3.pdf'),
      title: 'x',
    });
    expect(body.code).toBe('ENCRYPTED_PDF');
    expect(body.detail?.keyDerived).toBe(true);
    expect(body.hint).toMatch(/pdf-reader-mcp/);
  });

  it('SPEC-WRITER-COMMON-ERRORS-005 鍵を導けない暗号化文書', async () => {
    const { body } = await call('set_metadata', {
      inputPath: files.encLocked,
      outputPath: join(dir, 'never-4.pdf'),
      title: 'x',
    });
    expect(body.code).toBe('ENCRYPTED_PDF');
    expect(body.detail?.keyDerived).toBe(false);
    expect(body.hint).toMatch(/password/);
  });
});

describe('SPEC-WRITER-COMMON-ERRORS-006 出力先に書けないときは INVALID_ARGUMENT にし、出力のパスを名指す', () => {
  it('SPEC-WRITER-COMMON-ERRORS-006 出力のフォルダーの位置にファイルがある', async () => {
    const outputPath = join(files.aFile, 'out.pdf');
    const { isError, body } = await call('rotate_pages', {
      inputPath: files.plain,
      rotation: 90,
      outputPath,
    });
    expect(isError).toBe(true);
    expect(body.code).toBe('INVALID_ARGUMENT');
    expect(body.retryable).toBe(true);
    expect(body.detail?.reason).toBe('NOT_A_DIRECTORY');
    expect(body.detail?.path).toBe(outputPath);
    expect(body.error).toContain(outputPath);
  });

  it.skipIf(isRoot)('SPEC-WRITER-COMMON-ERRORS-006 出力のフォルダーに書く権限が無い', async () => {
    const outputPath = join(files.lockedDir, 'out.pdf');
    const { body } = await call('rotate_pages', {
      inputPath: files.plain,
      rotation: 90,
      outputPath,
    });
    expect(body.code).toBe('INVALID_ARGUMENT');
    expect(body.detail?.reason).toBe('PERMISSION_DENIED');
    expect(existsSync(outputPath)).toBe(false);
  });

  it('SPEC-WRITER-COMMON-ERRORS-006 入力を組み直せないときは両方のパスを名指す', async () => {
    const outputPath = join(dir, 'rewritten.pdf');
    const { body } = await call('set_metadata', {
      inputPath: files.noResources,
      outputPath,
      title: 'x',
    });
    expect(body.code).toBe('INVALID_PDF');
    expect(body.error).toMatch(/^Cannot rewrite/);
    expect(body.error).toContain(files.noResources);
    expect(body.error).toContain(outputPath);
    expect(body.detail?.outputPath).toBe(outputPath);
  });
});
