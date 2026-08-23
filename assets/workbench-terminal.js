(() => {
  const api = window.desktopAPI;
  const bootstrap = window.__DSH_WORKBENCH_BOOTSTRAP__ || {
    terminalPanelOpen: true,
    terminalPanelHeight: 240
  };
  if (!api?.terminal || !api?.workbench || typeof window.Terminal !== 'function' || !window.FitAddon?.FitAddon) return false;
  if (window.__DSH_TERMINAL__) {
    window.__DSH_TERMINAL__.applyLayout(bootstrap);
    return true;
  }

  const MIN_HEIGHT = 160;
  const MAX_HEIGHT = 420;
  const DEFAULT_HEIGHT = 240;
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
  const stateLabel = (state = {}) => ({
    idle: '未启动',
    starting: '正在启动',
    running: '交互中',
    stopping: '正在停止',
    completed: state.exitCode === 0 ? '已退出' : `已退出 · 代码 ${state.exitCode ?? '—'}`,
    failed: `失败${state.exitCode == null ? '' : ` · 代码 ${state.exitCode}`}`,
    stopped: '已停止'
  }[state.status] || '不可用');
  const lightTheme = {
    background: '#171716', foreground: '#f2f2ef', cursor: '#75b8ff', cursorAccent: '#171716',
    selectionBackground: '#315f8a', black: '#171716', red: '#ff9a90', green: '#79d9ae',
    yellow: '#edc16c', blue: '#75b8ff', magenta: '#d6a8ff', cyan: '#74d6d0', white: '#f2f2ef',
    brightBlack: '#77736e', brightRed: '#ffb5ad', brightGreen: '#9ae7c3', brightYellow: '#f3d68e',
    brightBlue: '#9acbff', brightMagenta: '#e4c6ff', brightCyan: '#9ce4df', brightWhite: '#ffffff'
  };
  const darkTheme = { ...lightTheme };

  const panel = create('section', 'dsh-terminal-panel');
  panel.id = 'dsh-workbench-terminal';
  panel.setAttribute('aria-label', '交互式集成终端');
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
  const mode = create('span', 'dsh-terminal-mode', 'PTY');
  const cwd = create('span', 'dsh-terminal-cwd', '正在读取工作区…');
  identity.append(title, mode, cwd);
  const stateBadge = create('span', 'dsh-terminal-state', '未启动');
  stateBadge.id = 'dsh-terminal-state-description';
  stateBadge.dataset.status = 'idle';
  stateBadge.setAttribute('role', 'status');
  const actions = create('div', 'dsh-terminal-actions');
  const clearButton = button('dsh-terminal-icon-button', '清空', '清空终端显示');
  const startButton = button('dsh-terminal-icon-button dsh-terminal-start', '启动', '启动交互式终端');
  const stopButton = button('dsh-terminal-icon-button', '停止', '停止交互式终端及其进程树');
  const closeButton = button('dsh-terminal-icon-button dsh-terminal-close', '×', '隐藏集成终端');
  actions.append(clearButton, startButton, stopButton, closeButton);
  header.append(identity, stateBadge, actions);

  const viewport = create('div', 'dsh-terminal-viewport');
  viewport.setAttribute('aria-label', 'PowerShell 交互区');
  const footer = create('footer', 'dsh-terminal-footer');
  footer.id = 'dsh-terminal-security-note';
  const security = create('span', 'dsh-terminal-security', '启动后输入直接执行；软件 Key 不会进入终端');
  const shortcut = create('span', 'dsh-terminal-shortcut', 'Ctrl+Alt+K 聚焦');
  footer.append(security, shortcut);
  panel.append(header, viewport, footer);
  document.body.append(panel);

  const terminal = new window.Terminal({
    allowTransparency: false,
    convertEol: false,
    cursorBlink: true,
    cursorStyle: 'bar',
    disableStdin: true,
    fontFamily: '"Cascadia Code", "SFMono-Regular", Consolas, monospace',
    fontSize: 11,
    lineHeight: 1.25,
    minimumContrastRatio: 4.5,
    screenReaderMode: true,
    scrollback: 5000,
    smoothScrollDuration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 80,
    theme: window.matchMedia('(prefers-color-scheme: dark)').matches ? darkTheme : lightTheme
  });
  const fitAddon = new window.FitAddon.FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.open(viewport);
  terminal.textarea?.setAttribute('aria-label', 'PowerShell 终端输入');
  terminal.textarea?.setAttribute('aria-describedby', 'dsh-terminal-state-description dsh-terminal-security-note');

  let layout = { ...bootstrap };
  let terminalState = { status: 'idle', cwd: '' };
  let startingSession = false;
  const pendingOutput = [];
  let fitFrame = 0;

  const writeSystemLine = (message) => terminal.writeln(`\x1b[38;2;170;167;161m${message}\x1b[0m`);
  const flushPendingOutput = () => {
    for (const event of pendingOutput.splice(0)) terminal.write(String(event?.text || ''));
  };
  const fitTerminal = () => {
    cancelAnimationFrame(fitFrame);
    fitFrame = requestAnimationFrame(() => {
      if (!layout.terminalPanelOpen || viewport.clientWidth < 40 || viewport.clientHeight < 20) return;
      try {
        fitAddon.fit();
        if (['starting', 'running'].includes(terminalState.status)) {
          api.terminal.resize({ cols: terminal.cols, rows: terminal.rows });
        }
      } catch {
        // A page transition can temporarily detach the terminal viewport.
      }
    });
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
    fitTerminal();
  };
  const renderState = (next = {}) => {
    terminalState = { ...terminalState, ...next };
    const active = ['starting', 'running', 'stopping'].includes(terminalState.status);
    const writable = terminalState.status === 'running';
    stateBadge.textContent = stateLabel(terminalState);
    stateBadge.dataset.status = terminalState.status || 'idle';
    cwd.textContent = terminalState.cwd || '未绑定工作区';
    cwd.title = terminalState.cwd || '';
    startButton.disabled = active || startingSession;
    startButton.textContent = ['idle', 'unavailable'].includes(terminalState.status) ? '启动' : '重新启动';
    startButton.setAttribute('aria-label', `${startButton.textContent}交互式终端`);
    stopButton.disabled = !active;
    terminal.options.disableStdin = !writable;
    viewport.dataset.status = terminalState.status || 'idle';
    security.textContent = writable
      ? '交互输入直接执行；Git 一键审查暂停；软件 Key 已隔离'
      : terminalState.recoverable
        ? '终端输出已保留；重新启动前仍可查看和复制'
        : '启动后输入直接执行；软件 Key 不会进入终端';
  };

  const startTerminal = async () => {
    if (startingSession || ['starting', 'running', 'stopping'].includes(terminalState.status)) return;
    startingSession = true;
    renderState(terminalState);
    try {
      fitAddon.fit();
      const result = await api.terminal.start({ cols: terminal.cols, rows: terminal.rows });
      if (result?.ok) {
        terminal.reset();
        writeSystemLine(`DSH 交互式终端 · ${result.state?.cwd || terminalState.cwd}`);
        renderState(result.state || terminalState);
        flushPendingOutput();
        terminal.focus();
      } else if (!result?.canceled) {
        writeSystemLine(result?.message || '交互式终端未启动。');
      }
    } catch {
      writeSystemLine('终端启动请求失败；没有绕过桌面安全门禁。');
    } finally {
      startingSession = false;
      flushPendingOutput();
      renderState(terminalState);
    }
  };

  terminal.onData((data) => {
    if (terminalState.status !== 'running') return;
    for (let offset = 0; offset < data.length; offset += 4096) api.terminal.write(data.slice(offset, offset + 4096));
  });
  terminal.onResize(({ cols, rows }) => {
    if (['starting', 'running'].includes(terminalState.status)) api.terminal.resize({ cols, rows });
  });
  clearButton.addEventListener('click', () => terminal.clear());
  startButton.addEventListener('click', () => void startTerminal());
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

  const colorScheme = window.matchMedia('(prefers-color-scheme: dark)');
  colorScheme.addEventListener?.('change', (event) => { terminal.options.theme = event.matches ? darkTheme : lightTheme; });
  window.addEventListener('resize', fitTerminal);
  new ResizeObserver(fitTerminal).observe(viewport);

  window.__DSH_TERMINAL__ = Object.freeze({
    applyLayout,
    focus: () => {
      if (!layout.terminalPanelOpen) return false;
      terminal.focus();
      return true;
    }
  });
  writeSystemLine('DSH 交互式终端尚未启动。点击“启动”后进入当前工作区。');
  applyLayout(bootstrap);
  api.terminal.getState().then((snapshot) => {
    if (snapshot?.output) {
      terminal.reset();
      terminal.write(snapshot.output);
    }
    renderState(snapshot?.state || snapshot || terminalState);
    fitTerminal();
  });
  api.terminal.onState(renderState);
  api.terminal.onOutput((event) => {
    if (startingSession) pendingOutput.push(event);
    else terminal.write(String(event?.text || ''));
  });
  return true;
})();
