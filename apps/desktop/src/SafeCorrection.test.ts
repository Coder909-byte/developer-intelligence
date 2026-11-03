// @vitest-environment happy-dom
// @vitest-environment-options {"url":"http://127.0.0.1:5173"}
import { describe, it, expect, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';
import { mkdtemp, cp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createClient, DaemonClientError } from '@udi/client-sdk';
import { buildApp } from '../../core-daemon/src/app.js';
import { createDefaultIntegrations } from '../../core-daemon/src/integrations.js';
import { SafeCorrection, supportsCorrection } from './SafeCorrection.js';
import type { ValidationFinding, Job } from '@udi/contracts';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

async function runtime() {
  const directory = await mkdtemp(join(tmpdir(), 'udi-frontend-correction-'));
  const workspace = join(directory, 'rover');
  await cp(resolve('examples/rover'), workspace, { recursive: true });
  const token = randomBytes(32).toString('hex');
  const app = buildApp({
    databasePath: join(directory, 'qa.sqlite'),
    token,
    logger: false,
    integrations: createDefaultIntegrations,
  });
  const baseUrl = await app.listen({ host: '127.0.0.1', port: 0 });
  const client = createClient({ baseUrl, token });
  const project = await client.createProject({
    name: 'Frontend correction fixture',
    rootPath: workspace,
  });
  const job = await client.requestValidation(project.id, {
    kind: 'pin_consistency',
    artifactPaths: ['rover.net', 'src/pins.h', 'engineering-map.json'],
    requestedBy: 'frontend-integration-test',
  });
  const finding = (await client.listFindings(project.id, { jobId: job.id })).items[0]!;
  return {
    client,
    project,
    finding,
    workspace,
    async close() {
      await app.close();
      const rel = relative(tmpdir(), directory);
      if (isAbsolute(rel) || rel.startsWith('..')) throw Error('Unexpected test directory');
      await rm(directory, { recursive: true, force: true });
    },
  };
}
async function mounted(finding: ValidationFinding, r: Awaited<ReturnType<typeof runtime>>) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const jobs: Job[] = [];
  const starts = vi.fn();
  await act(async () =>
    root.render(
      createElement(SafeCorrection, {
        client: r.client,
        projectId: r.project.id,
        finding,
        onCancel: () => {},
        onStart: starts,
        onJob: (j) => jobs.push(j),
      }),
    ),
  );
  async function settled(check: () => void) {
    await vi.waitFor(async () => {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
      check();
    });
  }
  async function click(label: string) {
    const button = [...host.querySelectorAll('button')].find((b) => b.textContent === label)!;
    expect(button).toBeDefined();
    await act(async () => button.click());
  }
  async function approve(index = 0) {
    await act(async () =>
      host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[index]!.click(),
    );
  }
  return {
    host,
    jobs,
    starts,
    settled,
    click,
    approve,
    async close() {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}
describe('frontend safe correction over actual daemon HTTP', () => {
  it('requires review/approval, applies the real diff, selects persisted revalidation and restores the backup', async () => {
    const r = await runtime();
    const ui = await mounted(r.finding, r);
    try {
      expect(supportsCorrection(r.finding)).toBe(true);
      const before = await readFile(join(r.workspace, 'src/pins.h'), 'utf8');
      await ui.settled(() => expect(ui.host.textContent).toContain('Before correction'));
      expect(await readFile(join(r.workspace, 'src/pins.h'), 'utf8')).toBe(before);
      expect(ui.host.textContent).toContain('GPIO26');
      expect(ui.host.textContent).toContain('GPIO14');
      await ui.click('Apply Fix');
      expect(ui.jobs).toHaveLength(0);
      await ui.approve();
      await ui.click('Apply Fix');
      await ui.settled(() => expect(ui.jobs).toHaveLength(1));
      expect(ui.starts).toHaveBeenCalledTimes(1);
      expect(ui.jobs[0]?.status).toBe('succeeded');
      expect(
        (await r.client.listFindings(r.project.id, { jobId: ui.jobs[0]!.id })).items,
      ).toHaveLength(0);
      expect(await readFile(join(r.workspace, 'src/pins.h'), 'utf8')).toContain(
        '#define MOTOR_EN GPIO14',
      );
      expect(await readFile(join(r.workspace, 'src/pins.h.bak'), 'utf8')).toBe(before);
      await ui.click('Undo Correction');
      expect(ui.jobs).toHaveLength(1);
      await ui.approve();
      await ui.click('Undo Correction');
      await ui.settled(() => expect(ui.jobs).toHaveLength(2));
      expect(await readFile(join(r.workspace, 'src/pins.h'), 'utf8')).toBe(before);
      expect(ui.jobs[1]?.status).toBe('failed');
      expect(
        (await r.client.listFindings(r.project.id, { jobId: ui.jobs[1]!.id })).items.length,
      ).toBeGreaterThan(0);
    } finally {
      await ui.close();
      await r.close();
    }
  });
  it('rejects a stale preview and requires another review without silently retrying', async () => {
    const r = await runtime();
    const ui = await mounted(r.finding, r);
    try {
      await ui.settled(() => expect(ui.host.textContent).toContain('Before correction'));
      const { appendFile } = await import('node:fs/promises');
      await appendFile(join(r.workspace, 'src/pins.h'), '\n// Concurrent edit\n');
      await ui.approve();
      await ui.click('Apply Fix');
      await ui.settled(() => expect(ui.host.textContent).toContain('File changed since preview'));
      expect(ui.jobs).toHaveLength(0);
      expect(ui.host.textContent).not.toContain('Correction applied.');
      expect(ui.host.querySelector('input[type="checkbox"]')).toBeNull();
    } finally {
      await ui.close();
      await r.close();
    }
  });
  it('shows unavailable/authentication failures without an apply action', async () => {
    const r = await runtime();
    vi.spyOn(r.client, 'previewCorrection').mockRejectedValue(
      new DaemonClientError('UNAUTHORIZED', 'token required'),
    );
    const ui = await mounted(r.finding, r);
    try {
      await ui.settled(() => expect(ui.host.textContent).toContain('Authentication required'));
      expect(ui.host.textContent).not.toContain('Apply Fix');
      expect(ui.jobs).toHaveLength(0);
    } finally {
      await ui.close();
      await r.close();
    }
  });
});
