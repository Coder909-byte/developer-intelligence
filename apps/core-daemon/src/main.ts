import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { resolve, join } from 'node:path';
import { z } from 'zod';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
import { createDefaultIntegrations } from './integrations.js';
const port = z.coerce
  .number()
  .int()
  .min(1)
  .max(65535)
  .parse(process.env.UDI_PORT ?? 4317);
const dataDir = resolve(
  process.env.UDI_DATA_DIR ?? fileURLToPath(new URL('../../../.data/', import.meta.url)),
);
await mkdir(dataDir, { recursive: true, mode: 0o700 });
await chmod(dataDir, 0o700);
const tokenPath = join(dataDir, 'token');
let token = process.env.UDI_TOKEN;
if (!token) {
  try {
    token = (await readFile(tokenPath, 'utf8')).trim();
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    const generated = randomBytes(32).toString('hex');
    try {
      await writeFile(tokenPath, generated + '\n', { mode: 0o600, flag: 'wx' });
      token = generated;
    } catch (writeError) {
      if (!(writeError instanceof Error && 'code' in writeError && writeError.code === 'EEXIST'))
        throw writeError;
      token = (await readFile(tokenPath, 'utf8')).trim();
    }
  }
  await chmod(tokenPath, 0o600);
}
const integrations =
  process.env.UDI_INTEGRATIONS === 'true' || process.env.UDI_ENABLE_INTEGRATIONS === '1'
    ? createDefaultIntegrations
    : undefined;
const app = buildApp({
  databasePath: join(dataDir, 'platform.sqlite'),
  token,
  ...(integrations ? { integrations } : {}),
});
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    void app.close().catch(() => {
      process.exitCode = 1;
    });
  });
try {
  await app.listen({ host: '127.0.0.1', port });
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exitCode = 1;
}
