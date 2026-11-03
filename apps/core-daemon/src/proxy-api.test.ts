import { describe, it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createClient } from '@udi/client-sdk';
import { buildApp } from './app.js';
import { createDefaultIntegrations } from './integrations.js';

describe('Daemon OpenAI Proxy & Context Injection Endpoints', () => {
  async function setup() {
    const dataDir = await mkdtemp(join(tmpdir(), 'udi-proxy-test-'));
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
    const client = createClient({ baseUrl, token });

    const workspaceDir = await mkdtemp(join(tmpdir(), 'udi-workspace-'));
    const cleanup = async () => {
      await app.close();
      await rm(dataDir, { recursive: true, force: true });
      await rm(workspaceDir, { recursive: true, force: true });
    };

    return { client, baseUrl, token, workspaceDir, cleanup };
  }

  it('injects compressed ground-truth context and classifies user/assistant turns', async () => {
    const { client, workspaceDir, cleanup } = await setup();
    try {
      // 1. Create a project
      const project = await client.createProject({
        name: 'Rover Autonomous Unit',
        rootPath: workspaceDir,
      });

      // 2. Seed verified hardware fact into SQLite
      await client.createContextRecord(project.id, {
        kind: 'fact',
        text: 'Signal MOTOR_EN pin mapped to GPIO14 per schematic rover.net:28',
        provenance: {
          actor: 'engineering-core',
          sourceKind: 'observed_tool',
        },
        evidence: [{ filePath: 'rover.net', line: 28 }],
      });

      // 3. Make chat completion call through proxy
      const response = await client.chatCompletion(
        {
          model: 'gpt-4o',
          messages: [
            {
              role: 'user',
              content: 'What is the MOTOR_EN pin mapping for this rover?',
            },
          ],
        },
        {
          'x-project-id': project.id,
        },
      );

      // 4. Verify standard OpenAI completion envelope
      expect(response.id).toMatch(/^chatcmpl-/);
      expect(response.object).toBe('chat.completion');
      expect(response.choices).toHaveLength(1);
      expect(response.choices[0]?.message.role).toBe('assistant');
      expect(response.choices[0]?.message.content).toContain('GPIO14');

      // 5. Verify Injected Context Telemetry
      expect(response.injectedContext).toBeDefined();
      expect(response.injectedContext?.preservedFactsCount).toBeGreaterThanOrEqual(1);

      // 6. Verify Compression Metrics Endpoint
      const metrics = await client.getCompressionMetrics(project.id);
      expect(metrics.projectId).toBe(project.id);
      expect(metrics.totalRawTokens).toBeGreaterThan(0);
      expect(metrics.totalCompressedTokens).toBeGreaterThan(0);
      expect(metrics.preservedFactsCount).toBeGreaterThanOrEqual(1);

      // 7. Verify Classifier Decision Stream
      // Wait briefly for asynchronous classifier writes to settle
      await new Promise((r) => setTimeout(r, 80));
      const stream = await client.listClassifierStream(project.id, 20);
      expect(stream.items.length).toBeGreaterThan(0);
      const userItem = stream.items.find((i) => i.sourceType === 'user_message');
      expect(userItem).toBeDefined();
      expect(userItem?.projectId).toBe(project.id);

      // 8. Test Named Snapshot Creation and Cross-Harness Injection
      const snapshot = await client.createSnapshot(project.id, {
        name: 'rover-checkpoint-motor-fixed',
        description: 'Verified hardware pinout mapping for rover',
      });
      expect(snapshot.id).toBeDefined();
      expect(snapshot.name).toBe('rover-checkpoint-motor-fixed');
      expect(snapshot.activeInvariants.length).toBeGreaterThanOrEqual(1);
      expect(snapshot.injectedPromptBlock).toContain('rover-checkpoint-motor-fixed');

      const listedSnapshots = await client.listSnapshots(project.id);
      expect(listedSnapshots.items).toHaveLength(1);
      expect(listedSnapshots.items[0]?.name).toBe('rover-checkpoint-motor-fixed');

      // Call proxy with x-context-snapshot header
      const snapResponse = await client.chatCompletion(
        {
          model: 'gpt-4o',
          messages: [{ role: 'user', content: 'What was saved in the checkpoint?' }],
        },
        {
          'x-project-id': project.id,
          'x-context-snapshot': 'rover-checkpoint-motor-fixed',
        },
      );
      expect(snapResponse.choices[0]?.message.content).toBeDefined();
    } finally {
      await cleanup();
    }
  });

  it('handles Claude Code Anthropic Messages API format and x-api-key authentication', async () => {
    const { client, workspaceDir, cleanup } = await setup();
    try {
      const project = await client.createProject({
        name: 'Rover Claude Test',
        rootPath: workspaceDir,
      });

      const response = await client.anthropicMessage(
        {
          model: 'claude-3-5-sonnet-20241022',
          messages: [{ role: 'user', content: 'What is the motor configuration?' }],
        },
        {
          'x-project-id': project.id,
        },
      );

      expect(response.id).toMatch(/^msg_/);
      expect(response.type).toBe('message');
      expect(response.role).toBe('assistant');
      expect(response.content[0]?.text).toBeDefined();
      expect(response.usage.input_tokens).toBeGreaterThan(0);
    } finally {
      await cleanup();
    }
  });

  it('rejects unauthenticated proxy requests with 401', async () => {
    const { baseUrl, cleanup } = await setup();
    try {
      const badClient = createClient({ baseUrl, token: 'invalid-token-1234567890123456789012' });
      await expect(
        badClient.chatCompletion({
          messages: [{ role: 'user', content: 'hello' }],
        }),
      ).rejects.toMatchObject({ status: 401 });
    } finally {
      await cleanup();
    }
  });
});
