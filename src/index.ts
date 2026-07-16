#!/usr/bin/env node
/**
 * pdf-writer-mcp — MCP server entry
 * テキスト / Markdown / 表データから PDF を生成し、既存 PDF を編集する。
 *
 * E-5: reader / verify と同じ McpServer + registerTool + Zod 構成。
 * ツール定義（説明・スキーマ・annotations）は tools/definitions.ts の
 * レジストリ、実装は tools/handlers.ts、スキーマは utils/validation.ts。
 */

// stdout ガードは他のあらゆる import より先（side-effect first）
import './utils/stdout-guard.js';

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { PACKAGE_INFO } from './config.js';
import { buildServer } from './server.js';
import { logger } from './utils/logger.js';

async function main(): Promise<void> {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info(PACKAGE_INFO.name, `v${PACKAGE_INFO.version} started (stdio)`);
}

main().catch((error) => {
  logger.error('Startup', 'Failed to start server', error instanceof Error ? error : undefined);
  process.exit(1);
});
