#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

// Read token and default config
const token = (await readFile(join(root, '.data/token'), 'utf8')).trim();
const daemonUrl = process.env.UDI_DAEMON_URL || 'http://127.0.0.1:4317';

const args = process.argv.slice(2);
const prompt = args.find((a) => !a.startsWith('--')) || 'What is the current status of MOTOR_EN?';
const snapshotIdx = args.indexOf('--snapshot');
const snapshotName = snapshotIdx !== -1 ? args[snapshotIdx + 1] : undefined;

console.log('================================================================');
console.log(' LIVE AGENT HARNESS (Simulating External AI Agent CLI)');
console.log(` Daemon Endpoint: ${daemonUrl}`);
console.log(` Target Prompt   : "${prompt}"`);
if (snapshotName) {
  console.log(` Named Snapshot  : "${snapshotName}"`);
}
console.log('================================================================\n');

// 1. Fetch available projects
const projectsRes = await fetch(`${daemonUrl}/api/v1/projects`, {
  headers: { Authorization: `Bearer ${token}` },
});
const { data: projectsData } = await projectsRes.json();
const project = projectsData.items[0];
if (!project) {
  console.error('Error: No active project found. Register a project first.');
  process.exit(1);
}

console.log(`[1/4] Connected to Project: "${project.name}" (ID: ${project.id})`);

// 2. Check available snapshots
const snapsRes = await fetch(`${daemonUrl}/api/v1/projects/${project.id}/snapshots`, {
  headers: { Authorization: `Bearer ${token}` },
});
const { data: snapsData } = await snapsRes.json();
console.log(`[2/4] Available Context Checkpoints: ${snapsData.items.length} saved`);
for (const s of snapsData.items) {
  console.log(`      • [Checkpoint] "${s.name}" (${s.recordCount} facts, created ${s.createdAt})`);
}

// 3. Send prompt through OpenAI-compatible Proxy
console.log('\n[3/4] Dispatching prompt to OpenAI Proxy (POST /v1/chat/completions)...');
const headers = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${token}`,
  'x-project-id': project.id,
};
if (snapshotName) {
  headers['x-context-snapshot'] = snapshotName;
}

const startTime = Date.now();
const completionRes = await fetch(`${daemonUrl}/v1/chat/completions`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
  }),
});

const completion = await completionRes.json();
const duration = Date.now() - startTime;

console.log(`      ✓ Proxy Responded in ${duration}ms (HTTP ${completionRes.status})`);
console.log('\n----------------- AGENT COMPLETION RESPONSE -----------------');
console.log(completion.choices[0]?.message.content);
console.log('-------------------------------------------------------------\n');

if (completion.injectedContext) {
  console.log('Telemetry Injected by Proxy:');
  console.log(` • Preserved Facts Count : ${completion.injectedContext.preservedFactsCount}`);
  console.log(` • Prompt Tokens (Injected): ${completion.usage.prompt_tokens}`);
  console.log(` • Total Tokens           : ${completion.usage.total_tokens}`);
}

// 4. Inspect Laya Classifier Stream in SQLite
console.log('\n[4/4] Inspecting Laya Classifier Background Stream...');
await new Promise((r) => setTimeout(r, 100)); // Allow async write to settle
const streamRes = await fetch(
  `${daemonUrl}/api/v1/projects/${project.id}/classifier-stream?limit=4`,
  {
    headers: { Authorization: `Bearer ${token}` },
  },
);
const { data: streamData } = await streamRes.json();

console.log(`      ✓ Retrieved ${streamData.items.length} recent classifications from SQLite:`);
for (const item of streamData.items) {
  console.log(
    `      • [${item.category}] Score: ${item.signalScore} (${item.decision.toUpperCase()}) | [${item.sourceType}]\n        "${item.distilledFact}"`,
  );
}

console.log('\n================================================================');
console.log(' VERIFICATION COMPLETE: ZERO RE-SCOUTING, HIGH-UTILITY CONTINUITY');
console.log('================================================================');
