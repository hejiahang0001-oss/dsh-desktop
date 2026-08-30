const fsp = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { CredentialVault, attachCredentialChannel } = require('./credential-vault.cjs');
const { callHarnessRemote, sanitizePluginInventory } = require('./extension-center.cjs');
const { attachTerminalReadChannel } = require('./terminal-read-broker.cjs');

const createDesktopCredentialHost = async ({ homeDir, runtime, rootDir, resourcesPath, isPackaged, crypto, provisionPlugin, terminalReadBroker }) => {
  const providerModule = path.resolve(path.dirname(runtime.dshBinPath), '../../dsh-credentials/lib/index.js');
  const localModule = path.resolve(path.dirname(runtime.dshBinPath), '../../dsh-credentials-local/lib/index.js');
  const parser = await import(pathToFileURL(localModule).href);
  const vault = new CredentialVault({ homeDir, crypto, parseLegacy: (text) => parser.parseCredentialsDocument(parser.renderFlatLayoutMigration(text) ?? text, 'software-managed-credentials') });
  await vault.init({ deferMigration: true });
  const sourceDir = isPackaged ? path.join(resourcesPath, 'harness-plugins', 'dsh-desktop-credentials') : path.join(rootDir, 'runtime', 'dsh-desktop-credentials');
  await provisionPlugin({ homeDir, sourceDir, expectedName: 'dsh-desktop-credentials' });
  const toolsModule = terminalReadBroker ? path.resolve(path.dirname(runtime.dshBinPath), '../../dsh-tools/lib/index.js') : null;
  if (toolsModule) await provisionPlugin({ homeDir, sourceDir: isPackaged ? path.join(resourcesPath, 'harness-plugins', 'dsh-desktop-tools') : path.join(rootDir, 'runtime', 'dsh-desktop-tools'), expectedName: 'dsh-desktop-tools' });
  const patchPath = path.join(homeDir, 'desktop-secure.patch.yml');
  try { if ((await fsp.lstat(patchPath)).isSymbolicLink()) throw new Error('凭据组件配置不能是文件链接。'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const basePatch = await fsp.readFile(runtime.patchPath, 'utf8');
  await fsp.writeFile(patchPath, `${basePatch}\n- id: credentials\n  name: '@deepseek-ai/dsh-credentials-local'\n  disabled: true\n- insert:\n    - id: desktop-credentials\n      name: dsh-desktop-credentials\n${toolsModule ? '    - id: desktop-tools\n      name: dsh-desktop-tools\n' : ''}`, { mode: 0o600 });
  return { patchPath, providerModule, toolsModule, status: () => vault.status(),
    redact: (text) => {
      let result = String(text || '');
      const values = (value) => typeof value === 'string' ? [value] : value && typeof value === 'object' ? Object.values(value).flatMap(values) : [];
      for (const secret of values({ refs: vault.state?.refs, records: vault.state?.records })) if (secret.length >= 8) result = result.replaceAll(secret, '[REDACTED]');
      return result;
    },
    attach: (child) => { const credentials = attachCredentialChannel(child, vault); const terminal = terminalReadBroker && attachTerminalReadChannel(child, terminalReadBroker); return () => { credentials(); terminal?.(); }; },
    verifyReady: async (origin, fetchImpl) => {
      const inventory = sanitizePluginInventory(await callHarnessRemote(origin, 'pluginInventory', 'list', {}, { fetchImpl }));
      if (toolsModule && !inventory.entries.some((entry) => entry.moduleName === 'dsh-desktop-tools' && entry.fiberPhase === 'active')) throw new Error('桌面只读工具未就绪，请重新安装或恢复原版本。');
      if (!inventory.entries.some((entry) => entry.moduleName === 'dsh-desktop-credentials' && entry.fiberPhase === 'active')
        || inventory.entries.some((entry) => entry.moduleName === '@deepseek-ai/dsh-credentials-local' && entry.enabled)) throw new Error('加密凭据组件未就绪；旧凭据已保留，不允许进入模型调用。');
      await vault.finalizeMigration();
    }
  };
};
module.exports = { createDesktopCredentialHost };
