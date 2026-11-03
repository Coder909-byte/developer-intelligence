// Exercises the installed VS Code GUI through CDP. No VS Code API stubs or
// synthetic validator outputs. Launch the isolated host using FINAL_RUNTIME.md.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createClient } from '../packages/client-sdk/dist/index.js';
import { connectRenderer } from './lib/cdp.mjs';

const root = resolve(import.meta.dirname, '..');
const data = resolve(process.env.UDI_DATA_DIR ?? join(root, '.data/final-runtime/daemon'));
const evidence = join(root, '.data/final-runtime/evidence');
await mkdir(evidence, { recursive: true });
const port = Number(process.env.UDI_VSCODE_CDP_PORT ?? 9334);
const token = (await readFile(join(data, 'token'), 'utf8')).trim();
const api = createClient({ baseUrl: process.env.UDI_DAEMON_URL ?? 'http://127.0.0.1:4317', token });
const ui = await connectRenderer(port);
const wait = async (read, label) => {
  const end = Date.now() + 20000;
  while (Date.now() < end) {
    const result = await read();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Runtime verification timed out: ${label}`);
};
const inputReady = (title) =>
  ui.waitFor(
    `document.querySelector('.quick-input-title')?.textContent === ${JSON.stringify(title)} && !!document.querySelector('.quick-input-widget input:focus')`,
    title,
  );
async function dismissCompletion() {
  // Close presentation notifications after independently observing live refresh.
  await ui.command('Notifications: Clear All Notifications');
}
async function snapshot(name) {
  await ui.screenshot(join(evidence, `${port}-${name}.png`));
  await writeFile(join(evidence, `${port}-${name}.txt`), await ui.body());
}
try {
  assert.equal((await api.health()).capabilities.engineering, true);
  await ui.key('Escape');
  await ui.command('Developer Intelligence: Set Daemon Token');
  await inputReady('Local daemon token');
  await ui.input(token); // Never log or capture screenshots of this input.
  await ui.command('Developer Intelligence: Focus on Workspace View');
  let project = (await api.listProjects()).items.find(
    (p) => p.rootPath === join(root, 'examples/rover'),
  );
  if (!project) {
    await ui.command('Developer Intelligence: Register Workspace');
    await ui.waitFor(
      `!!document.querySelector('.quick-input-list .monaco-list-row')`,
      'workspace picker',
    );
    await ui.key('Enter');
    await inputReady('Register workspace');
    await ui.input('Hackathon Rover');
    await ui.clickText('Register');
    project = await wait(
      async () =>
        (await api.listProjects()).items.find((p) => p.rootPath === join(root, 'examples/rover')),
      'registered rover project',
    );
  }
  await ui.command('Developer Intelligence: Select Project');
  await ui.waitFor(
    `document.querySelector('.quick-input-list')?.innerText.includes(${JSON.stringify(project.name)})`,
    'registered rover selection',
  );
  await ui.key('Enter');
  await ui.waitText(project.name);
  await ui.command('Developer Intelligence:', false);
  const commands = await ui.evaluate(`document.querySelector('.quick-input-widget').innerText`);
  assert.match(commands, /18 Results/); // 17 manifest commands + contributed view focus.
  await snapshot('commands');
  await ui.key('Escape');
  async function validate(header, status) {
    const before = new Set(
      (await api.listEvents(project.id, { limit: 500 })).items.map((e) => e.id),
    );
    await ui.command('Developer Intelligence: Validate Engineering Project');
    await inputReady('Pin consistency artifact paths');
    await ui.input(`rover.net; ${header}; engineering-map.json`);
    await ui.clickText('Run validation');
    const event = await wait(
      async () =>
        (await api.listEvents(project.id, { limit: 500 })).items.find(
          (e) => !before.has(e.id) && e.type === 'engineering.validation.completed',
        ),
      'real extension validation event',
    );
    const job = await api.getJob(project.id, event.payload.jobId);
    assert.equal(job.status, status);
    assert.equal(job.exitCode, status === 'failed' ? 1 : 0);
    await ui.waitText(`Validation job recorded: ${job.id}`);
    // Main's native completion-event polling must update the selected job even
    // while the completed-job notification remains open.
    await ui.waitText(`selected job ${job.id}`);
    await dismissCompletion();
    await ui.waitText(`selected job ${job.id}`);
    return job;
  }
  const failed = await validate('src/pins.h', 'failed');
  const findings = (await api.listFindings(project.id, { jobId: failed.id })).items;
  assert.equal(findings.length, 1);
  assert.equal(findings[0].expected.pin, 'GPIO14');
  assert.equal(findings[0].observed.pin, 'GPIO26');
  if (!(await ui.evaluate(`!!document.querySelector('.markers-panel')`)))
    await ui.command('View: Toggle Problems');
  await ui.waitText('[Ln 28, Col 1]');
  await ui.waitText('[Ln 7, Col 1]');
  await snapshot('mismatch');
  await ui.command('Developer Intelligence: Review Engineering Findings');
  await ui.waitFor(
    `document.querySelector('.quick-input-widget input:focus')?.placeholder.includes('Inspect finding') && Array.from(document.querySelectorAll('.quick-input-list .monaco-list-row')).some(e=>e.offsetParent!==null && e.innerText.includes('MOTOR_EN'))`,
    'finding picker',
  );
  await ui.evaluate(
    `Array.from(document.querySelectorAll('.quick-input-list .monaco-list-row')).find(e=>e.offsetParent!==null && e.innerText.includes('MOTOR_EN')).click()`,
  );
  await ui.waitFor(
    `document.querySelector('.quick-input-widget input:focus')?.placeholder.includes('Open source') && Array.from(document.querySelectorAll('.quick-input-list .monaco-list-row')).some(e=>e.offsetParent!==null && e.innerText.startsWith('src/pins.h'))`,
    'source evidence picker',
  );
  await ui.evaluate(
    `Array.from(document.querySelectorAll('.quick-input-list .monaco-list-row')).find(e=>e.offsetParent!==null && e.innerText.startsWith('src/pins.h')).click()`,
  );
  await ui.waitFor(
    `Array.from(document.querySelectorAll('.tab.active .label-name')).some(e=>e.textContent==='pins.h')`,
    'active firmware source editor',
  );
  // Capturing the real frame also flushes an occluded Electron window's paint.
  await ui.screenshot(join(evidence, `${port}-source-evidence.png`));
  await ui.waitFor(
    `document.getElementById('status.editor.selection')?.textContent.includes('Ln 7, Col 1')`,
    'source cursor at evidence line 7',
  );
  await snapshot('source-evidence');
  const passed = await validate('src/pins_corrected.h', 'succeeded');
  assert.equal((await api.listFindings(project.id, { jobId: passed.id })).items.length, 0);
  await ui.waitText('No problems have been detected in the workspace.');
  await snapshot('corrected');
  await ui.command('Developer Intelligence: Record Project Decision');
  await inputReady('Record project decision');
  const decision = `VS Code ${port}: retain GPIO14 hardware mapping; corrected fixture passed job ${passed.id}.`;
  await ui.input(decision);
  await ui.clickText('Save decision');
  await ui.waitText('Decision saved to the daemon.');
  await dismissCompletion();
  await ui.command('Developer Intelligence: Create Saved Handoff');
  await ui.waitFor(
    `document.querySelector('[aria-label="Toggle all checkboxes"]')?.offsetParent!==null && document.querySelector('[aria-label="Toggle all checkboxes"]')?.offsetParent!==undefined`,
    'handoff context selection',
  );
  await ui.evaluate(`document.querySelector('[aria-label="Toggle all checkboxes"]').click()`);
  await ui.clickText('OK');
  await inputReady('From agent UUID');
  await ui.input('b07a7a4d-c625-4ec4-a680-0063421b2120');
  await inputReady('Handoff summary');
  await ui.input(
    `Actual VS Code ${port}: mismatch ${failed.id}; corrected ${passed.id} succeeded.`,
  );
  await inputReady('Next steps (optional)');
  await ui.input('Retrieve the stored context through MCP; present the source evidence');
  await ui.clickText('Save handoff');
  await ui.waitText('Handoff saved:');
  await dismissCompletion();
  await ui.command('Developer Intelligence: Retrieve Latest Handoff');
  const handoffs = (await api.listHandoffs(project.id, { limit: 500 })).items;
  const handoff = handoffs.find((h) => h.summary.includes(passed.id));
  assert(handoff && handoff.recordIds.length >= 3);
  await ui.waitText(handoff.id);
  await snapshot('handoff');
  await ui.command('Developer Intelligence: Get Project Context');
  const context = await api.getContext(project.id);
  assert(
    context.records.some((r) => r.text === decision && r.provenance.sourceKind === 'user_entered'),
  );
  for (const job of [failed, passed])
    assert(
      context.records.some(
        (r) => r.provenance.sourceRef === job.id && r.provenance.sourceKind === 'observed_tool',
      ),
    );
  await ui.waitText(project.id);
  await ui.command('Developer Intelligence: Open Desktop Dashboard');
  const result = {
    realVsCodeWindow: ui.target.title,
    cdpPort: port,
    projectId: project.id,
    failedJobId: failed.id,
    passedJobId: passed.id,
    handoffId: handoff.id,
    findings: 1,
    sourceDiagnostics: 2,
    correctedFindings: 0,
    currentProblemsCleared: true,
    contextRecords: context.records.length,
    registeredManifestCommands: 17,
    dashboardCommandInvoked: true,
  };
  await writeFile(join(evidence, `${port}-result.json`), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} finally {
  ui.close();
}
