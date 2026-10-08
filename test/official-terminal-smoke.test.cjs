const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

// Exercise the real smoke sequence against a public-DOM fixture, including the
// official onboarding helper. No Electron, Host, PTY, credential or disk write.
function fixture({ refuseFocus = false, modalBeforeReturn = false } = {}) {
  const events = [], rows = [{ textContent: 'fixture>' }], root = { inert: true };
  let modal = true, focused, opened = 0, executed = false, credentialInputs = 0;
  const terminals = [];
  const input = { disabled: false, readOnly: false,
    closest: () => root.inert ? root : null,
    focus() { events.push('focus-input'); if (!root.inert && !modal && !refuseFocus) focused = input; }
  };
  const keyInput = {}; focused = keyInput;
  const button = { textContent: '稍后配置', disabled: false,
    click() { events.push('configure-later'); modal = false; root.inert = false; focused = null; }
  };
  const dialog = { getClientRects: () => modal ? [{}] : [],
    getAttribute: () => '添加一个 API Key 开始使用', querySelectorAll: () => [button] };
  const screen = { getBoundingClientRect: () => ({ width: 200, height: 100, left: 0, right: 200, bottom: 100 }) };
  const document = {
    get activeElement() { return focused; }, getElementById: () => root,
    querySelector(selector) {
      if (selector.includes('.xterm-helper-textarea')) return input;
      if (selector.includes('.xterm-screen')) return screen;
      return null;
    },
    querySelectorAll(selector) { return selector.includes('dialog') ? (modal ? [dialog] : []) : rows; }
  };
  const context = vm.createContext({ document, window: { __DSH_OFFICIAL_FILES__: { openTerminal() {} } },
    getComputedStyle: () => ({ visibility: 'visible' }), innerWidth: 1024, innerHeight: 720 });
  const evaluate = async code => vm.runInContext(code, context);
  const waitFor = async code => {
    if (!await evaluate(code)) throw new Error(`fixture UI condition not met: ${code}`);
    if (modalBeforeReturn && code.includes('fixture-marker')) { modal = true; root.inert = true; focused = keyInput; }
  };
  const wc = { focus() { events.push('focus-contents'); }, isFocused: () => true,
    async insertText(text) {
      events.push('insert');
      if (focused !== input || root.inert || modal) credentialInputs++;
      else rows.push({ textContent: text });
    },
    sendInputEvent(event) { events.push(`key-${event.type}`); if (event.type === 'keyDown') executed = true; },
    capturePage: async () => ({ toPNG: () => Buffer.from('fixture') })
  };
  const window = { webContents: wc, focus() { events.push('focus-window'); }, isFocused: () => true, setContentSize() {} };
  const workspacePath = path.resolve('fixture-workspace'), nodePath = path.resolve('vendor/runtime/win32-x64/node.exe');
  const realRequire = require;
  const fakeFs = {
    stat: async () => ({ isFile: () => true }), writeFile: async () => {},
    readFile: async () => {
      if (!executed) throw Object.assign(new Error('not executed'), { code: 'ENOENT' });
      return JSON.stringify({ cwd: workspacePath, keyPresent: false, marker: 'fixture-marker' });
    }
  };
  let uuid = 0;
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.resolve('electron/official-terminal-smoke.cjs'), 'utf8'), {
    module, exports: module.exports, Buffer, Date, Set, setTimeout: (callback) => setTimeout(callback, 0),
    require(name) {
      if (name === 'node:fs/promises') return fakeFs;
      if (name === 'node:crypto') return { randomUUID: () => ++uuid === 1 ? 'fixture-file' : 'fixture-marker' };
      if (name === './extension-center.cjs') return { callHarnessRemote: async (_origin, _service, method, args) => {
        if (method === 'list') return terminals.slice();
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
      terminals.push({ id: `terminal-${++opened}`, state: 'running', controllerId: 'fixture-controller', shell: { path: 'cmd.exe' } });
      return { ok: true };
    }
  };
  return { run: () => module.exports.runOfficialTerminalSmoke(options), events, get credentialInputs() { return credentialInputs; },
    get executed() { return executed; } };
}

test('terminal smoke dismisses official onboarding before native input and retains receipt checks', async () => {
  const f = fixture(), result = await f.run();
  assert.equal(result.ok, true);
  assert.equal(result.checks.nativeKeyboardExecutes, true);
  assert.equal(result.checks.workspaceBound, true);
  assert.equal(result.checks.keyNotInherited, true);
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
