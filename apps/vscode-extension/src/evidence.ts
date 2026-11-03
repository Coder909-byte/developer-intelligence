import path from 'node:path';
import { realpath } from 'node:fs/promises';
import type { ValidationFinding, Project } from '@udi/contracts';
export async function containedFile(root: string, filePath: string): Promise<string> {
  const canonicalRoot = await realpath(root);
  const canonicalFile = await realpath(path.resolve(canonicalRoot, filePath));
  const relative = path.relative(canonicalRoot, canonicalFile);
  if (
    !relative ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  )
    throw new Error('Evidence is outside the active workspace');
  return canonicalFile;
}
export function evidencePosition(line?: number, column?: number) {
  return { line: Math.max(0, (line ?? 1) - 1), character: Math.max(0, (column ?? 1) - 1) };
}
export function scopedFindings(projectId: string, findings: ValidationFinding[], jobId?: string) {
  if (findings.some((f) => f.projectId !== projectId || (jobId !== undefined && f.jobId !== jobId)))
    throw new Error('Daemon returned findings from another project');
  return findings;
}
export async function workspaceProjects(projects: Project[], workspacePaths: readonly string[]) {
  const roots = new Set(await Promise.all(workspacePaths.map((p) => realpath(p).catch(() => ''))));
  roots.delete('');
  const matches: Project[] = [];
  for (const p of projects)
    if (roots.has(await realpath(p.rootPath).catch(() => ''))) matches.push(p);
  return matches;
}
