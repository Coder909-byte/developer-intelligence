import { describe, expect, it } from 'vitest';
import {
  LocalToolRunner,
  validateArgument,
  validateWorkspaceBoundary,
} from './index.js';

describe('tool-runners argument validation', () => {
  it('allows safe CLI arguments', () => {
    expect(() => validateArgument('--run')).not.toThrow();
    expect(() => validateArgument('-e')).not.toThrow();
    expect(() => validateArgument('esp32dev')).not.toThrow();
    expect(() => validateArgument('src/pins.h')).not.toThrow();
  });

  it('rejects shell metacharacters', () => {
    expect(() => validateArgument('foo; rm -rf /')).toThrow(/metacharacters/);
    expect(() => validateArgument('foo && bar')).toThrow(/metacharacters/);
    expect(() => validateArgument('foo | bar')).toThrow(/metacharacters/);
    expect(() => validateArgument('`calc`')).toThrow(/metacharacters/);
    expect(() => validateArgument('$HOME')).toThrow(/metacharacters/);
    expect(() => validateArgument('foo\nbar')).toThrow(/metacharacters/);
  });
});

describe('tool-runners workspace boundary validation', () => {
  const currentDir = process.cwd();

  it('accepts valid absolute directory and intra-workspace relative paths', async () => {
    const canonical = await validateWorkspaceBoundary(currentDir, ['src/index.ts']);
    expect(canonical).toBe(currentDir);
  });

  it('rejects relative workspace root', async () => {
    await expect(validateWorkspaceBoundary('./relative', [])).rejects.toThrow(
      /absolute path/,
    );
  });

  it('rejects non-existent directory', async () => {
    await expect(
      validateWorkspaceBoundary('/non/existent/path/that/does/not/exist', []),
    ).rejects.toThrow(/inaccessible or does not exist/);
  });

  it('rejects path traversal attempting to escape workspace', async () => {
    await expect(
      validateWorkspaceBoundary(currentDir, ['../../../../etc/passwd']),
    ).rejects.toThrow(/escapes workspace boundary/);
  });
});

describe('LocalToolRunner execution', () => {
  const currentDir = process.cwd();

  it('reports unavailable for tools not installed or not in allowlist', async () => {
    const runner = new LocalToolRunner();
    expect(await runner.isAvailable('kicad-cli')).toBe(false);
    // @ts-expect-error testing disallowed tool
    expect(await runner.isAvailable('bash')).toBe(false);
  });

  it('executes allowed tool or handles ENOENT safely', async () => {
    const runner = new LocalToolRunner({
      toolPathOverrides: {
        // Mock with node to test runner process lifecycle
        'kicad-cli': process.execPath,
      },
    });

    const result = await runner.run({
      tool: 'kicad-cli',
      projectId: '00000000-0000-0000-0000-000000000000',
      workspaceRoot: currentDir,
      args: ['-e', 'console.log("hello tool")'],
      timeoutMs: 5000,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdoutTail).toContain('hello tool');
    expect(result.timedOut).toBe(false);
    expect(result.cancelled).toBe(false);
  });

  it('enforces execution timeout', async () => {
    const runner = new LocalToolRunner({
      toolPathOverrides: {
        'kicad-cli': process.execPath,
      },
    });

    const result = await runner.run({
      tool: 'kicad-cli',
      projectId: '00000000-0000-0000-0000-000000000000',
      workspaceRoot: currentDir,
      args: ['-e', 'setTimeout(() => {}, 10000)'],
      timeoutMs: 150,
    });

    expect(result.timedOut).toBe(true);
  });

  it('enforces abort cancellation', async () => {
    const runner = new LocalToolRunner({
      toolPathOverrides: {
        'kicad-cli': process.execPath,
      },
    });

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);

    const result = await runner.run({
      tool: 'kicad-cli',
      projectId: '00000000-0000-0000-0000-000000000000',
      workspaceRoot: currentDir,
      args: ['-e', 'setTimeout(() => {}, 10000)'],
      timeoutMs: 5000,
      signal: controller.signal,
    });

    expect(result.cancelled).toBe(true);
  });
});
