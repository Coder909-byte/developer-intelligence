#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createClient } from '@udi/client-sdk';
import { DefaultMcpGateway } from './gateway.js';

async function main(): Promise<void> {
  let baseUrl = process.env.UDI_DAEMON_URL ?? process.env.UDI_URL ?? 'http://127.0.0.1:4317';
  let token = process.env.UDI_TOKEN;
  let projectId = process.env.UDI_PROJECT_ID;

  // Parse command line arguments
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--project-id' && args[i + 1]) {
      projectId = args[i + 1];
      i++;
    } else if (args[i] === '--token' && args[i + 1]) {
      token = args[i + 1];
      i++;
    } else if (args[i] === '--url' && args[i + 1]) {
      baseUrl = args[i + 1]!;
      i++;
    }
  }

  // Attempt to read token from disk if not provided in environment
  if (!token) {
    const searchDirs = [
      process.env.UDI_DATA_DIR,
      resolve(process.cwd(), '.data'),
      resolve(import.meta.dirname, '../../../.data'),
    ].filter((d): d is string => Boolean(d));

    for (const dir of searchDirs) {
      try {
        const tokenContent = await readFile(join(dir, 'token'), 'utf-8');
        token = tokenContent.trim();
        if (token) break;
      } catch {
        // Continue searching
      }
    }
  }

  if (!token) {
    console.error(
      '[udi-mcp] Error: A local daemon token is required. Set UDI_TOKEN or generate one via core-daemon.',
    );
    process.exit(1);
  }

  const client = createClient({ baseUrl, token, timeoutMs: 25000 });

  // If no projectId was passed, query daemon for active projects
  if (!projectId) {
    try {
      const { items } = await client.listProjects();
      if (items.length > 0) {
        projectId = items[0]!.id;
        console.error(`[udi-mcp] Auto-selected active project: ${items[0]!.name} (${projectId})`);
      }
    } catch (err) {
      console.error(
        `[udi-mcp] Warning: Could not query projects from daemon: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (!projectId) {
    projectId = '00000000-0000-0000-0000-000000000000';
  }

  console.error(
    `[udi-mcp] Initializing MCP Gateway for project ${projectId} connected to ${baseUrl}`,
  );
  const gateway = new DefaultMcpGateway({ client, projectId });
  await gateway.start();
  console.error(
    '[udi-mcp] MCP Gateway stdio transport running. Listening for JSON-RPC messages...',
  );

  const shutdown = async () => {
    console.error('[udi-mcp] Shutting down MCP Gateway...');
    await gateway.stop();
    process.exit(0);
  };

  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
}

main().catch((err) => {
  console.error('[udi-mcp] Fatal error:', err);
  process.exit(1);
});
