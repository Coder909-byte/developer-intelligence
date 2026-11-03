#!/usr/bin/env node
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const dataDir = join(root, '.data');
const tokenPath = join(dataDir, 'token');
const daemonUrl = process.env.UDI_DAEMON_URL || 'http://127.0.0.1:4317';

async function getToken() {
  if (existsSync(tokenPath)) {
    return (await readFile(tokenPath, 'utf8')).trim();
  }
  return process.env.UDI_TOKEN || '';
}

async function getProject(token) {
  try {
    const res = await fetch(`${daemonUrl}/api/v1/projects`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return undefined;
    const json = await res.json();
    return json.data?.items?.[0];
  } catch {
    return undefined;
  }
}

async function safeWriteJson(targetPath, updater) {
  let existing = {};
  if (existsSync(targetPath)) {
    try {
      const raw = await readFile(targetPath, 'utf8');
      existing = JSON.parse(raw);
      await copyFile(targetPath, `${targetPath}.bak`);
    } catch {
      existing = {};
    }
  } else {
    await mkdir(resolve(targetPath, '..'), { recursive: true });
  }

  const updated = updater(existing);
  await writeFile(targetPath, JSON.stringify(updated, null, 2) + '\n', { mode: 0o600 });
  return targetPath;
}

const command = process.argv[2] || 'status';
const token = await getToken();

if (!token) {
  console.error('[!] Error: No token found at .data/token. Is the core daemon running?');
  console.error('    Start it via: pnpm dev:core');
  process.exit(1);
}

const project = await getProject(token);
const projectId = project?.id || process.env.UDI_PROJECT_ID || 'rover-demo';
const projectName = project?.name || 'Active Project';
const gatewayCliPath = join(root, 'packages/mcp-gateway/dist/cli.js');

switch (command) {
  case 'env': {
    // Outputs clean shell exports so caller can do: eval $(node scripts/route.mjs env)
    console.log(`export OPENAI_BASE_URL="${daemonUrl}/v1"`);
    console.log(`export OPENAI_API_KEY="${token}"`);
    console.log(`export ANTHROPIC_BASE_URL="${daemonUrl}/v1"`);
    console.log(`export ANTHROPIC_API_KEY="${token}"`);
    console.log(`export UDI_PROJECT_ID="${projectId}"`);
    console.log(`export UDI_TOKEN="${token}"`);
    console.log(`export UDI_DAEMON_URL="${daemonUrl}"`);
    break;
  }

  case 'vscode': {
    console.log('--- Configuring VS Code Extensions for Universal Developer Intelligence ---');

    // 1. Configure .vscode/mcp.json for native VS Code MCP & Claude Code
    const mcpPath = join(root, '.vscode/mcp.json');
    await safeWriteJson(mcpPath, (existing) => {
      const servers = existing.servers || existing.mcpServers || {};
      servers['developer-intelligence'] = {
        type: 'stdio',
        command: 'node',
        args: [gatewayCliPath],
        env: {
          UDI_PROJECT_ID: projectId,
          UDI_TOKEN: token,
          UDI_DAEMON_URL: daemonUrl,
        },
      };
      return { ...existing, servers };
    });
    console.log(`✓ Updated ${mcpPath} (Backup saved as .bak)`);

    // 2. Configure .vscode/settings.json for Cline, Continue & Roo Code
    const settingsPath = join(root, '.vscode/settings.json');
    await safeWriteJson(settingsPath, (existing) => {
      return {
        ...existing,
        // Continue extension config
        'continue.models': [
          ...(existing['continue.models'] || []).filter(
            (m) => m.name !== 'UDI Proxy (Ground Truth)',
          ),
          {
            name: 'UDI Proxy (Ground Truth)',
            provider: 'openai',
            model: 'default',
            apiBase: `${daemonUrl}/v1`,
            apiKey: token,
            requestOptions: {
              headers: {
                'x-project-id': projectId,
              },
            },
          },
        ],
        // Cline / Roo Code settings hints
        'cline.apiProvider': 'openai-compatible',
        'cline.openAiBaseUrl': `${daemonUrl}/v1`,
        'cline.openAiApiKey': token,
        'cline.openAiCustomHeaders': {
          'x-project-id': projectId,
        },
      };
    });
    console.log(`✓ Updated ${settingsPath} (Configured for Cline, Continue & Roo Code)`);
    console.log('\nAll VS Code AI extensions in this workspace are now routed through UDI!');
    break;
  }

  case 'claude': {
    console.log('--- Claude Code CLI Configuration ---');
    console.log('To connect Claude Code to the Universal Intelligence Gateway, run:');
    console.log(`\n  claude mcp add developer-intelligence -- node "${gatewayCliPath}"\n`);
    console.log('Or use the local-first environment proxy:');
    console.log(`  export ANTHROPIC_BASE_URL="${daemonUrl}/v1"`);
    console.log(`  export ANTHROPIC_API_KEY="${token}"\n`);
    break;
  }

  case 'snapshot': {
    const name = process.argv[3];
    if (!name) {
      console.error('Usage: node scripts/route.mjs snapshot <checkpoint-name>');
      process.exit(1);
    }
    const res = await fetch(`${daemonUrl}/api/v1/projects/${projectId}/snapshots`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        name,
        description: `Manual checkpoint saved via route CLI at ${new Date().toISOString()}`,
      }),
    });
    const json = await res.json();
    if (res.ok) {
      console.log(`✓ Checkpoint "${name}" successfully saved! (ID: ${json.data.id})`);
      console.log(`  Records bundled: ${json.data.recordCount}`);
      console.log(`  To inject into any agent: pass header "x-context-snapshot: ${name}"`);
    } else {
      console.error(`Failed to save checkpoint: ${json.error?.message || res.status}`);
    }
    break;
  }

  case 'test': {
    console.log('--- Testing Live Route to Core Daemon Proxy ---');
    const startTime = Date.now();
    const res = await fetch(`${daemonUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'x-project-id': projectId,
      },
      body: JSON.stringify({
        model: 'default',
        messages: [{ role: 'user', content: 'Route diagnostic check: verify ground truth.' }],
      }),
    });
    const duration = Date.now() - startTime;
    if (res.ok) {
      const data = await res.json();
      console.log(`✓ Route Active! Proxy latency: ${duration}ms (HTTP 200)`);
      console.log(
        `  Injected Context: ${data.injectedContext?.preservedFactsCount || 0} facts verified`,
      );
      console.log(`  Response: "${data.choices[0]?.message?.content}"`);
    } else {
      console.error(`Route test failed with HTTP ${res.status}`);
    }
    break;
  }

  case 'status':
  default: {
    console.log('================================================================');
    console.log(' UNIVERSAL DEVELOPER INTELLIGENCE — ROUTING HUB');
    console.log('================================================================');
    console.log(` Daemon Endpoint : ${daemonUrl}`);
    console.log(` Active Project  : "${projectName}" (${projectId})`);
    console.log(` Token Stored    : ${token.slice(0, 8)}...${token.slice(-6)}`);
    console.log(` Gateway CLI     : ${gatewayCliPath}`);
    console.log('\n--- Quick Commands ---');
    console.log(' 1. Auto-configure VS Code / Cline / Continue:');
    console.log('    node scripts/route.mjs vscode');
    console.log('\n 2. Export environment for Codex / Claude CLI / Terminal agents:');
    console.log('    eval $(node scripts/route.mjs env)');
    console.log('\n 3. View Claude Code CLI setup:');
    console.log('    node scripts/route.mjs claude');
    console.log('\n 4. Save current session as a named checkpoint:');
    console.log('    node scripts/route.mjs snapshot <name>');
    console.log('\n 5. Test route health and ground-truth injection:');
    console.log('    node scripts/route.mjs test');
    console.log('================================================================\n');
    break;
  }
}
