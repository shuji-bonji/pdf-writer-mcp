/**
 * McpServer の構築（E-5）。
 * index.ts（stdio 接続）とテスト（InMemoryTransport）の両方から使う。
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { PACKAGE_INFO } from './config.js';
import { toStructuredError } from './errors.js';
import { tools } from './tools/definitions.js';
import { toolHandlers } from './tools/handlers.js';
import { logger } from './utils/logger.js';

export function buildServer(): McpServer {
  const server = new McpServer({
    name: PACKAGE_INFO.name,
    version: PACKAGE_INFO.version,
  });

  for (const tool of tools) {
    const handler = toolHandlers[tool.name];
    if (!handler) {
      throw new Error(`No handler registered for tool: ${tool.name}`);
    }
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.shape,
        annotations: tool.annotations,
      },
      async (args: unknown) => {
        try {
          const result = await handler(args);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          };
        } catch (error) {
          const structured = toStructuredError(error);
          logger.error(tool.name, structured.error, error instanceof Error ? error : undefined);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(structured, null, 2) }],
            isError: true,
          };
        }
      },
    );
  }

  return server;
}
