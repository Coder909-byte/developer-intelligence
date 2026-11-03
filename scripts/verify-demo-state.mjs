import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createClient } from '../packages/client-sdk/dist/index.js';
import { connectRenderer } from './lib/cdp.mjs';
import { connectMcp } from './lib/mcp-reference-client.mjs';

const root = resolve(import.meta.dirname, '..');
const evidence = join(root, '.data/final-runtime/evidence');
const result = JSON.parse(
  await readFile(join(evidence, `${process.env.UDI_VSCODE_CDP_PORT ?? 9335}-result.json`), 'utf8'),
);
const data = resolve(process.env.UDI_DATA_DIR ?? join(root, '.data/final-runtime/daemon'));
const token = (await readFile(join(data, 'token'), 'utf8')).trim();
const baseUrl = process.env.UDI_DAEMON_URL ?? 'http://127.0.0.1:4317';
const api = createClient({ baseUrl, token });
const context = await api.getContext(result.projectId);
const handoff = await api.getHandoff(result.projectId, result.handoffId);
assert.equal(handoff.projectId, result.projectId);
assert(handoff.recordIds.every((id) => context.records.some((r) => r.id === id)));
const mcp = await connectMcp(root, {
  UDI_TOKEN: token,
  UDI_DAEMON_URL: baseUrl,
  UDI_PROJECT_ID: result.projectId,
});
try {
  assert.equal(mcp.initialized.serverInfo.name, 'developer-intelligence-gateway');
  const tools = await mcp.request('tools/list');
  for (const name of [
    'get_project_context',
    'list_project_events',
    'get_validation_results',
    'record_decision',
    'list_available_tools',
  ])
    assert(tools.tools.some((t) => t.name === name));
  const retrieved = await mcp.tool('get_project_context', { projectId: result.projectId });
  assert.deepEqual(
    retrieved.data.records.map((r) => r.id).sort(),
    context.records.map((r) => r.id).sort(),
  );
  for (const [jobId, count, status] of [
    [result.failedJobId, 1, 'failed'],
    [result.passedJobId, 0, 'succeeded'],
  ]) {
    const findings = await mcp.tool('get_validation_results', {
      projectId: result.projectId,
      jobId,
    });
    assert.equal(findings.data.length, count);
    assert.match(findings.text, new RegExp(status));
  }
  const browserPort = Number(process.env.UDI_BROWSER_CDP_PORT ?? 9336);
  // A browser can remain running after its demo tab is closed. Open a new real
  // tab rather than requiring a stale tab/session to survive the daemon restart.
  const browserTargets = await (
    await fetch(`http://127.0.0.1:${browserPort}/json/list`, { signal: AbortSignal.timeout(5000) })
  ).json();
  if (!browserTargets.some((t) => t.type === 'page' && t.url.startsWith('http://127.0.0.1:5173'))) {
    const opened = await fetch(`http://127.0.0.1:${browserPort}/json/new?http://127.0.0.1:5173`, {
      method: 'PUT',
      signal: AbortSignal.timeout(5000),
    });
    assert(opened.ok, 'Could not open the actual dashboard browser tab');
  }
  const ui = await connectRenderer(browserPort, (t) => t.url.startsWith('http://127.0.0.1:5173'));
  try {
    await ui.waitFor(
      `Array.from(document.querySelectorAll('button')).some(e=>e.textContent.trim()==='Settings')`,
      'dashboard application',
    );
    await ui.evaluate(
      `Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim()==='Settings').click()`,
    );
    await ui.waitFor(
      `!!document.querySelector('input[type=password]')`,
      'dashboard session token field',
    );
    await ui.evaluate(`document.querySelector('input[type=password]').focus()`);
    await ui.call('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'a',
      code: 'KeyA',
      modifiers: process.platform === 'darwin' ? 4 : 2,
      windowsVirtualKeyCode: 65,
    });
    await ui.call('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'a',
      code: 'KeyA',
      modifiers: process.platform === 'darwin' ? 4 : 2,
      windowsVirtualKeyCode: 65,
    });
    await ui.insertText(token);
    await ui.clickText('Connect');
    await ui.waitFor(
      `!!document.querySelector('select[aria-label="Active project"] option[value="${result.projectId}"]')`,
      'same rover project available in dashboard',
    );
    await ui.evaluate(
      `(()=>{const s=document.querySelector('select[aria-label="Active project"]');s.value=${JSON.stringify(result.projectId)};s.dispatchEvent(new Event('change',{bubbles:true}))})()`,
    );
    assert.equal(
      await ui.evaluate(`document.querySelector('select[aria-label="Active project"]')?.value`),
      result.projectId,
    );
    await ui.evaluate(
      `Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim()==='Agent Workspace').click()`,
    );
    await ui.waitText('Observed tool result');
    await ui.waitText(result.failedJobId);
    await ui.waitText(result.passedJobId);
    await ui.waitText('vscode-user');
    await ui.screenshot(join(evidence, 'desktop-shared-context.png'));
    await writeFile(join(evidence, 'desktop-shared-context.txt'), await ui.body());
  } finally {
    ui.close();
  }
  const report = {
    projectId: result.projectId,
    actualMcpCli: 'packages/mcp-gateway/dist/cli.js',
    protocol: mcp.initialized.protocolVersion,
    toolCount: tools.tools.length,
    matchedContextRecords: context.records.length,
    failedFindings: 1,
    correctedFindings: 0,
    handoffId: handoff.id,
    desktopMatchesVsCode: true,
  };
  await writeFile(
    join(evidence, 'shared-state-result.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await mcp.close();
}
