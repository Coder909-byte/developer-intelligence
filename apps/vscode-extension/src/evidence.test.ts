import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { containedFile, evidencePosition, scopedFindings, workspaceProjects } from './evidence.js';
import type { Project, ValidationFinding } from '@udi/contracts';
let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'udi-evidence-'));
  await mkdir(path.join(directory, 'workspace'));
  await writeFile(path.join(directory, 'workspace', 'pins.h'), 'GPIO26');
  await writeFile(path.join(directory, 'outside.h'), 'private');
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});
describe('workspace-scoped evidence', () => {
  it('opens contained evidence and rejects traversal, external files and missing files', async () => {
    const root = path.join(directory, 'workspace');
    expect(await containedFile(root, 'pins.h')).toBe(path.join(root, 'pins.h'));
    await expect(containedFile(root, '../outside.h')).rejects.toThrow('outside');
    await expect(containedFile(root, path.join(directory, 'outside.h'))).rejects.toThrow('outside');
    await expect(containedFile(root, 'missing.h')).rejects.toThrow();
  });
  it('converts API one-based evidence positions', () => {
    expect(evidencePosition(14, 4)).toEqual({ line: 13, character: 3 });
    expect(evidencePosition()).toEqual({ line: 0, character: 0 });
  });
  it('rejects findings from another project', () => {
    expect(() => scopedFindings('one', [{ projectId: 'two' } as ValidationFinding])).toThrow(
      'another project',
    );
    expect(scopedFindings('one', [])).toEqual([]);
  });
  it('requires a canonical open-folder match instead of a global fallback', async () => {
    const p = { id: 'project', rootPath: path.join(directory, 'workspace') } as Project;
    expect(await workspaceProjects([p], [path.join(directory, 'workspace')])).toEqual([p]);
    expect(await workspaceProjects([p], [])).toEqual([]);
    expect(await workspaceProjects([{ ...p, rootPath: 'missing' }], ['missing'])).toEqual([]);
  });
});
