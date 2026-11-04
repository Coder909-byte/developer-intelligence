import { randomUUID } from 'node:crypto';
import type { PlatformRepositories } from '@udi/event-store';
import type { AgentHandoff, ActivityEvent, LayaClassificationResult, CompressionMetrics } from '@udi/contracts';

export async function seedDemoSession(
  store: PlatformRepositories,
  projectId: string,
  projectName = 'Rover Autonomous Unit',
): Promise<{ handoffsCount: number; eventsCount: number; classificationsCount: number }> {
  const now = Date.now();
  const iso = (offsetMs = 0) => new Date(now - offsetMs).toISOString();

  // 1. Seed Bookshelf Handoffs / Game Save Slots (if fewer than 4)
  const existingHandoffs = await store.handoffs.list(projectId, { limit: 10, offset: 0 });
  let handoffsCount = existingHandoffs.length;

  if (existingHandoffs.length < 4) {
    const slots = [
      {
        summary: 'Slot 1: Netlist Invariant & Initial GPIO Drift Diagnosis',
        fromAgentId: randomUUID(),
        recordIds: [randomUUID()],
        nextSteps: [
          'Examine schematic netlist rover.net line 28 for IO14 mapping',
          'Preview safe surgical patch on src/pins.h without modifying source',
          'Verify checksum hash lock against concurrent drift',
        ],
        provenance: { sourceKind: 'observed_tool' as const, actor: 'codex-agent-session-1' },
      },
      {
        summary: 'Slot 2: Two-Stage Safe Patch & Revalidation Pass',
        fromAgentId: randomUUID(),
        recordIds: [randomUUID()],
        nextSteps: [
          'Confirm backup snapshot src/pins.h.bak created',
          'Synchronize verified pin invariants into persistent SQLite',
          'Expose verified status to downstream AI agent harnesses',
        ],
        provenance: { sourceKind: 'observed_tool' as const, actor: 'codex-agent-session-2' },
      },
      {
        summary: 'Slot 3: Cross-Agent Sync & Multi-Harness Handoff',
        fromAgentId: randomUUID(),
        recordIds: [randomUUID()],
        nextSteps: [
          'Route terminal agents through OpenAI proxy :4317/v1',
          'Verify zero-token re-discovery on project resume',
          'Audit Laya signal classifier for noise-pruning ratio',
        ],
        provenance: { sourceKind: 'agent_summary' as const, actor: 'lead-architect' },
      },
      {
        summary: 'Slot 4: Production Rover Invariants & Autonomous Loop',
        fromAgentId: randomUUID(),
        recordIds: [randomUUID()],
        nextSteps: [
          'Deploy release firmware build to ESP32 test fixture',
          'Run automated regression suite via PlatformIO bridge',
          'Archive session context into permanent project vault',
        ],
        provenance: { sourceKind: 'user_entered' as const, actor: 'fev' },
      },
    ];

    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i]!;
      const createdAt = iso((4 - i) * 3600000);
      const handoff: AgentHandoff = {
        id: randomUUID(),
        createdAt,
        updatedAt: createdAt,
        projectId,
        fromAgentId: slot.fromAgentId,
        summary: slot.summary,
        recordIds: slot.recordIds,
        nextSteps: slot.nextSteps,
        provenance: slot.provenance,
      };
      await store.handoffs.append(handoff);
      handoffsCount++;
    }
  }

  // Always append a fresh latest session book timestamped right now
  const latestSlotNum = handoffsCount + 1;
  const recentCreatedAt = iso(0);
  const latestBook: AgentHandoff = {
    id: randomUUID(),
    createdAt: recentCreatedAt,
    updatedAt: recentCreatedAt,
    projectId,
    fromAgentId: randomUUID(),
    summary: `Slot ${latestSlotNum}: Live Codex Session · Verified GPIO14 Active`,
    recordIds: [randomUUID()],
    nextSteps: [
      'Autonomous rover navigation loop active with verified GPIO14',
      'Telemetry stream listening on stdio MCP gateway bridge',
      'Continuous Laya compression pipeline active (97.6% savings)',
    ],
    provenance: { sourceKind: 'observed_tool' as const, actor: 'codex-agent-live' },
  };
  await store.handoffs.append(latestBook);
  handoffsCount++;

  // 2. Append Realistic Codex Activity Events (Tool Calls, Responses, Decisions)
  const events: ActivityEvent[] = [
    {
      id: randomUUID(),
      projectId,
      type: 'codex.session.started',
      actor: 'codex-agent',
      sourceKind: 'agent_summary',
      createdAt: iso(1800000),
      schemaVersion: 1,
      payload: {
        harness: 'codex-vscode',
        workspace: projectName,
        target: 'Autonomous Rover Firmware',
      },
    },
    {
      id: randomUUID(),
      projectId,
      type: 'tool.call.executed',
      actor: 'codex-agent',
      sourceKind: 'observed_tool',
      createdAt: iso(1500000),
      schemaVersion: 1,
      payload: {
        toolName: 'pin_validator',
        artifacts: ['rover.net', 'src/pins.h'],
        rule: 'pin_consistency',
      },
    },
    {
      id: randomUUID(),
      projectId,
      type: 'tool.response.received',
      actor: 'engineering-core',
      sourceKind: 'observed_tool',
      createdAt: iso(1490000),
      schemaVersion: 1,
      payload: {
        toolName: 'pin_validator',
        exitCode: 1,
        status: 'failed',
        finding: 'Signal MOTOR_EN pin mismatch: netlist specifies GPIO14 but firmware configures GPIO26',
        evidence: 'rover.net:28 -> IO14 vs src/pins.h:7 -> GPIO26',
      },
    },
    {
      id: randomUUID(),
      projectId,
      type: 'decision.recorded',
      actor: 'lead-architect',
      sourceKind: 'user_entered',
      createdAt: iso(1200000),
      schemaVersion: 1,
      payload: {
        decision: 'Hardware invariant locked: KiCad schematic netlist rev B is authoritative; patch firmware src/pins.h line 7 to GPIO14',
      },
    },
    {
      id: randomUUID(),
      projectId,
      type: 'engineering.correction.applied',
      actor: 'safe-correction-engine',
      sourceKind: 'observed_tool',
      createdAt: iso(900000),
      schemaVersion: 1,
      payload: {
        targetFile: 'src/pins.h',
        backupFile: 'src/pins.h.bak',
        revalidationStatus: 'succeeded',
        activeFindings: 0,
      },
    },
    {
      id: randomUUID(),
      projectId,
      type: 'mcp.tool.executed',
      actor: 'claude-cli-agent',
      sourceKind: 'observed_tool',
      createdAt: iso(600000),
      schemaVersion: 1,
      payload: {
        mcpServer: 'developer-intelligence-gateway',
        tool: 'get_project_context',
        transport: 'stdio',
        outcome: 'succeeded',
        recalledFacts: 4,
      },
    },
    {
      id: randomUUID(),
      projectId,
      type: 'mcp.tool.executed',
      actor: 'claude-cli-agent',
      sourceKind: 'observed_tool',
      createdAt: iso(300000),
      schemaVersion: 1,
      payload: {
        mcpServer: 'developer-intelligence-gateway',
        tool: 'save_context_snapshot',
        snapshotName: 'rover-gpio14-stable',
        status: 'saved',
      },
    },
  ];

  for (const ev of events) {
    await store.events.append(ev);
  }

  // 3. Append Laya Semantic Classifications (Signal vs Noise)
  const classifications: LayaClassificationResult[] = [
    {
      id: randomUUID(),
      projectId,
      timestamp: iso(1500000),
      rawLengthChars: 182,
      signalScore: 0.99,
      category: 'HARDWARE_SPEC',
      decision: 'preserve',
      distilledFact: 'Schematic netlist specifies MOTOR_EN on GPIO14 (NodeMCU U2 pin 12 per rover.net:28)',
      sourceActor: 'engineering-core',
      sourceType: 'tool_output',
    },
    {
      id: randomUUID(),
      projectId,
      timestamp: iso(1200000),
      rawLengthChars: 145,
      signalScore: 0.96,
      category: 'ARCHITECTURAL_DECISION',
      decision: 'preserve',
      distilledFact: 'Architecture invariant: KiCad rover.net netlist is the authoritative hardware reference',
      sourceActor: 'lead-architect',
      sourceType: 'user_message',
    },
    {
      id: randomUUID(),
      projectId,
      timestamp: iso(900000),
      rawLengthChars: 198,
      signalScore: 0.93,
      category: 'VALIDATED_OUTCOME',
      decision: 'preserve',
      distilledFact: 'Safe correction applied to src/pins.h: line 7 patched to GPIO14; revalidation succeeded (0 findings)',
      sourceActor: 'safe-correction-engine',
      sourceType: 'tool_output',
    },
    {
      id: randomUUID(),
      projectId,
      timestamp: iso(800000),
      rawLengthChars: 1650,
      signalScore: 0.05,
      category: 'EPHEMERAL_NOISE',
      decision: 'discard',
      sourceActor: 'pnpm-package-manager',
      sourceType: 'tool_output',
    },
    {
      id: randomUUID(),
      projectId,
      timestamp: iso(700000),
      rawLengthChars: 890,
      signalScore: 0.11,
      category: 'EPHEMERAL_NOISE',
      decision: 'discard',
      sourceActor: 'gcc-compiler',
      sourceType: 'tool_output',
    },
    {
      id: randomUUID(),
      projectId,
      timestamp: iso(500000),
      rawLengthChars: 2400,
      signalScore: 0.03,
      category: 'EPHEMERAL_NOISE',
      decision: 'discard',
      sourceActor: 'terminal-progress-bar',
      sourceType: 'tool_output',
    },
  ];

  for (const item of classifications) {
    await store.classification.record(item);
  }

  // 4. Update Compression Metrics (97.6% Savings showcase)
  const metrics: CompressionMetrics = {
    projectId,
    totalRawTokens: 14250,
    totalCompressedTokens: 340,
    compressionRatio: 0.976,
    preservedFactsCount: 8,
    prunedNoiseCount: 142,
    lastInjectedAt: iso(0),
  };
  await store.metrics.record(metrics);

  return {
    handoffsCount,
    eventsCount: events.length,
    classificationsCount: classifications.length,
  };
}
