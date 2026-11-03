import { describe, expect, it, vi } from 'vitest';
import type { DaemonClient } from '@udi/client-sdk';
import { createDefaultMissionControl } from './mission-control.js';

describe('createDefaultMissionControl', () => {
  const projectId = 'b4358696-0aec-475f-ae7c-cd1ab4770edf';

  it('inspects project compression metrics, classifier stream, and injected block', async () => {
    const mockClient = {
      getCompressionMetrics: vi.fn().mockResolvedValue({
        projectId,
        totalRawTokens: 14250,
        totalCompressedTokens: 340,
        compressionRatio: 0.976,
        preservedFactsCount: 8,
        prunedNoiseCount: 142,
      }),
      listClassifierStream: vi.fn().mockResolvedValue({
        items: [
          {
            id: 'class-1',
            projectId,
            timestamp: '2026-11-04T00:00:00Z',
            rawLengthChars: 120,
            signalScore: 0.95,
            category: 'HARDWARE_SPEC',
            decision: 'preserve',
            distilledFact: 'MOTOR_EN = GPIO14',
            sourceActor: 'engineering-core',
            sourceType: 'tool_output',
          },
        ],
      }),
      getCompressedContext: vi.fn().mockResolvedValue({
        projectId,
        mode: 'deterministic_delta',
        rawTokensEstimate: 14250,
        compressedTokensEstimate: 340,
        savingsPercent: 97.6,
        injectedBlock: '# Injected context\nMOTOR_EN=GPIO14',
        activeInvariants: ['MOTOR_EN=GPIO14'],
        openIssuesCount: 0,
        generatedAt: '2026-11-04T00:00:00Z',
      }),
    } as unknown as DaemonClient;

    const source = createDefaultMissionControl(mockClient);
    const inspection = await source.inspect(projectId);

    expect(inspection).toBeDefined();
    expect(inspection?.rawTokens).toBe(14250);
    expect(inspection?.injectedTokens).toBe(340);
    expect(inspection?.preserved).toBe(8);
    expect(inspection?.pruned).toBe(142);
    expect(inspection?.injectedBlock).toBe('# Injected context\nMOTOR_EN=GPIO14');
    expect(inspection?.classifications).toHaveLength(1);
    expect(inspection?.classifications[0]?.preserve).toBe(true);
    expect(inspection?.classifications[0]?.fact).toBe('MOTOR_EN = GPIO14');
  });

  it('fetches categorical tool snapshot and dynamically reflects active tools', async () => {
    const mockClient = {
      getToolCategories: vi.fn().mockResolvedValue({
        projectId,
        categories: [
          {
            category: 'hardware_validation',
            enabled: true,
            name: 'hardware validation',
            description: 'Embedded check tools',
            toolCount: 2,
          },
          {
            category: 'context_memory',
            enabled: false,
            name: 'context memory',
            description: 'Memory tools',
            toolCount: 7,
          },
        ],
      }),
      listIntegrations: vi.fn().mockResolvedValue({ items: [] }),
    } as unknown as DaemonClient;

    const source = createDefaultMissionControl(mockClient);
    const snapshot = await source.tools(projectId);
    expect(snapshot).toBeDefined();
    if (!snapshot) throw new Error('Expected snapshot to be defined');

    expect(snapshot.categories).toHaveLength(2);
    expect(snapshot.categories[0]?.id).toBe('hardware_validation');
    expect(snapshot.categories[0]?.enabled).toBe(true);
    // context_memory tools are excluded from activeTools because enabled=false
    expect(snapshot.activeTools.every((t) => t.category === 'hardware_validation')).toBe(true);
    expect(snapshot.activeTools.some((t) => t.id === 'run_engineering_validation')).toBe(true);
  });

  it('relays category toggle request to client SDK', async () => {
    const toggleToolCategory = vi.fn().mockResolvedValue({
      projectId,
      category: 'hardware_validation',
      enabled: false,
    });
    const mockClient = {
      toggleToolCategory,
    } as unknown as DaemonClient;

    const source = createDefaultMissionControl(mockClient);
    await source.toggle(projectId, 'hardware_validation', false);

    expect(toggleToolCategory).toHaveBeenCalledWith({
      projectId,
      category: 'hardware_validation',
      enabled: false,
    });
  });
});
