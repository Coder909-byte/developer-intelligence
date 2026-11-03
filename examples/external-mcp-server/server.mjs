#!/usr/bin/env node
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const mcpGatewayPkg = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../packages/mcp-gateway/package.json',
);
const require = createRequire(mcpGatewayPkg);
const { McpServer } = await import(require.resolve('@modelcontextprotocol/server'));
const { StdioServerTransport } = await import(
  require.resolve('@modelcontextprotocol/server/stdio')
);
const { z } = await import(require.resolve('zod'));

const server = new McpServer({
  name: 'code-intelligence-pack',
  version: '1.2.0',
});

// Tool 1: Code Metrics Analyzer
server.registerTool(
  'analyze_code_metrics',
  {
    description: 'Calculates static code metrics and complexity for a file or directory.',
    inputSchema: {
      path: z.string().default('.'),
      includeComments: z.boolean().default(true),
    },
  },
  async ({ path, includeComments }) => {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              targetPath: path,
              linesOfCode: 420,
              cyclomaticComplexity: 3,
              commentRatio: includeComments ? 0.18 : 0,
              language: 'TypeScript',
              analyzedAt: new Date().toISOString(),
              status: 'healthy',
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

// Tool 2: Snippet Formatter
server.registerTool(
  'format_code_snippet',
  {
    description: 'Formats a code snippet with standardized indentation and spacing.',
    inputSchema: {
      code: z.string(),
      language: z.string().default('typescript'),
    },
  },
  async ({ code, language }) => {
    const formatted = code.trim();
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              originalLength: code.length,
              formattedLength: formatted.length,
              language,
              formatted,
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

// Tool 3: Environment Inspector
server.registerTool(
  'inspect_environment',
  {
    description: 'Reports runtime environment diagnostics for developer tools.',
    inputSchema: {
      filter: z.string().optional(),
    },
  },
  async ({ filter }) => {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              platform: process.platform,
              arch: process.arch,
              nodeVersion: process.version,
              filter: filter ?? 'none',
              timestamp: new Date().toISOString(),
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('[code-intelligence-pack] External MCP server connected on stdio.');
