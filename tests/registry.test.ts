/**
 * 外部仕様スナップショット（E-5 移行の安全網）。
 * McpServer + Zod 移行後もツール名・必須フィールド・annotations が
 * 期待どおり公開されることを InMemoryTransport 経由で検証する。
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';

const EXPECTED_TOOLS: Record<string, string[]> = {
  create_text_pdf: ['text'],
  create_markdown_pdf: ['markdown'],
  create_table_pdf: ['headers', 'rows'],
  set_metadata: ['inputPath'],
  merge_pdfs: ['inputPaths'],
  split_pdf: ['inputPath', 'ranges', 'outputDir'],
  extract_pages: ['inputPath', 'pages'],
  delete_pages: ['inputPath', 'pages'],
  reorder_pages: ['inputPath', 'order'],
  add_bookmarks: ['inputPath', 'bookmarks'],
  add_annotation: ['inputPath', 'page', 'type', 'rect'],
  stamp_page_numbers: ['inputPath'],
  add_watermark: ['inputPath', 'text'],
  fill_form: ['inputPath', 'fields'],
  flatten_form: ['inputPath'],
  tag_form_fields: ['inputPath'],
  ensure_tagged: ['inputPath'],
  attach_file: ['inputPath', 'attachmentPath'],
  rotate_pages: ['inputPath', 'rotation'],
};

// biome-ignore lint/suspicious/noExplicitAny: MCP レスポンスの動的検査
let listed: any[];

beforeAll(async () => {
  const server = buildServer();
  const client = new Client({ name: 'registry-test', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const res = await client.listTools();
  listed = res.tools;
});

describe('tool registry (external spec)', () => {
  it('exposes exactly the 19 expected tools', () => {
    expect(listed.map((t) => t.name).sort()).toEqual(Object.keys(EXPECTED_TOOLS).sort());
  });

  it.each(Object.entries(EXPECTED_TOOLS))('%s keeps its required fields', (name, required) => {
    const tool = listed.find((t) => t.name === name);
    expect(tool).toBeDefined();
    expect((tool.inputSchema.required ?? []).sort()).toEqual([...required].sort());
  });

  it('every tool has a description and annotations (E-4)', () => {
    for (const tool of listed) {
      expect(tool.description, tool.name).toBeTruthy();
      expect(tool.annotations, tool.name).toBeDefined();
      expect(tool.annotations.readOnlyHint).toBe(false);
      expect(tool.annotations.openWorldHint).toBe(false);
    }
  });

  it('destructiveHint is true only for delete_pages / flatten_form', () => {
    const destructive = listed
      .filter((t) => t.annotations?.destructiveHint === true)
      .map((t) => t.name)
      .sort();
    expect(destructive).toEqual(['delete_pages', 'flatten_form']);
  });

  /**
   * B-13: 値の列挙を anyOf で公開しない。
   *
   * `z.union([z.literal(90), z.literal(180), z.literal(270)])` は
   * `anyOf: [{type:number, const:90}, ...]` になる。**これは JSON Schema として正しく、
   * SDK の変換にも非は無い**が、anyOf を落として型を見失うクライアントが実在し、
   * rotate_pages が「どう呼んでも invalid_union」になっていた（Claude Desktop で実測）。
   * `z.literal([90,180,270])` なら等価な意味のまま平坦な enum になり、この失敗を回避できる。
   *
   * 異種型の union（fill_form の値 = string|number|boolean|string[]）は anyOf が正しい表現なので
   * 対象外。**const だけで構成された anyOf** — つまり enum で書けるもの — だけを禁じる。
   */
  it('does not express a value enumeration as anyOf of consts (B-13)', () => {
    for (const tool of listed) {
      for (const [key, schema] of Object.entries<Record<string, unknown>>(
        tool.inputSchema.properties ?? {},
      )) {
        const anyOf = schema.anyOf as Array<Record<string, unknown>> | undefined;
        if (!anyOf) continue;
        const allConst = anyOf.every((branch) => 'const' in branch);
        expect(
          allConst,
          `${tool.name}.${key} lists constants via anyOf; use z.literal([...]) so it becomes a ` +
            'flat enum — some clients drop anyOf and then cannot tell the value is a number',
        ).toBe(false);
      }
    }
  });

  it('rotate_pages exposes rotation as a flat number enum (B-13)', () => {
    const rotation = listed.find((t) => t.name === 'rotate_pages').inputSchema.properties.rotation;
    expect(rotation.type).toBe('number');
    expect(rotation.enum).toEqual([90, 180, 270]);
    expect(rotation.anyOf).toBeUndefined();
  });

  it('calling a tool with invalid args returns a structured family error', async () => {
    const server = buildServer();
    const client = new Client({ name: 'registry-test-2', version: '0.0.0' });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(st), client.connect(ct)]);
    const res = await client.callTool({
      name: 'set_metadata',
      arguments: { inputPath: '/a.pdf' }, // メタデータ未指定 → INVALID_ARGUMENT
    });
    expect(res.isError).toBe(true);
    // biome-ignore lint/suspicious/noExplicitAny: MCP レスポンスの動的検査
    const payload = JSON.parse((res.content as any)[0].text);
    expect(payload.code).toBe('INVALID_ARGUMENT');
    expect(payload.error).toMatch(/at least one/);
  });
});
