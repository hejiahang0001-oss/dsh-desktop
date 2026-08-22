(() => {
  const api = window.desktopAPI;
  const bootstrap = window.__DSH_WORKBENCH_BOOTSTRAP__ || {
    terminalPanelOpen: true,
    terminalPanelHeight: 240
  };
  if (!api?.terminal || !api?.workbench) return false;
  if (window.__DSH_TERMINAL__) {
    window.__DSH_TERMINAL__.applyLayout(bootstrap);
    return true;
  }

  const MIN_HEIGHT = 160;
  const MAX_HEIGHT = 420;
  const DEFAULT_HEIGHT = 240;
  const MAX_RENDERED_CHARS = 120000;
  const MAX_RENDERED_NODES = 800;

  const create = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (typeof text === 'string') node.textContent = text;
    return node;
  };
  const button = (className, text, label) => {
    const node = create('button', className, text);
    node.type = 'button';
    node.title = label;
    node.setAttribute('aria-label', label);
    return node;
  };
  const stateLabel = (state = {}) => {
    const labels = {
      idle: '就绪',
      running: '运行中',
      stopping: '正在停止',
      completed: state.exitCode === 0 ? '已完成' : `已结束 · 代码 ${state.exitCode ?? '—'}`,
      failed: `失败${state.exitCode == null ? '' : ` · 代码 ${state.exitCode}`}`,
      stopped: '已停止'
    };
    return labels[state.status] || '不可用';
  };

  const panel = create('section', 'dsh-terminal-panel');
  panel.id = 'dsh-workbench-terminal';
  panel.setAttribute('aria-label', '集成终端');
  panel.setAttribute('role', 'region');

  const resizer = create('div', 'dsh-terminal-resizer');
  resizer.tabIndex = 0;
  resizer.setAttribute('role', 'separator');
  resizer.setAttribute('aria-label', '调整集成终端高度');
  resizer.setAttribute('aria-orientation', 'horizontal');
  resizer.setAttribute('aria-valuemin', String(MIN_HEIGHT));
  resizer.setAttribute('aria-valuemax', String(MAX_HEIGHT));
  panel.append(resizer);

  const header = create('header', 'dsh-terminal-header');
  const identity = create('div', 'dsh-terminal-identity');
  const title = create('h2', '', '终端');
  const cwd = create('span', 'dsh-terminal-cwd', '正在读取工作区…');
  identity.append(title, cwd);
  const stateBadge = create('span', 'dsh-terminal-state', '就绪');
  stateBadge.id = 'dsh-terminal-state-description';
  stateBadge.dataset.status = 'idle';
  stateBadge.setAttribute('role', 'status');
  const actions = create('div', 'dsh-terminal-actions');
  const clearButton = button('dsh-terminal-icon-button', '清空', '清空终端输出');
  const stopButton = button('dsh-terminal-icon-button', '停止', '停止当前终端命令');
  const closeButton = button('dsh-terminal-icon-button dsh-terminal-close', '×', '隐藏集成终端');
  actions.append(clearButton, stopButton, closeButton);
  header.append(identity, stateBadge, actions);

  const output = create('div', 'dsh-terminal-output');
  output.tabIndex = 0;
  output.setAttribute('role', 'log');
  output.setAttribute('aria-label', '终端命令输出');
  output.setAttribute('aria-live', 'polite');
  output.setAttribute('aria-relevant', 'additions text');

  const composer = create('form', 'dsh-terminal-composer');
  const prompt = create('span', 'dsh-terminal-prompt', 'PS');
  prompt.setAttribute('aria-hidden', 'true');
  const inputLabel = create('label', 'dsh-terminal-input-label', 'PowerShell 命令');
  const input = create('input', 'dsh-terminal-input');
  input.type = 'text';
  input.maxLength = 4096;
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.placeholder = '输入 PowerShell 命令，Enter 后确认运行';
  inputLabel.append(input);
  const runButton = button('dsh-terminal-run-button', '运行', '确认并运行终端命令');
  runButton.type = 'submit';
  composer.append(prompt, inputLabel, runButton);
  panel.append(header, output, composer);
  document.body.append(panel);

  let layout = { ...bootstrap };
  let terminalState = { status: 'idle', cwd: '' };
  let renderedChars = 0;
  let submitting = false;
  const history = [];
  let historyIndex = 0;
  const pendingOutput = [];

  const trimOutput = () => {
    while (output.childElementCount > MAX_RENDERED_NODES || renderedChars > MAX_RENDERED_CHARS) {
      const first = output.firstElementChild;
      if (!first) break;
      renderedChars -= first.textContent.length;
      first.remove();
    }
  };
  const appendOutput = (textValue, stream = 'system') => {
    const text = String(textValue || '');
    if (!text) return;
    const wasAtBottom = output.scrollHeight - output.scrollTop - output.clientHeight < 36;
    const line = create('span', 'dsh-terminal-output-chunk', text);
    line.dataset.stream = stream;
    output.append(line);
    renderedChars += text.length;
    trimOutput();
    if (wasAtBottom) output.scrollTop = output.scrollHeight;
  };
  const clearOutput = () => {
    output.replaceChildren();
    renderedChars = 0;
    appendOutput('DSH 集成终端 · Windows PowerShell · 命令在当前工作区运行\n', 'system');
  };
  const flushPendingOutput = () => {
    for (const event of pendingOutput.splice(0)) appendOutput(event?.text, event?.stream);
  };
  const applyLayout = (next = {}) => {
    const requestedHeight = Math.min(
      MAX_HEIGHT,
      Math.max(MIN_HEIGHT, Math.round(Number(next.terminalPanelHeight) || DEFAULT_HEIGHT))
    );
    const viewportLimit = Math.max(MIN_HEIGHT, window.innerHeight - 320);
    const effectiveHeight = Math.min(requestedHeight, viewportLimit);
    layout = {
      ...layout,
      ...next,
      terminalPanelOpen: next.terminalPanelOpen !== false,
      terminalPanelHeight: requestedHeight,
      effectiveTerminalHeight: effectiveHeight
    };
    document.documentElement.style.setProperty('--dsh-terminal-height', `${effectiveHeight}px`);
    document.documentElement.dataset.dshTerminalOpen = String(layout.terminalPanelOpen);
    resizer.setAttribute('aria-valuenow', String(effectiveHeight));
    panel.setAttribute('aria-hidden', String(!layout.terminalPanelOpen));
    panel.inert = !layout.terminalPanelOpen;
  };
  const renderState = (next = {}) => {
    terminalState = { ...terminalState, ...next };
    const active = terminalState.status === 'running' || terminalState.status === 'stopping';
    stateBadge.textContent = stateLabel(terminalState);
    stateBadge.dataset.status = terminalState.status || 'idle';
    cwd.textContent = terminalState.cwd || '未绑定工作区';
    cwd.title = terminalState.cwd || '';
    stopButton.disabled = !active;
    runButton.disabled = active || submitting || !input.value.trim();
    input.setAttribute('aria-describedby', 'dsh-terminal-state-description');
  };
  const setComposerState = () => renderState(terminalState);

  composer.addEventListener('submit', async (event) => {
    event.preventDefault();
    const command = input.value.trim();
    if (!command || submitting || terminalState.status === 'running' || terminalState.status === 'stopping') return;
    submitting = true;
    setComposerState();
    try {
      const result = await api.terminal.run(command);
      if (result?.ok) {
        appendOutput(`\nPS ${terminalState.cwd}> ${command}\n`, 'command');
        flushPendingOutput();
        if (history.at(-1) !== command) history.push(command);
        if (history.length > 50) history.shift();
        historyIndex = history.length;
        input.value = '';
        renderState(result.state || terminalState);
      } else if (result?.canceled) {
        flushPendingOutput();
        appendOutput('\n命令已取消。\n', 'system');
      } else {
        flushPendingOutput();
        appendOutput(`\n${result?.message || '命令未执行。'}\n`, 'stderr');
      }
    } catch {
      appendOutput('\n终端请求失败；没有绕过桌面安全门禁。\n', 'stderr');
    } finally {
      flushPendingOutput();
      submitting = false;
      setComposerState();
      input.focus();
    }
  });
  input.addEventListener('input', setComposerState);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowUp' && history.length) {
      event.preventDefault();
      historyIndex = Math.max(0, historyIndex - 1);
      input.value = history[historyIndex] || '';
      setComposerState();
    } else if (event.key === 'ArrowDown' && history.length) {
      event.preventDefault();
      historyIndex = Math.min(history.length, historyIndex + 1);
      input.value = history[historyIndex] || '';
      setComposerState();
    } else if (event.ctrlKey && event.key.toLowerCase() === 'l') {
      event.preventDefault();
      clearOutput();
    } else if (event.ctrlKey && event.key.toLowerCase() === 'c'
      && (terminalState.status === 'running' || terminalState.status === 'stopping')) {
      event.preventDefault();
      void api.terminal.stop();
    }
  });
  clearButton.addEventListener('click', clearOutput);
  stopButton.addEventListener('click', () => void api.terminal.stop());
  closeButton.addEventListener('click', async () => applyLayout(await api.workbench.setTerminalPanelOpen(false)));

  let dragStartHeight = 0;
  let dragStartY = 0;
  resizer.addEventListener('pointerdown', (event) => {
    dragStartHeight = layout.terminalPanelHeight;
    dragStartY = event.clientY;
    resizer.dataset.dragging = 'true';
    resizer.setPointerCapture(event.pointerId);
  });
  resizer.addEventListener('pointermove', (event) => {
    if (resizer.dataset.dragging !== 'true') return;
    applyLayout({ ...layout, terminalPanelHeight: dragStartHeight + dragStartY - event.clientY });
  });
  resizer.addEventListener('pointerup', async (event) => {
    if (resizer.dataset.dragging !== 'true') return;
    delete resizer.dataset.dragging;
    resizer.releasePointerCapture(event.pointerId);
    applyLayout(await api.workbench.setTerminalPanelHeight(layout.terminalPanelHeight));
  });
  resizer.addEventListener('keydown', async (event) => {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const height = event.key === 'Home' ? MIN_HEIGHT
      : event.key === 'End' ? MAX_HEIGHT
        : layout.terminalPanelHeight + (event.key === 'ArrowUp' ? 12 : -12);
    applyLayout(await api.workbench.setTerminalPanelHeight(height));
  });
  window.addEventListener('resize', () => applyLayout(layout));

  window.__DSH_TERMINAL__ = Object.freeze({
    applyLayout,
    focus: () => {
      if (!layout.terminalPanelOpen) return false;
      input.focus();
      return true;
    }
  });
  clearOutput();
  applyLayout(bootstrap);
  api.terminal.getState().then(renderState);
  api.terminal.onState(renderState);
  api.terminal.onOutput((event) => {
    if (submitting) pendingOutput.push(event);
    else appendOutput(event?.text, event?.stream);
  });
  return true;
})();
