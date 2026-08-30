const {
  createAuthenticatedHarnessFetch,
  establishHarnessSession
} = require('../electron/harness-supervisor.cjs');
const { callHarnessApi } = require('../electron/harness-workspace-sync.cjs');

const authenticateHarnessSupervisor = async (supervisor) => {
  if (!supervisor || typeof supervisor.start !== 'function') {
    throw new Error('Harness smoke supervisor is unavailable.');
  }
  const launchUrl = await supervisor.start();
  const authentication = await establishHarnessSession(launchUrl);
  const fetchImpl = createAuthenticatedHarnessFetch(authentication);
  const apiCall = (origin, method, payload, options = {}) => callHarnessApi(
    origin,
    method,
    payload,
    { ...options, fetchImpl }
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
