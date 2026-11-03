import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '../../packages/client-sdk/dist/index.js';

// Only test-owned processes/directories are stopped or removed. Never touch the live demo.
export async function isolatedDaemon(root) {
  const data = await mkdtemp(join(tmpdir(), 'udi-aggregator-'));
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const baseUrl = `http://127.0.0.1:${port}`;
  let child;
  async function stop() {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    try {
      const [code, signal] = await exited;
      if (code !== 0 || signal) throw new Error('Test daemon did not shut down cleanly');
    } finally {
      clearTimeout(timer);
    }
  }
  async function start() {
    child = spawn(process.execPath, ['apps/core-daemon/dist/main.js'], {
      cwd: root,
      env: {
        ...process.env,
        UDI_TOKEN: '',
        UDI_PORT: String(port),
        UDI_DATA_DIR: data,
        UDI_INTEGRATIONS: 'true',
      },
      stdio: 'ignore',
    });
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null || child.signalCode !== null)
        throw new Error('Test daemon exited at startup');
      try {
        const res = await fetch(`${baseUrl}/api/v1/health`, { signal: AbortSignal.timeout(1000) });
        if (res.ok)
          return createClient({
            baseUrl,
            token: (await readFile(join(data, 'token'), 'utf8')).trim(),
          });
      } catch {
        /* bounded startup retry */
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('Test daemon startup timed out');
  }
  return {
    baseUrl,
    data,
    start,
    stop,
    async close() {
      try {
        await stop();
      } finally {
        await rm(data, { recursive: true, force: true });
      }
    },
  };
}
