import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { relative, resolve, isAbsolute, sep } from 'node:path';
import { PersistenceError } from '@udi/event-store';
import type { PlatformDatabase } from '@udi/event-store';
import { DefaultContextEngine } from '@udi/context-engine';
import {
  DefaultEngineeringValidator,
  generateCorrectionPreview,
  applyCorrection,
  rollbackCorrection,
  CorrectionError,
} from '@udi/engineering-core';
import { LocalToolRunner } from '@udi/tool-runners';
import { discoverServerTools, routeToolCall, buildUnifiedInventory } from '@udi/mcp-gateway';
import type { DiscoveredTool } from '@udi/contracts';
import { LayaClassifierService } from './classifier/laya-classifier.js';
import type { PlatformIntegrations } from './platform-routes.js';

function toPersistenceCode(
  code: CorrectionError['code'],
): 'NOT_FOUND' | 'CONFLICT' | 'VALIDATION_ERROR' {
  if (code === 'UNAUTHORIZED') return 'VALIDATION_ERROR';
  return code;
}

export function createDefaultIntegrations(
  store: Omit<PlatformDatabase, 'close'>,
): PlatformIntegrations {
  const runner = new LocalToolRunner();
  const discoveredToolsMap = new Map<string, DiscoveredTool[]>();

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
    classifier: new LayaClassifierService(process.env.LAYA_MODEL_URL),
    context: new DefaultContextEngine(store.context),
    engineering: {
      async validate(request, signal) {
        const project = store.projects.get(request.projectId);
        if (!project) throw new PersistenceError('NOT_FOUND', 'Project not found');
        // The validator receives authorized artifact paths, never an arbitrary local filesystem path.
        const root = await realpath(project.rootPath);
        for (const artifact of request.artifactPaths) {
          let canonical: string;
          try {
            canonical = await realpath(resolve(root, artifact));
          } catch {
            throw new PersistenceError(
              'VALIDATION_ERROR',
              'Validation artifacts must exist in the project workspace',
            );
          }
          const path = relative(root, canonical);
          if (path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path))
            throw new PersistenceError(
              'VALIDATION_ERROR',
              'Validation artifact escapes the project workspace',
            );
        }
        if (
          request.kind === 'pin_consistency' &&
          !request.artifactPaths.some(
            (path) => path.includes('map.json') || path.includes('engineering-map'),
          )
        ) {
          // The existing validator optionally loads this default even when it is not listed.
          const defaultMap = await realpath(resolve(root, 'engineering-map.json')).catch(
            () => undefined,
          );
          if (defaultMap) {
            const path = relative(root, defaultMap);
            if (path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path))
              throw new PersistenceError(
                'VALIDATION_ERROR',
                'Default engineering map escapes the project workspace',
              );
          }
        }
        return validator.validate(request, signal);
      },
    },
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
    correction: {
      async previewCorrection(projectId, findingId) {
        const project = store.projects.get(projectId);
        if (!project) throw new PersistenceError('NOT_FOUND', 'Project not found');
        const findings = await store.validation.listFindings(projectId);
        const finding = findings.find((f) => f.id === findingId);
        if (!finding) throw new PersistenceError('NOT_FOUND', 'Finding not found in project');
        try {
          return await generateCorrectionPreview({
            projectId,
            workspaceRoot: project.rootPath,
            finding,
          });
        } catch (err) {
          if (err instanceof CorrectionError) {
            throw new PersistenceError(toPersistenceCode(err.code), err.message);
          }
          throw err;
        }
      },
      async applyCorrection(projectId, input) {
        const project = store.projects.get(projectId);
        if (!project) throw new PersistenceError('NOT_FOUND', 'Project not found');
        const findings = await store.validation.listFindings(projectId);
        const finding = findings.find((f) => f.id === input.findingId);
        if (!finding) throw new PersistenceError('NOT_FOUND', 'Finding not found in project');

        const firmwareEvidence = finding.evidence.find(
          (ev) =>
            ev.filePath.endsWith('.h') ||
            ev.filePath.endsWith('.hpp') ||
            ev.filePath.endsWith('.ino') ||
            ev.filePath.endsWith('.c') ||
            ev.filePath.endsWith('.cpp'),
        );
        if (firmwareEvidence) {
          const targetPath = resolve(project.rootPath, firmwareEvidence.filePath);
          try {
            const raw = await readFile(targetPath, 'utf-8');
            const currentHash = createHash('sha256').update(raw, 'utf-8').digest('hex');
            if (currentHash !== input.expectedOriginalHash) {
              throw new PersistenceError(
                'CONFLICT',
                'File has been modified since preview was generated (stale preview rejected)',
              );
            }
          } catch (err) {
            if (err instanceof PersistenceError) throw err;
          }
        }

        try {
          const basePreview = await generateCorrectionPreview({
            projectId,
            workspaceRoot: project.rootPath,
            finding,
          });
          const preview = { ...basePreview, id: input.previewId };
          return await applyCorrection({
            projectId,
            workspaceRoot: project.rootPath,
            preview,
            userApproved: input.userApproved,
            validator,
          });
        } catch (err) {
          if (err instanceof CorrectionError) {
            throw new PersistenceError(toPersistenceCode(err.code), err.message);
          }
          throw err;
        }
      },
      async rollbackCorrection(projectId, input) {
        const project = store.projects.get(projectId);
        if (!project) throw new PersistenceError('NOT_FOUND', 'Project not found');
        try {
          return await rollbackCorrection({
            projectId,
            workspaceRoot: project.rootPath,
            targetFile: input.targetFile,
            backupPath: input.backupPath,
            validator,
          });
        } catch (err) {
          if (err instanceof CorrectionError) {
            throw new PersistenceError(toPersistenceCode(err.code), err.message);
          }
          throw err;
        }
      },
    },
    aggregator: {
      async listIntegrations() {
        const servers = await store.mcpServers.list();
        return buildUnifiedInventory(servers, discoveredToolsMap);
      },
      async discoverServerTools(serverId) {
        const server = await store.mcpServers.get(serverId);
        if (!server) throw new PersistenceError('NOT_FOUND', 'MCP server not found');
        try {
          const tools = await discoverServerTools(server);
          discoveredToolsMap.set(serverId, tools);
          return tools;
        } catch (err) {
          throw new PersistenceError(
            'VALIDATION_ERROR',
            `Failed to discover tools for ${server.name}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      },
      async routeToolCall(serverId, toolName, args, options) {
        const server = await store.mcpServers.get(serverId);
        if (!server) throw new PersistenceError('NOT_FOUND', 'MCP server not found');
        if (!server.enabled) {
          throw new PersistenceError('VALIDATION_ERROR', `MCP server ${server.name} is disabled`);
        }
        const executionId = randomUUID();
        try {
          const { result, durationMs } = await routeToolCall(server, toolName, args);
          const outcome =
            result !== null &&
            typeof result === 'object' &&
            'isError' in result &&
            result.isError === true
              ? 'failed'
              : 'succeeded';

          if (options?.projectId) {
            // Record event
            await store.events.append({
              id: executionId,
              projectId: options.projectId,
              type: 'mcp.tool.executed',
              actor: options.agentId ?? 'mcp-aggregator',
              sourceKind: 'observed_tool',
              sourceRef: executionId,
              createdAt: new Date().toISOString(),
              schemaVersion: 1,
              payload: {
                serverId: server.id,
                serverName: server.name,
                toolName,
                durationMs,
                outcome,
                summary: `Executed tool ${toolName} on ${server.name}: ${outcome}`,
              },
            });

            // Append fact context record
            await store.context.append({
              id: randomUUID(),
              projectId: options.projectId,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              kind: 'fact',
              text: `Discovered MCP tool executed: ${server.name} -> ${toolName}. Outcome: ${outcome} (${durationMs}ms).`,
              provenance: {
                sourceKind: 'observed_tool',
                actor: options.agentId ?? 'mcp-aggregator',
                sourceRef: executionId,
              },
              evidence: [],
            });
          }

          return { result, executionId, durationMs };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (options?.projectId) {
            await store.events.append({
              id: executionId,
              projectId: options.projectId,
              type: 'mcp.tool.executed',
              actor: options.agentId ?? 'mcp-aggregator',
              sourceKind: 'observed_tool',
              sourceRef: executionId,
              createdAt: new Date().toISOString(),
              schemaVersion: 1,
              payload: {
                serverId: server.id,
                serverName: server.name,
                toolName,
                durationMs: 0,
                outcome: 'failed',
                error: msg,
                summary: `Failed to execute tool ${toolName} on ${server.name}: ${msg}`,
              },
            });
          }
          throw new PersistenceError('VALIDATION_ERROR', msg);
        }
      },
    },
  };
}
