#!/usr/bin/env python3
"""Opt-in, local-only Spec 2 experiment using actual Codex/Claude saved sessions.

The normalizer below is TEST CODE, not a production importer or classifier.
Native stores are opened read-only. Personal content is never printed or committed.
Only an isolated temporary daemon receives the sampled context and is then removed.
"""

import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import sqlite3
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

from verify_spec2 import Mcp, ROOT, stop


def readonly(path):
    connection = sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True, timeout=2)
    connection.execute("PRAGMA query_only=ON")
    return connection


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def stamp(milliseconds):
    return datetime.fromtimestamp(milliseconds / 1000, timezone.utc).isoformat()


def sample_sources(codex_home, claude_home, requested_project):
    history_path = claude_home / "history.jsonl"
    history = []
    with history_path.open() as stream:
        for line_number, line in enumerate(stream, 1):
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue  # An actively appended last line need not be complete yet.
            if entry.get("project") and entry.get("sessionId") and isinstance(entry.get("display"), str):
                history.append((line_number, entry))
    with readonly(codex_home / "state_5.sqlite") as connection:
        threads = connection.execute(
            "SELECT id,cwd FROM threads WHERE source='vscode' AND originator='codex_vscode' "
            "ORDER BY updated_at DESC"
        ).fetchall()
    claude_projects = {str(Path(entry["project"]).resolve()) for _, entry in history}
    selected = None
    with readonly(codex_home / "thread_history_1.sqlite") as connection:
        for thread_id, cwd in threads:
            project = str(Path(cwd).resolve())
            if project not in claude_projects or (requested_project and project != str(requested_project.resolve())):
                continue
            if not Path(project).is_dir():
                continue
            candidates = connection.execute(
                "SELECT turn_id,item_id,rollout_ordinal,created_at_ms,item_type,item_json "
                "FROM thread_items WHERE thread_id=? AND item_type IN "
                "('userMessage','agentMessage','commandExecution') ORDER BY rollout_ordinal",
                (thread_id,),
            ).fetchall()
            if not candidates:
                continue
            # Bound the sample while including genuine users, assistant replies and command results.
            chosen = []
            for kind, limit in (("userMessage", 12), ("agentMessage", 4), ("commandExecution", 4)):
                chosen.extend([row for row in candidates if row[4] == kind][-limit:])
            selected = thread_id, project, sorted(chosen, key=lambda row: row[2])
            break
    if selected is None:
        raise RuntimeError("No readable Codex VS Code SQLite session shares a project with Claude history")
    thread_id, project, codex_rows = selected
    matching = [(number, entry) for number, entry in history if str(Path(entry["project"]).resolve()) == project]
    sizes = Counter(entry["sessionId"] for _, entry in matching)
    session_id = max(sizes, key=lambda sid: (sizes[sid], max(
        entry.get("timestamp", 0) for _, entry in matching if entry["sessionId"] == sid
    )))
    claude_rows = [(number, entry) for number, entry in matching if entry["sessionId"] == session_id][-12:]
    records = []
    for turn_id, item_id, ordinal, created_ms, kind, raw in codex_rows:
        item = json.loads(raw)
        if kind == "userMessage":
            text = "\n".join(part["text"] for part in item.get("content", [])
                             if isinstance(part, dict) and isinstance(part.get("text"), str))
            role, source_kind = "user", "user_entered"
        elif kind == "agentMessage":
            text = item.get("text", "")
            role, source_kind = "assistant", "agent_summary"
        else:
            text = json.dumps({key: item.get(key) for key in (
                "command", "status", "exitCode", "aggregatedOutput")}, ensure_ascii=False)
            role, source_kind = "tool", "observed_tool"
        if not text:
            continue
        source_ref = f"codex:{thread_id}:{turn_id}:{item_id}"
        envelope = {"version": 1, "origin": "codex", "storage": "sqlite",
                    "sessionId": thread_id, "itemId": item_id, "turnId": turn_id,
                    "ordinal": ordinal, "timestamp": stamp(created_ms), "role": role, "text": text}
        records.append({"kind": "fact" if role == "tool" else "summary",
                        "text": json.dumps(envelope, ensure_ascii=False, sort_keys=True),
                        "provenance": {"sourceKind": source_kind, "actor": "codex-vscode-storage-replay",
                                       "sourceRef": source_ref}, "evidence": []})
    for line_number, entry in claude_rows:
        source_ref = f"claude-code:{session_id}:history-line:{line_number}"
        envelope = {"version": 1, "origin": "claude-code", "storage": "jsonl",
                    "sessionId": session_id, "timestamp": stamp(entry["timestamp"]),
                    "role": "user", "text": entry["display"], "historyLine": line_number}
        records.append({"kind": "summary", "text": json.dumps(envelope, ensure_ascii=False, sort_keys=True),
                        "provenance": {"sourceKind": "user_entered", "actor": "claude-code-storage-replay",
                                       "sourceRef": source_ref}, "evidence": []})

    def unchanged():
        with readonly(codex_home / "thread_history_1.sqlite") as connection:
            for turn_id, item_id, _, _, _, raw in codex_rows:
                row = connection.execute(
                    "SELECT item_json FROM thread_items WHERE thread_id=? AND turn_id=? AND item_id=?",
                    (thread_id, turn_id, item_id),
                ).fetchone()
                if not row or digest(row[0]) != digest(raw):
                    return False
        current = history_path.read_text().splitlines()
        return all(number <= len(current) and json.loads(current[number - 1]) == entry
                   for number, entry in claude_rows)

    return project, records, unchanged


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--codex-home", type=Path, default=Path.home() / ".codex")
    parser.add_argument("--claude-home", type=Path, default=Path.home() / ".claude")
    parser.add_argument("--project-root", type=Path)
    args = parser.parse_args()
    started = time.monotonic()
    project_root, records, unchanged = sample_sources(args.codex_home, args.claude_home, args.project_root)
    counts = Counter(json.loads(record["text"])["origin"] for record in records)
    assert counts["codex"] and counts["claude-code"], "Both native sources must supply real records"
    checks = []

    def check(condition, description):
        if not condition:
            raise AssertionError(description)
        checks.append(description)

    with tempfile.TemporaryDirectory(prefix="udi-native-context-") as directory:
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]
        env = {**os.environ, "UDI_PORT": str(port), "UDI_DATA_DIR": directory,
               "UDI_TOKEN": "", "UDI_INTEGRATIONS": "true",
               "UDI_DAEMON_URL": f"http://127.0.0.1:{port}"}
        token = ""
        daemon = None
        readers = []

        def http(method, path, data=None):
            request = urllib.request.Request(env["UDI_DAEMON_URL"] + "/api/v1" + path,
                data=None if data is None else json.dumps(data).encode(), method=method,
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
            try:
                with urllib.request.urlopen(request, timeout=6) as response:
                    return response.status, json.load(response)
            except urllib.error.HTTPError as error:
                with error:
                    return error.code, json.load(error)

        def api(method, path, data=None):
            status, value = http(method, path, data)
            if status >= 400 or not value.get("ok"):
                raise RuntimeError(f"Local test API rejected {method} with HTTP {status}")
            return value["data"]

        def start():
            nonlocal daemon, token
            daemon = subprocess.Popen([shutil.which("node"), "apps/core-daemon/dist/main.js"],
                cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            deadline = time.monotonic() + 6
            while time.monotonic() < deadline:
                if daemon.poll() is not None:
                    raise RuntimeError("Isolated daemon exited")
                try:
                    if http("GET", "/health")[0] == 200:
                        token = (Path(directory) / "token").read_text().strip()
                        return
                except OSError:
                    pass
                time.sleep(.03)
            raise TimeoutError("Isolated daemon startup exceeded six seconds")

        def memory(reader, project_id):
            response = reader.tool("get_project_context", {"projectId": project_id, "maxItems": 100})
            if response.get("isError"):
                raise RuntimeError("MCP memory retrieval failed")
            return next(json.loads(item["text"]) for item in response["content"]
                        if item["type"] == "text" and item["text"].lstrip().startswith("{"))

        try:
            start()
            project = api("POST", "/projects", {"name": "Native storage Spec2 experiment", "rootPath": project_root})
            project_id = project["id"]
            path = f"/projects/{project_id}"
            for record in records:
                # Preserve the sampled fields exactly; this is not a production importer.
                api("POST", path + "/context/records", record)
                envelope = json.loads(record["text"])
                api("POST", path + "/events", {
                    "type": "context.session.storage_test", **record["provenance"],
                    "payload": {"sourceType": {"user": "user_message", "assistant": "assistant_thought",
                                               "tool": "tool_result"}[envelope["role"]],
                                "origin": envelope["origin"], "originalTimestamp": envelope["timestamp"]},
                })
            env["UDI_PROJECT_ID"] = project_id
            # Real independent stdio clients, not running Codex/Claude applications.
            for _ in range(2):
                readers.append(Mcp(env))
            expected = {record["provenance"]["sourceRef"]: record for record in records}
            for index, reader in enumerate(readers):
                actual = {record["provenance"]["sourceRef"]: record
                          for record in memory(reader, project_id)["records"]}
                check(set(actual) == set(expected), f"reader {index + 1}: retrieves both native source samples")
                check(all(digest(actual[ref]["text"]) == digest(record["text"])
                          and actual[ref]["provenance"] == record["provenance"]
                          for ref, record in expected.items()),
                      f"reader {index + 1}: exact text, role, session identity, timestamp and provenance survive")
            control = api("POST", "/projects", {"name": "Isolated control", "rootPath": directory})
            check(memory(readers[1], control["id"])["records"] == [],
                  "native source sample does not leak into a different project")
            for index, actor in enumerate(("codex-storage-replay", "claude-code-storage-replay")):
                response = readers[index].tool("record_decision", {
                    "text": f"SPEC2_STORAGE_REPLAY_RECEIPT_{index}", "actor": actor})
                check(not response.get("isError"), f"reader {index + 1}: genuine MCP write succeeds")
                other = memory(readers[1 - index], project_id)
                check(any(record["text"] == f"SPEC2_STORAGE_REPLAY_RECEIPT_{index}"
                          and record["provenance"]["actor"] == actor
                          and record["provenance"]["sourceKind"] == "agent_summary"
                          for record in other["records"]), f"reader {index + 1}: other reader retrieves write with unpromoted provenance")
            compressed = api("GET", path + "/compressed-context")
            check("No verified current validation pass" in compressed["injectedBlock"],
                  "historic session text never invents a current engineering pass")
            check("SPEC2_STORAGE_REPLAY_RECEIPT" not in compressed["injectedBlock"],
                  "agent-written receipts are not promoted into authoritative decisions")
            retained_messages = sum(json.loads(record["text"])["text"] in compressed["injectedBlock"]
                                    for record in records)
            native_user_turns = sum(json.loads(record["text"])["role"] == "user" for record in records)
            status, rollup = http("GET", path + "/compressed-context?mode=ai_distillation")
            if native_user_turns > 10:
                check(status == 501 and rollup.get("error", {}).get("code") == "NOT_IMPLEMENTED",
                      "real long session without classifier annotations returns explicit AI-rollup unavailable")
                ai_result = "UNAVAILABLE: real source data has no Spec1 classified events"
            else:
                check(status == 200 and rollup["data"]["mode"] == "deterministic_delta",
                      "real short session honestly falls back to deterministic mode")
                ai_result = "DETERMINISTIC_FALLBACK: at most ten sampled user turns"
            for reader in readers:
                reader.close()
            readers.clear()
            stop(daemon)
            start()
            saved = api("GET", path + "/context/records?limit=100")["items"]
            actual = {record["provenance"].get("sourceRef"): record for record in saved}
            check(all(ref in actual and digest(actual[ref]["text"]) == digest(record["text"])
                      for ref, record in expected.items()), "both native samples survive daemon restart")
            check(unchanged(), "sampled native SQLite rows and Claude history entries remain unchanged")
            print(json.dumps({"status": "PASS_FOR_NORMALIZED_SHARED_MEMORY_ONLY", "checksPassed": len(checks),
                "checks": checks, "nativeRecords": dict(counts),
                "roles": dict(Counter(json.loads(record["text"])["role"] for record in records)),
                "seconds": round(time.monotonic() - started, 2),
                "compression": {key: compressed[key] for key in (
                    "rawTokensEstimate", "compressedTokensEstimate", "savingsPercent")},
                "nativeMessagesVerbatimInDeterministicBlock": retained_messages,
                "nativeUserTurns": native_user_turns,
                "aiRollup": ai_result,
                "limitations": [
                    "Test-only normalization explicitly supplied; automatic native-store import is NOT implemented by Spec2 bridge",
                    "Claude input is real saved user-prompt history, not full assistant/tool transcripts",
                    "No real classifier scores or distilled facts were supplied; AI semantic rollup is NOT verified",
                    "Generic conversational context is available through full memory, but deterministic hardware delta is not a lossless session converter",
                    "Native target database/JSONL writers and live Codex/Claude application consumption were NOT tested",
                    "Only selected text/role/time/identity fields were normalized; native attachments and full format metadata were not converted",
                ]}, indent=2))
        finally:
            for reader in readers:
                reader.close()
            stop(daemon)


if __name__ == "__main__":
    main()
