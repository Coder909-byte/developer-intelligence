// Real processes + HTTP + Developer 2's validator/context engine/MCP gateway. No mock results.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { createClient } from '../packages/client-sdk/dist/index.js';
import {
  ProjectMemorySchema,
  ContextRecordSchema,
  ValidationFindingSchema,
} from '../packages/contracts/dist/index.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const rover = join(root, 'examples/rover');
const keep = process.argv.includes('--keep');
const data = await mkdtemp(join(tmpdir(), 'udi-demo-e2e-'));
const portProbe = createServer();
portProbe.listen(0, '127.0.0.1');
await once(portProbe, 'listening');
const address = portProbe.address();
assert(address && typeof address !== 'string');
const port = address.port;
await new Promise((resolve) => portProbe.close(resolve));
const baseUrl = `http://127.0.0.1:${port}`;
const daemonEnv = {
  ...process.env,
  UDI_DATA_DIR: data,
  UDI_TOKEN: '',
  UDI_PORT: String(port),
  UDI_INTEGRATIONS: 'true',
  UDI_ENABLE_INTEGRATIONS: '1',
};
let daemon;
let mcp;
async function stop(child, endStdin = false) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  if (endStdin) child.stdin.end();
  else child.kill('SIGTERM');
  const deadline = setTimeout(() => child.kill('SIGKILL'), 5000);
  try {
    const [code, signal] = await exited;
    assert.equal(signal, null);
    assert.equal(code, 0);
  } finally {
    clearTimeout(deadline);
  }
}
async function startDaemon() {
  daemon = spawn(process.execPath, ['apps/core-daemon/dist/main.js'], {
    cwd: root,
    env: daemonEnv,
    stdio: 'ignore',
  });
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (daemon.exitCode !== null || daemon.signalCode !== null)
      throw new Error('Integrated daemon exited before health was ready');
    try {
      const response = await fetch(`${baseUrl}/api/v1/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) {
        const body = await response.json();
        assert.deepEqual(body.data.capabilities, {
          projects: true,
          context: true,
          mcp: true,
          engineering: true,
        });
        return;
      }
    } catch {
      /* Allow the actual daemon time to bind its loopback socket. */
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Integrated daemon startup timed out');
}
function startMcp(projectId) {
  const child = spawn(process.execPath, ['scripts/mcp-stdio.mjs'], {
    cwd: root,
    env: { ...daemonEnv, UDI_DAEMON_URL: baseUrl, UDI_PROJECT_ID: projectId },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let nextId = 0;
  let stderr = '';
  const pending = new Map();
  child.stderr.on('data', (chunk) => {
    stderr = (stderr + chunk.toString()).slice(-4096);
  });
  const lines = createInterface({ input: child.stdout });
  function rejectPending(error) {
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(error);
    }
    pending.clear();
  }
  lines.on('line', (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      rejectPending(new Error('Gateway wrote non-JSON protocol output'));
      child.kill('SIGTERM');
      return;
    }
    if (message.id === undefined) return;
    const item = pending.get(message.id);
    if (!item) return;
    pending.delete(message.id);
    clearTimeout(item.timer);
    if (message.error)
      item.reject(new Error(`MCP error ${message.error.code}: ${message.error.message}`));
    else item.resolve(message.result);
  });
  child.on('error', rejectPending);
  child.on('exit', (code, signal) => {
    lines.close();
    rejectPending(new Error(`MCP process exited (${code ?? signal}): ${stderr}`));
  });
  function request(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`MCP request timed out: ${method}`));
      }, 10000);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }
  return {
    child,
    request,
    notify(method) {
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method }) + '\n');
    },
  };
}
async function connectMcp(projectId) {
  mcp = startMcp(projectId);
  const initialized = await mcp.request('initialize', {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'udi-real-runtime-test', version: '1.0.0' },
  });
  assert.equal(initialized.serverInfo.name, 'developer-intelligence-gateway');
  assert.equal(initialized.protocolVersion, '2025-11-25');
  mcp.notify('notifications/initialized');
  const tools = await mcp.request('tools/list', {});
  for (const name of [
    'get_project_context',
    'list_project_events',
    'get_validation_results',
    'record_decision',
    'list_available_tools',
  ])
    assert(tools.tools.some((tool) => tool.name === name));
}
async function tool(name, args = {}) {
  const result = await mcp.request('tools/call', { name, arguments: args });
  assert.notEqual(result.isError, true);
  const blocks = result.content.filter((block) => block.type === 'text');
  const json = blocks
    .map((block) => block.text)
    .find((text) => text.trim().startsWith('{') || text.trim().startsWith('['));
  assert(
    json,
    `MCP ${name} did not return structured JSON: ${blocks.map((block) => block.text).join('\n')}`,
  );
  return { data: JSON.parse(json), text: blocks.map((block) => block.text).join('\n') };
}
function verifyDatabase(projectId, failedJob, passedJob, handoffId) {
  const db = new DatabaseSync(join(data, 'platform.sqlite'), { readOnly: true });
  try {
    for (const job of [failedJob, passedJob]) {
      const row = db
        .prepare('SELECT body FROM validation_jobs WHERE project_id=? AND id=?')
        .get(projectId, job.id);
      assert(row);
      assert.equal(JSON.parse(row.body).status, job.status);
    }
    assert.equal(
      db
        .prepare('SELECT count(*) AS count FROM engineering_findings WHERE job_id=?')
        .get(failedJob.id).count,
      1,
    );
    assert.equal(
      db
        .prepare('SELECT count(*) AS count FROM engineering_findings WHERE job_id=?')
        .get(passedJob.id).count,
      0,
    );
    assert(
      db
        .prepare('SELECT 1 FROM agent_handoffs WHERE id=? AND project_id=?')
        .get(handoffId, projectId),
    );
  } finally {
    db.close();
  }
}
try {
  await startDaemon();
  const token = (await readFile(join(data, 'token'), 'utf8')).trim();
  const client = createClient({ baseUrl, token });
  await assert.rejects(createClient({ baseUrl }).listProjects(), {
    code: 'UNAUTHORIZED',
    status: 401,
  });
  await assert.rejects(
    createClient({ baseUrl, token: 'wrong-token' }).createProject({
      name: 'Denied',
      rootPath: rover,
    }),
    { code: 'UNAUTHORIZED', status: 401 },
  );
  const project = await client.createProject({
    name: 'Rover real end-to-end demo',
    rootPath: rover,
  });
  const control = await client.createProject({ name: 'Isolation control', rootPath: root });
  console.log('PASS: integrated daemon health, authentication and example rover registration.');
  const validate = (firmware) =>
    client.requestValidation(project.id, {
      kind: 'pin_consistency',
      artifactPaths: ['rover.net', firmware, 'engineering-map.json'],
      requestedBy: 'real-runtime-demo',
    });
  const failed = await validate('src/pins.h');
  assert.equal(failed.status, 'failed');
  assert.equal(failed.exitCode, 1);
  const findings = (await client.listFindings(project.id, { jobId: failed.id })).items;
  assert.equal(findings.length, 1);
  const mismatch = findings[0];
  assert.equal(mismatch.ruleId, 'pin_consistency');
  assert.equal(mismatch.expected.pin, 'GPIO14');
  assert.equal(mismatch.observed.pin, 'GPIO26');
  assert.equal(mismatch.evidence.find((item) => item.filePath === 'src/pins.h').line, 7);
  assert.equal(mismatch.evidence.find((item) => item.filePath === 'rover.net').line, 28);
  for (const evidence of mismatch.evidence) {
    assert(evidence.line > 0);
    const text = (await readFile(resolve(rover, evidence.filePath), 'utf8')).split('\n');
    assert(text[evidence.line - 1]);
  }
  const passed = await validate('src/pins_corrected.h');
  assert.equal(passed.status, 'succeeded');
  assert.equal(passed.exitCode, 0);
  assert.deepEqual((await client.listFindings(project.id, { jobId: passed.id })).items, []);
  assert.equal((await client.listFindings(project.id, { jobId: failed.id })).items.length, 1);
  const events = (await client.listEvents(project.id, { type: 'engineering.validation.completed' }))
    .items;
  assert.equal(events.length, 2);
  assert.equal(events.at(-1).payload.jobId, passed.id);
  assert.equal(events.at(-1).payload.status, 'succeeded');
  console.log(
    'PASS: actual GPIO14/GPIO26 mismatch with source evidence; corrected fixture succeeds; current job has zero findings while history remains.',
  );
  const context = await client.getContext(project.id);
  for (const job of [failed, passed]) {
    const observed = context.records.find((record) => record.provenance.sourceRef === job.id);
    assert(observed, `No verified context was published for real job ${job.id}`);
    assert.equal(observed.provenance.sourceKind, 'observed_tool');
    assert.match(observed.text, new RegExp(job.status));
  }
  assert.deepEqual(context.openIssues, []);
  assert.deepEqual((await client.getContext(control.id)).records, []);
  await connectMcp(project.id);
  const remote = ProjectMemorySchema.parse((await tool('get_project_context')).data);
  assert.equal(remote.projectId, project.id);
  assert.deepEqual(remote.records, context.records);
  const remoteFailed = await tool('get_validation_results', {
    projectId: project.id,
    jobId: failed.id,
  });
  assert.equal(remoteFailed.data.length, 1);
  ValidationFindingSchema.parse(remoteFailed.data[0]);
  assert.match(remoteFailed.text, /Status: failed/);
  const remotePassed = await tool('get_validation_results', {
    projectId: project.id,
    jobId: passed.id,
  });
  assert.deepEqual(remotePassed.data, []);
  assert.match(remotePassed.text, /Status: succeeded/);
  const decision = ContextRecordSchema.parse(
    (
      await tool('record_decision', {
        text: 'Continue using the corrected GPIO14 fixture; keep original mismatch as history.',
        actor: 'real-mcp-test-client',
        sourceRef: passed.id,
      })
    ).data,
  );
  assert.equal(decision.provenance.sourceKind, 'agent_summary');
  const latestContext = await client.getContext(project.id);
  const handoff = await client.createHandoff(project.id, {
    fromAgentId: randomUUID(),
    toAgentId: randomUUID(),
    summary:
      'Real rover validation completed: GPIO14 correction passes; failed job retained as history.',
    recordIds: latestContext.records.map((record) => record.id),
    nextSteps: ['Review observed validation evidence before further changes'],
    provenance: { sourceKind: 'user_entered', actor: 'demo-operator' },
  });
  assert.deepEqual(await client.getHandoff(project.id, handoff.id), handoff);
  const remoteEvents = await tool('list_project_events', {
    projectId: project.id,
    type: 'engineering.validation.completed',
  });
  assert.equal(remoteEvents.data.length, 2);
  const inventory = await client.createMcpServer({
    name: 'Verified stdio demo gateway',
    enabled: true,
    transport: {
      type: 'stdio',
      executableId: process.execPath,
      args: [join(root, 'scripts/mcp-stdio.mjs')],
    },
  });
  assert.equal(inventory.status, 'unknown');
  verifyDatabase(project.id, failed, passed, handoff.id);
  console.log(
    'PASS: actual MCP initialize/tools/list/tools/call, context/result retrieval, agent-summary decision, handoff and independent SQLite reads.',
  );
  await stop(mcp.child, true);
  mcp = undefined;
  await stop(daemon);
  await startDaemon();
  assert.equal((await readFile(join(data, 'token'), 'utf8')).trim(), token);
  assert.deepEqual(await client.getJob(project.id, passed.id), passed);
  assert.deepEqual(await client.getHandoff(project.id, handoff.id), handoff);
  assert.deepEqual((await client.listFindings(project.id, { jobId: passed.id })).items, []);
  assert.equal((await client.listFindings(project.id, { jobId: failed.id })).items.length, 1);
  await connectMcp(project.id);
  assert.deepEqual(
    ProjectMemorySchema.parse((await tool('get_project_context')).data).records,
    latestContext.records,
  );
  assert.deepEqual((await tool('get_validation_results', { jobId: passed.id })).data, []);
  verifyDatabase(project.id, failed, passed, handoff.id);
  console.log(
    'PASS: daemon and real MCP process restarted; SQLite observations, handoff, current job and provenance survive.',
  );
  const fixtureHashes = {};
  for (const path of ['rover.net', 'engineering-map.json', 'src/pins.h', 'src/pins_corrected.h'])
    fixtureHashes[path] = createHash('sha256')
      .update(await readFile(join(rover, path)))
      .digest('hex');
  console.log(
    JSON.stringify(
      {
        result: 'PASS',
        daemonUrl: baseUrl,
        projectId: project.id,
        failedJobId: failed.id,
        passedJobId: passed.id,
        handoffId: handoff.id,
        expected: 'GPIO14',
        observed: 'GPIO26',
        failedFindings: 1,
        passedFindings: 0,
        evidence: mismatch.evidence,
        validator: mismatch.verifiedBy,
        mcpProtocol: '2025-11-25',
        fixtureHashes,
        ...(keep ? { dataDirectory: data } : {}),
      },
      null,
      2,
    ),
  );
} finally {
  try {
    await stop(mcp?.child, true);
  } finally {
    try {
      await stop(daemon);
    } finally {
      if (!keep) await rm(data, { recursive: true, force: true });
      else console.log(`Private demo data retained at ${data}; token is not printed.`);
    }
  }
}
