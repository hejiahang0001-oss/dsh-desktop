const ACTION_LABELS = Object.freeze({
  'new-session': Object.freeze(['新建会话', 'New session']),
  'search-sessions': Object.freeze(['搜索会话', 'Search sessions']),
  'open-sidebar': Object.freeze(['打开侧边栏', 'Open sidebar']),
  settings: Object.freeze(['设置', 'Settings']),
  models: Object.freeze(['模型', 'Models']),
  'stop-agent': Object.freeze(['停止生成', 'Stop generating']),
  'steer-queued': Object.freeze(['插话发送', 'Steer queued message']),
  'permission-mode': Object.freeze(['访问模式', 'Access mode']),
  trajectory: Object.freeze(['轨迹', 'Trajectory']),
  'pending-state': Object.freeze(['等待审批', 'Waiting for approval', '等待回答', 'waiting']),
  'pending-control': Object.freeze(['允许一次', 'Allow once', '拒绝', 'Reject'])
});

const SUPPORTED_ACTIONS = Object.freeze([
  'new-session',
  'search-sessions',
  'focus-session-list',
  'models-settings',
  'stop-agent',
  'focus-agent-input',
  'steer-queued',
  'focus-pending',
  'open-permission-mode',
  'focus-latest-tool',
  'focus-latest-change',
  'open-trajectory'
]);

const TOOL_STATES = Object.freeze(['none', 'running', 'ok', 'error', 'stopped']);
const TOOL_KINDS = Object.freeze(['none', 'read', 'search', 'write', 'edit', 'command', 'code', 'web', 'skill', 'task', 'other']);
const TEST_STATES = Object.freeze(['none', 'running', 'passed', 'failed', 'stopped']);
const PERMISSION_MODES = Object.freeze(['unknown', 'read-only', 'workspace-write', 'danger-full-access']);
const POWERSHELL_COMPATIBILITY_STATES = Object.freeze(['unknown', 'sandbox-crash']);

const safeCount = (value) => (Number.isSafeInteger(value) && value > 0 ? value : 0);

const classifyAgentSignals = ({
  canStop = false,
  pendingCount = 0,
  steerCount = 0,
  hasComposer = false,
  toolCount = 0,
  activeToolCount = 0,
  failedToolCount = 0,
  stoppedToolCount = 0,
  latestToolState = 'none',
  latestToolKind = 'none',
  canFocusTool = false,
  canOpenTrajectory = false,
  testCount = 0,
  latestTestState = 'none',
  latestTestExitCode = null,
  permissionMode = 'unknown',
  canOpenPermission = false,
  diffCount = 0,
  producedPaths = [],
  canFocusChange = false
} = {}) => {
  const safePendingCount = Number.isSafeInteger(pendingCount) && pendingCount > 0 ? pendingCount : 0;
  const safeSteerCount = Number.isSafeInteger(steerCount) && steerCount > 0 ? steerCount : 0;
  const safeToolCount = safeCount(toolCount);
  const safeActiveToolCount = Math.min(safeToolCount, safeCount(activeToolCount));
  const safeFailedToolCount = Math.min(safeToolCount, safeCount(failedToolCount));
  const safeStoppedToolCount = Math.min(safeToolCount, safeCount(stoppedToolCount));
  const safeTestCount = Math.min(safeToolCount, safeCount(testCount));
  const safeLatestToolState = safeToolCount > 0 && TOOL_STATES.includes(latestToolState) ? latestToolState : 'none';
  const safeLatestToolKind = safeToolCount > 0 && TOOL_KINDS.includes(latestToolKind) ? latestToolKind : 'none';
  const safeLatestTestState = safeTestCount > 0 && TEST_STATES.includes(latestTestState) ? latestTestState : 'none';
  const safeLatestTestExitCode = safeLatestTestState !== 'none'
    && Number.isSafeInteger(latestTestExitCode)
    && latestTestExitCode >= -2147483648
    && latestTestExitCode <= 4294967295
    ? latestTestExitCode
    : null;
  const safePermissionMode = PERMISSION_MODES.includes(permissionMode) ? permissionMode : 'unknown';
  const safeDiffCount = safeCount(diffCount);
  const safeProducedPaths = Array.isArray(producedPaths)
    ? [...new Set(producedPaths
      .filter((value) => typeof value === 'string' && value.length > 0 && value.length <= 2048 && !value.includes('\0'))
      .slice(-20))]
    : [];
  const powerShellCompatibility = safeLatestTestState === 'failed'
    && safeLatestTestExitCode === 3221225477
    && ['read-only', 'workspace-write'].includes(safePermissionMode)
    ? 'sandbox-crash'
    : 'unknown';
  const status = safePendingCount > 0
    ? 'waiting'
    : canStop
      ? 'running'
      : hasComposer
        ? 'ready'
        : 'unavailable';
  return Object.freeze({
    status,
    canStop: Boolean(canStop),
    canSteer: safeSteerCount > 0,
    canFocusInput: Boolean(hasComposer),
    canFocusPending: safePendingCount > 0,
    pendingCount: safePendingCount,
    queuedCount: safeSteerCount,
    toolCount: safeToolCount,
    activeToolCount: safeActiveToolCount,
    failedToolCount: safeFailedToolCount,
    stoppedToolCount: safeStoppedToolCount,
    latestToolState: safeLatestToolState,
    latestToolKind: safeLatestToolKind,
    canFocusTool: Boolean(canFocusTool) && safeToolCount > 0,
    canOpenTrajectory: Boolean(canOpenTrajectory),
    testCount: safeTestCount,
    latestTestState: safeLatestTestState,
    latestTestExitCode: safeLatestTestExitCode,
    permissionMode: safePermissionMode,
    canOpenPermission: Boolean(canOpenPermission),
    powerShellCompatibility,
    diffCount: safeDiffCount,
    producedPaths: Object.freeze(safeProducedPaths),
    latestProducedPath: safeProducedPaths.at(-1) || '',
    canFocusChange: Boolean(canFocusChange) && (safeDiffCount > 0 || safeProducedPaths.length > 0)
  });
};

const isAgentActionSettled = (action, state = {}) => (
  (action === 'stop-agent' && !state.canStop)
  || (action === 'steer-queued' && !state.canSteer)
  || (action === 'focus-pending' && !state.canFocusPending)
  || (action === 'focus-latest-change' && !state.canFocusChange)
);

const getHarnessUiActionScript = (action) => {
  if (!SUPPORTED_ACTIONS.includes(action)) {
    throw new Error(`Unsupported Harness UI action: ${action}`);
  }
  const labels = JSON.stringify(ACTION_LABELS);
  const requestedAction = JSON.stringify(action);
  return `(async () => {
    const labels = ${labels};
    const action = ${requestedAction};
    const controls = () => Array.from(document.querySelectorAll('button, [role="button"], [role="tab"]'));
    const normalized = (element) => (element.getAttribute('aria-label') || element.textContent || '').trim();
    const findControl = (accepted) => controls().find((element) => accepted.includes(normalized(element)));
    const findControlStartingWith = (accepted) => controls().find((element) => accepted.some((label) => normalized(element).startsWith(label)));
    const activate = (accepted) => {
      const element = findControl(accepted);
      if (!element || element.disabled) return false;
      element.click();
      element.focus({ preventScroll: true });
      return true;
    };
    const waitForControl = async (accepted) => {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const element = findControl(accepted);
        if (element) return element;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return null;
    };
    const toolRows = () => Array.from(document.querySelectorAll('[data-tool][data-state], [data-sample="bash"][data-state], tr[data-kind="tool"], tr[data-kind="subtool"]'));
    const latestToolRow = () => {
      const rows = toolRows();
      return rows.filter((element) => element.getAttribute('data-state') === 'running' || element.getAttribute('data-running') === 'true').at(-1) ?? rows.at(-1) ?? null;
    };
    if (action === 'stop-agent') return activate(labels['stop-agent']);
    if (action === 'focus-agent-input') {
      const input = document.querySelector('[data-composer-card] textarea:not([disabled])');
      if (!input) return false;
      input.focus({ preventScroll: true });
      return true;
    }
    if (action === 'steer-queued') return activate(labels['steer-queued']);
    if (action === 'open-permission-mode') {
      const element = findControlStartingWith(labels['permission-mode']);
      if (!element || element.disabled || element.getAttribute('aria-disabled') === 'true') return false;
      element.click();
      element.focus({ preventScroll: true });
      return true;
    }
    if (action === 'focus-pending') {
      const approval = document.querySelector('[data-approval-key] button:not([disabled])');
      if (approval) {
        approval.focus({ preventScroll: true });
        return true;
      }
      const marker = controls().find((element) => labels['pending-state'].includes(normalized(element)))
        || Array.from(document.querySelectorAll('span, div')).find((element) => labels['pending-state'].includes(normalized(element)));
      let container = marker;
      for (let depth = 0; container && depth < 6; depth += 1, container = container.parentElement) {
        const pendingControl = container.querySelector?.('button:not([disabled]), [role="button"]:not([aria-disabled="true"])');
        if (pendingControl) {
          pendingControl.focus({ preventScroll: true });
          return true;
        }
      }
      return false;
    }
    if (action === 'focus-latest-tool') {
      const row = latestToolRow();
      if (!row) return false;
      row.scrollIntoView({ block: 'center', inline: 'nearest' });
      if (!row.hasAttribute('tabindex')) row.setAttribute('tabindex', '-1');
      row.focus({ preventScroll: true });
      return true;
    }
    if (action === 'focus-latest-change') {
      const diffs = Array.from(document.querySelectorAll('[data-diff]'));
      const diff = diffs.at(-1) || null;
      if (diff) {
        diff.scrollIntoView({ block: 'center', inline: 'nearest' });
        if (!diff.hasAttribute('tabindex')) diff.setAttribute('tabindex', '-1');
        diff.focus({ preventScroll: true });
        return true;
      }
      const produced = Array.from(document.querySelectorAll('[data-produced-files-row] button[title]')).at(-1) || null;
      if (!produced || produced.disabled) return false;
      produced.scrollIntoView({ block: 'center', inline: 'nearest' });
      produced.focus({ preventScroll: true });
      return true;
    }
    if (action === 'open-trajectory') return activate(labels.trajectory);
    if (action === 'new-session') return activate(labels['new-session']);
    if (action === 'search-sessions') {
      activate(labels['open-sidebar']);
      const search = await waitForControl(labels['search-sessions']);
      if (!search || search.disabled) return false;
      search.click();
      search.focus({ preventScroll: true });
      return true;
    }
    if (action === 'focus-session-list') {
      activate(labels['open-sidebar']);
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const tree = document.querySelector('[role="tree"][aria-label="会话"], [role="tree"][aria-label="Sessions"]');
        if (tree) {
          tree.setAttribute('tabindex', '-1');
          tree.focus({ preventScroll: true });
          return true;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return false;
    }
    if (!activate(labels.settings)) return false;
    const models = await waitForControl(labels.models);
    if (!models || models.disabled) return false;
    models.click();
    models.focus({ preventScroll: true });
    return true;
  })()`;
};

const getHarnessAgentStateScript = () => {
  const labels = JSON.stringify(ACTION_LABELS);
  return `(() => {
    const labels = ${labels};
    const controls = Array.from(document.querySelectorAll('button, [role="button"]'));
    const allControls = Array.from(document.querySelectorAll('button, [role="button"], [role="tab"]'));
    const normalized = (element) => (element.getAttribute('aria-label') || element.textContent || '').trim();
    const enabled = (element) => !element.disabled && element.getAttribute('aria-disabled') !== 'true';
    const matches = (element, accepted) => accepted.includes(normalized(element));
    const canStop = controls.some((element) => enabled(element) && matches(element, labels['stop-agent']));
    const steerCount = controls.filter((element) => enabled(element) && matches(element, labels['steer-queued'])).length;
    const approvalCount = document.querySelectorAll('[data-approval-key]').length;
    const waitingMarkerCount = Array.from(document.querySelectorAll('span, div'))
      .filter((element) => labels['pending-state'].includes(normalized(element))).length;
    const pendingCount = Math.max(approvalCount, waitingMarkerCount);
    const hasComposer = Boolean(document.querySelector('[data-composer-card] textarea:not([disabled])'));
    const permissionControl = allControls.find((element) => labels['permission-mode'].some((label) => normalized(element).startsWith(label))) || null;
    const permissionText = permissionControl ? normalized(permissionControl) : '';
    const permissionMode = /(?:workspace\\s*write|工作区写入)/i.test(permissionText) ? 'workspace-write'
      : /(?:danger(?:ous)?\\s*full\\s*access|full\\s*access|完全访问)/i.test(permissionText) ? 'danger-full-access'
        : /(?:read[ -]?only|只读)/i.test(permissionText) ? 'read-only'
          : 'unknown';
    const acceptedStates = new Set(['running', 'ok', 'error', 'stopped']);
    const toolKind = (element, text = '') => {
      const explicit = element.getAttribute('data-tool') || (element.getAttribute('data-sample') === 'bash' ? 'shell' : '');
      const name = explicit.toLowerCase();
      if (['read', 'cordis_package_inspect', 'cordis_runtime_inspect'].includes(name)) return 'read';
      if (['grep', 'glob'].includes(name)) return 'search';
      if (name === 'write') return 'write';
      if (name === 'edit') return 'edit';
      if (['bash', 'pwsh', 'shell'].includes(name)) return 'command';
      if (name === 'run_code') return 'code';
      if (['web_fetch', 'web_search'].includes(name)) return 'web';
      if (name === 'skill') return 'skill';
      if (['todo', 'goal'].includes(name)) return 'task';
      if (/\\b(?:pwsh|bash)\\b/i.test(text)) return 'command';
      if (/\\b(?:grep|glob)\\b/i.test(text)) return 'search';
      if (/\\bread\\b/i.test(text)) return 'read';
      if (/\\bwrite\\b/i.test(text)) return 'write';
      if (/\\bedit\\b/i.test(text)) return 'edit';
      if (/\\brun_code\\b/i.test(text)) return 'code';
      if (/\\bweb_(?:fetch|search)\\b/i.test(text)) return 'web';
      if (/\\bskill\\b/i.test(text)) return 'skill';
      return 'other';
    };
    const conversationRows = Array.from(document.querySelectorAll('[data-tool][data-state], [data-sample="bash"][data-state]'));
    const trajectoryRows = Array.from(document.querySelectorAll('tr[data-kind="tool"], tr[data-kind="subtool"]'));
    const sourceRows = conversationRows.length > 0 ? conversationRows : trajectoryRows;
    const activeDataFlag = (element, name) => element.hasAttribute(name) && element.getAttribute(name) !== 'false';
    const parseExitCode = (text) => {
      const match = text.match(/(?:退出码|exit[ _-]?code)["']?\\s*[:：=]?\\s*(-?\\d+)/i);
      if (!match) return null;
      const value = Number(match[1]);
      return Number.isSafeInteger(value) && value >= -2147483648 && value <= 4294967295 ? value : null;
    };
    const rows = sourceRows.map((element) => {
      const rawText = ((element.getAttribute('aria-label') || '') + ' ' + (element.textContent || '')).replace(/\\s+/g, ' ').trim();
      const text = rawText.length <= 320 ? rawText : rawText.slice(0, 160) + ' ' + rawText.slice(-160);
      const explicitState = element.getAttribute('data-state');
      const exitCode = parseExitCode(text);
      const state = acceptedStates.has(explicitState) ? explicitState
        : activeDataFlag(element, 'data-running') ? 'running'
          : activeDataFlag(element, 'data-error') ? 'error'
            : exitCode === null ? 'ok'
              : exitCode === 0 ? 'ok' : 'error';
      return { element, state, kind: toolKind(element, text), text, exitCode };
    });
    const runningRows = rows.filter((row) => row.state === 'running');
    const latest = runningRows.at(-1) || rows.at(-1) || null;
    const testPattern = /(?:测试|\\btest(?:s|ing)?\\b|\\b(?:npm|pnpm|yarn|bun)\\s+(?:run\\s+)?test\\b|\\b(?:npx\\s+)?(?:vitest|jest|mocha|ava)\\b|\\bpytest\\b|\\bpython(?:\\.exe)?\\s+-m\\s+pytest\\b|\\bdotnet\\s+test\\b|\\bcargo\\s+test\\b|\\bgo\\s+test\\b|\\bmvnw?(?:\\.cmd)?\\s+test\\b|\\bgradlew?(?:\\.bat)?\\s+test\\b|\\bctest\\b|\\bnode(?:\\.exe)?\\s+--test\\b)/i;
    const testRows = rows.filter((row) => row.kind === 'command' && testPattern.test(row.text));
    const latestTest = testRows.at(-1) || null;
    const boundedPageText = (document.body?.textContent || '').slice(-20000);
    const pageCrashExitCode = /(?:0xC0000005|3221225477)/i.test(boundedPageText) ? 3221225477 : null;
    const exitCode = latestTest?.exitCode ?? (latestTest?.state === 'error' ? pageCrashExitCode : null);
    const latestTestState = latestTest === null ? 'none'
      : latestTest.state === 'ok' ? 'passed'
        : latestTest.state === 'error' ? 'failed'
          : latestTest.state;
    const diffCount = document.querySelectorAll('[data-diff]').length;
    const producedPaths = Array.from(document.querySelectorAll('[data-produced-files-row] button[title]'))
      .map((element) => (element.getAttribute('title') || '').trim())
      .filter((value) => value.length > 0 && value.length <= 2048)
      .slice(-20);
    const canOpenTrajectory = allControls.some((element) => enabled(element) && matches(element, labels.trajectory));
    return {
      canStop,
      pendingCount,
      steerCount,
      hasComposer,
      toolCount: rows.length,
      activeToolCount: runningRows.length,
      failedToolCount: rows.filter((row) => row.state === 'error').length,
      stoppedToolCount: rows.filter((row) => row.state === 'stopped').length,
      latestToolState: latest?.state || 'none',
      latestToolKind: latest?.kind || 'none',
      canFocusTool: rows.length > 0,
      canOpenTrajectory,
      testCount: testRows.length,
      latestTestState,
      latestTestExitCode: Number.isSafeInteger(exitCode) ? exitCode : null,
      permissionMode,
      canOpenPermission: Boolean(permissionControl && enabled(permissionControl)),
      diffCount,
      producedPaths,
      canFocusChange: diffCount > 0 || producedPaths.length > 0
    };
  })()`;
};

const invokeHarnessUiAction = async (webContents, action) => {
  if (!webContents || typeof webContents.executeJavaScript !== 'function') return false;
  return Boolean(await webContents.executeJavaScript(getHarnessUiActionScript(action), true));
};

const readHarnessAgentState = async (webContents) => {
  if (!webContents || typeof webContents.executeJavaScript !== 'function') return classifyAgentSignals();
  const signals = await webContents.executeJavaScript(getHarnessAgentStateScript(), true);
  return classifyAgentSignals(signals);
};

module.exports = {
  ACTION_LABELS,
  PERMISSION_MODES,
  POWERSHELL_COMPATIBILITY_STATES,
  SUPPORTED_ACTIONS,
  TEST_STATES,
  TOOL_KINDS,
  TOOL_STATES,
  classifyAgentSignals,
  getHarnessAgentStateScript,
  getHarnessUiActionScript,
  invokeHarnessUiAction,
  isAgentActionSettled,
  readHarnessAgentState
};
