import { copyFile, readFile, writeFile } from 'node:fs/promises';
import type { McpServer } from '@udi/contracts';

export type HostType = 'vscode' | 'opencode' | 'claude_desktop';

export function generateHostConfig(
  host: HostType,
  servers: McpServer[],
  env?: Record<string, string>,
): Record<string, unknown> {
  const activeServers = servers.filter((s) => s.enabled);

  if (host === 'vscode') {
    const mcpServers: Record<string, unknown> = {};
    for (const s of activeServers) {
      if (s.transport.type === 'stdio') {
        mcpServers[s.name] = {
          command: s.transport.executableId,
          args: s.transport.args,
          ...(env && Object.keys(env).length > 0 ? { env } : {}),
        };
      } else {
        mcpServers[s.name] = {
          url: s.transport.url,
        };
      }
    }
    return { mcpServers };
  }

  if (host === 'opencode') {
    const serversMap: Record<string, unknown> = {};
    for (const s of activeServers) {
      if (s.transport.type === 'stdio') {
        serversMap[s.name] = {
          type: 'local',
          command: [s.transport.executableId, ...s.transport.args],
          ...(env && Object.keys(env).length > 0 ? { environment: env } : {}),
        };
      } else {
        serversMap[s.name] = {
          type: 'remote',
          url: s.transport.url,
        };
      }
    }
    return {
      $schema: 'https://opencode.ai/config.json',
      mcp: {
        servers: serversMap,
      },
    };
  }

  // claude_desktop
  const mcpServers: Record<string, unknown> = {};
  for (const s of activeServers) {
    if (s.transport.type === 'stdio') {
      mcpServers[s.name] = {
        command: s.transport.executableId,
        args: s.transport.args,
        ...(env && Object.keys(env).length > 0 ? { env } : {}),
      };
    } else {
      mcpServers[s.name] = {
        url: s.transport.url,
      };
    }
  }
  return { mcpServers };
}

export function previewConfigDiff(
  currentContent: string,
  newConfigObj: unknown,
): { hasChanges: boolean; diff: string; formatted: string } {
  const formatted = JSON.stringify(newConfigObj, null, 2);
  const trimmedCurrent = currentContent.trim();
  const trimmedNew = formatted.trim();

  if (trimmedCurrent === trimmedNew) {
    return {
      hasChanges: false,
      diff: '(no changes)',
      formatted,
    };
  }

  const currentLines = trimmedCurrent ? trimmedCurrent.split('\n') : [];
  const newLines = trimmedNew.split('\n');

  const diffLines: string[] = ['--- current', '+++ proposed'];
  for (const line of currentLines) {
    if (!newLines.includes(line)) {
      diffLines.push(`- ${line}`);
    }
  }
  for (const line of newLines) {
    if (!currentLines.includes(line)) {
      diffLines.push(`+ ${line}`);
    }
  }

  return {
    hasChanges: true,
    diff: diffLines.join('\n'),
    formatted,
  };
}

export async function applyHostConfig(
  filePath: string,
  newConfigObj: unknown,
): Promise<{ backupPath: string | null; written: boolean }> {
  let backupPath: string | null = null;

  try {
    const existing = await readFile(filePath, 'utf-8');
    if (existing) {
      backupPath = `${filePath}.bak`;
      await copyFile(filePath, backupPath);
    }
  } catch {
    // File did not exist; no backup needed
  }

  const content = JSON.stringify(newConfigObj, null, 2) + '\n';
  await writeFile(filePath, content, 'utf-8');

  return {
    backupPath,
    written: true,
  };
}

/** Extension clients use the same authenticated daemon; no additional gateway or host-file write. */
export async function registerHostExtensionTool(
  toolDefinition: import('@udi/contracts').BridgedExtensionTool,
  client: import('@udi/client-sdk').DaemonClient,
): Promise<import('@udi/contracts').BridgedExtensionTool> {
  return client.registerHostExtensionTool(toolDefinition);
}

export class HostExtensionBridge {
  constructor(private readonly client: import('@udi/client-sdk').DaemonClient) {}
  registerHostExtensionTool(toolDefinition: import('@udi/contracts').BridgedExtensionTool) {
    return registerHostExtensionTool(toolDefinition, this.client);
  }
}
