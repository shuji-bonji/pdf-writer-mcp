#!/usr/bin/env node
/**
 * pdf-writer-mcp — MCP server entry
 * テキスト / Markdown / 表データから PDF を生成する。
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { PACKAGE_INFO } from './config.js';
import { tools } from './tools/definitions.js';
import { toolHandlers } from './tools/handlers.js';
import { logger } from './utils/logger.js';

const server = new Server(
  {
    name: PACKAGE_INFO.name,
    version: PACKAGE_INFO.version,
  },
  {
    capabilities: { tools: {} },
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    const handler = toolHandlers[name];
    if (!handler) {
      throw new Error(`Unknown tool: ${name}`);
    }
    const result = await handler(args);
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(name, message, error instanceof Error ? error : undefined);
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: message }, null, 2) }],
      isError: true,
    };
  }
});

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info(PACKAGE_INFO.name, `v${PACKAGE_INFO.version} started (stdio)`);
}

main().catch((error) => {
  logger.error('Startup', 'Failed to start server', error instanceof Error ? error : undefined);
  process.exit(1);
});
