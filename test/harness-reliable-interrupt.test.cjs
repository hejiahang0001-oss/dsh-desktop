const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  MAX_INTERRUPT_PROMPT_LENGTH,
  ReliableInterruptController,
  ReliableInterruptError,
  readHarnessQueueSnapshot
} = require('../electron/harness-reliable-interrupt.cjs');

const root = path.resolve(__dirname, '..');
const SESSION_ID = 'session-11111111-1111-4111-8111-111111111111';
const OTHER_SESSION_ID = 'session-22222222-2222-4222-8222-222222222222';

const fixture = ({
  running = true,
  remainRunning = false,
  selections = [SESSION_ID, SESSION_ID],
  queue = [{ id: 'message-queued-1', placement: 'queued', message: { content: [{ type: 'text', text: '完整排队消息' }] } }]
} = {}) => {
  const calls = [];
  let listCalls = 0;
  let selectionCalls = 0;
  const apiCall = async (_origin, method, payload) => {
    calls.push({ method, payload });
    if (method === 'session.list') {
      listCalls += 1;
      return {
        items: [{
          sessionId: SESSION_ID,
          cwd: 'C:\\repo',
          running: running && (remainRunning || listCalls === 1),
          origin: 'local'
        }]
      };
    }
    if (method === 'session.cancel') return { accepted: true };
    if (method === 'session.updateQueue') return { accepted: true };
    if (method === 'session.prompt') return { accepted: true };
    throw new Error(`unexpected ${method}`);
  };
  const controller = new ReliableInterruptController({
    getOrigin: () => 'http://127.0.0.1:18888',
    getWebContents: () => ({}),
    getWorkspacePath: () => 'C:\\repo',
    readSelection: async () => selections[Math.min(selectionCalls++, selections.length - 1)],
    apiCall,
    readQueue: async () => queue,
    wait: async () => {}
  });
  return { controller, calls };
};

test('running plain-text correction cancels first and starts an authoritative Harness turn', async () => {
  const { controller, calls } = fixture();
  const receipt = await controller.interruptAndPrompt('  先回答我刚才补充的问题  ');
  assert.equal(receipt.ok, true);
  assert.equal(receipt.accepted, true);
  assert.equal(receipt.interrupted, true);
  assert.deepEqual(calls.map((entry) => entry.method), [
    'session.list',
    'session.cancel',
    'session.list',
    'session.prompt'
  ]);
  assert.deepEqual(calls.at(-1).payload, {
    sessionId: SESSION_ID,
    mode: 'steer',
    content: [{ type: 'text', text: '先回答我刚才补充的问题' }]
  });
  assert.match(receipt.message, /已中断当前回合/);
});

test('a turn that already ended is submitted once as a normal queued turn', async () => {
  const { controller, calls } = fixture({ running: false });
  const receipt = await controller.interruptAndPrompt('补充问题');
  assert.equal(receipt.interrupted, false);
  assert.deepEqual(calls.map((entry) => entry.method), ['session.list', 'session.prompt']);
  assert.equal(calls.at(-1).payload.mode, 'queue');
});

test('slow cancellation keeps the correction durable instead of dropping it', async () => {
  const { controller, calls } = fixture({ remainRunning: true });
  const receipt = await controller.interruptAndPrompt('不要继续原方案', { maxIdleChecks: 2 });
  assert.equal(receipt.interrupted, true);
  assert.equal(receipt.delivery, 'queued-after-cancel');
  assert.equal(calls.at(-1).method, 'session.prompt');
  assert.equal(calls.at(-1).payload.mode, 'queue');
});

test('the visible queued-message button promotes authoritative full content without using its truncated preview', async () => {
  const full = '这是超过界面预览但仍需完整保留的排队消息'.repeat(20);
  const { controller, calls } = fixture({
    queue: [{ id: 'message-queued-full', placement: 'queued', message: { content: [{ type: 'text', text: full }] } }]
  });
  const receipt = await controller.interruptQueued();
  assert.equal(receipt.accepted, true);
  assert.equal(receipt.interrupted, true);
  assert.deepEqual(calls.map((entry) => entry.method), [
    'session.list',
    'session.updateQueue',
    'session.cancel',
    'session.list',
    'session.prompt'
  ]);
  assert.deepEqual(calls[1].payload, {
    sessionId: SESSION_ID,
    itemId: 'message-queued-full',
    action: { kind: 'remove' }
  });
  assert.equal(calls.at(-1).payload.content[0].text, full);
});

test('queue snapshot reads one bounded authoritative WebSocket baseline', async () => {
  const payload = {
    type: 'server-request',
    rpcId: 'rpc-1',
    method: 'session/queue',
    payload: {
      type: 'session/queue',
      sessionId: SESSION_ID,
      items: [{ id: 'message-1', placement: 'queued', message: { content: [{ type: 'text', text: '完整内容' }] } }]
    }
  };
  class FakeWebSocket {
    constructor(url) {
      assert.equal(url, 'ws://127.0.0.1:18888/api/events.mux');
      this.listeners = new Map();
      setImmediate(() => this.listeners.get('message')?.({ data: JSON.stringify(payload) }));
    }
    addEventListener(name, listener) { this.listeners.set(name, listener); }
    close() {}
  }
  const items = await readHarnessQueueSnapshot('http://127.0.0.1:18888', SESSION_ID, { webSocketImpl: FakeWebSocket, timeoutMs: 100 });
  assert.equal(items.length, 1);
  assert.equal(items[0].message.content[0].text, '完整内容');
});

test('session and workspace races fail closed before the correction is sent', async () => {
  const changed = fixture({ selections: [SESSION_ID, OTHER_SESSION_ID] });
  await assert.rejects(changed.controller.interruptAndPrompt('补充问题'), (error) => (
    error instanceof ReliableInterruptError && error.code === 'session-changed'
  ));
  assert.equal(changed.calls.some((entry) => entry.method === 'session.prompt'), false);

  const wrongWorkspace = fixture();
  wrongWorkspace.controller.getWorkspacePath = () => 'C:\\other';
  await assert.rejects(wrongWorkspace.controller.interruptAndPrompt('补充问题'), (error) => (
    error instanceof ReliableInterruptError && error.code === 'workspace-mismatch'
  ));
});

test('prompt input is bounded and never accepts blank or control-character payloads', async () => {
  const { controller } = fixture();
  for (const value of ['', '   ', 'bad\0message', 'x'.repeat(MAX_INTERRUPT_PROMPT_LENGTH + 1)]) {
    await assert.rejects(controller.interruptAndPrompt(value), (error) => (
      error instanceof ReliableInterruptError && error.code === 'invalid-message'
    ));
  }
});

test('renderer hook intercepts only safe running plain-text Ctrl+Enter and clears after receipt', () => {
  const script = fs.readFileSync(path.join(root, 'assets', 'harness-reliable-interrupt.js'), 'utf8');
  assert.match(script, /addEventListener\('keydown', onKeyDown, true\)/);
  assert.match(script, /event\.ctrlKey \|\| event\.metaKey/);
  assert.match(script, /data-composer-card/);
  assert.match(script, /data-decoration="chip"/);
  assert.match(script, /data-decoration="text-ref"/);
  assert.match(script, /querySelector\('img'\)/);
  assert.match(script, /startsWith\('\/'\)/);
  assert.match(script, /stopImmediatePropagation/);
  assert.match(script, /interruptAndPrompt/);
  assert.match(script, /interruptQueued/);
  assert.match(script, /Steer queued message/);
  assert.match(script, /target\.value !== original/);
  assert.match(script, /dispatchEvent\(new Event\('input'/);
  assert.doesNotMatch(script, /console\.(?:log|info|debug)\s*\(/);
});

test('renderer hook performs one real capture-path interrupt and clears the controlled textarea', async () => {
  const source = fs.readFileSync(path.join(root, 'assets', 'harness-reliable-interrupt.js'), 'utf8');
  const nodes = new Map();
  let keydown;
  class FakeElement {
    constructor() {
      this.attributes = new Map();
      this.dataset = {};
      this.disabled = false;
      this.isConnected = true;
      this.textContent = '';
    }
    getAttribute(name) { return this.attributes.get(name) || null; }
    setAttribute(name, value) { this.attributes.set(name, value); }
    querySelector() { return null; }
    insertAdjacentElement(_position, element) { nodes.set(element.id, element); }
    focus() { this.focused = true; }
  }
  class FakeTextArea extends FakeElement {
    constructor(card) {
      super();
      this.card = card;
      this._value = '';
      this.readOnly = false;
    }
    get value() { return this._value; }
    set value(value) { this._value = value; }
    closest(selector) { return selector === '[data-composer-card]' ? this.card : null; }
    dispatchEvent(event) { this.dispatched = event; return true; }
  }
  const stop = new FakeElement();
  stop.textContent = '停止生成';
  const card = new FakeElement();
  const textarea = new FakeTextArea(card);
  textarea.value = '请先回答补充问题';
  const calls = [];
  const window = {
    desktopAPI: {
      harness: {
        interruptAndPrompt: async (text) => {
          calls.push(text);
          return { accepted: true, message: '已中断当前回合，插话已开始处理。' };
        }
      }
    }
  };
  const document = {
    querySelectorAll: () => [stop],
    querySelector: () => card,
    getElementById: (id) => nodes.get(id) || null,
    createElement: () => new FakeElement(),
    addEventListener: (name, listener, capture) => {
      assert.equal(capture, true);
      if (name === 'keydown') keydown = listener;
    },
    removeEventListener: () => {}
  };
  class FakeEvent {
    constructor(type, options) { this.type = type; this.bubbles = options?.bubbles === true; }
  }
  assert.equal(Function('window', 'document', 'HTMLElement', 'HTMLTextAreaElement', 'Event', `return ${source}`)(
    window,
    document,
    FakeElement,
    FakeTextArea,
    FakeEvent
  ), true);
  const event = {
    target: textarea,
    key: 'Enter',
    ctrlKey: true,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    repeat: false,
    isComposing: false,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
    stopImmediatePropagation() { this.stopped = true; }
  };
  await keydown(event);
  assert.equal(event.defaultPrevented, true);
  assert.equal(event.stopped, true);
  assert.deepEqual(calls, ['请先回答补充问题']);
  assert.equal(textarea.value, '');
  assert.equal(textarea.dispatched.type, 'input');
  assert.equal(textarea.focused, true);
  assert.match(nodes.get('dsh-reliable-interrupt-status').textContent, /已开始处理/);
});

test('main process and preload expose only the narrow reliable-interrupt method', () => {
  const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8');
  const manifest = fs.readFileSync(path.join(root, 'package.json'), 'utf8');
  assert.match(main, /harness:interrupt-and-prompt/);
  assert.match(main, /desktopIpcAllowed\(event\)/);
  assert.match(main, /installReliableInterrupt/);
  assert.match(preload, /interruptAndPrompt: \(text\) => ipcRenderer\.invoke\('harness:interrupt-and-prompt', text\)/);
  assert.match(preload, /interruptQueued: \(\) => ipcRenderer\.invoke\('harness:interrupt-queued'\)/);
  assert.doesNotMatch(preload, /sessionId.*interruptAndPrompt/);
  assert.match(manifest, /assets\/harness-reliable-interrupt\.js/);
});
