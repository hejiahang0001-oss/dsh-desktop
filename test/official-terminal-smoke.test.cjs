const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

// Exercise the real smoke sequence against a public-DOM fixture, including the
// official onboarding helper. No Electron, Host, PTY, credential or disk write.
function fixture({ refuseFocus = false, modalBeforeReturn = false, inventoryEffect,
  duplicateFirstId = false, receiptFailure } = {}) {
  const events = [], rows = [{ textContent: 'fixture>' }], root = { inert: true };
  let modal = true, focused, opened = 0, executed = false, credentialInputs = 0, inventoryRead = false;
  const terminals = [], executions = [], remoteCalls = [], receipts = new Map(), pending = new Map();
  const input = { disabled: false, readOnly: false,
    closest: () => root.inert ? root : null,
    focus() { events.push('focus-input'); if (!root.inert && !modal && !refuseFocus) focused = input; }
  };
  const keyInput = {}; focused = keyInput;
  const button = { textContent: '稍后配置', disabled: false,
    getAttribute: () => null,
    getBoundingClientRect: () => ({ width: 100, height: 30, left: 20, top: 20, right: 120, bottom: 50 }),
    contains(node) { for (; node; node = node.parentElement) if (node === button) return true; return false; },
    click() { events.push('configure-later'); modal = false; root.inert = false; focused = null; }
  };
  const dialog = { getClientRects: () => modal ? [{}] : [],
    getBoundingClientRect: () => ({ width: modal ? 300 : 0, height: modal ? 200 : 0,
      left: 0, top: 0, right: 300, bottom: 200 }),
    getAttribute: name => ({ 'aria-label': '添加一个 API Key 开始使用', 'aria-modal': 'true' })[name] ?? null,
    querySelector: () => null, querySelectorAll: selector => selector === 'button' ? [button] : [] };
  button.parentElement = dialog;
  const screen = { getBoundingClientRect: () => ({ width: 200, height: 100, left: 0, right: 200, bottom: 100 }) };
  const document = {
    get activeElement() { return focused; }, getElementById: () => root,
    elementFromPoint: (x, y) => modal && x >= 20 && x < 120 && y >= 20 && y < 50 ? button : null,
    querySelector(selector) {
      if (selector.includes('.xterm-helper-textarea')) return input;
      if (selector.includes('.xterm-screen')) return screen;
      if (selector.includes('[role="status"]') && inventoryRead && inventoryEffect === 'readonly') return {};
      return null;
    },
    querySelectorAll(selector) { return selector.includes('dialog') ? (modal ? [dialog] : []) : rows; }
  };
  const context = vm.createContext({ document, window: { __DSH_OFFICIAL_FILES__: { openTerminal() {} } },
    getComputedStyle: () => ({ visibility: 'visible', display: 'block', opacity: '1' }), innerWidth: 1024, innerHeight: 720 });
  const evaluate = async code => vm.runInContext(code, context);
  const waitFor = async code => {
    if (!await evaluate(code)) throw new Error(`fixture UI condition not met: ${code}`);
    if (modalBeforeReturn && code.includes('fixture-marker')) { modal = true; root.inert = true; focused = keyInput; }
  };
  const wc = { focus() { events.push('focus-contents'); }, isFocused: () => true,
    async insertText(text) {
      events.push('insert');
      if (focused !== input || root.inert || modal) credentialInputs++;
      else if (!(inventoryRead && inventoryEffect === 'drops-input')) {
        const filename = text.match(/writeFileSync\('([^']+)'/)[1];
        const marker = text.match(/marker:'([^']+)'/)[1];
        pending.set(opened, { filename, marker });
        rows.push({ textContent: text });
      }
    },
    sendInputEvent(event) {
      events.push(`key-${event.type}`);
      if (event.type !== 'keyDown' || focused !== input || root.inert || modal) return;
      const command = pending.get(opened);
      if (!command) return;
      pending.delete(opened);
      executed = true;
      executions.push({ ...command, terminal: opened });
      events.push(`execute-terminal-${opened}`);
      const receipt = { cwd: workspacePath, keyPresent: false, marker: command.marker };
      const failure = receiptFailure?.execution === executions.length ? receiptFailure.kind : null;
      if (failure === 'cwd') receipt.cwd = path.resolve('other-fixture-workspace');
      if (failure === 'key') receipt.keyPresent = true;
      if (failure === 'marker') receipt.marker = executions.at(-2)?.marker ?? 'stale-marker';
      if (failure !== 'missing') receipts.set(command.filename, receipt);
    },
    capturePage: async () => ({ toPNG: () => Buffer.from('fixture') })
  };
  const window = { webContents: wc, focus() { events.push('focus-window'); }, isFocused: () => true, setContentSize() {} };
  const workspacePath = path.resolve('fixture-workspace'), nodePath = path.resolve('vendor/runtime/win32-x64/node.exe');
  const realRequire = require;
  const fakeFs = {
    stat: async () => ({ isFile: () => true }), writeFile: async () => {},
    readFile: async (filename) => {
      const receipt = receipts.get(path.basename(filename));
      if (!receipt) throw Object.assign(new Error('not executed'), { code: 'ENOENT' });
      return JSON.stringify(receipt);
    }
  };
  let uuid = 0, now = 0;
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.resolve('electron/official-terminal-smoke.cjs'), 'utf8'), {
    module, exports: module.exports, Buffer, Date: { now: () => now }, Set,
    setTimeout: (callback, delay) => { now += delay; queueMicrotask(callback); },
    require(name) {
      if (name === 'node:fs/promises') return fakeFs;
      if (name === 'node:crypto') return { randomUUID: () => {
        uuid++;
        return `fixture-${uuid % 2 ? 'file' : 'marker'}-${Math.ceil(uuid / 2)}`;
      } };
      if (name === './extension-center.cjs') return { callHarnessRemote: async (_origin, _service, method, args) => {
        remoteCalls.push({ method, executions: executions.length });
        if (method === 'list') {
          events.push(`list-after-${executions.length}`);
          if (executions.length === 2) inventoryRead = true;
          return terminals.slice();
        }
        if (method === 'close') { terminals.splice(terminals.findIndex(item => item.id === args.id), 1); return; }
        throw new Error(`unexpected remote operation ${method}`);
      } };
      if (name.startsWith('./')) return realRequire(path.resolve('electron', name));
      return realRequire(name);
    }
  });
  const options = { window, selected: { sessionId: 'fixture-session' }, workspacePath, nodePath,
    origin: 'http://127.0.0.1:1', evaluate, waitFor, target: 'not-written', version: 'fixture',
    open: async () => {
      // Match rc.2 WebTerminalInfo: attachment control is not public metadata.
      terminals.push({ id: `terminal-${++opened}`, title: 'cmd', state: 'running',
        shell: { path: 'cmd.exe', name: 'cmd', args: [] }, cwd: workspacePath,
        cols: 80, rows: 24, exitCode: null });
      if (opened === 1 && duplicateFirstId) terminals.push({ ...terminals[0] });
      rows.splice(0, rows.length, { textContent: 'fixture>' });
      focused = null;
      return { ok: true };
    }
  };
  return { run: () => module.exports.runOfficialTerminalSmoke(options), events, executions, remoteCalls,
    get credentialInputs() { return credentialInputs; },
    get executed() { return executed; } };
}

test('terminal smoke dismisses official onboarding before native input and retains receipt checks', async () => {
  const f = fixture(), result = await f.run();
  assert.equal(result.ok, true);
  assert.equal(result.checks.nativeKeyboardExecutes, true);
  assert.equal(result.checks.workspaceBound, true);
  assert.equal(result.checks.keyNotInherited, true);
  assert.equal(Object.keys(result.checks).length, 8);
  assert.equal(Object.values(result.checks).every(Boolean), true);
  assert.deepEqual(f.executions.map(item => item.terminal), [1, 2, 2]);
  assert.equal(new Set(f.executions.map(item => item.filename)).size, 3);
  assert.equal(new Set(f.executions.map(item => item.marker)).size, 3);
  assert.equal(f.remoteCalls.filter(item => item.executions === 2 && item.method === 'list').length, 2);
  assert.equal(f.remoteCalls.every(item => ['list', 'close'].includes(item.method)), true);
  assert.equal(f.credentialInputs, 0);
  assert.ok(f.events.indexOf('configure-later') < f.events.indexOf('insert'));
  assert.ok(f.events.indexOf('focus-window') < f.events.indexOf('insert'));
  assert.ok(f.events.indexOf('focus-contents') < f.events.indexOf('insert'));
  assert.ok(f.events.indexOf('focus-input') < f.events.indexOf('insert'));
  assert.ok(f.events.indexOf('insert') < f.events.indexOf('key-keyDown'));
});

test('terminal smoke never inserts when the xterm textarea did not acquire focus', async () => {
  const f = fixture({ refuseFocus: true });
  await assert.rejects(f.run(), /input|focus|condition/i);
  assert.equal(f.events.includes('insert'), false);
  assert.equal(f.credentialInputs, 0);
  assert.equal(f.executed, false);
});

test('terminal smoke rechecks input ownership before Return if a modal takes focus after echo', async () => {
  const f = fixture({ modalBeforeReturn: true });
  await assert.rejects(f.run(), /input|focus|condition/i);
  assert.equal(f.events.includes('insert'), true);
  assert.equal(f.credentialInputs, 0);
  assert.equal(f.executed, false);
});

test('terminal smoke refuses ambiguous duplicate running terminal identities', async () => {
  const f = fixture({ duplicateFirstId: true });
  await assert.rejects(f.run(), /terminal metadata/);
  assert.equal(f.events.includes('insert'), false);
});

for (const inventoryEffect of ['readonly', 'drops-input']) {
  test(`terminal smoke detects ${inventoryEffect} after read-only inventory instead of comparing absent controller ids`, async () => {
    const f = fixture({ inventoryEffect });
    await assert.rejects(f.run(), /condition|input/i);
    assert.deepEqual(f.executions.map(item => item.terminal), [1, 2]);
    assert.equal(f.credentialInputs, 0);
    assert.equal(f.remoteCalls.every(item => ['list', 'close'].includes(item.method)), true);
  });
}

for (const kind of ['cwd', 'key', 'marker', 'missing']) {
  test(`terminal smoke rejects ${kind} failure in the independent post-inventory receipt`, async () => {
    const f = fixture({ receiptFailure: { execution: 3, kind } });
    await assert.rejects(f.run(), /second terminal after inventory/);
    assert.deepEqual(f.executions.map(item => item.terminal), [1, 2, 2]);
    assert.equal(f.credentialInputs, 0);
  });
}

test('terminal smoke must establish the second terminal is writable before the read-only inventory check', async () => {
  const f = fixture({ receiptFailure: { execution: 2, kind: 'marker' } });
  await assert.rejects(f.run(), /second terminal before inventory/);
  assert.deepEqual(f.executions.map(item => item.terminal), [1, 2]);
});
