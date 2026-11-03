#!/usr/bin/env python3
"""Opt-in test of the production conversion API using real local Codex sessions.
Reads native stores, prints aggregate results only, removes its temporary daemon.
Does not launch Claude, call a model, or write a project memory file.
"""
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from verify_native_context_stores import readonly
from verify_spec2 import ROOT, stop


def main():
    started = time.monotonic()
    native = Path(os.environ.get('UDI_CODEX_HOME', str(Path.home() / '.codex')))
    with readonly(native / 'state_5.sqlite') as connection:
        rows = connection.execute("SELECT id,cwd FROM threads WHERE source='vscode' AND originator='codex_vscode' ORDER BY updated_at DESC").fetchall()
    cases = {}
    with readonly(native / 'thread_history_1.sqlite') as connection:
        for session_id, workspace in rows:
            if not Path(workspace).is_dir():
                continue
            count = connection.execute('SELECT count(*) FROM thread_items WHERE thread_id=?', (session_id,)).fetchone()[0]
            kind = 'codex_sqlite' if count else 'codex_rollout'
            cases.setdefault(kind, (session_id, workspace))
    if not cases:
        raise RuntimeError('No real Codex VS Code sessions available')
    checks = 0
    outcomes = []
    daemon = None
    with tempfile.TemporaryDirectory(prefix='udi-codex-claude-live-') as directory:
        with socket.socket() as probe:
            probe.bind(('127.0.0.1', 0))
            port = probe.getsockname()[1]
        base = f'http://127.0.0.1:{port}/api/v1'
        env = {**os.environ, 'UDI_PORT': str(port), 'UDI_DATA_DIR': directory, 'UDI_TOKEN': '',
               'UDI_CODEX_HOME': str(native), 'UDI_INTEGRATIONS': 'true'}
        token = ''
        def http(method, path, data=None):
            request = urllib.request.Request(base + path, method=method,
                data=None if data is None else json.dumps(data).encode(),
                headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'})
            try:
                response = urllib.request.urlopen(request, timeout=8)
            except urllib.error.HTTPError as error:
                response = error
            with response:
                return response.status, json.load(response)
        try:
            daemon = subprocess.Popen([shutil.which('node'), 'apps/core-daemon/dist/main.js'], cwd=ROOT,
                env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            deadline = time.monotonic() + 8
            while time.monotonic() < deadline:
                if daemon.poll() is not None:
                    raise RuntimeError('Isolated daemon exited before ready')
                try:
                    if http('GET', '/health')[0] == 200:
                        token = (Path(directory) / 'token').read_text().strip()
                        break
                except OSError:
                    pass
                time.sleep(.04)
            if not token:
                raise TimeoutError('Daemon startup exceeded eight seconds')
            projects = {}
            for expected_storage, (session_id, workspace) in cases.items():
                if workspace not in projects:
                    status, response = http('POST', '/projects', {'name': 'Local Codex conversion test', 'rootPath': workspace})
                    assert status == 201, 'Project registration failed'
                    projects[workspace] = response['data']['id']
                project_id = projects[workspace]
                status, response = http('POST', f'/projects/{project_id}/context-bridge/codex-to-claude', {'sessionId': session_id})
                assert status == 200, f'Production converter returned HTTP {status}'
                result = response['data']
                assert result['projectId'] == project_id and result['sessionId'] == session_id
                assert result['storage'] == expected_storage
                assert result['entries'] and all(entry['text'] in result['markdown'] for entry in result['entries'])
                assert result['filename'] == 'codex-claude-context.md' and result['importLine'] == '@./codex-claude-context.md'
                assert result['nativeClaudeSessionVerified'] is False
                assert len(result['markdown']) <= 40000 and len(result['entries']) <= 24
                assert result['stats']['messagesIncluded'] == len(result['entries'])
                checks += 8
                outcomes.append({'source': result['storage'], 'messagesRead': result['stats']['messagesRead'],
                    'messagesIncluded': len(result['entries']), 'truncatedMessages': result['stats']['truncatedMessages'],
                    'markdownChars': len(result['markdown']), 'claudeSessionVerified': False})
            print(json.dumps({'status': 'PASS', 'checksPassed': checks, 'seconds': round(time.monotonic() - started, 2),
                'actualNativeSources': outcomes, 'normalizer': 'production daemon/context-engine, not a test-only adapter',
                'claudeConsumption': 'Documented Markdown export only; live Claude application not exercised'}, indent=2))
        finally:
            stop(daemon)


if __name__ == '__main__':
    main()
