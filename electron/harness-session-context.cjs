const fsp = require('node:fs/promises');
const path = require('node:path');
const { isSessionId, readHarnessSessionSelection, callHarnessApi } = require('./harness-workspace-sync.cjs');

// Chat-scoped operations follow the selected, host-confirmed Session cwd.
// The native workbench launch directory is not the identity of a sidebar chat.
// This resolver never changes the native terminal, project or running tasks.
async function resolveHarnessSessionContext({ origin, webContents, fallbackWorkspacePath,
  readSelection = readHarnessSessionSelection, apiCall = callHarnessApi,
  stat = fsp.stat }) {
  const sessionId = await readSelection(webContents);
  let workspacePath = fallbackWorkspacePath;
  if (sessionId) {
    if (!isSessionId(sessionId)) throw new Error('当前会话标识无效，请重新选择会话。');
    const listing = await apiCall(origin, 'session.list', {});
    const selected = listing?.items?.find((item) => item.sessionId === sessionId);
    if (!selected || selected.origin === 'subagent') throw new Error('当前会话尚未就绪，或属于子代理；请重新选择主会话。');
    workspacePath = selected.cwd;
  }
  if (typeof workspacePath !== 'string' || !path.isAbsolute(workspacePath) || /[\u0000-\u001f]/.test(workspacePath)) {
    throw new Error('当前会话没有有效的本机工作区，请选择工作区后重试。');
  }
  workspacePath = path.resolve(workspacePath);
  if (!(await stat(workspacePath)).isDirectory()) throw new Error('当前会话的工作区不是目录，请重新选择工作区。');
  if (await readSelection(webContents) !== sessionId) throw new Error('会话已切换，未执行操作；请在当前会话重试。');
  return Object.freeze({ workspacePath, sessionId });
}

module.exports = { resolveHarnessSessionContext };
