# Hackathon Demo Runbook — 5-Minute Live Demonstration

**Universal Developer Intelligence Platform** · PS-01: Beyond the App · Hackathon Coding Freeze: 8:30 AM IST

---

## 1. Quick Proof (One-Command Verification)

Before running the live presentation, execute the automated end-to-end verification suites to ensure zero regressions:

```bash
# Verify engineering validation, revalidation, restart persistence, and stdio MCP
pnpm demo:verify

# Verify live stdio MCP gateway protocol calls with second agent
pnpm test:mcp
```

Both commands run on clean ephemeral ports, execute real deterministic algorithms on the rover fixture, verify tool results, and leave the working directory untouched.

---

## 2. Five-Minute Live Demo Script & Timing

| Elapsed       | Stage                        | Visual Action                                                                     | Speaker Narrative                                                                                                                                                                                                                                                                                                                    |
| :------------ | :--------------------------- | :-------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0:00–0:45** | **Platform Bootstrap**       | Launch daemon; query `GET /api/v1/health` in browser or curl                      | _"We built a local-first intelligence layer extending VS Code. Notice all four capabilities—projects, context, MCP gateway, and engineering core—are live."_                                                                                                                                                                         |
| **0:45–1:45** | **Engineering Mismatch**     | In VS Code, run `Validate Engineering Project` on `examples/rover`                | _"Our deterministic validator parses the KiCad schematic netlist and C++ firmware header. It detects that MOTOR_EN is connected to GPIO14 on the schematic, but the firmware defines GPIO26. Notice the dual-source evidence directly on line 7."_                                                                                   |
| **1:45–2:45** | **Safe Correction**          | Open Finding Dialog → Click **Preview Fix** → Review Diff → Click **Apply Fix**   | _"Rather than risky manual edits, the system provides a safe two-stage repair. Preview inspects the file, locks a SHA-256 hash, and generates a unified diff with zero disk writes. With explicit approval, it creates a .bak snapshot, patches line 7 to GPIO14, and immediately reruns revalidation—yielding zero active errors."_ |
| **2:45–3:45** | **Cross-Agent MCP Transfer** | In OpenCode / terminal, run MCP client or `node packages/mcp-gateway/dist/cli.js` | _"Now a second agent—like OpenCode or Claude CLI—connects to our official MCP v2 gateway over stdio. It calls `get_project_context` and instantly receives the verified facts, the original failed diagnosis, the fix applied, and lead decisions."_                                                                                 |
| **3:45–4:30** | **Second Agent Decision**    | Second Agent calls `record_decision` via MCP                                      | _"The second agent records a follow-up decision into the shared SQLite store. Re-fetching context proves the decision is stored with strict `agent_summary` provenance, visible across both VS Code and Desktop."_                                                                                                                   |
| **4:30–5:00** | **Architecture & Security**  | Show `PlatformRepositories` & Security Boundaries                                 | _"No cloud sync, no plaintext credentials, no arbitrary shell execution. Everything is local-first, offline-capable, and bound to the project workspace."_                                                                                                                                                                           |

---

## 3. Terminal Setup & Launch Commands

### Terminal 1: Core Daemon

```bash
export UDI_PORT=4317
export UDI_INTEGRATIONS=true
pnpm dev:core
```

_Health endpoint: `http://127.0.0.1:4317/api/v1/health`_  
_Token location: `.data/token` (mode 0600)_

### Terminal 2: Desktop Control Center (React Dashboard)

```bash
pnpm dev:desktop
```

_Opens `http://127.0.0.1:5173` in your browser._

### Terminal 3: VS Code Extension Host

```bash
pnpm dev:extension
```

_Press `F5` in the root workspace to launch the Extension Development Host window opening `examples/rover`._

### Terminal 4: Second Agent / MCP Gateway Test

```bash
# Run standalone MCP stdio gateway
node packages/mcp-gateway/dist/cli.js
```

---

## 4. Expected Results & Verification Signatures

1. **Validation Diagnostic**:
   - `ruleId`: `pin_consistency`
   - `severity`: `error`
   - `message`: `Signal MOTOR_EN pin mismatch: netlist specifies GPIO14 but firmware configures GPIO26`
   - `evidence`: `rover.net:28` and `src/pins.h:7`
2. **Preview Output**:
   ```diff
   --- a/src/pins.h
   +++ b/src/pins.h
   @@ -7,1 +7,1 @@
   - #define MOTOR_EN GPIO26
   + #define MOTOR_EN GPIO14
   ```
3. **Post-Apply State**:
   - `src/pins.h.bak`: Preserved with original `#define MOTOR_EN GPIO26`
   - `src/pins.h`: Updated to `#define MOTOR_EN GPIO14`
   - Revalidation Job: `status: "succeeded"`, `exitCode: 0`, `revalidationFindings: []`
   - Context Memory: Includes `observed_tool` record confirming fix and revalidation pass.

---

## 5. Recovery Instructions for Common Runtime Failures

| Issue                                     | Cause                                                    | Recovery Command / Action                                                                        |
| :---------------------------------------- | :------------------------------------------------------- | :----------------------------------------------------------------------------------------------- |
| **Port 4317 already in use**              | A previous daemon instance was not terminated            | Run `fuser -k 4317/tcp` or start daemon with `export UDI_PORT=4318`                              |
| **Missing / Invalid Token (401)**         | Token in client does not match `.data/token`             | Read token via `cat .data/token` and paste into client or export `UDI_TOKEN=$(cat .data/token)`  |
| **HTTP 409 Stale Preview Conflict**       | The target file was modified after preview was generated | Re-trigger `previewCorrection` to recalculate the fresh SHA-256 hash, then apply                 |
| **Accidental Overwrite of Rover Fixture** | File modified during manual testing                      | Run `git checkout -- examples/rover/src/pins.h` to restore canonical demo fixture                |
| **Rollback Needed**                       | User wants to restore initial mismatch                   | Run `client.rollbackCorrection(...)` via SDK or copy `cp src/pins.h.bak src/pins.h`              |
| **Orphaned Node processes**               | Background processes lingering                           | Run `pkill -f 'packages/mcp-gateway/dist/cli.js'`                                                |
| **OpenCode cannot find MCP server**       | Path in `opencode.json` is relative                      | Ensure `command` in `opencode.json` contains absolute path to `packages/mcp-gateway/dist/cli.js` |
