import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Job, ValidationFinding } from '@udi/contracts';
import type { ToolRunner } from '@udi/tool-runners';
import type { ValidationResult } from './index.js';

export async function runPlatformIOBuild(
  runner: ToolRunner,
  workspaceRoot: string,
  projectId: string,
  jobId: string,
  signal?: AbortSignal,
): Promise<ValidationResult> {
  const now = new Date().toISOString();

  // Check if platformio.ini exists
  const iniPath = join(workspaceRoot, 'platformio.ini');
  try {
    const s = await stat(iniPath);
    if (!s.isFile()) {
      throw new Error('Not a file');
    }
  } catch {
    const job: Job = {
      id: jobId,
      projectId,
      createdAt: now,
      updatedAt: now,
      status: 'failed',
      startedAt: now,
      completedAt: now,
      exitCode: 1,
      stdoutTail: '',
      stderrTail: `platformio.ini not found in workspace: ${workspaceRoot}`,
      artifacts: [],
    };
    const finding: ValidationFinding = {
      id: randomUUID(),
      projectId,
      jobId,
      createdAt: now,
      updatedAt: now,
      ruleId: 'platformio_config_missing',
      severity: 'error',
      message: 'platformio.ini configuration file is missing from the project workspace',
      expected: { file: 'platformio.ini', status: 'present' },
      observed: { file: 'platformio.ini', status: 'missing' },
      evidence: [{ filePath: 'platformio.ini' }],
      suggestedFix: 'Create a platformio.ini file configuring the target board and environment',
      status: 'open',
      verifiedBy: { tool: 'platformio', version: 'unavailable' },
    };
    return { job, findings: [finding] };
  }

  // Check if PlatformIO toolchain is installed
  const isAvailable = await runner.isAvailable('platformio');
  if (!isAvailable) {
    const job: Job = {
      id: jobId,
      projectId,
      createdAt: now,
      updatedAt: now,
      status: 'failed',
      startedAt: now,
      completedAt: now,
      exitCode: 127,
      stdoutTail: '',
      stderrTail:
        'PlatformIO toolchain is not available on host system (tool: platformio); install PlatformIO Core or run in a configured container',
      artifacts: [],
    };
    const finding: ValidationFinding = {
      id: randomUUID(),
      projectId,
      jobId,
      createdAt: now,
      updatedAt: now,
      ruleId: 'platformio_toolchain_unavailable',
      severity: 'warning',
      message:
        'PlatformIO toolchain is not installed on this machine; firmware compilation was skipped',
      expected: { tool: 'platformio', status: 'installed' },
      observed: { tool: 'platformio', status: 'unavailable' },
      evidence: [{ filePath: 'platformio.ini' }],
      suggestedFix: 'Install PlatformIO Core via `pip install platformio` or your package manager',
      status: 'open',
      verifiedBy: { tool: 'platformio', version: 'unavailable' },
    };
    return { job, findings: [finding] };
  }

  // Execute build
  const startedAt = new Date().toISOString();
  const runResult = await runner.run({
    tool: 'platformio',
    projectId,
    workspaceRoot,
    args: ['run'],
    timeoutMs: 60000,
    signal,
  });
  const completedAt = new Date().toISOString();

  const success = runResult.exitCode === 0 && !runResult.timedOut && !runResult.cancelled;
  const findings: ValidationFinding[] = [];

  if (!success) {
    findings.push({
      id: randomUUID(),
      projectId,
      jobId,
      createdAt: completedAt,
      updatedAt: completedAt,
      ruleId: 'platformio_build_failed',
      severity: 'error',
      message: `PlatformIO compilation failed with exit code ${runResult.exitCode ?? 'unknown'}`,
      expected: { exitCode: 0 },
      observed: {
        exitCode: runResult.exitCode ?? null,
        timedOut: runResult.timedOut,
        cancelled: runResult.cancelled,
      },
      evidence: [{ filePath: 'platformio.ini', excerpt: runResult.stderrTail.slice(-500) }],
      suggestedFix:
        'Inspect the compiler errors in build output and resolve syntax or missing headers',
      status: 'open',
      verifiedBy: { tool: 'platformio', version: 'host' },
    });
  }

  const job: Job = {
    id: jobId,
    projectId,
    createdAt: now,
    updatedAt: completedAt,
    status: success ? 'succeeded' : 'failed',
    startedAt,
    completedAt,
    exitCode: runResult.exitCode,
    stdoutTail: runResult.stdoutTail,
    stderrTail: runResult.stderrTail,
    artifacts: success ? ['.pio/build'] : [],
  };

  return { job, findings };
}
