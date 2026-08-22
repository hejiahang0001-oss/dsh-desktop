const { normalizeWorkbenchState } = require('./workbench-store.cjs');

const getWorkbenchPanelBootstrapScript = (state) => {
  const safeState = normalizeWorkbenchState(state);
  return `window.__DSH_WORKBENCH_BOOTSTRAP__ = Object.freeze(${JSON.stringify(safeState)});`;
};

const getWorkbenchPanelLayoutScript = (state) => {
  const safeState = normalizeWorkbenchState(state);
  return `(() => {
    const panel = window.__DSH_WORKBENCH__;
    if (!panel || typeof panel.applyLayout !== 'function') return false;
    panel.applyLayout(${JSON.stringify(safeState)});
    return true;
  })()`;
};

module.exports = {
  getWorkbenchPanelBootstrapScript,
  getWorkbenchPanelLayoutScript
};
