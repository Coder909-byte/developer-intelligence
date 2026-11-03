// Inspect D2's real adapters. No writes to user/editor/workspace configuration.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { generateHostConfig, previewConfigDiff } from '../packages/mcp-gateway/dist/index.js';
import { McpServerSchema } from '../packages/contracts/dist/index.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const temp = await mkdtemp(join(tmpdir(), 'udi-host-preview-'));
const now = new Date().toISOString();
const server = McpServerSchema.parse({
  id: randomUUID(),
  name: 'udi-acceptance-fixture',
  enabled: true,
  status: 'unknown',
  createdAt: now,
  updatedAt: now,
  transport: {
    type: 'stdio',
    executableId: process.execPath,
    args: [join(root, 'scripts/fixtures/aggregator-mcp.mjs')],
  },
});
const results = [];
try {
  for (const host of ['vscode', 'opencode']) {
    const file = join(temp, `${host}.json`);
    const existing =
      host === 'vscode'
        ? { inputs: [], servers: { existing: { type: 'stdio', command: 'existing-server' } } }
        : {
            theme: 'system',
            mcp: { existing: { type: 'local', command: ['existing-server'], enabled: false } },
          };
    const original = JSON.stringify(existing, null, 2) + '\n';
    await writeFile(file, original, { mode: 0o600 });
    const config = generateHostConfig(host, [
      server,
      { ...server, name: 'disabled-fixture', enabled: false },
    ]);
    const preview = previewConfigDiff(original, config);
    assert.equal(preview.hasChanges, true);
    assert.equal(await readFile(file, 'utf8'), original);
    assert(!JSON.stringify(config).includes('disabled-fixture'));
    const entries = host === 'vscode' ? config.servers : config.mcp;
    const generated = entries?.[server.name];
    const valid =
      host === 'vscode'
        ? generated?.command === process.execPath && !('mcpServers' in config)
        : generated?.type === 'local' &&
          generated.command?.[0] === process.execPath &&
          !('servers' in entries);
    results.push({
      host,
      preview: 'PASS: existing bytes unchanged; disabled integration excluded',
      schema: valid ? 'PASS' : 'BLOCKED: generated map differs from official host format',
      requiredFormat:
        host === 'vscode'
          ? '{ servers: { name: { command, args } } } in .vscode/mcp.json'
          : '{ mcp: { name: { type: "local", command: [...] } } } in opencode.json',
      apply:
        'NOT RUN: approval/merge/stale-preview guards are absent from existing low-level API; no real configuration changes authorized',
      runtime:
        host === 'vscode'
          ? 'Existing native extension verified separately; host MCP consumption NOT RUN'
          : 'OpenCode application consumption NOT RUN',
    });
  }
} finally {
  await rm(temp, { recursive: true, force: true });
}
const report = {
  status: 'BLOCKED',
  scope: 'adapter verification, no personal configuration modified',
  results,
};
const evidence = join(root, '.data/aggregator-integration');
await mkdir(evidence, { recursive: true });
await writeFile(join(evidence, 'hosts-result.json'), JSON.stringify(report, null, 2) + '\n', {
  mode: 0o600,
});
console.log(JSON.stringify(report, null, 2));
process.exitCode = 2;
