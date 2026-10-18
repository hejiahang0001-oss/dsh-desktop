// Navigate the public panel control shared by the reviewed alpha.2/alpha.4 UI.
// This is not a URL route and must not call plugin mutation remotes itself.
async function openPluginsPanel() {
  const controls = [...document.querySelectorAll('nav[aria-label="全局面板"] button[aria-label="插件"], nav[aria-label="Global panels"] button[aria-label="Plugins"]')]
    .filter((button) => !button.disabled && button.isConnected && button.getClientRects().length > 0);
  if (controls.length !== 1) return false;
  const button = controls[0];
  button.click();
  const deadline = Date.now() + 1200;
  do {
    if (!button.isConnected) return false;
    if (button.getAttribute('aria-current') === 'page') return true;
    await new Promise((resolve) => setTimeout(resolve, 40));
  } while (Date.now() < deadline);
  return false;
}

const openOfficialPlugins = async ({ getWindow, getOrigin, ready, collapse }) => {
  const window = getWindow(), origin = getOrigin();
  const samePage = () => {
    try {
      const target = new URL(origin), current = new URL(window.webContents.getURL());
      return getWindow() === window && !window.isDestroyed() && ready() && getOrigin() === origin
        && target.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(target.hostname)
        && target.origin === origin && current.origin === origin;
    } catch { return false; }
  };
  const unavailable = { ok: false, message: '官方插件页尚未就绪，请等待 Harness 连接完成后重试。' };
  if (!samePage()) return unavailable;
  try {
    await collapse();
    if (!samePage()) return unavailable;
    const opened = await window.webContents.executeJavaScript(`(${openPluginsPanel.toString()})()`);
    if (!samePage() || opened !== true) return unavailable;
    if (window.isMinimized()) window.restore();
    window.show(); window.focus();
    return { ok: true, message: '已打开官方插件页；安装、启停、更新和兼容性由 Harness 管理。' };
  } catch { return unavailable; }
};

// Keep file health and old recovery evidence, not a second compatibility authority.
const readOnlyPluginState = (state) => {
  const metadata = ({ compatibility, toggleable, ...row }) => ({ ...row, toggleable: false });
  const profiles = (state.profiles || []).map((profile) => {
    const bundles = (profile.bundles || []).map(metadata), dependencies = (profile.dependencies || []).map(metadata);
    if (profile.status === 'invalid') return { ...profile, bundles, dependencies };
    const healthy = profile.workspaceReady && [...bundles, ...dependencies].every((row) => row.status === 'ready');
    return { ...profile, bundles, dependencies, status: healthy ? 'healthy' : 'degraded',
      message: healthy ? '本地文件检查完成；版本兼容性及启停状态请以官方插件页为准。' : '本地文件或 Profile 配置不完整；本页不作插件版本兼容性裁决。' };
  });
  return { ...state, profiles, catalog: [], management: 'official' };
};

// Stale renderers may still invoke these names. Even a trusted frame cannot write.
const registerRetiredPluginMutations = (ipcMain, trusted) => {
  for (const channel of ['plugin-health:install', 'plugin-health:lifecycle', 'plugin-health:toggle']) {
    ipcMain.handle(channel, (event) => trusted(event)
      ? { ok: false, code: 'official-plugin-manager-required', message: '桌面重复管理入口已停用，请在官方插件页安装、启停或更新插件；本次没有修改 Profile。' }
      : { ok: false, message: '扩展请求未通过安全校验。' });
  }
};

module.exports = { openOfficialPlugins, openPluginsPanel, readOnlyPluginState, registerRetiredPluginMutations };
