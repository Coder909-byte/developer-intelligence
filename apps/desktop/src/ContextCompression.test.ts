// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { ContextCompressionInspector } from './ContextCompressionInspector.js';
import { CategoricalToolHub } from './CategoricalToolHub.js';

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
const inspection: NonNullable<ComponentProps<typeof ContextCompressionInspector>['inspection']> = {
  rawTokens: 14250,
  injectedTokens: 340,
  preserved: 8,
  pruned: 142,
  classifications: [
    {
      id: 'signal',
      timestamp: '2026-11-04T00:00:00Z',
      source: 'validator',
      score: 0.95,
      category: 'HARDWARE_SPEC',
      preserve: true,
      fact: 'Fixture invariant',
    },
    {
      id: 'noise',
      timestamp: '2026-11-04T00:00:00Z',
      source: 'terminal',
      score: 0.12,
      category: 'EPHEMERAL_NOISE',
      preserve: false,
      fact: 'Fixture noise',
    },
  ],
  injectedBlock: '# Exact fixture payload\n\n`MOTOR_EN = GPIO14`',
};
it('renders measured savings, backend decisions, and copies the exact payload', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  await act(async () =>
    root.render(createElement(ContextCompressionInspector, { events: [], inspection })),
  );
  expect(host.textContent).toContain('97.6%');
  expect(host.querySelector('.preserve')?.textContent).toContain('PRESERVE TO MEMORY');
  expect(host.querySelector('.prune')?.textContent).toContain('PRUNE / DISCARD');
  await act(async () => host.querySelector('button')!.click());
  expect(writeText).toHaveBeenCalledWith(inspection.injectedBlock);
});
it('keeps unknown and zero-input savings honest and handles clipboard rejection', async () => {
  await act(async () => root.render(createElement(ContextCompressionInspector, { events: [] })));
  expect(host.textContent).toContain('Awaiting compression service');
  expect(host.textContent).not.toContain('97.6%');
  expect(host.querySelector('button')!.disabled).toBe(true);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
  });
  await act(async () =>
    root.render(
      createElement(ContextCompressionInspector, {
        events: [],
        inspection: { ...inspection, rawTokens: 0, injectedTokens: 0 },
      }),
    ),
  );
  expect(host.querySelector('progress')).toBeNull();
  await act(async () => host.querySelector('button')!.click());
  expect(host.textContent).toContain('Copy unavailable');
});
const snapshot: NonNullable<ComponentProps<typeof CategoricalToolHub>['snapshot']> = {
  categories: [
    {
      id: 'hardware_validation',
      name: 'Hardware & Embedded',
      description: 'Fixture tools',
      enabled: true,
      toolCount: 1,
    },
  ],
  activeTools: [
    {
      id: 'validate',
      name: 'validate_pins',
      description: 'Fixture validator',
      category: 'hardware_validation',
    },
  ],
};
it('requests the exact category change and waits for authoritative scope before changing counts', async () => {
  const onToggle = vi.fn().mockResolvedValue(undefined);
  await act(async () =>
    root.render(createElement(CategoricalToolHub, { snapshot, inventory: [], onToggle })),
  );
  await act(async () => host.querySelector<HTMLButtonElement>('[role="switch"]')!.click());
  expect(onToggle).toHaveBeenCalledWith('hardware_validation', false);
  expect(host.textContent).toContain('1 active tools');
  await act(async () =>
    root.render(
      createElement(CategoricalToolHub, {
        inventory: [],
        onToggle,
        snapshot: { categories: [{ ...snapshot.categories[0]!, enabled: false }], activeTools: [] },
      }),
    ),
  );
  expect(host.textContent).toContain('0 active tools');
  expect(host.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('false');
});
it('retains policy after a rejected toggle and prevents unsupported writes', async () => {
  await act(async () =>
    root.render(
      createElement(CategoricalToolHub, {
        snapshot,
        inventory: [],
        onToggle: vi.fn().mockRejectedValue(new Error('offline')),
      }),
    ),
  );
  await act(async () => host.querySelector<HTMLButtonElement>('[role="switch"]')!.click());
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Category change failed');
  expect(host.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('true');
  await act(async () =>
    root.render(createElement(CategoricalToolHub, { snapshot, inventory: [] })),
  );
  expect(host.querySelector<HTMLButtonElement>('[role="switch"]')!.disabled).toBe(true);
});
