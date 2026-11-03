export type ToolId = 'kicad-cli' | 'platformio' | 'iverilog';
export interface ToolRunRequest {
  tool: ToolId;
  projectId: string;
  workspaceRoot: string;
  args: readonly string[];
  timeoutMs: number;
  signal?: AbortSignal;
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
// Developer 2: enforce executable/argument allowlists, canonical workspace boundaries and output limits.
