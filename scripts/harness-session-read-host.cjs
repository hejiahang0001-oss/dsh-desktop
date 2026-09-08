const fsp = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { SessionControlClient } = require('../electron/session-control-client.cjs');
const { callHarnessRemote, sanitizePluginInventory } = require('../electron/extension-center.cjs');

// Isolated CLI smokes need the same cold-read IPC as Electron, but must not
// construct a credential vault or change the selected permission preset.
const createSessionReadHost = async ({ homeDir, runtime, provisionPlugin,
  rootDir = path.resolve(__dirname, '..'), resourcesPath = rootDir, isPackaged = false }) => {
  const toolsModule = path.resolve(path.dirname(runtime.dshBinPath), '../../dsh-tools/lib/index.js');
  if (!(await fsp.stat(toolsModule)).isFile()) throw new Error('Harness read-only tools module is unavailable.');
  const sourceDir = isPackaged ? path.join(resourcesPath, 'harness-plugins', 'dsh-desktop-tools') : path.join(rootDir, 'runtime', 'dsh-desktop-tools');
  await provisionPlugin({ homeDir, sourceDir, expectedName: 'dsh-desktop-tools' });
  const basePatch = await fsp.readFile(runtime.patchPath, 'utf8');
  const patchPath = path.join(homeDir, `desktop-session-read-${randomUUID()}.patch.yml`);
  await fsp.writeFile(patchPath, `${basePatch}\n- insert:\n    - id: desktop-tools\n      name: dsh-desktop-tools\n`, { flag: 'wx', mode: 0o600 });
  const control = new SessionControlClient();
  const sessionControl = Object.freeze({ request: (operation, payload) => operation === 'history-page'
    ? control.request(operation, payload) : Promise.reject(new Error('The smoke history host accepts only read-only history pages.')) });
  return {
    patchPath, toolsModule, sessionControl,
    attach(child) {
      const releaseControl = control.attach(child);
      const denyTerminal = (request) => {
        if (request?.channel !== 'dsh-terminal-read-v1' || request.operation !== 'read'
          || !/^[a-f0-9-]{36}$/i.test(request.requestId || '') || !child.connected) return;
        child.send({ channel: request.channel, requestId: request.requestId, ok: false,
          error: 'Terminal access is unavailable in the isolated history smoke host.' }, () => {});
      };
      const close = () => { child.off('message', denyTerminal); child.off('exit', close); releaseControl(); };
      child.on('message', denyTerminal); child.once('exit', close);
      return close;
    },
    async verifyReady(origin, fetchImpl) {
      const inventory = sanitizePluginInventory(await callHarnessRemote(origin, 'pluginInventory', 'list', {}, { fetchImpl }));
      if (!inventory.entries.some((entry) => entry.moduleName === 'dsh-desktop-tools' && entry.fiberPhase === 'active')) {
        throw new Error('Harness isolated history reader is not active.');
      }
    }
  };
};

module.exports = { createSessionReadHost };
