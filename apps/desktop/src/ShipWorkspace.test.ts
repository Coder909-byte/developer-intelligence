// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ShipWorkspace } from './ShipWorkspace.js';
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement;
let root: Root;
let reduced = false;
let frames: FrameRequestCallback[];
beforeEach(() => {
  reduced = false;
  frames = [];
  vi.spyOn(window, 'matchMedia').mockImplementation((media) => ({
    matches: media.includes('prefers-reduced-motion') ? reduced : media.includes('pointer: fine'),
    media,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
  }));
  vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((fn) => {
    frames.push(fn);
    return frames.length;
  });
  vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {});
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});
async function render() {
  await act(async () =>
    root.render(
      createElement(ShipWorkspace, {
        projectName: undefined,
        jobId: undefined,
        engine: 'disconnected',
        onNavigate: () => {},
      }),
    ),
  );
}
describe('decorative crew and cursor effects', () => {
  it('keeps six decorative crews independently scoped to their room and allows motion to be paused', async () => {
    await render();
    expect(host.querySelectorAll('.ship-room .pixel-roam')).toHaveLength(6);
    const toggle = host.querySelector<HTMLButtonElement>('.ship-motion-toggle')!;
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    await act(async () => toggle.click());
    expect(toggle.textContent).toBe('Resume motion');
    expect(host.querySelector('.ship-motion-paused')).not.toBeNull();
    expect(host.textContent).toContain('DECORATIVE CREW / LIVE PROJECT DATA');
  });
  it('starts paused for reduced motion preferences', async () => {
    reduced = true;
    await render();
    expect(host.querySelector('.ship-motion-paused')).not.toBeNull();
  });
  it('lights only the pointed room and removes the effect when motion is paused', async () => {
    await render();
    const room = host.querySelector<HTMLButtonElement>('.ship-room')!;
    vi.spyOn(room, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      width: 200,
      height: 200,
      bottom: 200,
      right: 200,
      toJSON: () => ({}),
    });
    await act(async () =>
      room.dispatchEvent(
        new PointerEvent('pointermove', {
          bubbles: true,
          clientX: 75,
          clientY: 50,
          pointerType: 'mouse',
        }),
      ),
    );
    expect(frames).toHaveLength(1);
    await act(async () => frames[0]!(0));
    expect(host.querySelectorAll('[data-pointer-lit="true"]')).toHaveLength(1);
    expect(room.style.getPropertyValue('--spot-x')).not.toBe('');
    await act(async () => host.querySelector<HTMLButtonElement>('.ship-motion-toggle')!.click());
    expect(host.querySelector('[data-pointer-lit]')).toBeNull();
  });
});
