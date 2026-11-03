import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { createClient } from '../packages/client-sdk/dist/index.js';
const directory = await mkdtemp(join(tmpdir(), 'udi-smoke-'));
const probe = createServer();
probe.listen(0, '127.0.0.1');
await once(probe, 'listening');
const address = probe.address();
assert(address && typeof address !== 'string');
const port = address.port;
await new Promise((resolve) => probe.close(resolve));
const baseUrl = `http://127.0.0.1:${port}`;
let child;
async function start() {
  child = spawn(process.execPath, ['apps/core-daemon/dist/main.js'], {
    env: { ...process.env, UDI_TOKEN: '', UDI_DATA_DIR: directory, UDI_PORT: String(port) },
    stdio: 'ignore',
  });
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`Daemon exited with code ${child.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/api/v1/health`);
      assert.equal(response.status, 200);
      console.log('HTTP health:', JSON.stringify(await response.json()));
      return;
    } catch {
      /* Wait for the child to bind its loopback socket. */
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Daemon startup timed out');
}
async function stop() {
  if (child && child.exitCode === null) {
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    await exited;
  }
}
try {
  await start();
  const token = (await readFile(join(directory, 'token'), 'utf8')).trim();
  const client = createClient({ baseUrl, token });
  const project = await client.createProject({ name: 'HTTP smoke', rootPath: directory });
  assert.equal((await client.listProjects()).items.length, 1);
  await stop();
  await start();
  assert.equal((await client.getProject(project.id)).name, 'HTTP smoke');
  await client.updateProject(project.id, { name: 'Verified' });
  await assert.rejects(client.getContext(project.id), { code: 'NOT_IMPLEMENTED' });
  await client.deleteProject(project.id);
  assert.equal((await client.listProjects()).items.length, 0);
  console.log(
    'PASS: actual HTTP health, authenticated SDK CRUD, generated token reuse, restart persistence, explicit 501.',
  );
} finally {
  await stop();
  await rm(directory, { recursive: true, force: true });
}
