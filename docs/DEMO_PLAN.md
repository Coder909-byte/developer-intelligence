# Deterministic end-to-end demo test plan

Current runtime status: the actual Mac Extension Development Host and installed VSIX now pass native mismatch diagnostics, source navigation, corrected-job clearing, context and handoffs. Browser/real MCP CLI retrieve the same project state. See [final runtime](FINAL_RUNTIME.md) for the executed five-minute script, packaging, 147-test gate and exact commands. The original plan below retains earlier pre-merge prerequisites for reference. Safe source correction and commercial-agent conversation are separate, unclaimed gates; the current demo runs the existing corrected fixture. Never substitute synthetic storage records for real validator/MCP evidence.

## Gate 0 — automatic backend proof, executable now

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
node scripts/smoke.mjs
```

The smoke test uses an ephemeral IPv4 loopback port and a temporary data directory. It proves public health; missing/wrong token 401 with no write; authenticated project creation; event/context/handoff storage; inventory registration with unknown status; completed job/finding persistence; scope isolation and cross-project rejection; browser PUT preflight; graceful daemon process restart with the same token and stored IDs; explicit 501 execution boundaries; cleanup. Engineering records here are clearly labeled synthetic persistence fixtures. It does not run an engineering algorithm or MCP host.

## Reproducible product inputs and preconditions

D2 must publish these artifacts and their exact format/path/hash manifest; D1 must approve it before freezing a demo commit:

- A source-attributed exported netlist or honestly labeled normalized fixture with logical signal MOTOR_EN mapped to GPIO14. Include the explicit alias map if the exporter does not preserve firmware symbols.
- Firmware pin map/source with MOTOR_EN mapped to GPIO26, plus a corrected variant mapped to GPIO14. No additional conflicting/missing signals in the minimal P0 fixture.
- Actual project-relative evidence paths and 1-based source positions for both inputs. The source opened in VS Code must contain the observed value. Do not assume line numbers from an illustrative example.
- The rule ID and exact normalizer expectations fixed by D2's validator tests; repeated validation of identical bytes must produce the same semantic findings (new job/finding UUIDs and timestamps are expected).
- An exact runnable MCP gateway command and tested second-host configuration. No guessed script name or claimed agent compatibility. Stdio stdout carries protocol messages only.

Use a dedicated temporary copy of the fixture workspace and a separate fresh UDI_DATA_DIR, never a production project or personal database. D1 launches the daemon with an absolute private data directory and known loopback port; the normal launcher must compose the actual reviewed services. Use pnpm dev:extension and F5 for the real VS Code Extension Host, and pnpm dev:desktop for the browser control center. Configure the same daemon origin/project in both. Enter the generated local token using D3's existing session/SecretStorage flow without recording it in the demo artifacts. Do not put a token in a URL, Vite env or host log.

Resolve all readiness blockers first: validation-jobs and actual MCP invocation must work; D3's handoff/validate commands must be wired; D2 must publish observed context or inject a real context provider. If any is absent, the corresponding product gate is BLOCKED, not PASS.

## Gate 1 — connected host and authenticated workspace

1. Open the mismatched fixture copy in the real VS Code Extension Host; register it through the native command. Capture returned projectId and canonical rootPath.
2. Select that same project in desktop. Verify name/UUID/root agreement. Health alone does not establish authentication; require a successful projects/context read.
3. Forget or replace the token temporarily: actual authenticated data requests must show 401. Restore it and retry; no duplicate project or invented successful state may appear.
4. In a separate empty control workspace/project, verify that no fixture context, handoff or findings appear. If multiple workspaces are open, select explicitly.

Evidence: UI screenshot plus project UUID and sanitized route/status/requestId log, not the token. Owner: D3; persistence support D1.

## Gate 2 — real failed comparison and stored findings

1. Run the native Validate command. The SDK submits kind pin_consistency, explicit fixture artifactPaths and requestedBy through the route projectId. Record the returned jobId and actual completed status; obey the agreed orchestration semantics.
2. D2 runs its real deterministic comparison on the frozen mismatched inputs. Require one semantic mismatch for MOTOR_EN, expected GPIO14, observed GPIO26, error severity, the frozen rule ID and both real evidence references. An unavailable parser/validator is not a mismatch result.
3. Retrieve that job through getJob(projectId, jobId), and listFindings(projectId, {jobId}). Assert every finding projectId/jobId matches, verifiedBy identifies the actual validator/version, and captured output corresponds to the actual run.
4. D2 publishes an observed validation event/context record with sourceRef pointing to this job (or the reviewed context engine derives it from real stored output). Confirm the failed-run context is retrievable before creating a handoff.
5. Refresh VS Code. The native diagnostic appears on the exact in-project firmware source; opening its evidence reaches the correct location. Desktop shows the same job/finding, expected/observed values and source references.

Evidence: actual validator output, job/finding IDs, normalized finding JSON, diagnostic screenshot and file position. Owner: D2 algorithm, D1 execution/persistence composition, D3 rendering. A direct POST of a synthetic finding cannot satisfy this gate.

## Gate 3 — reviewed correction and genuine rerun

1. Show the exact firmware mapping change GPIO26 → GPIO14 to the user. For P0, the user may review and apply this one-line correction manually. Do not claim an automated patch/rollback feature without its separate implemented and tested API. Netlist bytes remain unchanged.
2. Run Validate again through VS Code. Require a new job UUID, actual terminal succeeded status and zero mismatches for the minimal corrected fixture. Empty findings from a failed/unavailable job do not count as success. Pin consistency does not certify electrical safety or a firmware build.
3. Retrieve and compare both jobs: the first failed result remains immutable; the new job has zero findings. D3 selects the new job and clears obsolete diagnostics, rather than displaying all historical open findings as current.
4. Refresh desktop and VS Code; both show the same latest job. The agreed persisted completed-event/context pointer must let both recover that current job after restart. Context preserves the failed observation as history while accurately identifying the correction outcome.
5. If PlatformIO is part of the demonstration, run the real allowlisted build and preserve exit/output. If unavailable, label skipped/unavailable and do not claim firmware compiled. This optional step must not block the deterministic comparison demo.

Evidence: reviewed diff, distinct old/new job IDs and actual results, cleared native diagnostic and matching desktop state. Owner: all three within their boundaries.

## Gate 4 — persisted handoff and cross-agent retrieval

1. Through the real VS Code command, review a structured handoff referencing the observed validation context records and a user-entered decision. Save only after explicit confirmation using createHandoff. Capture handoffId; retrieve it again through getHandoff/listHandoffs.
2. Reject a handoff attempting to reference a context record from the empty control project; no partial handoff may be stored. Preserve agent_summary versus observed_tool versus user_entered provenance.
3. Start the second host as a distinct real process using D2's published configuration. Invoke the real MCP get_project_context tool for the fixture project, then get_validation_results for the corrected job and list_project_events. This must travel through gateway → authenticated daemon, not a copied document/mock/alternate store.
4. Compare shared context record IDs, project ID, sourceRef job IDs, provenance and semantic results with the REST/VS Code output. generatedAt timestamps may differ. Do not require the ProjectMemory response to contain a handoffs field: that is not the frozen schema. Verify saved handoff separately through the existing handoff SDK; the context must include its referenced facts/decision.
5. Stop/restart the actual daemon using the same UDI_DATA_DIR and leave the workspace unchanged. Reconnect both hosts; retrieve the same handoff/record/job UUIDs and latest corrected result. Local token reuse must work, and the control project remains isolated.

Evidence: sanitized real MCP request/response transcript and host/version, stored handoff/context IDs, REST comparison and restart proof. Owner: D2 gateway/agent path, D3 handoff workflow, D1 shared persistence and orchestration.

## Failure cases and release gate

- Missing/wrong token → 401; malformed UUID or cross-project write → 400; wrong-project resource read → 404. Never recover by selecting a different project silently.
- Missing engineering tool, nonzero exit, timeout/cancellation or gateway disconnect → honest unavailable/failed UI, no fabricated completed pass or duplicate writes.
- Source path escape/missing file → no unsafe file navigation; show the diagnostic error without opening an unrelated workspace file.
- Reload after corrected success → old open findings remain historical; they must not reappear as current diagnostics.
- A handoff dialog cancelled by the user → no save. A draft copied to clipboard is not stored.

Release only after all four product gates pass twice on the same integrated commit from fresh fixture/data copies. Record commit, OS, Node/pnpm/VS Code/host/validator versions, fixture hashes, exact launch commands and sanitized evidence. Mark absent capabilities BLOCKED and unexecuted gates NOT RUN; never turn the backend smoke's synthetic records into product pass evidence.

Five-minute narrative after passing the gates: 0:00–0:40 connect VS Code/project; 0:40–1:50 real mismatch/evidence; 1:50–2:50 reviewed correction and rerun; 2:50–3:40 saved handoff; 3:40–4:40 second-host MCP retrieval/restart; 4:40–5:00 architecture and limits. Keep the complete evidence bundle outside the public repository unless reviewed and free of secrets.
