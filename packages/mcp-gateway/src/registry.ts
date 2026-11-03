import { spawn } from 'node:child_process';
import type { DaemonClient } from '@udi/client-sdk';
import type { McpServer } from '@udi/contracts';

export interface McpRegistry {
  list(): Promise<McpServer[]>;
  register(server: McpServer): Promise<McpServer>;
  checkHealth(id: string): Promise<McpServer>;
  delete?(id: string): Promise<boolean>;
}

export interface McpRegistryOptions {
  fetcher?: typeof globalThis.fetch | undefined;
  probeTimeoutMs?: number | undefined;
}

export class DefaultMcpRegistry implements McpRegistry {
  private readonly fetcher: typeof globalThis.fetch;
  private readonly probeTimeoutMs: number;

  constructor(
    private readonly client: DaemonClient,
    options: McpRegistryOptions = {},
  ) {
    this.fetcher = options.fetcher ?? globalThis.fetch;
    this.probeTimeoutMs = options.probeTimeoutMs ?? 3000;
  }

  async list(): Promise<McpServer[]> {
    const { items } = await this.client.listMcpServers();
    return items;
  }

  async register(server: McpServer): Promise<McpServer> {
    return this.client.createMcpServer({
      name: server.name,
      enabled: server.enabled,
      transport: server.transport,
      ...(server.secretRef !== undefined ? { secretRef: server.secretRef } : {}),
    });
  }

  async delete(id: string): Promise<boolean> {
    const res = await this.client.deleteMcpServer(id);
    return res.deleted;
  }

  async checkHealth(id: string): Promise<McpServer> {
    const server = await this.client.getMcpServer(id);
    if (!server.enabled) {
      const updated: McpServer = { ...server, status: 'disabled' };
      return this.client.replaceMcpServer(id, updated);
    }

    let isHealthy = false;

    if (server.transport.type === 'stdio') {
      const exe = server.transport.executableId;
      isHealthy = await new Promise<boolean>((resolve) => {
        let child: ReturnType<typeof spawn>;

        try {
          child = spawn(exe, ['--version'], {
            shell: false,
            stdio: ['ignore', 'ignore', 'ignore'],
          });
        } catch {
          return resolve(false);
        }

        const timer = setTimeout(() => {
          try {
            child.kill('SIGTERM');
          } catch {
            // Already exited
          }
          resolve(false);
        }, this.probeTimeoutMs);

        child.on('error', () => {
          if (timer) clearTimeout(timer);
          resolve(false);
        });

        child.on('exit', (code) => {
          if (timer) clearTimeout(timer);
          resolve(code === 0);
        });
      });
    } else if (server.transport.type === 'http') {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.probeTimeoutMs);
        const res = await this.fetcher(server.transport.url, {
          method: 'GET',
          signal: controller.signal,
        });
        clearTimeout(timer);
        isHealthy = res.status < 500;
      } catch {
        isHealthy = false;
      }
    }

    const updated: McpServer = {
      ...server,
      status: isHealthy ? 'healthy' : 'unreachable',
    };

    return this.client.replaceMcpServer(id, updated);
  }
}
