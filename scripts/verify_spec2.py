#!/usr/bin/env python3
"""Bounded Spec 2 checks against the actual daemon and MCP CLI; stdlib only.

The bridge provider in this test is a protocol fixture, never a native VS Code host.
Run after pnpm build: python3 scripts/verify_spec2.py
"""

import concurrent.futures
import json
import os
from pathlib import Path
import queue
import shutil
import socket
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request
import uuid


ROOT = Path(__file__).resolve().parent.parent
NODE = shutil.which("node")
CHECKS = []


def check(condition, label):
    if not condition:
        raise AssertionError(label)
    CHECKS.append(label)


def stop(child):
    if child and child.poll() is None:
        child.terminate()
        try:
            child.wait(timeout=3)
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait(timeout=3)


class Mcp:
    def __init__(self, env):
        self.child = subprocess.Popen(
            [NODE, "packages/mcp-gateway/dist/cli.js"], cwd=ROOT, env=env,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            text=True, bufsize=1,
        )
        self.responses = queue.Queue()
        self.counter = 0

        def read():
            try:
                for line in self.child.stdout:
                    self.responses.put(json.loads(line))
            except Exception as error:
                self.responses.put(error)
            finally:
                self.responses.put(EOFError("MCP process closed"))

        threading.Thread(target=read, daemon=True).start()
        self.request("initialize", {
            "protocolVersion": "2025-11-25", "capabilities": {},
            "clientInfo": {"name": "spec2-python-acceptance", "version": "1.0.0"},
        })
        self.child.stdin.write(json.dumps({
            "jsonrpc": "2.0", "method": "notifications/initialized",
        }) + "\n")
        self.child.stdin.flush()

    def request(self, method, params=None):
        self.counter += 1
        request_id = self.counter
        self.child.stdin.write(json.dumps({
            "jsonrpc": "2.0", "id": request_id, "method": method, "params": params or {},
        }) + "\n")
        self.child.stdin.flush()
        deadline = time.monotonic() + 8
        while True:
            message = self.responses.get(timeout=max(0.01, deadline - time.monotonic()))
            if isinstance(message, Exception):
                raise message
            if message.get("id") != request_id:
                continue  # SDK notifications can precede the response.
            if "error" in message:
                raise RuntimeError(message["error"])
            return message["result"]

    def tool(self, name, arguments=None):
        return self.request("tools/call", {"name": name, "arguments": arguments or {}})

    def names(self):
        return {tool["name"] for tool in self.request("tools/list")["tools"]}

    def close(self):
        stop(self.child)
        for stream in (self.child.stdin, self.child.stdout):
            stream.close()


def main():
    started = time.monotonic()
    with tempfile.TemporaryDirectory(prefix="udi-spec2-python-") as directory:
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]
        base = f"http://127.0.0.1:{port}/api/v1"
        env = {**os.environ, "UDI_PORT": str(port), "UDI_DATA_DIR": directory,
               "UDI_TOKEN": "", "UDI_INTEGRATIONS": "true", "UDI_DAEMON_URL": base[:-7]}
        daemon = None
        mcp = None
        token = ""

        def http(method, path, body=None, expected=None, auth=True):
            headers = {"Content-Type": "application/json"}
            if auth:
                headers["Authorization"] = f"Bearer {token}"
            request = urllib.request.Request(
                base + path, method=method, headers=headers,
                data=None if body is None else json.dumps(body).encode(),
            )
            try:
                response = urllib.request.urlopen(request, timeout=8)
            except urllib.error.HTTPError as error:
                response = error
            with response:
                status = response.status
                payload = json.load(response)
            if expected is not None:
                check(status == expected, f"HTTP {expected}: {method} {path.split('?')[0]}")
                return payload
            if status >= 400 or not payload.get("ok"):
                raise AssertionError(f"HTTP {status}: {method} {path}: {payload}")
            return payload["data"]

        def start():
            nonlocal daemon, token
            daemon = subprocess.Popen(
                [NODE, "apps/core-daemon/dist/main.js"], cwd=ROOT, env=env,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
            deadline = time.monotonic() + 8
            while time.monotonic() < deadline:
                if daemon.poll() is not None:
                    raise RuntimeError("Daemon exited during startup")
                try:
                    http("GET", "/health", auth=False)
                    token = (Path(directory) / "token").read_text().strip()
                    return
                except (OSError, ValueError):
                    time.sleep(0.05)
            raise TimeoutError("Daemon startup exceeded 8 seconds")

        try:
            start()
            http("GET", "/projects", expected=401, auth=False)
            project = http("POST", "/projects", {
                "name": "Spec2 Python rover", "rootPath": str(ROOT / "examples/rover"),
            })
            project_id = project["id"]
            control = http("POST", "/projects", {"name": "Control", "rootPath": directory})
            path = f"/projects/{project_id}"
            record = lambda text, source="observed_tool", kind="fact": http(
                "POST", path + "/context/records", {
                    "kind": kind, "text": text,
                    "provenance": {"sourceKind": source, "actor": "python-acceptance"},
                    "evidence": [],
                })
            record("compiler scrollback " * 600)
            record("Patch firmware only", "user_entered", "decision")
            record("UNVERIFIED_AGENT_CLAIM", "agent_summary", "decision")
            job = http("POST", path + "/validation-jobs", {
                "kind": "pin_consistency",
                "artifactPaths": ["rover.net", "src/pins.h", "engineering-map.json"],
                "requestedBy": "python-acceptance",
            })
            check(job["status"] == "failed", "real mismatch validator fails")
            compressed = http("GET", path + "/compressed-context")
            check("MOTOR_EN=GPIO14" in compressed["activeInvariants"], "GPIO14 preserved")
            check("GPIO26" in compressed["injectedBlock"], "actual mismatch preserved")
            check("rover.net:28" in compressed["injectedBlock"] and
                  "src/pins.h:7" in compressed["injectedBlock"], "both source positions preserved")
            check(len(compressed["injectedBlock"]) < 500 and
                  compressed["compressedTokensEstimate"] < 150 and
                  compressed["savingsPercent"] >= 90, "compression meets Spec2 thresholds")
            check("UNVERIFIED_AGENT_CLAIM" not in compressed["injectedBlock"],
                  "agent claim excluded from authoritative decisions")
            check(compressed["injectedBlock"] == http("GET", path + "/compressed-context")["injectedBlock"],
                  "deterministic context block")
            benchmark_input = {"projectId": project_id, "projectName": project["name"],
                "records": http("GET", path + "/context/records")["items"],
                "findings": http("GET", f"/engineering/findings?projectId={project_id}")["items"],
                "latestJob": job}
            benchmark_code = """
import { buildDeterministicDelta } from './packages/context-engine/dist/index.js';
let raw = ''; for await (const part of process.stdin) raw += part;
const input = JSON.parse(raw);
for (let i = 0; i < 30; i++) buildDeterministicDelta(input);
const samples = [];
for (let i = 0; i < 200; i++) {
  const start = performance.now(); buildDeterministicDelta(input);
  samples.push(performance.now() - start);
}
samples.sort((a, b) => a - b);
console.log(JSON.stringify({samples: samples.length, medianMs: samples[100], p95Ms: samples[190],
  maxMs: samples.at(-1), scope: 'pure deterministic compressor; HTTP/SQLite excluded'}));
"""
            benchmark = json.loads(subprocess.run(
                [NODE, "--input-type=module", "-e", benchmark_code], cwd=ROOT,
                input=json.dumps(benchmark_input), text=True, capture_output=True,
                timeout=5, check=True,
            ).stdout)
            check(benchmark["medianMs"] < 1 and benchmark["p95Ms"] < 1,
                  f'deterministic latency target: median={benchmark["medianMs"]:.4f}ms, p95={benchmark["p95Ms"]:.4f}ms (<1ms)')
            http("GET", path + "/compressed-context?mode=bogus", expected=400)
            check(http("GET", path + "/compressed-context?mode=ai_distillation")["mode"] ==
                  "deterministic_delta", "short sessions use deterministic mode")

            # Classified events are fixture INPUTS, not proof of a real model/classifier run.
            for _ in range(11):
                http("POST", path + "/events", {
                    "type": "context.classified", "actor": "classifier-input-fixture",
                    "sourceKind": "user_entered", "payload": {"sourceType": "user_message"},
                })
            http("GET", path + "/compressed-context?mode=ai_distillation", expected=501)
            for source, source_type, category, fact, score in [
                ("observed_tool", "tool_result", "HARDWARE_SPEC", "MOTOR_EN=GPIO14", .95),
                ("agent_summary", "assistant_thought", "ARCHITECTURAL_DECISION", "Review proposed patch", .8),
                ("observed_tool", "tool_result", "HARDWARE_SPEC", "LOW_SIGNAL_OMIT", .69),
            ]:
                http("POST", path + "/events", {
                    "type": "context.classified", "actor": "classifier-input-fixture",
                    "sourceKind": source, "payload": {"sourceType": source_type,
                    "category": category, "distilledFact": fact, "signalScore": score,
                    "decision": "preserve"},
                })
            rollup = http("GET", path + "/compressed-context?mode=ai_distillation")
            check(rollup["mode"] == "ai_distillation" and "LOW_SIGNAL_OMIT" not in rollup["injectedBlock"]
                  and "[agent_summary:classifier-input-fixture]" in rollup["injectedBlock"],
                  "classified-input rollup filters scores and preserves provenance")
            check("Patch firmware only" in rollup["injectedBlock"] and "MOTOR_EN" in rollup["injectedBlock"]
                  and "1 open finding" in rollup["injectedBlock"],
                  "AI-mode handoff retains authoritative decisions and current findings")
            for payload in [
                {"signalScore": 1.1, "decision": "preserve", "category": "HARDWARE_SPEC", "distilledFact": "INVALID_SCORE_OMIT"},
                {"signalScore": .95, "category": "HARDWARE_SPEC", "distilledFact": "NO_PRESERVE_DECISION_OMIT"},
            ]:
                http("POST", path + "/events", {"type": "context.classified", "actor": "classifier-input-fixture",
                    "sourceKind": "observed_tool", "payload": payload})
            filtered = http("GET", path + "/compressed-context?mode=ai_distillation")["injectedBlock"]
            check("INVALID_SCORE_OMIT" not in filtered and "NO_PRESERVE_DECISION_OMIT" not in filtered,
                  "invalid and unpreserved classifier annotations cannot become ground truth")

            http("POST", "/mcp/servers", {"name": "python-spec2", "enabled": True,
                 "transport": {"type": "stdio", "executableId": NODE,
                 "args": [str(ROOT / "scripts/fixtures/spec2-mcp.mjs")]}})
            env["UDI_PROJECT_ID"] = project_id
            mcp = Mcp(env)
            names = mcp.names()
            check("python-spec2__fixture_sum" in names, "real external discovery")
            sum_schema = next(tool["inputSchema"] for tool in mcp.request("tools/list")["tools"]
                              if tool["name"] == "python-spec2__fixture_sum")
            check(sum_schema["properties"]["params"]["properties"]["a"]["type"] == "integer"
                  and "nonce" in sum_schema["properties"]["params"]["required"],
                  "external tool discovery preserves actual upstream parameter schema")
            for category, hidden in {
                "hardware_validation": "get_validation_results",
                "context_memory": "get_project_context",
                "ide_extension_bridge": "vscode_list_diagnostics",
                "external_servers": "python-spec2__fixture_sum",
            }.items():
                toggle = {"projectId": project_id, "category": category, "enabled": False}
                http("PUT", path + "/tool-categories", toggle)
                check(hidden not in mcp.names(), f"{category}: removed live")
                args = {"params": {"a": 1, "b": 2, "nonce": "demo-disabled"}} if category == "external_servers" else {}
                check(mcp.tool(hidden, args).get("isError") is True, f"{category}: cached call denied")
                check(all(c["enabled"] for c in http("GET", f'/projects/{control["id"]}/tool-categories')["categories"]),
                      f"{category}: other project unchanged")
                http("PUT", path + "/tool-categories", {**toggle, "enabled": True})
                check(hidden in mcp.names(), f"{category}: restored without restart")
            http("PUT", path + "/tool-categories", {
                "projectId": control["id"], "category": "context_memory", "enabled": False,
            }, expected=400)
            routed = mcp.tool("python-spec2__fixture_sum", {
                "params": {"a": 14, "b": 26, "nonce": "demo-python"},
            })
            check(not routed.get("isError"), "external tool success relayed")
            sum_payload = next(json.loads(item["text"]) for item in routed["content"]
                               if item["type"] == "text" and item["text"].lstrip().startswith("{"))
            check(sum_payload["sum"] == 40 and sum_payload["nonce"] == "demo-python",
                  "external tool actual sum and request nonce")
            check(mcp.tool("python-spec2__fixture_failure", {"params": {}}).get("isError") is True,
                  "external tool error relayed")
            executions = http("GET", path + "/mcp-executions")["items"]
            check(any(e["toolName"] == "fixture_failure" and e["outcome"] == "failed" for e in executions),
                  "tool error persisted as failed, never succeeded")
            check("Patch firmware only" in json.dumps(mcp.tool("get_project_context")),
                  "independent MCP process retrieves stored context")

            host_id = str(uuid.uuid4())
            http("POST", path + "/extension-tools", {
                "projectId": project_id, "hostId": host_id, "name": "vscode_list_diagnostics",
                "description": "Python protocol provider, NOT native VS Code", "commandIds": [],
            })
            http("POST", path + "/extension-tools", {
                "projectId": project_id, "hostId": host_id, "name": "vscode_execute_command",
                "description": "Python protocol provider, NOT native VS Code", "commandIds": ["test.readonly"],
            })
            command = next(tool for tool in mcp.request("tools/list")["tools"]
                           if tool["name"] == "vscode_execute_command")
            check(command["inputSchema"]["properties"]["commandId"]["enum"] == ["test.readonly"]
                  and "test.readonly" in command["description"],
                  "live extension command registration is discoverable over MCP")
            http("POST", path + "/extension-tools/call", {
                "name": "vscode_execute_command", "arguments": {"commandId": "not.registered"},
            }, expected=400)
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                response = pool.submit(mcp.tool, "vscode_list_diagnostics")
                pending = []
                deadline = time.monotonic() + 3
                while not pending and time.monotonic() < deadline:
                    pending = http("GET", path + f"/extension-hosts/{host_id}/requests")["items"]
                    if not pending:
                        time.sleep(.02)
                check(bool(pending), "bridge request delivered to registered host")
                call_id = pending[0]["id"]
                result_path = f"/extension-hosts/{host_id}/results/{call_id}"
                http("POST", f'/projects/{control["id"]}' + result_path,
                     {"isError": False, "content": []}, expected=404)
                http("POST", path + result_path, {"isError": False,
                     "content": [{"message": "PROTOCOL_FIXTURE_ONLY", "line": 7}]})
                check("PROTOCOL_FIXTURE_ONLY" in json.dumps(response.result(timeout=3)),
                      "bridge returns actual provider payload via MCP")
                http("POST", path + result_path, {"isError": False, "content": []}, expected=404)
            check(any(e["sourceKind"] == "observed_tool" for e in
                      http("GET", path + "/events?type=mcp.extension.executed")["items"]),
                  "bridge completion persisted with tool provenance")
            corrected = http("POST", path + "/validation-jobs", {
                "kind": "pin_consistency", "requestedBy": "python-acceptance",
                "artifactPaths": ["rover.net", "src/pins_corrected.h", "engineering-map.json"],
            })
            check(corrected["status"] == "succeeded", "real corrected fixture succeeds")
            current = http("GET", path + "/compressed-context")
            check(current["openIssuesCount"] == 0 and "GPIO26" not in current["injectedBlock"],
                  "historical mismatch is excluded from current state")
            http("PUT", path + "/tool-categories", {
                "projectId": project_id, "category": "hardware_validation", "enabled": False,
            })
            mcp.close()
            mcp = None
            stop(daemon)
            start()
            categories = http("GET", path + "/tool-categories")["categories"]
            check(not next(c for c in categories if c["category"] == "hardware_validation")["enabled"],
                  "category survives daemon restart")
            check(http("GET", path + "/compressed-context")["openIssuesCount"] == 0,
                  "current validation survives restart")
            check(http("GET", path + "/extension-tools")["items"] == [],
                  "restart does not pretend old extension hosts are live")
            print(json.dumps({"status": "PASS", "checksPassed": len(CHECKS), "checks": CHECKS,
                  "seconds": round(time.monotonic() - started, 2),
                  "compression": {key: compressed[key] for key in (
                      "rawTokensEstimate", "compressedTokensEstimate", "savingsPercent")},
                  "latency": benchmark,
                  "nativeVsCode": "NOT TESTED: manual verification requested by user",
                  "classifier": "classified fixture inputs only; teammate integration required"}, indent=2))
        finally:
            if mcp:
                mcp.close()
            stop(daemon)


if __name__ == "__main__":
    main()
