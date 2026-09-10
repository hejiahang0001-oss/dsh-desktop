const path = require('node:path');
const { WorkspaceFiles, WorkspaceFilesError, normalizeRelativePath } = require('./workspace-files.cjs');
const { isSessionId } = require('./harness-workspace-sync.cjs');

const samePath = (a, b) => typeof a === 'string' && typeof b === 'string'
  && path.isAbsolute(a) && path.isAbsolute(b) && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const stale = () => new WorkspaceFilesError('context-changed', '会话或工作区已切换，请在当前工作区重新搜索后打开。');

// A navigation grant contains no file bytes and never selects or activates an Agent.
const createOfficialFilePreview = ({ getContext, getWorkspacePath }) => ({
  async resolve(request) {
    if (!request || !isSessionId(request.sessionId)) throw stale();
    const relativePath = normalizeRelativePath(request.path);
    if (/[<>:"|?*]/.test(relativePath) || relativePath.split('/').some((part) =>
      /[ .]$/.test(part) || /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part))) {
      throw new WorkspaceFilesError('path-invalid', '文件路径包含不允许的 Windows 文件名。');
    }
    const matches = (context) => context.sessionId === request.sessionId
      && samePath(context.workspacePath, request.workspacePath)
      && samePath(context.workspacePath, getWorkspacePath());
    const before = await getContext();
    if (!matches(before)) throw stale();
    const files = new WorkspaceFiles();
    await files.activate(before.workspacePath);
    const descriptor = await files.describeFile(relativePath);
    if (!matches(await getContext())) throw stale();
    return Object.freeze({ available: true, sessionId: request.sessionId,
      address: `dsh-resource://file/session/${request.sessionId}/${descriptor.path.split('/').map(encodeURIComponent).join('/')}` });
  }
});

module.exports = { createOfficialFilePreview };
