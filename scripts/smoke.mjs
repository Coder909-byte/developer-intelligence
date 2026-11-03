import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
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
  const provenance = { actor: 'http-smoke-fixture', sourceKind: 'user_entered' };
  const event = await client.createEvent(project.id, {
    type: 'smoke.recorded',
    actor: 'http-smoke-fixture',
    sourceKind: 'user_entered',
    payload: { fixture: true },
  });
  const record = await client.createContextRecord(project.id, {
    kind: 'decision',
    text: 'HTTP smoke fixture',
    provenance,
    evidence: [],
  });
  const handoff = await client.createHandoff(project.id, {
    fromAgentId: randomUUID(),
    summary: 'Continue smoke fixture',
    recordIds: [record.id],
    nextSteps: [],
    provenance,
  });
  const server = await client.createMcpServer({
    name: 'Smoke inventory',
    enabled: true,
    transport: { type: 'stdio', executableId: 'fixture-never-executed', args: [] },
  });
  const timestamp = new Date().toISOString();
  const job = {
    id: randomUUID(),
    projectId: project.id,
    createdAt: timestamp,
    updatedAt: timestamp,
    status: 'failed',
    startedAt: timestamp,
    completedAt: timestamp,
    exitCode: 1,
    stdoutTail: '',
    stderrTail: 'Synthetic persistence test fixture; no validator executed',
    artifacts: [],
  };
  const finding = {
    id: randomUUID(),
    projectId: project.id,
    jobId: job.id,
    createdAt: timestamp,
    updatedAt: timestamp,
    ruleId: 'smoke.fixture',
    severity: 'error',
    message: 'Synthetic persistence fixture',
    expected: 1,
    observed: 2,
    evidence: [{ filePath: 'fixture.txt' }],
    status: 'open',
    verifiedBy: { tool: 'smoke-test-fixture', version: '1' },
  };
  await client.recordValidationResult(project.id, { job, findings: [finding] });
  await stop();
  await start();
  assert.deepEqual(await client.getEvent(project.id, event.id), event);
  assert.deepEqual(await client.getContextRecord(project.id, record.id), record);
  assert.deepEqual((await client.getContext(project.id)).records, [record]);
  assert.deepEqual(await client.getHandoff(project.id, handoff.id), handoff);
  assert.deepEqual(await client.getMcpServer(server.id), server);
  assert.deepEqual(await client.getJob(project.id, job.id), job);
  assert.deepEqual((await client.listFindings(project.id)).items, [finding]);
  assert.equal((await client.getProject(project.id)).name, 'HTTP smoke');
  await client.updateProject(project.id, { name: 'Verified' });
  await assert.rejects(
    client.requestValidation(project.id, {
      kind: 'pin_consistency',
      artifactPaths: ['fixture.txt'],
      requestedBy: 'smoke',
    }),
    { code: 'NOT_IMPLEMENTED' },
  );
  await assert.rejects(client.checkMcpServerHealth(server.id), { code: 'NOT_IMPLEMENTED' });
  await client.deleteMcpServer(server.id);
  await client.deleteProject(project.id);
  assert.equal((await client.listProjects()).items.length, 0);
  console.log(
    'PASS: actual HTTP health, authenticated SDK CRUD, token reuse and all platform records across process restart; execution remains explicit 501.',
  );
} finally {
  await stop();
  await rm(directory, { recursive: true, force: true });
}
