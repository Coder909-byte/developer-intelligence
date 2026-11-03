import { createHash, randomUUID } from 'node:crypto';
import { copyFile, lstat, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type {
  CorrectionPreview,
  CorrectionApplyResult,
  CorrectionRollbackResult,
  ValidationFinding,
  ContextRecord,
} from '@udi/contracts';
import {
  CorrectionPreviewSchema,
  CorrectionApplyResultSchema,
  CorrectionRollbackResultSchema,
} from '@udi/contracts';
import { formatGpioDisplay } from './pin-normalizer.js';
import type { EngineeringValidator } from './index.js';

export class CorrectionError extends Error {
  constructor(
    public readonly code: 'NOT_FOUND' | 'VALIDATION_ERROR' | 'CONFLICT' | 'UNAUTHORIZED',
    message: string,
  ) {
    super(message);
    this.name = 'CorrectionError';
  }
}

/**
 * Validates that a file path resides strictly inside the canonical workspace,
 * rejecting directory traversal (..) and symlink escapes.
 */
async function validateWorkspaceFile(
  workspaceRoot: string,
  filePath: string,
  mustExist = true,
): Promise<{ canonicalWorkspace: string; canonicalFile: string; relativePath: string }> {
  if (!isAbsolute(workspaceRoot)) {
    throw new CorrectionError(
      'VALIDATION_ERROR',
      `Workspace root must be absolute: ${workspaceRoot}`,
    );
  }

  let canonicalWorkspace: string;
  try {
    canonicalWorkspace = await realpath(workspaceRoot);
    const s = await stat(canonicalWorkspace);
    if (!s.isDirectory()) {
      throw new CorrectionError('VALIDATION_ERROR', 'Workspace root is not a directory');
    }
  } catch (err) {
    throw new CorrectionError(
      'VALIDATION_ERROR',
      `Workspace root is inaccessible: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const resolved = resolve(canonicalWorkspace, filePath);
  let canonicalFile: string;
  if (mustExist) {
    try {
      canonicalFile = await realpath(resolved);
      const s = await stat(canonicalFile);
      if (!s.isFile()) {
        throw new CorrectionError('VALIDATION_ERROR', `Target path is not a file: ${filePath}`);
      }
    } catch (err) {
      if (err instanceof CorrectionError) throw err;
      throw new CorrectionError('NOT_FOUND', `File not found in workspace: ${filePath}`);
    }
  } else {
    canonicalFile = resolved;
  }

  const rel = relative(canonicalWorkspace, canonicalFile);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new CorrectionError(
      'VALIDATION_ERROR',
      `Target file escapes workspace boundary: ${filePath}`,
    );
  }

  return { canonicalWorkspace, canonicalFile, relativePath: rel };
}

function computeSha256(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

/**
 * PHASE 2 — Safe Patch Preview
 * Generates a non-destructive, reviewable preview of the proposed firmware fix.
 * Performs ZERO filesystem modifications.
 */
export async function generateCorrectionPreview(options: {
  projectId: string;
  workspaceRoot: string;
  finding: ValidationFinding;
}): Promise<CorrectionPreview> {
  const { projectId, workspaceRoot, finding } = options;

  if (finding.ruleId !== 'pin_consistency') {
    throw new CorrectionError(
      'VALIDATION_ERROR',
      `Automated correction is only supported for pin_consistency rules, received: ${finding.ruleId}`,
    );
  }

  // Locate the firmware file from finding evidence
  const firmwareEvidence = finding.evidence.find(
    (ev) =>
      ev.filePath.endsWith('.h') ||
      ev.filePath.endsWith('.hpp') ||
      ev.filePath.endsWith('.ino') ||
      ev.filePath.endsWith('.c') ||
      ev.filePath.endsWith('.cpp'),
  );

  if (!firmwareEvidence) {
    throw new CorrectionError(
      'VALIDATION_ERROR',
      'No firmware source file evidence found in finding to correct',
    );
  }

  // Safety: never edit schematics, netlists, or layout files
  const forbiddenExts = ['.net', '.sch', '.kicad_sch', '.kicad_pcb', '.brd', '.ini'];
  if (forbiddenExts.some((ext) => firmwareEvidence.filePath.endsWith(ext))) {
    throw new CorrectionError(
      'VALIDATION_ERROR',
      `Hardware design artifacts cannot be modified by firmware correction: ${firmwareEvidence.filePath}`,
    );
  }

  const { canonicalFile, relativePath } = await validateWorkspaceFile(
    workspaceRoot,
    firmwareEvidence.filePath,
    true,
  );

  const content = await readFile(canonicalFile, 'utf-8');
  const originalHash = computeSha256(content);
  const lines = content.split('\n');

  const lineNum = firmwareEvidence.line;
  if (!lineNum || lineNum < 1 || lineNum > lines.length) {
    throw new CorrectionError(
      'VALIDATION_ERROR',
      `Finding line number ${lineNum ?? 'undefined'} is out of bounds for ${relativePath}`,
    );
  }

  const originalLineText = lines[lineNum - 1]!;

  // Extract signal name from expected finding
  const expectedObj = finding.expected as Record<string, unknown>;
  const signalName = typeof expectedObj.signal === 'string' ? expectedObj.signal : '';
  const expectedPin =
    typeof expectedObj.pin === 'string'
      ? expectedObj.pin
      : typeof expectedObj.gpio === 'string'
        ? expectedObj.gpio
        : '';

  if (!signalName || !expectedPin) {
    throw new CorrectionError(
      'VALIDATION_ERROR',
      'Finding expected data is missing signal name or pin specification',
    );
  }

  // Verify that the line at lineNum actually defines this signal
  if (!originalLineText.includes(signalName)) {
    throw new CorrectionError(
      'VALIDATION_ERROR',
      `Target line ${lineNum} in ${relativePath} does not contain signal ${signalName} (content: "${originalLineText}")`,
    );
  }

  // Construct proposed line
  const formattedPin = formatGpioDisplay(expectedPin);
  let proposedLineText: string;

  if (originalLineText.trim().startsWith('#define')) {
    proposedLineText = `#define ${signalName} ${formattedPin}`;
  } else if (originalLineText.includes('=')) {
    // Preserve const / constexpr syntax
    const prefix = originalLineText.substring(0, originalLineText.indexOf('=')).trimEnd();
    proposedLineText = `${prefix} = ${formattedPin};`;
  } else {
    proposedLineText = `#define ${signalName} ${formattedPin}`;
  }

  // Reject ambiguous edits if proposed is identical to original
  if (originalLineText.trim() === proposedLineText.trim()) {
    throw new CorrectionError(
      'VALIDATION_ERROR',
      `Proposed line is identical to current file content: "${originalLineText}"`,
    );
  }

  // Generate unified diff
  const diff = [
    `--- a/${relativePath}`,
    `+++ b/${relativePath}`,
    `@@ -${lineNum},1 +${lineNum},1 @@`,
    `- ${originalLineText}`,
    `+ ${proposedLineText}`,
  ].join('\n');

  const preview: CorrectionPreview = {
    id: randomUUID(),
    projectId,
    findingId: finding.id,
    targetFile: relativePath,
    originalHash,
    originalLineNumber: lineNum,
    originalLineText,
    proposedLineText,
    diff,
    explanation: `Align signal ${signalName} with netlist pin ${formattedPin}`,
    generatedAt: new Date().toISOString(),
  };

  return CorrectionPreviewSchema.parse(preview);
}

/**
 * PHASE 3 & 4 — Explicit Approval, Apply & Revalidation
 * Re-checks hash, creates .bak snapshot, applies line replacement, and executes revalidation.
 */
export async function applyCorrection(options: {
  projectId: string;
  workspaceRoot: string;
  preview: CorrectionPreview;
  userApproved: boolean;
  validator: EngineeringValidator;
  artifactPaths?: string[];
}): Promise<CorrectionApplyResult> {
  const { projectId, workspaceRoot, preview, userApproved, validator, artifactPaths } = options;

  if (!userApproved) {
    throw new CorrectionError(
      'VALIDATION_ERROR',
      'Explicit user approval is required to apply an engineering correction',
    );
  }

  const { canonicalFile, relativePath } = await validateWorkspaceFile(
    workspaceRoot,
    preview.targetFile,
    true,
  );

  // Re-read current file to detect stale previews
  const currentContent = await readFile(canonicalFile, 'utf-8');
  const currentHash = computeSha256(currentContent);

  if (currentHash !== preview.originalHash) {
    throw new CorrectionError(
      'CONFLICT',
      `File ${relativePath} has been modified since preview was generated (stale preview rejected)`,
    );
  }

  const lines = currentContent.split('\n');
  if (lines[preview.originalLineNumber - 1] !== preview.originalLineText) {
    throw new CorrectionError(
      'CONFLICT',
      `Target line ${preview.originalLineNumber} no longer matches preview original text`,
    );
  }

  // Create recoverable backup snapshot with symlink escape prevention
  const backupRelPath = `${preview.targetFile}.bak`;
  const backupAbsPath = resolve(workspaceRoot, backupRelPath);
  const backupRel = relative(workspaceRoot, backupAbsPath);
  if (backupRel === '..' || backupRel.startsWith(`..${sep}`) || isAbsolute(backupRel)) {
    throw new CorrectionError('VALIDATION_ERROR', 'Backup path escapes workspace boundary');
  }
  const backupLstat = await lstat(backupAbsPath).catch(() => null);
  if (backupLstat?.isSymbolicLink()) {
    throw new CorrectionError('VALIDATION_ERROR', 'Existing backup path cannot be a symbolic link');
  }
  await copyFile(canonicalFile, backupAbsPath);

  // Apply the approved line modification
  lines[preview.originalLineNumber - 1] = preview.proposedLineText;
  const newContent = lines.join('\n');
  await writeFile(canonicalFile, newContent, 'utf-8');

  // PHASE 4: Run deterministic revalidation
  const netlistFile = artifactPaths?.find((p) => p.endsWith('.net')) ?? 'rover.net';
  const revalPaths = [netlistFile, preview.targetFile];
  if (artifactPaths?.some((p) => p.includes('map.json') || p.includes('engineering-map'))) {
    revalPaths.push('engineering-map.json');
  }

  const revalResult = await validator.validate({
    projectId,
    kind: 'pin_consistency',
    artifactPaths: revalPaths,
    requestedBy: 'safe-correction-engine',
  });

  const now = new Date().toISOString();
  const contextRecord: ContextRecord = {
    id: randomUUID(),
    projectId,
    createdAt: now,
    updatedAt: now,
    kind: 'fact',
    text: `Applied safe correction to ${preview.targetFile}: ${preview.proposedLineText}. Revalidation status: ${revalResult.job.status} (${revalResult.findings.length} findings).`,
    provenance: {
      sourceKind: 'observed_tool',
      actor: 'safe-correction-engine',
      sourceRef: revalResult.job.id,
    },
    evidence: [{ filePath: preview.targetFile, line: preview.originalLineNumber }],
  };

  const result: CorrectionApplyResult = {
    ok: true,
    projectId,
    targetFile: preview.targetFile,
    backupPath: backupRelPath,
    revalidationJob: revalResult.job,
    revalidationFindings: revalResult.findings,
    contextRecord,
    appliedAt: now,
  };

  return CorrectionApplyResultSchema.parse(result);
}

/**
 * Rollback an applied correction using the .bak snapshot.
 */
export async function rollbackCorrection(options: {
  projectId: string;
  workspaceRoot: string;
  targetFile: string;
  backupPath: string;
  validator: EngineeringValidator;
  artifactPaths?: string[];
}): Promise<CorrectionRollbackResult> {
  const { projectId, workspaceRoot, targetFile, backupPath, validator, artifactPaths } = options;

  // Enforce firmware-only targets and matching .bak backup path
  const allowedExts = ['.h', '.hpp', '.ino', '.c', '.cpp'];
  if (!allowedExts.some((ext) => targetFile.endsWith(ext))) {
    throw new CorrectionError(
      'VALIDATION_ERROR',
      `Only firmware source files may be rolled back, received: ${targetFile}`,
    );
  }
  if (backupPath !== `${targetFile}.bak`) {
    throw new CorrectionError(
      'VALIDATION_ERROR',
      `Backup path must strictly match ${targetFile}.bak, received: ${backupPath}`,
    );
  }

  const target = await validateWorkspaceFile(workspaceRoot, targetFile, true);
  const backup = await validateWorkspaceFile(workspaceRoot, backupPath, true);

  // Verify neither is a symlink
  const targetLstat = await lstat(resolve(target.canonicalWorkspace, targetFile)).catch(() => null);
  if (targetLstat?.isSymbolicLink()) {
    throw new CorrectionError('VALIDATION_ERROR', 'Target file cannot be a symbolic link');
  }
  const backupLstat = await lstat(resolve(backup.canonicalWorkspace, backupPath)).catch(() => null);
  if (backupLstat?.isSymbolicLink()) {
    throw new CorrectionError('VALIDATION_ERROR', 'Backup file cannot be a symbolic link');
  }

  const backupContent = await readFile(backup.canonicalFile, 'utf-8');
  await writeFile(target.canonicalFile, backupContent, 'utf-8');

  // Revalidate post-rollback
  const netlistFile = artifactPaths?.find((p) => p.endsWith('.net')) ?? 'rover.net';
  const revalPaths = [netlistFile, targetFile];
  if (
    artifactPaths?.some((p) => p.includes('map.json') || p.includes('engineering-map')) ||
    (await stat(resolve(workspaceRoot, 'engineering-map.json')).catch(() => null))
  ) {
    revalPaths.push('engineering-map.json');
  }

  const revalResult = await validator.validate({
    projectId,
    kind: 'pin_consistency',
    artifactPaths: revalPaths,
    requestedBy: 'safe-correction-rollback',
  });

  const result: CorrectionRollbackResult = {
    ok: true,
    targetFile,
    restoredAt: new Date().toISOString(),
    revalidationJob: revalResult.job,
    revalidationFindings: revalResult.findings,
  };

  return CorrectionRollbackResultSchema.parse(result);
}
