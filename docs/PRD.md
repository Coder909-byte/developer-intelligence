# Universal Developer Intelligence Platform — Product Requirements Document

**Version:** 1.0 · **Date:** 3 November 2026 · **Competition:** UPSIDE DOWN.EXE · **Statement:** PS-01 Beyond the App

**Status:** Team-approved build baseline (product name is a placeholder)

## 1. Executive summary

Build a **local-first interoperability and engineering-intelligence layer** that extends VS Code and connects supported coding agents, MCP tools, and electronics-development workflows through one shared project state. A desktop control center configures connections and displays project health; the **VS Code extension is the primary host-app enhancement**. A local daemon is the single authority for projects, tools, handoffs, permissions, events and validation results.

**Value proposition:** configure compatible developer tools once; retain **verified project context** across supported agents; detect inconsistencies between engineering artifacts and firmware without switching applications.

**Target users:** developers working across multiple agents/IDEs; electronics/embedded students and teams using VS Code + PlatformIO + KiCad; students writing Verilog and running testbenches.

## 2. Hackathon alignment

Official PS-01: _Improve an existing application with a capability it lacked; demonstrate that the enhancement works inside/on top of that app._ Our host is VS Code; the extension provides native contextual diagnostics, MCP actions, and agent handoffs. Desktop UI is an optional control center, not the core submission. No account system, billing, or generic marketing pages.

**Primary demo claim:** A real discrepancy between an engineering netlist and firmware mapping appears as an actionable VS Code diagnostic; approved change is validated; a second supported agent obtains the recorded context via an MCP tool.

## 3. Jobs-to-be-done

1. **When** I move from one coding agent to another, **I want** reliable, compact handoff context so I can continue without repeating discovery.
2. **When** I add an MCP server, **I want** one place to inspect it, test it, and generate host-compatible configuration, so setup is less repetitive.
3. **When** my circuit and firmware disagree, **I want** precise, traceable diagnostics inside VS Code, so I can prevent integration mistakes.
4. **When** I run firmware/RTL tools, **I want** validation outputs linked to the project memory, so later agents understand what actually passed.
5. **When** I plug in supported hardware, **I want** an opt-in serial monitor and reproducible diagnostic snapshots.

## 4. Product scope

### P0 — must work end-to-end

- VS Code extension: command palette commands, project status view, diagnostics, 'Validate engineering project', 'Save handoff', 'Get context', 'Open desktop dashboard'.
- Local engine: loopback API, SQLite event store, projects, context/handoff, jobs, validation results, MCP registry.
- MCP server (stdio): `get_project_context`, `list_project_events`, `get_validation_results`, `record_decision`, `list_available_tools` with explicit project scoping.
- TWO concrete agent/host paths: VS Code extension + a second MCP-capable agent configured to call our MCP server (e.g. OpenCode, after testing); do **not** claim automatic proprietary chat capture.
- Electronics: KiCad-exported netlist or pinned normalized fixture, firmware pin-map format, deterministic GPIO mismatch detection with source evidence; real PlatformIO build command when environment supports it.
- Desktop UI: active project, connections/MCP registry, activity timeline, validation and handoff detail; use same engine API as extension.
- User-controlled write operations and strong demo fixtures; never silently edit electronics artifacts.

### P1 — build after P0 passes

- KiCad CLI export from supported project, with fallback to pre-exported real netlist.
- Config export to a second host adapter with dry-run diff and confirmation.
- Verilog/Icarus compilation and testbench results, diagnostics attached to context.
- Real ESP32 serial telemetry viewer if actual board and suitable interface available.
- Recent-file change ingestion (file watcher), approval-based handoff creation.

### P2 — future vision (NOT demo commitments)

- Broad plugin ecosystem and automatic compatibility discovery; commercial VLSI tool integration; universal agent session ingestion; many IDE-specific native extensions; advanced device fleet management; remote sync and accounts.

### Explicit non-goals

- Building a new IDE or agent/LLM; rewriting all host MCP configs on install; auto-reading private model reasoning; autonomous production deployments; making claims of electrical safety; claiming that every MCP/IDE/plugin works; exposing unrestricted local shell control remotely.

## 5. User journeys

**Onboarding:** install VS Code extension → extension discovers/runs local service → open dashboard → register workspace → inspect detected adapters → approve allowed MCP configurations → run health check.

**Primary engineering demo:** open `examples/rover` → select `Run Engineering Validation` → intentional GPIO mismatch appears with netlist + firmware file references → user views evidence → selects `Propose fix` → checks diff and approves → validator reruns → PlatformIO build (real or clearly marked unavailable) → event and result stored.

**Cross-agent demo:** user saves scoped handoff → switch to a _tested_ second host → call `get_project_context(projectId)` via our MCP server → retrieve decisions/results → continue a new task using those facts.

**MCP management:** register/configure server → inspect tools → test health → generate host config dry-run → approve file change → use through supported host.

**IoT/RTL optional:** select serial port with consent → view telemetry and save snapshot; select RTL testbench → run Icarus → display actual test results.

## 6. Functional requirements and acceptance criteria

| ID    | Requirement                                                | Observable acceptance                                                                            |
| ----- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| FR-01 | VS Code extension operates as first-class host integration | Commands run in actual VS Code; diagnostics appear on relevant source file                       |
| FR-02 | Single project context store                               | Restart daemon; events/handoffs survive; correct project returned                                |
| FR-03 | Two-agent compatibility                                    | Second host calls real MCP tool, gets same project state as VS Code                              |
| FR-04 | Context provenance                                         | Every fact indicates source: observed result / user decision / AI summary                        |
| FR-05 | MCP inventory                                              | User can list and health-check registered servers; failed checks show reason                     |
| FR-06 | Engineering comparison                                     | Known mismatched GPIO is caught; corrected GPIO passes; file/line evidence shown where available |
| FR-07 | Safe patch review                                          | No file rewrite without explicit approval and preview; backup/rollback recorded                  |
| FR-08 | Validation traceability                                    | Actual tool exit code/output and timestamps retained; simulated results visibly labeled          |
| FR-09 | Desktop control center                                     | Desktop and VS Code show same project status from the same engine                                |
| FR-10 | Offline local operation                                    | Core context and netlist comparison work without internet                                        |
| FR-11 | Tool security                                              | Only allowlisted commands/workspaces; restrict host-bound config writes                          |
| FR-12 | P1 integrations fail gracefully                            | Missing KiCad/PlatformIO/serial tool shows unavailable, never fake pass                          |

## 7. Success metrics

**Hard gate:** 1 real VS Code extension command; 1 real deterministic mismatch; 1 repeatable correction/validation; 1 real MCP context retrieval from second host; persisted context after restart. **Goal:** demo from blank opening to conclusion in <5 minutes, with no undocumented manual state edits. **Quality:** zero fabricated test passes; no credentials in logs; all critical integration tests green.

## 8. Priorities and tradeoffs

- User value over platform breadth; native VS Code experience over attractive standalone-only UI.
- Deterministic validation over LLM guesswork; real output over animations.
- Broad design is permitted but P0 is intentionally narrow to create a real integrated system.
- A missing proprietary host API means support via manual handoff or MCP interface, **not** invasive session scraping.

## 9. Four-person ownership

- **Owner A — Core/Integrator:** packages/contracts, daemon, SQLite, HTTP, integration, release/demo pipeline.
- **Owner B — Host UI:** VS Code extension, desktop control center, status/diagnostics UX.
- **Owner C — Tool Interop:** MCP server, registry, second-host config adapter, handoff interface.
- **Owner D — Engineering:** KiCad/netlist + firmware parsing, consistency checks, PlatformIO, RTL/serial as stretch.
  All owners contribute tests within their scope. A owns shared contract changes after team sign-off.

## 10. Main risks and mitigations

- **Cross-agent private session limitations:** only claim explicitly shared/importable context; demonstrate via our MCP server.
- **Proprietary KiCad/VLSI APIs:** use available file formats + CLI/open tools; do not depend on licensed tools.
- **Schema mismatch between parallel branches:** freeze `packages/contracts` and generate types; CI tests required before merging.
- **Desktop packaging friction:** browser-served local dashboard is valid fallback; do not lose VS Code integration.
- **MCP/host config incompatibility:** support explicit versioned adapters with dry-run and health tests.
- **Safety:** electrical consistency checks are not proof of safe power wiring or hardware operation.

## 11. Demo script and competition constraints

0:00–0:30 demonstrate limitation; 0:30–1:00 VS Code extension and MCP hub; 1:00–2:10 detect mismatch; 2:10–3:05 show proposed diff and validation; 3:05–4:05 retrieve project memory in second host; 4:05–5:00 explain architecture and impact. Keep a prerecorded demo as **backup only**, clearly labeled if used.

Hackathon coding freeze **4 Nov 2026, 08:30 IST**; submission deadline **08:45 IST**. Freeze working demo earlier for testing. Verify any additional round times with organizers.

## 12. Official references

- PS-01 https://upsidedowntss.vercel.app/#problems
- MCP TypeScript SDK v2 https://ts.sdk.modelcontextprotocol.io/v2/
- VS Code webview guidance https://code.visualstudio.com/api/ux-guidelines/webviews
