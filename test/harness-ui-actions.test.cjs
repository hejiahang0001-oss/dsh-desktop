const assert = require('node:assert/strict');
const test = require('node:test');
const {
  ACTION_LABELS,
  PERMISSION_MODES,
  PLAN_MODES,
  POWERSHELL_COMPATIBILITY_STATES,
  SUPPORTED_ACTIONS,
  SUPPORTED_COMMAND_ACTIONS,
  TEST_STATES,
  TOOL_KINDS,
  TOOL_STATES,
  classifyAgentSignals,
  getHarnessAgentStateScript,
  getHarnessCommandPreparationScript,
  getHarnessUiActionScript,
  invokeHarnessCommandAction,
  invokeHarnessUiAction,
  isAgentActionSettled,
  readHarnessAgentState
} = require('../electron/harness-ui-actions.cjs');

const NO_TOOL_STATE = {
  toolCount: 0,
  activeToolCount: 0,
  failedToolCount: 0,
  stoppedToolCount: 0,
  latestToolState: 'none',
  latestToolKind: 'none',
  canFocusTool: false,
  canOpenTrajectory: false,
  testCount: 0,
  latestTestState: 'none',
  latestTestExitCode: null,
  permissionMode: 'unknown',
  canOpenPermission: false,
  planMode: 'unavailable',
  canEnterPlan: false,
  canExitPlan: false,
  powerShellCompatibility: 'unknown',
  diffCount: 0,
  producedPaths: [],
  latestProducedPath: '',
  canFocusChange: false
};

test('Harness UI actions are fixed to rc.8 bilingual labels', () => {
  assert.deepEqual(ACTION_LABELS['new-session'], ['新建会话', 'New session']);
  assert.deepEqual(ACTION_LABELS['search-sessions'], ['搜索会话', 'Search sessions']);
  assert.deepEqual(ACTION_LABELS['stop-agent'], ['停止生成', 'Stop generating']);
  assert.deepEqual(ACTION_LABELS['steer-queued'], ['插话发送', 'Steer queued message']);
  assert.deepEqual(ACTION_LABELS.trajectory, ['轨迹', 'Trajectory']);
  assert.deepEqual(ACTION_LABELS['permission-mode'], ['访问模式', 'Access mode']);
  assert.deepEqual(ACTION_LABELS['plan-mode-on'], ['plan mode 已开启，按下关闭', 'Plan mode on, press to turn off']);
  assert.match(getHarnessUiActionScript('models-settings'), /Models/);
  assert.throws(() => getHarnessUiActionScript('arbitrary-script'), /Unsupported/);
});

test('Agent UI actions remain a fixed whitelist with no arbitrary script input', () => {
  assert.ok(SUPPORTED_ACTIONS.includes('stop-agent'));
  assert.ok(SUPPORTED_ACTIONS.includes('focus-agent-input'));
  assert.ok(SUPPORTED_ACTIONS.includes('steer-queued'));
  assert.ok(SUPPORTED_ACTIONS.includes('focus-pending'));
  assert.ok(SUPPORTED_ACTIONS.includes('focus-latest-tool'));
  assert.ok(SUPPORTED_ACTIONS.includes('focus-latest-change'));
  assert.ok(SUPPORTED_ACTIONS.includes('open-trajectory'));
  assert.ok(SUPPORTED_ACTIONS.includes('open-permission-mode'));
  assert.ok(SUPPORTED_ACTIONS.includes('exit-plan-mode'));
  assert.deepEqual(SUPPORTED_COMMAND_ACTIONS, ['enter-plan-mode']);
  assert.match(getHarnessUiActionScript('stop-agent'), /Stop generating/);
  assert.match(getHarnessUiActionScript('focus-agent-input'), /data-composer-card/);
  assert.match(getHarnessUiActionScript('steer-queued'), /Steer queued message/);
  assert.match(getHarnessUiActionScript('focus-pending'), /data-approval-key/);
  assert.match(getHarnessUiActionScript('focus-latest-tool'), /data-tool/);
  assert.match(getHarnessUiActionScript('focus-latest-tool'), /data-kind/);
  assert.match(getHarnessUiActionScript('focus-latest-change'), /data-diff/);
  assert.match(getHarnessUiActionScript('focus-latest-change'), /data-produced-files-row/);
  assert.match(getHarnessUiActionScript('open-trajectory'), /Trajectory/);
  assert.match(getHarnessUiActionScript('open-permission-mode'), /Access mode/);
  assert.match(getHarnessUiActionScript('exit-plan-mode'), /plan-mode-on/);
});

test('Agent state classifier gives pending confirmation precedence over running', () => {
  assert.deepEqual(classifyAgentSignals({ canStop: true, pendingCount: 1, steerCount: 2, hasComposer: true }), {
    status: 'waiting',
    canStop: true,
    canSteer: true,
    canFocusInput: true,
    canFocusPending: true,
    pendingCount: 1,
    queuedCount: 2,
    ...NO_TOOL_STATE
  });
});

test('Agent state classifier reports running, ready, and unavailable safely', () => {
  assert.equal(classifyAgentSignals({ canStop: true }).status, 'running');
  assert.equal(classifyAgentSignals({ hasComposer: true }).status, 'ready');
  assert.equal(classifyAgentSignals().status, 'unavailable');
  assert.equal(classifyAgentSignals({ pendingCount: -1, steerCount: 1.5 }).queuedCount, 0);
});

test('Tool and test signals are bounded and normalized before reaching desktop state', () => {
  assert.deepEqual(TOOL_STATES, ['none', 'running', 'ok', 'error', 'stopped']);
  assert.ok(TOOL_KINDS.includes('command'));
  assert.ok(TEST_STATES.includes('passed'));
  assert.deepEqual(PERMISSION_MODES, ['unknown', 'read-only', 'workspace-write', 'danger-full-access']);
  assert.deepEqual(POWERSHELL_COMPATIBILITY_STATES, ['unknown', 'sandbox-crash']);
  assert.deepEqual(PLAN_MODES, ['unavailable', 'off', 'on']);
  const state = classifyAgentSignals({
    hasComposer: true,
    toolCount: 3,
    activeToolCount: 7,
    failedToolCount: 1,
    stoppedToolCount: -1,
    latestToolState: 'running',
    latestToolKind: 'command',
    canFocusTool: true,
    canOpenTrajectory: true,
    testCount: 1,
    latestTestState: 'failed',
    latestTestExitCode: 2,
    permissionMode: 'workspace-write',
    canOpenPermission: true,
    planMode: 'off',
    canExitPlan: false,
    diffCount: 2,
    producedPaths: ['src/first.js', 'src/latest.js'],
    canFocusChange: true
  });
  assert.deepEqual(state, {
    status: 'ready',
    canStop: false,
    canSteer: false,
    canFocusInput: true,
    canFocusPending: false,
    pendingCount: 0,
    queuedCount: 0,
    toolCount: 3,
    activeToolCount: 3,
    failedToolCount: 1,
    stoppedToolCount: 0,
    latestToolState: 'running',
    latestToolKind: 'command',
    canFocusTool: true,
    canOpenTrajectory: true,
    testCount: 1,
    latestTestState: 'failed',
    latestTestExitCode: 2,
    permissionMode: 'workspace-write',
    canOpenPermission: true,
    planMode: 'off',
    canEnterPlan: true,
    canExitPlan: false,
    powerShellCompatibility: 'unknown',
    diffCount: 2,
    producedPaths: ['src/first.js', 'src/latest.js'],
    latestProducedPath: 'src/latest.js',
    canFocusChange: true
  });
  assert.equal(classifyAgentSignals({ toolCount: 1, latestToolState: 'forged', latestToolKind: 'shell-script' }).latestToolKind, 'none');
  assert.equal(classifyAgentSignals({ toolCount: 1, testCount: 1, latestTestState: 'failed', latestTestExitCode: 3221225477 }).latestTestExitCode, 3221225477);
  assert.equal(classifyAgentSignals({ toolCount: 1, testCount: 1, latestTestState: 'failed', latestTestExitCode: 3221225477, permissionMode: 'workspace-write' }).powerShellCompatibility, 'sandbox-crash');
  assert.equal(classifyAgentSignals({ toolCount: 1, testCount: 1, latestTestState: 'failed', latestTestExitCode: 3221225477, permissionMode: 'danger-full-access' }).powerShellCompatibility, 'unknown');
  assert.equal(classifyAgentSignals({ permissionMode: 'forged', canOpenPermission: 1 }).permissionMode, 'unknown');
  assert.equal(classifyAgentSignals({ planMode: 'forged', canExitPlan: true }).planMode, 'unavailable');
  assert.equal(classifyAgentSignals({ hasComposer: true, planMode: 'off' }).canEnterPlan, true);
  assert.equal(classifyAgentSignals({ hasComposer: true, canStop: true, planMode: 'off' }).canEnterPlan, false);
  assert.equal(classifyAgentSignals({ hasComposer: true, planMode: 'on', canExitPlan: true }).canExitPlan, true);
  assert.equal(classifyAgentSignals({ toolCount: 1, testCount: 1, latestTestState: 'failed', latestTestExitCode: 9999999999 }).latestTestExitCode, null);
});

test('State-dependent Agent actions treat a completed race as settled', () => {
  assert.equal(isAgentActionSettled('stop-agent', { canStop: false }), true);
  assert.equal(isAgentActionSettled('stop-agent', { canStop: true }), false);
  assert.equal(isAgentActionSettled('steer-queued', { canSteer: false }), true);
  assert.equal(isAgentActionSettled('focus-pending', { canFocusPending: false }), true);
  assert.equal(isAgentActionSettled('focus-agent-input', { canFocusInput: false }), false);
  assert.equal(isAgentActionSettled('exit-plan-mode', { planMode: 'off' }), true);
});

test('Agent state script returns only bounded UI signals', () => {
  const script = getHarnessAgentStateScript();
  assert.match(script, /canStop/);
  assert.match(script, /pendingCount/);
  assert.match(script, /steerCount/);
  assert.match(script, /hasComposer/);
  assert.match(script, /data-tool/);
  assert.match(script, /data-kind/);
  assert.match(script, /aria-label/);
  assert.match(script, /latestTestState/);
  assert.match(script, /hasAttribute\(name\)/);
  assert.match(script, /exit\[ _-\]\?code/);
  assert.match(script, /node.*--test/);
  assert.match(script, /permissionMode/);
  assert.match(script, /planMode/);
  assert.match(script, /plan-mode-on/);
  assert.match(script, /workspace\\s\*write/i);
  assert.match(script, /0xC0000005/);
  assert.match(script, /data-diff/);
  assert.match(script, /data-produced-files-row/);
  assert.match(script, /slice\(-20000\)/);
  assert.doesNotMatch(script, /innerHTML/);
  assert.doesNotMatch(script, /outerHTML/);
});

test('Collapsed failed PowerShell card recovers the exact Windows crash code from bounded page text', () => {
  const attributes = new Map([
    ['data-tool', 'pwsh'],
    ['data-state', 'error']
  ]);
  const row = {
    textContent: 'Run read-only DSH verification test',
    getAttribute: (name) => attributes.has(name) ? attributes.get(name) : null,
    hasAttribute: (name) => attributes.has(name)
  };
  const document = {
    body: { textContent: 'The command exited with code 3221225477 (0xC0000005, access violation).' },
    querySelector: () => null,
    querySelectorAll: (selector) => {
      if (selector === '[data-tool][data-state], [data-sample="bash"][data-state]') return [row];
      if (selector === 'button, [role="button"], [role="tab"]') return [{
        disabled: false,
        textContent: '',
        getAttribute: (name) => name === 'aria-label' ? '访问模式，当前：Workspace Write' : null
      }];
      return [];
    }
  };
  const result = Function('document', 'return ' + getHarnessAgentStateScript())(document);
  assert.equal(result.latestTestState, 'failed');
  assert.equal(result.latestTestExitCode, 3221225477);
  assert.equal(result.permissionMode, 'workspace-write');
  assert.equal(result.planMode, 'unavailable');
  assert.equal(classifyAgentSignals(result).powerShellCompatibility, 'sandbox-crash');
});

test('Trajectory fallback preserves a Windows tool failure and unsigned exit code', () => {
  const attributes = new Map([
    ['data-kind', 'tool'],
    ['aria-label', 'TOOL pwsh']
  ]);
  const row = {
    textContent: '{"cmd":"run DSH test ' + 'x'.repeat(400) + '","no_output":true,"exit_code":3221225477}',
    getAttribute: (name) => attributes.has(name) ? attributes.get(name) : null,
    hasAttribute: (name) => attributes.has(name)
  };
  const document = {
    querySelector: () => null,
    querySelectorAll: (selector) => {
      if (selector === 'tr[data-kind="tool"], tr[data-kind="subtool"]') return [row];
      if (selector === 'button, [role="button"], [role="tab"]') return [{
        disabled: false,
        textContent: '',
        getAttribute: (name) => name === 'aria-label' ? '访问模式，当前：Workspace Write' : null
      }];
      return [];
    }
  };
  const result = Function('document', 'return ' + getHarnessAgentStateScript())(document);
  assert.equal(result.toolCount, 1);
  assert.equal(result.failedToolCount, 1);
  assert.equal(result.latestToolState, 'error');
  assert.equal(result.latestToolKind, 'command');
  assert.equal(result.testCount, 1);
  assert.equal(result.latestTestState, 'failed');
  assert.equal(result.latestTestExitCode, 3221225477);
  assert.equal(result.permissionMode, 'workspace-write');
  assert.equal(result.canOpenPermission, true);
  assert.equal(result.planMode, 'unavailable');
});

test('Official Diff and produced-file markers expose a bounded latest change path', () => {
  const makeElement = (attributes = {}, textContent = '') => ({
    disabled: false,
    textContent,
    getAttribute: (name) => attributes[name] ?? null,
    hasAttribute: (name) => Object.hasOwn(attributes, name)
  });
  const document = {
    body: { textContent: '' },
    querySelector: () => null,
    querySelectorAll: (selector) => {
      if (selector === '[data-diff]') return [makeElement(), makeElement()];
      if (selector === '[data-produced-files-row] button[title]') {
        return [
          makeElement({ title: 'src/first.js' }),
          makeElement({ title: 'src/latest.js' })
        ];
      }
      return [];
    }
  };
  const signals = Function('document', 'return ' + getHarnessAgentStateScript())(document);
  const state = classifyAgentSignals(signals);
  assert.equal(state.diffCount, 2);
  assert.deepEqual(state.producedPaths, ['src/first.js', 'src/latest.js']);
  assert.equal(state.latestProducedPath, 'src/latest.js');
  assert.equal(state.canFocusChange, true);
});

test('Plan mode signals use the official rc.8 chip and never infer from page copy', () => {
  const planButton = {
    disabled: false,
    textContent: 'Plan',
    getAttribute: (name) => name === 'aria-label' ? 'Plan mode on, press to turn off' : null,
    hasAttribute: () => false
  };
  const composer = { disabled: false };
  const document = {
    body: { textContent: 'Plan mode may be mentioned in conversation text.' },
    querySelector: (selector) => selector === '[data-composer-card] textarea:not([disabled])' ? composer : null,
    querySelectorAll: (selector) => selector === 'button, [role="button"], [role="tab"]' || selector === 'button, [role="button"]'
      ? [planButton]
      : []
  };
  const state = classifyAgentSignals(Function('document', 'return ' + getHarnessAgentStateScript())(document));
  assert.equal(state.planMode, 'on');
  assert.equal(state.canEnterPlan, false);
  assert.equal(state.canExitPlan, true);
});

test('Plan command action refuses drafts and submits only the fixed slash command', async () => {
  assert.match(getHarnessCommandPreparationScript('enter-plan-mode'), /composer-has-draft/);
  assert.throws(() => getHarnessCommandPreparationScript('arbitrary-command'), /Unsupported/);
  const calls = [];
  const webContents = {
    executeJavaScript: async (script, userGesture) => {
      calls.push(['script', script, userGesture]);
      return { ready: true, reason: 'ready' };
    },
    insertText: async (value) => calls.push(['text', value]),
    sendInputEvent: (event) => calls.push(['input', event])
  };
  assert.deepEqual(await invokeHarnessCommandAction(webContents, 'enter-plan-mode'), { ok: true, reason: 'submitted' });
  assert.deepEqual(calls.slice(1), [
    ['text', '/plan'],
    ['input', { type: 'keyDown', keyCode: 'ENTER' }],
    ['input', { type: 'keyUp', keyCode: 'ENTER' }],
    ['input', { type: 'keyDown', keyCode: 'ENTER' }],
    ['input', { type: 'keyUp', keyCode: 'ENTER' }]
  ]);
  webContents.executeJavaScript = async () => ({ ready: false, reason: 'composer-has-draft' });
  assert.deepEqual(await invokeHarnessCommandAction(webContents, 'enter-plan-mode'), { ok: false, reason: 'composer-has-draft' });
});

test('Harness UI action execution uses an isolated generated script', async () => {
  const calls = [];
  const webContents = {
    executeJavaScript: async (...args) => {
      calls.push(args);
      return true;
    }
  };
  assert.equal(await invokeHarnessUiAction(webContents, 'new-session'), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], true);
  assert.match(calls[0][0], /new-session/);
  assert.equal(await invokeHarnessUiAction(null, 'new-session'), false);
});

test('Agent state reader classifies isolated browser signals', async () => {
  const calls = [];
  const webContents = {
    executeJavaScript: async (...args) => {
      calls.push(args);
      return {
        canStop: true,
        pendingCount: 0,
        steerCount: 1,
        hasComposer: true,
        toolCount: 2,
        activeToolCount: 1,
        failedToolCount: 0,
        stoppedToolCount: 0,
        latestToolState: 'running',
        latestToolKind: 'command',
        canFocusTool: true,
        canOpenTrajectory: true,
        testCount: 1,
        latestTestState: 'running',
        latestTestExitCode: null,
        permissionMode: 'workspace-write',
        canOpenPermission: true,
        planMode: 'off',
        canExitPlan: false,
        diffCount: 1,
        producedPaths: ['src/latest.js'],
        canFocusChange: true
      };
    }
  };
  assert.deepEqual(await readHarnessAgentState(webContents), {
    status: 'running',
    canStop: true,
    canSteer: true,
    canFocusInput: true,
    canFocusPending: false,
    pendingCount: 0,
    queuedCount: 1,
    toolCount: 2,
    activeToolCount: 1,
    failedToolCount: 0,
    stoppedToolCount: 0,
    latestToolState: 'running',
    latestToolKind: 'command',
    canFocusTool: true,
    canOpenTrajectory: true,
    testCount: 1,
    latestTestState: 'running',
    latestTestExitCode: null,
    permissionMode: 'workspace-write',
    canOpenPermission: true,
    planMode: 'off',
    canEnterPlan: false,
    canExitPlan: false,
    powerShellCompatibility: 'unknown',
    diffCount: 1,
    producedPaths: ['src/latest.js'],
    latestProducedPath: 'src/latest.js',
    canFocusChange: true
  });
  assert.equal(calls[0][1], true);
  assert.equal((await readHarnessAgentState(null)).status, 'unavailable');
});
