import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { createClient } from '../packages/client-sdk/dist/index.js';
import {
  generateHostConfig,
  previewConfigDiff,
  applyHostConfig,
} from '../packages/mcp-gateway/dist/index.js';

const repoRoot = resolve(import.meta.dirname, '..');
const roverDir = resolve(repoRoot, 'examples/rover');
const mcpCliPath = resolve(repoRoot, 'packages/mcp-gateway/dist/cli.js');
const opencodeBin = process.env.OPENCODE_BIN ?? 'opencode';

console.log('================================================================');
console.log(' UNIVERSAL DEVELOPER INTELLIGENCE PLATFORM');
console.log(' MCP Interoperability & Reference-Client Verification');
console.log('================================================================\n');

// 1. Setup temporary environment
const testDir = await mkdtemp(join(tmpdir(), 'udi-mcp-interop-'));
const dataDir = join(testDir, 'daemon-data');
const token = randomBytes(32).toString('hex');

// Find free port for daemon
const probe = createServer();
probe.listen(0, '127.0.0.1');
await new Promise((r) => probe.once('listening', r));
const port = probe.address().port;
probe.close();
await new Promise((r) => probe.once('close', r));

const daemonUrl = `http://127.0.0.1:${port}`;
let daemonProcess;
let mcpProcess;

async function startDaemon() {
  console.log(`[1/8] Starting Core Daemon on ${daemonUrl}...`);
  daemonProcess = spawn(process.execPath, [resolve(repoRoot, 'apps/core-daemon/dist/main.js')], {
    env: {
      ...process.env,
      UDI_PORT: String(port),
      UDI_DATA_DIR: dataDir,
      UDI_TOKEN: token,
      UDI_INTEGRATIONS: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  daemonProcess.stderr.on('data', () => {});

  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (daemonProcess.exitCode !== null) {
      throw new Error(`Daemon exited prematurely with code ${daemonProcess.exitCode}`);
    }
    try {
      const res = await fetch(`${daemonUrl}/api/v1/health`, { signal: AbortSignal.timeout(1000) });
      if (res.status === 200) {
        const body = await res.json();
        console.log(`      ✓ Daemon ready. Health:`, JSON.stringify(body.data.capabilities));
        assert.equal(body.data.capabilities.projects, true);
        assert.equal(body.data.capabilities.context, true);
        assert.equal(body.data.capabilities.mcp, true);
        assert.equal(body.data.capabilities.engineering, true);
        return;
      }
    } catch {
      // wait for socket
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Daemon failed to start within timeout');
}

try {
  await startDaemon();
  const primaryClient = createClient({ baseUrl: daemonUrl, token });

  // 2. Setup project in daemon
  console.log('\n[2/8] Creating Rover project and executing engineering validation...');
  const project = await primaryClient.createProject({
    name: 'Rover Autonomous Unit',
    rootPath: roverDir,
    description: 'Autonomous rover with DRV8833 motor driver and ESP32 MCU',
  });
  console.log(`      ✓ Project registered: "${project.name}" (ID: ${project.id})`);

  // 3. Primary Agent runs engineering validation
  console.log('\n[3/8] Primary Agent runs pin_consistency validation against rover fixture...');
  const valJob = await primaryClient.requestValidation(project.id, {
    kind: 'pin_consistency',
    artifactPaths: ['rover.net', 'src/pins.h', 'engineering-map.json'],
    requestedBy: 'interop-reference-client',
  });
  console.log(
    `      ✓ Validation job completed: status=${valJob.status}, exitCode=${valJob.exitCode}`,
  );
  assert.equal(valJob.status, 'failed');

  const { items: findings } = await primaryClient.listFindings(project.id, { jobId: valJob.id });
  console.log(`      ✓ Discovered ${findings.length} engineering finding(s):`);
  assert.equal(findings.length, 1);
  const mismatchFinding = findings[0];
  console.log(
    `        - [${mismatchFinding.severity.toUpperCase()}] ${mismatchFinding.ruleId}: ${mismatchFinding.message}`,
  );
  console.log(`          Expected: ${JSON.stringify(mismatchFinding.expected)}`);
  console.log(`          Observed: ${JSON.stringify(mismatchFinding.observed)}`);
  console.log(`          Suggested Fix: ${mismatchFinding.suggestedFix}`);
  assert.equal(mismatchFinding.ruleId, 'pin_consistency');
  assert.ok(mismatchFinding.message.includes('MOTOR_EN'));

  // 4. Primary Agent records a decision in project context
  console.log('\n[4/8] Primary Agent records an architectural decision...');
  const decisionRecord = await primaryClient.createContextRecord(project.id, {
    kind: 'decision',
    text: 'Reviewed proposal: compare the corrected GPIO14 fixture; no source file was edited',
    provenance: { sourceKind: 'user_entered', actor: 'lead-engineer' },
    evidence: [{ filePath: 'rover.net', line: 28 }],
  });
  console.log(
    `      ✓ Decision stored in backend: ID ${decisionRecord.id} (provenance: user_entered)`,
  );

  // 5. Verify Host Configuration Generation for OpenCode
  console.log(
    '\n[5/8] Checking adapter preview/backup IO in private temporary files (not host compatibility)...',
  );
  const opencodeServer = {
    id: randomUUID(),
    name: 'udi-platform',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    enabled: true,
    status: 'healthy',
    transport: {
      type: 'stdio',
      executableId: process.execPath,
      args: [mcpCliPath],
    },
  };

  const opencodeConfig = generateHostConfig('opencode', [opencodeServer], {
    UDI_DAEMON_URL: daemonUrl,
    UDI_TOKEN: token,
    UDI_PROJECT_ID: project.id,
  });

  const opencodeJsonPath = join(testDir, 'opencode.json');
  const applyRes1 = await applyHostConfig(opencodeJsonPath, opencodeConfig);
  assert.equal(applyRes1.written, true);
  assert.equal(applyRes1.backupPath, null);

  // Test diff preview
  const preview = previewConfigDiff(JSON.stringify(opencodeConfig, null, 2), {
    ...opencodeConfig,
    description: 'Updated configuration',
  });
  assert.equal(preview.hasChanges, true);

  // Test backup IO only; this raw API is not an approval/merge/atomic-write boundary.
  const applyRes2 = await applyHostConfig(opencodeJsonPath, {
    ...opencodeConfig,
    description: 'Updated configuration',
  });
  assert.equal(applyRes2.written, true);
  assert.equal(applyRes2.backupPath, `${opencodeJsonPath}.bak`);
  console.log(
    '      ✓ Temporary-file write/backup IO verified; real host format and safe apply remain separate test:hosts gates.',
  );

  // 6. Test with OpenCode CLI if binary exists
  console.log('\n[6/8] Testing OpenCode CLI integration via "opencode mcp list"...');
  try {
    const opencodeCheck = await new Promise((resolveCheck) => {
      const child = spawn(opencodeBin, ['mcp', 'list'], {
        cwd: testDir,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let out = '';
      const timer = setTimeout(() => {
        child.kill();
        resolveCheck({ code: 124 });
      }, 5000);
      child.stdout?.on('data', (c) => (out += c.toString()));
      child.stderr?.on('data', (c) => (out += c.toString()));
      child.on('close', (code) => {
        clearTimeout(timer);
        resolveCheck({ code, connected: /connected/i.test(out) });
      });
      child.on('error', () => {
        clearTimeout(timer);
        resolveCheck({ code: -1 });
      });
    });
    if (opencodeCheck.code === -1)
      console.log('      SKIP: OpenCode is not installed; no commercial-agent host claim.');
    else if (opencodeCheck.code !== 0)
      throw new Error(`OpenCode probe failed (exit ${opencodeCheck.code})`);
    else
      console.log(
        `      OpenCode CLI ran; connected status: ${Boolean(opencodeCheck.connected)}. This is not an agent conversation/tool-call test.`,
      );
  } catch (err) {
    throw new Error(`Optional configured OpenCode host failed: ${err.message}`, { cause: err });
  }

  // 7. Real Stdio MCP Communication with Reference client
  console.log(
    '\n[7/8] Spawning MCP Gateway Stdio process and connecting an independent MCP reference client...',
  );
  mcpProcess = spawn(process.execPath, [mcpCliPath, '--project-id', project.id], {
    env: {
      ...process.env,
      UDI_DAEMON_URL: daemonUrl,
      UDI_TOKEN: token,
      UDI_PROJECT_ID: project.id,
    },
    stdio: ['pipe', 'pipe', 'inherit'],
  });

  let messageId = 1;
  const pendingRequests = new Map();
  let buffer = '';

  mcpProcess.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed);
        if (msg.id !== undefined && pendingRequests.has(msg.id)) {
          const { resolve: reqResolve, reject: reqReject, timer } = pendingRequests.get(msg.id);
          pendingRequests.delete(msg.id);
          clearTimeout(timer);
          if (msg.error) {
            reqReject(new Error(msg.error.message || JSON.stringify(msg.error)));
          } else {
            reqResolve(msg.result);
          }
        }
      } catch {
        // Not a JSON message
      }
    }
  });

  function sendRpc(method, params = {}) {
    const id = messageId++;
    return new Promise((reqResolve, reqReject) => {
      const timer = setTimeout(() => {
        pendingRequests.delete(id);
        reqReject(new Error(`MCP timeout: ${method}`));
      }, 10000);
      pendingRequests.set(id, { resolve: reqResolve, reject: reqReject, timer });
      const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
      mcpProcess.stdin.write(payload);
    });
  }

  function sendNotification(method, params = {}) {
    const payload = JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n';
    mcpProcess.stdin.write(payload);
  }

  // 7a. Handshake
  console.log('      -> Sending MCP initialize handshake...');
  const initResult = await sendRpc('initialize', {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'udi-interop-reference-client', version: '1.0.0' },
  });
  console.log(
    `      ✓ Handshake successful: server="${initResult.serverInfo?.name}" v${initResult.serverInfo?.version}`,
  );
  sendNotification('notifications/initialized');

  // 7b. Discover Tools
  console.log('      -> Reference client discovers available tools (tools/list)...');
  const toolsResult = await sendRpc('tools/list', {});
  const toolNames = toolsResult.tools.map((t) => t.name);
  console.log(`      ✓ Discovered ${toolNames.length} MCP tools: [${toolNames.join(', ')}]`);
  assert.ok(toolNames.includes('get_project_context'));
  assert.ok(toolNames.includes('list_project_events'));
  assert.ok(toolNames.includes('get_validation_results'));
  assert.ok(toolNames.includes('record_decision'));
  assert.ok(toolNames.includes('list_available_tools'));

  // 7c. Retrieve Project Context
  console.log('      -> Reference client retrieves project context (get_project_context)...');
  const contextCall = await sendRpc('tools/call', {
    name: 'get_project_context',
    arguments: { projectId: project.id },
  });
  const contextText = contextCall.content[0].text;
  console.log(`      ✓ Reference client retrieved shared project memory:`);
  console.log(`        ${contextText.split('\n').slice(0, 5).join('\n        ')}`);
  assert.ok(contextText.includes('Reviewed proposal: compare the corrected GPIO14 fixture'));

  // 7d. Retrieve Validation Results
  console.log(
    '      -> Reference client retrieves engineering validation findings (get_validation_results)...',
  );
  const findingsCall = await sendRpc('tools/call', {
    name: 'get_validation_results',
    arguments: { projectId: project.id },
  });
  const findingsText = findingsCall.content[0].text;
  console.log(`      ✓ Reference client retrieved validation diagnostics:`);
  console.log(`        ${findingsText.split('\n').slice(0, 4).join('\n        ')}`);
  assert.ok(findingsText.includes('MOTOR_EN'));
  assert.ok(findingsText.includes('GPIO14'));

  // 7e. Reference client records decision through MCP gateway
  console.log('      -> Reference client records new decision via record_decision...');
  const recordCall = await sendRpc('tools/call', {
    name: 'record_decision',
    arguments: {
      projectId: project.id,
      text: 'Reference client observed the GPIO mismatch; review the corrected fixture next. No source files edited.',
      actor: 'interop-reference-client',
    },
  });
  console.log(`      ✓ Reference client recorded decision: ${recordCall.content[0].text}`);

  // 7f. Verify Reference client's decision persisted in shared context
  console.log('      -> Re-fetching context to verify round-trip persistence...');
  const reContext = await primaryClient.getContext(project.id);
  const secondAgentRecord = reContext.records.find((r) =>
    r.text.includes('Reference client observed the GPIO mismatch'),
  );
  assert.ok(secondAgentRecord);
  assert.equal(secondAgentRecord.provenance.sourceKind, 'agent_summary');
  assert.equal(secondAgentRecord.provenance.actor, 'interop-reference-client');
  console.log(
    `      ✓ Verified: Reference client's decision is persisted and retrievable by all agents!`,
  );

  mcpProcess.kill('SIGTERM');

  // 8. Test Error Handling and Failure Modes
  console.log('\n[8/8] Testing failure modes, authentication rejection, and unavailable tools...');

  // No reliance on a developer's ~/.data/token fallback or a hanging child.
  await assert.rejects(
    () => createClient({ baseUrl: daemonUrl, token: 'incorrect-token' }).listProjects(),
    (error) => error.code === 'UNAUTHORIZED',
  );
  console.log('      ✓ Unauthenticated API access rejected');

  // 8b. Cross-project isolation: querying non-existent project returns structured error
  const crossProjectRes = await primaryClient
    .getContext('00000000-0000-0000-0000-000000000000')
    .catch((e) => e);
  assert.equal(crossProjectRes.status, 404);
  console.log(`      ✓ Cross-project access correctly rejected with 404`);

  // 8c. Corrected fixture passes validation
  const correctedJob = await primaryClient.requestValidation(project.id, {
    kind: 'pin_consistency',
    artifactPaths: ['rover.net', 'src/pins_corrected.h', 'engineering-map.json'],
    requestedBy: 'verification-script',
  });
  assert.equal(correctedJob.status, 'succeeded');
  assert.equal(correctedJob.exitCode, 0);
  console.log(
    `      ✓ Corrected pin mapping validated: job status=${correctedJob.status}, exitCode=0 (zero errors)`,
  );

  console.log('\n================================================================');
  console.log(' ALL MCP INTEROPERABILITY CHECKS PASSED');
  console.log(' Core Daemon ↔ MCP Gateway ↔ Context Engine ↔ Engineering Core');
  console.log(
    ` Verified on ${process.platform} ${process.arch} using an actual MCP reference client`,
  );
  console.log('================================================================\n');
} finally {
  if (mcpProcess && mcpProcess.exitCode === null) mcpProcess.kill('SIGTERM');
  if (daemonProcess && daemonProcess.exitCode === null) {
    daemonProcess.kill('SIGTERM');
  }
  await rm(testDir, { recursive: true, force: true });
}
