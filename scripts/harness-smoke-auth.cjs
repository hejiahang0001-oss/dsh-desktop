const {
  createAuthenticatedHarnessFetch,
  establishHarnessSession
} = require('../electron/harness-supervisor.cjs');
const { callHarnessApi } = require('../electron/harness-workspace-sync.cjs');
const { createSessionReadHost } = require('./harness-session-read-host.cjs');

const authenticateHarnessSupervisor = async (supervisor) => {
  if (!supervisor || typeof supervisor.start !== 'function') {
    throw new Error('Harness smoke supervisor is unavailable.');
  }
  if (!supervisor.options?.createCredentialHost && !supervisor.credentialHost) {
    if (!supervisor.options || supervisor.child || supervisor.state?.status === 'starting') {
      throw new Error('The isolated history reader must be configured before Harness starts.');
    }
    supervisor.options.createCredentialHost = (options) => createSessionReadHost({
      ...options, rootDir: supervisor.options.rootDir, resourcesPath: supervisor.options.resourcesPath,
      isPackaged: supervisor.options.isPackaged
    });
  }
  const launchUrl = await supervisor.start();
  const authentication = await establishHarnessSession(launchUrl);
  const fetchImpl = createAuthenticatedHarnessFetch(authentication);
  if (!supervisor.credentialHost?.sessionControl) throw new Error('Harness smoke history IPC is unavailable.');
  await supervisor.credentialHost.verifyReady?.(authentication.origin, fetchImpl);
  const apiCall = (origin, method, payload, options = {}) => callHarnessApi(
    origin,
    method,
    payload,
    { ...options, fetchImpl, readHistoryPage: (request, readOptions) => {
      if (origin !== authentication.origin) throw new Error('Harness history IPC origin does not match its authenticated process.');
      return supervisor.credentialHost.sessionControl.request('history-page', { ...request, timeoutMs: readOptions.timeoutMs });
    } }
  );
  return Object.freeze({
    origin: authentication.origin,
    cookie: authentication.cookie,
    probe: authentication.probe,
    fetchImpl,
    apiCall
  });
};

module.exports = { authenticateHarnessSupervisor };
