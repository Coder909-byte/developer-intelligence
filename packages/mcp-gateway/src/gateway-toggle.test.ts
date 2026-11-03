import { it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
it('filters and re-enables all four categories over real stdio without restarting, and relays extension calls', async () => {
  const { stdout } = await promisify(execFile)(
    process.execPath,
    ['scripts/verify-context-mcp-bridge.mjs', '--source'],
    { cwd: resolve(import.meta.dirname, '../../..'), timeout: 35000 },
  );
  expect(stdout).toContain('"status":"PASS"');
}, 40000);
