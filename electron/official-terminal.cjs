// Navigate the public official sidebar. Never attach to its PTY output stream:
// TerminalController.follow would transfer the user's keyboard ownership.
const openOfficialTerminal = async ({ getWindow, getContext, ready, collapse }) => {
  const window = getWindow();
  if (!window || window.isDestroyed() || !ready()) return { ok: false, message: '请等待工作区连接完成。' };
  const context = { ...getContext() };
  if (context.status !== 'synced' || !context.sessionId) return { ok: false, message: '请先选择已就绪的主会话。' };
  try { await collapse(); } catch { return { ok: false, message: '工作台尚未就绪，请重试。' }; }
  const current = getContext();
  if (getWindow() !== window || window.isDestroyed() || !ready()
    || current.status !== 'synced' || current.sessionId !== context.sessionId) {
    return { ok: false, message: '会话已变化，请重试。' };
  }
  try {
    const opened = await window.webContents.executeJavaScript(`(() => {
      const bridge = window.__DSH_OFFICIAL_FILES__;
      if (!bridge?.openTerminal) throw new Error('官方终端入口尚未就绪，请等待页面加载完成。');
      return bridge.openTerminal(${JSON.stringify(context.sessionId)});
    })()`);
    return { ok: opened === true, ...(opened === true ? {} : { message: '官方终端未打开，请重试。' }) };
  } catch {
    return { ok: false, message: '官方终端尚未就绪或会话已变化，请等待页面加载完成后重试。' };
  }
};

module.exports = { openOfficialTerminal };
