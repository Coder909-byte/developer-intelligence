import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { createClient } from '../packages/client-sdk/dist/index.js';
import { ErrorResponseSchema } from '../packages/contracts/dist/index.js';
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
    env: {
      ...process.env,
      UDI_TOKEN: '',
      UDI_DATA_DIR: directory,
      UDI_PORT: String(port),
      UDI_INTEGRATIONS: 'false',
      UDI_ENABLE_INTEGRATIONS: '0',
    },
    stdio: 'ignore',
  });
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error(
        `Daemon exited before health was ready: ${child.exitCode ?? child.signalCode}`,
      );
    try {
      const response = await fetch(`${baseUrl}/api/v1/health`, {
        signal: AbortSignal.timeout(Math.min(2000, Math.max(1, deadline - Date.now()))),
      });
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
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    const deadline = setTimeout(() => child.kill('SIGKILL'), 5000);
    try {
      const [code, signal] = await exited;
      assert.equal(signal, null, 'Daemon should shut down gracefully');
      assert.equal(code, 0);
    } finally {
      clearTimeout(deadline);
    }
  }
}
async function expectHttpError(path, status, code, init = {}) {
  const response = await fetch(`${baseUrl}/api/v1${path}`, {
    ...init,
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(response.status, status);
  assert.equal(ErrorResponseSchema.parse(await response.json()).error.code, code);
}
try {
  await start();
  const token = (await readFile(join(directory, 'token'), 'utf8')).trim();
  const client = createClient({ baseUrl, token });
  const noToken = createClient({ baseUrl });
  const wrongToken = createClient({ baseUrl, token: 'invalid-smoke-token' });
  await assert.rejects(noToken.listProjects(), { code: 'UNAUTHORIZED', status: 401 });
  await assert.rejects(
    wrongToken.createProject({ name: 'Must not be saved', rootPath: directory }),
    { code: 'UNAUTHORIZED', status: 401 },
  );
  assert.deepEqual((await client.listProjects()).items, []);
  console.log('PASS: missing/wrong-token HTTP requests rejected; rejected write did not persist.');
  const project = await client.createProject({ name: 'HTTP smoke', rootPath: directory });
  assert.equal((await client.listProjects()).items.length, 1);
  const otherRoot = join(directory, 'other-workspace');
  await mkdir(otherRoot);
  const other = await client.createProject({ name: 'Isolation control', rootPath: otherRoot });
  for (const [method, path] of [
    ['GET', `/projects/${project.id}/context`],
    ['POST', `/projects/${project.id}/context/records`],
    ['POST', `/projects/${project.id}/events`],
    ['POST', `/projects/${project.id}/handoffs`],
    ['GET', '/mcp/servers'],
    ['POST', '/mcp/servers'],
    ['POST', `/projects/${project.id}/validation-results`],
    ['GET', `/engineering/findings?projectId=${project.id}`],
  ])
    await expectHttpError(path, 401, 'UNAUTHORIZED', { method });
  const preflight = await fetch(`${baseUrl}/api/v1/mcp/servers/${randomUUID()}`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'http://127.0.0.1:5173',
      'Access-Control-Request-Method': 'PUT',
      'Access-Control-Request-Headers': 'authorization,content-type',
    },
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'http://127.0.0.1:5173');
  assert.match(preflight.headers.get('access-control-allow-methods') ?? '', /PUT/);
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
  assert.equal(server.status, 'unknown');
  await assert.rejects(client.getContextRecord(other.id, record.id), {
    code: 'NOT_FOUND',
    status: 404,
  });
  await assert.rejects(
    client.createHandoff(other.id, {
      fromAgentId: randomUUID(),
      summary: 'Invalid reference',
      recordIds: [record.id],
      nextSteps: [],
      provenance,
    }),
    { code: 'VALIDATION_ERROR', status: 400 },
  );
  assert.deepEqual((await client.listHandoffs(other.id)).items, []);
  await expectHttpError(`/projects/${other.id}/validation-results`, 400, 'VALIDATION_ERROR', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ job, findings: [finding] }),
  });
  await assert.rejects(client.getJob(other.id, job.id), { code: 'NOT_FOUND', status: 404 });
  assert.deepEqual((await client.listFindings(other.id)).items, []);
  console.log(
    'PASS: project isolation, cross-project rejection, inventory registration and browser preflight.',
  );
  await stop();
  await start();
  assert.equal((await readFile(join(directory, 'token'), 'utf8')).trim(), token);
  await assert.rejects(noToken.listProjects(), { code: 'UNAUTHORIZED', status: 401 });
  assert.deepEqual(await client.getEvent(project.id, event.id), event);
  assert.deepEqual((await client.listEvents(project.id, { type: event.type })).items, [event]);
  assert.deepEqual((await client.listContextRecords(project.id)).items, [record]);
  assert.deepEqual((await client.listHandoffs(project.id)).items, [handoff]);
  assert.deepEqual((await client.listMcpServers()).items, [server]);
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
  await client.deleteProject(other.id);
  assert.equal((await client.listProjects()).items.length, 0);
  console.log(
    'PASS: actual HTTP authentication, project CRUD/isolation, context/events, handoffs, MCP inventory, findings/jobs and token reuse across graceful process restart; execution remains explicit 501.',
  );
} finally {
  await stop();
  await rm(directory, { recursive: true, force: true });
}
