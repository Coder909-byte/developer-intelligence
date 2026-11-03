// Spec 2 real stdio acceptance; test host below is explicitly a protocol provider, not VS Code.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isolatedDaemon } from './lib/spec2-daemon.mjs';
import { connectMcp } from './lib/mcp-reference-client.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const runtime = await isolatedDaemon(root, {
  requestTimeoutMs: 25000,
  source: process.argv.includes('--source'),
});
let mcp;
try {
  let client = await runtime.start();
  const project = await client.createProject({
    name: 'Spec 2 rover',
    rootPath: join(root, 'examples/rover'),
  });
  const control = await client.createProject({ name: 'Control', rootPath: runtime.data });
  const server = await client.createMcpServer({
    name: 'spec2-fixture',
    enabled: true,
    transport: {
      type: 'stdio',
      executableId: process.execPath,
      args: [join(root, 'scripts/fixtures/spec2-mcp.mjs')],
    },
  });
  mcp = await connectMcp(root, {
    UDI_DATA_DIR: runtime.data,
    UDI_DAEMON_URL: runtime.baseUrl,
    UDI_PROJECT_ID: project.id,
  });
  let names = (await mcp.request('tools/list')).tools.map((t) => t.name);
  for (const n of [
    'run_engineering_validation',
    'get_validation_results',
    'get_compressed_context',
    'vscode_execute_command',
    'vscode_list_diagnostics',
    'spec2-fixture__fixture_sum',
  ])
    assert(names.includes(n), n);
  for (const category of [
    'hardware_validation',
    'context_memory',
    'ide_extension_bridge',
    'external_servers',
  ]) {
    const hidden = {
      hardware_validation: 'get_validation_results',
      context_memory: 'get_project_context',
      ide_extension_bridge: 'vscode_list_diagnostics',
      external_servers: 'spec2-fixture__fixture_sum',
    }[category];
    await client.toggleToolCategory({ projectId: project.id, category, enabled: false });
    names = (await mcp.request('tools/list')).tools.map((t) => t.name);
    assert(!names.includes(hidden));
    if (category === 'hardware_validation') {
      assert(!names.includes('run_engineering_validation'));
      assert(!names.includes('get_validation_results'));
    }
    const blocked = await mcp.request('tools/call', {
      name: hidden,
      arguments:
        category === 'external_servers' ? { params: { a: 14, b: 26, nonce: 'demo-disabled' } } : {},
    });
    assert.equal(blocked.isError, true);
    assert(blocked.content[0].text.includes('toggled OFF'));
    assert((await client.getToolCategories(control.id)).categories.every((c) => c.enabled));
    await client.toggleToolCategory({ projectId: project.id, category, enabled: true });
    const enabledNames = (await mcp.request('tools/list')).tools.map((t) => t.name);
    assert(enabledNames.includes(hidden));
    if (category === 'hardware_validation') {
      assert(enabledNames.includes('run_engineering_validation'));
      assert(enabledNames.includes('get_validation_results'));
    }
  }
  const routed = await mcp.tool('spec2-fixture__fixture_sum', {
    params: { a: 14, b: 26, nonce: 'demo-bridge' },
  });
  assert.equal(routed.data.sum, 40);
  assert((await client.listMcpExecutions(project.id)).items.some((e) => e.serverId === server.id));
  const job = (
    await mcp.tool('run_engineering_validation', {
      kind: 'pin_consistency',
      artifactPaths: ['rover.net', 'src/pins.h', 'engineering-map.json'],
      approved: true,
    })
  ).data;
  assert.equal(job.status, 'failed');
  const compression = await client.getCompressedContext(project.id);
  assert(compression.activeInvariants.includes('MOTOR_EN=GPIO14'));
  const hostId = randomUUID();
  for (const name of ['vscode_execute_command', 'vscode_list_diagnostics'])
    await client.registerHostExtensionTool({
      projectId: project.id,
      hostId,
      name,
      description: 'Integration protocol provider (not native VS Code)',
      commandIds: ['test.readonly'],
    });
  const response = mcp.tool('vscode_list_diagnostics', {});
  let pending;
  for (let i = 0; i < 50; i++) {
    const page = await client.pollHostExtensionRequests(project.id, hostId);
    pending = page.items[0];
    if (pending) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert(pending);
  await assert.rejects(
    client.completeHostExtensionRequest(control.id, hostId, pending.id, {
      isError: false,
      content: [],
    }),
    { status: 404 },
  );
  await client.completeHostExtensionRequest(project.id, hostId, pending.id, {
    isError: false,
    content: [{ message: 'Protocol fixture diagnostic', line: 7 }],
  });
  const returned = await response;
  assert.equal(returned.data[0].line, 7);
  await assert.rejects(
    client.callHostExtensionTool(project.id, {
      name: 'vscode_execute_command',
      arguments: { commandId: 'unregistered' },
    }),
    { status: 400 },
  );
  await client.toggleToolCategory({
    projectId: project.id,
    category: 'hardware_validation',
    enabled: false,
  });
  await mcp.close();
  mcp = undefined;
  await runtime.stop();
  client = await runtime.start();
  assert.equal(
    (await client.getToolCategories(project.id)).categories.find(
      (c) => c.category === 'hardware_validation',
    ).enabled,
    false,
  );
  assert.equal((await client.listHostExtensionTools(project.id)).items.length, 0);
  assert(
    (await client.getCompressedContext(project.id)).activeInvariants.includes('MOTOR_EN=GPIO14'),
  );
  console.log(
    JSON.stringify({
      status: 'PASS',
      checks: [
        'all four live category hide/re-enable/disabled-call checks over one stdio process',
        'external tool routed through daemon and persisted',
        'approved real engineering validation',
        'compressed GPIO14 invariant',
        'project-scoped extension broker relay and denied command',
        'category persistence and truthful host disconnect after restart',
      ],
      nativeVsCode: 'separate runtime check required',
    }),
  );
} finally {
  try {
    await mcp?.close();
  } finally {
    await runtime.close();
  }
}
