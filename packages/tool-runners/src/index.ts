import { spawn } from 'node:child_process';
import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

export type ToolId = 'kicad-cli' | 'platformio' | 'iverilog' | 'vvp';

export interface ToolRunRequest {
  tool: ToolId;
  projectId: string;
  workspaceRoot: string;
  args: readonly string[];
  timeoutMs: number;
  signal?: AbortSignal | undefined;
}

export interface ToolRunResult {
  exitCode: number | null;
  stdoutTail: string;
  stderrTail: string;
  timedOut: boolean;
  cancelled: boolean;
  artifacts: string[];
}

export interface ToolRunner {
  isAvailable(tool: ToolId): Promise<boolean>;
  run(request: ToolRunRequest): Promise<ToolRunResult>;
}

export const ALLOWED_TOOLS: ReadonlySet<ToolId> = new Set([
  'kicad-cli',
  'platformio',
  'iverilog',
  'vvp',
]);

const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024; // 64 KiB

/**
 * Checks for argument characters that suggest shell injection or unsafe metacharacters.
 */
export function validateArgument(arg: string): void {
  if (/[\r\n\0;|`$&]/.test(arg)) {
    throw new Error(`Argument contains forbidden metacharacters: ${JSON.stringify(arg)}`);
  }
}

/**
 * Validates that workspaceRoot is an absolute existing directory,
 * and that any relative path arguments resolve within the workspace boundary.
 */
export async function validateWorkspaceBoundary(
  workspaceRoot: string,
  args: readonly string[],
): Promise<string> {
  if (!isAbsolute(workspaceRoot)) {
    throw new Error(`Workspace root must be an absolute path: ${workspaceRoot}`);
  }

  let canonicalRoot: string;
  try {
    canonicalRoot = await realpath(workspaceRoot);
    const s = await stat(canonicalRoot);
    if (!s.isDirectory()) {
      throw new Error(`Workspace root is not a directory: ${workspaceRoot}`);
    }
  } catch (err) {
    throw new Error(`Workspace root is inaccessible or does not exist: ${workspaceRoot}`, {
      cause: err,
    });
  }

  for (const arg of args) {
    validateArgument(arg);

    // If an argument looks like a relative file path containing directory traversal
    if (arg.includes('..')) {
      const resolved = resolve(canonicalRoot, arg);
      if (!resolved.startsWith(canonicalRoot + '/') && resolved !== canonicalRoot) {
        throw new Error(
          `Argument escapes workspace boundary: ${arg} resolves to ${resolved}`,
        );
      }
    }
  }

  return canonicalRoot;
}

export interface LocalToolRunnerOptions {
  maxOutputBytes?: number;
  toolPathOverrides?: Partial<Record<ToolId, string>>;
}

export class LocalToolRunner implements ToolRunner {
  private readonly maxOutputBytes: number;
  private readonly toolPathOverrides: Partial<Record<ToolId, string>>;

  constructor(options: LocalToolRunnerOptions = {}) {
    this.maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    this.toolPathOverrides = options.toolPathOverrides ?? {};
  }

  async isAvailable(tool: ToolId): Promise<boolean> {
    if (!ALLOWED_TOOLS.has(tool)) {
      return false;
    }
    const exe = this.toolPathOverrides[tool] ?? tool;
    return new Promise<boolean>((resolveAvailability) => {
      try {
        const child = spawn(exe, ['--version'], {
          shell: false,
          stdio: ['ignore', 'ignore', 'ignore'],
        });
        child.on('error', () => resolveAvailability(false));
        child.on('exit', (code) => resolveAvailability(code === 0));
      } catch {
        resolveAvailability(false);
      }
    });
  }

  async run(request: ToolRunRequest): Promise<ToolRunResult> {
    if (!ALLOWED_TOOLS.has(request.tool)) {
      throw new Error(`Tool is not in the allowlist: ${request.tool}`);
    }

    const canonicalWorkspace = await validateWorkspaceBoundary(
      request.workspaceRoot,
      request.args,
    );

    const exe = this.toolPathOverrides[request.tool] ?? request.tool;
    const timeoutMs = Math.max(100, Math.min(request.timeoutMs, 300_000));

    return new Promise<ToolRunResult>((resolveRun, reject) => {
      let timedOut = false;
      let cancelled = false;

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(exe, [...request.args], {
          cwd: canonicalWorkspace,
          shell: false,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (err) {
        return reject(err);
      }

      const onAbort = () => {
        cancelled = true;
        child.kill('SIGTERM');
        setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            // Already exited
          }
        }, 1000);
      };

      if (request.signal) {
        if (request.signal.aborted) {
          onAbort();
        } else {
          request.signal.addEventListener('abort', onAbort, { once: true });
        }
      }

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            // Already exited
          }
        }, 1000);
      }, timeoutMs);

      child.stdout?.on('data', (chunk: Buffer) => {
        stdoutChunks.push(chunk);
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        stderrChunks.push(chunk);
      });

      child.on('error', (err) => {
        if (timer) clearTimeout(timer);
        if (request.signal) {
          request.signal.removeEventListener('abort', onAbort);
        }
        // If executable was not found
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          resolveRun({
            exitCode: 127,
            stdoutTail: '',
            stderrTail: `Executable not found: ${exe}`,
            timedOut: false,
            cancelled: false,
            artifacts: [],
          });
          return;
        }
        reject(err);
      });

      child.on('close', (code) => {
        if (timer) clearTimeout(timer);
        if (request.signal) {
          request.signal.removeEventListener('abort', onAbort);
        }

        const fullStdout = Buffer.concat(stdoutChunks).toString('utf-8');
        const fullStderr = Buffer.concat(stderrChunks).toString('utf-8');

        // Tail to max output bytes
        const stdoutTail =
          fullStdout.length > this.maxOutputBytes
            ? fullStdout.slice(fullStdout.length - this.maxOutputBytes)
            : fullStdout;
        const stderrTail =
          fullStderr.length > this.maxOutputBytes
            ? fullStderr.slice(fullStderr.length - this.maxOutputBytes)
            : fullStderr;

        resolveRun({
          exitCode: code,
          stdoutTail,
          stderrTail,
          timedOut,
          cancelled,
          artifacts: [],
        });
      });
    });
  }
}
