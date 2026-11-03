import type { ComponentProps } from 'react';
import type { DaemonClient } from '@udi/client-sdk';
import type { ToolCategory } from '@udi/contracts';
import type { ContextCompressionInspector } from './ContextCompressionInspector.js';
import type { CategoricalToolHub } from './CategoricalToolHub.js';

// Presentation inputs, not HTTP contracts. Map the approved SDK responses here
// when the backend owner publishes them. Never fetch guessed endpoints from UI.
export interface MissionControlSource {
  inspect(
    projectId: string,
  ): Promise<ComponentProps<typeof ContextCompressionInspector>['inspection']>;
  tools(projectId: string): Promise<ComponentProps<typeof CategoricalToolHub>['snapshot']>;
  toggle(projectId: string, category: string, enabled: boolean): Promise<void>;
}

export type MissionControlFactory = (client: DaemonClient) => MissionControlSource;

const TOOL_METADATA: Record<string, { category: ToolCategory; description: string }> = {
  run_engineering_validation: {
    category: 'hardware_validation',
    description: 'Deterministic schematic vs firmware pin validation (KiCad .net vs C++ pins.h).',
  },
  get_validation_results: {
    category: 'hardware_validation',
    description: 'Retrieves genuine engineering validation findings and diagnostic evidence.',
  },
  get_project_context: {
    category: 'context_memory',
    description:
      'Retrieves verified ground truth project memory, active invariants, and open issues.',
  },
  get_compressed_context: {
    category: 'context_memory',
    description:
      'Spec 2 verified deterministic delta or classified AI rollup; token estimates and provenance retained.',
  },
  record_decision: {
    category: 'context_memory',
    description:
      'Records an engineering or task decision into project memory with strict agent_summary provenance.',
  },
  list_project_events: {
    category: 'context_memory',
    description: 'Lists chronological activity events and audit history for the project.',
  },
  list_available_tools: {
    category: 'context_memory',
    description: 'Lists all available MCP gateway tools and daemon capabilities.',
  },
  save_context_snapshot: {
    category: 'context_memory',
    description:
      'Saves current session ground truth and invariants into a named checkpoint for cross-harness recall.',
  },
  load_context_snapshot: {
    category: 'context_memory',
    description:
      'Loads a named context checkpoint and returns its rich prompt injection block for immediate ground truth recall.',
  },
  vscode_execute_command: {
    category: 'ide_extension_bridge',
    description: 'Relays command execution to registered VS Code host extension with approval.',
  },
  vscode_list_diagnostics: {
    category: 'ide_extension_bridge',
    description: 'Relays diagnostics query to registered VS Code host extension.',
  },
};

const CATEGORY_NAMES: Record<ToolCategory, string> = {
  hardware_validation: 'Hardware & Embedded',
  context_memory: 'Context Memory',
  ide_extension_bridge: 'VS Code Extension Bridge',
  external_servers: 'External MCP Servers',
};

export const createDefaultMissionControl: MissionControlFactory = (
  client: DaemonClient,
): MissionControlSource => ({
  async inspect(projectId: string) {
    const [metricsRes, streamRes, compressedRes] = await Promise.allSettled([
      client.getCompressionMetrics(projectId),
      client.listClassifierStream(projectId, 50),
      client.getCompressedContext(projectId, 'deterministic_delta'),
    ]);

    const metrics = metricsRes.status === 'fulfilled' ? metricsRes.value : undefined;
    const stream = streamRes.status === 'fulfilled' ? streamRes.value : undefined;
    const compressed = compressedRes.status === 'fulfilled' ? compressedRes.value : undefined;

    const classifications = stream
      ? stream.items.map((item) => ({
          id: item.id,
          timestamp: item.timestamp,
          source: `${item.sourceType}:${item.sourceActor}`,
          score: item.signalScore,
          category: item.category,
          preserve: item.decision === 'preserve',
          fact: item.distilledFact ?? '',
        }))
      : [];

    if (!metrics && !compressed && classifications.length === 0) {
      return undefined;
    }

    const rawTokens = metrics?.totalRawTokens ?? compressed?.rawTokensEstimate ?? 0;
    const injectedTokens =
      metrics?.totalCompressedTokens ?? compressed?.compressedTokensEstimate ?? 0;
    const preserved =
      metrics?.preservedFactsCount ?? classifications.filter((c) => c.preserve).length;
    const pruned = metrics?.prunedNoiseCount ?? classifications.filter((c) => !c.preserve).length;
    const injectedBlock = compressed?.injectedBlock ?? '';

    return {
      rawTokens,
      injectedTokens,
      preserved,
      pruned,
      classifications,
      injectedBlock,
    };
  },

  async tools(projectId: string) {
    const catList = await client.getToolCategories(projectId);
    const activeCats = new Set(catList.categories.filter((c) => c.enabled).map((c) => c.category));

    const activeTools: { id: string; name: string; description: string; category: string }[] =
      Object.entries(TOOL_METADATA)
        .filter(([, meta]) => activeCats.has(meta.category))
        .map(([name, meta]) => ({
          id: name,
          name,
          description: meta.description,
          category: meta.category,
        }));

    try {
      const integrations = await client.listIntegrations();
      if (activeCats.has('external_servers')) {
        for (const item of integrations.items) {
          if (item.type === 'discovered_tool' && item.enabled) {
            for (const toolName of item.availableTools) {
              activeTools.push({
                id: `${item.name}__${toolName}`,
                name: `${item.name}__${toolName}`,
                description: item.description || `Discovered MCP tool from ${item.name}`,
                category: 'external_servers',
              });
            }
          }
        }
      }
    } catch {
      // If external integrations fail or are disabled, core tools remain visible.
    }

    const categories = catList.categories.map((c) => ({
      id: c.category,
      name: CATEGORY_NAMES[c.category] ?? c.name,
      description: c.description,
      enabled: c.enabled,
      toolCount: activeTools.filter((t) => t.category === c.category).length || c.toolCount,
    }));

    return {
      categories,
      activeTools,
      visibilityLabel: `Active Gateway Tool Scope (${activeTools.length} confirmed tools)`,
    };
  },

  async toggle(projectId: string, category: string, enabled: boolean) {
    await client.toggleToolCategory({
      projectId,
      category: category as ToolCategory,
      enabled,
    });
  },
});
