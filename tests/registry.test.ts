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
  it('exposes exactly the 17 expected tools', () => {
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
