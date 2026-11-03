// Readiness gate: real foundation checks; deliberately nonzero until D2 routing is bound.
// Never post a synthetic invocation/event to satisfy an absent gateway.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { createClient } from '../packages/client-sdk/dist/index.js';
import { ActivityEventSchema, ProjectMemorySchema } from '../packages/contracts/dist/index.js';
import { isolatedDaemon } from './lib/isolated-daemon.mjs';
import { connectMcp } from './lib/mcp-reference-client.mjs';
import { verifyAggregatorFixture } from './lib/aggregator-fixture-check.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const runtime = await isolatedDaemon(root);
const report = {
  status: 'BLOCKED',
  scope: 'aggregator acceptance preparation; foundation passes do not prove external routing',
  foundation: [],
  blocked: [
    'Platform MCP initialize/tools-list discovery and persisted discovered-tool catalog',
    'Project-authorized external tool invocation via D2 gateway (success and failure)',
    'Automatically recorded redacted invocation history with provenance and correlation ID',
    'Second MCP connection retrieves that external invocation event/context',
    'Invocation grant/isolation/disabled-server/timeout tests and history after restart',
  ],
};
let secondAgent;
try {
  let client = await runtime.start();
  await assert.rejects(
    createClient({ baseUrl: runtime.baseUrl, token: 'incorrect' }).listProjects(),
    { code: 'UNAUTHORIZED', status: 401 },
  );
  report.foundation.push('Actual isolated integrated daemon; unauthorized HTTP returns 401');
  const project = await client.createProject({
    name: 'Aggregator acceptance rover',
    rootPath: join(root, 'examples/rover'),
  });
  const control = await client.createProject({ name: 'Isolated control', rootPath: runtime.data });
  const server = await client.createMcpServer({
    name: 'udi-acceptance-fixture',
    enabled: true,
    transport: {
      type: 'stdio',
      executableId: process.execPath,
      args: [join(root, 'scripts/fixtures/aggregator-mcp.mjs')],
    },
  });
  assert.equal(server.status, 'unknown');
  assert((await client.listMcpServers()).items.some((s) => s.id === server.id));
  report.foundation.push(
    'Actual fixture registered in persistent global inventory; status unknown',
  );
  report.fixture = await verifyAggregatorFixture(root);
  report.foundation.push(
    'Direct fixture MCP handshake/list/sum/invalid-input/tool-error/unknown-tool; prerequisite only',
  );

  const failed = await client.requestValidation(project.id, {
    kind: 'pin_consistency',
    artifactPaths: ['rover.net', 'src/pins.h', 'engineering-map.json'],
    requestedBy: 'aggregator-acceptance',
  });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.exitCode, 1);
  const { items: findings } = await client.listFindings(project.id, { jobId: failed.id });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].expected.pin, 'GPIO14');
  assert.equal(findings[0].observed.pin, 'GPIO26');
  assert.equal(findings[0].ruleId, 'pin_consistency');
  assert(findings[0].evidence.some((e) => e.filePath === 'src/pins.h' && e.line === 7));
  assert(findings[0].evidence.some((e) => e.filePath === 'rover.net' && e.line === 28));
  const passed = await client.requestValidation(project.id, {
    kind: 'pin_consistency',
    artifactPaths: ['rover.net', 'src/pins_corrected.h', 'engineering-map.json'],
    requestedBy: 'aggregator-acceptance',
  });
  assert.equal(passed.status, 'succeeded');
  assert.equal(passed.exitCode, 0);
  assert.deepEqual((await client.listFindings(project.id, { jobId: passed.id })).items, []);
  await assert.rejects(client.getJob(control.id, failed.id), { code: 'NOT_FOUND', status: 404 });
  assert.deepEqual((await client.getContext(control.id)).records, []);
  report.foundation.push(
    'Real GPIO14/GPIO26 mismatch with both source positions; corrected success/zero findings; job/context isolation',
  );

  const env = {
    UDI_DATA_DIR: runtime.data,
    UDI_DAEMON_URL: runtime.baseUrl,
    UDI_PROJECT_ID: project.id,
  };
  secondAgent = await connectMcp(root, env, {
    clientName: 'udi-aggregator-second-reference-client',
  });
  const catalog = await secondAgent.request('tools/list');
  report.platformMcpTools = catalog.tools.map((tool) => tool.name);
  report.sdkMethods = Object.keys(client);
  const available = await secondAgent.tool('list_available_tools', { projectId: project.id });
  assert(available.data.mcpServers.some((s) => s.id === server.id));
  const memory = ProjectMemorySchema.parse(
    (await secondAgent.tool('get_project_context', { projectId: project.id })).data,
  );
  assert.deepEqual(
    memory.records.map((r) => r.id),
    (await client.getContext(project.id)).records.map((r) => r.id),
  );
  assert(
    memory.records.some(
      (r) => r.provenance.sourceKind === 'observed_tool' && r.provenance.sourceRef === passed.id,
    ),
  );
  const { data: events } = await secondAgent.tool('list_project_events', { projectId: project.id });
  assert(Array.isArray(events));
  const event = events
    .map((e) => ActivityEventSchema.parse(e))
    .find((e) => e.sourceRef === passed.id);
  assert(event);
  assert.equal(event.sourceKind, 'observed_tool');
  report.foundation.push(
    'Separate actual D2 MCP CLI retrieves the inventory and real engineering event/context matching REST',
  );
  await secondAgent.close();
  secondAgent = undefined;
  await runtime.stop();
  client = await runtime.start();
  assert.deepEqual(await client.getMcpServer(server.id), server);
  assert.deepEqual(await client.getJob(project.id, passed.id), passed);
  assert.equal((await client.listFindings(project.id, { jobId: failed.id })).items.length, 1);
  assert.deepEqual((await client.listFindings(project.id, { jobId: passed.id })).items, []);
  assert((await client.listEvents(project.id)).items.some((e) => e.id === event.id));
  secondAgent = await connectMcp(root, env, { clientName: 'udi-aggregator-after-restart' });
  const persisted = ProjectMemorySchema.parse(
    (await secondAgent.tool('get_project_context', { projectId: project.id })).data,
  );
  assert.deepEqual(persisted.records, memory.records);
  report.foundation.push(
    'Actual daemon/CLI restart preserves inventory, jobs, findings, event IDs and context provenance',
  );
  report.projectId = project.id;
  report.failedJobId = failed.id;
  report.correctedJobId = passed.id;
  report.contractAction =
    'D2/D1 agree actual discovery/routing/history exports and schemas; bind remaining gates in this script. See docs/AGGREGATOR_CONTRACT.md.';
} catch (error) {
  report.status = 'FAIL';
  report.error = error.message;
} finally {
  try {
    await secondAgent?.close();
  } finally {
    await runtime.close();
  }
}
const evidence = join(root, '.data/aggregator-integration');
await mkdir(evidence, { recursive: true });
await writeFile(join(evidence, 'aggregator-result.json'), JSON.stringify(report, null, 2) + '\n', {
  mode: 0o600,
});
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.status === 'BLOCKED' ? 2 : 1;
