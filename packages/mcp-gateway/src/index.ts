import type { DaemonClient } from '@udi/client-sdk';
import type { McpServer } from '@udi/contracts';
import type { McpServer as SdkMcpServer } from '@modelcontextprotocol/server';
export interface McpRegistry {
  list(): Promise<McpServer[]>;
  register(server: McpServer): Promise<McpServer>;
  checkHealth(id: string): Promise<McpServer>;
}
export interface GatewayOptions {
  client: DaemonClient;
  projectId: string;
}
export interface McpGateway {
  server: SdkMcpServer;
  start(): Promise<void>;
  stop(): Promise<void>;
}
export const READ_TOOL_NAMES = [
  'get_project_context',
  'list_project_events',
  'get_validation_results',
  'list_available_tools',
] as const;
// Developer 2: SDK v2 stdio bridge calls the authenticated daemon; never read SQLite here.
