import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, cp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createClient } from '@udi/client-sdk';
import { buildApp } from './app.js';
import { createDefaultIntegrations } from './integrations.js';

const repoRoot = resolve(import.meta.dirname, '../../..');
const roverFixtureDir = resolve(repoRoot, 'examples/rover');

describe('Daemon safe correction API endpoints', () => {
  async function setup() {
    const dataDir = await mkdtemp(join(tmpdir(), 'udi-correction-api-data-'));
    const tempWorkspace = await mkdtemp(join(tmpdir(), 'udi-correction-workspace-'));
    const workspace = join(tempWorkspace, 'rover');
    await cp(roverFixtureDir, workspace, { recursive: true });

    const token = randomBytes(32).toString('hex');
    let app = buildApp({
      databasePath: join(dataDir, 'test.sqlite'),
      token,
      logger: false,
      integrations: createDefaultIntegrations,
    });
    await app.ready();
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const url = new URL(address);

    const baseUrl = `http://127.0.0.1:${url.port}`;
    const client = createClient({
      baseUrl,
      token,
    });

    const restart = async () => {
      await app.close();
      app = buildApp({
        databasePath: join(dataDir, 'test.sqlite'),
        token,
        logger: false,
        integrations: createDefaultIntegrations,
      });
      await app.ready();
      const addr = await app.listen({ host: '127.0.0.1', port: 0 });
      const u = new URL(addr);
      return createClient({
        baseUrl: `http://127.0.0.1:${u.port}`,
        token,
      });
    };

    const cleanup = async () => {
      await app.close();
      await rm(dataDir, { recursive: true, force: true });
      await rm(tempWorkspace, { recursive: true, force: true });
    };

    return { client, workspace, baseUrl, restart, cleanup };
  }

  it('runs the full preview -> apply -> revalidation -> rollback workflow with persistent jobs across restart', async () => {
    const { client, workspace, restart, cleanup } = await setup();
    try {
      // 1. Create project pointing to temporary copy of rover
      const project = await client.createProject({
        name: 'Rover Safe Correction Demo',
        rootPath: workspace,
      });

      // 2. Run initial validation detecting MOTOR_EN mismatch
      const initialJob = await client.requestValidation(project.id, {
        kind: 'pin_consistency',
        artifactPaths: ['rover.net', 'src/pins.h', 'engineering-map.json'],
        requestedBy: 'correction-test',
      });
      expect(initialJob.status).toBe('failed');

      const { items: findings } = await client.listFindings(project.id, {
        jobId: initialJob.id,
      });
      expect(findings).toHaveLength(1);
      const finding = findings[0]!;
      expect(finding.ruleId).toBe('pin_consistency');

      // 3. Request preview
      const preview = await client.previewCorrection(project.id, {
        findingId: finding.id,
      });

      expect(preview.projectId).toBe(project.id);
      expect(preview.findingId).toBe(finding.id);
      expect(preview.targetFile).toBe('src/pins.h');
      expect(preview.originalLineText).toBe('#define MOTOR_EN GPIO26');
      expect(preview.proposedLineText).toBe('#define MOTOR_EN GPIO14');
      expect(preview.diff).toContain('- #define MOTOR_EN GPIO26');
      expect(preview.diff).toContain('+ #define MOTOR_EN GPIO14');

      // Verify file is untouched
      const preApplyContent = await readFile(join(workspace, 'src/pins.h'), 'utf-8');
      expect(preApplyContent).toContain('#define MOTOR_EN GPIO26');

      // 4. Apply with approval
      const applyResult = await client.applyCorrection(project.id, {
        previewId: preview.id,
        findingId: finding.id,
        expectedOriginalHash: preview.originalHash,
        userApproved: true,
      });

      expect(applyResult.ok).toBe(true);
      expect(applyResult.targetFile).toBe('src/pins.h');
      expect(applyResult.backupPath).toBe('src/pins.h.bak');

      // Verify revalidation job succeeded with 0 findings
      expect(applyResult.revalidationJob.status).toBe('succeeded');
      expect(applyResult.revalidationFindings).toHaveLength(0);

      // Verify file now contains GPIO14
      const postApplyContent = await readFile(join(workspace, 'src/pins.h'), 'utf-8');
      expect(postApplyContent).toContain('#define MOTOR_EN GPIO14');

      // Verify backup contains GPIO26
      const backupContent = await readFile(join(workspace, 'src/pins.h.bak'), 'utf-8');
      expect(backupContent).toContain('#define MOTOR_EN GPIO26');

      // 5. Verify activity event was persisted
      const { items: events } = await client.listEvents(project.id);
      const appliedEvent = events.find((e) => e.type === 'engineering.correction.applied');
      expect(appliedEvent).toBeDefined();
      expect(appliedEvent?.sourceKind).toBe('observed_tool');

      // 6. Test stale preview rejection: applying again with old hash fails
      await expect(
        client.applyCorrection(project.id, {
          previewId: preview.id,
          findingId: finding.id,
          expectedOriginalHash: preview.originalHash,
          userApproved: true,
        }),
      ).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });

      // 7. Rollback correction
      const rollbackResult = await client.rollbackCorrection(project.id, {
        targetFile: applyResult.targetFile,
        backupPath: applyResult.backupPath,
      });

      expect(rollbackResult.ok).toBe(true);
      expect(rollbackResult.revalidationJob.status).toBe('failed');
      expect(rollbackResult.revalidationFindings).toBeDefined();
      expect(rollbackResult.revalidationFindings!.length).toBeGreaterThan(0);

      // Verify file was restored
      const rolledBackContent = await readFile(join(workspace, 'src/pins.h'), 'utf-8');
      expect(rolledBackContent).toContain('#define MOTOR_EN GPIO26');

      // 8. REGRESSION VERIFICATION: Rollback job and findings MUST be persisted in SQLite
      const persistedRollbackJob = await client.getJob(
        project.id,
        rollbackResult.revalidationJob.id,
      );
      expect(persistedRollbackJob).toBeDefined();
      expect(persistedRollbackJob.status).toBe('failed');

      const persistedRollbackFindings = await client.listFindings(project.id, {
        jobId: rollbackResult.revalidationJob.id,
      });
      expect(persistedRollbackFindings.items).toHaveLength(1);
      expect(persistedRollbackFindings.items[0]?.ruleId).toBe('pin_consistency');

      // Verify context memory reflects rollback fact
      const memoryBeforeRestart = await client.getContext(project.id);
      expect(
        memoryBeforeRestart.records.some((r) => r.text.includes('Rolled back correction')),
      ).toBe(true);

      // 9. RESTART SURVIVAL: Stop and restart daemon with same database
      const clientAfterRestart = await restart();

      const jobAfterRestart = await clientAfterRestart.getJob(
        project.id,
        rollbackResult.revalidationJob.id,
      );
      expect(jobAfterRestart.id).toBe(rollbackResult.revalidationJob.id);
      expect(jobAfterRestart.status).toBe('failed');

      const findingsAfterRestart = await clientAfterRestart.listFindings(project.id, {
        jobId: rollbackResult.revalidationJob.id,
      });
      expect(findingsAfterRestart.items).toHaveLength(1);
      expect(findingsAfterRestart.items[0]?.ruleId).toBe('pin_consistency');

      // 10. PROJECT ISOLATION: Querying job from another project returns 404
      const otherWorkspace = await mkdtemp(join(tmpdir(), 'udi-other-workspace-'));
      const otherProject = await clientAfterRestart.createProject({
        name: 'Isolated Project',
        rootPath: otherWorkspace,
      });
      await expect(
        clientAfterRestart.getJob(otherProject.id, rollbackResult.revalidationJob.id),
      ).rejects.toMatchObject({ status: 404 });

      const otherFindings = await clientAfterRestart.listFindings(otherProject.id, {
        jobId: rollbackResult.revalidationJob.id,
      });
      expect(otherFindings.items).toEqual([]);

      await rm(otherWorkspace, { recursive: true, force: true });
    } finally {
      await cleanup();
    }
  });

  it('rejects unauthenticated correction requests with 401', async () => {
    const { baseUrl, cleanup } = await setup();
    try {
      // Create client without token
      const unauthClient = createClient({
        baseUrl,
      });

      await expect(
        unauthClient.previewCorrection('00000000-0000-0000-0000-000000000000', {
          findingId: '00000000-0000-0000-0000-000000000000',
        }),
      ).rejects.toMatchObject({ code: 'UNAUTHORIZED', status: 401 });
    } finally {
      await cleanup();
    }
  });
});
