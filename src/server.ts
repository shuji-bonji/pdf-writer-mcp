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

/**
 * `initialize` の応答としてクライアントへ返す説明（family 規約: PDFfamily specs/06）。
 *
 * **writer が書けるのは「宣言」であって「適合」ではない。** `ensure_pdfa` / `ensure_tagged` が
 * XMP に `pdfaid` / `pdfuaid` を書くようになった今、「PDF/A や PDF/UA を作れるサーバ」と
 * 読まれる余地がある。それは誤りで、書けるのは自称だけである（`specs/09 §4`）。
 * ツール説明にも書いてあるが、`instructions` はツールを 1 つも呼ばないうちに読まれる。
 * 先例は pdf-spec-mcp v0.4.5（Issue #13）。
 */
const INSTRUCTIONS = `${PACKAGE_INFO.name} v${PACKAGE_INFO.version} — the running build identifies itself here so a stale install is visible without a tool call; compare against \`npm view ${PACKAGE_INFO.name} version\` when freshness matters.

This server WRITES PDFs. It can write a claim of conformance; it cannot make a file conform.

ensure_pdfa and ensure_tagged put pdfaid / pdfuaid into the XMP — that is a DECLARATION, the
document saying of itself that it follows a standard. It is not conformance. Applying them to a
file that does not conform produces a file that lies about itself, which is worse than one that
claims nothing. Both tools always return a warning saying so; do not discard it.

So: whenever you write a declaration, measure it. pdf-verify-mcp validate_conformance with the
matching flavour — "pdfua-1" for ensure_tagged, and for ensure_pdfa the same string you passed
as its flavour ("pdfa-3b" by default, or "pdfa-4" / "pdfa-4f"). If you cannot measure it, do not
write the declaration. The verdict is veraPDF's, not this server's.

Other limits worth knowing before you plan a job:
  - PDF 2.0 is opt-in on the create tools (pdfVersion: "2.0"), and it is what PDF/A-4 is built
    on. Plain PDF/A-4 requires every embedded file to be PDF/A itself, so a document carrying a
    CSV or JSON attachment has to be declared "pdfa-4f", not "pdfa-4".
  - No signing. Editing a signed PDF normally invalidates the signature; pass
    preserveSignatures: true to append an incremental update instead, or
    allowBreakingSignatures: true to proceed destructively — never silently.
  - Fonts, transparency, encryption and JavaScript are not repaired by ensure_pdfa. It only
    supplies document-level requirements.
  - Always pass outputPath (absolute). Omitting it returns the whole PDF as base64 and will
    overflow the response for anything sizeable.
  - Errors are structured (code / next_actions / retryable). Branch on the code; do not parse
    the message text.

For what the specification requires, ask pdf-spec-mcp. For whether a file meets it, ask
pdf-verify-mcp. This server does neither.`;

export function buildServer(): McpServer {
  const server = new McpServer(
    {
      name: PACKAGE_INFO.name,
      version: PACKAGE_INFO.version,
    },
    { instructions: INSTRUCTIONS },
  );

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
