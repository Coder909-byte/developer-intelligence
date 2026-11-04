import { describe, it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { buildApp } from './app.js';
import { createDefaultIntegrations } from './integrations.js';

describe('HTTP JSON-RPC MCP Gateway Endpoints', () => {
  async function setup() {
    const dataDir = await mkdtemp(join(tmpdir(), 'udi-mcp-http-test-'));
    const token = randomBytes(32).toString('hex');
    const app = buildApp({
      databasePath: join(dataDir, 'test.sqlite'),
      token,
      logger: false,
      integrations: createDefaultIntegrations,
    });

    await app.ready();
    const addr = await app.listen({ host: '127.0.0.1', port: 0 });
    const u = new URL(addr);
    const baseUrl = `http://127.0.0.1:${u.port}`;

    const workspaceDir = await mkdtemp(join(tmpdir(), 'udi-workspace-'));
    const cleanup = async () => {
      await app.close();
      await rm(dataDir, { recursive: true, force: true });
      await rm(workspaceDir, { recursive: true, force: true });
    };

    return { baseUrl, token, workspaceDir, cleanup };
  }

  it('handles MCP initialize, tools/list, and tools/call over HTTP JSON-RPC', async () => {
    const { baseUrl, token, cleanup } = await setup();
    try {
      // 1. GET /mcp info probe
      const infoRes = await fetch(`${baseUrl}/mcp`);
      expect(infoRes.status).toBe(200);
      const info = await infoRes.json();
      expect(info.status).toBe('active');
      expect(info.toolsCount).toBeGreaterThan(0);

      // 2. POST /mcp initialize
      const initRes = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {},
        }),
      });
      expect(initRes.status).toBe(200);
      const initJson = await initRes.json();
      expect(initJson.result.serverInfo.name).toBe('developer-intelligence-gateway');

      // 3. POST /mcp tools/list
      const listRes = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': token,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list',
          params: {},
        }),
      });
      expect(listRes.status).toBe(200);
      const listJson = await listRes.json();
      expect(Array.isArray(listJson.result.tools)).toBe(true);
      const toolNames = listJson.result.tools.map((t: { name: string }) => t.name);
      expect(toolNames).toContain('get_project_context');
      // 4. POST /mcp tools/call (list_available_tools)
      const callRes = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: {
            name: 'list_available_tools',
            arguments: {},
          },
        }),
      });
      expect(callRes.status).toBe(200);
      const callJson = await callRes.json();
      expect(callJson.result.structuredContent.tools).toContain('get_project_context');
    } finally {
      await cleanup();
    }
  });
});
