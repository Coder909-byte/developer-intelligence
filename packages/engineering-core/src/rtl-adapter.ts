import { randomUUID } from 'node:crypto';
import type { Job, ValidationFinding } from '@udi/contracts';
import type { ToolRunner } from '@udi/tool-runners';
import type { ValidationResult } from './index.js';

export async function runRTLSimulation(
  runner: ToolRunner,
  workspaceRoot: string,
  artifactPaths: string[],
  projectId: string,
  jobId: string,
  signal?: AbortSignal,
): Promise<ValidationResult> {
  const now = new Date().toISOString();
  const verilogFiles = artifactPaths.filter(
    (p) => p.endsWith('.v') || p.endsWith('.sv'),
  );

  if (verilogFiles.length === 0) {
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
      stderrTail: 'No Verilog source files (.v or .sv) found in artifact paths',
      artifacts: [],
    };
    const finding: ValidationFinding = {
      id: randomUUID(),
      projectId,
      jobId,
      createdAt: now,
      updatedAt: now,
      ruleId: 'rtl_missing_sources',
      severity: 'error',
      message: 'No Verilog (.v or .sv) source files specified for RTL simulation',
      expected: { sourceFiles: '>= 1' },
      observed: { sourceFiles: 0 },
      evidence: [{ filePath: 'examples/rtl-alu/alu.v' }],
      suggestedFix: 'Specify at least one module and one testbench file in artifactPaths',
      status: 'open',
      verifiedBy: { tool: 'iverilog', version: 'unavailable' },
    };
    return { job, findings: [finding] };
  }

  // Check if Icarus Verilog is available
  const iverilogAvailable = await runner.isAvailable('iverilog');
  if (!iverilogAvailable) {
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
        'Icarus Verilog toolchain is not available on host system (tool: iverilog); install Icarus Verilog (`iverilog`) for RTL simulation',
      artifacts: [],
    };
    const finding: ValidationFinding = {
      id: randomUUID(),
      projectId,
      jobId,
      createdAt: now,
      updatedAt: now,
      ruleId: 'rtl_toolchain_unavailable',
      severity: 'warning',
      message: 'Icarus Verilog toolchain is not installed on host machine; simulation skipped',
      expected: { tool: 'iverilog', status: 'installed' },
      observed: { tool: 'iverilog', status: 'unavailable' },
      evidence: [{ filePath: verilogFiles[0]! }],
      suggestedFix: 'Install Icarus Verilog via package manager (e.g. `pacman -S iverilog` or `apt-get install iverilog`)',
      status: 'open',
      verifiedBy: { tool: 'iverilog', version: 'unavailable' },
    };
    return { job, findings: [finding] };
  }

  // 1. Compile with iverilog
  const simOutputFile = 'sim.vvp';
  const startedAt = new Date().toISOString();
  const compileResult = await runner.run({
    tool: 'iverilog',
    projectId,
    workspaceRoot,
    args: ['-o', simOutputFile, ...verilogFiles],
    timeoutMs: 30000,
    signal,
  });

  if (compileResult.exitCode !== 0 || compileResult.timedOut || compileResult.cancelled) {
    const completedAt = new Date().toISOString();
    const job: Job = {
      id: jobId,
      projectId,
      createdAt: now,
      updatedAt: completedAt,
      status: 'failed',
      startedAt,
      completedAt,
      exitCode: compileResult.exitCode,
      stdoutTail: compileResult.stdoutTail,
      stderrTail: compileResult.stderrTail,
      artifacts: [],
    };
    const finding: ValidationFinding = {
      id: randomUUID(),
      projectId,
      jobId,
      createdAt: completedAt,
      updatedAt: completedAt,
      ruleId: 'rtl_compile_failed',
      severity: 'error',
      message: `Verilog compilation failed: ${compileResult.stderrTail || compileResult.stdoutTail}`,
      expected: { exitCode: 0 },
      observed: { exitCode: compileResult.exitCode },
      evidence: [{ filePath: verilogFiles[0]!, excerpt: compileResult.stderrTail.slice(-300) }],
      suggestedFix: 'Resolve Verilog syntax errors in source or testbench files',
      status: 'open',
      verifiedBy: { tool: 'iverilog', version: 'host' },
    };
    return { job, findings: [finding] };
  }

  // 2. Run simulation with vvp
  const simResult = await runner.run({
    tool: 'vvp',
    projectId,
    workspaceRoot,
    args: [simOutputFile],
    timeoutMs: 30000,
    signal,
  });
  const completedAt = new Date().toISOString();

  const combinedOutput = `${simResult.stdoutTail}\n${simResult.stderrTail}`;
  const hasFatal =
    combinedOutput.includes('$fatal') ||
    combinedOutput.includes('ASSERTION FAILED') ||
    combinedOutput.includes('ERROR:');
  const success = simResult.exitCode === 0 && !hasFatal && !simResult.timedOut && !simResult.cancelled;

  const findings: ValidationFinding[] = [];
  if (!success) {
    findings.push({
      id: randomUUID(),
      projectId,
      jobId,
      createdAt: completedAt,
      updatedAt: completedAt,
      ruleId: 'rtl_simulation_failed',
      severity: 'error',
      message: hasFatal
        ? 'RTL simulation assertion failure detected during testbench execution'
        : `RTL simulation process exited with code ${simResult.exitCode ?? 'unknown'}`,
      expected: { simulationPass: true },
      observed: {
        exitCode: simResult.exitCode ?? null,
        hasAssertionFailure: hasFatal,
      },
      evidence: [
        {
          filePath: verilogFiles.find((f) => f.includes('tb')) ?? verilogFiles[0]!,
          excerpt: combinedOutput.slice(-500),
        },
      ],
      suggestedFix: 'Examine testbench assertion output and verify logic equations in RTL design',
      status: 'open',
      verifiedBy: { tool: 'iverilog/vvp', version: 'host' },
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
    exitCode: simResult.exitCode,
    stdoutTail: simResult.stdoutTail,
    stderrTail: simResult.stderrTail,
    artifacts: success ? [simOutputFile] : [],
  };

  return { job, findings };
}
