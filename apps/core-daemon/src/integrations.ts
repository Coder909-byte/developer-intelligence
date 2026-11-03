import { spawn } from 'node:child_process';
import type { PlatformDatabase } from '@udi/event-store';
import { DefaultContextEngine } from '@udi/context-engine';
import { DefaultEngineeringValidator } from '@udi/engineering-core';
import { LocalToolRunner } from '@udi/tool-runners';
import type { PlatformIntegrations } from './platform-routes.js';

export function createDefaultIntegrations(
  store: Omit<PlatformDatabase, 'close'>,
): PlatformIntegrations {
  const runner = new LocalToolRunner();

  const validator = new DefaultEngineeringValidator({
    runner,
    async resolveWorkspace(projectId: string) {
      const p = store.projects.get(projectId);
      if (!p) {
        throw new Error(`Project ${projectId} not found`);
      }
      return p.rootPath;
    },
  });

  return {
    context: new DefaultContextEngine(store.context),
    engineering: validator,
    mcp: {
      async checkHealth(id: string) {
        const server = await store.mcpServers.get(id);
        if (!server) {
          throw new Error(`MCP server ${id} not found`);
        }
        if (!server.enabled) {
          const updated = { ...server, status: 'disabled' as const };
          return store.mcpServers.replace(updated);
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
            }, 3000);

            child.on('error', () => {
              clearTimeout(timer);
              resolve(false);
            });

            child.on('exit', (code) => {
              clearTimeout(timer);
              resolve(code === 0);
            });
          });
        } else if (server.transport.type === 'http') {
          try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 3000);
            const res = await fetch(server.transport.url, {
              method: 'GET',
              signal: controller.signal,
            });
            clearTimeout(timer);
            isHealthy = res.status < 500;
          } catch {
            isHealthy = false;
          }
        }

        const updated = {
          ...server,
          status: isHealthy ? ('healthy' as const) : ('unreachable' as const),
        };
        return store.mcpServers.replace(updated);
      },
    },
  };
}
