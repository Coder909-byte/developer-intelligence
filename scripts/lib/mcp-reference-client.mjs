import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';

// Protocol test client for Developer 2's real CLI; no gateway implementation.
export async function connectMcp(root, env) {
  const child = spawn(process.execPath, ['packages/mcp-gateway/dist/cli.js'], {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  const pending = new Map();
  let nextId = 0;
  function fail(error) {
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(error);
    }
    pending.clear();
  }
  const lines = createInterface({ input: child.stdout });
  lines.on('line', (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      fail(new Error('Non-protocol stdout from MCP CLI'));
      return;
    }
    const item = pending.get(message.id);
    if (!item) return;
    clearTimeout(item.timer);
    pending.delete(message.id);
    if (message.error) item.reject(new Error(message.error.message));
    else item.resolve(message.result);
  });
  child.on('error', fail);
  child.on('exit', () => fail(new Error('MCP CLI exited')));
  function request(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`MCP timeout: ${method}`));
      }, 10000);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }
  async function close() {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    try {
      await exited;
    } finally {
      clearTimeout(timer);
      lines.close();
    }
  }
  try {
    const initialized = await request('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'udi-live-demo-reference-client', version: '1.0.0' },
    });
    child.stdin.write(
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n',
    );
    return {
      initialized,
      request,
      close,
      async tool(name, args) {
        const result = await request('tools/call', { name, arguments: args });
        if (result.isError) throw new Error(`MCP tool failed: ${name}`);
        const text = result.content
          .filter((block) => block.type === 'text')
          .map((block) => block.text);
        const json = text.find((value) => /^\s*[[{]/.test(value));
        if (!json) throw new Error(`MCP tool returned no JSON: ${name}`);
        return { data: JSON.parse(json), text: text.join('\n') };
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}
