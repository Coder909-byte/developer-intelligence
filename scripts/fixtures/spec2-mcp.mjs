// Safe external MCP provider for integration acceptance; NOT a platform router.
// Resolve the already-installed SDK from its owning workspace, without new dependencies.
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const require = createRequire(new URL('../../packages/mcp-gateway/package.json', import.meta.url));
const { McpServer } = await import(require.resolve('@modelcontextprotocol/server'));
const { StdioServerTransport } = await import(
  require.resolve('@modelcontextprotocol/server/stdio')
);
const { z } = await import(require.resolve('zod'));

const server = new McpServer({ name: 'udi-acceptance-fixture', version: '1.0.0' });
server.registerTool(
  'fixture_sum',
  {
    description: 'Add two bounded integers. No filesystem, shell, network, or hardware access.',
    inputSchema: z.strictObject({
      a: z.number().int().min(-1000).max(1000),
      b: z.number().int().min(-1000).max(1000),
      nonce: z.string().regex(/^demo-[a-z0-9-]{1,64}$/),
    }),
  },
  async ({ a, b, nonce }) => {
    const data = {
      sum: a + b,
      nonce,
      receipt: createHash('sha256')
        .update(JSON.stringify([a, b, nonce]))
        .digest('hex'),
    };
    return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
  },
);
server.registerTool(
  'fixture_failure',
  {
    description: 'Return a genuine deterministic tool error without echoing inputs.',
    inputSchema: z.strictObject({}),
  },
  async () => ({ isError: true, content: [{ type: 'text', text: 'FIXTURE_EXPECTED_FAILURE' }] }),
);

await server.connect(new StdioServerTransport());
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, async () => {
    await server.close();
    process.exit(0);
  });
}
