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
      const recordId = slot.recordIds[0] ?? randomUUID();
      await store.context.append({
        id: recordId,
        projectId,
        kind: 'decision',
        text: `[SLOT CHECKPOINT: ${slot.summary}] Verified hardware invariants locked. Next: ${slot.nextSteps[0]}`,
        provenance: slot.provenance,
        evidence: [{ filePath: 'rover.net', line: 28 }],
        createdAt,
        updatedAt: createdAt,
      }).catch(() => {});

      const handoff: AgentHandoff = {
        id: randomUUID(),
        createdAt,
        updatedAt: createdAt,
        projectId,
        fromAgentId: slot.fromAgentId,
        summary: slot.summary,
        recordIds: [recordId],
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
  const latestRecordId = randomUUID();
  await store.context.append({
    id: latestRecordId,
    projectId,
    kind: 'decision',
    text: `[ACTIVE SLOT ${latestSlotNum}] Live Codex session trace recorded. Autonomous loop active, GPIO14 verified, MitM proxy streaming.`,
    provenance: { sourceKind: 'observed_tool', actor: 'codex-agent-live' },
    evidence: [{ filePath: 'src/pins.h', line: 7 }],
    createdAt: recentCreatedAt,
    updatedAt: recentCreatedAt,
  }).catch(() => {});

  const latestBook: AgentHandoff = {
    id: randomUUID(),
    createdAt: recentCreatedAt,
    updatedAt: recentCreatedAt,
    projectId,
    fromAgentId: randomUUID(),
    summary: `Slot ${latestSlotNum}: Live Codex Session · Verified GPIO14 Active`,
    recordIds: [latestRecordId],
    nextSteps: [
      'Autonomous rover navigation loop active with verified GPIO14',
      'Telemetry stream listening on stdio MCP gateway bridge',
      'Continuous Laya compression pipeline active (97.6% savings)',
    ],
    provenance: { sourceKind: 'observed_tool' as const, actor: 'codex-agent-live' },
  };
  await store.handoffs.append(latestBook);
  handoffsCount++;

  // Also seed Hermes sessions so the library shelves are fully stacked with rich sessions
  if (handoffsCount < 10) {
    try {
      const hermesRes = await seedHermesSessions(store, projectId, projectName);
      handoffsCount += hermesRes.addedHandoffs;
    } catch {
      // Non-blocking
    }
  }

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

export async function seedHermesSessions(
  store: PlatformRepositories,
  projectId: string,
  projectName = 'Rover Autonomous Unit',
): Promise<{ addedHandoffs: number; totalHandoffs: number; hermesSessionsLoaded: number }> {
  let rows: Array<{ id: string; title: string | null; started_at: number; message_count: number }> = [];

  try {
    const { DatabaseSync } = await import('node:sqlite');
    const { homedir } = await import('node:os');
    const { join } = await import('node:path');
    const { existsSync } = await import('node:fs');

    const dbPath = join(homedir(), '.hermes', 'state.db');
    if (existsSync(dbPath)) {
      const db = new DatabaseSync(dbPath, { readOnly: true });
      rows = db
        .prepare(
          'SELECT id, title, started_at, message_count FROM sessions WHERE title IS NOT NULL ORDER BY started_at DESC LIMIT 20',
        )
        .all() as typeof rows;
    }
  } catch {
    // Fall back to curated list if ~/.hermes/state.db is inaccessible
  }

  if (rows.length === 0) {
    const nowSec = Math.floor(Date.now() / 1000);
    rows = [
      { id: '20261104_033601_cb83f643', title: 'Universal Developer Intelligence Platform demo prep', started_at: nowSec - 3600, message_count: 893 },
      { id: '20261104_015912_21caf7', title: 'What is the motor pin on the rover? Invariant verification', started_at: nowSec - 7200, message_count: 38 },
      { id: '20261103_233115_807b4740', title: 'Review developer intelligence platform specs & round 2 architecture', started_at: nowSec - 14400, message_count: 1079 },
      { id: '20261103_200734_cb37c39c', title: 'Developer Intelligence Platform engineering integration & KiCad parser', started_at: nowSec - 28800, message_count: 1279 },
      { id: '20261103_183018_e1e7b7', title: 'Link Codex with Omniroute proxy & local model endpoints', started_at: nowSec - 36000, message_count: 42 },
      { id: '20261103_170634_8f96d670', title: 'Start SSH server via fev06.xyz & remote tunnel configuration', started_at: nowSec - 43200, message_count: 221 },
      { id: '20261103_001233_0d97b8', title: 'Build Telegram hackathon scraper bot & opportunity pipeline', started_at: nowSec - 86400, message_count: 167 },
      { id: '20261102_033020_25690c', title: 'Explore fev-portfolio repository & 3D HUD canvas styling', started_at: nowSec - 100000, message_count: 446 },
      { id: '20261101_202051_e6ea1b', title: 'Fix grayed out video wallpaper in Niri & gslapper pipeline', started_at: nowSec - 120000, message_count: 198 },
      { id: '20261101_151413_3d3c73', title: 'Analyze ryoku v1.0.0 amataresu desktop changes & Wayland compositor', started_at: nowSec - 150000, message_count: 86 },
      { id: 'cron_41043ec09ee5_20261103', title: 'Daily Evening Progress Voice Briefing & agent sync', started_at: nowSec - 200000, message_count: 26 },
      { id: '20261104_022329_0682633f', title: 'P2P GPU sharing projects & decentralized compute cluster', started_at: nowSec - 250000, message_count: 14 },
    ];
  }

  let addedHandoffs = 0;
  for (const session of rows) {
    const createdAt = new Date((session.started_at || Date.now() / 1000) * 1000).toISOString();
    const recordId = randomUUID();
    const title = session.title || 'Untitled Session';

    // Persist a ground truth record for this session so clicking the book displays its rich memory
    await store.context.append({
      id: recordId,
      projectId,
      kind: 'decision',
      text: `[HERMES SESSION RECALL: ${title}] Session ID: ${session.id} · ${session.message_count} messages. Preserved verified ground truth context for cross-agent recall.`,
      provenance: { sourceKind: 'observed_tool', actor: 'hermes-agent' },
      evidence: [{ filePath: `~/.hermes/sessions/${session.id}.json`, line: 1 }],
      createdAt,
      updatedAt: createdAt,
    }).catch(() => {});

    const handoff: AgentHandoff = {
      id: randomUUID(),
      createdAt,
      updatedAt: createdAt,
      projectId,
      fromAgentId: session.id,
      summary: `Hermes · ${title}`,
      recordIds: [recordId],
      nextSteps: [
        `Recall past conversation context from Hermes: @session:default/${session.id}`,
        `Archived activity: ${session.message_count} messages across tool turns`,
        `Cross-agent bridge: verified project state retained in SQLite`,
      ],
      provenance: { sourceKind: 'observed_tool', actor: 'hermes-agent' },
    };

    await store.handoffs.append(handoff);
    addedHandoffs++;
  }

  const existing = await store.handoffs.list(projectId, { limit: 100, offset: 0 });

  return {
    addedHandoffs,
    totalHandoffs: existing.length,
    hermesSessionsLoaded: rows.length,
  };
}
