(() => {
  const api = window.terminalAPI;
  if (!api || typeof window.Terminal !== 'function' || !window.FitAddon?.FitAddon) return;

  const viewport = document.getElementById('terminal-viewport');
  const cwd = document.getElementById('terminal-cwd');
  const stateBadge = document.getElementById('terminal-state');
  const clearButton = document.getElementById('terminal-clear');
  const startButton = document.getElementById('terminal-start');
  const stopButton = document.getElementById('terminal-stop');
  const security = document.getElementById('terminal-security');

  const stateLabel = (state = {}) => ({
    idle: '未启动',
    starting: '正在启动',
    running: '交互中',
    stopping: '正在停止',
    completed: state.exitCode === 0 ? '已退出' : `已退出 · 代码 ${state.exitCode ?? '—'}`,
    failed: `失败${state.exitCode == null ? '' : ` · 代码 ${state.exitCode}`}`,
    stopped: '已停止'
  }[state.status] || '不可用');

  const readTerminalTheme = () => {
    const styles = getComputedStyle(document.documentElement);
    // Resolve system colors too: xterm receives concrete CSS colors in forced-color mode.
    const probe = document.createElement('span');
    probe.hidden = true;
    document.body.append(probe);
    const color = (token) => {
      probe.style.color = styles.getPropertyValue(token).trim();
      return getComputedStyle(probe).color;
    };
    const theme = {
      background: color('--lulu-bg'), foreground: color('--lulu-text'),
      cursor: color('--lulu-accent'), cursorAccent: color('--lulu-bg'),
      selectionBackground: color('--lulu-accent-soft')
    };
    const systemColors = window.matchMedia('(forced-colors: active)').matches;
    for (const name of ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white']) {
      const brightName = `bright${name[0].toUpperCase()}${name.slice(1)}`;
      theme[name] = color(systemColors ? '--lulu-text' : `--lulu-terminal-${name}`);
      theme[brightName] = color(systemColors ? '--lulu-text' : `--lulu-terminal-bright-${name}`);
    }
    probe.remove();
    return theme;
  };

  const terminal = new window.Terminal({
    allowTransparency: false,
    convertEol: false,
    cursorBlink: true,
    cursorStyle: 'bar',
    disableStdin: true,
    fontFamily: '"Cascadia Code", Consolas, monospace',
    fontSize: 12,
    lineHeight: 1.25,
    minimumContrastRatio: 4.5,
    screenReaderMode: true,
    scrollback: 5000,
    smoothScrollDuration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 80,
    theme: readTerminalTheme()
  });
  const fitAddon = new window.FitAddon.FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.open(viewport);
  for (const query of ['(prefers-color-scheme: dark)', '(forced-colors: active)']) {
    window.matchMedia(query).addEventListener('change', () => { terminal.options.theme = readTerminalTheme(); });
  }
  terminal.textarea?.setAttribute('aria-label', 'PowerShell 终端输入');
  terminal.textarea?.setAttribute('aria-describedby', 'terminal-state terminal-security');

  let terminalState = { status: 'idle', cwd: '' };
  let starting = false;
  let fitFrame = 0;
  const pendingOutput = [];

  const fit = () => {
    cancelAnimationFrame(fitFrame);
    fitFrame = requestAnimationFrame(() => {
      if (viewport.clientWidth < 40 || viewport.clientHeight < 20) return;
      try {
        fitAddon.fit();
        if (['starting', 'running'].includes(terminalState.status)) {
          api.resize({ cols: terminal.cols, rows: terminal.rows });
        }
      } catch {
        // Window resize can briefly detach the xterm viewport.
      }
    });
  };

  const renderState = (next = {}) => {
    terminalState = { ...terminalState, ...next };
    const active = ['starting', 'running', 'stopping'].includes(terminalState.status);
    stateBadge.textContent = stateLabel(terminalState);
    stateBadge.dataset.status = terminalState.status || 'idle';
    cwd.textContent = terminalState.cwd || '未绑定工作区';
    cwd.title = terminalState.cwd || '';
    startButton.disabled = active || starting;
    startButton.textContent = ['idle', 'unavailable'].includes(terminalState.status) ? '启动' : '重新启动';
    stopButton.disabled = !active;
    terminal.options.disableStdin = terminalState.status !== 'running';
    security.textContent = terminalState.status === 'running'
      ? '交互输入直接执行；Git 一键审查暂停；Harness 页面不能写入；软件 Key 已隔离。'
      : '本窗口只加载本地资源；Harness 页面不能写入终端；软件 Key 不会进入终端。';
  };

  const flushOutput = () => {
    for (const event of pendingOutput.splice(0)) terminal.write(String(event?.text || ''));
  };

  const start = async () => {
    if (starting || ['starting', 'running', 'stopping'].includes(terminalState.status)) return;
    starting = true;
    renderState(terminalState);
    try {
      fitAddon.fit();
      const result = await api.start({ cols: terminal.cols, rows: terminal.rows });
      if (result?.ok) {
        terminal.reset();
        terminal.writeln(`\u001b[38;2;170;167;161mDSH 安全终端 · ${result.state?.cwd || terminalState.cwd}\u001b[0m`);
        renderState(result.state || terminalState);
        flushOutput();
        terminal.focus();
      } else if (!result?.canceled) {
        terminal.writeln(result?.message || '交互式终端未启动。');
      }
    } catch {
      terminal.writeln('终端启动请求失败；没有绕过桌面安全门禁。');
    } finally {
      starting = false;
      flushOutput();
      renderState(terminalState);
    }
  };

  terminal.onData((data) => {
    if (terminalState.status !== 'running') return;
    for (let offset = 0; offset < data.length; offset += 4096) api.write(data.slice(offset, offset + 4096));
  });
  terminal.onResize(({ cols, rows }) => {
    if (['starting', 'running'].includes(terminalState.status)) api.resize({ cols, rows });
  });
  clearButton.addEventListener('click', () => terminal.clear());
  startButton.addEventListener('click', () => void start());
  stopButton.addEventListener('click', () => void api.stop());
  window.addEventListener('resize', fit);
  document.addEventListener('keydown', (event) => {
    if (event.ctrlKey && event.altKey && event.key.toLocaleLowerCase() === 'k') {
      event.preventDefault();
      terminal.focus();
    }
  });
  new ResizeObserver(fit).observe(viewport);

  terminal.writeln('lulu 安全终端尚未启动。点击“启动”后进入当前工作区。');
  api.getState().then((snapshot) => {
    if (snapshot?.output) {
      terminal.reset();
      terminal.write(snapshot.output);
    }
    renderState(snapshot?.state || snapshot || terminalState);
    fit();
  });
  api.onState(renderState);
  api.onOutput((event) => {
    if (starting) pendingOutput.push(event);
    else terminal.write(String(event?.text || ''));
  });
})();
