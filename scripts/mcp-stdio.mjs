// Thin process composition for Developer 2's real MCP gateway. stdout is protocol-only.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { createClient } from '../packages/client-sdk/dist/index.js';
import { IdSchema } from '../packages/contracts/dist/index.js';
import { DefaultMcpGateway } from '../packages/mcp-gateway/dist/index.js';

try {
  const projectId = IdSchema.parse(process.env.UDI_PROJECT_ID);
  const dataDir = resolve(
    process.env.UDI_DATA_DIR ?? fileURLToPath(new URL('../.data/', import.meta.url)),
  );
  const token = process.env.UDI_TOKEN || (await readFile(join(dataDir, 'token'), 'utf8')).trim();
  if (token.length < 32) throw new Error('Invalid local token');
  const client = createClient({
    baseUrl: process.env.UDI_DAEMON_URL ?? 'http://127.0.0.1:4317',
    token,
  });
  // Fail on missing auth or project rather than start an apparently connected empty gateway.
  await client.getProject(projectId);
  const gateway = new DefaultMcpGateway({ client, projectId });
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, () => {
      void gateway.stop().catch(() => {
        process.exitCode = 1;
      });
    });
  await gateway.start();
} catch {
  process.stderr.write(
    'MCP startup failed. Check UDI_PROJECT_ID, UDI_DAEMON_URL and the local token/data directory.\n',
  );
  process.exitCode = 1;
}
