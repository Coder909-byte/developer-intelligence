import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, cp, readFile, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ValidationFinding } from '@udi/contracts';
import {
  generateCorrectionPreview,
  applyCorrection,
  rollbackCorrection,
  DefaultEngineeringValidator,
} from './index.js';
import type { ToolRunner } from '@udi/tool-runners';

const repoRoot = resolve(import.meta.dirname, '../../..');
const roverFixtureDir = resolve(repoRoot, 'examples/rover');

describe('Safe Engineering Correction Flow', () => {
  const mockRunner: ToolRunner = {
    isAvailable: async () => false,
    run: async () => ({
      exitCode: 127,
      stdoutTail: '',
      stderrTail: 'unavailable',
      timedOut: false,
      cancelled: false,
      artifacts: [],
    }),
  };

  async function createFixtureWorkspace() {
    const tempDir = await mkdtemp(join(tmpdir(), 'udi-correction-test-'));
    const workspace = join(tempDir, 'rover');
    await cp(roverFixtureDir, workspace, { recursive: true });

    const validator = new DefaultEngineeringValidator({
      runner: mockRunner,
      resolveWorkspace: async () => workspace,
    });

    const cleanup = async () => {
      await rm(tempDir, { recursive: true, force: true });
    };

    return { tempDir, workspace, validator, cleanup };
  }

  const sampleFinding: ValidationFinding = {
    id: randomUUID(),
    projectId: randomUUID(),
    jobId: randomUUID(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ruleId: 'pin_consistency',
    severity: 'error',
    message:
      'Signal MOTOR_EN pin mismatch: netlist specifies GPIO14 but firmware configures GPIO26',
    expected: {
      signal: 'MOTOR_EN',
      pin: 'GPIO14',
      sourceFile: 'rover.net',
      component: 'U2',
      mcuPin: '12',
    },
    observed: {
      signal: 'MOTOR_EN',
      pin: 'GPIO26',
      sourceFile: 'src/pins.h',
    },
    evidence: [
      { filePath: 'rover.net', line: 28 },
      { filePath: 'src/pins.h', line: 7 },
    ],
    suggestedFix: 'Update src/pins.h line 7 to: #define MOTOR_EN GPIO14',
    status: 'open',
    verifiedBy: { tool: 'engineering-core/pin-validator', version: '1.0.0' },
  };

  it('generates a non-destructive preview with unified diff and exact line details', async () => {
    const { workspace, cleanup } = await createFixtureWorkspace();
    try {
      const initialContent = await readFile(join(workspace, 'src/pins.h'), 'utf-8');

      const preview = await generateCorrectionPreview({
        projectId: sampleFinding.projectId,
        workspaceRoot: workspace,
        finding: sampleFinding,
      });

      expect(preview.id).toBeDefined();
      expect(preview.targetFile).toBe('src/pins.h');
      expect(preview.originalLineNumber).toBe(7);
      expect(preview.originalLineText).toBe('#define MOTOR_EN GPIO26');
      expect(preview.proposedLineText).toBe('#define MOTOR_EN GPIO14');
      expect(preview.diff).toContain('- #define MOTOR_EN GPIO26');
      expect(preview.diff).toContain('+ #define MOTOR_EN GPIO14');

      // Verify ZERO writes occurred during preview
      const postContent = await readFile(join(workspace, 'src/pins.h'), 'utf-8');
      expect(postContent).toBe(initialContent);
    } finally {
      await cleanup();
    }
  });

  it('applies correction with explicit user approval and validates the fix', async () => {
    const { workspace, validator, cleanup } = await createFixtureWorkspace();
    try {
      const preview = await generateCorrectionPreview({
        projectId: sampleFinding.projectId,
        workspaceRoot: workspace,
        finding: sampleFinding,
      });

      // Apply with approval
      const result = await applyCorrection({
        projectId: sampleFinding.projectId,
        workspaceRoot: workspace,
        preview,
        userApproved: true,
        validator,
      });

      expect(result.ok).toBe(true);
      expect(result.backupPath).toBe('src/pins.h.bak');

      // Verify file was patched
      const patchedContent = await readFile(join(workspace, 'src/pins.h'), 'utf-8');
      expect(patchedContent).toContain('#define MOTOR_EN GPIO14');
      expect(patchedContent).not.toContain('#define MOTOR_EN GPIO26');

      // Verify backup was created
      const backupContent = await readFile(join(workspace, 'src/pins.h.bak'), 'utf-8');
      expect(backupContent).toContain('#define MOTOR_EN GPIO26');

      // Verify revalidation succeeded with 0 findings
      expect(result.revalidationJob.status).toBe('succeeded');
      expect(result.revalidationJob.exitCode).toBe(0);
      expect(result.revalidationFindings).toHaveLength(0);
    } finally {
      await cleanup();
    }
  });

  it('rejects apply without explicit user approval', async () => {
    const { workspace, validator, cleanup } = await createFixtureWorkspace();
    try {
      const preview = await generateCorrectionPreview({
        projectId: sampleFinding.projectId,
        workspaceRoot: workspace,
        finding: sampleFinding,
      });

      await expect(
        applyCorrection({
          projectId: sampleFinding.projectId,
          workspaceRoot: workspace,
          preview,
          userApproved: false,
          validator,
        }),
      ).rejects.toThrow(/approval/);

      // Verify file was NOT modified
      const content = await readFile(join(workspace, 'src/pins.h'), 'utf-8');
      expect(content).toContain('#define MOTOR_EN GPIO26');
    } finally {
      await cleanup();
    }
  });

  it('rejects stale preview if file was modified after preview generation', async () => {
    const { workspace, validator, cleanup } = await createFixtureWorkspace();
    try {
      const preview = await generateCorrectionPreview({
        projectId: sampleFinding.projectId,
        workspaceRoot: workspace,
        finding: sampleFinding,
      });

      // Modify the file concurrently
      await writeFile(
        join(workspace, 'src/pins.h'),
        '// Concurrent edit\n#define MOTOR_EN GPIO99\n',
      );

      await expect(
        applyCorrection({
          projectId: sampleFinding.projectId,
          workspaceRoot: workspace,
          preview,
          userApproved: true,
          validator,
        }),
      ).rejects.toThrow(/modified since preview was generated/);
    } finally {
      await cleanup();
    }
  });

  it('rejects path traversal attempting to escape workspace', async () => {
    const { workspace, tempDir, cleanup } = await createFixtureWorkspace();
    try {
      const outsideFile = join(tempDir, 'outside.h');
      await writeFile(outsideFile, '#define MOTOR_EN GPIO26\n');

      const traversalFinding: ValidationFinding = {
        ...sampleFinding,
        evidence: [{ filePath: '../outside.h', line: 1 }],
      };

      await expect(
        generateCorrectionPreview({
          projectId: sampleFinding.projectId,
          workspaceRoot: workspace,
          finding: traversalFinding,
        }),
      ).rejects.toThrow(/escapes workspace/);
    } finally {
      await cleanup();
    }
  });

  it('rejects symlink escaping the workspace boundary', async () => {
    const { workspace, tempDir, cleanup } = await createFixtureWorkspace();
    try {
      const outsideFile = join(tempDir, 'outside.h');
      await writeFile(outsideFile, '#define MOTOR_EN GPIO26\n');
      await symlink(outsideFile, join(workspace, 'escape.h'));

      const symlinkFinding: ValidationFinding = {
        ...sampleFinding,
        evidence: [{ filePath: 'escape.h', line: 1 }],
      };

      await expect(
        generateCorrectionPreview({
          projectId: sampleFinding.projectId,
          workspaceRoot: workspace,
          finding: symlinkFinding,
        }),
      ).rejects.toThrow(/escapes workspace/);
    } finally {
      await cleanup();
    }
  });

  it('supports rollback of an applied correction', async () => {
    const { workspace, validator, cleanup } = await createFixtureWorkspace();
    try {
      const preview = await generateCorrectionPreview({
        projectId: sampleFinding.projectId,
        workspaceRoot: workspace,
        finding: sampleFinding,
      });

      const applyRes = await applyCorrection({
        projectId: sampleFinding.projectId,
        workspaceRoot: workspace,
        preview,
        userApproved: true,
        validator,
      });

      expect(applyRes.ok).toBe(true);

      // Perform rollback
      const rollbackRes = await rollbackCorrection({
        projectId: sampleFinding.projectId,
        workspaceRoot: workspace,
        targetFile: preview.targetFile,
        backupPath: applyRes.backupPath,
        validator,
      });

      expect(rollbackRes.ok).toBe(true);

      // Verify original content was restored
      const restoredContent = await readFile(join(workspace, 'src/pins.h'), 'utf-8');
      expect(restoredContent).toContain('#define MOTOR_EN GPIO26');

      // Revalidation after rollback should fail again
      expect(rollbackRes.revalidationJob.status).toBe('failed');
    } finally {
      await cleanup();
    }
  });
});
