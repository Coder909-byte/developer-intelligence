import { writeFile } from 'node:fs/promises';

// A real Electron/Chromium renderer connection, never a replacement VS Code API.
export async function connectRenderer(port, match = () => true) {
  const targets = await (
    await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(5000) })
  ).json();
  const target = targets.find((item) => item.type === 'page' && match(item));
  if (!target) throw new Error(`No matching real renderer on port ${port}`);
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Renderer connection timeout')), 5000);
    socket.addEventListener(
      'open',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
    socket.addEventListener(
      'error',
      () => {
        clearTimeout(timer);
        reject(new Error('Renderer connection failed'));
      },
      { once: true },
    );
  });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    const item = pending.get(message.id);
    if (!item) return;
    pending.delete(message.id);
    clearTimeout(item.timer);
    if (message.error) item.reject(new Error(message.error.message));
    else item.resolve(message.result);
  });
  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Renderer timeout: ${method}`));
      }, 10000);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
  async function evaluate(expression) {
    const result = await call('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  }
  async function waitFor(expression, label = expression, timeout = 15000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Actual UI did not show: ${label}`);
  }
  async function key(key) {
    const code = { Enter: 13, Escape: 27, F1: 112, ArrowDown: 40 }[key];
    await call('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key,
      code: key,
      windowsVirtualKeyCode: code,
    });
    await call('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key,
      code: key,
      windowsVirtualKeyCode: code,
    });
  }
  async function clickText(text) {
    const expression = `(()=>{const e=[...document.querySelectorAll('.monaco-list-row,button,.monaco-button')].find(e=>e.offsetParent!==null && e.innerText.trim()===${JSON.stringify(text)});if(!e)return false;e.click();return true})()`;
    await waitFor(expression, `click ${text}`);
  }
  await call('Page.bringToFront');
  return {
    target,
    call,
    evaluate,
    waitFor,
    key,
    clickText,
    body: () => evaluate('document.body.innerText'),
    waitText: (text) => waitFor(`document.body.innerText.includes(${JSON.stringify(text)})`, text),
    insertText: (text) => call('Input.insertText', { text }),
    async input(text) {
      await call('Input.insertText', { text });
      await key('Enter');
    },
    async command(title, execute = true) {
      await key('F1');
      await waitFor(
        `document.querySelector('.quick-input-widget input:focus')?.value.startsWith('>')`,
        'command palette',
      );
      await call('Input.insertText', { text: title });
      await waitFor(
        `document.querySelector('.quick-input-list')?.innerText.includes(${JSON.stringify(title)})`,
        title,
      );
      if (execute) await key('Enter');
    },
    async screenshot(path) {
      await call('Page.bringToFront');
      const result = await call('Page.captureScreenshot', { format: 'png' });
      await writeFile(path, Buffer.from(result.data, 'base64'));
    },
    close() {
      for (const item of pending.values()) {
        clearTimeout(item.timer);
        item.reject(new Error('Renderer closed'));
      }
      pending.clear();
      socket.close();
    },
  };
}
