import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import type { Job, ValidationFinding, ValidationRequest } from '@udi/contracts';
import type { EngineeringDependencies, EngineeringValidator, ValidationResult } from './index.js';
import { parseKiCadNetlist } from './kicad-parser.js';
import { parseFirmwarePins } from './firmware-parser.js';
import { validatePinConsistency } from './pin-validator.js';
import { runPlatformIOBuild } from './platformio-adapter.js';
import { runRTLSimulation } from './rtl-adapter.js';
import type { EngineeringMap } from './types.js';

export class DefaultEngineeringValidator implements EngineeringValidator {
  constructor(private readonly dependencies: EngineeringDependencies) {}

  async validate(request: ValidationRequest, signal?: AbortSignal): Promise<ValidationResult> {
    const workspaceRoot = await this.dependencies.resolveWorkspace(request.projectId);
    const jobId = randomUUID();
    const now = new Date().toISOString();

    if (request.kind === 'platformio_build') {
      return runPlatformIOBuild(
        this.dependencies.runner,
        workspaceRoot,
        request.projectId,
        jobId,
        signal,
      );
    }

    if (request.kind === 'rtl_simulation') {
      return runRTLSimulation(
        this.dependencies.runner,
        workspaceRoot,
        request.artifactPaths,
        request.projectId,
        jobId,
        signal,
      );
    }

    // Default: 'pin_consistency'
    return this.validatePinConsistency(request, workspaceRoot, jobId, now);
  }

  private async validatePinConsistency(
    request: ValidationRequest,
    workspaceRoot: string,
    jobId: string,
    startedAt: string,
  ): Promise<ValidationResult> {
    const resolvePath = (p: string) => (isAbsolute(p) ? p : resolve(workspaceRoot, p));

    // Find netlist artifact
    const netlistPath =
      request.artifactPaths.find(
        (p) =>
          p.endsWith('.net') || (p.endsWith('.json') && !p.includes('map') && !p.includes('pin')),
      ) ?? request.artifactPaths[0];

    // Find firmware pin artifact
    const firmwarePath =
      request.artifactPaths.find(
        (p) =>
          p.endsWith('.h') ||
          p.endsWith('.hpp') ||
          p.endsWith('.ino') ||
          p.endsWith('.c') ||
          p.endsWith('.cpp') ||
          p.includes('pin'),
      ) ?? request.artifactPaths[1];

    if (!netlistPath || !firmwarePath) {
      const completedAt = new Date().toISOString();
      const job: Job = {
        id: jobId,
        projectId: request.projectId,
        createdAt: startedAt,
        updatedAt: completedAt,
        status: 'failed',
        startedAt,
        completedAt,
        exitCode: 1,
        stdoutTail: '',
        stderrTail:
          'Validation requires both a netlist artifact and a firmware pin definition file',
        artifacts: [],
      };
      const finding: ValidationFinding = {
        id: randomUUID(),
        projectId: request.projectId,
        jobId,
        createdAt: completedAt,
        updatedAt: completedAt,
        ruleId: 'missing_artifacts',
        severity: 'error',
        message: 'Pin consistency validation requires both a netlist file and a firmware header',
        expected: { netlist: 'provided', firmware: 'provided' },
        observed: {
          netlist: netlistPath ?? null,
          firmware: firmwarePath ?? null,
        },
        evidence: [{ filePath: netlistPath ?? 'unknown' }],
        suggestedFix:
          'Provide both netlist path (e.g. rover.net) and firmware path (e.g. src/pins.h)',
        status: 'open',
        verifiedBy: { tool: 'engineering-core', version: '1.0.0' },
      };
      return { job, findings: [finding] };
    }

    const absNetlist = resolvePath(netlistPath);
    const absFirmware = resolvePath(firmwarePath);

    let netlistContent: string;
    let firmwareContent: string;

    try {
      netlistContent = await readFile(absNetlist, 'utf-8');
    } catch (err) {
      const completedAt = new Date().toISOString();
      const job: Job = {
        id: jobId,
        projectId: request.projectId,
        createdAt: startedAt,
        updatedAt: completedAt,
        status: 'failed',
        startedAt,
        completedAt,
        exitCode: 1,
        stdoutTail: '',
        stderrTail: `Inaccessible netlist file: ${absNetlist}`,
        artifacts: [],
      };
      const finding: ValidationFinding = {
        id: randomUUID(),
        projectId: request.projectId,
        jobId,
        createdAt: completedAt,
        updatedAt: completedAt,
        ruleId: 'inaccessible_netlist',
        severity: 'error',
        message: `Failed to read netlist artifact: ${absNetlist}`,
        expected: { readable: true },
        observed: { readable: false, error: err instanceof Error ? err.message : String(err) },
        evidence: [{ filePath: netlistPath }],
        suggestedFix: 'Ensure netlist artifact exists in the project workspace',
        status: 'open',
        verifiedBy: { tool: 'engineering-core', version: '1.0.0' },
      };
      return { job, findings: [finding] };
    }

    try {
      firmwareContent = await readFile(absFirmware, 'utf-8');
    } catch (err) {
      const completedAt = new Date().toISOString();
      const job: Job = {
        id: jobId,
        projectId: request.projectId,
        createdAt: startedAt,
        updatedAt: completedAt,
        status: 'failed',
        startedAt,
        completedAt,
        exitCode: 1,
        stdoutTail: '',
        stderrTail: `Inaccessible firmware header file: ${absFirmware}`,
        artifacts: [],
      };
      const finding: ValidationFinding = {
        id: randomUUID(),
        projectId: request.projectId,
        jobId,
        createdAt: completedAt,
        updatedAt: completedAt,
        ruleId: 'inaccessible_firmware',
        severity: 'error',
        message: `Failed to read firmware pin artifact: ${absFirmware}`,
        expected: { readable: true },
        observed: { readable: false, error: err instanceof Error ? err.message : String(err) },
        evidence: [{ filePath: firmwarePath }],
        suggestedFix: 'Ensure firmware pin definition file exists in the project workspace',
        status: 'open',
        verifiedBy: { tool: 'engineering-core', version: '1.0.0' },
      };
      return { job, findings: [finding] };
    }

    // Optional engineering-map.json
    let engineeringMap: EngineeringMap | undefined;
    const mapPath =
      request.artifactPaths.find((p) => p.includes('engineering-map') || p.includes('map.json')) ??
      join(workspaceRoot, 'engineering-map.json');

    try {
      const mapRaw = await readFile(resolvePath(mapPath), 'utf-8');
      engineeringMap = JSON.parse(mapRaw) as EngineeringMap;
    } catch {
      // Map is optional
    }

    const netlistExtraction = parseKiCadNetlist(netlistContent, netlistPath);
    const firmwareExtraction = parseFirmwarePins(firmwareContent, firmwarePath);

    const findings = validatePinConsistency(
      netlistExtraction,
      firmwareExtraction,
      request.projectId,
      jobId,
      engineeringMap,
    );

    const completedAt = new Date().toISOString();
    const hasError = findings.some((f) => f.severity === 'error');
    const status = hasError ? 'failed' : 'succeeded';

    const stdoutTail =
      findings.length === 0
        ? `Deterministic validation PASSED: all ${firmwareExtraction.pins.size} firmware signals match netlist.`
        : `Deterministic validation identified ${findings.length} finding(s):\n` +
          findings.map((f) => `[${f.severity.toUpperCase()}] ${f.ruleId}: ${f.message}`).join('\n');

    const job: Job = {
      id: jobId,
      projectId: request.projectId,
      createdAt: startedAt,
      updatedAt: completedAt,
      status,
      startedAt,
      completedAt,
      exitCode: hasError ? 1 : 0,
      stdoutTail,
      stderrTail: '',
      artifacts: [netlistPath, firmwarePath],
    };

    return { job, findings };
  }
}
