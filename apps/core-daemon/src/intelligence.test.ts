import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { createClient } from '@udi/client-sdk';
import { buildApp } from './app.js';
import { createDefaultIntegrations } from './integrations.js';

const repoRoot = resolve(import.meta.dirname, '../../..');
const roverDir = resolve(repoRoot, 'examples/rover');

describe('Daemon intelligence engine integrations', () => {
  async function setup() {
    const dataDir = await mkdtemp(join(tmpdir(), 'udi-intelligence-test-'));
    const token = randomBytes(32).toString('hex');
    const app = buildApp({
      databasePath: join(dataDir, 'test.sqlite'),
      token,
      logger: false,
      integrations: createDefaultIntegrations,
    });
    await app.ready();
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const url = new URL(address);

    const client = createClient({
      baseUrl: `http://127.0.0.1:${url.port}`,
      token,
    });

    const cleanup = async () => {
      await app.close();
      await rm(dataDir, { recursive: true, force: true });
    };

    return { client, cleanup };
  }

  it('reports all intelligence capabilities active in health check', async () => {
    const { client, cleanup } = await setup();
    try {
      const health = await client.health();
      expect(health.status).toBe('ok');
      expect(health.capabilities).toEqual({
        projects: true,
        context: true,
        mcp: true,
        engineering: true,
      });
    } finally {
      await cleanup();
    }
  });

  it('runs deterministic pin consistency validation job and persists findings and events', async () => {
    const { client, cleanup } = await setup();
    try {
      // 1. Create project pointing to examples/rover
      const project = await client.createProject({
        name: 'Rover Test Project',
        rootPath: roverDir,
        description: 'KiCad and firmware rover test',
      });

      // 2. Run validation on mismatched pins.h
      const job = await client.requestValidation(project.id, {
        kind: 'pin_consistency',
        artifactPaths: ['rover.net', 'src/pins.h', 'engineering-map.json'],
        requestedBy: 'intelligence-test-suite',
      });

      expect(job.status).toBe('failed');
      expect(job.exitCode).toBe(1);

      // 3. Verify finding was persisted and is retrievable
      const { items: findings } = await client.listFindings(project.id, {
        jobId: job.id,
      });
      expect(findings).toHaveLength(1);
      const mismatch = findings[0]!;
      expect(mismatch.ruleId).toBe('pin_consistency');
      expect(mismatch.severity).toBe('error');
      expect(mismatch.message).toContain('MOTOR_EN');
      expect(mismatch.suggestedFix).toContain('#define MOTOR_EN GPIO14');

      // 4. Verify activity event was recorded with observed_tool provenance
      const { items: events } = await client.listEvents(project.id);
      const validationEvent = events.find(
        (e) => e.type === 'engineering.validation.completed',
      );
      expect(validationEvent).toBeDefined();
      expect(validationEvent?.sourceKind).toBe('observed_tool');
      expect(validationEvent?.actor).toBe('engineering-core');

      // 5. Run validation on corrected pins_corrected.h -> succeeds
      const passJob = await client.requestValidation(project.id, {
        kind: 'pin_consistency',
        artifactPaths: ['rover.net', 'src/pins_corrected.h', 'engineering-map.json'],
        requestedBy: 'intelligence-test-suite',
      });
      expect(passJob.status).toBe('succeeded');
      expect(passJob.exitCode).toBe(0);

      const { items: passFindings } = await client.listFindings(project.id, {
        jobId: passJob.id,
      });
      expect(passFindings).toHaveLength(0);
    } finally {
      await cleanup();
    }
  });

  it('synthesizes verified project context and handles agent handoffs', async () => {
    const { client, cleanup } = await setup();
    try {
      const project = await client.createProject({
        name: 'Context Test Project',
        rootPath: roverDir,
      });

      // Add a decision context record
      const record = await client.createContextRecord(project.id, {
        kind: 'decision',
        text: 'Align firmware pin defines with KiCad netlist',
        provenance: { sourceKind: 'user_entered', actor: 'engineer' },
        evidence: [],
      });

      // Add an issue record
      await client.createContextRecord(project.id, {
        kind: 'issue',
        text: 'MOTOR_EN assigned to GPIO26 instead of GPIO14',
        provenance: { sourceKind: 'observed_tool', actor: 'engineering-core' },
        evidence: [{ filePath: 'src/pins.h', line: 6 }],
      });

      // Query synthesized context
      const memory = await client.getContext(project.id);
      expect(memory.projectId).toBe(project.id);
      expect(memory.records).toHaveLength(2);
      expect(memory.openIssues).toContain(
        'MOTOR_EN assigned to GPIO26 instead of GPIO14',
      );

      // Create an agent handoff
      const handoff = await client.createHandoff(project.id, {
        fromAgentId: randomUUID(),
        summary: 'Identified pin mismatch on MOTOR_EN; patch required',
        recordIds: [record.id],
        nextSteps: ['Apply fix to src/pins.h', 'Rerun engineering validation'],
        provenance: { sourceKind: 'agent_summary', actor: 'agent-1' },
      });

      expect(handoff.id).toBeDefined();

      // Retrieve handoffs
      const { items: handoffs } = await client.listHandoffs(project.id);
      expect(handoffs).toHaveLength(1);
      expect(handoffs[0]?.summary).toBe(handoff.summary);
    } finally {
      await cleanup();
    }
  });

  it('performs live MCP server health checks via daemon', async () => {
    const { client, cleanup } = await setup();
    try {
      const server = await client.createMcpServer({
        name: 'test-node-mcp',
        enabled: true,
        transport: {
          type: 'stdio',
          executableId: process.execPath,
          args: ['-v'],
        },
      });

      expect(server.status).toBe('unknown');

      // Call health check route
      const checked = await client.checkMcpServerHealth(server.id);
      expect(checked.id).toBe(server.id);
      expect(checked.status).toBe('healthy');
    } finally {
      await cleanup();
    }
  });
});
